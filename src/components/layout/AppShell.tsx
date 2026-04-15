"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { xLayerTestnet } from "@/lib/wagmi";

interface AppShellProps {
  children: React.ReactNode;
  step?: number;
}

export function AppShell({ children, step }: AppShellProps) {
  const { address, isConnected, chainId } = useAccount();

  const steps = [
    { n: 1, label: "Connect",  href: "/"          },
    { n: 2, label: "Deal",     href: "/deal"       },
    { n: 3, label: "Arbiter",  href: "/arbiter"    },
    { n: 4, label: "Execute",  href: "/execution"  },
  ];

  const isCorrectNetwork = chainId === xLayerTestnet.id;
  const networkLabel = isCorrectNetwork ? "X Layer Testnet" : chainId ? `Chain ${chainId}` : "No network";
  const networkColor = isCorrectNetwork ? "bg-success" : "bg-accent";

  const displayAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Not connected";

  return (
    <div className="min-h-dvh bg-bg flex flex-col">
      {/* Top bar */}
      <header className="h-11 shrink-0 flex items-center justify-between px-6 border-b border-border">
        <Link
          href="/"
          className="font-mono text-xs tracking-[0.3em] text-text uppercase hover:text-accent transition-colors duration-fast ease-snappy"
        >
          DEALROOM
        </Link>

        <div className="flex items-center gap-6">
          {/* Step breadcrumb */}
          {step && (
            <nav className="flex items-center gap-1">
              {steps.map((s, i) => (
                <span key={s.n} className="flex items-center gap-1">
                  <Link
                    href={s.href}
                    className={`font-mono text-xs transition-colors duration-fast ease-snappy ${
                      s.n === step
                        ? "text-accent"
                        : s.n < step
                        ? "text-text"
                        : "text-textMuted"
                    }`}
                  >
                    {s.label}
                  </Link>
                  {i < steps.length - 1 && (
                    <span className="font-mono text-xs text-border">·</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Wallet + network chip */}
          <div className="flex items-center gap-2 bg-surface border border-border rounded-sharp px-3 py-1">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? networkColor : "bg-textMuted"}`} />
            <span className="font-mono text-xs text-textMuted">{displayAddress}</span>
            {isConnected && (
              <>
                <span className="font-mono text-xs text-border">·</span>
                <span className={`font-mono text-xs ${isCorrectNetwork ? "text-success" : "text-accent"}`}>
                  {networkLabel}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 flex flex-col">{children}</main>

      {/* Bottom status bar */}
      <footer className="h-7 shrink-0 flex items-center justify-between px-6 border-t border-border">
        <span className="font-mono text-xs text-textMuted">
          OKX OnchainOS · X Layer Testnet
        </span>
        <span className="font-mono text-xs text-textMuted">
          {isConnected ? `${displayAddress}` : "Wallet not connected"}
        </span>
      </footer>
    </div>
  );
}
