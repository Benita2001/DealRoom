/**
 * POST /api/arbiter/execute
 *
 * Executes the approved OTC deal via onchainos swap execute.
 * Only called after the arbiter has issued an APPROVE verdict.
 *
 * Uses `onchainos swap execute` (the one-shot: quote → approve → swap → broadcast path).
 * Requires the arbiter wallet to be logged in on X Layer.
 */

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const BIN = `${process.env.HOME}/.local/bin/onchainos`;

interface ExecuteRequest {
  dealId: string;
  makerAddress: string;
  makerToken: { address: string; amount: string };
  takerToken: { address: string };
  chain: string;
}

export async function POST(req: NextRequest) {
  let body: ExecuteRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, makerAddress, makerToken, takerToken, chain } = body;
  if (!dealId || !makerAddress || !makerToken?.address || !takerToken?.address || !makerToken?.amount) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const cmd = [
    BIN, "swap", "execute",
    "--from",            makerToken.address,
    "--to",              takerToken.address,
    "--readable-amount", makerToken.amount,
    "--chain",           chain ?? "ethereum",
    "--wallet",          makerAddress,
    "--slippage",        "0.5",
  ].join(" ");

  try {
    const { stdout } = await execAsync(cmd, {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      data?: { txHash?: string; transactionHash?: string };
      error?: string;
    };

    if (!parsed.ok) {
      return NextResponse.json({
        ok: false, dealId, txHash: null,
        error: parsed.error ?? "Swap returned ok:false",
        executedAt: new Date().toISOString(),
      });
    }

    const txHash =
      parsed.data?.txHash ??
      parsed.data?.transactionHash ??
      null;

    return NextResponse.json({
      ok: true, dealId, txHash,
      executedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    let error = e.message ?? "Swap failed";
    if (e.stdout?.trim()) {
      try {
        const parsed = JSON.parse(e.stdout.trim()) as { error?: string };
        if (parsed.error) error = parsed.error;
      } catch { /* not JSON */ }
    }
    return NextResponse.json({
      ok: false, dealId, txHash: null, error,
      executedAt: new Date().toISOString(),
    });
  }
}
