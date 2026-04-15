"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";

/**
 * Wraps the app with Wagmi + React Query providers.
 * Must be a client component. Placed in layout.tsx directly inside <body>.
 */
export function Web3Provider({ children }: { children: React.ReactNode }) {
  // Stable QueryClient instance — created once per browser tab
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000, // 10s — balances and allowances stay fresh
        retry: 1,
      },
    },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
