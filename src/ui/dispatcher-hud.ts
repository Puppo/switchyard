import type { SwitchyardEngine } from "../engine/simulation.js";
import type { EngineSnapshot } from "../engine/types.js";
import { ensureWebMcpRuntime } from "../webmcp/runtime.js";
import { ensureSwitchControlPolyfill, renderActionLogList } from "./shared.js";

const CHROME_WEBMCP_FLAG = "chrome://flags/#enable-webmcp-testing";

export class DispatcherHud {
  private readonly engine: SwitchyardEngine;
  private readonly unsubscribe: () => void;

  private readonly runtimeBtn: HTMLButtonElement;
  private readonly runtimePopover: HTMLElement;
  private readonly runtimeDetailEl: HTMLElement;
  private readonly copyFlagBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly closeBranchBSwitch: HTMLInputElement;
  private readonly closeBranchBState: HTMLElement;
  private readonly annotationsSummaryEl: HTMLElement;
  private readonly clearAnnotationsBtn: HTMLButtonElement;
  private readonly liveStatusEl: HTMLElement;
  private readonly logSummaryEl: HTMLElement;
  private readonly logListEl: HTMLUListElement;
  private readonly clearLogBtn: HTMLButtonElement;

  constructor(engine: SwitchyardEngine) {
    this.engine = engine;
    ensureSwitchControlPolyfill();

    this.runtimeBtn = requireEl<HTMLButtonElement>("#webmcp-runtime-btn");
    this.runtimePopover = requireEl("#webmcp-runtime-popover");
    this.runtimeDetailEl = requireEl("#webmcp-runtime-detail");
    this.copyFlagBtn = requireEl<HTMLButtonElement>("#copy-flag-btn");
    this.resetBtn = requireEl<HTMLButtonElement>("#reset-scenario-btn");
    this.closeBranchBSwitch = requireEl<HTMLInputElement>("#close-branch-b");
    this.closeBranchBState = requireEl("#close-branch-b-state");
    this.annotationsSummaryEl = requireEl("#annotations-summary-text");
    this.clearAnnotationsBtn = requireEl<HTMLButtonElement>(
      "#clear-annotations-btn",
    );
    this.liveStatusEl = requireEl("#hud-status-live");
    this.logSummaryEl = requireEl("#log-summary");
    this.logListEl = requireEl<HTMLUListElement>("#action-log-list");
    this.clearLogBtn = requireEl<HTMLButtonElement>("#clear-log-btn");

    this.renderRuntimeStatus();
    this.bindEvents();

    this.render(this.engine.getSnapshot());
    this.unsubscribe = this.engine.subscribe((snapshot) => {
      this.render(snapshot);
    });
  }

  flush(): void {
    this.render(this.engine.getSnapshot());
  }

  dispose(): void {
    this.unsubscribe();
  }

  private renderRuntimeStatus(): void {
    const info = ensureWebMcpRuntime();
    this.runtimeBtn.className = "pill pill-btn";
    if (info.mode === "native") {
      this.runtimeBtn.classList.add("pill-ok");
      this.runtimeBtn.textContent = `● ${info.label}`;
    } else if (info.mode === "polyfill") {
      this.runtimeBtn.classList.add("pill-warn");
      this.runtimeBtn.textContent = `⚠ ${info.label}`;
    } else if (info.mode === "legacy-bridge") {
      this.runtimeBtn.classList.add("pill-blue");
      this.runtimeBtn.textContent = `● ${info.label}`;
    } else {
      this.runtimeBtn.classList.add("pill-err");
      this.runtimeBtn.textContent = info.label;
    }
    this.runtimeDetailEl.textContent = info.detail;
  }

  private bindEvents(): void {
    this.runtimeBtn.addEventListener("click", () => {
      const nextOpen = this.runtimePopover.hidden;
      this.runtimePopover.hidden = !nextOpen;
      this.runtimeBtn.setAttribute("aria-expanded", String(nextOpen));
    });

    this.copyFlagBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard?.writeText(CHROME_WEBMCP_FLAG);
        this.copyFlagBtn.textContent = "Copied";
        setTimeout(() => {
          this.copyFlagBtn.textContent = "Copy Flag";
        }, 1200);
      } catch {
        this.liveStatusEl.textContent = `Copy flag: ${CHROME_WEBMCP_FLAG}`;
      }
    });

    this.resetBtn.addEventListener("click", () => {
      this.engine.reset();
      this.liveStatusEl.textContent =
        "Scenario reset to initial yard positions.";
    });

    this.clearAnnotationsBtn.addEventListener("click", () => {
      this.engine.clearAnnotations();
      this.liveStatusEl.textContent = "Cleared all context annotations.";
    });

    this.closeBranchBSwitch.addEventListener("change", () => {
      const res = this.engine.setTrackClosed(
        "platform-b",
        this.closeBranchBSwitch.checked,
        "manual",
      );
      if (!res.ok) {
        this.closeBranchBSwitch.checked = !this.closeBranchBSwitch.checked;
        this.liveStatusEl.textContent = res.error;
      } else {
        this.liveStatusEl.textContent = res.closed
          ? "Branch B closed."
          : "Branch B reopened.";
      }
    });

    this.clearLogBtn.addEventListener("click", () => {
      this.engine.clearLog();
    });
  }

  private render(snapshot: EngineSnapshot): void {
    // 1. Branch B barrier state
    const branchB = snapshot.tracks["platform-b"];
    this.closeBranchBSwitch.checked = branchB.closed;
    this.closeBranchBSwitch.disabled =
      branchB.occupiedBy !== null || branchB.reservedBy !== null;
    this.closeBranchBState.className = branchB.closed
      ? "pill pill-err"
      : "pill pill-ok";
    this.closeBranchBState.textContent = branchB.closed ? "CLOSED" : "OPEN";

    // 2. Minimal bottom-left pin count pill
    const count = snapshot.annotations.length;
    this.annotationsSummaryEl.textContent =
      count === 0
        ? "Click any train, platform, track, or switch in 3D to drop #1, #2… pins"
        : `${count} ${count === 1 ? "pin" : "pins"} active on diorama — edit notes directly on the pins`;
    this.clearAnnotationsBtn.hidden = count === 0;

    // 3. WebMCP-only live call log
    const webmcpEntries = snapshot.actionLog.filter(
      (entry) => entry.origin === "webmcp",
    );
    this.logSummaryEl.textContent = `WebMCP Call Log (${webmcpEntries.length})`;
    renderActionLogList(
      this.logListEl,
      webmcpEntries,
      "Waiting for WebMCP agent calls (get_scene, set_switch, move_train)…",
    );
  }
}

function requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing required DOM element: ${selector}`);
  }
  return el;
}
