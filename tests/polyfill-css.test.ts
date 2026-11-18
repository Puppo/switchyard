import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { inlineSwitchPolyfillCss } from "../vite.config.js";

const require = createRequire(import.meta.url);

describe("inlineSwitchPolyfillCss Vite plugin", () => {
  it("replaces runtime fetch(import.meta.resolve) with bundled CSS text", () => {
    const plugin = inlineSwitchPolyfillCss();
    const polyfillPath = require.resolve(
      "input-switch-polyfill/input-switch-polyfill.js",
    );
    const source = readFileSync(polyfillPath, "utf8");

    expect(source).toContain("import.meta.resolve");

    const transformHook = plugin.transform;
    expect(typeof transformHook).toBe("function");
    if (typeof transformHook !== "function") {
      throw new Error("Expected plugin.transform to be a function");
    }

    const result = transformHook.call({} as never, source, polyfillPath) as {
      code: string;
    } | null;

    expect(result).not.toBeNull();
    expect(result?.code).not.toContain("import.meta.resolve");
    expect(result?.code).not.toContain("fetch(");
    expect(result?.code).toContain("Promise.resolve(");
    expect(result?.code).toContain("input.switch");
  });
});
