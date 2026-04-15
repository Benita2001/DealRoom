import { createConfig, http, createConnector } from "wagmi";
import { defineChain } from "viem";

// ── X Layer Testnet (chainId 1952) ────────────────────────────────────────────

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: {
    name: "OKB",
    symbol: "OKB",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        "https://testrpc.xlayer.tech/terigon",
        "https://xlayertestrpc.okx.com/terigon",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "OKX Explorer (Testnet)",
      url: "https://www.okx.com/explorer/xlayer-test",
    },
  },
  testnet: true,
});

// ── Provider resolution — prefers window.okxwallet, falls back to window.ethereum ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EIP1193Provider = any;

function getInjectedProvider(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as Window & { okxwallet?: EIP1193Provider; ethereum?: EIP1193Provider };
  // Prefer window.okxwallet so OKX Wallet is always used when installed,
  // regardless of whether MetaMask or another extension also defines window.ethereum.
  return win.okxwallet ?? win.ethereum ?? undefined;
}

// ── Explicit OKX / injected connector ────────────────────────────────────────
// Uses createConnector instead of injected() so getInjectedProvider() runs
// fresh on every provider access — no internal caching that could bind to the
// wrong wallet when multiple extensions are installed.

const okxOrInjected = createConnector<EIP1193Provider>((config) => {
  // Stable listener refs so removeListener can remove the exact same function
  let boundAccountsChanged: ((accounts: string[]) => void) | undefined;
  let boundChainChanged: ((chainId: string) => void) | undefined;
  let boundDisconnect: (() => void) | undefined;

  return {
    id: "okxOrInjected",
    name: "OKX Wallet",
    type: "injected" as const,

    async setup() {
      // wagmi calls isAuthorized() automatically for silent reconnect
    },

    async connect() {
      const provider = getInjectedProvider();
      if (!provider) throw new Error("No wallet found. Install OKX Wallet or MetaMask.");

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      const chainId = Number(await provider.request({ method: "eth_chainId" }));

      boundAccountsChanged = (accs: string[]) => {
        if (!accs.length) config.emitter.emit("disconnect");
        else config.emitter.emit("change", { accounts: accs as `0x${string}`[] });
      };
      boundChainChanged = (cid: string) => {
        config.emitter.emit("change", { chainId: Number(cid) });
      };
      boundDisconnect = () => config.emitter.emit("disconnect");

      provider.on("accountsChanged", boundAccountsChanged);
      provider.on("chainChanged", boundChainChanged);
      provider.on("disconnect", boundDisconnect);

      return { accounts, chainId };
    },

    async disconnect() {
      const provider = getInjectedProvider();
      if (provider) {
        if (boundAccountsChanged) provider.removeListener?.("accountsChanged", boundAccountsChanged);
        if (boundChainChanged) provider.removeListener?.("chainChanged", boundChainChanged);
        if (boundDisconnect) provider.removeListener?.("disconnect", boundDisconnect);
      }
      boundAccountsChanged = undefined;
      boundChainChanged = undefined;
      boundDisconnect = undefined;
    },

    async getAccounts() {
      const provider = getInjectedProvider();
      if (!provider) return [];
      return (await provider.request({ method: "eth_accounts" })) as `0x${string}`[];
    },

    async getChainId() {
      const provider = getInjectedProvider();
      if (!provider) return config.chains[0].id;
      return Number(await provider.request({ method: "eth_chainId" }));
    },

    async getProvider() {
      return getInjectedProvider();
    },

    async isAuthorized() {
      try {
        const accs = await this.getAccounts();
        return accs.length > 0;
      } catch {
        return false;
      }
    },

    async switchChain({ chainId }) {
      const provider = getInjectedProvider();
      if (!provider) throw new Error("No provider");

      const chain = config.chains.find((c) => c.id === chainId);
      if (!chain) throw new Error(`Chain ${chainId} not configured`);

      const chainHex = `0x${chainId.toString(16)}`;

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainHex }],
        });
      } catch (err: unknown) {
        if ((err as { code?: number })?.code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainHex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls.default.http,
              blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
            }],
          });
        } else {
          throw err;
        }
      }

      return chain;
    },

    // wagmi calls these directly in some reconnect paths
    onAccountsChanged(accounts: string[]) {
      if (!accounts.length) config.emitter.emit("disconnect");
      else config.emitter.emit("change", { accounts: accounts as `0x${string}`[] });
    },

    onChainChanged(chainId: string) {
      config.emitter.emit("change", { chainId: Number(chainId) });
    },

    onDisconnect() {
      config.emitter.emit("disconnect");
    },
  };
});

// ── Wagmi config ──────────────────────────────────────────────────────────────

export const wagmiConfig = createConfig({
  chains: [xLayerTestnet],
  connectors: [okxOrInjected],
  transports: {
    [xLayerTestnet.id]: http("https://testrpc.xlayer.tech/terigon"),
  },
});
