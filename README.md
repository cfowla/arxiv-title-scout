# arxiv-title-scout — Prototype 0.0.1

A deliberately small, recall-oriented prototype for finding **leads** in recent
arXiv titles.

It does **not** decide whether a paper is good. It answers a narrower question:

> Is this title interesting enough to inspect further?

## Design constraints

- Python standard library only.
- Current interests live outside source code in `interests.json`.
- Every score is explainable.
- Every scan creates a run log.
- Human `READ / SKIM / PASS` judgments can be recorded separately.
- The numeric weights and score bands are provisional and are intended to be
  revised after real usage.

## Files

```text
arxiv-title-scout-prototype/
├── scout.py
├── interests.json
├── test_scout.py
├── README.md
└── data/
    ├── feedback.csv       # created when feedback is recorded
    └── runs/              # one JSON record per scan/demo
```

## Requirements

Python 3.10+ and an internet connection for live arXiv scans.

No pip install is required.

## 1. Verify it locally

```bash
python scout.py demo
```

The demo uses built-in titles, prints every score, and writes a JSON run record.

Then:

```bash
python -m unittest -v
```

## 2. Run a live scan

Default categories are `cs.AI` and `cs.CL`.

```bash
python scout.py scan
```

Useful variants:

```bash
python scout.py scan --max-results 200 --limit 50
python scout.py scan --since-hours 48 --limit 50
python scout.py scan -c cs.CL --max-results 100
python scout.py scan -c cs.AI -c cs.CL --show-zero
```

The live scanner uses arXiv's Atom API and sorts by submission date.

## 3. Interpret the output

Example:

```text
 19  HIGH  2608.12345     Evaluating Small Language Models for Clinical Text
     +7 small_language_models [small language model];
     +8 clinical_nlp [clinical text];
     +4 evaluation_reliability [evaluating]
```

Important: `HIGH`, `LEAD`, `WEAK`, and `NONE` are only descriptive score bands.
They are **not** paper-quality judgments and should not become stable semantics
until usage data supports them.

## 4. Record your actual decisions

After you inspect a surfaced title/abstract:

```bash
python scout.py feedback 2608.12345 read
python scout.py feedback 2608.23456 skim
python scout.py feedback 2608.34567 pass
```

Optional note:

```bash
python scout.py feedback 2608.34567 pass --note "robotics false positive"
```

This appends to:

```text
data/feedback.csv
```

The feedback is intentionally independent of the scoring logic. Nothing
automatically "learns" yet.

## 5. Inspect accumulated usage

```bash
python scout.py stats
```

This reports:

- number of runs;
- number of titles scored;
- number surfaced with positive scores;
- score-band counts;
- READ / SKIM / PASS counts.

## What data to collect before redesign

Use the prototype normally rather than tuning every surprising result
immediately. A useful revision dataset would contain:

1. Multiple live scans on different days.
2. At least ~50 explicit READ/SKIM/PASS decisions if practical.
3. Notes on obvious false positives.
4. Titles you found interesting that scored zero or too low.
5. Repeated concepts that appear under vocabulary not represented in
   `interests.json`.

That dataset should answer the revision questions:

- Are explicit term weights useful?
- Which concepts are too broad?
- Which concepts are missing?
- Do negative weights suppress desirable cross-domain work?
- Are category-specific priors needed?
- Is semantic similarity worth adding?
- Should title screening remain separate from abstract screening?

## Known prototype limitations

- Exact/normalized term matching only; no stemming or embeddings.
- A concept scores only once even if multiple synonyms match.
- It retrieves the newest records matching selected categories and optionally
  applies a local publication-time filter.
- arXiv announcement/submission timing does not map perfectly onto a human
  notion of "today."
- No deduplication across repeated scans in the displayed output.
- Feedback IDs are not validated against prior run logs.
- No learned personalization.
- No abstract scoring.
- No UI.
- Weights are hypotheses, not calibrated measurements.

Those are acceptable limitations for generating the first usage dataset.
