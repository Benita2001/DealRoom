import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";

const AUDIT_LOG: Array<{ ts: string; event: string; status: "OK" | "WARN" | "FAIL" }> = [
  { ts: "03:00:14", event: "Arbiter session initialized",          status: "OK"   },
  { ts: "03:00:15", event: "Wallet scan started — 2 wallets",      status: "OK"   },
  { ts: "03:00:16", event: "Portfolio: maker balance fetched",      status: "OK"   },
  { ts: "03:00:16", event: "Portfolio: taker balance fetched",      status: "OK"   },
  { ts: "03:00:17", event: "Security: USDC token scan",            status: "WARN" },
  { ts: "03:00:17", event: "Security: WETH token scan",            status: "OK"   },
  { ts: "03:00:18", event: "Market: prices fetched (batch)",       status: "OK"   },
  { ts: "03:00:18", event: "Fairness computed — deviation +7.5%",  status: "WARN" },
  { ts: "03:00:18", event: "Verdict issued: REJECT",               status: "FAIL" },
  { ts: "03:00:18", event: "Audit log finalized and hashed",       status: "OK"   },
];

function AuditRow({
  ts,
  event,
  status,
}: {
  ts: string;
  event: string;
  status: "OK" | "WARN" | "FAIL";
}) {
  const color =
    status === "OK" ? "text-success" :
    status === "WARN" ? "text-accent" :
    "text-danger";

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-border last:border-0">
      <span className="font-mono text-xs text-textMuted w-16 shrink-0 tabular-nums">
        {ts}
      </span>
      <span className="font-mono text-xs text-text flex-1">{event}</span>
      <span className={`font-mono text-xs w-8 text-right shrink-0 tabular-nums ${color}`}>
        {status}
      </span>
    </div>
  );
}

function StatCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs text-textMuted tracking-[0.1em] uppercase">
        {label}
      </span>
      <span
        className={`font-mono text-md tabular-nums ${
          accent ? "text-accent" : "text-text"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function ExecutionPage() {
  return (
    <AppShell step={4}>
      {/* Sub-header */}
      <div className="h-9 flex items-center justify-between px-6 border-b border-border">
        <span className="font-mono text-xs text-textMuted tracking-[0.12em]">
          EXECUTION RECORD
        </span>
        <span className="font-mono text-xs text-textMuted">
          Deal #2fc7636e · 2026-04-15 03:00 UTC
        </span>
      </div>

      <div className="flex flex-col gap-5 p-6 max-w-3xl w-full mx-auto">
        {/* Verdict banner */}
        <div className="bg-surface border border-danger rounded-card px-5 py-4 flex items-center gap-4">
          <div className="w-3 h-3 rounded-full bg-danger shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="font-ui text-sm text-text">
              Deal Rejected — Execution Blocked
            </span>
            <span className="font-mono text-xs text-textMuted">
              Arbiter found critical balance deficiency in both wallets.
            </span>
          </div>
          <span className="font-mono text-lg text-danger ml-auto tabular-nums">
            REJECT
          </span>
        </div>

        {/* Stats strip */}
        <div className="bg-surface border border-border rounded-card px-5 py-4 flex items-center justify-between">
          <StatCell label="Deal"          value="1,000 USDC ↔ 0.4 WETH" />
          <div className="h-8 w-px bg-border" />
          <StatCell label="Fairness"      value="0 / 100" accent />
          <div className="h-8 w-px bg-border" />
          <StatCell label="Risks"         value="2 critical, 2 medium" />
          <div className="h-8 w-px bg-border" />
          <StatCell label="Duration"      value="408 ms" />
          <div className="h-8 w-px bg-border" />
          <StatCell label="Skills called" value="5" />
        </div>

        {/* TX hash — blocked, so placeholder */}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-xs text-textMuted tracking-[0.12em] uppercase">
            Transaction Hash
          </span>
          <div className="bg-surface border border-border rounded-card px-4 py-3 flex items-center justify-between">
            <span className="font-mono text-sm text-textMuted italic">
              — not executed (deal rejected)
            </span>
            <button
              className="font-mono text-xs text-textMuted border border-border rounded-sharp px-3 py-1 cursor-not-allowed opacity-40"
              disabled
            >
              COPY
            </button>
          </div>
        </div>

        {/* Audit log */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-textMuted tracking-[0.12em] uppercase">
              Audit Log
            </span>
            <span className="font-mono text-xs text-textMuted">
              {AUDIT_LOG.length} events
            </span>
          </div>

          <div className="bg-surface border border-border rounded-card divide-y divide-border overflow-hidden">
            {/* Table header */}
            <div className="flex items-center gap-4 px-4 py-2 bg-bg">
              <span className="font-mono text-xs text-textMuted w-16 shrink-0">TIME UTC</span>
              <span className="font-mono text-xs text-textMuted flex-1">EVENT</span>
              <span className="font-mono text-xs text-textMuted w-8 text-right shrink-0">
                STATUS
              </span>
            </div>
            {AUDIT_LOG.map((row, i) => (
              <AuditRow key={i} {...row} />
            ))}
          </div>
        </div>

        {/* Audit hash */}
        <div className="bg-surface border border-border rounded-card px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xs text-textMuted tracking-[0.1em] uppercase">
              Log Hash (SHA-256)
            </span>
            <span className="font-mono text-xs text-text tabular-nums">
              a3f8b1c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
            </span>
          </div>
          <button className="font-mono text-xs text-accent border border-accent rounded-sharp px-3 py-1.5 transition-colors duration-fast ease-snappy hover:bg-accent hover:text-bg">
            COPY HASH
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link href="/arbiter">
            <button className="font-mono text-xs text-textMuted tracking-[0.12em] hover:text-text transition-colors duration-fast ease-snappy">
              ← BACK TO ARBITER
            </button>
          </Link>
          <div className="flex gap-3">
            <button className="font-mono text-xs tracking-[0.12em] text-textMuted border border-border px-5 py-2.5 rounded-sharp uppercase transition-colors duration-fast ease-snappy hover:border-text hover:text-text">
              EXPORT LOG
            </button>
            <Link href="/deal">
              <button className="font-mono text-xs tracking-[0.15em] text-bg bg-accent px-6 py-2.5 rounded-sharp uppercase transition-opacity duration-base ease-snappy hover:opacity-80">
                NEW DEAL
              </button>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
