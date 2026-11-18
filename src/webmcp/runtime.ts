import { installWebMCP } from "@w3c/webmcp-polyfill";
import type { ActionOrigin } from "../engine/types.js";

export type WebMcpMode =
  | "native"
  | "legacy-bridge"
  | "polyfill"
  | "unavailable";

export interface WebMcpRuntimeInfo {
  readonly mode: WebMcpMode;
  readonly label: string;
  readonly detail: string;
  readonly contextAvailable: boolean;
  readonly isSecureContext: boolean;
  readonly hadNativeDocumentContext: boolean;
  readonly hadLegacyNavigatorContext: boolean;
}

interface LegacyNavigatorWithModelContext {
  modelContext?: {
    registerTool?: (
      tool: WebMCP.ModelContextTool,
      options?: WebMCP.ModelContextRegisterToolOptions,
    ) => Promise<void> | void;
  };
}

let cachedRuntimeInfo: WebMcpRuntimeInfo | null = null;

/**
 * Inspects native/legacy browser globals BEFORE installing `@w3c/webmcp-polyfill`
 * so the UI accurately distinguishes native Chrome WebMCP from JS polyfill mode.
 */
export function ensureWebMcpRuntime(): WebMcpRuntimeInfo {
  const isSecureContext =
    typeof window !== "undefined" && Boolean(window.isSecureContext);
  const hasDocument = typeof document !== "undefined";
  const hadNativeDocumentContext =
    hasDocument && "modelContext" in document && Boolean(document.modelContext);
  const legacyContext = getLegacyNavigatorContext();
  const hadLegacyNavigatorContext = Boolean(legacyContext);

  if (cachedRuntimeInfo && hasDocument && document.modelContext) {
    return cachedRuntimeInfo;
  }

  if (isSecureContext && hasDocument && !hadNativeDocumentContext) {
    installWebMCP();
  }

  const contextAvailable = hasDocument && Boolean(document.modelContext);

  let mode: WebMcpMode = "unavailable";
  let label = "WebMCP Unavailable";
  let detail =
    "WebMCP requires a secure context (https:// or localhost). Tools cannot register here.";

  if (hadNativeDocumentContext && contextAvailable) {
    mode = "native";
    label = "WebMCP Native Active";
    detail =
      "Chrome native document.modelContext is active. External browser agents and DevTools WebMCP can inspect and invoke tools directly.";
  } else if (contextAvailable && hadLegacyNavigatorContext) {
    mode = "legacy-bridge";
    label = "Legacy navigator.modelContext Bridge";
    detail =
      "Browser exposed navigator.modelContext; polyfill installed document.modelContext and registrations are mirrored.";
  } else if (contextAvailable) {
    mode = "polyfill";
    label = "Polyfill Mode · Enable Chrome Flag";
    detail =
      "Running via @w3c/webmcp-polyfill in the page JS world. Isolated Chrome extensions (such as Model Context Tool Inspector) require enabling chrome://flags/#enable-webmcp-testing and relaunching Chrome.";
  }

  cachedRuntimeInfo = {
    mode,
    label,
    detail,
    contextAvailable,
    isSecureContext,
    hadNativeDocumentContext,
    hadLegacyNavigatorContext,
  };

  return cachedRuntimeInfo;
}

/** Resets cached runtime detection (intended for isolated unit tests). */
export function resetWebMcpRuntimeCacheForTests(): void {
  cachedRuntimeInfo = null;
}

export function getActiveInvocationOrigin(): ActionOrigin {
  return "webmcp";
}

export interface SafeToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: WebMCP.ToolAnnotations;
  readonly execute: (
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown> | unknown;
}

/**
 * Registers a tool with `document.modelContext` (and mirrors to legacy
 * `navigator.modelContext` if present at registration or injected by `window.onload`),
 * omitting `title` and unnecessary schema wrappers for Gemini / Inspector compatibility.
 */
export async function registerSafeTool(
  spec: SafeToolSpec,
  controller: AbortController,
): Promise<boolean> {
  const runtime = ensureWebMcpRuntime();
  if (!runtime.contextAvailable || !document.modelContext) {
    return false;
  }

  const wrappedTool: WebMCP.ModelContextTool = {
    name: spec.name,
    description: spec.description,
    ...(spec.inputSchema !== undefined
      ? { inputSchema: spec.inputSchema }
      : {}),
    ...(spec.annotations ? { annotations: spec.annotations } : {}),
    async execute(
      rawInput: unknown,
      options?: WebMCP.ToolExecuteCallbackOptions,
    ) {
      try {
        const parsed = normalizeToolInput(rawInput);
        if (parsed.error) {
          return parsed.error;
        }
        return await spec.execute(parsed.value, options?.signal);
      } catch (err) {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          retryable: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  await document.modelContext.registerTool(wrappedTool, {
    signal: controller.signal,
  });

  await mirrorToLegacyNavigator(wrappedTool, controller.signal);

  if (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    document.readyState !== "complete" &&
    !getLegacyNavigatorContext()
  ) {
    window.addEventListener(
      "load",
      () => {
        if (!controller.signal.aborted) {
          void mirrorToLegacyNavigator(wrappedTool, controller.signal);
        }
      },
      { once: true, signal: controller.signal },
    );
  }

  return true;
}

function getLegacyNavigatorContext():
  | LegacyNavigatorWithModelContext["modelContext"]
  | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return (navigator as unknown as LegacyNavigatorWithModelContext).modelContext;
}

async function mirrorToLegacyNavigator(
  tool: WebMCP.ModelContextTool,
  signal: AbortSignal,
): Promise<void> {
  const legacy = getLegacyNavigatorContext();
  if (
    !legacy ||
    legacy === (document.modelContext as unknown) ||
    typeof legacy.registerTool !== "function"
  ) {
    return;
  }
  try {
    await legacy.registerTool(tool, { signal });
  } catch {
    try {
      await legacy.registerTool(tool);
    } catch {
      // Ignore legacy bridge registration errors so document.modelContext stays functional.
    }
  }
}

function normalizeToolInput(
  rawInput: unknown,
):
  | { readonly value: Record<string, unknown>; readonly error?: undefined }
  | { readonly error: Record<string, unknown> } {
  if (rawInput === undefined || rawInput === null) {
    return { value: {} };
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return { value: {} };
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { value: parsed as Record<string, unknown> };
      }
    } catch {
      return {
        error: {
          ok: false,
          code: "INVALID_TARGET",
          retryable: true,
          error: "Tool arguments must be a valid JSON object.",
        },
      };
    }
  }
  if (typeof rawInput === "object" && !Array.isArray(rawInput)) {
    return { value: rawInput as Record<string, unknown> };
  }
  return {
    error: {
      ok: false,
      code: "INVALID_TARGET",
      retryable: true,
      error: "Tool arguments must be an object.",
    },
  };
}
