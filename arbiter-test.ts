/**
 * DealRoom — AI Arbiter Skill Validation
 *
 * Validates that okx-wallet-portfolio, okx-security, and okx-dex-market
 * return real data before building the frontend on top.
 *
 * Run: npx tsx arbiter-test.ts
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Public test addresses — well-known, no private keys involved
const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // Vitalik
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"; // WETH on Ethereum
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC on Ethereum

const ONCHAINOS = `${process.env.HOME}/.local/bin/onchainos`;

// ---------------------------------------------------------------------------

async function call(label: string, cmd: string): Promise<unknown> {
  const start = Date.now();
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[${label}]`);
  console.log(`▶ ${cmd}`);
  console.log("─".repeat(60));

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
      timeout: 30_000,
    });

    const elapsed = Date.now() - start;

    if (stderr?.trim()) {
      console.warn("  stderr:", stderr.trim());
    }

    // onchainos outputs JSON — parse and pretty-print
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // Not JSON — print raw
      console.log(stdout.trim());
      console.log(`  ✓ ${elapsed}ms (raw output)`);
      return stdout.trim();
    }

    console.log(JSON.stringify(parsed, null, 2));
    console.log(`\n  ✓ ${elapsed}ms`);
    return parsed;
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const e = err as { stdout?: string; stderr?: string; message?: string };
    console.error(`  ✗ FAILED in ${elapsed}ms`);
    if (e.stdout?.trim()) console.error("  stdout:", e.stdout.trim());
    if (e.stderr?.trim()) console.error("  stderr:", e.stderr.trim());
    if (!e.stdout && !e.stderr) console.error("  error:", e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("  DealRoom — Arbiter Skill Validation");
  console.log("=".repeat(60));
  console.log(`  Binary  : ${ONCHAINOS}`);
  console.log(`  Wallet  : ${TEST_WALLET}`);
  console.log(`  Chain   : Ethereum`);
  console.log(`  Started : ${new Date().toISOString()}`);

  // Pre-flight: confirm binary exists
  try {
    const { stdout } = await execAsync(`${ONCHAINOS} --version`);
    console.log(`  Version : ${stdout.trim()}`);
  } catch {
    console.error("\n  ✗ onchainos not found. Run the installer:");
    console.error("    curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/v2.2.9/install.sh | sh");
    process.exit(1);
  }

  // --- Skill 1: okx-wallet-portfolio ---
  // Get token holdings of the test wallet on Ethereum
  const portfolio = await call(
    "1/3 · okx-wallet-portfolio",
    `${ONCHAINOS} portfolio all-balances --address ${TEST_WALLET} --chains ethereum`
  );

  // --- Skill 2: okx-security ---
  // Token-scan USDC (known-safe token — good baseline / sanity check)
  const security = await call(
    "2/3 · okx-security",
    `${ONCHAINOS} security token-scan --address ${USDC_ADDRESS} --chain ethereum`
  );

  // --- Skill 3: okx-dex-market ---
  // Current price of WETH on Ethereum (proxy for ETH/USDC rate in deal evaluation)
  const price = await call(
    "3/3 · okx-dex-market",
    `${ONCHAINOS} market price --address ${WETH_ADDRESS} --chain ethereum`
  );

  // --- Summary ---
  console.log(`\n${"=".repeat(60)}`);
  console.log("  VALIDATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`  okx-wallet-portfolio : ${portfolio ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  okx-security         : ${security ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  okx-dex-market       : ${price   ? "✓ PASS" : "✗ FAIL"}`);

  const allPassed = portfolio && security && price;
  console.log(`\n  ${allPassed ? "✓ All skills returning real data. Ready to build." : "✗ One or more skills failed — check output above."}`);
  console.log("=".repeat(60));

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
