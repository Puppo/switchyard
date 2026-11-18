import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);

const SWITCH_POLYFILL_CSS_FETCH =
  /fetch\(\s*import\.meta\.resolve\(\s*['"]\.\/input-switch-polyfill\.css['"]\s*\)\s*\)\s*\.then\(\s*\(?r\)?\s*=>\s*r\.text\(\)\s*\)/;

/**
 * Inlines `input-switch-polyfill.css` directly into the polyfill module because
 * `fetch(import.meta.resolve('./input-switch-polyfill.css'))` breaks after bundling
 * into hashed `dist/assets/` (causing a 404 HTML response to be adopted as CSS).
 */
export function inlineSwitchPolyfillCss(): Plugin {
  return {
    name: "inline-switch-polyfill-css",
    transform(code, id) {
      const cleanId = id.split("?", 1)[0]?.replaceAll("\\", "/") ?? "";
      if (!cleanId.endsWith("input-switch-polyfill/input-switch-polyfill.js")) {
        return null;
      }

      if (!SWITCH_POLYFILL_CSS_FETCH.test(code)) {
        throw new Error(
          "Expected fetch(import.meta.resolve('./input-switch-polyfill.css')) pattern not found in input-switch-polyfill.",
        );
      }

      const cssPath = require.resolve(
        "input-switch-polyfill/input-switch-polyfill.css",
      );
      const cssText = readFileSync(cssPath, "utf8");
      const transformed = code.replace(
        SWITCH_POLYFILL_CSS_FETCH,
        `Promise.resolve(${JSON.stringify(cssText)})`,
      );

      if (transformed === code) {
        throw new Error(
          "Failed to inline input-switch-polyfill.css into input-switch-polyfill.",
        );
      }

      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [inlineSwitchPolyfillCss()],
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
