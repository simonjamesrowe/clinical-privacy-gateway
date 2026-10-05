// The Help films bundled with the app (src-tauri/resources/help/). They were
// recorded on the app itself with fictional patients and synthetic voices.
// Slugs match the file names and the native Help menu in src-tauri/src/lib.rs.

export interface HelpChapter {
  /** Seconds from the start of the film. */
  at: number;
  label: string;
}

export interface HelpFilm {
  slug: string;
  title: string;
  /** Running time in seconds. */
  duration: number;
  summary: string;
  chapters: HelpChapter[];
}

export const HELP_FILMS: HelpFilm[] = [
  {
    slug: "overview",
    title: "Overview",
    duration: 140,
    summary:
      "One synthetic referral note from start to finish: local detection and review, one approved request to GPT-6 Sol, and the details restored on this Mac.",
    chapters: [
      { at: 0, label: "Why notes cannot just be pasted in" },
      { at: 12, label: "Importing a synthetic referral note" },
      { at: 23, label: "Finding identifiers on the Mac" },
      { at: 43, label: "Adding what the models missed" },
      { at: 62, label: "Preparing the referral letter" },
      { at: 77, label: "The exact request: tokens, not names" },
      { at: 95, label: "The details restored on the Mac" },
      { at: 109, label: "What stays and what leaves" },
    ],
  },
  {
    slug: "setting-up",
    title: "Setting up",
    duration: 119,
    summary:
      "A fresh install set up once: the two local models, your details and signature, the OpenAI connection behind its governance checks, and a letter template.",
    chapters: [
      { at: 0, label: "A fresh install, everything on this Mac" },
      {
        at: 12,
        label: "The local models: BERT for identifiers, Whisper for dictation",
      },
      { at: 22, label: "Your details and the PDF header" },
      { at: 33, label: "A signature, drawn once" },
      { at: 42, label: "The OpenAI connection and default model" },
      { at: 53, label: "The four governance checks for clinical sending" },
      { at: 65, label: "Letter templates, and a new one for the GP" },
      { at: 90, label: "What runs where" },
    ],
  },
  {
    slug: "patient-notes",
    title: "A patient and her notes",
    duration: 169,
    summary:
      "Three notes for one patient, imported, pasted and dictated. Each decision becomes a saved redaction, so later notes need fewer.",
    chapters: [
      { at: 0, label: "A new patient" },
      { at: 17, label: "Note 1: an assessment imported from Word" },
      { at: 32, label: "Reviewing every proposal: keep, relabel, accept" },
      { at: 66, label: "Adding the reference number the models missed" },
      { at: 82, label: "Note 2: a follow-up, with saved redactions applied" },
      { at: 110, label: "Note 3: a phone call, dictated on the Mac" },
      { at: 146, label: "Her notes, her redactions and a search" },
    ],
  },
  {
    slug: "the-letter",
    title: "The letter",
    duration: 117,
    summary:
      "An update for the patient’s GP from all three notes in one approved request, restored on the Mac, then edited, signed and exported as a PDF.",
    chapters: [
      { at: 0, label: "Three reviewed notes" },
      { at: 9, label: "A new document from the GP template" },
      { at: 22, label: "What will be sent, where, and the estimated cost" },
      { at: 30, label: "The exact request: tokens, not names" },
      { at: 36, label: "One approved request" },
      { at: 46, label: "The details restored on the Mac" },
      { at: 51, label: "Editing, signing and exporting" },
      { at: 69, label: "The exported PDF" },
      { at: 77, label: "Every send recorded, without its content" },
      { at: 86, label: "What stays on the Mac and what leaves" },
    ],
  },
];

export const helpFiles = (film: HelpFilm) => ({
  video: `${film.slug}.mp4`,
  captions: `${film.slug}.vtt`,
  poster: `${film.slug}-poster.webp`,
});

/** "1:05" for 65 seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
