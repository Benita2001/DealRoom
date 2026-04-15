/**
 * DealRoom AI Arbiter
 *
 * Takes two wallet addresses + OTC deal terms.
 * Runs parallel OKX skill checks:
 *   - okx-wallet-portfolio  → balance sufficiency for both wallets
 *   - okx-security          → token risk scan for both offer tokens
 *   - okx-dex-market        → live price for both tokens (fairness evaluation)
 *
 * Returns a structured ArbiterVerdict: APPROVE | WARN | REJECT
 *
 * No UI side effects. Pure data in, structured JSON out.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { signVerdict, ARBITER_ADDRESS, type VerdictPayload } from "./wallet";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Binary path — installed by onchainos install.sh
// ---------------------------------------------------------------------------

const BIN = `${process.env.HOME}/.local/bin/onchainos`;
const EXEC_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Chain name → chainIndex (for security token-scan --tokens format)
// ---------------------------------------------------------------------------

const CHAIN_INDEX: Record<string, string> = {
  ethereum: "1",
  eth: "1",
  solana: "501",
  sol: "501",
  bsc: "56",
  bnb: "56",
  polygon: "137",
  matic: "137",
  arbitrum: "42161",
  arb: "42161",
  base: "8453",
  xlayer: "196",
  optimism: "10",
  op: "10",
  avalanche: "43114",
  avax: "43114",
};

function chainIndex(chain: string): string {
  return CHAIN_INDEX[chain.toLowerCase()] ?? chain;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface TokenLeg {
  /** Wallet address (EVM 0x... or Solana base58) */
  walletAddress: string;
  /** Token contract address being offered. Empty string = native token. */
  tokenAddress: string;
  /** Human-readable amount in UI units (e.g. "1.5", not wei) */
  amount: string;
  /** Chain name: ethereum, base, bsc, xlayer, solana, etc. */
  chain: string;
  /** Token symbol hint for display (not trusted — resolved on-chain) */
  symbol?: string;
}

export interface DealInput {
  /** Party initiating the deal */
  maker: TokenLeg;
  /** Party accepting the deal */
  taker: TokenLeg;
}

// ---------------------------------------------------------------------------
// Raw onchainos response shapes
// ---------------------------------------------------------------------------

interface OnchanosResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface PortfolioToken {
  chainIndex: string;
  tokenContractAddress: string;
  symbol: string;
  balance: string;      // UI units
  rawBalance: string;   // base units
  tokenPrice: string;   // USD
  isRiskToken: boolean;
}

type PortfolioResponse = Array<{
  tokenAssets: PortfolioToken[];
}>;

interface SecurityToken {
  chainId: string;
  tokenAddress: string;
  isChainSupported: boolean;
  isRiskToken: boolean;
  buyTaxes: string | null;
  sellTaxes: string | null;
  // Level 4 labels
  isHoneypot: boolean;
  isRubbishAirdrop: boolean;
  isAirdropScam: boolean;
  // Level 3 labels
  isLowLiquidity: boolean;
  isDumping: boolean;
  isLiquidityRemoval: boolean;
  isPump: boolean;
  isWash: boolean;
  isFakeLiquidity: boolean;
  isWash2: boolean;
  isFundLinkage: boolean;
  isVeryLowLpBurn: boolean;
  isVeryHighLpHolderProp: boolean;
  isHasBlockingHis: boolean;
  isOverIssued: boolean;
  isCounterfeit: boolean;
  // Level 2 labels
  isMintable: boolean;
  isHasFrozenAuth: boolean;
  isNotRenounced: boolean;
}

interface PriceData {
  chainIndex: string;
  tokenContractAddress: string;
  time: string;
  price: string; // USD string
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type Verdict = "APPROVE" | "WARN" | "REJECT";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface RiskFlag {
  code: string;
  severity: RiskSeverity;
  message: string;
  party?: "maker" | "taker" | "both";
}

export interface WalletScan {
  address: string;
  chain: string;
  tokenAddress: string;
  tokenSymbol: string;
  /** Amount required by the deal */
  requiredAmount: string;
  /** Confirmed on-chain balance */
  confirmedBalance: string;
  /** Whether the wallet holds enough to cover the deal */
  hasRequiredBalance: boolean;
  /** 1=safe, 2=medium, 3=high, 4=critical. null if native/unsupported. */
  tokenRiskLevel: 1 | 2 | 3 | 4 | null;
  tokenRiskAction: "safe" | "warn" | "block" | "unscannable";
  triggeredLabels: string[];
}

export interface FairnessData {
  makerTokenPriceUsd: string | null;
  takerTokenPriceUsd: string | null;
  /** USD value of what maker is offering */
  makerOfferValueUsd: number | null;
  /** USD value of what taker is offering */
  takerOfferValueUsd: number | null;
  /**
   * Signed deviation of deal vs market:
   * positive → maker overpays (taker-favored)
   * negative → taker overpays (maker-favored)
   */
  deviationPct: number | null;
}

export interface ArbiterVerdict {
  dealId: string;
  timestamp: string;
  verdict: Verdict;
  /** 0–100. 100 = perfectly balanced deal, 0 = extreme imbalance or blocked. */
  fairnessScore: number;
  makerScan: WalletScan;
  takerScan: WalletScan;
  fairness: FairnessData;
  risks: RiskFlag[];
  reasoning: string[];
  /** True when the arbiter determined execution must be blocked regardless of user override. */
  executionBlocked: boolean;
  /** Arbiter's onchain identity on X Layer (chainIndex 196) */
  arbiterAddress: string;
  /** SHA-256 of the canonical verdict payload — reproducible by any verifier */
  verdictHash: string;
  /** EIP-191 signature from the arbiter wallet. null if signing failed. */
  arbiterSignature: string | null;
  /** ISO timestamp of when the signature was produced. null if signing failed. */
  signedAt: string | null;
  /** Whether the X Layer signing step succeeded */
  signatureVerified: boolean;
}

// ---------------------------------------------------------------------------
// CLI runner — returns typed result or null on failure
// ---------------------------------------------------------------------------

async function run<T>(
  label: string,
  cmd: string
): Promise<OnchanosResult<T>> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB — large portfolios can exceed 1 MB default
    });

    if (stderr?.trim()) {
      // onchainos writes progress info to stderr — not always an error
    }

    const raw = JSON.parse(stdout.trim()) as OnchanosResult<T>;
    return raw;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    let errorMsg = e.message ?? "unknown error";

    // Try to extract JSON error from stdout
    if (e.stdout?.trim()) {
      try {
        const parsed = JSON.parse(e.stdout.trim()) as { ok: boolean; error?: string };
        if (parsed.error) errorMsg = parsed.error;
      } catch {
        // not JSON, use raw
      }
    }

    console.error(`  [${label}] FAILED: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Risk level computation — mirrors risk-token-detection.md exactly
// ---------------------------------------------------------------------------

interface ComputedRisk {
  level: 1 | 2 | 3 | 4;
  action: "safe" | "warn" | "block";
  triggeredLabels: string[];
}

function computeTokenRisk(token: SecurityToken | null): ComputedRisk {
  if (!token) {
    return { level: 1, action: "safe", triggeredLabels: [] };
  }

  if (!token.isChainSupported) {
    return { level: 1, action: "safe", triggeredLabels: ["chain_unsupported"] };
  }

  const labels: Array<{ label: string; level: 1 | 2 | 3 | 4 }> = [];

  // Level 4
  if (token.isHoneypot)       labels.push({ label: "Honeypot",         level: 4 });
  if (token.isRubbishAirdrop) labels.push({ label: "Garbage Airdrop",  level: 4 });
  if (token.isAirdropScam)    labels.push({ label: "Gas Mint Scam",    level: 4 });

  // Level 3
  if (token.isLowLiquidity)          labels.push({ label: "Low Liquidity",         level: 3 });
  if (token.isDumping)               labels.push({ label: "Dumping",               level: 3 });
  if (token.isLiquidityRemoval)      labels.push({ label: "Liquidity Removal",     level: 3 });
  if (token.isPump)                  labels.push({ label: "Pump",                  level: 3 });
  if (token.isWash)                  labels.push({ label: "Wash Trading",          level: 3 });
  if (token.isFakeLiquidity)         labels.push({ label: "Fake Liquidity",        level: 3 });
  if (token.isWash2)                 labels.push({ label: "Wash Trading v2",       level: 3 });
  if (token.isFundLinkage)           labels.push({ label: "Rugpull Gang",          level: 3 });
  if (token.isVeryLowLpBurn)         labels.push({ label: "Very Low LP Burn",      level: 3 });
  if (token.isVeryHighLpHolderProp)  labels.push({ label: "LP Concentration",      level: 3 });
  if (token.isHasBlockingHis)        labels.push({ label: "Has Blocking History",  level: 3 });
  if (token.isOverIssued)            labels.push({ label: "Over Issued",           level: 3 });
  if (token.isCounterfeit)           labels.push({ label: "Counterfeit",           level: 3 });
  // isHasAssetEditAuth is Level 3 only on Solana (chainId 501)
  if ((token as unknown as Record<string, unknown>)["isHasAssetEditAuth"] && token.chainId === "501") {
    labels.push({ label: "Privileged Address", level: 3 });
  }

  // Level 2
  if (token.isMintable)     labels.push({ label: "Mintable",           level: 2 });
  if (token.isHasFrozenAuth) labels.push({ label: "Has Freeze Auth",   level: 2 });
  if (token.isNotRenounced) labels.push({ label: "Not Renounced",      level: 2 });

  // Tax thresholds (direction-agnostic — both taxes contribute to level)
  const buyTax  = token.buyTaxes  != null ? parseFloat(token.buyTaxes)  : null;
  const sellTax = token.sellTaxes != null ? parseFloat(token.sellTaxes) : null;

  for (const [label, tax] of [["Buy Tax", buyTax], ["Sell Tax", sellTax]] as const) {
    if (tax == null || isNaN(tax)) continue;
    if (tax >= 50)       labels.push({ label: `${label} ${tax}%`, level: 4 });
    else if (tax >= 21)  labels.push({ label: `${label} ${tax}%`, level: 3 });
    else if (tax > 0)    labels.push({ label: `${label} ${tax}%`, level: 2 });
  }

  // Effective level = max across all triggered labels
  let effectiveLevel: 1 | 2 | 3 | 4 = 1;
  for (const { level } of labels) {
    if (level > effectiveLevel) effectiveLevel = level as 1 | 2 | 3 | 4;
  }

  // Fallback: isRiskToken=true but no specific labels → promote to Level 2
  if (effectiveLevel === 1 && token.isRiskToken) {
    effectiveLevel = 2;
    labels.push({ label: "Risk flagged by API (isRiskToken)", level: 2 });
  }

  const action: "safe" | "warn" | "block" =
    effectiveLevel === 4 ? "block" :
    effectiveLevel >= 2  ? "warn"  :
    "safe";

  return {
    level: effectiveLevel,
    action,
    triggeredLabels: labels.map((l) => `[L${l.level}] ${l.label}`),
  };
}

// ---------------------------------------------------------------------------
// Balance lookup — find a specific token in a portfolio response
// ---------------------------------------------------------------------------

function findToken(
  assets: PortfolioToken[] | undefined,
  tokenAddress: string,
  chain: string
): PortfolioToken | null {
  if (!assets?.length) return null;

  const idx = chainIndex(chain);
  const addrLower = tokenAddress.toLowerCase();

  return (
    assets.find(
      (t) =>
        t.chainIndex === idx &&
        t.tokenContractAddress.toLowerCase() === addrLower
    ) ?? null
  );
}

function hasEnough(balance: string, required: string): boolean {
  // Both are in UI units (e.g. "1.5"). Parse as floats — safe for display-level comparison.
  const b = parseFloat(balance);
  const r = parseFloat(required);
  if (isNaN(b) || isNaN(r)) return false;
  return b >= r;
}

// ---------------------------------------------------------------------------
// Fairness scoring — 0–100
// ---------------------------------------------------------------------------

function computeFairnessScore(deviationPct: number | null): number {
  if (deviationPct === null) return 50; // unknown → neutral
  const abs = Math.abs(deviationPct);
  // Linear decay: 0% dev = 100, 100% dev = 0. Clamped.
  return Math.max(0, Math.round(100 - abs));
}

// ---------------------------------------------------------------------------
// Main arbiter function
// ---------------------------------------------------------------------------

export async function runArbiter(deal: DealInput): Promise<ArbiterVerdict> {
  const dealId = randomUUID();
  const timestamp = new Date().toISOString();
  const risks: RiskFlag[] = [];
  const reasoning: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Fire all onchainos calls in parallel
  // -------------------------------------------------------------------------

  const makerChainIdx  = chainIndex(deal.maker.chain);
  const takerChainIdx  = chainIndex(deal.taker.chain);
  const makerHasToken  = deal.maker.tokenAddress !== "";
  const takerHasToken  = deal.taker.tokenAddress !== "";

  const [
    makerPortfolioRes,
    takerPortfolioRes,
    makerSecurityRes,
    takerSecurityRes,
    pricesRes,
  ] = await Promise.all([
    // Portfolio: all balances for each wallet
    run<PortfolioResponse>(
      "maker-portfolio",
      `${BIN} portfolio all-balances --address ${deal.maker.walletAddress} --chains ${deal.maker.chain} --filter 1`
    ),
    run<PortfolioResponse>(
      "taker-portfolio",
      `${BIN} portfolio all-balances --address ${deal.taker.walletAddress} --chains ${deal.taker.chain} --filter 1`
    ),
    // Security: token-scan using chainId:address format (skip native tokens)
    makerHasToken
      ? run<SecurityToken[]>(
          "maker-security",
          `${BIN} security token-scan --tokens "${makerChainIdx}:${deal.maker.tokenAddress}"`
        )
      : Promise.resolve<OnchanosResult<SecurityToken[]>>({ ok: true, data: [] }),
    takerHasToken
      ? run<SecurityToken[]>(
          "taker-security",
          `${BIN} security token-scan --tokens "${takerChainIdx}:${deal.taker.tokenAddress}"`
        )
      : Promise.resolve<OnchanosResult<SecurityToken[]>>({ ok: true, data: [] }),
    // Prices: batch call for both tokens (skip native tokens)
    (makerHasToken || takerHasToken)
      ? run<PriceData[]>(
          "prices",
          (() => {
            const tokens: string[] = [];
            if (makerHasToken) tokens.push(`${makerChainIdx}:${deal.maker.tokenAddress}`);
            if (takerHasToken) tokens.push(`${takerChainIdx}:${deal.taker.tokenAddress}`);
            return `${BIN} market prices --tokens "${tokens.join(",")}"`;
          })()
        )
      : Promise.resolve<OnchanosResult<PriceData[]>>({ ok: true, data: [] }),
  ]);

  // -------------------------------------------------------------------------
  // Step 2: Parse portfolio — extract target token balance for each leg
  // -------------------------------------------------------------------------

  const makerAssets = makerPortfolioRes.data?.[0]?.tokenAssets;
  const takerAssets = takerPortfolioRes.data?.[0]?.tokenAssets;

  const makerToken = makerHasToken
    ? findToken(makerAssets, deal.maker.tokenAddress, deal.maker.chain)
    : null;

  const takerToken = takerHasToken
    ? findToken(takerAssets, deal.taker.tokenAddress, deal.taker.chain)
    : null;

  const makerBalance   = makerToken?.balance   ?? (makerPortfolioRes.ok ? "0" : null);
  const takerBalance   = takerToken?.balance   ?? (takerPortfolioRes.ok ? "0" : null);
  const makerSymbol    = makerToken?.symbol    ?? deal.maker.symbol ?? deal.maker.tokenAddress.slice(0, 8);
  const takerSymbol    = takerToken?.symbol    ?? deal.taker.symbol ?? deal.taker.tokenAddress.slice(0, 8);

  const makerHasFunds  = makerBalance !== null && hasEnough(makerBalance, deal.maker.amount);
  const takerHasFunds  = takerBalance !== null && hasEnough(takerBalance, deal.taker.amount);

  // -------------------------------------------------------------------------
  // Step 3: Parse security scans
  // -------------------------------------------------------------------------

  const makerSecToken = makerHasToken
    ? (makerSecurityRes.data?.[0] ?? null)
    : null;

  const takerSecToken = takerHasToken
    ? (takerSecurityRes.data?.[0] ?? null)
    : null;

  const makerRisk = computeTokenRisk(makerSecToken);
  const takerRisk = computeTokenRisk(takerSecToken);

  // -------------------------------------------------------------------------
  // Step 4: Parse prices → fairness
  // -------------------------------------------------------------------------

  const priceList = pricesRes.data ?? [];

  function findPrice(tokenAddr: string, cIdx: string): string | null {
    const addrLower = tokenAddr.toLowerCase();
    return (
      priceList.find(
        (p) => p.chainIndex === cIdx && p.tokenContractAddress.toLowerCase() === addrLower
      )?.price ?? null
    );
  }

  const makerPriceStr = makerHasToken ? findPrice(deal.maker.tokenAddress, makerChainIdx) : null;
  const takerPriceStr = takerHasToken ? findPrice(deal.taker.tokenAddress, takerChainIdx) : null;
  const makerPriceUsd = makerPriceStr ? parseFloat(makerPriceStr) : null;
  const takerPriceUsd = takerPriceStr ? parseFloat(takerPriceStr) : null;

  const makerOfferUsd = (makerPriceUsd !== null)
    ? makerPriceUsd * parseFloat(deal.maker.amount)
    : null;
  const takerOfferUsd = (takerPriceUsd !== null)
    ? takerPriceUsd * parseFloat(deal.taker.amount)
    : null;

  // deviationPct: how much maker is over/under-paying relative to market
  // +ve = maker pays more = taker-favored
  // -ve = taker pays more = maker-favored
  let deviationPct: number | null = null;
  if (makerOfferUsd !== null && takerOfferUsd !== null && takerOfferUsd > 0) {
    deviationPct = ((makerOfferUsd - takerOfferUsd) / takerOfferUsd) * 100;
  }

  // -------------------------------------------------------------------------
  // Step 5: Collect risks and build reasoning
  // -------------------------------------------------------------------------

  // Balance sufficiency
  if (!makerPortfolioRes.ok) {
    risks.push({ code: "MAKER_PORTFOLIO_FAIL", severity: "high", message: "Could not verify maker wallet balance", party: "maker" });
    reasoning.push("Maker portfolio check failed — balance unverified.");
  } else if (!makerHasFunds) {
    risks.push({ code: "MAKER_INSUFFICIENT_BALANCE", severity: "critical", message: `Maker wallet holds ${makerBalance ?? "0"} ${makerSymbol}, deal requires ${deal.maker.amount}`, party: "maker" });
    reasoning.push(`REJECT: Maker holds insufficient ${makerSymbol} (${makerBalance ?? "0"} < ${deal.maker.amount} required).`);
  } else {
    reasoning.push(`Maker balance confirmed: ${makerBalance} ${makerSymbol} ≥ ${deal.maker.amount} required.`);
  }

  if (!takerPortfolioRes.ok) {
    risks.push({ code: "TAKER_PORTFOLIO_FAIL", severity: "high", message: "Could not verify taker wallet balance", party: "taker" });
    reasoning.push("Taker portfolio check failed — balance unverified.");
  } else if (!takerHasFunds) {
    risks.push({ code: "TAKER_INSUFFICIENT_BALANCE", severity: "critical", message: `Taker wallet holds ${takerBalance ?? "0"} ${takerSymbol}, deal requires ${deal.taker.amount}`, party: "taker" });
    reasoning.push(`REJECT: Taker holds insufficient ${takerSymbol} (${takerBalance ?? "0"} < ${deal.taker.amount} required).`);
  } else {
    reasoning.push(`Taker balance confirmed: ${takerBalance} ${takerSymbol} ≥ ${deal.taker.amount} required.`);
  }

  // Security — maker token
  if (!makerHasToken) {
    reasoning.push(`Maker offers native token on ${deal.maker.chain} — security scan not applicable.`);
  } else if (!makerSecurityRes.ok) {
    risks.push({ code: "MAKER_SECURITY_SCAN_FAIL", severity: "medium", message: "Security scan unavailable for maker token", party: "maker" });
    reasoning.push("Maker token security scan failed — proceeding with caution.");
  } else {
    for (const label of makerRisk.triggeredLabels) {
      risks.push({ code: `MAKER_TOKEN_${label.replace(/\s+/g, "_").toUpperCase()}`, severity: makerRisk.level === 4 ? "critical" : makerRisk.level === 3 ? "high" : "medium", message: `Maker token: ${label}`, party: "maker" });
    }
    if (makerRisk.level >= 3) {
      reasoning.push(`WARN: Maker token has risk level ${makerRisk.level} — ${makerRisk.triggeredLabels.join(", ")}`);
    } else {
      reasoning.push(`Maker token security: Level ${makerRisk.level} (${makerRisk.action}).`);
    }
  }

  // Security — taker token
  if (!takerHasToken) {
    reasoning.push(`Taker offers native token on ${deal.taker.chain} — security scan not applicable.`);
  } else if (!takerSecurityRes.ok) {
    risks.push({ code: "TAKER_SECURITY_SCAN_FAIL", severity: "medium", message: "Security scan unavailable for taker token", party: "taker" });
    reasoning.push("Taker token security scan failed — proceeding with caution.");
  } else {
    for (const label of takerRisk.triggeredLabels) {
      risks.push({ code: `TAKER_TOKEN_${label.replace(/\s+/g, "_").toUpperCase()}`, severity: takerRisk.level === 4 ? "critical" : takerRisk.level === 3 ? "high" : "medium", message: `Taker token: ${label}`, party: "taker" });
    }
    if (takerRisk.level >= 3) {
      reasoning.push(`WARN: Taker token has risk level ${takerRisk.level} — ${takerRisk.triggeredLabels.join(", ")}`);
    } else {
      reasoning.push(`Taker token security: Level ${takerRisk.level} (${takerRisk.action}).`);
    }
  }

  // Fairness
  if (deviationPct === null) {
    risks.push({ code: "PRICE_UNAVAILABLE", severity: "low", message: "Could not retrieve live market prices — fairness unverified", party: "both" });
    reasoning.push("Market prices unavailable — fairness score estimated.");
  } else {
    const abs = Math.abs(deviationPct);
    const direction = deviationPct > 0 ? "taker-favored" : "maker-favored";
    if (abs > 50) {
      risks.push({ code: "EXTREME_PRICE_DEVIATION", severity: "critical", message: `Deal value deviates ${abs.toFixed(1)}% from market (${direction})`, party: "both" });
      reasoning.push(`REJECT: Deal is ${abs.toFixed(1)}% off market rate (${direction}) — possible manipulation.`);
    } else if (abs > 20) {
      risks.push({ code: "HIGH_PRICE_DEVIATION", severity: "high", message: `Deal value deviates ${abs.toFixed(1)}% from market (${direction})`, party: "both" });
      reasoning.push(`WARN: Deal is ${abs.toFixed(1)}% off market rate (${direction}).`);
    } else if (abs > 5) {
      risks.push({ code: "MODERATE_PRICE_DEVIATION", severity: "medium", message: `Deal value deviates ${abs.toFixed(1)}% from market (${direction})`, party: "both" });
      reasoning.push(`Note: Deal is ${abs.toFixed(1)}% off market rate (${direction}) — within normal OTC range.`);
    } else {
      reasoning.push(`Fairness: Deal is within ${abs.toFixed(1)}% of market rate — acceptable.`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Determine verdict
  // -------------------------------------------------------------------------

  const hasBlock =
    !makerHasFunds ||
    !takerHasFunds ||
    makerRisk.action === "block" ||
    takerRisk.action === "block" ||
    (deviationPct !== null && Math.abs(deviationPct) > 50);

  const hasWarn =
    !makerPortfolioRes.ok ||
    !takerPortfolioRes.ok ||
    makerRisk.action === "warn" ||
    takerRisk.action === "warn" ||
    (deviationPct !== null && Math.abs(deviationPct) > 20) ||
    risks.some((r) => r.severity === "high");

  const verdict: Verdict = hasBlock ? "REJECT" : hasWarn ? "WARN" : "APPROVE";

  if (verdict === "APPROVE") {
    reasoning.push("APPROVE: Both wallets sufficiently funded, tokens pass security checks, deal price is within acceptable range.");
  } else if (verdict === "REJECT") {
    reasoning.push("REJECT: One or more blocking conditions — see risks above.");
  } else {
    reasoning.push("WARN: Deal can proceed but requires manual review of flagged items above.");
  }

  const fairnessScore = hasBlock ? 0 : computeFairnessScore(deviationPct);

  // -------------------------------------------------------------------------
  // Step 7: Assemble verdict
  // -------------------------------------------------------------------------

  const baseVerdict: Omit<ArbiterVerdict, "arbiterAddress" | "verdictHash" | "arbiterSignature" | "signedAt" | "signatureVerified"> = {
    dealId,
    timestamp,
    verdict,
    fairnessScore,
    makerScan: {
      address: deal.maker.walletAddress,
      chain: deal.maker.chain,
      tokenAddress: deal.maker.tokenAddress,
      tokenSymbol: makerSymbol,
      requiredAmount: deal.maker.amount,
      confirmedBalance: makerBalance ?? "unavailable",
      hasRequiredBalance: makerHasFunds,
      tokenRiskLevel: makerHasToken ? makerRisk.level : null,
      tokenRiskAction: makerHasToken ? makerRisk.action : "unscannable",
      triggeredLabels: makerRisk.triggeredLabels,
    },
    takerScan: {
      address: deal.taker.walletAddress,
      chain: deal.taker.chain,
      tokenAddress: deal.taker.tokenAddress,
      tokenSymbol: takerSymbol,
      requiredAmount: deal.taker.amount,
      confirmedBalance: takerBalance ?? "unavailable",
      hasRequiredBalance: takerHasFunds,
      tokenRiskLevel: takerHasToken ? takerRisk.level : null,
      tokenRiskAction: takerHasToken ? takerRisk.action : "unscannable",
      triggeredLabels: takerRisk.triggeredLabels,
    },
    fairness: {
      makerTokenPriceUsd: makerPriceStr,
      takerTokenPriceUsd: takerPriceStr,
      makerOfferValueUsd: makerOfferUsd,
      takerOfferValueUsd: takerOfferUsd,
      deviationPct,
    },
    risks,
    reasoning,
    executionBlocked: hasBlock,
  };

  // -------------------------------------------------------------------------
  // Step 8: Sign verdict on X Layer — non-blocking, never withholds verdict
  // -------------------------------------------------------------------------

  const signingPayload: VerdictPayload = {
    dealId,
    timestamp,
    verdict,
    fairnessScore,
    executionBlocked: hasBlock,
    makerAddress: deal.maker.walletAddress,
    takerAddress: deal.taker.walletAddress,
  };

  const signingOutcome = await signVerdict(signingPayload);

  return {
    ...baseVerdict,
    arbiterAddress: ARBITER_ADDRESS,
    verdictHash: signingOutcome.verdictHash,
    arbiterSignature: signingOutcome.success ? signingOutcome.signature : null,
    signedAt: signingOutcome.signedAt,
    signatureVerified: signingOutcome.success,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — run directly: npx tsx src/agent/arbiter.ts
// ---------------------------------------------------------------------------

if (require.main === module) {
  const sampleDeal: DealInput = {
    maker: {
      walletAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      tokenAddress:  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
      amount:        "500",
      chain:         "ethereum",
      symbol:        "USDC",
    },
    taker: {
      walletAddress: "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",
      tokenAddress:  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
      amount:        "498",
      chain:         "ethereum",
      symbol:        "USDT",
    },
  };

  console.log("Running arbiter on sample deal...\n");
  runArbiter(sampleDeal)
    .then((verdict) => {
      console.log(JSON.stringify(verdict, null, 2));
      process.exit(verdict.executionBlocked ? 1 : 0);
    })
    .catch((err) => {
      console.error("Arbiter error:", err);
      process.exit(1);
    });
}
