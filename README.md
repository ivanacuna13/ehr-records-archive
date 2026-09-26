# Records Archive — an exploded view of a synthetic hospital's EHR

Static site: `site/index.html` + generated JSON. Three.js r170 and fonts load from CDNs.

Data: derived from [sparkcpark/synthetic_hospital](https://github.com/sparkcpark/synthetic_hospital) (MIT License, © 2026 sparkcpark) — fully synthetic, no real patients.

The hosted page has a password screen. It is cosmetic: the JSON under `site/data/` is public in this repo.

```
.venv/bin/python build.py                               # regenerate site/data from synthetic_hospital/
python3 -m http.server 8731 --directory site            # then open http://localhost:8731
```

`build.py` reads `synthetic_hospital/benchmark_v1.3.db` + `patient_profiles.jsonl` (clone of
sparkcpark/synthetic_hospital; fully synthetic) and writes `site/data/hospital.json` (1.2 MB: one entry per
patient + diagnosis→patients index) and `site/data/patients/<id>.json` (1,268 files, lazy-loaded when a chart
is opened). ICD-10-CM chapter/block lookup uses the `simple_icd_10_cm` package in `.venv`.

## How the data becomes objects (form follows function)

| Object | Data | Why this shape |
|---|---|---|
| Wing (shelving range + lit sign) | ICD-10 chapter | ICD-10 is a library-style classification; chapters are the top shelf mark |
| Shelf label + divider guide | ICD-10 block | the next classification level, the way call-number ranges divide stacks |
| Chart on the shelf | one patient, filed by primary diagnosis | a paper chart lives in exactly one place |
| Chart thickness | number of encounters | a real chart gets thicker with each visit |
| Spine: colour band / call number / year sticker | chapter / primary ICD-10 code / year of last visit | real chart spines carry colour codes and retention year stickers |
| Hub: open jacket + face sheet | patient demographics & profile | every record is keyed to the patient |
| Brass spoke | encounter ↔ patient binding | the fastener that binds a folder into the chart |
| Folder on the dated arc | encounter, clockwise by date; tab = date + dept | visits are dated folders in chronological order |
| Sheet (printed form) | one `encounter_ehr_sections` row | lab = results table, vitals = flowsheet, meds = reconciliation table, allergies = red alert sheet, imaging = radiology report, narrative = typed note |
| Master problem list strip + tabs | patient-level diagnoses (ground-truth active + chronic + secondary) | in an EHR the problem list lives at the patient level |
| Ring + beads | a diagnosis through time; bead = visit where documented (size = how) | chronic conditions visibly run through the history; dashes = before first documented |
| Yellow / blue highlight | finding on the exact printed line it was abstracted from (present / pertinent negative) | findings are evidence inside documents |
| Thread from highlight to bead | `diagnosis_findings` typed relation, restricted to diagnoses documented at that visit | evidence supports a diagnosis at a point in time |
| Margin tags / tab codes / spine labels | SNOMED CT & LOINC / ICD-10 + SNOMED / ICD-10 | codes are call numbers on the things they classify |
| Pink slip + return thread | `imaging_orders` row → that visit's imaging section | an order leaves the visit; the result comes back as a report |

Interactions: search/filter (diagnosis, code, age, sex, wing) slides matching charts out; picking a diagnosis
traces it across all wings with per-wing counts. Click a chart → fly-in, pull, open, explode. Assembled/Exploded
toggle, hover labels, glass side panel with the real record text, click a problem tab → light pulse along the ring
to every visit, document and highlighted finding (unrelated items dim), timeline scrubber (focused visit lifts its
pages into a reading wall), Back flies the chart home. Esc / ← → are wired too.

Performance (headless Chrome, Apple M2 Pro, 1600×1000 @2×): 60 fps at both levels with GTAO, DOF, bloom,
planar floor reflection and soft shadows on. Adaptive pixel ratio (1.15–1.75) with hysteresis; AO and DOF run at
half resolution; all 1,268 charts are 4 instanced meshes; printed labels are LOD-faded by camera distance; sheet
textures paint lazily (low-res for all, high-res for the visit in focus).

## Record types present in the data but not represented

- `benchmark_ground_truth` beyond the diagnosis list: `context_summarization` reference summaries,
  `evidence_retrieval` passage sets, `imaging_indication` pre-read summaries / differentials. These are benchmark
  annotations about the chart, not chart records.
- `relevance_judgments` (graded relevance of each section to the patient's diagnoses) — would map naturally to
  sheet emphasis in trace mode.
- `board_questions` and distractor rows of `question_diagnoses` / findings with `relevance = distractor` roles
  (the source exam questions the encounters were generated from). Distractor diagnoses are deliberately excluded:
  they are wrong answers, not the patient's problems.
- `demographic` findings (11,180, e.g. "Age 32 years") — dropped rather than highlighted; the face sheet shows the
  demographics directly.
- `longitudinal_encounters.note_text` (the assembled full note) — represented only through its sections.
- `generation_method`, `is_modified`, `search_vector`, split labels — metadata about the synthetic generation.
- 198 findings could not be placed on any document and 11,302 were placed on the right document but not a specific
  line (they highlight nothing; they still appear in the side panel).

## Shapes / placements that are not fully justified

- **Primary diagnosis for filing** is not a field in the data. Rule used: prefer disease chapters over R/Z/U codes,
  then active/chronic over secondary, then most-documented, then earliest. A different rule re-shelves charts.
- **Problem-list "mention" beads** come from a name match in each visit's PMH/HPI/assessment text, counted only on or
  after the first coded documentation (the synthetic notes copy the whole problem list backwards in time).
- **Finding → section placement** is inferred (finding type → candidate sections, then text match to a line);
  `question_findings.ehr_section` is empty in v1.3.
- **The arc layouts** (rotunda of wings, clock-dial of visits) are compositional choices so every face is visible from
  one viewpoint; the order along each arc is data (chapter order, date order), the curvature is not.
- **Reading dais, rotunda wall, backlit backdrop, floor** are architecture/staging, not records.
- **Year-sticker colours** cycle through 11 hues (2020–2030); they encode year but the hue assignment is arbitrary.
- **Folder tab stagger** (three positions) mimics real third-cut folders so tabs show in the closed chart; it carries
  no data.
