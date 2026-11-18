import type { ActionLogEntry } from "../engine/types.js";
import type { WebMcpRuntimeInfo } from "../webmcp/runtime.js";

/** Conditionally loads `input-switch-polyfill` only when native `<input switch>` is absent. */
export function ensureSwitchControlPolyfill(): void {
  if (
    typeof HTMLInputElement !== "undefined" &&
    !("switch" in HTMLInputElement.prototype)
  ) {
    void import("input-switch-polyfill");
  }
}

export function renderRuntimeBadge(
  badgeEl: HTMLElement,
  info: WebMcpRuntimeInfo,
): void {
  badgeEl.textContent = info.label;
  badgeEl.title = info.detail;
  badgeEl.className = "pill";

  if (info.mode === "native") {
    badgeEl.classList.add("pill-ok");
  } else if (info.mode === "legacy-bridge" || info.mode === "polyfill") {
    badgeEl.classList.add("pill-blue");
  } else {
    badgeEl.classList.add("pill-err");
  }
}

export function renderActionLogList(
  listEl: HTMLUListElement,
  entries: readonly ActionLogEntry[],
  emptyText: string,
): void {
  listEl.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "log-item";
    empty.textContent = emptyText;
    listEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "log-item";
    li.dataset.ok = String(entry.ok);

    const meta = document.createElement("div");
    meta.className = "log-meta";

    const idSpan = document.createElement("span");
    idSpan.className = "mono";
    idSpan.textContent = `#${entry.id} ${entry.timestamp}`;

    const originBadge = document.createElement("span");
    originBadge.className = "pill";
    if (entry.origin === "webmcp") {
      originBadge.classList.add("pill-blue");
      originBadge.textContent = "WEBMCP";
    } else if (entry.origin === "system") {
      originBadge.textContent = "SYSTEM";
    } else {
      originBadge.textContent = "MANUAL";
    }

    const actionCode = document.createElement("code");
    actionCode.textContent = entry.action;

    const statusBadge = document.createElement("span");
    statusBadge.className = entry.ok ? "pill pill-ok" : "pill pill-err";
    statusBadge.textContent = entry.ok ? "OK" : "BLOCKED";

    meta.append(idSpan, originBadge, actionCode, statusBadge);

    const summary = document.createElement("p");
    summary.className = "log-summary";
    summary.textContent = entry.summary;

    li.append(meta, summary);
    listEl.appendChild(li);
  }
}

export function formatSerializedOutput(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
