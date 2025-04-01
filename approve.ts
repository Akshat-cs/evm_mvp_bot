import { ethers } from "ethers";
import { config as loadEnvironmentVariables } from "dotenv";
import { provider, signer, SWAP_ROUTER_ADDRESS } from "./config";

loadEnvironmentVariables();

const ERC20_ABI = ["function approve(address, uint) external returns (bool)"];

const TOKEN0_ADDRESS = "0x1c95519d3fc922fc04fcf5d099be4a1ed8b15240"; // Your token address

async function preApprove() {
  try {
    const tokenContract = new ethers.Contract(
      TOKEN0_ADDRESS,
      ERC20_ABI,
      signer
    );

    console.log("Approving token for trading...");
    const approveTx = await tokenContract.approve(
      SWAP_ROUTER_ADDRESS,
      ethers.constants.MaxUint256
    );

    console.log(`Approval transaction submitted: ${approveTx.hash}`);
    await approveTx.wait();
    console.log("Token pre-approved for trading! You can now run your bot.");
  } catch (error) {
    console.error("Error pre-approving token:", error);
  }
}

preApprove();
