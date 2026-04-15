"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = "complete" | "active" | "pending";
type Flag = "warn" | "ok" | "block" | undefined;

interface ArbiterResult {
  dealId: string;
  verdict: "APPROVE" | "REJECT";
  approved: boolean;
  elapsed: number;
  steps: {
    walletScan: {
      maker: { address: string; tokenHeld: string; required: string; pass: boolean };
      taker: { address: string; tokenHeld: string; required: string; pass: boolean };
    };
    securityScan: {
      makerToken: { symbol: string; risky: boolean; label: string };
      takerToken: { symbol: string; risky: boolean; label: string };
    };
    priceCheck: {
      makerTokenPrice: number | null;
      takerTokenPrice: number | null;
      makerUsd: number;
      takerUsd: number;
      deviation: number;
      deviationDirection: string;
      fairnessScore: number;
    };
    verdict: {
      decision: string;
      fairnessScore: number;
      criticalRisks: number;
      totalRisks: number;
      risks: Array<{ severity: string; message: string }>;
      reason: string;
    };
  };
  skillsUsed: number;
}

// ── Hard-coded deal (replace with context/state in prod) ──────────────────────
const DEAL = {
  makerAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  takerAddress: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
  makerToken: {
    symbol: "USDC",
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    amount: 1000,
  },
  takerToken: {
    symbol: "WETH",
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    amount: 0.4,
  },
  chain: "ethereum",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StepDot({ status }: { status: StepStatus }) {
  return (
    <div
      className={`w-2 h-2 rounded-full border mt-0.5 ${
        status === "complete"
          ? "bg-success border-success"
          : status === "active"
          ? "bg-accent border-accent animate-pulse"
          : "bg-bg border-border"
      }`}
    />
  );
}

function DetailRow({
  label,
  value,
  flag,
}: {
  label: string;
  value: string;
  flag?: Flag;
}) {
  const cls =
    flag === "warn"
      ? "text-accent"
      : flag === "block"
      ? "text-danger"
      : flag === "ok"
      ? "text-success"
      : "text-text";
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="font-mono text-xs text-textMuted">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

function TimelineStep({
  index,
  status,
  label,
  statusLabel,
  details,
  last = false,
}: {
  index: number;
  status: StepStatus;
  label: string;
  statusLabel: string;
  details: Array<{ key: string; value: string; flag?: Flag }>;
  last?: boolean;
}) {
  const statusColor =
    status === "complete"
      ? "text-success"
      : status === "active"
      ? "text-accent"
      : "text-textMuted";

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center w-2 shrink-0">
        <StepDot status={status} />
        {!last && (
          <div className="w-px mt-1 flex-1 min-h-8" style={{ background: "var(--color-border)" }} />
        )}
      </div>
      <div className={`flex-1 ${last ? "" : "pb-6"}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-textMuted w-4">
              {String(index).padStart(2, "0")}
            </span>
            <span className="font-ui text-sm text-text">{label}</span>
          </div>
          <span className={`font-mono text-xs ${statusColor}`}>
            {status === "complete" ? "✓" : status === "active" ? "●" : "—"} {statusLabel}
          </span>
        </div>
        <div className="bg-surface border border-border rounded-card divide-y divide-border">
          {details.map((d) => (
            <DetailRow key={d.key} label={d.key} value={d.value} flag={d.flag} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonStep({ index }: { index: number }) {
  return (
    <div className="flex gap-4 pb-6">
      <div className="flex flex-col items-center w-2 shrink-0">
        <div className="w-2 h-2 rounded-full border border-border bg-bg mt-0.5 animate-pulse" />
        <div className="w-px mt-1 flex-1 min-h-8" style={{ background: "var(--color-border)" }} />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-textMuted w-4">
              {String(index).padStart(2, "0")}
            </span>
            <div className="h-4 w-28 rounded bg-surface animate-pulse" />
          </div>
          <div className="h-3 w-16 rounded bg-surface animate-pulse" />
        </div>
        <div className="bg-surface border border-border rounded-card divide-y divide-border">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2">
              <div className="h-3 w-32 rounded bg-border animate-pulse" />
              <div className="h-3 w-20 rounded bg-border animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ArbiterPage() {
  const [result, setResult] = useState<ArbiterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function runArbiter() {
      setLoading(true);
      setError(null);
      setActiveStep(1);

      // Animate step progression while waiting
      const stepTimer = setInterval(() => {
        setActiveStep((s) => (s < 4 ? s + 1 : s));
      }, 800);

      try {
        const res = await fetch("/api/arbiter/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(DEAL),
        });

        clearInterval(stepTimer);

        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data: ArbiterResult = await res.json();

        if (!cancelled) {
          setResult(data);
          setActiveStep(5); // all complete
          setLoading(false);

          // Write to audit log
          await fetch("/api/audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dealId: data.dealId,
              createdAt: new Date().toISOString(),
              makerAddress: DEAL.makerAddress,
              takerAddress: DEAL.takerAddress,
              deal: `${DEAL.makerToken.amount.toLocaleString()} ${DEAL.makerToken.symbol} ↔ ${DEAL.takerToken.amount} ${DEAL.takerToken.symbol}`,
              verdict: data.verdict,
              fairnessScore: data.steps.verdict.fairnessScore,
              criticalRisks: data.steps.verdict.criticalRisks,
              elapsed: data.elapsed,
              events: [
                { timeUtc: new Date().toISOString(), event: "Arbiter session initialized", status: "OK" },
                {
                  timeUtc: new Date().toISOString(),
                  event: `Security: ${DEAL.makerToken.symbol} token scan`,
                  status: data.steps.securityScan.makerToken.risky ? "WARN" : "OK",
                },
                {
                  timeUtc: new Date().toISOString(),
                  event: `Verdict issued: ${data.verdict}`,
                  status: data.approved ? "OK" : "FAIL",
                },
              ],
            }),
          });
        }
      } catch (err: unknown) {
        clearInterval(stepTimer);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      }
    }

    runArbiter();
    return () => { cancelled = true; };
  }, []);

  // ── Derived display data ───────────────────────────────────────────────────

  const stepStatus = (step: number): StepStatus => {
    if (loading) {
      if (step < activeStep) return "complete";
      if (step === activeStep) return "active";
      return "pending";
    }
    return "complete";
  };

  const walletDetails = result
    ? [
        {
          key: `Maker · ${result.steps.walletScan.maker.address.slice(0, 6)}...${result.steps.walletScan.maker.address.slice(-5)}`,
          value: `${result.steps.walletScan.maker.tokenHeld} (needs ${result.steps.walletScan.maker.required})`,
          flag: (result.steps.walletScan.maker.pass ? "ok" : "block") as Flag,
        },
        {
          key: `Taker · ${result.steps.walletScan.taker.address.slice(0, 6)}...${result.steps.walletScan.taker.address.slice(-5)}`,
          value: `${result.steps.walletScan.taker.tokenHeld} (needs ${result.steps.walletScan.taker.required})`,
          flag: (result.steps.walletScan.taker.pass ? "ok" : "block") as Flag,
        },
      ]
    : [
        { key: "Maker wallet", value: "Scanning...", flag: undefined },
        { key: "Taker wallet", value: "Scanning...", flag: undefined },
      ];

  const securityDetails = result
    ? [
        {
          key: `${result.steps.securityScan.makerToken.symbol} contract`,
          value: result.steps.securityScan.makerToken.label,
          flag: (result.steps.securityScan.makerToken.risky ? "warn" : "ok") as Flag,
        },
        {
          key: `${result.steps.securityScan.takerToken.symbol} contract`,
          value: result.steps.securityScan.takerToken.label,
          flag: (result.steps.securityScan.takerToken.risky ? "warn" : "ok") as Flag,
        },
      ]
    : [
        { key: "Maker token", value: "Scanning...", flag: undefined },
        { key: "Taker token", value: "Scanning...", flag: undefined },
      ];

  const priceDetails = result
    ? [
        { key: `${DEAL.makerToken.symbol} price`, value: result.steps.priceCheck.makerTokenPrice ? `$${result.steps.priceCheck.makerTokenPrice.toFixed(4)}` : "n/a" },
        { key: `${DEAL.takerToken.symbol} price`, value: result.steps.priceCheck.takerTokenPrice ? `$${result.steps.priceCheck.takerTokenPrice.toFixed(2)}` : "n/a" },
        { key: "Maker offer value", value: `$${result.steps.priceCheck.makerUsd.toLocaleString()}` },
        { key: "Taker offer value", value: `$${result.steps.priceCheck.takerUsd.toLocaleString()}` },
        {
          key: "Deviation",
          value: `+${result.steps.priceCheck.deviation}% (${result.steps.priceCheck.deviationDirection})`,
          flag: (result.steps.priceCheck.deviation > 10 ? "warn" : "ok") as Flag,
        },
      ]
    : [
        { key: "Fetching prices", value: "...", flag: undefined },
      ];

  const verdictDetails = result
    ? [
        {
          key: "Balance check",
          value: result.steps.walletScan.maker.pass && result.steps.walletScan.taker.pass
            ? "PASS — both wallets funded"
            : "FAILED — insufficient balance",
          flag: (result.steps.walletScan.maker.pass && result.steps.walletScan.taker.pass ? "ok" : "block") as Flag,
        },
        {
          key: "Token security",
          value: result.steps.securityScan.makerToken.risky || result.steps.securityScan.takerToken.risky
            ? "WARN — token flagged"
            : "PASS — tokens safe",
          flag: (result.steps.securityScan.makerToken.risky || result.steps.securityScan.takerToken.risky ? "warn" : "ok") as Flag,
        },
        {
          key: "Price fairness",
          value: `${result.steps.priceCheck.deviation <= 15 ? "PASS" : "WARN"} — ${result.steps.priceCheck.deviation}% deviation`,
          flag: (result.steps.priceCheck.deviation <= 15 ? "ok" : "warn") as Flag,
        },
        {
          key: "Final verdict",
          value: result.verdict,
          flag: (result.approved ? "ok" : "block") as Flag,
        },
      ]
    : [{ key: "Computing verdict", value: "...", flag: undefined }];

  const isApproved = result?.approved ?? false;
  const verdictColor = isApproved ? "border-success" : "border-danger";
  const verdictTextColor = isApproved ? "text-success" : "text-danger";
  const dotColor = isApproved ? "bg-success" : "bg-danger";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell step={3}>
      <div className="h-9 flex items-center justify-between px-6 border-b border-border">
        <span className="font-mono text-xs text-textMuted tracking-[0.12em]">
          AI ARBITER — {loading ? "EVALUATING DEAL" : `VERDICT: ${result?.verdict ?? "ERROR"}`}
        </span>
        <span className="font-mono text-xs text-textMuted">
          {result ? `Deal #${result.dealId}` : "Processing..."}
        </span>
      </div>

      <div className="flex flex-col gap-6 p-6 max-w-3xl w-full mx-auto">
        {/* Deal summary banner */}
        <div className="bg-surface border border-border rounded-card px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-xs text-textMuted">Maker</span>
              <span className="font-mono text-sm text-text tabular-nums">
                {DEAL.makerToken.amount.toLocaleString()} {DEAL.makerToken.symbol}
              </span>
            </div>
            <span className="font-mono text-textMuted">↔</span>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-xs text-textMuted">Taker</span>
              <span className="font-mono text-sm text-text tabular-nums">
                {DEAL.takerToken.amount} {DEAL.takerToken.symbol}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-textMuted">Fairness</span>
            {loading ? (
              <div className="h-4 w-16 rounded bg-surface animate-pulse" />
            ) : (
              <span className="font-mono text-sm text-accent tabular-nums">
                {result?.steps.verdict.fairnessScore ?? 0} / 100
              </span>
            )}
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-surface border border-danger rounded-card px-5 py-4">
            <span className="font-mono text-xs text-danger">Error: {error}</span>
          </div>
        )}

        {/* Timeline */}
        <div className="flex flex-col">
          {loading && !result ? (
            <>
              <SkeletonStep index={1} />
              <SkeletonStep index={2} />
              <SkeletonStep index={3} />
              <SkeletonStep index={4} />
            </>
          ) : (
            <>
              <TimelineStep
                index={1}
                status={stepStatus(1)}
                label="Wallet Scan"
                statusLabel={loading ? "SCANNING" : "COMPLETE"}
                details={walletDetails}
              />
              <TimelineStep
                index={2}
                status={stepStatus(2)}
                label="Security Check"
                statusLabel={loading ? "SCANNING" : "COMPLETE"}
                details={securityDetails}
              />
              <TimelineStep
                index={3}
                status={stepStatus(3)}
                label="Price Check"
                statusLabel={loading ? "FETCHING" : "COMPLETE"}
                details={priceDetails}
              />
              <TimelineStep
                index={4}
                status={stepStatus(4)}
                label="Verdict"
                statusLabel={loading ? "COMPUTING" : result?.verdict ?? "—"}
                last
                details={verdictDetails}
              />
            </>
          )}
        </div>

        {/* Verdict panel */}
        {!loading && result && (
          <div className={`bg-surface border ${verdictColor} rounded-card p-5 flex flex-col gap-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                <span className="font-ui text-sm text-text">Arbiter Verdict</span>
              </div>
              <span className={`font-mono text-sm ${verdictTextColor} tracking-[0.1em]`}>
                {result.verdict}
              </span>
            </div>
            <p className="font-mono text-xs text-textMuted leading-relaxed">
              {result.steps.verdict.reason}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-xs text-textMuted">Fairness score:</span>
              <span className="font-mono text-xs text-accent tabular-nums">
                {result.steps.verdict.fairnessScore} / 100
              </span>
              <span className="font-mono text-xs text-textMuted ml-4">Risks flagged:</span>
              <span className={`font-mono text-xs tabular-nums ${verdictTextColor}`}>
                {result.steps.verdict.criticalRisks} critical
              </span>
              <span className="font-mono text-xs text-textMuted ml-4">Skills used:</span>
              <span className="font-mono text-xs text-text tabular-nums">{result.skillsUsed}</span>
              <span className="font-mono text-xs text-textMuted ml-4">Elapsed:</span>
              <span className="font-mono text-xs text-text tabular-nums">{result.elapsed}ms</span>
            </div>
          </div>
        )}

        {/* Action row */}
        {!loading && (
          <div className="flex items-center justify-between">
            <Link href="/deal">
              <button className="font-mono text-xs text-textMuted tracking-[0.12em] hover:text-text transition-colors duration-fast ease-snappy">
                ← REVISE TERMS
              </button>
            </Link>
            <div className="flex gap-3">
              <Link href="/deal">
                <button className="font-mono text-xs tracking-[0.12em] text-danger border border-danger px-6 py-2.5 rounded-sharp uppercase transition-colors duration-fast ease-snappy hover:bg-danger hover:text-bg">
                  REJECT
                </button>
              </Link>
              <Link href={isApproved ? `/execution?dealId=${result?.dealId}` : "#"}>
                <button
                  className={`font-mono text-xs tracking-[0.15em] px-6 py-2.5 rounded-sharp uppercase transition-opacity duration-fast ease-snappy ${
                    isApproved
                      ? "text-bg bg-accent hover:opacity-80"
                      : "text-textMuted border border-border cursor-not-allowed opacity-40"
                  }`}
                  aria-disabled={!isApproved}
                >
                  APPROVE
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}