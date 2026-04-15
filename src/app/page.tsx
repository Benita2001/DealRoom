"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";
import { useRouter } from "next/navigation";
import { xLayerTestnet } from "@/lib/wagmi";

export default function ConnectPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending } = useConnect();
  const connectors = useConnectors();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  // Defer wallet-dependent rendering until after client hydration to avoid
  // server/client mismatch (server always sees isConnected=false).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const connected = mounted && isConnected;
  const isCorrectNetwork = connected && chainId === xLayerTestnet.id;

  const handleConnect = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  const handleSwitchNetwork = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const provider = win.okxwallet ?? win.ethereum;
    if (!provider) return;

    const chainHex = `0x${xLayerTestnet.id.toString(16)}`; // 0x7A0

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
    } catch (err: unknown) {
      // 4902 = chain not added to wallet yet — add it first then switch
      if ((err as { code?: number })?.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainHex,
            chainName: xLayerTestnet.name,
            nativeCurrency: xLayerTestnet.nativeCurrency,
            rpcUrls: xLayerTestnet.rpcUrls.default.http,
            blockExplorerUrls: [xLayerTestnet.blockExplorers.default.url],
          }],
        });
      }
    }
  };

  const handleEnter = () => {
    router.push("/deal");
  };

  return (
    <main className="min-h-dvh bg-bg flex flex-col">
      {/* Minimal header */}
      <div className="h-11 flex items-center px-6 border-b border-border">
        <span className="font-mono text-xs text-textMuted tracking-[0.25em] uppercase">
          DEALROOM / v0.1.0
        </span>
      </div>

      {/* Center */}
      <div className="flex-1 flex flex-col items-center justify-center gap-10">
        {/* Wordmark */}
        <div className="flex flex-col items-center gap-3">
          <h1 className="font-mono text-2xl tracking-[0.5em] text-text uppercase">
            DEALROOM
          </h1>
          <p className="font-mono text-xs text-textMuted tracking-[0.2em] uppercase">
            Trustless OTC Escrow · X Layer Testnet
          </p>
        </div>

        {/* Accent rule */}
        <div className="h-px bg-accent" style={{ width: "120px", opacity: 0.35 }} />

        {/* Actions */}
        <div className="flex flex-col items-center gap-4">
          {!connected ? (
            <>
              <button
                onClick={handleConnect}
                disabled={isPending}
                className="font-mono text-xs tracking-[0.2em] text-accent border border-accent px-12 py-3 rounded-sharp uppercase transition-colors duration-base ease-snappy hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "CONNECTING..." : "CONNECT WALLET"}
              </button>
              <span className="font-mono text-xs text-textMuted">
                OKX Wallet · Any EIP-1193 Wallet
              </span>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {/* Connected state */}
              <div className="flex items-center gap-2 bg-surface border border-border rounded-sharp px-4 py-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isCorrectNetwork ? "bg-success" : "bg-accent"}`} />
                <span className="font-mono text-xs text-textMuted">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
                <span className="font-mono text-xs text-border">·</span>
                <span className={`font-mono text-xs ${isCorrectNetwork ? "text-success" : "text-accent"}`}>
                  {isCorrectNetwork ? "X Layer Testnet" : `Wrong network (chain ${chainId ?? "unknown"})`}
                </span>
              </div>

              {!isCorrectNetwork && (
                <button
                  onClick={handleSwitchNetwork}
                  className="font-mono text-xs tracking-[0.2em] text-accent border border-accent px-8 py-2 rounded-sharp uppercase transition-colors duration-base ease-snappy hover:bg-accent hover:text-bg"
                >
                  Switch to X Layer Testnet
                </button>
              )}

              <button
                onClick={handleEnter}
                disabled={!isCorrectNetwork}
                className="font-mono text-xs tracking-[0.2em] text-bg bg-accent px-12 py-3 rounded-sharp uppercase transition-opacity duration-base ease-snappy hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ENTER DEALROOM →
              </button>

              <button
                onClick={() => disconnect()}
                className="font-mono text-xs text-textMuted hover:text-text transition-colors duration-fast ease-snappy"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Info grid */}
        <div className="flex gap-8 mt-4">
          {[
            ["Trustless",    "Atomic swap via escrow contract"],
            ["AI Arbiter",   "Verifies both sides before execution"],
            ["Non-custodial","Funds only move on approval"],
          ].map(([title, desc]) => (
            <div key={title} className="flex flex-col gap-1 text-center max-w-36">
              <span className="font-mono text-xs text-accent">{title}</span>
              <span className="font-mono text-xs text-textMuted leading-relaxed">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer rule */}
      <div className="h-11 flex items-center justify-between px-6 border-t border-border">
        <span className="font-mono text-xs text-textMuted">Powered by OKX OnchainOS</span>
        <span className="font-mono text-xs text-textMuted">Escrow · Trustless · Audited</span>
      </div>
    </main>
  );
}
