#!/usr/bin/env node
/**
 * deploy-direct.js
 *
 * Deploys DealRoomEscrow, MockTokenA, MockTokenB to X Layer Testnet
 * using ethers v6 directly — no Hardhat binary required.
 *
 * Prerequisites:
 *   1. node scripts/compile-local.js     (generates artifacts/)
 *   2. Set DEPLOYER_PRIVATE_KEY in .env.local
 *
 * Usage:
 *   node scripts/deploy-direct.js
 *
 * Optional env vars (set in .env.local):
 *   MAKER_WALLET   → receives 10,000 TKA
 *   TAKER_WALLET   → receives 10,000 TKB
 */

const { ethers }    = require("ethers");
const { readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join }      = require("path");
const dotenv        = require("dotenv");

dotenv.config({ path: join(__dirname, "../.env.local") });

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL        = "https://testrpc.xlayer.tech/terigon";
const CHAIN_ID       = 1952;
const ARBITER        = "0x344fdf33c7907c1267c73b940ce91741097cea49";
const DEMO_AMOUNT    = ethers.parseUnits("10000", 18);

const DEPLOYER_KEY   = process.env.DEPLOYER_PRIVATE_KEY;
const MAKER_WALLET   = process.env.MAKER_WALLET;
const TAKER_WALLET   = process.env.TAKER_WALLET;

if (!DEPLOYER_KEY) {
  console.error("Error: DEPLOYER_PRIVATE_KEY not set in .env.local");
  process.exit(1);
}

// ── Load compiled artifacts ───────────────────────────────────────────────────

function loadArtifact(name) {
  const p = join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    console.error(`Artifact not found: ${p}`);
    console.error("Run `node scripts/compile-local.js` first.");
    process.exit(1);
  }
}

const escrowArtifact = loadArtifact("DealRoomEscrow");
const tokenAArtifact = loadArtifact("MockTokenA");
const tokenBArtifact = loadArtifact("MockTokenB");

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: CHAIN_ID,
    name: "xlayer-testnet",
  });

  const wallet   = new ethers.Wallet(DEPLOYER_KEY, provider);
  const network  = await provider.getNetwork();
  const balance  = await provider.getBalance(wallet.address);

  console.log("─".repeat(60));
  console.log("DealRoom — Direct Deploy (ethers v6)");
  console.log("─".repeat(60));
  console.log(`  Network:   ${network.name} (chainId ${network.chainId})`);
  console.log(`  Deployer:  ${wallet.address}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} OKB`);
  console.log(`  Arbiter:   ${ARBITER}`);
  console.log("─".repeat(60));

  if (balance === 0n) {
    console.error("\nDeployer wallet has no OKB. Fund it with testnet OKB first.");
    process.exit(1);
  }

  // ── Deploy MockTokenA ──────────────────────────────────────────────────────

  console.log("\n[1/3] Deploying MockTokenA (TKA)...");
  const TokenAFactory = new ethers.ContractFactory(
    tokenAArtifact.abi, tokenAArtifact.bytecode, wallet
  );
  const tokenA = await TokenAFactory.deploy(wallet.address);
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log(`      ✓ ${tokenAAddress}`);

  // ── Deploy MockTokenB ──────────────────────────────────────────────────────

  console.log("\n[2/3] Deploying MockTokenB (TKB)...");
  const TokenBFactory = new ethers.ContractFactory(
    tokenBArtifact.abi, tokenBArtifact.bytecode, wallet
  );
  const tokenB = await TokenBFactory.deploy(wallet.address);
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log(`      ✓ ${tokenBAddress}`);

  // ── Deploy DealRoomEscrow ──────────────────────────────────────────────────

  console.log("\n[3/3] Deploying DealRoomEscrow...");
  const EscrowFactory = new ethers.ContractFactory(
    escrowArtifact.abi, escrowArtifact.bytecode, wallet
  );
  const escrow = await EscrowFactory.deploy(ARBITER);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`      ✓ ${escrowAddress}`);
  console.log(`      ✓ Arbiter locked in: ${ARBITER}`);

  // ── Optional demo mints ────────────────────────────────────────────────────

  if (MAKER_WALLET) {
    console.log(`\nMinting 10,000 TKA → ${MAKER_WALLET}`);
    const tx = await tokenA.mint(MAKER_WALLET, DEMO_AMOUNT);
    await tx.wait();
    console.log("  ✓ Done");
  }

  if (TAKER_WALLET) {
    console.log(`\nMinting 10,000 TKB → ${TAKER_WALLET}`);
    const tx = await tokenB.mint(TAKER_WALLET, DEMO_AMOUNT);
    await tx.wait();
    console.log("  ✓ Done");
  }

  // ── Save addresses ─────────────────────────────────────────────────────────

  const addresses = {
    escrow:     escrowAddress,
    tokenA:     tokenAAddress,
    tokenB:     tokenBAddress,
    arbiter:    ARBITER,
    network:    "xlayer-testnet",
    chainId:    Number(network.chainId),
    deployedAt: new Date().toISOString(),
    deployer:   wallet.address,
  };

  const libDir  = join(__dirname, "../src/lib");
  const outFile = join(libDir, "deployed-addresses.json");
  mkdirSync(libDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(addresses, null, 2) + "\n");

  console.log("\n─".repeat(60));
  console.log("Deployment complete.");
  console.log(`\nAddresses saved to src/lib/deployed-addresses.json`);
  console.log("\nContracts:");
  console.log(`  DealRoomEscrow : ${escrowAddress}`);
  console.log(`  MockTokenA     : ${tokenAAddress}`);
  console.log(`  MockTokenB     : ${tokenBAddress}`);
  console.log("\nNext: restart `npm run dev` to pick up new addresses.");
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\nDeployment failed:", err.message || err);
  process.exit(1);
});
