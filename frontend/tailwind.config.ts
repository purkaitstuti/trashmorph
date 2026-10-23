import type { Config } from "tailwindcss";

const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { bg: c("bg"), surface: c("surface"), subtle: c("subtle"), ink: c("text"), muted: c("muted"), line: c("border"), primary: c("primary"), "primary-fg": c("primary-fg"), danger: c("danger") },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "system-ui", "sans-serif"],
        sans: ['"Source Sans 3"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
