#!/usr/bin/env python3
"""
arxiv-title-scout — disposable working prototype.

Goal:
    Retrieve recent arXiv titles, score them against configurable interests,
    explain why they scored, and collect lightweight usage/feedback data.

Python:
    3.10+
Dependencies:
    Standard library only.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent
DEFAULT_INTERESTS = ROOT / "interests.json"
DATA_DIR = ROOT / "data"
RUNS_DIR = DATA_DIR / "runs"
FEEDBACK_FILE = DATA_DIR / "feedback.csv"
API_URL = "https://export.arxiv.org/api/query"

ATOM = {"atom": "http://www.w3.org/2005/Atom"}

DEFAULT_CATEGORIES = ["cs.AI", "cs.CL"]


@dataclass
class Paper:
    arxiv_id: str
    title: str
    summary: str
    published: str
    updated: str
    categories: list[str]
    authors: list[str]
    url: str


@dataclass
class Match:
    kind: str
    concept: str
    term: str
    points: int


@dataclass
class ScoredPaper:
    paper: Paper
    score: int
    matches: list[Match]

    @property
    def matched_concepts(self) -> list[str]:
        return [m.concept for m in self.matches]


def normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[-_/]", " ", text)
    text = re.sub(r"[^a-z0-9.+ ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def term_matches(term: str, normalized_title: str) -> bool:
    """Phrase-like matching with word boundaries for short tokens."""
    t = normalize(term)
    if not t:
        return False
    # Use token boundaries for both phrases and single terms so that,
    # for example, "medical language model" does not match inside
    # "biomedical language models".
    return re.search(
        rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])",
        normalized_title,
    ) is not None


def load_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        config = json.load(f)
    for section in ("interests", "negative_signals"):
        if section not in config or not isinstance(config[section], dict):
            raise ValueError(f"Config must contain object: {section}")
    return config


def score_title(title: str, config: dict[str, Any]) -> tuple[int, list[Match]]:
    """
    Score each concept at most once.

    If multiple terms from the same concept match, the first matching term is
    recorded. This prevents synonym-heavy concept definitions from inflating
    their own score.
    """
    nt = normalize(title)
    matches: list[Match] = []

    for kind, section in (("interest", "interests"), ("negative", "negative_signals")):
        for concept, spec in config[section].items():
            points = int(spec["weight"])
            for term in spec.get("terms", []):
                if term_matches(term, nt):
                    matches.append(Match(kind=kind, concept=concept, term=term, points=points))
                    break

    return sum(m.points for m in matches), matches


def _text(node: ET.Element | None) -> str:
    if node is None or node.text is None:
        return ""
    return re.sub(r"\s+", " ", node.text).strip()


def parse_arxiv_atom(xml_bytes: bytes) -> list[Paper]:
    root = ET.fromstring(xml_bytes)
    papers: list[Paper] = []

    for entry in root.findall("atom:entry", ATOM):
        raw_id = _text(entry.find("atom:id", ATOM))
        arxiv_id = raw_id.rstrip("/").split("/")[-1]

        links = entry.findall("atom:link", ATOM)
        abs_url = raw_id
        for link in links:
            if link.attrib.get("rel") == "alternate":
                abs_url = link.attrib.get("href", raw_id)
                break

        categories = [
            c.attrib.get("term", "")
            for c in entry.findall("atom:category", ATOM)
            if c.attrib.get("term")
        ]
        authors = [
            _text(a.find("atom:name", ATOM))
            for a in entry.findall("atom:author", ATOM)
        ]

        papers.append(
            Paper(
                arxiv_id=arxiv_id,
                title=_text(entry.find("atom:title", ATOM)),
                summary=_text(entry.find("atom:summary", ATOM)),
                published=_text(entry.find("atom:published", ATOM)),
                updated=_text(entry.find("atom:updated", ATOM)),
                categories=categories,
                authors=[a for a in authors if a],
                url=abs_url,
            )
        )
    return papers


def fetch_arxiv(categories: list[str], max_results: int) -> list[Paper]:
    category_query = " OR ".join(f"cat:{c}" for c in categories)
    search_query = f"({category_query})"
    params = {
        "search_query": search_query,
        "start": 0,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "arxiv-title-scout-prototype/0.0.1 (personal research tool)"
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return parse_arxiv_atom(resp.read())


def parse_dt(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def filter_recent(papers: Iterable[Paper], since_hours: int | None) -> list[Paper]:
    if since_hours is None:
        return list(papers)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    result = []
    for paper in papers:
        dt = parse_dt(paper.published)
        if dt is not None and dt >= cutoff:
            result.append(paper)
    return result


def rank(papers: Iterable[Paper], config: dict[str, Any]) -> list[ScoredPaper]:
    scored = []
    for paper in papers:
        score, matches = score_title(paper.title, config)
        scored.append(ScoredPaper(paper=paper, score=score, matches=matches))
    return sorted(scored, key=lambda x: (-x.score, x.paper.title.lower()))


def score_band(score: int) -> str:
    # Descriptive only; intentionally NOT a keep/skip decision.
    if score >= 12:
        return "HIGH"
    if score >= 6:
        return "LEAD"
    if score > 0:
        return "WEAK"
    return "NONE"


def print_results(results: list[ScoredPaper], limit: int | None = None, show_zero: bool = False) -> None:
    shown = 0
    for item in results:
        if not show_zero and item.score <= 0:
            continue
        if limit is not None and shown >= limit:
            break

        p = item.paper
        print(f"{item.score:>3}  {score_band(item.score):<4}  {p.arxiv_id:<14} {p.title}")
        if item.matches:
            reason = "; ".join(
                f"{m.points:+d} {m.concept} [{m.term}]"
                for m in item.matches
            )
            print(f"     {reason}")
        print(f"     {p.url}")
        shown += 1

    if shown == 0:
        print("No positive-scoring titles in this result set.")


def make_run_record(
    results: list[ScoredPaper],
    args: argparse.Namespace,
    source: str,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    positives = [x for x in results if x.score > 0]
    return {
        "schema_version": 1,
        "run_id": now.strftime("%Y%m%dT%H%M%SZ"),
        "created_at": now.isoformat(),
        "source": source,
        "parameters": {
            "categories": getattr(args, "category", None),
            "max_results": getattr(args, "max_results", None),
            "since_hours": getattr(args, "since_hours", None),
            "config": str(getattr(args, "config", "")),
        },
        "counts": {
            "retrieved": len(results),
            "positive_score": len(positives),
            "high": sum(x.score >= 12 for x in results),
            "lead": sum(6 <= x.score < 12 for x in results),
            "weak": sum(0 < x.score < 6 for x in results),
            "nonpositive": sum(x.score <= 0 for x in results),
        },
        "results": [
            {
                "arxiv_id": x.paper.arxiv_id,
                "title": x.paper.title,
                "url": x.paper.url,
                "published": x.paper.published,
                "categories": x.paper.categories,
                "score": x.score,
                "band": score_band(x.score),
                "matches": [asdict(m) for m in x.matches],
            }
            for x in results
        ],
    }


def save_run(record: dict[str, Any]) -> Path:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    path = RUNS_DIR / f"{record['run_id']}.json"
    # Avoid collision when demo/scan happen inside one second.
    i = 2
    while path.exists():
        path = RUNS_DIR / f"{record['run_id']}-{i}.json"
        i += 1
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def cmd_scan(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    try:
        papers = fetch_arxiv(args.category, args.max_results)
    except Exception as exc:
        print(f"arXiv fetch failed: {exc}", file=sys.stderr)
        print("Tip: run `python scout.py demo` to verify scoring locally.", file=sys.stderr)
        return 2

    papers = filter_recent(papers, args.since_hours)
    results = rank(papers, config)
    print_results(results, limit=args.limit, show_zero=args.show_zero)
    record = make_run_record(results, args, source="arxiv_api")
    path = save_run(record)
    print(f"\nRun log: {path}")
    return 0


def demo_papers() -> list[Paper]:
    titles = [
        ("demo.0001", "Evaluating Small Language Models for Clinical Information Extraction", ["cs.CL"]),
        ("demo.0002", "Failure Propagation in Tool-Using Language Models", ["cs.AI"]),
        ("demo.0003", "Retrieval-Augmented Generation for Clinical Question Answering", ["cs.CL", "cs.AI"]),
        ("demo.0004", "Efficient Long-Context Inference with KV Cache Compression", ["cs.CL"]),
        ("demo.0005", "Retrieval-Augmented Navigation for Autonomous Robots", ["cs.AI", "cs.RO"]),
        ("demo.0006", "A Benchmark for Hallucination Detection in Biomedical Language Models", ["cs.CL"]),
        ("demo.0007", "Object Detection for Autonomous Driving Under Adverse Weather", ["cs.CV"]),
        ("demo.0008", "Calibration of Tool-Using Agents Under Distribution Shift", ["cs.AI"]),
        ("demo.0009", "Dense Retrieval for Large-Scale Recommendation Systems", ["cs.IR"]),
        ("demo.0010", "Longitudinal Electronic Health Record Summarization with Language Models", ["cs.CL"]),
        ("demo.0011", "Speculative Decoding for Efficient Language Model Inference", ["cs.CL"]),
        ("demo.0012", "A New Transformer Architecture for Image Generation", ["cs.CV"]),
    ]
    now = datetime.now(timezone.utc).isoformat()
    return [
        Paper(
            arxiv_id=aid,
            title=title,
            summary="Demo record.",
            published=now,
            updated=now,
            categories=cats,
            authors=["Demo Author"],
            url=f"https://arxiv.org/abs/{aid}",
        )
        for aid, title, cats in titles
    ]


def cmd_demo(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    results = rank(demo_papers(), config)
    print_results(results, limit=None, show_zero=True)
    record = make_run_record(results, args, source="built_in_demo")
    path = save_run(record)
    print(f"\nDemo run log: {path}")
    return 0


def ensure_feedback_file() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not FEEDBACK_FILE.exists():
        with FEEDBACK_FILE.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(
                ["timestamp", "arxiv_id", "decision", "note"]
            )


def cmd_feedback(args: argparse.Namespace) -> int:
    ensure_feedback_file()
    timestamp = datetime.now(timezone.utc).isoformat()
    with FEEDBACK_FILE.open("a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(
            [timestamp, args.arxiv_id, args.decision.upper(), args.note or ""]
        )
    print(f"Recorded {args.decision.upper()} for {args.arxiv_id}")
    return 0


def read_feedback() -> list[dict[str, str]]:
    ensure_feedback_file()
    with FEEDBACK_FILE.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def iter_run_files() -> list[Path]:
    if not RUNS_DIR.exists():
        return []
    return sorted(RUNS_DIR.glob("*.json"))


def cmd_stats(args: argparse.Namespace) -> int:
    run_files = iter_run_files()
    feedback = read_feedback()

    print(f"Runs: {len(run_files)}")
    if run_files:
        retrieved = positive = high = lead = weak = 0
        for path in run_files:
            record = json.loads(path.read_text(encoding="utf-8"))
            c = record.get("counts", {})
            retrieved += int(c.get("retrieved", 0))
            positive += int(c.get("positive_score", 0))
            high += int(c.get("high", 0))
            lead += int(c.get("lead", 0))
            weak += int(c.get("weak", 0))
        print(f"Titles scored: {retrieved}")
        print(f"Positive-scoring: {positive}")
        print(f"  HIGH: {high}")
        print(f"  LEAD: {lead}")
        print(f"  WEAK: {weak}")

    print(f"Feedback decisions: {len(feedback)}")
    if feedback:
        counts: dict[str, int] = {}
        for row in feedback:
            d = row["decision"]
            counts[d] = counts.get(d, 0) + 1
        for decision in sorted(counts):
            print(f"  {decision}: {counts[decision]}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Recall-oriented arXiv title lead scanner."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="Fetch recent arXiv records and score titles.")
    scan.add_argument(
        "-c", "--category", action="append", default=None,
        help="arXiv category. Repeatable. Default: cs.AI + cs.CL"
    )
    scan.add_argument("--max-results", type=int, default=100)
    scan.add_argument(
        "--since-hours", type=int, default=None,
        help="Optional local filter on publication timestamp."
    )
    scan.add_argument("--limit", type=int, default=30)
    scan.add_argument("--show-zero", action="store_true")
    scan.add_argument("--config", type=Path, default=DEFAULT_INTERESTS)
    scan.set_defaults(func=cmd_scan)

    demo = sub.add_parser("demo", help="Run scorer against built-in test-like titles.")
    demo.add_argument("--config", type=Path, default=DEFAULT_INTERESTS)
    demo.set_defaults(func=cmd_demo)

    feedback = sub.add_parser("feedback", help="Record your judgment of a surfaced paper.")
    feedback.add_argument("arxiv_id")
    feedback.add_argument(
        "decision", choices=["read", "skim", "pass"],
        help="Your decision for this paper."
    )
    feedback.add_argument("--note", default="")
    feedback.set_defaults(func=cmd_feedback)

    stats = sub.add_parser("stats", help="Summarize accumulated prototype usage data.")
    stats.set_defaults(func=cmd_stats)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if getattr(args, "category", None) is None and args.command == "scan":
        args.category = DEFAULT_CATEGORIES
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
