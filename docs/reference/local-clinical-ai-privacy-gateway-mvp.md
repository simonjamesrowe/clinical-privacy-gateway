# Local Clinical AI Privacy Gateway
## MVP Product & Technical Brief

**Working title:** Local Clinical AI Privacy Gateway  
**Primary user:** Clinical neuropsychologist / psychologist  
**Primary purpose:** Convert identifiable clinical text into a clinician-reviewed, highly de-identified version suitable for use in an approved AI workflow, while keeping the original identifiable data on the local device.

---

## 1. Executive Summary

Clinical psychologists and neuropsychologists increasingly use generative AI for tasks such as:

- drafting progress notes;
- structuring reports;
- developing session plans;
- creating accessible client resources;
- summarising clinical material;
- brainstorming formulations and hypotheses;
- improving the clarity and concision of clinical writing;
- reflecting on strengths and development needs.

The major barrier is confidentiality and data protection.

At present, clinical material must often be manually de-identified before being entered into an AI system. This is slow, repetitive, and vulnerable to human error.

The proposed product is a **local clinical privacy gateway** that:

1. accepts raw clinical text;
2. processes the text entirely on the local device;
3. detects direct and indirect identifiers;
4. replaces identifiers with clinically meaningful placeholders;
5. flags residual identification risks;
6. allows the clinician to review every transformation;
7. outputs an AI-ready version of the text;
8. does not send raw identifiable clinical material to external services.

The MVP should deliberately **not claim that output is fully anonymous or “GDPR compliant.”**

The safer framing is:

> A local de-identification and pseudonymisation support tool that helps a clinician identify and remove information that may make a client identifiable before using the material in an approved AI workflow.

---

# 2. The Problem

A clinician may have raw material such as:

> I spoke with Alex Mercer and his mother Sarah yesterday. Elliot is 17 and attends Riverview Sixth Form in Northshire. He has a long-term neurological condition affecting attention and fatigue. His case manager, Jordan Patel, asked whether he could be seen next Friday at Westbrook Medical Centre.

To use this safely with generative AI, the clinician currently has to manually notice and alter:

- Alex Mercer;
- Sarah;
- Riverview Sixth Form;
- Northshire;
- exact age;
- injury history;
- Jordan Patel;
- exact dates;
- Westbrook Medical Centre;
- potentially the distinctive combination of all of the above.

Manual de-identification is:

- repetitive;
- cognitively demanding;
- inconsistent;
- time-consuming;
- especially vulnerable to mistakes when the clinician is tired or rushed.

The software should reduce the burden while preserving human review.

---

# 3. Core Design Principle

## Identifiable clinical information should not leave the local device during de-identification.

The system should be designed on the assumption that raw source material contains:

- personal data;
- special-category health data;
- potentially highly sensitive family and safeguarding information.

The de-identification process should therefore be **local-first by architecture**, not just by policy.

---

# 4. Important Terminology

The product should distinguish between:

### Redaction
Removing information entirely.

Example:

> John Smith lives at 14 High Street.

becomes:

> [REDACTED] lives at [REDACTED].

### Pseudonymisation
Replacing identifying information with consistent labels or aliases.

Example:

> John Smith told Sarah Smith...

becomes:

> [CLIENT] told [MOTHER]...

### De-identification
Reducing the amount of information that could reasonably identify the person.

This may include:

- removing names;
- generalising dates;
- generalising locations;
- reducing age precision;
- replacing organisations;
- removing unusual identifying details.

### Anonymisation
A stronger legal and technical concept.

The MVP should **not automatically label its output “anonymous.”**

Clinical narratives can remain identifiable through combinations of indirect information.

---

# 5. MVP Goal

The MVP should answer one practical question:

> Can a clinician take messy real-world clinical text and produce a carefully reviewed, highly de-identified version suitable for an approved AI workflow in under 30 seconds?

The MVP should focus on doing one thing extremely well:

**Paste clinical text → detect identifiers → review changes → copy de-identified text.**

---

# 6. MVP Scope

## In scope

### Input
- Plain text pasted into the application.
- Potentially text copied from:
  - progress notes;
  - emails;
  - session transcripts;
  - report drafts;
  - case summaries;
  - MDT notes.

### Processing
- Local identifier detection.
- Local replacement/generalisation.
- Local risk flagging.
- Human review.

### Output
- Reviewed de-identified text.
- Copy-to-clipboard function.
- Optional export to `.txt` or `.md`.

---

## Out of scope for initial MVP

Do **not** initially include:

- direct ChatGPT integration;
- direct Claude integration;
- automatic sending to any external AI API;
- EPR integration;
- LMS system integration;
- cloud sync;
- multi-user accounts;
- team collaboration;
- automated clinical decision-making;
- automatic report generation;
- long-term client database unless genuinely necessary;
- claims of “GDPR compliant” output;
- claims of guaranteed anonymisation.

These can be explored later.

---

# 7. User Workflow

## Step 1 — Paste source text

The clinician opens the application and pastes raw clinical information into an input field.

Example:

> I met with Elliot Harper, aged 17 years and 3 months, at his home in Riverside District on Friday 18 September 2026. His mother Maya Harper reported that Elliot had returned late from Riverview Sixth Form following an argument with another student.

---

## Step 2 — Local detection pass

The application identifies potential identifiers.

Possible detections:

| Text | Category | Suggested action |
|---|---|---|
| Elliot Harper | Person | Replace with `[CLIENT]` |
| 17 years 3 months | Age | Generalise to `17-year-old` |
| Riverside District | Location | Replace with `[LOCAL AREA]` |
| Friday 18 September 2026 | Date | Generalise to `[RECENT DATE]` |
| Maya Harper | Person/relationship | Replace with `[MOTHER]` |
| Riverview Sixth Form | Organisation | Replace with `[COLLEGE]` |

---

## Step 3 — Contextual privacy pass

The system asks whether combinations of remaining information could still identify the person.

For example:

> Potential residual identification risk:
>
> - exact age;
> - rare diagnosis;
> - named borough;
> - unusual accident;
> - named specialist college.

The software should surface these concerns rather than silently removing them.

---

## Step 4 — Clinician review

The clinician sees:

### Left pane
Original text.

### Right pane
Proposed de-identified version.

Potential identifiers are highlighted.

The clinician can choose:

- **Accept**
- **Edit**
- **Keep**
- **Remove**

for each item.

---

## Step 5 — Final risk check

The system performs a final local scan.

Example result:

> **Direct identifiers detected:** 0  
> **Possible indirect identifiers remaining:** 2  
> **Items requiring review:** rare diagnosis; specific incident description

The interface should not display:

> GDPR SAFE

or:

> Fully anonymous

because those claims would be too strong.

---

## Step 6 — Copy output

The clinician clicks:

**Copy de-identified version**

Example output:

> I met with [CLIENT], a 17-year-old, at home recently. [MOTHER] reported that [CLIENT] had returned late from [COLLEGE] following an argument with another student.

This can then be pasted into an AI system that the clinician or organisation has separately approved.

---

# 8. Identifier Categories

The detection engine should be designed around several classes of information.

---

## 8.1 Direct identifiers

Examples:

- full names;
- first names where context makes identity obvious;
- surnames;
- initials where they are uniquely identifying in the document;
- dates of birth;
- LMS numbers;
- hospital numbers;
- telephone numbers;
- email addresses;
- full addresses;
- postcodes;
- social media handles;
- usernames;
- vehicle registration numbers;
- case numbers;
- court reference numbers.

---

## 8.2 People and relationships

Detect:

- client;
- mother;
- father;
- parent;
- sibling;
- partner;
- ex-partner;
- child;
- teacher;
- case manager;
- solicitor;
- support worker;
- rehabilitation assistant;
- psychologist;
- occupational therapist;
- physiotherapist;
- speech and language therapist;
- doctor;
- school staff.

The system should preserve **roles** wherever possible.

Example:

> Anna spoke with John and Sarah.

might become:

> [CASE_MANAGER] spoke with [CLIENT] and [MOTHER].

This is more clinically useful than:

> [PERSON_1] spoke with [PERSON_2] and [PERSON_3].

---

# 9. Institutions and Organisations

Detect and potentially replace:

- schools;
- colleges;
- universities;
- hospitals;
- GP practices;
- rehabilitation units;
- care homes;
- employers;
- charities;
- local authorities;
- legal firms;
- insurers;
- case management organisations;
- police stations;
- courts;
- sports clubs;
- specialist services.

Suggested replacements:

- `[SCHOOL]`
- `[COLLEGE]`
- `[HOSPITAL]`
- `[CARE_HOME]`
- `[EMPLOYER]`
- `[CASE_MANAGEMENT_COMPANY]`
- `[LOCAL_AUTHORITY]`

---

# 10. Location Detection

Potentially identifying location information includes:

- full addresses;
- postcodes;
- street names;
- neighbourhoods;
- boroughs;
- villages;
- towns;
- cities;
- named buildings;
- schools/hospitals tied to a geographic area.

Possible generalisations:

| Original | Replacement |
|---|---|
| 14 High Street | `[HOME ADDRESS]` |
| Riverside District | `[LOCAL AREA]` |
| Meadowfield | `[LOCAL AREA]` |
| London | `London` or `[CITY]` depending on context |
| East London | `urban local area` where appropriate |
| Westbrook Medical Centre | `[HOSPITAL]` |

The system should allow the clinician to keep non-identifying geographic information when clinically relevant.

---

# 11. Dates and Time

Exact dates are often unnecessarily identifying.

Examples:

### Exact date
> 18 September 2026

Possible replacement:

> `[RECENT DATE]`

### Relative date
> yesterday

May be preserved if harmless.

### Clinical chronology
Dates sometimes matter.

Therefore the system should offer transformations such as:

- exact date → month/year;
- exact date → relative timing;
- exact date → `[DATE]`;
- exact age → age band;
- exact time → morning/afternoon/evening.

Example:

> On 18 September 2026 at 14:35

could become:

> During a recent afternoon appointment

if exact timing is not clinically necessary.

---

# 12. Age Generalisation

Exact ages can contribute to identifiability.

Possible levels:

### Keep exact age
`17 years`

### Moderate generalisation
`17-year-old`

### Stronger generalisation
`late adolescent`

### Adult banding
- young adult;
- middle-aged adult;
- older adult.

The correct level should depend on the clinical task.

For neuropsychological work, age is often clinically meaningful, so the product should avoid over-redacting it automatically.

---

# 13. Indirect Identifiers

This is likely to be the most difficult and valuable part of the system.

A person can remain identifiable even without a name.

Potential indirect identifiers include:

- very rare diagnoses;
- unusual injuries;
- exact injury dates;
- distinctive accident circumstances;
- unusual occupations;
- high-profile legal cases;
- unusual family relationships;
- unusual immigration/travel history;
- very specific education placement;
- distinctive safeguarding incidents;
- unique combinations of disability and location;
- named specialist services;
- rare assistive devices;
- exact court or settlement circumstances.

Example:

> A 19-year-old living in a small town who has a rare neurological condition, uses a distinctive assistive device, and attends a named specialist training centre.

Even without a name, this may potentially identify someone.

The software should flag the **combination**, not just individual tokens.

---

# 14. Detection Architecture

A layered system is preferable to relying on one model.

---

## Layer 1 — Deterministic rules

Use regular expressions and structured rules for:

- LMS numbers;
- phone numbers;
- email addresses;
- postcodes;
- dates;
- URLs;
- social media handles;
- case numbers;
- IDs.

Advantages:

- fast;
- explainable;
- highly reliable for structured identifiers.

---

## Layer 2 — Named Entity Recognition

A local NER model identifies:

- people;
- locations;
- organisations;
- dates;
- facilities;
- schools;
- employers.

Potential implementation options could include local NLP libraries or locally hosted language models.

Key requirement:

**No raw clinical text should be sent to an external API for this stage.**

---

## Layer 3 — Client-specific dictionary

The clinician can optionally maintain a local list of known identifiers for a client.

Example:

```text
Client:
Alex Mercer
Tom
Elliot

Mother:
Maya Harper Brown
Maya Harper

Case manager:
Jordan Patel
Anna

College:
Riverview Sixth Form
Riverview
```

The system then recognises all variations.

This is particularly useful for recurring clients.

---

## Layer 4 — Contextual risk detection

A local model analyses the transformed text for unusual combinations that may identify the person.

Examples:

> Rare diagnosis + named school + exact age

> Highly specific incident + borough + exact date

> Public court case + profession + injury details

This layer should produce **warnings**, not definitive legal conclusions.

---

## Layer 5 — Human review

The clinician remains responsible for the final review.

This is essential.

The product should be a **decision-support tool**, not a fully autonomous anonymisation engine.

---

# 15. Pseudonymisation Strategy

The system should retain clinical meaning.

Poor approach:

> [PERSON_1] told [PERSON_2] that [PERSON_3] was worried.

Better approach:

> [CLIENT] told [MOTHER] that [CASE_MANAGER] was worried.

Suggested role labels:

```text
[CLIENT]
[MOTHER]
[FATHER]
[PARENT]
[SIBLING]
[PARTNER]
[CASE_MANAGER]
[RA_1]
[RA_2]
[SUPPORT_WORKER]
[PSYCHOLOGIST]
[OT]
[PHYSIO]
[SALT]
[DOCTOR]
[SOLICITOR]
[SCHOOL]
[COLLEGE]
[HOSPITAL]
[CARE_HOME]
[LOCAL_AREA]
[EMPLOYER]
```

---

# 16. Consistency Across a Document

The system should maintain consistent substitutions.

Example:

```text
Elliot → [CLIENT]
Elliot → [CLIENT]
Tom → [CLIENT]

Maya Harper → [MOTHER]
Mrs Green → [MOTHER]
```

This makes long notes easier for AI systems to understand.

---

# 17. Optional Client Profiles

This should probably be a later feature rather than MVP v1, but the architecture should allow for it.

A local client profile might contain:

```yaml
client_id: ZX
client_names:
  - Elliot Harper
  - Elliot
  - Tom

relationships:
  mother:
    - Maya Harper Green
    - Maya Harper

organisations:
  college:
    - Riverview Sixth Form

professionals:
  case_manager:
    - Jordan Patel
```

Important:

- profiles remain local;
- mappings are encrypted;
- users can delete them;
- storage is optional;
- no profile information is transmitted externally.

---

# 18. User Interface

## Main screen

Suggested layout:

```text
----------------------------------------------------------
| Original clinical text | De-identified clinical text |
|                        |                             |
|                        |                             |
----------------------------------------------------------

Potential identifiers:
[✓] Elliot Harper        PERSON       → [CLIENT]
[✓] Maya Harper           PERSON       → [MOTHER]
[✓] Riverside District            LOCATION     → [LOCAL AREA]
[✓] Riverview Sixth Form       ORGANISATION → [COLLEGE]
[?] distinctive childhood neurological history   INDIRECT RISK
----------------------------------------------------------

[Run check again]          [Copy de-identified text]
```

---

# 19. Colour / Visual Logic

The interface could visually distinguish:

- confirmed direct identifier;
- probable identifier;
- possible indirect identifier;
- user-approved retained information.

For accessibility, do not rely on colour alone.

Use icons and text labels as well.

---

# 20. Explainability

Every flag should ideally provide a reason.

Example:

> **Riverview Sixth Form**
>
> Flagged because it appears to be a named educational institution.

Example:

> **17 years old + rare neurological condition + named local area**
>
> Flagged because this combination may make the individual more identifiable.

This helps the clinician learn over time.

---

# 21. Risk Summary

The product could show a structured summary rather than a single misleading “risk score.”

Example:

```text
Privacy review

Direct identifiers remaining: 0

Potential indirect identifiers:
- rare diagnosis
- exact age
- distinctive accident description

Named organisations remaining: 0

Named locations remaining: 0

Recommendation:
Review 3 highlighted items before using this text externally.
```

Avoid:

```text
Privacy score: 97%
GDPR safe
Fully anonymous
```

Those labels imply a level of certainty that the software cannot justify.

---

# 22. Security Requirements

The security model is a core product feature.

---

## 22.1 Local processing

Raw source text should remain on-device during de-identification.

No external APIs should receive raw source text.

---

## 22.2 No clinical text in telemetry

Do not send clinical content to:

- analytics platforms;
- crash-reporting tools;
- error trackers;
- usage logs;
- debug telemetry;
- remote performance monitoring.

If analytics are used at all, they should record only non-content metadata.

Example:

```text
deidentification_completed = true
processing_duration_ms = 823
identifier_count = 14
```

Not:

```text
source_text = "Elliot Harper..."
```

---

## 22.3 Logging

Application logs should never contain raw clinical text by default.

If diagnostic logging is required:

- it should be opt-in;
- clearly explained;
- locally stored;
- easy to delete;
- automatically scrubbed.

---

## 22.4 Temporary files

Where possible:

- process text in memory;
- minimise temporary disk writes;
- securely delete temporary files;
- avoid operating system previews that expose clinical text.

---

## 22.5 Encryption

If client profiles or mappings are stored:

- encrypt them at rest;
- use operating-system secure key storage;
- do not hard-code encryption keys;
- support complete deletion.

---

## 22.6 Authentication

Later versions may support:

- device authentication;
- Touch ID;
- local application password;
- automatic lock after inactivity.

For a single-user MVP on an already encrypted Mac, this may not be essential for the first prototype but should be considered.

---

## 22.7 Clipboard security

Copied de-identified material may remain in clipboard history.

Possible feature:

> Automatically clear clipboard after X minutes.

This should be optional and clearly explained.

---

# 23. Data Retention

Default behaviour should minimise retained data.

Suggested defaults:

### Source text
- not stored after session closes.

### De-identified text
- not stored unless user explicitly saves.

### Identifier mappings
- session-only by default;
- persistent storage optional.

### Client profiles
- opt-in;
- encrypted;
- manually deletable.

---

# 24. Fail-Safe Behaviour

If the software is uncertain, it should flag rather than silently ignore.

Example:

> “Oakbridge Academy”

Could be:

- a school;
- a church;
- a person;
- an organisation.

The system should mark:

> Possible named organisation — please review.

False positives are inconvenient.

False negatives can expose confidential information.

The MVP should therefore prioritise **sensitivity over convenience**.

---

# 25. Example Transformations

## Example 1 — Progress note

### Original

> Elliot Harper attended with his mother Maya Harper at his home in Riverside District on 18 September 2026. He discussed an altercation near Riverview Sixth Form.

### Suggested output

> [CLIENT] attended with [MOTHER] at home recently. He discussed an altercation near [COLLEGE].

---

## Example 2 — Clinical report

### Original

> Morgan Ellis, a 46-year-old architect from Lakeside, experienced an acquired neurological event in 2024 and received treatment at Central City Hospital.

### Suggested output

> [CLIENT], a middle-aged adult working in a professional role, experienced an acquired neurological event in 2024 and received acute hospital treatment.

Depending on the task, the clinician may choose to retain:

- age;
- occupation;
- month/year;
- diagnosis.

---

## Example 3 — Family work

### Original

> Daniel Reed became upset after his father Marcus Reed discussed a former friend blocking him on Instagram.

### Suggested output

> [CLIENT] became upset after [FATHER] discussed a social-media conflict involving a peer.

This demonstrates that sometimes an entire detail may be generalised rather than simply replacing names.

---

# 26. AI-Ready Output Modes

A later MVP iteration could include different levels of de-identification.

## Mode A — Minimal
Remove direct identifiers only.

Useful when:
- working inside a highly controlled approved environment.

## Mode B — Standard
Remove direct identifiers and generalise locations, organisations, and exact dates.

Likely default.

## Mode C — Maximum privacy
Aggressively generalise:
- dates;
- ages;
- locations;
- organisations;
- occupations;
- unusual circumstances.

Useful when the exact details are not clinically required.

The clinician should always be able to override suggestions.

---

# 27. Clinical Context Preservation

The software must not damage clinically meaningful content unnecessarily.

Examples of information that may be important to retain:

- neurological diagnosis;
- injury severity;
- developmental stage;
- relative chronology;
- family relationship;
- functional ability;
- cognitive profile;
- risk factors;
- treatment goals.

Example:

Poor:

> [CLIENT] has [MEDICAL INFORMATION].

Better:

> [CLIENT] has a history of severe traumatic brain injury.

The goal is:

**Remove identity, preserve clinical meaning.**

---

# 28. Potential Future AI Workflow

Once the privacy gateway is reliable, later versions could support:

```text
Raw clinical information
        ↓
Local privacy gateway
        ↓
Clinician review
        ↓
Approved AI system
        ↓
AI-generated draft
        ↓
Clinician review
        ↓
Clinical record
```

Possible downstream AI tasks:

- progress-note drafting;
- report structuring;
- session plans;
- formulation prompts;
- psychoeducation resources;
- behavioural plans;
- accessible worksheets;
- supervision preparation;
- reflective-practice analysis.

---

# 29. Future Professional Development Mode

A later feature could help clinicians analyse their own practice using de-identified work.

Possible questions:

- What do I consistently do well?
- Where do my formulations become vague?
- Am I overly descriptive rather than formulation-driven?
- Do my notes clearly connect intervention to treatment goals?
- Which therapeutic approaches do I rely on most?
- Where do I tend to avoid difficult conversations?
- Are my reports too long?
- What are my recurring strengths as a clinician?
- What skill areas would most improve my practice?
- Are there patterns in the types of cases that I find difficult?

This should be positioned as:

**structured reflective-practice support**

rather than clinical supervision replacement.

---

# 30. Suggested MVP Technical Architecture

A possible architecture:

```text
┌──────────────────────────────┐
│         Desktop UI           │
│                              │
│ Paste clinical text          │
│ Review detections            │
│ Approve replacements         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Local Processing        │
│                              │
│ 1. Regex detector            │
│ 2. NER detector              │
│ 3. Local dictionary          │
│ 4. Context risk detector     │
│ 5. Replacement engine        │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          Review UI           │
│                              │
│ Original ↔ transformed       │
│ Risk warnings                │
│ Manual edits                 │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      AI-ready output         │
│                              │
│ Copy / save                  │
└──────────────────────────────┘
```

No network connection is required for the core MVP.

---

# 31. Technology Considerations

The exact technology is for the software engineer to decide, but useful design requirements include:

- Mac support initially;
- ideally cross-platform later;
- local NLP models;
- fast processing;
- no dependency on internet connection;
- clear separation between UI and privacy engine;
- testable rule system;
- easy addition of new identifier categories;
- local encrypted configuration.

Potential desktop frameworks could include:

- Swift / SwiftUI for native macOS;
- Electron;
- Tauri;
- Python-based desktop UI for rapid prototyping.

The security trade-offs should be reviewed before choosing the final stack.

---

# 32. Data Model for a Detection

Each detected item could internally look something like:

```json
{
  "text": "Elliot Harper",
  "start": 12,
  "end": 23,
  "category": "PERSON",
  "subtype": "CLIENT",
  "confidence": 0.98,
  "suggested_replacement": "[CLIENT]",
  "detection_source": [
    "named_entity_model",
    "client_dictionary"
  ],
  "user_decision": "pending"
}
```

---

# 33. Replacement Rules

Possible examples:

```yaml
PERSON_CLIENT:
  replacement: "[CLIENT]"

PERSON_MOTHER:
  replacement: "[MOTHER]"

PERSON_CASE_MANAGER:
  replacement: "[CASE_MANAGER]"

ORGANISATION_COLLEGE:
  replacement: "[COLLEGE]"

ORGANISATION_HOSPITAL:
  replacement: "[HOSPITAL]"

LOCATION_LOCAL:
  replacement: "[LOCAL AREA]"

DATE_EXACT:
  replacement: "[RECENT DATE]"
```

---

# 34. Test Dataset

Do not initially test the software using real identifiable clinical records.

Create synthetic cases containing:

- names;
- names with titles;
- multiple people with same surname;
- nicknames;
- dates;
- phone numbers;
- emails;
- addresses;
- hospitals;
- schools;
- uncommon diagnoses;
- family relationships;
- unusual incidents;
- legal references;
- social media details;
- location combinations.

Example synthetic case:

> Noah Bennett, known as Noah, is a 16-year-old attending Harbour View Learning Centre. His mother, Leila Bennett, contacted Dr Rowan Clarke on 14 September 2026. Noah lives at 24 Maple Avenue, AB1 2CD. His mobile number is 07000 000000.

Expected output:

> [CLIENT], a 16-year-old attending [COLLEGE], was discussed by [MOTHER] and [DOCTOR] recently. [CLIENT] lives in [LOCAL AREA].

---

# 35. Edge Cases to Test

The product should be tested against difficult scenarios.

### Names that are also ordinary words
- Grace
- Hope
- May
- Brown

### Named places that look like people
- St George's
- Victoria

### Initials
- ZX
- QY
- LM

### Multiple people with same first name

### Client and clinician sharing surname

### Nicknames

### Misspelled names

### Speech-to-text errors

### Email signatures

### Forwarded email threads

### URLs containing names

### File paths containing client names

### Quoted messages

### Long session transcripts

### Repeated identifiers hundreds of times

---

# 36. Acceptance Criteria for MVP

The MVP is successful if:

### Privacy
- raw text is processed locally;
- no raw clinical text is sent over the network;
- no clinical text enters analytics or logs;
- user can verify that local processing is active.

### Detection
The system reliably flags:
- names;
- emails;
- phone numbers;
- postcodes;
- dates;
- obvious organisations;
- obvious locations.

### Replacement
- substitutions are consistent;
- role-based labels are preserved;
- transformed text remains readable.

### Review
- clinician can review all changes;
- clinician can restore incorrectly removed text;
- clinician can manually redact missed text.

### Output
- de-identified text can be copied easily;
- output does not contain hidden metadata from the original.

### Usability
- typical progress-note text can be reviewed in under 30 seconds after the user becomes familiar with the system.

---

# 37. MVP Metrics

Useful metrics during testing:

### Detection recall
How many known identifiers did the system detect?

### False-negative rate
How many identifiers were missed?

This is the most important safety metric.

### False-positive rate
How many harmless pieces of information were incorrectly flagged?

### Review time
How long does the clinician take to approve a document?

### Manual correction count
How many edits does the clinician make after automatic processing?

### User trust
Does the clinician feel able to understand why items were flagged?

---

# 38. Privacy Threat Model

The engineer should explicitly think through likely failure routes.

Potential risks include:

- source text accidentally sent to a cloud API;
- crash reporter capturing clinical text;
- debugging logs storing text;
- clipboard manager retaining clinical text;
- temporary files remaining on disk;
- automatic cloud backup;
- application screenshots;
- operating-system search indexing files;
- browser extensions if a web UI is used;
- third-party libraries performing telemetry;
- model downloads making unexpected network calls;
- saved client-profile database being stolen;
- export files being written to insecure folders.

Each risk should have a mitigation.

---

# 39. Suggested Privacy Checklist

Before clinical use:

- [ ] All identifier detection runs locally.
- [ ] Network calls audited.
- [ ] Raw text excluded from logs.
- [ ] Raw text excluded from telemetry.
- [ ] Crash reporting reviewed.
- [ ] Temporary file behaviour reviewed.
- [ ] Local database encrypted.
- [ ] Encryption keys stored securely.
- [ ] Automatic cloud backup behaviour reviewed.
- [ ] Clipboard behaviour reviewed.
- [ ] Export behaviour reviewed.
- [ ] Client-profile deletion tested.
- [ ] App uninstall data behaviour reviewed.
- [ ] Dependency telemetry reviewed.
- [ ] Source code dependencies reviewed.
- [ ] Synthetic privacy testing completed.
- [ ] DPIA / information-governance review considered before real clinical deployment.

---

# 40. Information Governance Questions

Before real clinical deployment, the clinician/organisation should separately consider:

- Who is the data controller?
- Who is the data processor?
- What is the lawful basis for processing?
- What special-category condition is relied upon?
- Does the organisation permit this software?
- Is a DPIA required?
- Are there organisational information-security standards?
- Is device encryption mandatory?
- Is local storage permitted?
- What retention rules apply?
- What approved AI service will receive the de-identified output?
- Does that service retain prompts?
- Is data used for model training?
- Where is data processed?
- Is an appropriate contract/DPA in place where required?

The privacy gateway should reduce risk, but it should not be treated as a substitute for organisational governance.

---

# 41. Development Roadmap

## Phase 0 — Design

- define threat model;
- define identifier taxonomy;
- create synthetic test cases;
- agree local-only architecture;
- define privacy language used in the interface.

---

## Phase 1 — Basic MVP

Implement:

- text input;
- regex detection;
- basic person/location/organisation NER;
- highlighting;
- suggested replacements;
- manual accept/edit/keep/remove;
- copy output;
- no storage.

Goal:

> A usable local de-identification tool.

---

## Phase 2 — Clinical Intelligence

Add:

- role recognition;
- age generalisation;
- date generalisation;
- organisation categorisation;
- indirect identifier warnings;
- configurable de-identification levels.

Goal:

> Preserve clinical meaning while improving privacy.

---

## Phase 3 — Local Client Dictionaries

Add:

- optional local client profiles;
- alias recognition;
- relationship mappings;
- encrypted storage;
- profile deletion.

Goal:

> Dramatically reduce repetitive manual work for recurring clients.

---

## Phase 4 — Workflow Templates

Add optional output prompts such as:

### Progress note
> Turn this de-identified session information into a concise neuropsychology progress note, clearly separating client report, observations, intervention, risk, and plan.

### Session plan
> Based on this de-identified case material, propose a structured 60-minute session plan linked to the current treatment goals.

### Report section
> Organise this information into a professional neuropsychology report section while preserving uncertainty and distinguishing observation from interpretation.

### Resource
> Create an accessible client resource from this information using simple language and concrete examples.

These prompts could be copied alongside the de-identified material.

---

## Phase 5 — Approved AI Integration

Only after governance review:

- connect to an approved AI service;
- send only clinician-approved transformed text;
- clearly display exactly what will leave the device;
- require explicit user action;
- maintain auditability.

---

## Phase 6 — Reflective Practice

Add:

- de-identified portfolio of notes/reports;
- writing-pattern analysis;
- clinician skill-development feedback;
- report concision analysis;
- formulation quality review;
- recurring themes in intervention style.

This should support, not replace, professional supervision.

---

# 42. Example MVP User Story

### User story

> As a neuropsychologist, I want to paste a clinical progress-note draft into a local application and have possible identifiers highlighted and replaced with meaningful placeholders so that I can review the changes quickly before using the material in an approved AI tool.

### Acceptance criteria

Given:

> I met Elliot Harper and his mother Maya Harper at Riverview Sixth Form on 18 September.

The application should identify:

- Elliot Harper → person/client;
- Maya Harper → person/mother;
- Riverview Sixth Form → organisation/college;
- 18 September → date.

It should propose:

> I met [CLIENT] and [MOTHER] at [COLLEGE] recently.

The clinician must be able to modify every proposed transformation.

---

# 43. Example Indirect-Identifier User Story

### User story

> As a clinician, I want the system to flag unusual combinations of apparently non-identifying details so that I am reminded to consider whether the person could still be identified.

Example:

> A 17-year-old with a rare movement disorder attending a named specialist school in a small town.

The application may say:

> **Possible indirect identification risk**
>
> The combination of exact age, rare diagnosis, named specialist school and location may make this person identifiable. Consider generalising one or more elements.

---

# 44. Product Principles

1. **Local by default**
2. **Human review is mandatory**
3. **Preserve clinical meaning**
4. **Flag uncertainty**
5. **Prefer false positives to false negatives**
6. **No misleading compliance claims**
7. **Minimal data retention**
8. **Explain why something was flagged**
9. **Make privacy visible**
10. **Keep the first version simple**

---

# 45. The Product's Differentiator

Generic redaction tools are usually designed to find:

- names;
- phone numbers;
- addresses;
- emails.

Clinical de-identification is harder.

A strong clinical privacy tool also understands that:

> “17-year-old with a childhood TBI, living in a specific borough, attending a named specialist college, with a particular support package”

may be identifying even without a name.

The key differentiator is therefore:

> **Clinically informed de-identification that preserves the information needed for useful AI assistance while identifying combinations of details that may reveal the person.**

This is where collaboration between a neuropsychologist and a software engineer is particularly valuable.

---

# 46. Immediate Build Recommendation

The first prototype should be intentionally narrow.

### Build this:

```text
PASTE TEXT
    ↓
LOCAL DETECTION
    ↓
HIGHLIGHT POSSIBLE IDENTIFIERS
    ↓
SUGGEST ROLE-BASED REPLACEMENTS
    ↓
CLINICIAN APPROVES/EDITS
    ↓
FINAL LOCAL PRIVACY CHECK
    ↓
COPY AI-READY TEXT
```

### Do not build yet:

- clinical databases;
- EPR integration;
- direct AI APIs;
- automatic report writing;
- cloud accounts;
- complex collaboration.

The first milestone is simply:

> **Make manual de-identification much faster without creating a new confidentiality risk.**

---

# 47. Prototype Success Test

Take 20–50 entirely synthetic clinical notes representing realistic neuropsychology work.

Include:

- progress notes;
- family sessions;
- paediatric cases;
- adult ABI cases;
- rare neurological conditions;
- care-home cases;
- safeguarding material;
- school information;
- emails;
- report excerpts.

For each document:

1. Create a gold-standard list of identifiers.
2. Run the tool.
3. Record identifiers detected.
4. Record identifiers missed.
5. Record false positives.
6. Review transformed output.
7. Measure time to completion.
8. Record any loss of important clinical meaning.

The system should not be trialled on live identifiable client information until the security architecture and governance have been reviewed appropriately.

---

# 48. Future Vision

The longer-term system could become a secure bridge between confidential clinical practice and generative AI.

Possible workflow:

```text
Clinical material
      ↓
Privacy transformation
      ↓
Clinician verification
      ↓
Approved AI assistance
      ↓
Clinician critical review
      ↓
Final clinical work
```

Potential benefits:

- less administrative burden;
- faster progress notes;
- more consistent reports;
- better session preparation;
- easier creation of personalised resources;
- stronger reflective practice;
- more time for clinical work;
- lower risk of accidentally entering identifiable information into AI systems.

The core principle should remain:

> **AI may assist the clinician, but the clinician controls the information, reviews the privacy transformation, and remains responsible for the final clinical output.**
