import { formatSerializedOutput } from "./shared.js";

export interface InspectorPresetAction {
  readonly label: string;
  readonly run: () => Promise<string>;
}

export interface MountWebMcpInspectorOptions {
  readonly container: HTMLElement;
  readonly defaultInputs?: Readonly<Record<string, Record<string, unknown>>>;
  readonly presetAction?: InspectorPresetAction;
}

/**
 * Mounts an in-page WebMCP inspector inside a native `<details>` drawer.
 * Discovers tools via `document.modelContext.getTools()` and executes them
 * via `document.modelContext.executeTool()`.
 */
export function mountWebMcpInspector(
  options: MountWebMcpInspectorOptions,
): () => void {
  const { container, defaultInputs = {}, presetAction } = options;
  container.replaceChildren();

  const details = document.createElement("details");
  details.className = "card inspector-details";

  const summary = document.createElement("summary");
  summary.textContent = "WebMCP Inspector (document.modelContext)";

  const body = document.createElement("div");
  body.className = "inspector-body";

  const toolbar = document.createElement("div");
  toolbar.className = "btn-row";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "btn btn-sm";
  refreshBtn.textContent = "Refresh Tools";
  toolbar.appendChild(refreshBtn);

  const presetOutput = document.createElement("pre");
  presetOutput.className = "tool-output mono";
  presetOutput.hidden = true;

  if (presetAction) {
    const presetBtn = document.createElement("button");
    presetBtn.type = "button";
    presetBtn.className = "btn btn-sm btn-primary";
    presetBtn.textContent = presetAction.label;
    presetBtn.addEventListener("click", async () => {
      presetBtn.disabled = true;
      presetOutput.hidden = false;
      presetOutput.textContent = "Running WebMCP tool sequence...";
      try {
        const resultText = await presetAction.run();
        presetOutput.textContent = resultText;
      } catch (err) {
        presetOutput.textContent = `Execution error: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        presetBtn.disabled = false;
      }
    });
    toolbar.appendChild(presetBtn);
  }

  const toolsContainer = document.createElement("div");
  toolsContainer.className = "inspector-body";

  body.append(toolbar, presetOutput, toolsContainer);
  details.append(summary, body);
  container.appendChild(details);

  const renderTools = async () => {
    const ctx = document.modelContext;
    if (!ctx) {
      summary.textContent = "WebMCP Inspector (unavailable)";
      toolsContainer.textContent =
        "document.modelContext is not available in this context.";
      return;
    }

    const tools = await ctx.getTools();
    summary.textContent = `WebMCP Inspector (${tools.length} tools)`;
    toolsContainer.replaceChildren();

    if (tools.length === 0) {
      const empty = document.createElement("p");
      empty.className = "helper-note";
      empty.textContent = "No tools currently registered.";
      toolsContainer.appendChild(empty);
      return;
    }

    for (const tool of tools) {
      const card = document.createElement("div");
      card.className = "tool-card";

      const titleRow = document.createElement("div");
      titleRow.className = "card-header-row";

      const nameEl = document.createElement("code");
      nameEl.className = "tool-name";
      nameEl.textContent = tool.name;
      titleRow.appendChild(nameEl);

      if (tool.annotations?.readOnlyHint) {
        const hint = document.createElement("span");
        hint.className = "pill pill-ok";
        hint.textContent = "readOnlyHint";
        titleRow.appendChild(hint);
      }

      const desc = document.createElement("p");
      desc.className = "tool-desc";
      desc.textContent = tool.description;

      const inputId = `tool-args-${tool.name}`;
      const label = document.createElement("label");
      label.htmlFor = inputId;
      label.className = "grounding-label";
      label.textContent = "Arguments (JSON)";

      const textarea = document.createElement("textarea");
      textarea.id = inputId;
      textarea.className = "tool-textarea";
      textarea.value = JSON.stringify(defaultInputs[tool.name] ?? {}, null, 2);

      const actionRow = document.createElement("div");
      actionRow.className = "btn-row";
      actionRow.style.marginTop = "0.375rem";

      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "btn btn-sm";
      runBtn.textContent = `Execute ${tool.name}`;
      actionRow.appendChild(runBtn);

      const outputPre = document.createElement("pre");
      outputPre.className = "tool-output mono";
      outputPre.hidden = true;

      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true;
        outputPre.hidden = false;
        try {
          const parsed = JSON.parse(textarea.value || "{}") as Record<
            string,
            unknown
          >;
          const serialized = await ctx.executeTool(tool, parsed);
          outputPre.textContent = formatSerializedOutput(serialized);
        } catch (err) {
          outputPre.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          runBtn.disabled = false;
        }
      });

      card.append(titleRow, desc, label, textarea, actionRow, outputPre);
      toolsContainer.appendChild(card);
    }
  };

  const onToolChange = () => {
    void renderTools();
  };

  refreshBtn.addEventListener("click", () => {
    void renderTools();
  });

  document.modelContext?.addEventListener("toolchange", onToolChange);
  void renderTools();

  return () => {
    document.modelContext?.removeEventListener("toolchange", onToolChange);
  };
}
