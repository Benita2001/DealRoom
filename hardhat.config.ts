import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load from .env.local (Next.js convention)
dotenv.config({ path: ".env.local" });

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    "xlayer-testnet": {
      url: "https://testrpc.xlayer.tech/terigon",
      chainId: 1952,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
    // Fallback RPC if primary is slow
    "xlayer-testnet-alt": {
      url: "https://xlayertestrpc.okx.com/terigon",
      chainId: 1952,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
