/**
 * DealRoom Design Tokens
 *
 * Single source of truth for all design decisions.
 * Tailwind config and globals.css are derived from these values.
 * Do not hardcode any of these values elsewhere in the codebase.
 *
 * Aesthetic: Bloomberg dark terminal meets private deal room.
 */

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export const colors = {
  /** Page background — near-black, not pure black */
  bg: "#0a0a0a",
  /** Elevated surface — panels, cards, sidebars */
  surface: "#111111",
  /** Subtle dividers and outlines */
  border: "#1e1e1e",
  /** Gold accent — CTAs, active states, deal highlights */
  accent: "#C8A84B",
  /** Primary text */
  text: "#e8e8e8",
  /** Secondary / metadata text */
  textMuted: "#666666",
  /** Destructive actions, risk flags */
  danger: "#c0392b",
  /** Confirmations, deal approval */
  success: "#27ae60",
} as const;

export type ColorToken = keyof typeof colors;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Font CSS variable names, set by next/font in layout.tsx.
 * Use font.mono for all numeric/onchain data.
 * Use font.ui for labels, headings, and navigation.
 */
export const font = {
  /** IBM Plex Mono — prices, addresses, hashes, amounts */
  mono: "var(--font-mono)",
  /** Sora — UI labels, headings, navigation */
  ui: "var(--font-ui)",
} as const;

export const fontSize = {
  xs: "0.6875rem",  // 11px — address fragments, metadata
  sm: "0.75rem",    // 12px — secondary labels
  base: "0.875rem", // 14px — body / table rows
  md: "1rem",       // 16px — section headings
  lg: "1.25rem",    // 20px — panel titles
  xl: "1.5rem",     // 24px — deal value display
  "2xl": "2rem",    // 32px — hero amount
} as const;

// ---------------------------------------------------------------------------
// Border Radius — exactly 3 values across the entire project
// ---------------------------------------------------------------------------

export const radius = {
  /** Inputs, badges, tags, table cells */
  sharp: "2px",
  /** Cards, panels, dropdowns */
  card: "4px",
  /** Modals, dialogs, overlays */
  modal: "8px",
} as const;

export type RadiusToken = keyof typeof radius;

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/**
 * All animations must use one of these two curves.
 * snappy  → data reveals, value transitions, number tickers
 * smooth  → overlays, modals, slide-ins
 */
export const easing = {
  snappy: "cubic-bezier(0.16, 1, 0.3, 1)",
  smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export const duration = {
  fast: "100ms",  // microinteractions, icon swaps
  base: "200ms",  // default transitions
  slow: "350ms",  // modals, overlays
} as const;

// ---------------------------------------------------------------------------
// Z-index
// ---------------------------------------------------------------------------

export const zIndex = {
  base: 0,
  raised: 1,      // sticky table headers
  overlay: 10,    // drawers, side panels
  modal: 20,      // dialogs
  toast: 30,      // notifications
} as const;

// ---------------------------------------------------------------------------
// Spacing scale (4px base)
// ---------------------------------------------------------------------------

export const spacing = {
  px: "1px",
  0.5: "2px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
  24: "96px",
} as const;
