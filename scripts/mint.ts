/**
 * Ad-hoc mint script — use this any time during the demo to top up wallets.
 *
 * Usage:
 *   TOKEN=TKA TO=0xYourAddress AMOUNT=5000 npx hardhat run scripts/mint.ts --network xlayer-testnet
 *   TOKEN=TKB TO=0xYourAddress AMOUNT=5000 npx hardhat run scripts/mint.ts --network xlayer-testnet
 */

import hre from "hardhat";
const { ethers } = hre;
import addresses from "../src/lib/deployed-addresses.json";

async function main() {
  const token  = (process.env.TOKEN  ?? "TKA").toUpperCase();
  const to     =  process.env.TO;
  const amount =  process.env.AMOUNT ?? "1000";

  if (!to) throw new Error("TO env var required (wallet address to mint to)");

  const tokenAddress = token === "TKA" ? addresses.tokenA : addresses.tokenB;
  if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${token} address not set. Deploy contracts first.`);
  }

  const [deployer] = await ethers.getSigners();
  const contract = await ethers.getContractAt(
    token === "TKA" ? "MockTokenA" : "MockTokenB",
    tokenAddress
  );

  const amountWei = ethers.parseUnits(amount, 18);
  console.log(`Minting ${amount} ${token} to ${to}...`);
  const tx = await (contract as unknown as { mint: (to: string, amount: bigint) => Promise<{ wait: () => Promise<unknown>; hash: string }> }).mint(to, amountWei);
  console.log(`  tx: ${tx.hash}`);
  await tx.wait();
  console.log(`  ✓ Done. Signed by deployer: ${deployer.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
