import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages).
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Direct access to the font files inside @fontsource packages.
      "@fontfiles": path.resolve(__dirname, "node_modules/@fontsource"),
    },
  },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1000 },
});
