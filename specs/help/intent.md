# Help Intent

**Status:** Implemented

## Intent

Let a clinician learn the app from the app itself: short films of it at work,
available offline, from the header and the native Help menu.

## Intended user outcome

The clinician opens **Help**, picks a film, and watches it with optional
captions, jumping to any chapter. From the Help menu they can open a film
directly.

## Required behaviour

- Bundle the films with the app; play them without any network request.
- Show each film's title, running time, summary, poster, captions (off by
  default) and chapters; a chapter starts the film from that point.
- Never autoplay. A film plays only when the clinician starts it.
- Open Help from the header on every screen, from the Welcome screen, and from
  the native Help menu, which can open one film.
- When the films are not available (the browser development build), say so.

## Safety invariants

- Every film uses fictional patients, a fictional clinician and synthetic
  voices. The material behind them is in `test-data/synthetic/walkthrough/`.
- The asset protocol is scoped to the bundled Help folder only.

## Films

| Film | Shows |
| --- | --- |
| Overview | One referral note from import to restored letter |
| Setting up | Models, clinician details and signature, OpenAI and its governance checks, a template |
| A patient and her notes | Import, paste and dictation, with saved redactions carried between notes |
| The letter | One letter from three notes, restored, edited, signed and exported |

Re-record a film when the screens it shows change enough to mislead.
