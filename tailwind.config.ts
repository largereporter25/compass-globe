import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#000000",
          900: "#0A0A0A",
          850: "#101010",
          800: "#171717",
          700: "#262626",
          600: "#3D3D3D",
        },
        bone: {
          100: "#F4F2EC",
          200: "#CBC8C0",
          400: "#8A857C",
          600: "#5A564F",
        },
        signal: {
          DEFAULT: "#FF5A1F",
          deep: "#B33A0E",
        },
      },
      fontFamily: {
        display: ["Clash Display", "Helvetica Neue", "sans-serif"],
        sans: ["Satoshi", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0" },
    },
  },
  plugins: [],
} satisfies Config;
