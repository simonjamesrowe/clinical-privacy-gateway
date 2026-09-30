// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dictationButton, dictationStrip } from "./components";
import {
  codePoints,
  codeUnits,
  DictationController,
  joinAt,
  TAP_MS,
  textareaTarget,
  type Unavailable,
} from "./dictation";
import type { DictationEvent, PrivacyBridge } from "./types";

let field: HTMLTextAreaElement;
let button: HTMLButtonElement;
let strip: HTMLElement;
let calls: [string, Record<string, unknown> | undefined][];
let emit: (event: DictationEvent) => void;
let unavailable: Unavailable | null;
let controller: DictationController;
let startResult: Promise<number>;
let onChange: () => void;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const commands = () => calls.map(([name]) => name);
const status = () =>
  strip.querySelector<HTMLElement>("[data-dictation-status]")!.textContent;

function bridge(): PrivacyBridge {
  return {
    available: true,
    call: async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      if (command === "start_dictation") return (await startResult) as T;
      return undefined as T;
    },
    progress: async () => () => {},
    channel: <T>(onMessage: (message: T) => void) => {
      emit = onMessage as (event: DictationEvent) => void;
      return { id: "channel" };
    },
  };
}

function setup(limit = { max: 100_000, measure: codePoints }) {
  field = document.createElement("textarea");
  field.id = "field";
  button = dictationButton("field");
  strip = dictationStrip("field-dictation");
  document.body.replaceChildren(field, button, strip);
  onChange = vi.fn();
  controller = new DictationController(bridge(), () => unavailable, onChange);
  controller.beginRender();
  controller.attach("field", textareaTarget(field, limit), button, strip);
  controller.endRender();
}

function pointer(type: string) {
  button.dispatchEvent(
    new MouseEvent(type, { bubbles: true, button: 0, cancelable: true }),
  );
}
function key(type: "keydown" | "keyup", init: KeyboardEventInit) {
  (type === "keydown" ? field : window).dispatchEvent(
    new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}
const hotkey = { code: "KeyD", key: "∂", ctrlKey: true, altKey: true };
const final = (text: string, utterance = 1): DictationEvent => ({
  kind: "final",
  session: 5,
  utterance,
  text,
  startMs: 0,
  endMs: 900,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  calls = [];
  unavailable = null;
  startResult = Promise.resolve(5);
  // jsdom has no pointer events; the controller listens for their names only.
  window.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent;
  setup();
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe("joinAt", () => {
  it("adds spacing only where the surrounding text needs it", () => {
    expect(joinAt("", "Low mood.", "")).toBe("Low mood.");
    expect(joinAt("Seen today.", "Low mood.", "")).toBe(" Low mood.");
    expect(joinAt("Seen today.\n", "Low mood.", "")).toBe("Low mood.");
    expect(joinAt("Seen", ", then left.", "")).toBe(", then left.");
    expect(joinAt("", "Low mood", "Plan.")).toBe("Low mood ");
    expect(joinAt("", "Low mood", ". Plan.")).toBe("Low mood");
  });
  it("measures limits the way each field counts them", () => {
    expect(codePoints("🙂a")).toBe(2);
    expect(codeUnits("🙂a")).toBe(3);
  });
});

describe("DictationController", () => {
  it("links the recording strip to the field for assistive technology", () => {
    expect(field.getAttribute("aria-describedby")).toBe("field-dictation");
  });

  it("records while held and stops on release", async () => {
    pointer("pointerdown");
    await flush();
    expect(commands()).toEqual(["start_dictation"]);
    expect(calls[0][1]).toEqual({ events: { id: "channel" } });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(field.readOnly).toBe(true);
    expect(strip.hidden).toBe(false);
    vi.advanceTimersByTime(TAP_MS + 50);
    pointer("pointerup");
    expect(commands()).toEqual(["start_dictation", "stop_dictation"]);
    expect(calls[1][1]).toEqual({ session: 5 });
    expect(status()).toBe("Finishing transcription…");
  });

  it("latches on a quick tap and stops on the next tap", async () => {
    pointer("pointerdown");
    await flush();
    vi.advanceTimersByTime(100);
    pointer("pointerup");
    expect(commands()).toEqual(["start_dictation"]);
    expect(status()).toContain("Tap the microphone");
    pointer("pointerdown");
    pointer("pointerup");
    expect(commands()).toEqual(["start_dictation", "stop_dictation"]);
  });

  it("uses ⌃⌥D by physical key, ignores repeats and stops on key release", async () => {
    key("keydown", { code: "KeyD", key: "d" });
    expect(commands()).toEqual([]);
    key("keydown", hotkey);
    key("keydown", { ...hotkey, repeat: true });
    await flush();
    expect(commands()).toEqual(["start_dictation"]);
    vi.advanceTimersByTime(TAP_MS + 1);
    // Modifiers are often released first.
    key("keyup", { code: "KeyD", key: "d" });
    expect(commands()).toEqual(["start_dictation", "stop_dictation"]);
  });

  it("inserts only final text at the caret, replacing the selection", async () => {
    field.value = "Seen today. REPLACE Plan.";
    field.setSelectionRange(12, 19);
    const inputs = vi.fn();
    field.addEventListener("input", inputs);
    key("keydown", hotkey);
    await flush();
    emit({ kind: "provisional", session: 5, utterance: 1, text: "Low" });
    expect(field.value).toBe("Seen today. REPLACE Plan.");
    expect(
      strip.querySelector("[data-dictation-provisional]")!.textContent,
    ).toContain("Not yet finalLow");
    emit(final("Low mood."));
    emit(final("Not suicidal.", 2));
    expect(field.value).toBe("Seen today. Low mood. Not suicidal. Plan.");
    expect(inputs).toHaveBeenCalledTimes(2);
    expect(
      strip.querySelector<HTMLElement>("[data-dictation-provisional]")!.hidden,
    ).toBe(true);
    emit({ kind: "finished", session: 5 });
    expect(field.readOnly).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(status()).toBe("Dictated text added. Check it before you continue.");
    expect(field.selectionStart).toBe(
      "Seen today. Low mood. Not suicidal.".length,
    );
  });

  it("restores the field on Esc and cancels the recording", async () => {
    field.value = "Seen today.";
    field.setSelectionRange(11, 11);
    key("keydown", hotkey);
    await flush();
    emit(final("Low mood."));
    expect(field.value).toBe("Seen today. Low mood.");
    const page = vi.fn();
    document.body.addEventListener("keydown", page);
    key("keydown", { key: "Escape" });
    expect(field.value).toBe("Seen today.");
    expect(commands()).toContain("cancel_dictation");
    expect(page).not.toHaveBeenCalled();
    emit(final("Late text.", 2));
    expect(field.value).toBe("Seen today.");
    emit({ kind: "cancelled", session: 5 });
    expect(status()).toBe("Dictation cancelled.");
    expect(controller.active).toBe(false);
  });

  it("stops instead of truncating when a final would exceed the limit", async () => {
    controller.dispose();
    setup({ max: 12, measure: codeUnits });
    field.value = "Seen.";
    field.setSelectionRange(5, 5);
    key("keydown", hotkey);
    await flush();
    emit(final("Not suicidal."));
    expect(field.value).toBe("Seen.");
    expect(commands()).toContain("stop_dictation");
    emit({ kind: "finished", session: 5 });
    expect(status()).toBe("This field is full, so dictation stopped.");
    expect(
      strip.querySelector<HTMLElement>("[data-dictation-status]")!.dataset.tone,
    ).toBe("error");
  });

  it("explains why dictation is unavailable and offers setup", () => {
    controller.dispose();
    const setupAction = vi.fn();
    unavailable = { message: "Download the speech model.", setup: setupAction };
    setup();
    expect(button.disabled).toBe(true);
    expect(strip.hidden).toBe(false);
    expect(status()).toBe("Download the speech model.");
    strip.querySelector<HTMLButtonElement>("[data-dictation-setup]")!.click();
    expect(setupAction).toHaveBeenCalled();
    key("keydown", hotkey);
    expect(commands()).toEqual([]);

    controller.dispose();
    unavailable = { message: "Busy.", quiet: true };
    setup();
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Busy.");
    expect(strip.hidden).toBe(true);
  });

  it("keeps recording across a re-render and cancels when the field disappears", async () => {
    key("keydown", hotkey);
    await flush();
    const next = document.createElement("textarea");
    next.value = field.value;
    controller.beginRender();
    controller.attach(
      "field",
      textareaTarget(next, { max: 100, measure: codePoints }),
      dictationButton("field"),
      strip,
    );
    controller.endRender();
    expect(next.readOnly).toBe(true);
    emit(final("Low mood."));
    expect(next.value).toBe("Low mood.");
    controller.beginRender();
    controller.endRender();
    expect(commands()).toContain("cancel_dictation");
    expect(next.value).toBe("Low mood.");
  });

  it("stops a hold released while the microphone is still opening", async () => {
    let resolve: (session: number) => void = () => {};
    startResult = new Promise((done) => (resolve = done));
    pointer("pointerdown");
    vi.advanceTimersByTime(TAP_MS + 1);
    pointer("pointerup");
    expect(commands()).toEqual(["start_dictation"]);
    resolve(5);
    await flush();
    expect(commands()).toEqual(["start_dictation", "stop_dictation"]);
  });

  it("reports a start failure without leaving the field read-only", async () => {
    startResult = Promise.reject("Microphone access is off.");
    pointer("pointerdown");
    await flush();
    expect(field.readOnly).toBe(false);
    expect(status()).toBe("Microphone access is off.");
    expect(controller.active).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it("shows elapsed time and a bounded input level while recording", async () => {
    key("keydown", hotkey);
    await flush();
    vi.advanceTimersByTime(61_000);
    expect(strip.querySelector("[data-dictation-time]")!.textContent).toBe(
      "1:01",
    );
    const meter = strip.querySelector("[data-dictation-meter]")!;
    const lit = () => meter.querySelectorAll("[data-on]").length;
    const voice = () =>
      strip.querySelector("[data-dictation-voice]")!.textContent;
    expect(voice()).toBe("Waiting for speech");
    emit({ kind: "level", session: 5, level: 0.5, speaking: false });
    expect(lit()).toBe(8);
    expect(strip.dataset.speaking).toBe("false");
    expect(voice()).toBe("Waiting for speech");
    emit({ kind: "level", session: 5, level: 3, speaking: true });
    expect(lit()).toBe(16);
    expect(strip.dataset.speaking).toBe("true");
    expect(voice()).toBe("Hearing speech");
    expect(meter.getAttribute("aria-valuetext")).toBe("Hearing speech");
    expect(
      strip
        .querySelector("[data-dictation-meter]")!
        .getAttribute("aria-valuenow"),
    ).toBe("100");
  });
});
