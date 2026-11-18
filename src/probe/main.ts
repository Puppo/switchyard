import { renderActionLogList, renderRuntimeBadge } from "../ui/shared.js";
import { mountWebMcpInspector } from "../ui/webmcp-inspector.js";
import { ensureWebMcpRuntime } from "../webmcp/runtime.js";
import { type ProbeSnapshot, ProbeStore, registerProbeTools } from "./tools.js";

async function bootstrapProbe(): Promise<void> {
  const runtime = ensureWebMcpRuntime();
  const badgeEl = document.getElementById("probe-runtime-badge");
  if (badgeEl) {
    renderRuntimeBadge(badgeEl, runtime);
  }

  const store = new ProbeStore();

  const selValEl = document.getElementById("probe-selection-value");
  const clearSelBtn = document.getElementById(
    "probe-clear-sel-btn",
  ) as HTMLButtonElement | null;
  const resetBtn = document.getElementById("probe-reset-btn");
  const clearLogBtn = document.getElementById("probe-clear-log-btn");
  const btnAlpha = document.getElementById("probe-btn-alpha");
  const btnBeta = document.getElementById("probe-btn-beta");
  const shapeAlpha = document.getElementById("probe-shape-alpha");
  const shapeBeta = document.getElementById("probe-shape-beta");
  const colorAlpha = document.getElementById("probe-color-alpha");
  const colorBeta = document.getElementById("probe-color-beta");
  const statusBanner = document.getElementById("probe-status-banner");
  const logList = document.getElementById(
    "probe-log-list",
  ) as HTMLUListElement | null;
  const inspectorHost = document.getElementById("probe-inspector-host");

  const render = (snap: ProbeSnapshot) => {
    if (selValEl) {
      selValEl.textContent = snap.selectedObjectId ?? "null";
    }
    if (clearSelBtn) {
      clearSelBtn.disabled = snap.selectedObjectId === null;
    }
    btnAlpha?.setAttribute(
      "aria-pressed",
      String(snap.selectedObjectId === "object-alpha"),
    );
    btnBeta?.setAttribute(
      "aria-pressed",
      String(snap.selectedObjectId === "object-beta"),
    );

    const alpha = snap.objects.find((o) => o.id === "object-alpha");
    const beta = snap.objects.find((o) => o.id === "object-beta");
    if (alpha && shapeAlpha && colorAlpha) {
      shapeAlpha.style.backgroundColor = alpha.color;
      colorAlpha.textContent = alpha.color;
    }
    if (beta && shapeBeta && colorBeta) {
      shapeBeta.style.backgroundColor = beta.color;
      colorBeta.textContent = beta.color;
    }
    if (logList) {
      renderActionLogList(
        logList,
        snap.actionLog,
        "No probe events yet. Select an object and invoke an agent or WebMCP Inspector.",
      );
    }
  };

  render(store.getSnapshot());
  store.subscribe(render);

  btnAlpha?.addEventListener("click", () => {
    store.selectObject("object-alpha", "manual");
    if (statusBanner) {
      statusBanner.textContent =
        "Selected object-alpha. Now ask your browser agent: 'Color this green.'";
    }
  });
  btnBeta?.addEventListener("click", () => {
    store.selectObject("object-beta", "manual");
    if (statusBanner) {
      statusBanner.textContent =
        "Selected object-beta. Now ask your browser agent: 'Color this green.'";
    }
  });
  clearSelBtn?.addEventListener("click", () => {
    store.selectObject(null, "manual");
  });
  resetBtn?.addEventListener("click", () => {
    store.reset("manual");
    if (statusBanner) {
      statusBanner.textContent = "Probe reset.";
    }
  });
  clearLogBtn?.addEventListener("click", () => {
    store.clearLog();
  });

  const disposeTools = await registerProbeTools(store, () => {
    render(store.getSnapshot());
  });

  const disposeInspector = inspectorHost
    ? mountWebMcpInspector({
        container: inspectorHost,
        defaultInputs: {
          get_probe_state: {},
          color_object: { objectId: "object-alpha", color: "green" },
        },
      })
    : () => {};

  window.addEventListener(
    "beforeunload",
    () => {
      disposeTools();
      disposeInspector();
    },
    { once: true },
  );
}

void bootstrapProbe();
