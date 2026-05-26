"""CI/CD test result ingestion.

Parses JUnit XML and CTRF JSON result files, matches each reported test to
a TestCase in the target Test Run's project, and writes/updates TestResult
rows accordingly. Returns a summary the caller can show to the user.

Matching precedence per CI result:
  1. Explicit case id from a `tc_id` / `test_case_id` property (JUnit
     ``<properties>`` or CTRF ``extra``).
  2. ``[TC-{id}]`` token anywhere in the name or classname.
  3. Reference field equality (case-insensitive) against ``TestCase.reference``.
  4. Title exact match against ``TestCase.title``.

Cases already attached to the run (have a TestResult row) win ties; otherwise
matching is scoped to the run's project.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

from defusedxml import ElementTree as DefusedET
from sqlalchemy.orm import Session, joinedload

from .. import models


# Hard upload limit. JUnit reports beyond a few MB are pathological and almost
# always indicate someone trying to break the parser.
MAX_PAYLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

SUPPORTED_FORMATS = ("junit", "ctrf")

# Maps from external status strings to ResultStatus values used internally.
_JUNIT_PASS = "pass"
_JUNIT_FAIL = "fail"
_JUNIT_SKIP = "skip"
_JUNIT_BLOCK = "block"

_CTRF_STATUS_MAP = {
    "passed": _JUNIT_PASS,
    "pass": _JUNIT_PASS,
    "ok": _JUNIT_PASS,
    "failed": _JUNIT_FAIL,
    "fail": _JUNIT_FAIL,
    "error": _JUNIT_FAIL,
    "broken": _JUNIT_FAIL,
    "skipped": _JUNIT_SKIP,
    "skip": _JUNIT_SKIP,
    "pending": _JUNIT_SKIP,
    "untested": _JUNIT_SKIP,
    "blocked": _JUNIT_BLOCK,
    "block": _JUNIT_BLOCK,
    # CTRF "other" means "neither pass nor fail" — record it as blocked
    # rather than failing the test, since we have no signal it's a defect.
    "other": _JUNIT_BLOCK,
}

# Status precedence for de-duplication when multiple CI records point to the
# same test case (parameterized tests, retries, etc.). Worst wins.
_STATUS_PRIORITY = {_JUNIT_FAIL: 4, _JUNIT_BLOCK: 3, _JUNIT_SKIP: 2, _JUNIT_PASS: 1}

# Cap stored test output to keep the DB lean. Stack traces are commonly the
# big offender. We add a marker so readers know the body was truncated.
_MAX_ACTUAL_RESULT_CHARS = 8000

# Shared tokenizer for splitting reference / name strings into comparable
# tokens. Reused on both indexing and matching paths so a reference like
# ``REQ-001:auth.login`` indexes and matches the same way.
_TOKEN_SPLIT_RE = re.compile(r"[\s,;|.:]+")

_TC_TOKEN_RE = re.compile(r"\[?TC[-_]?(\d+)\]?", re.IGNORECASE)
_PROPERTY_KEYS = {"tc_id", "tcid", "test_case_id", "testcase_id", "case_id", "tms_id"}


class CIIngestError(ValueError):
    """Raised for malformed payloads. Mapped to HTTP 400 at the route."""


@dataclass
class ParsedResult:
    """One CI test record after parsing, before matching to a TestCase."""

    name: str
    classname: Optional[str] = None
    status: str = _JUNIT_PASS  # one of pass/fail/skip/block
    duration_seconds: Optional[float] = None
    message: Optional[str] = None
    output: Optional[str] = None
    explicit_case_id: Optional[int] = None
    raw_status: Optional[str] = None
    started_at: Optional[datetime] = None

    @property
    def full_name(self) -> str:
        return f"{self.classname}.{self.name}" if self.classname else self.name


@dataclass
class MatchOutcome:
    parsed: ParsedResult
    test_case_id: Optional[int] = None
    test_case_title: Optional[str] = None
    test_result_id: Optional[int] = None
    action: str = "unmatched"  # one of: created, updated, unmatched, skipped
    reason: Optional[str] = None


@dataclass
class IngestSummary:
    format: str
    total: int = 0
    matched: int = 0
    created: int = 0
    updated: int = 0
    unmatched: int = 0
    skipped: int = 0
    results: List[MatchOutcome] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "format": self.format,
            "total": self.total,
            "matched": self.matched,
            "created": self.created,
            "updated": self.updated,
            "unmatched": self.unmatched,
            "skipped": self.skipped,
            "results": [
                {
                    "name": outcome.parsed.full_name,
                    "status": outcome.parsed.status,
                    "raw_status": outcome.parsed.raw_status,
                    "duration_seconds": outcome.parsed.duration_seconds,
                    "test_case_id": outcome.test_case_id,
                    "test_case_title": outcome.test_case_title,
                    "test_result_id": outcome.test_result_id,
                    "action": outcome.action,
                    "reason": outcome.reason,
                }
                for outcome in self.results
            ],
        }


def detect_format(content: bytes, filename: Optional[str] = None) -> str:
    """Best-effort format detection from filename extension and content sniffing."""
    if filename:
        lowered = filename.lower()
        if lowered.endswith(".json"):
            return "ctrf"
        if lowered.endswith((".xml", ".junit")):
            return "junit"

    stripped = content.lstrip()
    if not stripped:
        raise CIIngestError("Empty file")
    if stripped[:1] == b"<":
        return "junit"
    if stripped[:1] in (b"{", b"["):
        return "ctrf"
    raise CIIngestError("Could not detect file format. Expected XML or JSON.")


def parse(content: bytes, fmt: str) -> List[ParsedResult]:
    """Parse a payload into a normalized result list."""
    if len(content) > MAX_PAYLOAD_BYTES:
        raise CIIngestError(
            f"File is too large ({len(content)} bytes). Limit is {MAX_PAYLOAD_BYTES} bytes."
        )
    if fmt == "junit":
        return _parse_junit(content)
    if fmt == "ctrf":
        return _parse_ctrf(content)
    raise CIIngestError(f"Unsupported format: {fmt}")


def _parse_junit(content: bytes) -> List[ParsedResult]:
    try:
        root = DefusedET.fromstring(content)
    except DefusedET.ParseError as exc:
        raise CIIngestError(f"Invalid JUnit XML: {exc}") from exc

    # Walk every descendant ``testcase`` regardless of how deeply nested it
    # is (Maven Surefire and a few other emitters wrap testsuites inside
    # testsuites) and regardless of XML namespace.
    cases = [el for el in root.iter() if _strip_ns(el.tag) == "testcase"]
    if not cases and _strip_ns(root.tag) == "testcase":
        # The whole document is a single bare ``testcase`` — unusual, but
        # cheap to accept.
        cases = [root]
    return [_parse_junit_case(case) for case in cases]


def _parse_junit_case(case_elem) -> ParsedResult:
    name = (case_elem.get("name") or "").strip() or "<unnamed>"
    classname = (case_elem.get("classname") or "").strip() or None
    time_str = case_elem.get("time")
    duration = None
    if time_str:
        try:
            duration = float(time_str)
        except (TypeError, ValueError):
            duration = None

    # Status priority: error > failure > skipped > pass.
    status = _JUNIT_PASS
    raw_status = "passed"
    message: Optional[str] = None
    output_parts: List[str] = []
    system_out: Optional[str] = None
    system_err: Optional[str] = None

    for child in case_elem:
        tag = _strip_ns(child.tag)
        if tag in ("failure", "error") and status == _JUNIT_PASS:
            status = _JUNIT_FAIL
            raw_status = tag
            message = (child.get("message") or "").strip() or None
            text_body = (child.text or "").strip() or None
            if text_body:
                output_parts.append(text_body)
        elif tag == "skipped" and status == _JUNIT_PASS:
            status = _JUNIT_SKIP
            raw_status = "skipped"
            message = (child.get("message") or "").strip() or None
        elif tag == "system-out":
            system_out = (child.text or "").strip() or None
        elif tag == "system-err":
            system_err = (child.text or "").strip() or None

    # Some legacy emitters (TestNG, custom) annotate status with an attribute
    # rather than a child element. Honor it as a fallback when no child
    # element produced a non-pass.
    attr_status = (case_elem.get("status") or "").strip().lower()
    if status == _JUNIT_PASS and attr_status in _CTRF_STATUS_MAP:
        mapped = _CTRF_STATUS_MAP[attr_status]
        if mapped != _JUNIT_PASS:
            status = mapped
            raw_status = attr_status

    # Failed/blocked tests benefit from system-out/err being attached too —
    # they're typically the only place a CI run preserves the actual stdout.
    if status != _JUNIT_PASS:
        if system_err:
            output_parts.append(f"[stderr]\n{system_err}")
        if system_out:
            output_parts.append(f"[stdout]\n{system_out}")

    explicit_case_id = _extract_junit_property_case_id(case_elem)

    return ParsedResult(
        name=name,
        classname=classname,
        status=status,
        duration_seconds=duration,
        message=message,
        output="\n\n".join(output_parts) if output_parts else None,
        explicit_case_id=explicit_case_id,
        raw_status=raw_status,
    )


def _extract_junit_property_case_id(case_elem) -> Optional[int]:
    properties = next(
        (child for child in case_elem if _strip_ns(child.tag) == "properties"),
        None,
    )
    if properties is None:
        return None
    for prop in properties:
        if _strip_ns(prop.tag) != "property":
            continue
        key = (prop.get("name") or "").strip().lower()
        if key in _PROPERTY_KEYS:
            value = (prop.get("value") or "").strip()
            extracted = _coerce_case_id(value)
            if extracted is not None:
                return extracted
    return None


def _parse_ctrf(content: bytes) -> List[ParsedResult]:
    try:
        document = json.loads(content)
    except json.JSONDecodeError as exc:
        raise CIIngestError(f"Invalid CTRF JSON: {exc}") from exc

    # CTRF places tests at results.tests. Allow a flat array as a convenience.
    tests: Iterable[dict]
    if isinstance(document, dict):
        results_node = document.get("results")
        if isinstance(results_node, dict):
            tests = results_node.get("tests") or []
        else:
            tests = document.get("tests") or []
    elif isinstance(document, list):
        tests = document
    else:
        raise CIIngestError("CTRF payload must be an object or array of tests.")

    parsed: List[ParsedResult] = []
    for entry in tests:
        if not isinstance(entry, dict):
            continue
        raw_status = str(entry.get("status") or "").strip().lower() or "other"
        status = _CTRF_STATUS_MAP.get(raw_status)
        if status is None:
            # Truly unknown statuses (not even ``other``): treat as blocked
            # rather than fail so we don't manufacture false defects.
            status = _JUNIT_BLOCK

        duration_ms = entry.get("duration")
        duration_seconds: Optional[float] = None
        if isinstance(duration_ms, (int, float)) and duration_ms >= 0:
            duration_seconds = float(duration_ms) / 1000.0

        extra = entry.get("extra") if isinstance(entry.get("extra"), dict) else {}
        explicit_case_id = _coerce_case_id(
            extra.get("tcId")
            or extra.get("tc_id")
            or extra.get("test_case_id")
            or extra.get("caseId")
            or entry.get("tcId")
        )

        # CTRF ``start`` is an epoch-millisecond timestamp. Convert it so the
        # imported result reflects when the test actually ran in CI.
        started_at: Optional[datetime] = None
        start_value = entry.get("start")
        if isinstance(start_value, (int, float)) and start_value > 0:
            try:
                started_at = datetime.fromtimestamp(start_value / 1000.0, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                started_at = None

        parsed.append(ParsedResult(
            name=str(entry.get("name") or "<unnamed>").strip(),
            classname=str(entry.get("suite") or entry.get("classname") or "").strip() or None,
            status=status,
            duration_seconds=duration_seconds,
            message=(entry.get("message") or None),
            output=(entry.get("trace") or entry.get("stdout") or None),
            explicit_case_id=explicit_case_id,
            raw_status=raw_status,
            started_at=started_at,
        ))
    return parsed


def _coerce_case_id(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    text = str(value).strip()
    if not text:
        return None
    match = _TC_TOKEN_RE.search(text)
    if match:
        try:
            extracted = int(match.group(1))
        except ValueError:
            return None
        return extracted if extracted > 0 else None
    if text.isdigit():
        try:
            extracted = int(text)
        except ValueError:
            return None
        return extracted if extracted > 0 else None
    return None


def _strip_ns(tag: str) -> str:
    """Strip an XML namespace from a tag, e.g. ``{http://x}testcase`` -> ``testcase``."""
    return tag.split("}", 1)[-1]


def apply_results(
    db: Session,
    test_run: models.TestRun,
    parsed: List[ParsedResult],
    fmt: str,
    executor_id: Optional[int],
    auto_create: bool = False,
) -> IngestSummary:
    """Persist matched results to the run and return a summary.

    Matching is constrained to the run's project. ``auto_create=True`` will
    attach test cases not yet in the run; otherwise unmatched-but-in-project
    cases are reported but not written.
    """

    summary = IngestSummary(format=fmt, total=len(parsed))

    # Load the universe of test cases scoped to this project once. The N+1
    # cost would otherwise dominate for large reports.
    case_index = _build_case_index(db, test_run.project_id)

    # Pre-load existing results for this run so we can update in place.
    existing_results = {
        result.test_case_id: result
        for result in db.query(models.TestResult)
        .filter(models.TestResult.test_run_id == test_run.id)
        .all()
    }
    existing_case_ids = set(existing_results)

    now = datetime.now(timezone.utc)

    # First pass: resolve each parsed record to a case id (if any) and bucket
    # records by case so multiple CI rows hitting the same case (parameterized
    # tests, retries) are aggregated to a single TestResult write.
    resolved: List[Tuple[MatchOutcome, Optional[int]]] = []
    aggregated_by_case: dict[int, ParsedResult] = {}
    aggregate_counts: dict[int, int] = {}
    for record in parsed:
        outcome = MatchOutcome(parsed=record)
        case_id, ambiguity_reason = _resolve_case_id(record, case_index, existing_case_ids)
        if case_id is None:
            outcome.action = "unmatched"
            outcome.reason = ambiguity_reason or "no matching test case in this project"
            resolved.append((outcome, None))
            continue

        test_case = case_index["by_id"].get(case_id)
        if not test_case:
            outcome.action = "unmatched"
            outcome.reason = "matched case is not in this project"
            resolved.append((outcome, None))
            continue

        outcome.test_case_id = case_id
        outcome.test_case_title = test_case.title

        # Aggregate: keep the worst-status record per case_id so a single
        # failing parameterization marks the case as failed.
        prior = aggregated_by_case.get(case_id)
        if prior is None or _STATUS_PRIORITY.get(record.status, 0) > _STATUS_PRIORITY.get(prior.status, 0):
            aggregated_by_case[case_id] = record
        aggregate_counts[case_id] = aggregate_counts.get(case_id, 0) + 1
        resolved.append((outcome, case_id))

    # Second pass: write the aggregated record per case (or skip / unmatched).
    written_for_case: dict[int, str] = {}  # case_id -> action ("created"/"updated")
    written_result_ids: dict[int, int] = {}

    for outcome, case_id in resolved:
        if case_id is None:
            summary.results.append(outcome)
            summary.unmatched += 1
            continue

        existing = existing_results.get(case_id)
        if existing is None and not auto_create:
            outcome.action = "skipped"
            outcome.reason = "case is not part of this run (enable auto_create to attach)"
            summary.results.append(outcome)
            summary.skipped += 1
            continue

        # Only the first outcome per case_id actually writes; subsequent
        # records reuse the same id/action with an "aggregated" note so the
        # caller knows multiple rows collapsed.
        if case_id in written_for_case:
            outcome.action = written_for_case[case_id]
            outcome.test_result_id = written_result_ids.get(case_id)
            outcome.reason = (
                f"aggregated into single result (worst status wins; "
                f"{aggregate_counts.get(case_id, 1)} records for this case)"
            )
            summary.results.append(outcome)
            # Don't double-count matched/created/updated.
            continue

        winning = aggregated_by_case[case_id]
        # The canonical row for this case_id should reflect what was actually
        # written to the DB, not the first CI record we happened to see.
        if outcome.parsed is not winning:
            outcome = MatchOutcome(
                parsed=winning,
                test_case_id=case_id,
                test_case_title=outcome.test_case_title,
            )
        if existing is None:
            db_result = models.TestResult(
                test_run_id=test_run.id,
                test_case_id=case_id,
                executed_by=executor_id,
                status=winning.status,
                actual_result=_build_actual_result(winning),
                comments=_build_comments(winning),
                execution_time=winning.duration_seconds,
                execution_started_at=winning.started_at or now,
                executed_at=now,
                execution_state="completed",
            )
            db.add(db_result)
            db.flush()
            outcome.test_result_id = db_result.id
            outcome.action = "created"
            summary.matched += 1
            summary.created += 1
            existing_results[case_id] = db_result
            written_for_case[case_id] = "created"
            written_result_ids[case_id] = db_result.id
        else:
            existing.status = winning.status
            existing.actual_result = _build_actual_result(winning)
            existing.comments = _build_comments(winning)
            existing.execution_time = winning.duration_seconds
            if winning.started_at is not None:
                existing.execution_started_at = winning.started_at
            existing.executed_at = now
            existing.execution_state = "completed"
            if executor_id is not None:
                existing.executed_by = executor_id
            # CI ingest clears any pending retest flag — same semantics as a
            # re-run from the UI.
            existing.retest_needed = False
            outcome.test_result_id = existing.id
            outcome.action = "updated"
            summary.matched += 1
            summary.updated += 1
            written_for_case[case_id] = "updated"
            written_result_ids[case_id] = existing.id

        if aggregate_counts.get(case_id, 1) > 1:
            outcome.reason = (
                f"aggregated from {aggregate_counts[case_id]} CI records "
                "(worst status wins)"
            )

        summary.results.append(outcome)

    return summary


def _build_actual_result(record: ParsedResult) -> Optional[str]:
    if record.status == _JUNIT_PASS:
        return None
    parts: List[str] = []
    if record.message:
        parts.append(record.message)
    if record.output:
        parts.append(record.output)
    if not parts:
        return None
    body = "\n\n".join(parts)
    if len(body) > _MAX_ACTUAL_RESULT_CHARS:
        # Keep the head so the most relevant error (usually the assertion
        # message + the top of the traceback) survives; trim the tail.
        body = body[:_MAX_ACTUAL_RESULT_CHARS] + "\n\n…[truncated by CI ingest]"
    return body


def _build_comments(record: ParsedResult) -> str:
    prefix = "Imported from CI"
    if record.raw_status and record.raw_status not in ("passed", "pass"):
        return f"{prefix} ({record.raw_status})"
    return prefix


def _build_case_index(db: Session, project_id: int) -> dict:
    """Pre-index test cases for the project by id, title, and reference.

    When two cases share a title or reference token we record the key as
    ambiguous instead of letting first-write win — the matcher then refuses
    to pick one silently and surfaces the conflict to the caller.
    """
    cases = (
        db.query(models.TestCase)
        .join(models.TestSuite, models.TestSuite.id == models.TestCase.test_suite_id)
        .filter(models.TestSuite.project_id == project_id)
        .filter(models.TestCase.is_deleted == False)  # noqa: E712
        .options(joinedload(models.TestCase.test_suite))
        .all()
    )
    by_id: dict[int, models.TestCase] = {}
    by_title: dict[str, models.TestCase] = {}
    by_reference: dict[str, models.TestCase] = {}
    ambiguous_titles: set[str] = set()
    ambiguous_references: set[str] = set()
    for case in cases:
        by_id[case.id] = case
        if case.title:
            key = case.title.strip().lower()
            if key:
                if key in by_title and by_title[key].id != case.id:
                    ambiguous_titles.add(key)
                by_title.setdefault(key, case)
        if case.reference:
            for token in _TOKEN_SPLIT_RE.split(case.reference):
                token = token.strip().lower()
                if not token:
                    continue
                if token in by_reference and by_reference[token].id != case.id:
                    ambiguous_references.add(token)
                by_reference.setdefault(token, case)
    return {
        "by_id": by_id,
        "by_title": by_title,
        "by_reference": by_reference,
        "ambiguous_titles": ambiguous_titles,
        "ambiguous_references": ambiguous_references,
    }


def _resolve_case_id(
    record: ParsedResult,
    case_index: dict,
    existing_case_ids: set,
) -> Tuple[Optional[int], Optional[str]]:
    """Return ``(case_id, reason)``. ``case_id`` is ``None`` on no/ambiguous match."""

    # 1. Explicit case id from properties / extras.
    if record.explicit_case_id and record.explicit_case_id in case_index["by_id"]:
        return record.explicit_case_id, None

    candidates: List[Tuple[int, int]] = []  # (case_id, score)
    ambiguous_hit: Optional[str] = None

    # 2. [TC-{id}] token in name or classname. This is unambiguous by
    # construction — the id either resolves to a single case or it doesn't.
    for haystack in (record.name, record.classname or ""):
        token_match = _TC_TOKEN_RE.search(haystack)
        if token_match:
            try:
                candidate = int(token_match.group(1))
            except ValueError:
                candidate = None
            if candidate and candidate in case_index["by_id"]:
                score = 3 if candidate in existing_case_ids else 2
                candidates.append((candidate, score))

    # 3. Reference field match.
    for haystack in (record.name, record.classname or ""):
        for token in _TOKEN_SPLIT_RE.split(haystack):
            token = token.strip().lower()
            if not token:
                continue
            if token in case_index["ambiguous_references"]:
                ambiguous_hit = ambiguous_hit or f"reference '{token}' matches multiple cases"
                continue
            case = case_index["by_reference"].get(token)
            if case:
                score = 3 if case.id in existing_case_ids else 1
                candidates.append((case.id, score))

    # 4. Title exact match.
    for haystack in (record.name, record.full_name):
        key = (haystack or "").strip().lower()
        if not key:
            continue
        if key in case_index["ambiguous_titles"]:
            ambiguous_hit = ambiguous_hit or f"title '{key}' matches multiple cases"
            continue
        case = case_index["by_title"].get(key)
        if case:
            score = 3 if case.id in existing_case_ids else 1
            candidates.append((case.id, score))

    if not candidates:
        return None, ambiguous_hit
    # Highest score wins; ties broken by first occurrence (stable).
    candidates.sort(key=lambda pair: pair[1], reverse=True)
    top_score = candidates[0][1]
    top_ids = {cid for cid, score in candidates if score == top_score}
    if len(top_ids) > 1:
        return None, "multiple test cases matched with equal confidence"
    return candidates[0][0], None
