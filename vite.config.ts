import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  optimizeDeps: {
    exclude: ["input-switch-polyfill"],
  },
  build: {
    target: "es2022",
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        probe: resolve(import.meta.dirname, "probe.html"),
      },
    },
  },
});
