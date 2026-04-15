/**
 * POST /api/arbiter/run
 *
 * Delegates to the canonical runArbiter() function in src/agent/arbiter.ts.
 * Adapts the ArbiterVerdict output to the shape the arbiter page expects,
 * and appends X Layer signature fields from the wallet signing step.
 */

import { NextRequest, NextResponse } from "next/server";
import { runArbiter, type DealInput } from "@/agent/arbiter";

interface DealRequest {
  makerAddress: string;
  takerAddress: string;
  makerToken: { symbol: string; address: string; amount: number };
  takerToken: { symbol: string; address: string; amount: number };
  chain: string;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  let body: DealRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { makerAddress, takerAddress, makerToken, takerToken, chain } = body;
  if (!makerAddress || !takerAddress || !makerToken || !takerToken) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const dealInput: DealInput = {
    maker: {
      walletAddress: makerAddress,
      tokenAddress: makerToken.address,
      amount: String(makerToken.amount),
      chain: chain ?? "ethereum",
      symbol: makerToken.symbol,
    },
    taker: {
      walletAddress: takerAddress,
      tokenAddress: takerToken.address,
      amount: String(takerToken.amount),
      chain: chain ?? "ethereum",
      symbol: takerToken.symbol,
    },
  };

  let verdict;
  try {
    verdict = await runArbiter(dealInput);
  } catch (err: unknown) {
    const e = err as { message?: string };
    return NextResponse.json({ error: e.message ?? "Arbiter failed" }, { status: 500 });
  }

  const elapsed = Date.now() - startTime;

  // ── Map ArbiterVerdict → page-expected shape ───────────────────────────────

  const makerRisky = (verdict.makerScan.tokenRiskLevel ?? 0) >= 3;
  const takerRisky = (verdict.takerScan.tokenRiskLevel ?? 0) >= 3;

  const makerRiskLabel =
    verdict.makerScan.tokenRiskAction === "block" ? "BLOCK — critical risk" :
    verdict.makerScan.tokenRiskAction === "warn"  ? `WARN — ${verdict.makerScan.triggeredLabels[0] ?? "risk flagged"}` :
    "Safe";

  const takerRiskLabel =
    verdict.takerScan.tokenRiskAction === "block" ? "BLOCK — critical risk" :
    verdict.takerScan.tokenRiskAction === "warn"  ? `WARN — ${verdict.takerScan.triggeredLabels[0] ?? "risk flagged"}` :
    "Safe";

  const deviationAbs = Math.abs(verdict.fairness.deviationPct ?? 0);
  const deviationDir = (verdict.fairness.deviationPct ?? 0) >= 0 ? "taker-favored" : "maker-favored";

  const criticalRisks = verdict.risks.filter((r) => r.severity === "critical").length;

  const verdictReason = verdict.reasoning[verdict.reasoning.length - 1] ?? "";

  return NextResponse.json({
    dealId: verdict.dealId,
    verdict: verdict.verdict,
    approved: !verdict.executionBlocked,
    elapsed,
    steps: {
      walletScan: {
        maker: {
          address: verdict.makerScan.address,
          tokenHeld: `${verdict.makerScan.confirmedBalance} ${verdict.makerScan.tokenSymbol}`,
          required: `${verdict.makerScan.requiredAmount} ${verdict.makerScan.tokenSymbol}`,
          pass: verdict.makerScan.hasRequiredBalance,
        },
        taker: {
          address: verdict.takerScan.address,
          tokenHeld: `${verdict.takerScan.confirmedBalance} ${verdict.takerScan.tokenSymbol}`,
          required: `${verdict.takerScan.requiredAmount} ${verdict.takerScan.tokenSymbol}`,
          pass: verdict.takerScan.hasRequiredBalance,
        },
      },
      securityScan: {
        makerToken: {
          symbol: verdict.makerScan.tokenSymbol,
          address: verdict.makerScan.tokenAddress,
          risky: makerRisky,
          label: makerRiskLabel,
        },
        takerToken: {
          symbol: verdict.takerScan.tokenSymbol,
          address: verdict.takerScan.tokenAddress,
          risky: takerRisky,
          label: takerRiskLabel,
        },
      },
      priceCheck: {
        makerTokenPrice: verdict.fairness.makerTokenPriceUsd
          ? parseFloat(verdict.fairness.makerTokenPriceUsd)
          : null,
        takerTokenPrice: verdict.fairness.takerTokenPriceUsd
          ? parseFloat(verdict.fairness.takerTokenPriceUsd)
          : null,
        makerUsd: parseFloat((verdict.fairness.makerOfferValueUsd ?? 0).toFixed(2)),
        takerUsd: parseFloat((verdict.fairness.takerOfferValueUsd ?? 0).toFixed(2)),
        deviation: parseFloat(deviationAbs.toFixed(2)),
        deviationDirection: deviationDir,
        fairnessScore: verdict.fairnessScore,
      },
      verdict: {
        decision: verdict.verdict,
        fairnessScore: verdict.fairnessScore,
        criticalRisks,
        totalRisks: verdict.risks.length,
        risks: verdict.risks.map((r) => ({ severity: r.severity, message: r.message })),
        reason: verdictReason,
      },
    },
    skillsUsed: 5,
    // X Layer arbiter identity + signature
    arbiterAddress: verdict.arbiterAddress,
    verdictHash: verdict.verdictHash,
    arbiterSignature: verdict.arbiterSignature,
    signedAt: verdict.signedAt,
    signatureVerified: verdict.signatureVerified,
  });
}
