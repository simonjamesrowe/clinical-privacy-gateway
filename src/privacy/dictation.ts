// Push-to-talk dictation into a text field or rich editor. Hold the microphone button or
// ⌃⌥D to talk; a quick tap keeps recording until the next tap; Esc cancels and restores
// the field. Only final text is inserted. Provisional text stays in the strip, visibly not final.
import type { DictationEvent, PrivacyBridge } from "./types";

const STARTING = "Starting the microphone…";

/** Releases shorter than this latch recording on instead of stopping it. */
export const TAP_MS = 250;

export interface FieldLimit {
  max: number;
  measure(text: string): number;
}
/** Unicode characters, as the source-text limit counts them. */
export const codePoints = (text: string): number => Array.from(text).length;
/** UTF-16 code units, as `maxlength` counts them. */
export const codeUnits = (text: string): number => text.length;

export interface Unavailable {
  message: string;
  /** Explain only through the button's tooltip, not in the strip. */
  quiet?: boolean;
  setup?: () => void;
}

const PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]"]);
const space = (character: string | undefined): boolean =>
  character === undefined || /\s/.test(character);

/** The text to insert between `before` and `after`, with spacing that joins it naturally. */
export function joinAt(before: string, text: string, after: string): string {
  const leading =
    before.length > 0 && !space(before.at(-1)) && !PUNCTUATION.has(text[0])
      ? " "
      : "";
  const trailing =
    after.length > 0 && !space(after[0]) && !PUNCTUATION.has(after[0])
      ? " "
      : "";
  return `${leading}${text}${trailing}`;
}

/** Where a recording inserts text, in the target's own coordinates, plus a restore point. */
export interface DictationMark {
  start: number;
  end: number;
  snapshot: unknown;
}

/** A field that dictation can insert into. Implementations own their coordinates. */
export interface DictationTarget {
  /** Receives the ⌃⌥D hotkey. */
  readonly element: HTMLElement;
  /** Captures the current selection as the insertion point. */
  begin(): DictationMark;
  /** Inserts final text at the mark and returns the next mark, or `null` if over the limit. */
  insert(mark: DictationMark, text: string): DictationMark | null;
  /** Returns the field to how it was when the mark was taken. */
  restore(mark: DictationMark): void;
  /** Blocks editing while a recording owns the insertion point. */
  setBusy(busy: boolean): void;
  /** Focuses the field with the caret after the last insertion. */
  settle(mark: DictationMark): void;
  /** Links the recording strip for assistive technology. */
  describe(id: string): void;
}

/** A plain textarea: offsets are UTF-16 indices; `limit` measures the whole value. */
export function textareaTarget(
  field: HTMLTextAreaElement,
  limit: FieldLimit,
): DictationTarget {
  return {
    element: field,
    begin: () => {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      return { start, end, snapshot: { value: field.value, start, end } };
    },
    insert: (mark, text) => {
      const value = field.value;
      const start = Math.min(mark.start, value.length);
      const end = Math.min(Math.max(mark.end, start), value.length);
      const before = value.slice(0, start);
      const after = value.slice(end);
      const insertion = joinAt(before, text, after);
      if (limit.measure(before + insertion + after) > limit.max) return null;
      field.setRangeText(insertion, start, end, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      const next = start + insertion.length;
      return { ...mark, start: next, end: next };
    },
    restore: (mark) => {
      const snapshot = mark.snapshot as {
        value: string;
        start: number;
        end: number;
      };
      field.value = snapshot.value;
      field.setSelectionRange(snapshot.start, snapshot.end);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    setBusy: (busy) => {
      field.readOnly = busy;
      field.setAttribute("aria-busy", String(busy));
    },
    settle: (mark) => {
      field.focus();
      field.setSelectionRange(mark.start, mark.start);
    },
    describe: (id) => {
      const ids = (field.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter((value) => value && value !== id);
      field.setAttribute("aria-describedby", [...ids, id].join(" "));
    },
  };
}

export function isDictationHotkey(event: KeyboardEvent): boolean {
  // ⌥ changes `event.key` on macOS (⌥D is "∂"), so match the physical key.
  return (
    event.code === "KeyD" && event.ctrlKey && event.altKey && !event.metaKey
  );
}

type Phase = "idle" | "starting" | "recording" | "finishing" | "cancelling";

interface Binding {
  target: DictationTarget;
  button: HTMLButtonElement;
  strip: HTMLElement;
}

interface Recording {
  key: string;
  generation: number;
  session: number | null;
  latched: boolean;
  stopRequested: boolean;
  cancelRequested: boolean;
  mark: DictationMark;
  inserted: number;
  startedAt: number;
  provisional: string;
  status: string;
}

export class DictationController {
  private bindings = new Map<string, Binding>();
  private rendered = new Set<string>();
  private phase: Phase = "idle";
  private recording: Recording | null = null;
  private generation = 0;
  private press: { source: "pointer" | "key"; at: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private messages = new Map<string, { text: string; error: boolean }>();
  private level = 0;
  private speaking = false;
  private readonly keyup = (event: KeyboardEvent) => {
    if (event.code === "KeyD" && this.press?.source === "key") this.release();
  };
  private readonly escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || this.phase === "idle") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancel(true);
  };
  private readonly blur = () => {
    if (this.press) this.release(true);
  };

  constructor(
    private bridge: PrivacyBridge,
    private unavailable: () => Unavailable | null,
    private onChange: () => void = () => {},
  ) {
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("keydown", this.escape, true);
    window.addEventListener("blur", this.blur);
  }

  get active(): boolean {
    return this.phase !== "idle";
  }

  /** Call before a render that may rebuild dictation fields. */
  beginRender(): void {
    this.rendered.clear();
  }

  /** Call after the render. A recording whose field disappeared is cancelled. */
  endRender(): void {
    for (const key of [...this.bindings.keys()])
      if (!this.rendered.has(key)) this.bindings.delete(key);
    if (this.recording && !this.bindings.has(this.recording.key))
      this.cancel(false);
  }

  /** Connects a field. Re-attaching the same key after a re-render keeps its recording. */
  attach(
    key: string,
    target: DictationTarget,
    button: HTMLButtonElement,
    strip: HTMLElement,
  ): void {
    this.bindings.set(key, { target, button, strip });
    this.rendered.add(key);
    target.describe(strip.id);
    target.element.addEventListener("keydown", (event) => {
      if (!isDictationHotkey(event)) return;
      event.preventDefault();
      if (!event.repeat) this.pressed(key, "key");
    });
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled || event.button !== 0) return;
      // Keep focus and the caret in the field.
      event.preventDefault();
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic or already-ended pointers cannot be captured; release still works.
      }
      this.pressed(key, "pointer");
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, () => {
        if (this.press?.source === "pointer")
          this.release(type !== "pointerup");
      });
    button.addEventListener("click", (event) => {
      // Keyboard activation (Enter or Space) has no pointer press: toggle.
      if (event.detail !== 0) return;
      if (this.phase === "idle") this.begin(key, true);
      else if (this.recording?.key === key) this.stop();
    });
    this.paint(key);
  }

  /** Stops any recording without restoring the field (navigation, disposal). */
  cancel(restore = false): void {
    const recording = this.recording;
    if (!recording || this.phase === "cancelling") return;
    this.phase = "cancelling";
    recording.cancelRequested = true;
    this.press = null;
    if (restore)
      this.bindings.get(recording.key)?.target.restore(recording.mark);
    recording.status = "Cancelling dictation…";
    if (recording.session !== null) this.command("cancel_dictation", recording);
    this.paint(recording.key);
  }

  /** Re-applies availability to every attached field (for example after the model changes). */
  refresh(): void {
    for (const key of this.bindings.keys()) this.paint(key);
  }

  dispose(): void {
    this.cancel(false);
    this.clearTimer();
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("keydown", this.escape, true);
    window.removeEventListener("blur", this.blur);
    this.bindings.clear();
  }

  // Press, release, start, stop ---------------------------------------------

  private pressed(key: string, source: "pointer" | "key"): void {
    if (this.phase === "idle") {
      if (this.unavailable()) return;
      this.press = { source, at: Date.now() };
      this.begin(key, false);
    } else if (
      this.recording?.key === key &&
      this.recording.latched &&
      (this.phase === "recording" || this.phase === "starting")
    ) {
      this.stop();
    }
  }

  private release(interrupted = false): void {
    const press = this.press;
    this.press = null;
    const recording = this.recording;
    if (!press || !recording) return;
    if (!interrupted && Date.now() - press.at < TAP_MS) {
      recording.latched = true;
      this.paint(recording.key);
    } else {
      this.stop();
    }
  }

  private begin(key: string, latched: boolean): void {
    const binding = this.bindings.get(key);
    if (!binding || !this.bridge.channel || this.unavailable()) return;
    this.messages.delete(key);
    const recording: Recording = {
      key,
      generation: ++this.generation,
      session: null,
      latched,
      stopRequested: false,
      cancelRequested: false,
      mark: binding.target.begin(),
      inserted: 0,
      startedAt: Date.now(),
      provisional: "",
      status: STARTING,
    };
    this.recording = recording;
    this.phase = "starting";
    this.level = 0;
    this.speaking = false;
    this.timer = setInterval(() => this.paintTime(), 250);
    const channel = this.bridge.channel<DictationEvent>((event) =>
      this.onEvent(recording, event),
    );
    this.paint(key);
    this.onChange();
    this.bridge
      .call<number>("start_dictation", { events: channel })
      .then((session) => {
        if (this.recording !== recording) return;
        recording.session = session;
        if (recording.cancelRequested)
          this.command("cancel_dictation", recording);
        else if (recording.stopRequested) this.stop();
        else if (this.phase === "starting") {
          this.phase = "recording";
          if (recording.status === STARTING) recording.status = "";
        }
        this.paint(key);
      })
      .catch((error: unknown) => {
        if (this.recording !== recording) return;
        this.finish(recording, String(error), true);
      });
  }

  private stop(): void {
    const recording = this.recording;
    if (!recording || this.phase === "finishing" || this.phase === "cancelling")
      return;
    this.press = null;
    if (recording.session === null) {
      recording.stopRequested = true;
      return;
    }
    this.phase = "finishing";
    recording.status = "Finishing transcription…";
    this.command("stop_dictation", recording);
    this.paint(recording.key);
  }

  private command(name: string, recording: Recording): void {
    void this.bridge.call(name, { session: recording.session }).catch(() => {});
  }

  // Events --------------------------------------------------------------

  private onEvent(recording: Recording, event: DictationEvent): void {
    if (this.recording !== recording) return;
    switch (event.kind) {
      case "state":
        if (event.state === "loadingModel")
          recording.status = "Loading the speech model. Keep talking.";
        else if (event.state === "limitReached")
          recording.status = "Reached the 10-minute limit. Finishing…";
        else if (event.state === "listening" || event.state === "ready")
          recording.status = "";
        break;
      case "level":
        this.level = event.level;
        this.speaking = event.speaking;
        this.paintLevel(recording.key);
        return;
      case "provisional":
        if (!recording.cancelRequested) recording.provisional = event.text;
        break;
      case "final":
        if (!recording.cancelRequested) this.insert(recording, event.text);
        break;
      case "finished":
        this.finish(
          recording,
          recording.cancelRequested
            ? "Dictation cancelled."
            : recording.inserted
              ? "Dictated text added. Check it before you continue."
              : "No speech was detected.",
          false,
        );
        return;
      case "cancelled":
        this.finish(recording, "Dictation cancelled.", false);
        return;
      case "failed":
        this.finish(recording, event.message, true);
        return;
    }
    this.paint(recording.key);
  }

  private insert(recording: Recording, text: string): void {
    const binding = this.bindings.get(recording.key);
    if (!binding) return;
    recording.provisional = "";
    const mark = binding.target.insert(recording.mark, text);
    if (!mark) {
      // Never truncate dictated text: a cut can drop a trailing “not”.
      this.messages.set(recording.key, {
        text: "This field is full, so dictation stopped.",
        error: true,
      });
      this.stop();
      return;
    }
    recording.mark = mark;
    recording.inserted += 1;
  }

  private finish(recording: Recording, message: string, error: boolean): void {
    const binding = this.bindings.get(recording.key);
    this.clearTimer();
    this.recording = null;
    this.phase = "idle";
    this.press = null;
    this.level = 0;
    this.speaking = false;
    if (!this.messages.has(recording.key))
      this.messages.set(recording.key, { text: message, error });
    this.paint(recording.key);
    if (binding && !recording.cancelRequested)
      binding.target.settle(recording.mark);
    this.onChange();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // Painting --------------------------------------------------------------

  private paint(key: string): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    const { target, button, strip } = binding;
    const recording = this.recording?.key === key ? this.recording : null;
    const busy = this.phase !== "idle";
    const mine = Boolean(recording);
    const listening =
      mine && (this.phase === "starting" || this.phase === "recording");
    const unavailable = busy ? null : this.unavailable();
    target.setBusy(mine && this.phase !== "cancelling");
    button.disabled = Boolean(unavailable) || (busy && !mine);
    button.setAttribute("aria-pressed", String(listening));
    button.dataset.state = mine ? this.phase : "idle";
    const label = button.querySelector<HTMLElement>("[data-dictation-label]");
    if (label) label.textContent = listening ? "Stop dictation" : "Dictate";
    button.title = unavailable
      ? unavailable.message
      : listening
        ? "Release, tap or press ⌃⌥D to finish. Esc cancels."
        : "Hold to dictate, or tap to keep recording (⌃⌥D)";

    const live = strip.querySelector<HTMLElement>("[data-dictation-live]")!;
    const provisional = strip.querySelector<HTMLElement>(
      "[data-dictation-provisional]",
    )!;
    const status = strip.querySelector<HTMLElement>("[data-dictation-status]")!;
    const setup = strip.querySelector<HTMLButtonElement>(
      "[data-dictation-setup]",
    )!;
    const message = this.messages.get(key);
    live.hidden = !mine;
    strip.dataset.state = mine ? this.phase : "idle";
    provisional.hidden = !recording?.provisional;
    provisional.querySelector(
      "[data-dictation-provisional-text]",
    )!.textContent = recording?.provisional ?? "";
    status.textContent = recording
      ? recording.status ||
        (recording.latched
          ? "Listening. Tap the microphone or press ⌃⌥D to finish. Esc cancels."
          : "Listening. Release to finish. Esc cancels.")
      : ((unavailable && !unavailable.quiet ? unavailable.message : null) ??
        message?.text ??
        "");
    status.dataset.tone = !recording && message?.error ? "error" : "";
    setup.hidden = Boolean(recording) || !unavailable?.setup;
    setup.onclick = unavailable?.setup ?? null;
    strip.hidden =
      !recording && !(unavailable && !unavailable.quiet) && !message;
    this.paintTime();
    this.paintLevel(key);
  }

  private paintTime(): void {
    const recording = this.recording;
    if (!recording) return;
    const time = this.bindings
      .get(recording.key)
      ?.strip.querySelector<HTMLElement>("[data-dictation-time]");
    if (!time) return;
    const seconds = Math.floor((Date.now() - recording.startedAt) / 1000);
    const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    time.textContent = text;
    time.setAttribute("datetime", `PT${seconds}S`);
  }

  /** Lights meter segments with the input level; speech detected by VAD turns them accent. */
  private paintLevel(key: string): void {
    const strip = this.bindings.get(key)?.strip;
    const meter = strip?.querySelector<HTMLElement>("[data-dictation-meter]");
    if (!strip || !meter) return;
    const mine = this.recording?.key === key;
    const level = mine ? Math.min(1, Math.max(0, this.level)) : 0;
    const speaking = mine && this.speaking;
    const segments = meter.children;
    const lit = Math.round(level * segments.length);
    for (let index = 0; index < segments.length; index += 1)
      (segments[index] as HTMLElement).toggleAttribute("data-on", index < lit);
    const voice = speaking ? "Hearing speech" : "Waiting for speech";
    meter.setAttribute("aria-valuenow", String(Math.round(level * 100)));
    meter.setAttribute("aria-valuetext", voice);
    strip.dataset.speaking = String(speaking);
    const label = strip.querySelector<HTMLElement>("[data-dictation-voice]");
    if (label) label.textContent = voice;
  }
}
