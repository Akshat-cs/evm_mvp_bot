import { Token } from "@uniswap/sdk-core";
import {
  Signer,
  constants,
  BigNumber,
  BigNumberish,
  Contract,
  providers,
} from "ethers";
import { CHAIN_ID, SWAP_ROUTER_ADDRESS } from "./config";
import { Provider } from "@ethersproject/providers";
import { config as loadEnvironmentVariables } from "dotenv";
import WebSocket from "ws";

loadEnvironmentVariables();

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address, address) external view returns (uint256)",
  "function approve(address, uint) external returns (bool)",
  "function balanceOf(address) external view returns(uint256)",
];

type TokenWithContract = {
  contract: Contract;
  walletHas: (signer: Signer, requiredAmount: BigNumberish) => Promise<boolean>;
  token: Token;
};

const buildERC20TokenWithContract = async (
  address: string,
  provider: Provider
): Promise<TokenWithContract | null> => {
  try {
    const contract = new Contract(address, ERC20_ABI, provider);

    const [name, symbol, decimals] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
    ]);

    return {
      contract: contract,

      walletHas: async (signer, requiredAmount) => {
        const signerBalance = await contract
          .connect(signer)
          .balanceOf(await signer.getAddress());

        return signerBalance.gte(BigNumber.from(requiredAmount));
      },

      token: new Token(CHAIN_ID, address, decimals, symbol, name),
    };
  } catch (error) {
    console.error(
      `Failed to fetch token details for address ${address}:`,
      error
    );
    return null;
  }
};

const provider = new providers.JsonRpcProvider(process.env.RPC);

type Tokens = {
  Token0: TokenWithContract | null;
  Token1: TokenWithContract | null;
};

// Define the token addresses
const TOKEN0_ADDRESS = "0x1c95519d3fc922fc04fcf5d099be4a1ed8b15240"; // Token to sell
const TOKEN1_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH

// Function to create a new WebSocket connection to Bitquery
const createBitqueryConnection = (
  resolveCallback: (value: boolean) => void
) => {
  const token = process.env.BITQUERY_TOKEN;
  if (!token) {
    console.error("BITQUERY_TOKEN not found in environment variables");
    resolveCallback(false);
    return;
  }

  const bitqueryConnection = new WebSocket(
    "wss://streaming.bitquery.io/graphql?token=" + token,
    ["graphql-ws"]
  );

  bitqueryConnection.on("open", () => {
    console.log("Connected to Bitquery.");

    // Send initialization message
    const initMessage = JSON.stringify({ type: "connection_init" });
    bitqueryConnection.send(initMessage);
  });

  bitqueryConnection.on("message", (data: WebSocket.Data) => {
    // Convert Buffer or ArrayBuffer to string if needed
    const dataString = data.toString();
    const response = JSON.parse(dataString);

    // Handle connection acknowledgment
    if (response.type === "connection_ack") {
      console.log("Connection acknowledged by Bitquery server.");

      // Send subscription message
      const subscriptionMessage = JSON.stringify({
        type: "start",
        id: "1",
        payload: {
          query: `
          subscription MyQuery {
            EVM(network: eth, mempool: true) {
              DEXTradeByTokens(
                where: {
                  TransactionStatus: {Success: true}, 
                  Trade: {
                    Dex: {ProtocolFamily: {is: "Uniswap"}}, 
                    Side: {
                      Currency: {SmartContract: {is: "${TOKEN1_ADDRESS}"}}, 
                      Type: {is: sell}, 
                      AmountInUSD: {ge: "1"}
                    }, 
                    Currency: {SmartContract: {is: "${TOKEN0_ADDRESS}"}}
                  }
                }
              ) {
                Block{
                  Time
                  Number
                }
                  Transaction{
                  Hash
                  }
                Trade {
                  Amount
                }
              }
            }
          }
          `,
        },
      });

      bitqueryConnection.send(subscriptionMessage);
      console.log("Subscription message sent to Bitquery.");
    }

    // Handle received data
    if (response.type === "data" && response.payload.data) {
      console.log("Detected matching trade in mempool!");

      // Log trade details
      const trades = response.payload.data.EVM?.DEXTradeByTokens;
      if (trades && trades.length > 0) {
        console.log("Trade details:", trades[0].Trade);

        // We've detected a trade, stop the subscription and signal to continue
        const stopMessage = JSON.stringify({ type: "stop", id: "1" });
        bitqueryConnection.send(stopMessage);
        console.log("Stop message sent to Bitquery.");

        setTimeout(() => {
          bitqueryConnection.close();
          // Signal that we've detected a trade and can continue with the swap
          resolveCallback(true);
        }, 1000);
      }
    }

    // Handle errors
    if (response.type === "error") {
      console.error("Error from Bitquery:", response);
    }
  });

  bitqueryConnection.on("close", () => {
    console.log("Disconnected from Bitquery.");
  });

  bitqueryConnection.on("error", (error: Error) => {
    console.error("WebSocket Error:", error);
    resolveCallback(false);
  });

  // Add timeout to prevent hanging if no matching trades are found
  // Adjust timeout as needed
  setTimeout(() => {
    console.log("Timeout reached. Closing Bitquery connection.");
    bitqueryConnection.close();
    resolveCallback(false);
  }, 60000 * 10); // 10 minutes timeout
};

export const getTokens = async (): Promise<Tokens> => {
  try {
    console.log("Initializing token contracts...");

    // Initialize the token contracts
    const Token0 = await buildERC20TokenWithContract(TOKEN0_ADDRESS, provider);
    const Token1 = await buildERC20TokenWithContract(TOKEN1_ADDRESS, provider);

    if (!Token0 || !Token1) {
      throw new Error("Failed to initialize token contracts");
    }

    console.log(
      `Token0 (${Token0.token.symbol}) and Token1 (${Token1.token.symbol}) initialized.`
    );
    console.log("Starting Bitquery subscription to monitor for trades...");

    // Set up the Bitquery subscription and wait for a matching trade
    const tradeDetected = await new Promise<boolean>((resolve) => {
      createBitqueryConnection(resolve);
    });

    if (tradeDetected) {
      console.log("Trade detected! Proceeding with the swap.");
    } else {
      throw new Error("No trade detected");
    }

    return { Token0, Token1 };
  } catch (error) {
    console.error("Error in getTokens:", error);
    return { Token0: null, Token1: null };
  }
};
