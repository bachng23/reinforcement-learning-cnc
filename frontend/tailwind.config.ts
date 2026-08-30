import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "canvas-fog": "#fafaf9",
        "cloud-white": "#ffffff",
        "slate-text": "#0c0a09",
        "ash-gray": "#78716c",
        "stone-border": "#e5e7eb",
        "platinum-outline": "#d6d3d1",
        "steel-gray": "#a8a29e",
        "hover-stone": "#c9c5c2",
        "chartwell-blue": "#3ba6f1",
        "sky-tint": "#c1e1f7",
        "status-emerald": "#10b981",
        "emerald-tint": "#ecfdf5",
        "status-amber": "#f59e0b",
        "amber-tint": "#fffbeb",
        "status-rose": "#f43f5e",
        "rose-tint": "#fff1f2",
        background: "#fafaf9",
        surface: "#ffffff",
        "surface-container": "#f5f4f3",
        "surface-container-high": "#e5e7eb",
        "primary-container": "#c1e1f7",
        "on-surface": "#0c0a09",
        "on-surface-variant": "#78716c",
        primary: "#3ba6f1",
        secondary: "#78716c",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      fontFamily: {
        body: ["ui-sans-serif", "system-ui", "sans-serif"],
        headline: ["ui-sans-serif", "system-ui", "sans-serif"],
        label: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
