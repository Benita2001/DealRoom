#!/usr/bin/env node
/**
 * compile-local.js
 *
 * Compiles all contracts using the installed `solc` npm package (0.8.26).
 * Bypasses Hardhat's binary download entirely.
 * Outputs Hardhat-compatible artifacts to ./artifacts/contracts/
 *
 * Usage:
 *   node scripts/compile-local.js
 *
 * Then run the deploy script normally:
 *   node_modules/.bin/hardhat run scripts/deploy.ts --network xlayer-testnet
 */

const solc   = require("solc");
const fs     = require("fs");
const path   = require("path");

const CONTRACTS_DIR = path.join(__dirname, "../contracts");
const ARTIFACTS_DIR = path.join(__dirname, "../artifacts/contracts");
const OZ_PATH       = path.join(__dirname, "../node_modules/@openzeppelin/contracts");

// ── Read all .sol files ───────────────────────────────────────────────────────

const contractFiles = fs
  .readdirSync(CONTRACTS_DIR)
  .filter((f) => f.endsWith(".sol"));

// ── Build solc input ──────────────────────────────────────────────────────────

const sources = {};
for (const file of contractFiles) {
  const content = fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8");
  sources[`contracts/${file}`] = { content };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] },
    },
  },
};

// ── Import resolver — handles @openzeppelin ───────────────────────────────────

function findImports(importPath) {
  // @openzeppelin/contracts/...  →  node_modules/@openzeppelin/contracts/...
  if (importPath.startsWith("@openzeppelin/contracts/")) {
    const rel  = importPath.replace("@openzeppelin/contracts/", "");
    const full = path.join(OZ_PATH, rel);
    if (fs.existsSync(full)) {
      return { contents: fs.readFileSync(full, "utf8") };
    }
  }
  return { error: `File not found: ${importPath}` };
}

// ── Compile ───────────────────────────────────────────────────────────────────

console.log(`Compiling with solc ${solc.version()}...`);
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

// ── Check for errors ──────────────────────────────────────────────────────────

const errors   = (output.errors || []).filter((e) => e.severity === "error");
const warnings = (output.errors || []).filter((e) => e.severity === "warning");

if (warnings.length) {
  console.warn(`  ${warnings.length} warning(s):`);
  warnings.forEach((w) => console.warn("   WARN:", w.formattedMessage.split("\n")[0]));
}

if (errors.length) {
  console.error("\n  Compilation errors:");
  errors.forEach((e) => console.error("  ERROR:", e.formattedMessage));
  process.exit(1);
}

// ── Write Hardhat-compatible artifacts ───────────────────────────────────────

let count = 0;
for (const [sourceName, fileContracts] of Object.entries(output.contracts || {})) {
  for (const [contractName, contractData] of Object.entries(fileContracts)) {
    const fileName  = path.basename(sourceName); // e.g. "DealRoomEscrow.sol"
    const dir       = path.join(ARTIFACTS_DIR, fileName);
    fs.mkdirSync(dir, { recursive: true });

    const artifact = {
      _format:          "hh-sol-artifact-1",
      contractName,
      sourceName,
      abi:              contractData.abi,
      bytecode:         "0x" + contractData.evm.bytecode.object,
      deployedBytecode: "0x" + contractData.evm.deployedBytecode.object,
      linkReferences:   contractData.evm.bytecode.linkReferences   || {},
      deployedLinkReferences: contractData.evm.deployedBytecode.linkReferences || {},
    };

    const outPath = path.join(dir, `${contractName}.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(`  ✓ ${contractName} → artifacts/contracts/${fileName}/${contractName}.json`);
    count++;
  }
}

console.log(`\nDone. ${count} artifact(s) written.`);
