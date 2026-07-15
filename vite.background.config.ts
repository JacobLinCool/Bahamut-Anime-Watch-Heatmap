import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts")
      },
      output: {
        entryFileNames: "assets/[name].js",
        format: "iife"
      }
    }
  }
});
