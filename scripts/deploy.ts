/**
 * DealRoom deploy script — X Layer Testnet (chainId 1952)
 *
 * Deploys:
 *   1. MockTokenA (TKA) — mints 1M to deployer
 *   2. MockTokenB (TKB) — mints 1M to deployer
 *   3. DealRoomEscrow   — arbiter = 0x344fdf33c7907c1267c73b940ce91741097cea49
 *
 * Optionally mints demo tokens to specific wallets if env vars are set:
 *   MAKER_WALLET  → receives 10,000 TKA
 *   TAKER_WALLET  → receives 10,000 TKB
 *
 * Saves deployed addresses to src/lib/deployed-addresses.json.
 * Restart `npm run dev` after running this to pick up the new addresses.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network xlayer-testnet
 */

import hre from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const { ethers } = hre;

const ARBITER_ADDRESS = "0x344fdf33c7907c1267c73b940ce91741097cea49";
const DEMO_MINT_AMOUNT = ethers.parseUnits("10000", 18); // 10k tokens per demo wallet

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("─".repeat(60));
  console.log("DealRoom Contract Deployment");
  console.log("─".repeat(60));
  console.log(`  Network:   ${network.name} (chainId ${network.chainId})`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Arbiter:   ${ARBITER_ADDRESS}`);
  console.log("─".repeat(60));

  // ── 1. MockTokenA ──────────────────────────────────────────────────────────

  console.log("\n[1/3] Deploying MockTokenA (TKA)...");
  const MockTokenA = await ethers.getContractFactory("MockTokenA");
  const tokenA = await MockTokenA.deploy(deployer.address);
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log(`      ✓ MockTokenA deployed: ${tokenAAddress}`);

  // ── 2. MockTokenB ──────────────────────────────────────────────────────────

  console.log("\n[2/3] Deploying MockTokenB (TKB)...");
  const MockTokenB = await ethers.getContractFactory("MockTokenB");
  const tokenB = await MockTokenB.deploy(deployer.address);
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log(`      ✓ MockTokenB deployed: ${tokenBAddress}`);

  // ── 3. DealRoomEscrow ──────────────────────────────────────────────────────

  console.log("\n[3/3] Deploying DealRoomEscrow...");
  const DealRoomEscrow = await ethers.getContractFactory("DealRoomEscrow");
  const escrow = await DealRoomEscrow.deploy(ARBITER_ADDRESS);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`      ✓ DealRoomEscrow deployed: ${escrowAddress}`);
  console.log(`      ✓ Arbiter address locked in: ${ARBITER_ADDRESS}`);

  // ── Optional: mint demo tokens to specific wallets ─────────────────────────

  const makerWallet = process.env.MAKER_WALLET;
  const takerWallet = process.env.TAKER_WALLET;

  if (makerWallet) {
    console.log(`\nMinting 10,000 TKA to maker wallet ${makerWallet}...`);
    const tx = await (tokenA as unknown as { mint: (to: string, amount: bigint) => Promise<{ wait: () => Promise<unknown> }> }).mint(makerWallet, DEMO_MINT_AMOUNT);
    await (tx as { wait: () => Promise<unknown> }).wait();
    console.log("  ✓ Done");
  }

  if (takerWallet) {
    console.log(`\nMinting 10,000 TKB to taker wallet ${takerWallet}...`);
    const tx = await (tokenB as unknown as { mint: (to: string, amount: bigint) => Promise<{ wait: () => Promise<unknown> }> }).mint(takerWallet, DEMO_MINT_AMOUNT);
    await (tx as { wait: () => Promise<unknown> }).wait();
    console.log("  ✓ Done");
  }

  // ── Save addresses ─────────────────────────────────────────────────────────

  const addresses = {
    escrow:      escrowAddress,
    tokenA:      tokenAAddress,
    tokenB:      tokenBAddress,
    arbiter:     ARBITER_ADDRESS,
    network:     "xlayer-testnet",
    chainId:     Number(network.chainId),
    deployedAt:  new Date().toISOString(),
    deployer:    deployer.address,
  };

  const outDir  = join(__dirname, "../src/lib");
  const outFile = join(outDir, "deployed-addresses.json");

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(addresses, null, 2) + "\n");

  console.log("\n─".repeat(60));
  console.log("Deployment complete. Addresses saved to:");
  console.log(`  ${outFile}`);
  console.log("\nNext steps:");
  console.log("  1. Restart `npm run dev` to pick up new addresses.");
  console.log("  2. Open http://localhost:3000 and connect MetaMask to X Layer Testnet.");
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
