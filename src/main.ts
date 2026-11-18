import { SwitchyardEngine } from "./engine/simulation.js";
import { SwitchyardDiorama } from "./scene/diorama.js";
import { DispatcherHud } from "./ui/dispatcher-hud.js";
import { ensureWebMcpRuntime } from "./webmcp/runtime.js";
import { registerSwitchyardTools } from "./webmcp/switchyard-tools.js";

async function bootstrap(): Promise<void> {
  // Register WebMCP tools BEFORE Three.js initialization so browser extensions
  // querying `document.modelContext.getTools()` on load discover them immediately.
  ensureWebMcpRuntime();

  const engine = new SwitchyardEngine();
  let hud: DispatcherHud | null = null;

  const unregisterTools = await registerSwitchyardTools(engine, {
    flushUi: () => {
      hud?.flush();
    },
  });

  const canvasHost = document.getElementById("diorama-canvas-host");
  const overlayLayer = document.getElementById("diorama-overlay");

  if (!canvasHost || !overlayLayer) {
    throw new Error("Missing diorama host containers in index.html.");
  }

  const diorama = new SwitchyardDiorama({
    container: canvasHost,
    overlayLayer,
    engine,
  });

  hud = new DispatcherHud(engine);

  window.addEventListener(
    "beforeunload",
    () => {
      unregisterTools();
      hud?.dispose();
      diorama.dispose();
    },
    { once: true },
  );
}

void bootstrap();
