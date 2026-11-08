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
        "canvas-fog": "var(--color-canvas-fog)",
        "cloud-white": "var(--color-cloud-white)",
        "slate-text": "var(--color-slate-text)",
        "ash-gray": "var(--color-ash-gray)",
        "stone-border": "var(--color-stone-border)",
        "platinum-outline": "var(--color-platinum-outline)",
        "steel-gray": "var(--color-steel-gray)",
        "hover-stone": "var(--color-hover-stone)",
        "chartwell-blue": "var(--color-chartwell-blue)",
        "sky-tint": "var(--color-sky-tint)",
        "status-emerald": "#10b981",
        "emerald-tint": "#ecfdf5",
        "status-amber": "#f59e0b",
        "amber-tint": "#fffbeb",
        "status-rose": "#f43f5e",
        "rose-tint": "#fff1f2",
        background: "var(--color-canvas-fog)",
        surface: "#ffffff",
        "surface-container": "#f4f5f6",
        "surface-container-high": "#e5e7eb",
        "primary-container": "var(--color-sky-tint)",
        "on-surface": "var(--color-slate-text)",
        "on-surface-variant": "var(--color-ash-gray)",
        primary: "var(--color-chartwell-blue)",
        secondary: "var(--color-ash-gray)",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      fontFamily: {
        body: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        headline: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        label: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
