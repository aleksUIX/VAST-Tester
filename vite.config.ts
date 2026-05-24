import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5174,
  },
  build: {
    target: "esnext",
  },
});