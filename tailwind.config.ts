import type { Config } from "tailwindcss";
import { colors, radius, fontSize, easing, duration, spacing } from "./src/design/tokens";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // Replace defaults entirely for colors and radius to prevent drift
    colors: {
      transparent: "transparent",
      current: "currentColor",
      ...colors,
    },
    borderRadius: {
      none: "0",
      ...radius,
    },
    fontSize: Object.fromEntries(
      Object.entries(fontSize).map(([k, v]) => [k, [v, { lineHeight: "1.5" }]])
    ),
    extend: {
      fontFamily: {
        mono: ["var(--font-mono)", "Courier New", "monospace"],
        ui: ["var(--font-ui)", "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        snappy: easing.snappy,
        smooth: easing.smooth,
      },
      transitionDuration: {
        fast: duration.fast,
        base: duration.base,
        slow: duration.slow,
      },
      spacing,
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-accent": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "fade-in": `fade-in ${duration.base} ${easing.snappy} both`,
        "slide-up": `slide-up ${duration.base} ${easing.snappy} both`,
        "pulse-accent": `pulse-accent 1.6s ${easing.smooth} infinite`,
      },
    },
  },
  plugins: [],
};

export default config;
