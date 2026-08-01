import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0B0A09",
          900: "#111010",
          850: "#161514",
          800: "#1C1A18",
          700: "#26231F",
          600: "#332F2A",
          500: "#4A453E",
        },
        bone: {
          100: "#EDE9E1",
          200: "#D6D1C7",
          400: "#9C958A",
          600: "#6B655C",
        },
        signal: {
          DEFAULT: "#D98E3C",
          soft: "#E8B575",
          deep: "#8E561D",
        },
      },
      fontFamily: {
        display: ["Zodiak", "Georgia", "serif"],
        sans: ["Satoshi", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { sm: "3px", DEFAULT: "4px", md: "6px", lg: "8px" },
    },
  },
  plugins: [],
} satisfies Config;
