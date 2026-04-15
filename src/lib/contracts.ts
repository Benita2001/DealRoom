/**
 * Contract ABIs and deployed addresses for DealRoom.
 *
 * Addresses are loaded from deployed-addresses.json, which is written by
 * `scripts/deploy.ts`. Before deployment, all addresses are zero and the UI
 * will show a "contracts not deployed" banner.
 */

import deployedAddresses from "./deployed-addresses.json";

// ── Address constants ─────────────────────────────────────────────────────────

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const ESCROW_ADDRESS  = deployedAddresses.escrow  as `0x${string}`;
export const TOKEN_A_ADDRESS = deployedAddresses.tokenA  as `0x${string}`;
export const TOKEN_B_ADDRESS = deployedAddresses.tokenB  as `0x${string}`;
export const ARBITER_ADDRESS = deployedAddresses.arbiter as `0x${string}`;

export const CONTRACTS_DEPLOYED =
  ESCROW_ADDRESS  !== ZERO_ADDRESS &&
  TOKEN_A_ADDRESS !== ZERO_ADDRESS &&
  TOKEN_B_ADDRESS !== ZERO_ADDRESS;

export const TOKEN_DECIMALS = 18;

// ── Token registry ────────────────────────────────────────────────────────────

export const TOKENS = [
  {
    index:    0 as const,
    symbol:   "TKA",
    name:     "Mock Token A",
    address:  TOKEN_A_ADDRESS,
    decimals: TOKEN_DECIMALS,
  },
  {
    index:    1 as const,
    symbol:   "TKB",
    name:     "Mock Token B",
    address:  TOKEN_B_ADDRESS,
    decimals: TOKEN_DECIMALS,
  },
] as const;

export type TokenInfo = (typeof TOKENS)[number];

// ── ERC-20 minimal ABI ────────────────────────────────────────────────────────

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

// ── DealRoomEscrow ABI ────────────────────────────────────────────────────────

export const ESCROW_ABI = [
  // ─── Write functions ───────────────────────────────────────────────────────
  {
    type: "function",
    name: "createDeal",
    inputs: [
      { name: "makerToken",            type: "address" },
      { name: "makerAmount",           type: "uint256" },
      { name: "takerToken",            type: "address" },
      { name: "takerAmount",           type: "uint256" },
      { name: "allowedTaker",          type: "address" },
      { name: "takerDeadlineDuration", type: "uint256" },
    ],
    outputs: [{ name: "dealId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fundDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rejectDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimMakerTimeout",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimArbiterTimeout",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ─── Read functions ────────────────────────────────────────────────────────
  {
    type: "function",
    name: "getDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "maker",          type: "address" },
          { name: "taker",          type: "address" },
          { name: "makerToken",     type: "address" },
          { name: "takerToken",     type: "address" },
          { name: "makerAmount",    type: "uint256" },
          { name: "takerAmount",    type: "uint256" },
          { name: "status",         type: "uint8"   },
          { name: "takerDeadline",  type: "uint256" },
          { name: "arbiterDeadline",type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "dealCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "arbiter",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_TAKER_DEADLINE_DURATION",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // ─── Events ────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "DealCreated",
    inputs: [
      { name: "dealId",       type: "uint256", indexed: true  },
      { name: "maker",        type: "address", indexed: true  },
      { name: "makerToken",   type: "address", indexed: false },
      { name: "makerAmount",  type: "uint256", indexed: false },
      { name: "takerToken",   type: "address", indexed: false },
      { name: "takerAmount",  type: "uint256", indexed: false },
      { name: "allowedTaker", type: "address", indexed: false },
      { name: "takerDeadline",type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DealFunded",
    inputs: [
      { name: "dealId",          type: "uint256", indexed: true  },
      { name: "taker",           type: "address", indexed: true  },
      { name: "arbiterDeadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DealCompleted",
    inputs: [{ name: "dealId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "DealRefunded",
    inputs: [{ name: "dealId", type: "uint256", indexed: true }],
  },
] as const;

// ── Deal status enum (mirrors Solidity) ───────────────────────────────────────

export const DealStatus = {
  MAKER_FUNDED: 0,
  BOTH_FUNDED:  1,
  COMPLETED:    2,
  REFUNDED:     3,
} as const;
