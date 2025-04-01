import { BigNumber, ethers } from "ethers";
import { AlphaRouter, SwapType, SwapRoute } from "@uniswap/smart-order-router";
import { CurrencyAmount, TradeType } from "@uniswap/sdk-core";
import type { TransactionRequest } from "@ethersproject/abstract-provider";
import { getTokens } from "./tokens";
import {
  provider,
  signer,
  CHAIN_ID,
  SWAP_ROUTER_ADDRESS,
  SLIPPAGE_TOLERANCE,
  DEADLINE,
} from "./config";

const main = async () => {
  console.log("Starting MEV bot...");
  console.log("Monitoring for trades with target token...");

  // Wait for the getTokens function to resolve
  // This will also wait for the Bitquery subscription to detect a trade
  const { Token0, Token1 } = await getTokens();

  // Ensure tokens are not null
  if (!Token0 || !Token1) {
    throw new Error("Tokens are not initialized.");
  }

  const tokenFrom = Token0.token; // Base token
  const tokenFromContract = Token0.contract;
  const tokenTo = Token1.token; // WETH

  console.log(
    `Token setup complete. From: ${tokenFrom.symbol}, To: ${tokenTo.symbol}`
  );

  // Get wallet details
  const walletAddress = await signer.getAddress();
  console.log(`Using wallet: ${walletAddress}`);

  // Check WETH balance
  const balance = await tokenFromContract.balanceOf(walletAddress);
  console.log(
    `Current ${tokenFrom.symbol} balance: ${ethers.utils.formatUnits(
      balance,
      tokenFrom.decimals
    )}`
  );

  // Calculate 50% of the balance
  const amountIn = balance.div(2);
  console.log(
    `Swapping 50% of balance: ${ethers.utils.formatUnits(
      amountIn,
      tokenFrom.decimals
    )} ${tokenFrom.symbol}`
  );

  if (amountIn.isZero()) {
    throw new Error(`No ${tokenFrom.symbol} balance to swap.`);
  }

  // Find the best route for the swap
  console.log("Finding optimal swap route...");
  const router = new AlphaRouter({ chainId: CHAIN_ID, provider });

  const route = await router.route(
    CurrencyAmount.fromRawAmount(tokenFrom, amountIn.toString()),
    tokenTo,
    TradeType.EXACT_INPUT,
    {
      recipient: walletAddress,
      slippageTolerance: SLIPPAGE_TOLERANCE,
      deadline: DEADLINE,
      type: SwapType.SWAP_ROUTER_02,
    }
  );

  if (!route) {
    throw new Error("No route found for the swap.");
  }

  console.log(
    `Found route: Swapping ${ethers.utils.formatUnits(
      amountIn,
      tokenFrom.decimals
    )} ${tokenFrom.symbol} for approximately ${route.quote.toFixed(
      tokenTo.decimals
    )} ${tokenTo.symbol}.`
  );

  // Check token allowance
  const allowance: BigNumber = await tokenFromContract.allowance(
    walletAddress,
    SWAP_ROUTER_ADDRESS
  );

  console.log(
    `Current allowance: ${ethers.utils.formatUnits(
      allowance,
      tokenFrom.decimals
    )} ${tokenFrom.symbol}`
  );

  // In index.ts, replace the buildSwapTransaction and swapTransaction section with this:

  const buildSwapTransaction = (
    walletAddress: string,
    routerAddress: string,
    route: SwapRoute
  ): TransactionRequest => {
    return {
      data: route.methodParameters?.calldata,
      to: routerAddress,
      value: BigNumber.from(route.methodParameters?.value),
      from: walletAddress,
    };
  };

  // Get base transaction
  const baseTransaction = buildSwapTransaction(
    walletAddress,
    SWAP_ROUTER_ADDRESS,
    route
  );

  // Modified gas settings to work with your available balance
  const baseFeeEstimate = await provider.getGasPrice();
  let maxPriorityFeePerGas = ethers.utils.parseUnits("1", "gwei"); // Lower priority fee
  let maxFeePerGas = baseFeeEstimate.add(maxPriorityFeePerGas); // Base fee + priority fee

  // Check if we have enough ETH for the transaction
  const estimatedGasCost = maxFeePerGas.mul(3000000); // Gas limit * gas price
  const ethBalance = await signer.getBalance();

  if (ethBalance.lt(estimatedGasCost)) {
    console.log(`Warning: Gas cost might be too high for your balance`);
    console.log(
      `Estimated gas cost: ${ethers.utils.formatEther(estimatedGasCost)} ETH`
    );
    console.log(`Your balance: ${ethers.utils.formatEther(ethBalance)} ETH`);

    // Use more economical gas settings if balance is low
    const economicalMaxPriorityFee = ethers.utils.parseUnits("0.5", "gwei");
    const economicalMaxFee = baseFeeEstimate.add(economicalMaxPriorityFee);

    // Update gas parameters
    maxPriorityFeePerGas = economicalMaxPriorityFee;
    maxFeePerGas = economicalMaxFee;
  }

  // Set a more reasonable gas limit
  const gasLimit = ethers.utils.hexlify(500000); // Lower gas limit

  // Update transaction parameters with balanced gas settings
  const swapTransaction = {
    ...baseTransaction,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
  };

  console.log("Transaction built with parameters:", {
    to: swapTransaction.to,
    value: swapTransaction.value?.toString(),
    gasLimit: swapTransaction.gasLimit?.toString(),
    maxFeePerGas: swapTransaction.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: swapTransaction.maxPriorityFeePerGas?.toString(),
  });

  // Function to execute the swap transaction
  const attemptSwapTransaction = async (
    signer: ethers.Wallet,
    transaction: TransactionRequest
  ) => {
    const signerBalance = await signer.getBalance();
    console.log(
      `ETH balance for gas: ${ethers.utils.formatEther(signerBalance)} ETH`
    );

    if (transaction.gasLimit && signerBalance.lt(transaction.gasLimit)) {
      throw new Error(
        `Not enough ETH to cover gas: Need at least ${ethers.utils.formatEther(
          transaction.gasLimit
        )} ETH`
      );
    }

    console.log("Submitting transaction...");
    // Send the transaction with the specified gas-related parameters
    const tx = await signer.sendTransaction(transaction);
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log(`Check at: https://etherscan.io/tx/${tx.hash}`);

    console.log("Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(
      `Transaction status: ${receipt.status === 1 ? "Success" : "Failed"}`
    );
    console.log("Swap complete!");

    // Check the new token balance
    const newBalance = await Token0.contract.balanceOf(walletAddress);
    console.log(
      `New ${tokenTo.symbol} balance: ${ethers.utils.formatUnits(
        newBalance,
        tokenTo.decimals
      )}`
    );
  };

  // Check and approve if needed, then execute the swap
  if (allowance.lt(amountIn)) {
    console.log(`Requesting ${tokenFrom.symbol} approval...`);

    const approvalTx = await tokenFromContract.connect(signer).approve(
      SWAP_ROUTER_ADDRESS,
      ethers.constants.MaxUint256 // Approve max amount
    );

    console.log(`Approval transaction submitted: ${approvalTx.hash}`);
    console.log("Waiting for approval confirmation...");

    await approvalTx.wait(1); // Wait for 1 confirmation
    console.log("Approval confirmed. Executing swap...");

    await attemptSwapTransaction(signer, swapTransaction);
  } else {
    console.log(`Sufficient ${tokenFrom.symbol} allowance. Executing swap...`);
    await attemptSwapTransaction(signer, swapTransaction);
  }
};

main().catch((error) => {
  console.error("Error in main function:", error);
  process.exit(1);
});
