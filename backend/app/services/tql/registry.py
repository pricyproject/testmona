"""Per-entity field registries — the allowlist that makes TQL safe.

A :class:`FieldSpec` maps a user-facing field name to (a) the SQLAlchemy column
it targets, (b) the operators allowed on it, and (c) a coercer that turns a TQL
value literal into a real Python value. Only registered fields are queryable, so
a query can never reach an unintended column, and every value is validated and
coerced (centralizing, among other things, the enum name/value normalization the
codebase used to scatter as ``.upper()`` calls).

Each registry is a ``{field_name: FieldSpec}`` dict. The ``kind``/``choices``
metadata on a spec is not used for querying — it drives the Advanced Search UI's
field catalog (so the front-end can show available fields and enum choices).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, FrozenSet, Tuple

from sqlalchemy.orm.attributes import InstrumentedAttribute

from . import nodes
from .context import EvalContext
from .errors import TQLError


# Operator groups, reused across field definitions.
_SCALAR = frozenset({"eq", "ne"})
_ORDERED = frozenset({"eq", "ne", "gt", "lt", "gte", "lte"})
_TEXT = frozenset({"eq", "ne", "contains", "ncontains"})


@dataclass(frozen=True)
class FieldSpec:
    column: InstrumentedAttribute
    ops: FrozenSet[str]
    coerce: Callable[[nodes.Value, EvalContext], object]
    sortable: bool = True
    kind: str = "text"          # text | enum | keyword | user | date | number — UI hint only
    choices: Tuple[str, ...] = ()   # allowed values for enum/keyword fields — UI hint only
    suggest: bool = False       # offer live value autocomplete from existing data
    multivalue: bool = False    # column holds comma-delimited values (e.g. tags)


# --- coercer factories ------------------------------------------------------

def _literal_str(value: nodes.Value) -> str:
    if isinstance(value, nodes.StringVal):
        return value.value
    if isinstance(value, nodes.BarewordVal):
        return value.value
    if isinstance(value, nodes.NumberVal):
        # Render integers without a trailing ".0" so "id ~ 12" behaves.
        # float() guards against a directly-built AST passing an int (int has no
        # .is_integer() before Python 3.12).
        return str(int(value.value)) if float(value.value).is_integer() else str(value.value)
    raise TQLError("Expected a text value here.")


def text_coercer(value: nodes.Value, _ctx: EvalContext) -> str:
    return _literal_str(value)


def int_coercer(value: nodes.Value, _ctx: EvalContext) -> int:
    if isinstance(value, nodes.NumberVal) and float(value.value).is_integer():
        return int(value.value)
    if isinstance(value, (nodes.StringVal, nodes.BarewordVal)):
        try:
            return int(value.value)
        except ValueError:
            pass
    raise TQLError("Expected a whole number here.")


def enum_coercer(enum_cls):
    """Coerce a token to an enum member, matched by name or value (case-insensitive).

    Returns the enum member; SQLAlchemy stores enums by *name*, so comparing the
    member directly is correct on both SQLite and Postgres (no ``.upper()`` hack).
    """
    by_name = {member.name.lower(): member for member in enum_cls}
    by_value = {str(member.value).lower(): member for member in enum_cls}

    def coerce(value: nodes.Value, _ctx: EvalContext):
        token = _literal_str(value).lower()
        member = by_name.get(token) or by_value.get(token)
        if member is None:
            allowed = ", ".join(sorted(m.value for m in enum_cls))
            raise TQLError(f"'{_literal_str(value)}' is not valid here; expected one of: {allowed}.")
        return member

    return coerce


def keyword_coercer(choices):
    """Coerce against a fixed set of lowercase string choices.

    For columns that hold an enum-like value as a plain ``String`` (e.g.
    TestCase.status / .priority / .test_type), so the stored value is the
    lowercase token itself rather than an enum member name.
    """
    allowed = {c.lower() for c in choices}

    def coerce(value: nodes.Value, _ctx: EvalContext) -> str:
        token = _literal_str(value).lower()
        if token not in allowed:
            raise TQLError(
                f"'{_literal_str(value)}' is not valid here; expected one of: "
                f"{', '.join(sorted(allowed))}."
            )
        return token

    return coerce


def user_coercer(value: nodes.Value, ctx: EvalContext) -> int:
    """Coerce a user reference: a numeric id or the ``currentUser()`` function."""
    if isinstance(value, nodes.FuncVal):
        if value.name.lower() != "currentuser":
            raise TQLError(f"Unknown function '{value.name}()'.")
        if ctx.current_user_id is None:
            raise TQLError("currentUser() is not available in this context.")
        return ctx.current_user_id
    return int_coercer(value, ctx)


def date_coercer(value: nodes.Value, ctx: EvalContext) -> datetime:
    """Coerce a date value: ISO string, relative offset (-7d), or now()."""
    if isinstance(value, nodes.FuncVal):
        if value.name.lower() != "now":
            raise TQLError(f"Unknown function '{value.name}()'.")
        return ctx.now
    if isinstance(value, nodes.RelDateVal):
        unit = {"d": "days", "w": "weeks", "h": "hours", "m": "minutes"}[value.unit]
        return ctx.now + timedelta(**{unit: value.amount})
    if isinstance(value, (nodes.StringVal, nodes.BarewordVal)):
        text = value.value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise TQLError(f"'{value.value}' is not a valid date (use ISO format or -7d).") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    raise TQLError("Expected a date here (ISO string, -7d, or now()).")


# --- field-builder helpers (keep registry definitions terse + consistent) ---

def enum_field(column, enum_cls) -> FieldSpec:
    return FieldSpec(column, _SCALAR, enum_coercer(enum_cls), kind="enum",
                     choices=tuple(m.value for m in enum_cls))


def keyword_field(column, choices) -> FieldSpec:
    return FieldSpec(column, _SCALAR, keyword_coercer(choices), kind="keyword",
                     choices=tuple(choices))


def text_field(column, suggest: bool = False) -> FieldSpec:
    return FieldSpec(column, _TEXT, text_coercer, kind="text", suggest=suggest)


def tag_field(column) -> FieldSpec:
    """A text column holding comma-delimited values, with live suggestions."""
    return FieldSpec(column, _TEXT, text_coercer, kind="text", suggest=True, multivalue=True)


def user_field(column) -> FieldSpec:
    return FieldSpec(column, _SCALAR, user_coercer, kind="user")


def date_field(column) -> FieldSpec:
    return FieldSpec(column, _ORDERED, date_coercer, kind="date")


def int_field(column) -> FieldSpec:
    return FieldSpec(column, _ORDERED, int_coercer, kind="number")


# --- registry builders ------------------------------------------------------

def _build_defect_registry() -> Dict[str, FieldSpec]:
    from ...models import Defect, DefectStatus, DefectSeverity, DefectPriority

    return {
        # Project-first: `id` is the per-project number (matches the DEF- key/URL),
        # not the hidden global primary key.
        "id": int_field(Defect.project_seq),
        "status": enum_field(Defect.status, DefectStatus),
        "severity": enum_field(Defect.severity, DefectSeverity),
        "priority": enum_field(Defect.priority, DefectPriority),
        "assignee": user_field(Defect.assigned_to),
        "reporter": user_field(Defect.reported_by),
        "summary": text_field(Defect.title),
        "title": text_field(Defect.title),
        "description": text_field(Defect.description),
        "tags": tag_field(Defect.tags),
        "environment": text_field(Defect.environment, suggest=True),
        "resolution": text_field(Defect.resolution),
        "key": text_field(Defect.defect_id, suggest=True),
        "fix_version": text_field(Defect.fix_version, suggest=True),
        "found_in_version": text_field(Defect.found_in_version, suggest=True),
        "created": date_field(Defect.created_at),
        "updated": date_field(Defect.updated_at),
    }


def _build_requirement_registry() -> Dict[str, FieldSpec]:
    from ...models import Requirement, RequirementStatus, Priority

    return {
        # Project-first: `id` is the per-project number (matches REQ- key/URL),
        # not the hidden global primary key.
        "id": int_field(Requirement.project_seq),
        "status": enum_field(Requirement.status, RequirementStatus),
        "priority": enum_field(Requirement.priority, Priority),
        "assignee": user_field(Requirement.assigned_to),
        "creator": user_field(Requirement.created_by),
        "summary": text_field(Requirement.title),
        "title": text_field(Requirement.title),
        "description": text_field(Requirement.description),
        "acceptance_criteria": text_field(Requirement.acceptance_criteria),
        "tags": tag_field(Requirement.tags),
        "key": text_field(Requirement.requirement_id, suggest=True),
        "created": date_field(Requirement.created_at),
        "updated": date_field(Requirement.updated_at),
    }


def _build_testplan_registry() -> Dict[str, FieldSpec]:
    from ...models import TestPlan, TestStatus

    return {
        "id": int_field(TestPlan.project_seq),
        "status": enum_field(TestPlan.status, TestStatus),
        "creator": user_field(TestPlan.created_by),
        "summary": text_field(TestPlan.title),
        "title": text_field(TestPlan.title),
        "description": text_field(TestPlan.description),
        "created": date_field(TestPlan.created_at),
        "updated": date_field(TestPlan.updated_at),
    }


def _build_testexecution_registry() -> Dict[str, FieldSpec]:
    # Real executions are recorded as TestResult rows (TestExecution is a legacy
    # table that the execution flow no longer writes to). status is a free-form
    # String that has held both short and full-word spellings (pass/passed,
    # skip/skipped). We normalize *both* sides — the stored column via a CASE and
    # the typed value via canonical_result_status — so `status = "skipped"`
    # matches a row stored as "skip" (and vice versa). Canonical tokens are also
    # the offered choices. title/summary map to the executed test case's title
    # (the entity's scope joins TestCase), so the title shown is queryable.
    from sqlalchemy import case, func
    from ...models import ResultStatus, TestCase, TestResult, canonical_result_status

    _s = func.lower(func.trim(TestResult.status))
    status_normalized = case(
        (_s == "passed", "pass"),
        (_s == "failed", "fail"),
        (_s == "skipped", "skip"),
        (_s == "blocked", "block"),
        else_=_s,
    )

    def result_status_coercer(value: nodes.Value, _ctx: EvalContext) -> str:
        return canonical_result_status(_literal_str(value))

    # The canonical ResultStatus tokens (pass/fail/skip/block/not_started).
    status_choices = tuple(m.value for m in ResultStatus)

    return {
        "id": int_field(TestResult.id),
        "status": FieldSpec(
            status_normalized, _TEXT, result_status_coercer, kind="keyword",
            choices=status_choices, suggest=True,
        ),
        "executor": user_field(TestResult.executed_by),
        "summary": text_field(TestCase.title),
        "title": text_field(TestCase.title),
        "executed": date_field(TestResult.executed_at),
        "created": date_field(TestResult.created_at),
        "updated": date_field(TestResult.updated_at),
    }


def _build_doc_registry() -> Dict[str, FieldSpec]:
    from ...models import Doc, DocStatus

    return {
        "id": int_field(Doc.project_seq),
        "status": enum_field(Doc.status, DocStatus),
        "creator": user_field(Doc.created_by),
        "summary": text_field(Doc.title),
        "title": text_field(Doc.title),
        "tags": tag_field(Doc.tags),
        "classification": text_field(Doc.classification, suggest=True),
        "language": text_field(Doc.language, suggest=True),
        "slug": text_field(Doc.slug, suggest=True),
        "created": date_field(Doc.created_at),
        "updated": date_field(Doc.updated_at),
    }


def _build_testcase_registry() -> Dict[str, FieldSpec]:
    from ...models import TestCase

    # status / priority / test_type are plain String columns holding lowercase
    # tokens, so they use keyword fields rather than enum fields.
    return {
        "id": int_field(TestCase.project_seq),
        "status": keyword_field(TestCase.status, ("active", "inactive", "archived", "draft")),
        "priority": keyword_field(TestCase.priority, ("low", "medium", "high", "critical")),
        "type": keyword_field(TestCase.test_type, ("manual", "automated", "exploratory")),
        "creator": user_field(TestCase.created_by),
        "summary": text_field(TestCase.title),
        "title": text_field(TestCase.title),
        "description": text_field(TestCase.description),
        "tags": tag_field(TestCase.tags_cache),  # normalized tags; search the denormalized cache
        "reference": text_field(TestCase.reference, suggest=True),
        "created": date_field(TestCase.created_at),
        "updated": date_field(TestCase.updated_at),
    }


# --- lazy registry container ------------------------------------------------

class _LazyRegistry(dict):
    """A registry that builds itself on first access.

    Field specs reference ORM columns, so we must not touch ``models`` at import
    time (it would create an import cycle with the routes that import us).
    """

    def __init__(self, builder):
        super().__init__()
        self._builder = builder
        self._built = False

    def _ensure(self):
        if not self._built:
            self.update(self._builder())
            self._built = True

    def __getitem__(self, key):
        self._ensure()
        return super().__getitem__(key)

    def __contains__(self, key):
        self._ensure()
        return super().__contains__(key)

    def __iter__(self):
        self._ensure()
        return super().__iter__()

    def __len__(self):
        self._ensure()
        return super().__len__()

    def get(self, key, default=None):
        self._ensure()
        return super().get(key, default)

    def keys(self):
        self._ensure()
        return super().keys()

    def items(self):
        self._ensure()
        return super().items()

    def values(self):
        self._ensure()
        return super().values()


DEFECT_REGISTRY: Dict[str, FieldSpec] = _LazyRegistry(_build_defect_registry)
REQUIREMENT_REGISTRY: Dict[str, FieldSpec] = _LazyRegistry(_build_requirement_registry)
TESTCASE_REGISTRY: Dict[str, FieldSpec] = _LazyRegistry(_build_testcase_registry)
TESTPLAN_REGISTRY: Dict[str, FieldSpec] = _LazyRegistry(_build_testplan_registry)
TESTEXECUTION_REGISTRY: Dict[str, FieldSpec] = _LazyRegistry(_build_testexecution_registry)
DOC_REGISTRY: Dict[str, FieldSpec] = _LazyRegistry(_build_doc_registry)
