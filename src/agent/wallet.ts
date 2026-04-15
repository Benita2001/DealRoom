/**
 * DealRoom Arbiter Wallet
 *
 * Manages the AI Arbiter's onchain identity on X Layer (chainIndex 196).
 * Arbiter address: 0x344fdf33c7907c1267c73b940ce91741097cea49
 *
 * Signs verdict hashes using onchainos wallet sign-message (EIP-191 personalSign).
 * X Layer is gas-free — signing costs nothing.
 *
 * Design: signing is NON-BLOCKING. If the onchainos call fails (network, auth,
 * timeout), the arbiter still returns its full verdict — the signature fields
 * are null and signatureVerified is false. The verdict is never withheld because
 * of a signing failure.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";

const execAsync = promisify(exec);

const BIN          = `${process.env.HOME}/.local/bin/onchainos`;
const XLAYER       = "xlayer";
const SIGN_TIMEOUT = 15_000; // ms — sign-message is fast, but TEE can be slow under load

// ---------------------------------------------------------------------------
// Arbiter identity — sourced from env, falls back to hardcoded address
// ---------------------------------------------------------------------------

export const ARBITER_ADDRESS: string =
  process.env.ARBITER_WALLET_ADDRESS ??
  "0x344fdf33c7907c1267c73b940ce91741097cea49";

// ---------------------------------------------------------------------------
// Wallet readiness check
// ---------------------------------------------------------------------------

interface WalletStatusData {
  loggedIn: boolean;
  accountName?: string;
  loginType?: string; // "email" | "ak"
}

/**
 * Check whether the arbiter wallet is authenticated.
 * Returns { ready, reason } — never throws.
 */
export async function isWalletReady(): Promise<{ ready: boolean; reason: string }> {
  try {
    const { stdout } = await execAsync(`${BIN} wallet status`, {
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
      timeout: 10_000,
    });

    const res = JSON.parse(stdout.trim()) as {
      ok: boolean;
      data?: WalletStatusData;
      error?: string;
    };

    if (res.ok && res.data?.loggedIn) {
      return {
        ready: true,
        reason: `Logged in as ${res.data.accountName ?? "arbiter"} (${res.data.loginType ?? "unknown"})`,
      };
    }

    return {
      ready: false,
      reason: res.error ?? "wallet not logged in — run: onchainos wallet login <email>",
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { ready: false, reason: e.message ?? "wallet status check failed" };
  }
}

// ---------------------------------------------------------------------------
// Verdict payload — canonical fields signed on X Layer
// ---------------------------------------------------------------------------

/**
 * Minimal deterministic subset of ArbiterVerdict that gets hashed and signed.
 * Deliberately excludes verbose arrays (risks[], reasoning[]) to keep the
 * signed payload stable and reproducible by any verifier.
 */
export interface VerdictPayload {
  dealId: string;
  timestamp: string;
  verdict: string;        // "APPROVE" | "WARN" | "REJECT"
  fairnessScore: number;
  executionBlocked: boolean;
  makerAddress: string;
  takerAddress: string;
}

/**
 * SHA-256 of the canonically serialised payload (keys sorted, UTF-8 encoded).
 * Hex-encoded string — this is the value passed to sign-message --message.
 */
export function computeVerdictHash(payload: VerdictPayload): string {
  // Sort keys so serialisation is stable regardless of insertion order
  const sortedKeys = Object.keys(payload).sort() as Array<keyof VerdictPayload>;
  const canonical  = JSON.stringify(
    Object.fromEntries(sortedKeys.map((k) => [k, payload[k]]))
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Signing outcome types
// ---------------------------------------------------------------------------

export interface SignatureResult {
  success: true;
  arbiterAddress: string;
  chain: "xlayer";
  verdictHash: string;
  signature: string;
  signedAt: string;
}

export interface SignatureFailure {
  success: false;
  arbiterAddress: string;
  verdictHash: string;
  error: string;
  signedAt: string;
}

export type SigningOutcome = SignatureResult | SignatureFailure;

// ---------------------------------------------------------------------------
// Sign verdict on X Layer — non-blocking, never throws
// ---------------------------------------------------------------------------

/**
 * Signs the verdict hash on X Layer using the arbiter's TEE-backed wallet.
 *
 * Uses --force to skip interactive confirmation prompts (required for
 * server-side / API-route use). If the wallet is not logged in, the sign
 * attempt will fail and return SignatureFailure — the arbiter verdict is
 * still returned to the caller.
 */
export async function signVerdict(payload: VerdictPayload): Promise<SigningOutcome> {
  const verdictHash = computeVerdictHash(payload);
  const signedAt    = new Date().toISOString();

  const cmd = [
    BIN,
    "wallet", "sign-message",
    "--chain",   XLAYER,
    "--from",    ARBITER_ADDRESS,
    "--message", verdictHash,
    "--force",   // bypass confirmation prompt — mandatory for non-interactive use
  ].join(" ");

  try {
    const { stdout } = await execAsync(cmd, {
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
      timeout: SIGN_TIMEOUT,
    });

    const res = JSON.parse(stdout.trim()) as {
      ok: boolean;
      data?: {
        signature?:     string;
        signedMessage?: string; // alternate field name in some CLI versions
      };
      error?: string;
    };

    if (!res.ok || !res.data) {
      throw new Error(res.error ?? "sign-message returned ok:false with no data");
    }

    // CLI may use either field name depending on version
    const signature = res.data.signature ?? res.data.signedMessage;
    if (!signature) {
      throw new Error(
        "sign-message succeeded but response contained no signature field"
      );
    }

    return {
      success: true,
      arbiterAddress: ARBITER_ADDRESS,
      chain: "xlayer",
      verdictHash,
      signature,
      signedAt,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    let errorMsg = e.message ?? "unknown signing error";

    // Try to extract a cleaner error from onchainos JSON output
    if (e.stdout?.trim()) {
      try {
        const parsed = JSON.parse(e.stdout.trim()) as { error?: string };
        if (parsed.error) errorMsg = parsed.error;
      } catch { /* stdout was not JSON */ }
    }

    return {
      success: false,
      arbiterAddress: ARBITER_ADDRESS,
      verdictHash,
      error: errorMsg,
      signedAt,
    };
  }
}
