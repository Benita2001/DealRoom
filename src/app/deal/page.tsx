"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { parseUnits, formatUnits, parseEventLogs, isAddress } from "viem";
import { AppShell } from "@/components/layout/AppShell";
import { xLayerTestnet } from "@/lib/wagmi";
import {
  ESCROW_ADDRESS,
  ESCROW_ABI,
  ERC20_ABI,
  TOKENS,
  TOKEN_DECIMALS,
  CONTRACTS_DEPLOYED,
  ZERO_ADDRESS,
  type TokenInfo,
} from "@/lib/contracts";

// ── Types ──────────────────────────────────────────────────────────────────────

type FlowStep = "idle" | "approving" | "creating" | "success";

interface FormState {
  makerTokenIndex: 0 | 1;
  makerAmount: string;
  takerAmount: string;
  allowedTaker: string;
  deadlineDuration: string; // seconds as string
}

const DEADLINE_OPTIONS = [
  { label: "1 hour",   value: String(60 * 60)       },
  { label: "6 hours",  value: String(6 * 60 * 60)   },
  { label: "12 hours", value: String(12 * 60 * 60)  },
  { label: "24 hours", value: String(24 * 60 * 60)  },
];

// ── Tiny design-system helpers ─────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-textMuted tracking-[0.12em] uppercase">
      {children}
    </span>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-success" : "bg-textMuted"}`} />
  );
}

// ── Token selector ─────────────────────────────────────────────────────────────

function TokenSelector({
  selected,
  disabled,
  onChange,
}: {
  selected: TokenInfo;
  disabled?: boolean;
  onChange: (index: 0 | 1) => void;
}) {
  return (
    <div className="flex gap-1">
      {TOKENS.map((t) => (
        <button
          key={t.symbol}
          onClick={() => !disabled && onChange(t.index)}
          disabled={disabled}
          className={`font-mono text-xs px-3 py-1.5 rounded-sharp border transition-colors duration-fast ease-snappy
            ${selected.index === t.index
              ? "bg-accent text-bg border-accent"
              : "text-textMuted border-border hover:border-text hover:text-text"
            }
            disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {t.symbol}
        </button>
      ))}
    </div>
  );
}

// ── Balance display ────────────────────────────────────────────────────────────

function BalanceChip({
  balance,
  symbol,
  isLoading,
}: {
  balance: bigint | undefined;
  symbol: string;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <span className="font-mono text-xs text-textMuted">Loading...</span>;
  }
  if (balance === undefined) return null;
  return (
    <span className="font-mono text-xs text-textMuted tabular-nums">
      Balance: {parseFloat(formatUnits(balance, TOKEN_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
    </span>
  );
}

// ── Tx status row ──────────────────────────────────────────────────────────────

function TxStatusRow({
  label,
  hash,
  isWaiting,
  isConfirming,
  isSuccess,
}: {
  label: string;
  hash?: `0x${string}`;
  isWaiting: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
}) {
  if (!isWaiting && !hash) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-surface border border-border rounded-sharp">
      <div
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          isSuccess ? "bg-success" : "bg-accent animate-pulse"
        }`}
      />
      <span className="font-mono text-xs text-textMuted">{label}</span>
      <span className="font-mono text-xs text-text ml-auto">
        {isSuccess
          ? "CONFIRMED"
          : isConfirming
          ? "CONFIRMING..."
          : "PENDING IN WALLET"}
      </span>
      {hash && (
        <a
          href={`https://www.okx.com/explorer/xlayer-test/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-accent hover:opacity-80"
        >
          {hash.slice(0, 8)}...↗
        </a>
      )}
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepBadge({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-5 h-5 rounded-sharp flex items-center justify-center text-xs font-mono border
          ${done    ? "bg-success border-success text-bg"
          : active  ? "bg-accent border-accent text-bg"
          :           "border-border text-textMuted"}`}
      >
        {done ? "✓" : n}
      </div>
      <span
        className={`font-mono text-xs ${
          done ? "text-success" : active ? "text-accent" : "text-textMuted"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DealPage() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switchPending } = useSwitchChain();

  const isCorrectNetwork = chainId === xLayerTestnet.id;

  // ── Form state ─────────────────────────────────────────────────────────────

  const [form, setForm] = useState<FormState>({
    makerTokenIndex: 0,
    makerAmount: "",
    takerAmount: "",
    allowedTaker: "",
    deadlineDuration: String(24 * 60 * 60), // 24h default
  });

  const [flowStep, setFlowStep]       = useState<FlowStep>("idle");
  const [approvalHash, setApprovalHash] = useState<`0x${string}` | undefined>();
  const [createHash, setCreateHash]     = useState<`0x${string}` | undefined>();
  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const [txError, setTxError]           = useState<string | null>(null);

  // Derived tokens
  const makerToken: TokenInfo = TOKENS[form.makerTokenIndex];
  const takerToken: TokenInfo = TOKENS[form.makerTokenIndex === 0 ? 1 : 0];

  // Redirect to home if not connected
  useEffect(() => {
    if (!isConnected) router.push("/");
  }, [isConnected, router]);

  // ── On-chain reads ─────────────────────────────────────────────────────────

  const readEnabled = !!address && isCorrectNetwork && CONTRACTS_DEPLOYED;

  const { data: makerBalance, isLoading: balanceLoading } = useReadContract({
    address: makerToken.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: readEnabled },
  });

  const makerAmountParsed = useMemo(() => {
    try {
      return form.makerAmount ? parseUnits(form.makerAmount, TOKEN_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  }, [form.makerAmount]);

  const { data: currentAllowance } = useReadContract({
    address: makerToken.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [address!, ESCROW_ADDRESS],
    query: { enabled: readEnabled && makerAmountParsed > 0n },
  });

  // ── Derived validation ────────────────────────────────────────────────────

  const takerAmountParsed = useMemo(() => {
    try {
      return form.takerAmount ? parseUnits(form.takerAmount, TOKEN_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  }, [form.takerAmount]);

  const allowedTakerValid =
    form.allowedTaker === "" ||
    (isAddress(form.allowedTaker) && form.allowedTaker !== address);

  const hasSufficientBalance =
    makerBalance !== undefined && makerAmountParsed > 0n && makerBalance >= makerAmountParsed;

  const isFormValid =
    makerAmountParsed > 0n &&
    takerAmountParsed > 0n &&
    allowedTakerValid &&
    hasSufficientBalance;

  // After flowStep becomes "approving", skip approval if already approved
  const needsApproval =
    currentAllowance === undefined || currentAllowance < makerAmountParsed;

  const approvalAlreadySufficient = !needsApproval && flowStep === "idle";

  // ── Contract writes ───────────────────────────────────────────────────────

  const { writeContractAsync: writeApproval, isPending: approvalWalletPending } =
    useWriteContract();

  const { writeContractAsync: writeCreateDeal, isPending: createWalletPending } =
    useWriteContract();

  const {
    isLoading: approvalConfirming,
    isSuccess: approvalSuccess,
  } = useWaitForTransactionReceipt({ hash: approvalHash });

  const {
    data: createReceipt,
    isLoading: createConfirming,
    isSuccess: createSuccess,
  } = useWaitForTransactionReceipt({ hash: createHash });

  // ── Parse deal ID from receipt ────────────────────────────────────────────

  useEffect(() => {
    if (!createSuccess || !createReceipt) return;
    try {
      const logs = parseEventLogs({
        abi: ESCROW_ABI,
        eventName: "DealCreated",
        logs: createReceipt.logs,
      });
      if (logs.length > 0) {
        const dealId = (logs[0] as { args: { dealId: bigint } }).args.dealId;
        setCreatedDealId(dealId.toString());
        setFlowStep("success");
      }
    } catch (e) {
      console.error("Failed to parse DealCreated event:", e);
    }
  }, [createSuccess, createReceipt]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!address || !isFormValid) return;
    setTxError(null);
    setFlowStep("approving");
    try {
      const hash = await writeApproval({
        address: makerToken.address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ESCROW_ADDRESS, makerAmountParsed],
      });
      setApprovalHash(hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Approval rejected";
      setTxError(msg.includes("User rejected") ? "Transaction cancelled." : msg);
      setFlowStep("idle");
    }
  }

  async function handleCreateDeal() {
    if (!address || !isFormValid) return;
    setTxError(null);
    setFlowStep("creating");
    try {
      const allowedTakerAddr = (
        form.allowedTaker.trim() !== "" && isAddress(form.allowedTaker)
          ? form.allowedTaker
          : ZERO_ADDRESS
      ) as `0x${string}`;

      const hash = await writeCreateDeal({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "createDeal",
        args: [
          makerToken.address,
          makerAmountParsed,
          takerToken.address,
          takerAmountParsed,
          allowedTakerAddr,
          BigInt(form.deadlineDuration),
        ],
      });
      setCreateHash(hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setTxError(msg.includes("User rejected") ? "Transaction cancelled." : msg);
      setFlowStep(approvalHash ? "idle" : "idle");
    }
  }

  // Approval confirmed → advance to create step
  const approvalDone = approvalSuccess || approvalAlreadySufficient;

  // ── Summary values (mock $1/token for demo) ───────────────────────────────

  const makerUsd = parseFloat(form.makerAmount || "0");
  const takerUsd = parseFloat(form.takerAmount || "0");
  const deviation = takerUsd > 0
    ? (((makerUsd - takerUsd) / takerUsd) * 100).toFixed(1)
    : "—";

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isConnected) return null; // redirect effect handles this

  return (
    <AppShell step={2}>
      {/* Sub-header */}
      <div className="h-9 flex items-center justify-between px-6 border-b border-border">
        <span className="font-mono text-xs text-textMuted tracking-[0.12em]">
          {flowStep === "success" ? "DEAL CREATED — SHARE LINK WITH TAKER" : "NEW OTC DEAL — DEFINE TERMS"}
        </span>
        {CONTRACTS_DEPLOYED && (
          <span className="font-mono text-xs text-textMuted">
            Escrow: {ESCROW_ADDRESS.slice(0, 6)}...{ESCROW_ADDRESS.slice(-4)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-5 p-6 max-w-4xl w-full mx-auto">

        {/* ── Not deployed banner ── */}
        {!CONTRACTS_DEPLOYED && (
          <div className="bg-surface border border-accent rounded-card px-5 py-4 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-ui text-sm text-text">Contracts not deployed yet</span>
              <span className="font-mono text-xs text-textMuted">
                Run: <code className="text-accent">npx hardhat run scripts/deploy.ts --network xlayer-testnet</code>
              </span>
            </div>
          </div>
        )}

        {/* ── Wrong network banner ── */}
        {isConnected && !isCorrectNetwork && (
          <div className="bg-surface border border-accent rounded-card px-5 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
              <span className="font-mono text-xs text-textMuted">
                Switch to X Layer Testnet (chainId 1952) to continue.
              </span>
            </div>
            <button
              onClick={() => switchChain({ chainId: xLayerTestnet.id })}
              disabled={switchPending}
              className="font-mono text-xs text-bg bg-accent px-4 py-1.5 rounded-sharp uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {switchPending ? "SWITCHING..." : "SWITCH NETWORK"}
            </button>
          </div>
        )}

        {/* ── Success state ── */}
        {flowStep === "success" && createdDealId && (
          <div className="bg-surface border border-success rounded-card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success shrink-0" />
              <span className="font-ui text-sm text-text">Deal #{createdDealId} created and funded</span>
              <span className="font-mono text-xs text-success ml-auto">ON-CHAIN</span>
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel>Shareable taker link</FieldLabel>
              <div className="flex items-center gap-2 bg-bg border border-border rounded-sharp px-3 py-2">
                <span className="font-mono text-sm text-accent flex-1">
                  /deal/{createdDealId}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(`${window.location.origin}/deal/${createdDealId}`)}
                  className="font-mono text-xs text-textMuted border border-border rounded-sharp px-3 py-1 hover:border-text hover:text-text transition-colors duration-fast ease-snappy"
                >
                  COPY
                </button>
              </div>
              <span className="font-mono text-xs text-textMuted">
                Send this link to the taker. They open it, review terms, and deposit their {takerToken.symbol}.
              </span>
            </div>
            {createHash && (
              <div className="flex items-center gap-2">
                <FieldLabel>Tx hash</FieldLabel>
                <a
                  href={`https://www.okx.com/explorer/xlayer-test/tx/${createHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:opacity-80"
                >
                  {createHash.slice(0, 10)}...{createHash.slice(-6)} ↗
                </a>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Link href="/arbiter">
                <button className="font-mono text-xs text-bg bg-accent px-6 py-2.5 rounded-sharp uppercase hover:opacity-80 transition-opacity">
                  VIEW IN ARBITER →
                </button>
              </Link>
              <button
                onClick={() => {
                  setForm({ makerTokenIndex: 0, makerAmount: "", takerAmount: "", allowedTaker: "", deadlineDuration: String(24 * 60 * 60) });
                  setFlowStep("idle");
                  setApprovalHash(undefined);
                  setCreateHash(undefined);
                  setCreatedDealId(null);
                }}
                className="font-mono text-xs text-textMuted border border-border px-6 py-2.5 rounded-sharp uppercase hover:border-text hover:text-text transition-colors duration-fast ease-snappy"
              >
                NEW DEAL
              </button>
            </div>
          </div>
        )}

        {/* ── Deal form (hidden after success) ── */}
        {flowStep !== "success" && (
          <>
            {/* Two-panel form */}
            <div className="grid grid-cols-2 gap-4 relative">
              {/* ── Party A — Maker ── */}
              <div className="bg-surface border border-border rounded-card p-5 flex flex-col gap-5">
                <div className="flex items-center justify-between pb-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-sharp bg-bg border border-accent flex items-center justify-center">
                      <span className="font-mono text-xs text-accent">A</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-ui text-xs text-text">Party A</span>
                      <span className="font-mono text-xs text-textMuted">Maker (you)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusDot ok={isConnected} />
                    <span className={`font-mono text-xs ${isConnected ? "text-success" : "text-textMuted"}`}>
                      {isConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                </div>

                {/* Wallet address */}
                <div className="flex flex-col gap-2">
                  <FieldLabel>Your Wallet</FieldLabel>
                  <div className="w-full bg-bg border border-border rounded-sharp px-3 py-2 font-mono text-xs text-textMuted">
                    {address ?? "—"}
                  </div>
                </div>

                {/* Token you offer */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <FieldLabel>You Offer</FieldLabel>
                    <BalanceChip
                      balance={makerBalance}
                      symbol={makerToken.symbol}
                      isLoading={balanceLoading}
                    />
                  </div>
                  <TokenSelector
                    selected={makerToken}
                    disabled={flowStep !== "idle"}
                    onChange={(idx) => setForm((f) => ({ ...f, makerTokenIndex: idx }))}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.makerAmount}
                    onChange={(e) => setForm((f) => ({ ...f, makerAmount: e.target.value }))}
                    placeholder="0.00"
                    disabled={flowStep !== "idle"}
                    className="w-full bg-bg border border-border rounded-sharp px-3 py-2 font-mono text-sm text-text placeholder:text-textMuted focus:border-accent focus:outline-none transition-colors duration-fast ease-snappy tabular-nums disabled:opacity-50"
                  />
                  {makerAmountParsed > 0n && !hasSufficientBalance && (
                    <span className="font-mono text-xs text-danger">Insufficient balance.</span>
                  )}
                </div>

                {/* Taker deadline */}
                <div className="flex flex-col gap-2">
                  <FieldLabel>Taker Deadline</FieldLabel>
                  <select
                    value={form.deadlineDuration}
                    onChange={(e) => setForm((f) => ({ ...f, deadlineDuration: e.target.value }))}
                    disabled={flowStep !== "idle"}
                    className="w-full bg-bg border border-border rounded-sharp px-3 py-2 font-mono text-sm text-text focus:border-accent focus:outline-none transition-colors duration-fast ease-snappy disabled:opacity-50"
                  >
                    {DEADLINE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Swap divider */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden lg:flex items-center justify-center w-8 h-8 bg-surface border border-border rounded-sharp">
                <span className="font-mono text-xs text-textMuted">↔</span>
              </div>

              {/* ── Party B — Taker ── */}
              <div className="bg-surface border border-border rounded-card p-5 flex flex-col gap-5">
                <div className="flex items-center justify-between pb-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-sharp bg-bg border border-border flex items-center justify-center">
                      <span className="font-mono text-xs text-textMuted">B</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-ui text-xs text-text">Party B</span>
                      <span className="font-mono text-xs text-textMuted">Taker</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusDot ok={false} />
                    <span className="font-mono text-xs text-textMuted">Awaiting</span>
                  </div>
                </div>

                {/* Optional: restrict to address */}
                <div className="flex flex-col gap-2">
                  <FieldLabel>Restrict to Address (optional)</FieldLabel>
                  <input
                    type="text"
                    value={form.allowedTaker}
                    onChange={(e) => setForm((f) => ({ ...f, allowedTaker: e.target.value }))}
                    placeholder="0x... or leave blank for open deal"
                    disabled={flowStep !== "idle"}
                    className={`w-full bg-bg border rounded-sharp px-3 py-2 font-mono text-xs text-text placeholder:text-textMuted focus:outline-none transition-colors duration-fast ease-snappy disabled:opacity-50 ${
                      form.allowedTaker && !allowedTakerValid
                        ? "border-danger focus:border-danger"
                        : "border-border focus:border-accent"
                    }`}
                  />
                  {form.allowedTaker && !allowedTakerValid && (
                    <span className="font-mono text-xs text-danger">
                      {form.allowedTaker === address ? "Cannot be your own address." : "Invalid address."}
                    </span>
                  )}
                  <span className="font-mono text-xs text-textMuted">
                    Leave blank to allow anyone with the link.
                  </span>
                </div>

                {/* Token they must provide */}
                <div className="flex flex-col gap-2">
                  <FieldLabel>They Provide</FieldLabel>
                  <div className="flex items-center gap-2 bg-bg border border-border rounded-sharp px-3 py-2">
                    <span className="font-mono text-sm text-text">{takerToken.symbol}</span>
                    <span className="font-mono text-xs text-textMuted ml-1">(auto — opposite token)</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.takerAmount}
                    onChange={(e) => setForm((f) => ({ ...f, takerAmount: e.target.value }))}
                    placeholder="0.00"
                    disabled={flowStep !== "idle"}
                    className="w-full bg-bg border border-border rounded-sharp px-3 py-2 font-mono text-sm text-text placeholder:text-textMuted focus:border-accent focus:outline-none transition-colors duration-fast ease-snappy tabular-nums disabled:opacity-50"
                  />
                </div>

                {/* Deal summary note */}
                <div className="flex flex-col gap-1 mt-auto pt-4 border-t border-border">
                  <span className="font-mono text-xs text-textMuted">
                    The taker will receive a link to review these terms and deposit their {takerToken.symbol} into escrow.
                  </span>
                </div>
              </div>
            </div>

            {/* ── Deal summary strip ── */}
            <div className="bg-surface border border-border rounded-card px-5 py-4 flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <FieldLabel>Deal</FieldLabel>
                <span className="font-mono text-sm text-text tabular-nums">
                  {form.makerAmount || "—"} {makerToken.symbol} ↔ {form.takerAmount || "—"} {takerToken.symbol}
                </span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <FieldLabel>You offer</FieldLabel>
                <span className="font-mono text-sm text-text tabular-nums">
                  ${makerUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <FieldLabel>They offer</FieldLabel>
                <span className="font-mono text-sm text-text tabular-nums">
                  ${takerUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <FieldLabel>Deviation</FieldLabel>
                <span className="font-mono text-sm text-accent tabular-nums">
                  {deviation === "—" ? "—" : `${parseFloat(deviation) >= 0 ? "+" : ""}${deviation}%`}
                </span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <FieldLabel>Chain</FieldLabel>
                <span className="font-mono text-sm text-text">X Layer Testnet</span>
              </div>
            </div>

            {/* ── Tx status rows ── */}
            <div className="flex flex-col gap-2">
              <TxStatusRow
                label={`Approve ${makerToken.symbol} for escrow`}
                hash={approvalHash}
                isWaiting={flowStep === "approving" && approvalWalletPending}
                isConfirming={approvalConfirming}
                isSuccess={approvalSuccess}
              />
              <TxStatusRow
                label="Create deal & deposit"
                hash={createHash}
                isWaiting={flowStep === "creating" && createWalletPending}
                isConfirming={createConfirming}
                isSuccess={createSuccess}
              />
            </div>

            {/* ── Error message ── */}
            {txError && (
              <div className="bg-surface border border-danger rounded-card px-4 py-3">
                <span className="font-mono text-xs text-danger">{txError}</span>
              </div>
            )}

            {/* ── Two-step progress + actions ── */}
            <div className="flex items-center justify-between">
              <Link href="/">
                <button className="font-mono text-xs text-textMuted tracking-[0.12em] hover:text-text transition-colors duration-fast ease-snappy">
                  ← BACK
                </button>
              </Link>

              <div className="flex items-center gap-6">
                {/* Step indicator */}
                <div className="flex items-center gap-4">
                  <StepBadge
                    n={1}
                    label="APPROVE"
                    active={flowStep === "idle" && !approvalDone}
                    done={approvalDone}
                  />
                  <div className="w-6 h-px bg-border" />
                  <StepBadge
                    n={2}
                    label="CREATE DEAL"
                    active={approvalDone && flowStep !== "success"}
                    done={flowStep === "success"}
                  />
                </div>

                {/* CTA button */}
                {!approvalDone ? (
                  <button
                    onClick={handleApprove}
                    disabled={
                      !isFormValid ||
                      !CONTRACTS_DEPLOYED ||
                      !isCorrectNetwork ||
                      flowStep === "approving" ||
                      approvalWalletPending ||
                      approvalConfirming
                    }
                    className="font-mono text-xs tracking-[0.15em] text-accent border border-accent px-8 py-3 rounded-sharp uppercase transition-colors duration-base ease-snappy hover:bg-accent hover:text-bg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {approvalWalletPending
                      ? "APPROVE IN WALLET..."
                      : approvalConfirming
                      ? "CONFIRMING..."
                      : `APPROVE ${makerToken.symbol} FOR ESCROW`}
                  </button>
                ) : (
                  <button
                    onClick={handleCreateDeal}
                    disabled={
                      !isFormValid ||
                      !CONTRACTS_DEPLOYED ||
                      !isCorrectNetwork ||
                      flowStep === "creating" ||
                      createWalletPending ||
                      createConfirming
                    }
                    className="font-mono text-xs tracking-[0.15em] text-bg bg-accent px-8 py-3 rounded-sharp uppercase transition-opacity duration-base ease-snappy hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {createWalletPending
                      ? "CONFIRM IN WALLET..."
                      : createConfirming
                      ? "DEPOSITING..."
                      : "CREATE DEAL & DEPOSIT →"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
