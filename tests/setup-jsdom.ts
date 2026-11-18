// Aligns Vitest's jsdom global environment with browser Window/SecureContext/AbortSignal.any semantics
// before @w3c/webmcp-polyfill evaluates top-level descriptors.
if (typeof window !== "undefined") {
  if (!window.isSecureContext) {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
  }

  const desc = Object.getOwnPropertyDescriptor(globalThis, "window");
  if (!desc?.get && (!desc || desc.configurable)) {
    const winRef = window;
    Object.defineProperty(globalThis, "window", {
      get: () => winRef,
      enumerable: true,
      configurable: true,
    });
  }

  if (typeof AbortSignal.any !== "function") {
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      writable: true,
      value: (signals: Iterable<AbortSignal>) => {
        const composite = new AbortController();
        for (const sig of signals) {
          if (sig.aborted) {
            composite.abort(sig.reason);
            break;
          }
          sig.addEventListener("abort", () => composite.abort(sig.reason), {
            once: true,
          });
        }
        return composite.signal;
      },
    });
  }
}
