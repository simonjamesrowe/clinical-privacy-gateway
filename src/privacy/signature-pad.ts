import { h } from "./dom";
export interface SignatureDraft {
  editing: boolean;
  removed: boolean;
  strokes: { x: number; y: number }[][];
  typed: string;
  png?: string;
}
export const emptySignatureDraft = (): SignatureDraft => ({
  editing: false,
  removed: false,
  strokes: [],
  typed: "",
});
export function signaturePad(
  saved: string | null,
  draft: SignatureDraft,
): HTMLElement {
  const canvas = h("canvas", {
    width: 1000,
    height: 320,
    class: "signature-canvas",
    "aria-label": "Draw a signature with your mouse or trackpad",
  });
  const status = h("p", { class: "hint", role: "status" });
  const typed = h("input", {
    value: draft.typed,
    maxlength: 80,
    oninput: (event) => {
      draft.typed = (event.target as HTMLInputElement).value;
      draft.strokes = [];
      redraw();
    },
  });
  const redraw = (encode = true) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = context.fillStyle =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-ink")
        .trim() || "currentColor";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (draft.typed) {
      context.font = "64px cursive";
      context.fillText(draft.typed, 32, 190, 936);
    }
    for (const stroke of draft.strokes) {
      context.beginPath();
      stroke.forEach((point, index) =>
        index
          ? context.lineTo(point.x, point.y)
          : context.moveTo(point.x, point.y),
      );
      if (stroke.length === 1) context.lineTo(stroke[0].x + 0.1, stroke[0].y);
      context.stroke();
    }
    if (encode)
      draft.png =
        draft.typed.trim() || draft.strokes.length
          ? canvas.toDataURL("image/png").split(",")[1]
          : undefined;
    status.textContent = draft.png
      ? "New signature ready to save."
      : "Draw here, or type your signature below.";
  };
  let active: number | null = null;
  const point = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(1000, ((event.clientX - bounds.left) * 1000) / bounds.width),
      ),
      y: Math.max(
        0,
        Math.min(320, ((event.clientY - bounds.top) * 320) / bounds.height),
      ),
    };
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (active !== null || event.button !== 0 || draft.strokes.length >= 256)
      return;
    event.preventDefault();
    active = event.pointerId;
    canvas.setPointerCapture(active);
    draft.typed = "";
    typed.value = "";
    draft.strokes.push([point(event)]);
    redraw(false);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (active !== event.pointerId) return;
    const stroke = draft.strokes[draft.strokes.length - 1];
    if (stroke.length < 10_000) stroke.push(point(event));
    redraw(false);
  });
  const end = () => {
    active = null;
    redraw();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  const drawing = h(
    "div",
    { class: "form-stack" },
    canvas,
    status,
    h(
      "label",
      { class: "field" },
      h("span", {}, "Or type your signature"),
      typed,
    ),
    h(
      "div",
      { class: "page-actions" },
      h(
        "button",
        {
          type: "button",
          class: "button",
          onclick: () => {
            draft.strokes.pop();
            redraw();
          },
        },
        "Undo stroke",
      ),
      h(
        "button",
        {
          type: "button",
          class: "button",
          onclick: () => {
            draft.strokes = [];
            draft.typed = "";
            typed.value = "";
            redraw();
          },
        },
        "Clear drawing",
      ),
    ),
  );
  const preview = h(
    "div",
    { class: "signature-preview" },
    saved && !draft.removed
      ? h("img", {
          src: `data:image/png;base64,${saved}`,
          alt: "Saved clinician signature",
        })
      : h(
          "p",
          { class: "muted" },
          draft.removed
            ? "Signature will be removed when you save."
            : "No signature saved.",
        ),
  );
  const change = h(
    "button",
    {
      type: "button",
      class: "button",
      onclick: () => {
        draft.editing = true;
        draft.removed = false;
        update();
        typed.focus();
      },
    },
    saved ? "Replace signature" : "Add signature",
  );
  const remove = h(
    "button",
    {
      type: "button",
      class: "button button--danger-quiet",
      onclick: () => {
        draft.removed = true;
        draft.editing = false;
        draft.strokes = [];
        draft.typed = "";
        draft.png = undefined;
        preview.replaceChildren(
          h("p", {}, "Signature will be removed when you save."),
        );
        update();
      },
    },
    "Remove signature",
  );
  const cancel = h(
    "button",
    {
      type: "button",
      class: "button",
      onclick: () => {
        Object.assign(draft, emptySignatureDraft(), { png: undefined });
        update();
        preview.replaceChildren(
          saved
            ? h("img", {
                src: `data:image/png;base64,${saved}`,
                alt: "Saved clinician signature",
              })
            : h("p", {}, "No signature saved."),
        );
      },
    },
    "Cancel signature change",
  );
  function update() {
    typed.value = draft.typed;
    drawing.hidden = !draft.editing;
    preview.hidden = draft.editing;
    change.hidden = draft.editing;
    remove.hidden = !saved || draft.removed;
    cancel.hidden = !draft.editing && !draft.removed;
    if (draft.editing) redraw();
  }
  update();
  return h(
    "div",
    { class: "form-stack", "data-signature-editor": true },
    preview,
    drawing,
    h("div", { class: "page-actions" }, change, remove, cancel),
    h(
      "p",
      { class: "hint" },
      "Stored on this Mac. Replacing or removing it does not change signatures saved in earlier documents.",
    ),
  );
}
