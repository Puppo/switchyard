import type { ActionLogEntry, ActionOrigin } from "../engine/types.js";
import {
  getActiveInvocationOrigin,
  registerSafeTool,
} from "../webmcp/runtime.js";

export type ProbeObjectId = "object-alpha" | "object-beta";

export interface ProbeObjectState {
  readonly id: ProbeObjectId;
  readonly label: string;
  color: string;
}

export interface ProbeSnapshot {
  readonly selectedObjectId: ProbeObjectId | null;
  readonly objects: readonly ProbeObjectState[];
  readonly actionLog: readonly ActionLogEntry[];
}

export class ProbeStore {
  private selectedObjectId: ProbeObjectId | null = null;
  private objects: Record<ProbeObjectId, ProbeObjectState> = {
    "object-alpha": {
      id: "object-alpha",
      label: "Signal Circle",
      color: "#64748b",
    },
    "object-beta": {
      id: "object-beta",
      label: "Relay Square",
      color: "#d97706",
    },
  };
  private actionLog: ActionLogEntry[] = [];
  private nextId = 1;
  private listeners = new Set<(snapshot: ProbeSnapshot) => void>();

  subscribe(listener: (snapshot: ProbeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): ProbeSnapshot {
    return {
      selectedObjectId: this.selectedObjectId,
      objects: [
        { ...this.objects["object-alpha"] },
        { ...this.objects["object-beta"] },
      ],
      actionLog: [...this.actionLog],
    };
  }

  selectObject(
    objectId: ProbeObjectId | null,
    origin: ActionOrigin = "manual",
  ): void {
    if (this.selectedObjectId === objectId) {
      return;
    }
    this.selectedObjectId = objectId;
    this.appendLog(
      origin,
      "select_object",
      { objectId },
      true,
      objectId ? `Selected ${objectId}` : "Cleared object selection",
      { selectedObjectId: objectId },
    );
    this.notify();
  }

  getToolState(origin?: ActionOrigin): {
    readonly selectedObjectId: ProbeObjectId | null;
    readonly objects: readonly ProbeObjectState[];
  } {
    const payload = {
      selectedObjectId: this.selectedObjectId,
      objects: [
        { ...this.objects["object-alpha"] },
        { ...this.objects["object-beta"] },
      ],
    };
    if (origin) {
      this.appendLog(
        origin,
        "get_probe_state",
        {},
        true,
        `selectedObjectId=${payload.selectedObjectId ?? "null"}`,
        payload as unknown as Record<string, unknown>,
      );
      this.notify();
    }
    return payload;
  }

  colorObject(
    rawObjectId: unknown,
    rawColor: unknown,
    origin: ActionOrigin,
  ):
    | {
        readonly ok: true;
        readonly objectId: ProbeObjectId;
        readonly color: string;
      }
    | {
        readonly ok: false;
        readonly code: string;
        readonly error: string;
        readonly retryable: boolean;
      } {
    const normalizedId = normalizeProbeId(rawObjectId);
    if (!normalizedId) {
      const err = {
        ok: false as const,
        code: "INVALID_TARGET",
        retryable: false,
        error: `Unknown object '${String(rawObjectId)}'. Call get_probe_state() first; valid IDs: object-alpha, object-beta.`,
      };
      this.appendLog(
        origin,
        "color_object",
        { objectId: rawObjectId, color: rawColor },
        false,
        err.error,
        err,
      );
      this.notify();
      return err;
    }

    const color = typeof rawColor === "string" ? rawColor.trim() : "";
    if (!color || color.length > 40) {
      const err = {
        ok: false as const,
        code: "INVALID_COLOR",
        retryable: true,
        error: "Provide a valid CSS color name or hex code (1-40 chars).",
      };
      this.appendLog(
        origin,
        "color_object",
        { objectId: normalizedId, color: rawColor },
        false,
        err.error,
        err,
      );
      this.notify();
      return err;
    }

    this.objects[normalizedId].color = color;
    const res = { ok: true as const, objectId: normalizedId, color };
    this.appendLog(
      origin,
      "color_object",
      { objectId: normalizedId, color },
      true,
      `Colored ${normalizedId} -> ${color}`,
      res,
    );
    this.notify();
    return res;
  }

  reset(origin: ActionOrigin = "manual"): void {
    this.selectedObjectId = null;
    this.objects = {
      "object-alpha": {
        id: "object-alpha",
        label: "Signal Circle",
        color: "#64748b",
      },
      "object-beta": {
        id: "object-beta",
        label: "Relay Square",
        color: "#d97706",
      },
    };
    this.appendLog(origin, "reset_probe", {}, true, "Reset probe objects", {});
    this.notify();
  }

  clearLog(): void {
    this.actionLog = [];
    this.notify();
  }

  private appendLog(
    origin: ActionOrigin,
    action: string,
    input: Record<string, unknown>,
    ok: boolean,
    summary: string,
    output: Record<string, unknown>,
  ): void {
    this.actionLog.unshift({
      id: this.nextId++,
      timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      origin,
      action,
      input,
      ok,
      summary,
      output,
    });
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }
}

function normalizeProbeId(raw: unknown): ProbeObjectId | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "object-alpha" || normalized === "alpha") {
    return "object-alpha";
  }
  if (normalized === "object-beta" || normalized === "beta") {
    return "object-beta";
  }
  return null;
}

export async function registerProbeTools(
  store: ProbeStore,
  flushUi?: () => void,
): Promise<() => void> {
  const controller = new AbortController();

  await Promise.all([
    registerSafeTool(
      {
        name: "get_probe_state",
        description:
          "Reads which test object is currently selected and lists available objects with their colors. Use first whenever the user says 'this' or 'that' before coloring an object.",
        annotations: {
          readOnlyHint: true,
        },
        async execute() {
          const origin = getActiveInvocationOrigin();
          const payload = store.getToolState(origin);
          flushUi?.();
          return payload;
        },
      },
      controller,
    ),

    registerSafeTool(
      {
        name: "color_object",
        description:
          "Applies a color to one of the test objects on the probe page. Use after reading the selected object ID when the user asks to recolor an object.",
        inputSchema: {
          type: "object",
          properties: {
            objectId: {
              type: "string",
              enum: ["object-alpha", "object-beta"],
              description: "Target object identifier from get_probe_state",
            },
            color: {
              type: "string",
              description: "CSS color name or hex code to apply",
            },
          },
          required: ["objectId", "color"],
        },
        async execute(input) {
          const origin = getActiveInvocationOrigin();
          const res = store.colorObject(input.objectId, input.color, origin);
          flushUi?.();
          return res;
        },
      },
      controller,
    ),
  ]);

  return () => controller.abort();
}
