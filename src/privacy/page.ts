import type {
  Detection,
  ModelStatus,
  PrivacyBridge,
  ReviewSession,
} from "./types";
import "../styles/review.css";

const EXAMPLE =
  "Alex Morgan attended a review in Bristol on 12 March 2026. Alex Morgan reported improved sleep and no change to the prescribed 10 mg dose. Contact: alex.morgan@example.invalid. Case reference: SYN-2048.";

const DECISION_LABEL = {
  pending: "pending",
  accept: "accepted",
  edit: "edited",
  keep: "kept",
  remove: "removed",
};
const STAGE_LABEL: Record<string, string> = {
  ner: "local model",
  rules: "identifier patterns",
  manual: "manual selection",
};

export class TextReviewPage {
  private source = "";
  private session: ReviewSession | null = null;
  private model: ModelStatus | null = null;
  private drafts = new Map<number, string>();
  private busy = false;
  private operation = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  private dismissDiscard?: () => void;
  private selection: { start: number; end: number } | null = null;
  private message = "";
  private error = "";
  constructor(
    private root: HTMLElement,
    private bridge: PrivacyBridge,
    private onHome: () => void,
  ) {}

  async mount(): Promise<void> {
    this.render();
    if (!this.bridge.available) return;
    try {
      const unsubscribe = await this.bridge.progress((event) => {
        if (this.disposed || event.operation !== this.operation || !this.busy)
          return;
        this.message = event.total
          ? `${event.stage} · ${Math.floor((100 * event.completed) / event.total)}%`
          : event.stage;
        this.updateStatus();
      });
      if (this.disposed) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
      this.model = await this.bridge.call<ModelStatus>("model_status");
    } catch {
      this.error = "Model status is unavailable. Reopen this page to retry.";
    }
    if (!this.disposed) this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.dismissDiscard?.();
    this.unsubscribe?.();
    this.source = "";
    this.session = null;
    this.selection = null;
    this.drafts.clear();
    this.root.replaceChildren();
  }
  private el<T extends Element>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }
  private bind(selector: string, action: () => void): void {
    this.el(selector).addEventListener("click", action);
  }
  private updateStatus(): void {
    if (this.disposed) return;
    this.el<HTMLElement>("[data-status]").textContent = this.message;
    this.el<HTMLElement>("[data-error]").textContent = this.error;
  }
  private render(): void {
    // A model-status reply must not replace an open confirmation dialog.
    if (this.disposed || this.dismissDiscard) return;
    this.root.innerHTML = `
      <section class="review-page" aria-labelledby="review-title">
        <nav class="review-nav" aria-label="Application"><button type="button" data-home>← Home</button><span>Clinician’s Veil</span><span class="local-indicator">On this Mac</span></nav>
        <header class="review-heading"><div><p class="eyebrow">Text workspace</p><h1 id="review-title">De-identify text</h1><p>Find possible identifiers. Review each change. Keep the wording that matters.</p></div><button type="button" data-discard>Discard session</button></header>
        <aside class="model-panel" aria-label="Local detection model"><div><strong data-model-title></strong><p data-model-description></p></div><button type="button" data-install>Download model</button></aside>
        <p class="review-status" role="status" data-status></p><p class="review-error" role="alert" data-error></p>
        <div class="review-toolbar"><p>Source text and replacements stay in this session. Nothing is saved.</p><button type="button" data-cancel hidden>Cancel processing</button></div>
        <div data-workspace></div>
        <aside class="scope-note"><strong>What this check covers</strong><p>Identifier patterns and possible names, places and organisations. Initials, nicknames, misspellings and parts of organisation names can be missed; model proposals can include clinical terms. File paths and indirect identifying combinations are not checked in this version. Review the whole text, including unmarked phrases.</p></aside>
      </section>`;
    this.bind("[data-home]", () => {
      void this.leave(true);
    });
    this.bind("[data-discard]", () => {
      void this.leave(false);
    });
    this.bind("[data-install]", () => {
      void this.install();
    });
    this.bind("[data-cancel]", () => {
      void this.cancel();
    });
    const ready = this.model?.installed === true;
    this.el<HTMLElement>("[data-model-title]").textContent = ready
      ? "Local detection is ready"
      : "Set up local detection";
    this.el<HTMLElement>("[data-model-description]").textContent = !this.bridge
      .available
      ? "Open the macOS app to download the model and process text. This browser preview does not run detection."
      : ready
        ? "Rules + BERT NER · English · Works offline"
        : "Download BERT NER once (110 MB) from Hugging Face. Only model files are downloaded; source text is never sent.";
    this.el<HTMLButtonElement>("[data-install]").textContent = ready
      ? "Verify / repair model"
      : "Download model";
    this.el<HTMLButtonElement>("[data-install]").disabled =
      this.busy || !this.bridge.available || !this.model;
    this.el<HTMLButtonElement>("[data-cancel]").hidden = !this.busy;
    this.el<HTMLButtonElement>("[data-home]").disabled = this.busy;
    this.el<HTMLButtonElement>("[data-discard]").disabled = this.busy;
    if (this.session) this.renderReview(this.session);
    else this.renderInput(ready);
    this.updateStatus();
  }
  private renderInput(ready: boolean): void {
    this.el("[data-workspace]").innerHTML =
      `<section class="input-panel"><div class="pane-heading"><label for="source-input">Source text</label><button type="button" data-example>Use synthetic example</button></div>
      <textarea id="source-input" rows="12" placeholder="Type or paste the text you want to review…" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" aria-describedby="source-count"></textarea>
      <div class="pane-footer"><span id="source-count"></span><button type="button" class="primary" data-detect>Find identifiers</button></div></section>`;
    const input = this.el<HTMLTextAreaElement>("#source-input");
    input.value = this.source;
    input.disabled = this.busy;
    this.el<HTMLButtonElement>("[data-example]").disabled = this.busy;
    const count = () => {
      const length = Array.from(this.source).length;
      this.el<HTMLElement>("#source-count").textContent =
        `${length.toLocaleString()} / 20,000 characters`;
      this.el<HTMLButtonElement>("[data-detect]").disabled =
        !ready || this.busy || !this.source.trim() || length > 20_000;
      input.setAttribute("aria-invalid", String(length > 20_000));
    };
    input.addEventListener("input", () => {
      this.source = input.value;
      count();
    });
    this.bind("[data-example]", () => {
      this.source = EXAMPLE;
      input.value = EXAMPLE;
      count();
      input.focus();
    });
    this.bind("[data-detect]", () => {
      void this.detect();
    });
    count();
  }
  private renderReview(session: ReviewSession): void {
    this.el("[data-workspace]").innerHTML = `
      <div class="review-panes"><section class="text-pane"><div class="pane-heading"><h2>Source text</h2><span>Original wording</span></div><div class="note-text" data-source tabindex="0" aria-label="Source text; select a missed phrase to replace it"></div><div class="pane-footer"><button type="button" data-manual disabled>Replace selected phrase</button></div></section>
      <section class="text-pane"><div class="pane-heading"><h2>Proposed result</h2><span data-result-status></span></div><div class="note-text" data-output aria-label="Proposed result"></div></section></div>
      <section class="review-list" aria-labelledby="detections-title"><div class="pane-heading"><h2 id="detections-title">Review replacements</h2><span data-counts></span></div><div data-detections></div></section>
      <footer class="review-completion"><div><p data-summary></p><small>Copying puts reviewed text on the system clipboard. Clipboard managers may retain it.</small></div><div class="completion-actions"><button type="button" data-rescan>Check reviewed text</button><button type="button" class="primary" data-copy>Copy reviewed text</button></div></footer>`;
    this.el<HTMLElement>("[data-counts]").textContent =
      `${session.pending} pending · ${session.retained} retained`;
    this.el<HTMLElement>("[data-result-status]").textContent = session.checked
      ? "Review checked"
      : "Awaiting review";
    this.el<HTMLElement>("[data-summary]").textContent = session.checked
      ? `Final local check complete. ${session.retained} deliberately retained occurrence(s).`
      : session.items.length
        ? "Resolve each proposal, then check the reviewed text."
        : "No identifiers detected. Read the whole text and mark any missed details before the final check.";
    this.paintText(
      this.el("[data-source]"),
      session.source,
      session.items,
      false,
    );
    this.paintText(
      this.el("[data-output]"),
      session.output,
      session.items,
      true,
    );
    const groups = new Map<number, Detection[]>();
    for (const item of session.items)
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    for (const items of groups.values())
      this.el("[data-detections]").append(this.card(session, items));
    const saveSelection = () => {
      const selection = window.getSelection();
      const source = this.el("[data-source]");
      this.selection = null;
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        if (
          source.contains(range.startContainer) &&
          source.contains(range.endContainer)
        ) {
          const before = range.cloneRange();
          before.selectNodeContents(source);
          before.setEnd(range.startContainer, range.startOffset);
          const start = before.toString().length;
          this.selection = { start, end: start + range.toString().length };
        }
      }
      this.el<HTMLButtonElement>("[data-manual]").disabled =
        this.busy || !this.selection;
    };
    this.el("[data-source]").addEventListener("mouseup", saveSelection);
    this.el("[data-source]").addEventListener("keyup", saveSelection);
    this.bind("[data-manual]", () => {
      if (this.selection)
        void this.change("add_manual_detection", this.selection);
    });
    this.updateCompletion();
    this.bind("[data-rescan]", () => {
      void this.rescan();
    });
    this.bind("[data-copy]", () => {
      void this.copy();
    });
  }
  private updateCompletion(): void {
    if (!this.session) return;
    const dirty = this.drafts.size > 0;
    this.el<HTMLButtonElement>("[data-rescan]").disabled =
      this.busy || dirty || this.session.pending > 0 || this.session.checked;
    this.el<HTMLButtonElement>("[data-copy]").disabled =
      this.busy || dirty || !this.session.checked;
  }
  private paintText(
    container: Element,
    text: string,
    items: Detection[],
    output: boolean,
  ): void {
    let cursor = 0;
    for (const item of items) {
      const start = output ? item.outputStart : item.start;
      const end = output ? item.outputEnd : item.end;
      container.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(start, end);
      mark.dataset.item = String(item.id);
      mark.dataset.decision = item.decision;
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute(
        "aria-label",
        `${mark.textContent}: ${item.category.toLowerCase().replaceAll("_", " ")}, ${DECISION_LABEL[item.decision]}`,
      );
      mark.addEventListener("click", () => this.select(item.id, true));
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.select(item.id, true);
        }
      });
      container.append(mark);
      cursor = end;
    }
    container.append(document.createTextNode(text.slice(cursor)));
  }
  private select(id: number, scroll: boolean): void {
    this.root.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
      el.classList.toggle("selected", el.dataset.item === String(id));
    });
    const item = this.session?.items.find((item) => item.id === id);
    if (scroll && item)
      this.root
        .querySelector(`[data-card="${item.group}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }
  private card(session: ReviewSession, items: Detection[]): HTMLElement {
    const item = items[0];
    const card = document.createElement("article");
    card.className = "detection-card";
    card.dataset.card = String(item.group);
    card.innerHTML = `<div class="detection-copy"><div class="detection-heading"><strong data-category></strong><span data-decision></span></div><p class="phrase" data-phrase></p><p class="detection-reason" data-reason></p><div data-occurrences></div></div><div class="detection-controls"><label>Placeholder <input data-label spellcheck="false" autocomplete="off" maxlength="48" /></label><div class="decision-buttons"><button type="button" data-action="accept">Accept</button><button type="button" data-action="edit">Edit</button><button type="button" data-action="keep">Keep</button><button type="button" data-action="remove">Remove</button></div></div>`;
    card.querySelector<HTMLElement>("[data-category]")!.textContent =
      item.category.toLowerCase().replaceAll("_", " ");
    card.querySelector<HTMLElement>("[data-decision]")!.textContent =
      `${DECISION_LABEL[item.decision]} · ${items.length} occurrence(s)`;
    card.querySelector<HTMLElement>("[data-phrase]")!.textContent =
      session.source.slice(item.start, item.end);
    card.querySelector<HTMLElement>("[data-reason]")!.textContent =
      `${item.reason} Found by: ${[...new Set(items.flatMap((i) => i.stages))].map((stage) => STAGE_LABEL[stage] ?? stage).join(", ")}.`;
    const label = card.querySelector<HTMLInputElement>("[data-label]")!;
    label.value = this.drafts.get(item.group) ?? item.replacement;
    label.disabled = this.busy;
    label.addEventListener("input", () => {
      if (label.value === item.replacement) this.drafts.delete(item.group);
      else this.drafts.set(item.group, label.value);
      this.message = this.drafts.size
        ? "Apply placeholder changes with Edit before checking or copying."
        : "";
      this.updateCompletion();
      this.updateStatus();
    });
    for (const button of card.querySelectorAll<HTMLButtonElement>(
      "[data-action]",
    )) {
      button.disabled = this.busy;
      button.addEventListener("click", () => {
        void this.change(
          "review_decision",
          {
            item: item.id,
            decision:
              button.dataset.action === "accept" && this.drafts.has(item.group)
                ? "edit"
                : button.dataset.action,
            replacement: label.value,
          },
          item.group,
        );
      });
    }
    for (const [index, occurrence] of items.entries()) {
      const find = document.createElement("button");
      find.type = "button";
      find.textContent = `Show ${index + 1}`;
      find.addEventListener("click", () => {
        this.select(occurrence.id, false);
        this.root
          .querySelector(`[data-source] [data-item="${occurrence.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
      card.querySelector("[data-occurrences]")!.append(find);
      if (items.length > 1) {
        const split = document.createElement("button");
        split.type = "button";
        split.disabled = this.busy;
        split.textContent = `Separate ${index + 1}`;
        split.addEventListener("click", () => {
          void this.change("split_detection", { item: occurrence.id });
        });
        card.querySelector("[data-occurrences]")!.append(split);
      }
    }
    return card;
  }
  private async perform<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.error = "";
    this.message = label;
    this.operation += 1;
    this.render();
    try {
      const result = await action();
      return this.disposed ? undefined : result;
    } catch (error) {
      if (!this.disposed)
        this.error =
          typeof error === "string"
            ? error
            : "The operation could not finish. Please retry.";
      return undefined;
    } finally {
      this.busy = false;
      this.message = "";
    }
  }
  private args(): Record<string, unknown> {
    return { sessionId: this.session!.id, revision: this.session!.revision };
  }
  private async install(): Promise<void> {
    await this.perform("Preparing download…", async () => {
      await this.bridge.call("install_model", { operation: this.operation });
      this.model = await this.bridge.call<ModelStatus>("model_status");
    });
    this.render();
  }
  private async detect(): Promise<void> {
    const result = await this.perform("Finding identifiers…", () =>
      this.bridge.call<ReviewSession>("detect_text", {
        operation: this.operation,
        source: this.source,
      }),
    );
    if (result) this.session = result;
    this.render();
  }
  private async change(
    command: string,
    args: Record<string, unknown>,
    appliedGroup?: number,
  ): Promise<void> {
    const result = await this.perform("Updating review…", () =>
      this.bridge.call<ReviewSession>(command, { ...this.args(), ...args }),
    );
    if (result) {
      this.session = result;
      if (appliedGroup !== undefined) this.drafts.delete(appliedGroup);
      const groups = new Set(result.items.map((item) => item.group));
      for (const group of this.drafts.keys())
        if (!groups.has(group)) this.drafts.delete(group);
    }
    this.selection = null;
    this.render();
    const pending = this.session?.items.find((i) => i.decision === "pending");
    if (pending)
      this.root
        .querySelector<HTMLButtonElement>(
          `[data-card="${pending.group}"] [data-action="accept"]`,
        )
        ?.focus({ preventScroll: true });
  }
  private async rescan(): Promise<void> {
    const result = await this.perform("Checking reviewed text…", () =>
      this.bridge.call<ReviewSession>("rescan_text", {
        ...this.args(),
        operation: this.operation,
      }),
    );
    if (result) this.session = result;
    this.render();
  }
  private async copy(): Promise<void> {
    let copied = false;
    await this.perform("Copying…", async () => {
      await this.bridge.call("copy_reviewed_text", this.args());
      copied = true;
    });
    if (copied) this.message = "Reviewed text copied.";
    this.render();
  }
  private async cancel(): Promise<void> {
    this.message = "Cancelling…";
    this.updateStatus();
    try {
      await this.bridge.call("cancel_operation", { operation: this.operation });
    } catch {
      this.error =
        "Cancellation could not be requested. Wait for processing to finish.";
      this.updateStatus();
    }
  }
  private async leave(home: boolean): Promise<void> {
    if (this.busy || this.disposed || this.dismissDiscard) return;
    if ((this.source || this.session) && !(await this.confirmDiscard())) return;
    this.busy = true;
    this.render();
    if (this.bridge.available) {
      try {
        await this.bridge.call("discard_session");
      } catch {
        this.error = "The session could not be cleared. Please retry.";
        this.busy = false;
        this.render();
        return;
      }
    }
    this.source = "";
    this.session = null;
    this.selection = null;
    this.error = "";
    this.message = "";
    this.drafts.clear();
    this.busy = false;
    if (home) {
      this.dispose();
      this.onHome();
    } else this.render();
  }
  private confirmDiscard(): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Discard this session?");
      dialog.innerHTML = `<h2>Discard this session?</h2><p>The source text and review decisions will be cleared.</p><div class="decision-buttons"><button type="button" data-stay>Keep reviewing</button><button type="button" data-confirm>Discard session</button></div>`;
      this.root.append(dialog);
      const finish = (value: boolean) => {
        dialog.close();
        dialog.remove();
        this.dismissDiscard = undefined;
        resolve(value);
        if (!value) this.render();
      };
      this.dismissDiscard = () => finish(false);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog
        .querySelector("[data-stay]")!
        .addEventListener("click", () => finish(false));
      dialog
        .querySelector("[data-confirm]")!
        .addEventListener("click", () => finish(true));
      dialog.showModal();
    });
  }
}
