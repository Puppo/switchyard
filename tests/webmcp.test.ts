import { beforeEach, describe, expect, it } from "vitest";
import { SwitchyardEngine } from "../src/engine/simulation.js";
import { ProbeStore, registerProbeTools } from "../src/probe/tools.js";
import {
  ensureWebMcpRuntime,
  resetWebMcpRuntimeCacheForTests,
} from "../src/webmcp/runtime.js";
import { registerSwitchyardTools } from "../src/webmcp/switchyard-tools.js";

function requireModelContext() {
  const modelContext = document.modelContext;
  if (!modelContext) {
    throw new Error("Expected document.modelContext to be registered");
  }
  return modelContext;
}

function findRegisteredTool<T extends { name: string }>(
  tools: readonly T[],
  name: string,
): T {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Expected WebMCP tool "${name}" to be registered`);
  }
  return tool;
}

describe("WebMCP integration (@w3c/webmcp-polyfill)", () => {
  beforeEach(() => {
    resetWebMcpRuntimeCacheForTests();
  });

  it("registers Gemini/Chrome-compatible Switchyard tools and executes multi-annotation Run 1", async () => {
    const runtime = ensureWebMcpRuntime();
    expect(runtime.contextAvailable).toBe(true);
    expect(runtime.mode).toBe("polyfill");
    const modelContext = requireModelContext();

    const engine = new SwitchyardEngine();
    const unregister = await registerSwitchyardTools(engine);

    try {
      const tools = await modelContext.getTools();
      expect(tools.map((t) => t.name)).toEqual([
        "get_scene",
        "move_train",
        "set_switch",
      ]);

      for (const tool of tools) {
        expect(tool.name.length).toBeLessThanOrEqual(30);
        expect(tool.description.length).toBeLessThanOrEqual(500);
        const schema = tool.inputSchema as
          | {
              additionalProperties?: unknown;
              properties?: Record<string, { description?: string }>;
            }
          | undefined;
        // Ensure additionalProperties is omitted for Gemini / Chrome Inspector compatibility
        expect(schema?.additionalProperties).toBeUndefined();
        for (const [paramName, prop] of Object.entries(
          schema?.properties ?? {},
        )) {
          expect(paramName.length).toBeLessThanOrEqual(30);
          expect((prop.description ?? "").length).toBeLessThanOrEqual(150);
        }
      }

      const getSceneTool = findRegisteredTool(tools, "get_scene");
      const setSwitchTool = findRegisteredTool(tools, "set_switch");
      const moveTrainTool = findRegisteredTool(tools, "move_train");

      // Zero-arg get_scene omits inputSchema completely; readOnlyHint is strictly opt-in.
      expect(getSceneTool.inputSchema).toBeUndefined();
      expect(getSceneTool.annotations?.readOnlyHint).toBe(true);
      expect(getSceneTool.annotations?.consequentialHint).not.toBe(true);
      expect(setSwitchTool.annotations).toBeUndefined();
      expect(moveTrainTool.annotations).toBeUndefined();

      // Add multiple ordered annotations with optional notes
      engine.toggleAnnotation("yellow", "move this consist");
      engine.toggleAnnotation("platform-a", "park here");
      engine.toggleAnnotation("blue", "dispatch first");
      engine.toggleAnnotation("main-switch", "align after blue leaves");

      // Verify payload stays within <= 1,500 chars even with 4 annotated entities
      const payloadJson = JSON.stringify(engine.getScenePayload());
      expect(payloadJson.length).toBeLessThanOrEqual(1500);

      // Execute full Run 1 via document.modelContext.executeTool
      const sceneStr = await modelContext.executeTool(getSceneTool, {});
      const scene = JSON.parse(sceneStr);
      expect(scene.selectedTrainId).toBe("yellow");
      expect(scene.pinnedDestinationId).toBe("platform-a");
      expect(
        scene.trains.find((t: { id: string }) => t.id === "blue")
          ?.dedicatedExitId,
      ).toBeUndefined();
      expect(scene.annotations).toHaveLength(4);
      expect(scene.annotations[0]).toMatchObject({
        pin: "#1",
        entityId: "yellow",
        note: "move this consist",
      });

      const blueStr = await modelContext.executeTool(moveTrainTool, {
        trainId: "blue",
        destinationId: "regional-exit",
      });
      expect(JSON.parse(blueStr)).toMatchObject({
        ok: true,
        status: "arrived",
        arrivedAtTrackId: "regional-exit",
      });

      const swStr = await modelContext.executeTool(setSwitchTool, {
        switchId: "main-switch",
        branchId: "platform-a",
      });
      expect(JSON.parse(swStr)).toMatchObject({
        ok: true,
        activeBranchId: "platform-a",
      });

      const yellowStr = await modelContext.executeTool(moveTrainTool, {
        trainId: "yellow",
        destinationId: "platform-a",
      });
      expect(JSON.parse(yellowStr)).toMatchObject({
        ok: true,
        status: "arrived",
        arrivedAtTrackId: "platform-a",
      });

      const log = engine.getSnapshot().actionLog;
      expect(log.every((e) => e.origin === "webmcp")).toBe(true);
      expect(log.some((e) => e.action === "get_scene")).toBe(true);
      expect(log.some((e) => e.action === "set_switch")).toBe(true);
      expect(log.some((e) => e.action === "move_train")).toBe(true);
    } finally {
      unregister();
    }

    const afterCleanup = await modelContext.getTools();
    expect(afterCleanup).toHaveLength(0);
  });

  it("resolves structured actionable errors (never rejecting) for missing selection/closed branch", async () => {
    ensureWebMcpRuntime();
    const modelContext = requireModelContext();
    const engine = new SwitchyardEngine();
    const unregister = await registerSwitchyardTools(engine);

    try {
      const tools = await modelContext.getTools();
      const getSceneTool = findRegisteredTool(tools, "get_scene");
      const moveTrainTool = findRegisteredTool(tools, "move_train");

      const emptyScene = JSON.parse(
        await modelContext.executeTool(getSceneTool, {}),
      );
      expect(emptyScene.annotations).toEqual([]);
      expect(emptyScene.selectedTrainId).toBeNull();
      expect(emptyScene.pinnedDestinationId).toBeNull();

      engine.setTrackClosed("platform-b", true, "manual");
      const closedErr = JSON.parse(
        await modelContext.executeTool(moveTrainTool, {
          trainId: "yellow",
          destinationId: "platform-b",
        }),
      );
      expect(closedErr).toMatchObject({
        ok: false,
        code: "TRACK_CLOSED",
        blockedTrackId: "platform-b",
        retryable: false,
      });
      expect(engine.getSnapshot().trains.yellow.trackId).toBe("entry");
    } finally {
      unregister();
    }
  });

  it("supports Step 1 Browser Probe tools (get_probe_state and color_object)", async () => {
    ensureWebMcpRuntime();
    const modelContext = requireModelContext();
    const store = new ProbeStore();
    const unregister = await registerProbeTools(store);

    try {
      const tools = await modelContext.getTools();
      expect(tools.map((t) => t.name)).toEqual([
        "color_object",
        "get_probe_state",
      ]);

      const getStateTool = findRegisteredTool(tools, "get_probe_state");
      const colorTool = findRegisteredTool(tools, "color_object");

      expect(getStateTool.inputSchema).toBeUndefined();
      expect(getStateTool.annotations?.readOnlyHint).toBe(true);
      expect(
        (colorTool.inputSchema as { additionalProperties?: unknown })
          ?.additionalProperties,
      ).toBeUndefined();
      expect(colorTool.annotations).toBeUndefined();

      store.selectObject("object-beta", "manual");

      const stateRaw = await modelContext.executeTool(getStateTool, {});
      expect(JSON.parse(stateRaw).selectedObjectId).toBe("object-beta");

      const colorRaw = await modelContext.executeTool(colorTool, {
        objectId: "object-beta",
        color: "green",
      });
      expect(JSON.parse(colorRaw)).toEqual({
        ok: true,
        objectId: "object-beta",
        color: "green",
      });

      const log = store.getSnapshot().actionLog;
      expect(log[0]).toMatchObject({
        origin: "webmcp",
        action: "color_object",
        ok: true,
      });
    } finally {
      unregister();
    }
  });
});
