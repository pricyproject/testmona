"""Entity dispatch for Advanced Search.

Maps a searchable entity key (``defects``, ``requirements``, ``test_cases``) to
everything the generic search endpoint needs: its TQL field registry, how to
scope a query to a project, default ordering, and a compact serializer for the
results grid. Adding a new searchable entity means adding one :class:`EntitySpec`
here plus its registry in :mod:`.registry` — no route changes.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from sqlalchemy.orm import Query, Session, contains_eager

from .compiler import compile_tql
from .context import EvalContext
from .errors import TQLError
from .registry import (
    DEFECT_REGISTRY,
    DOC_REGISTRY,
    REQUIREMENT_REGISTRY,
    TESTCASE_REGISTRY,
    TESTEXECUTION_REGISTRY,
    TESTPLAN_REGISTRY,
    FieldSpec,
)


@dataclass(frozen=True)
class EntitySpec:
    key: str
    label: str
    registry: Dict[str, FieldSpec]
    model: type
    scope: Callable[[Query, int], Query]          # project scoping + base filters
    default_order: Callable[[], list]             # default ordering clauses
    serialize: Callable[[object], dict]           # ORM row -> compact result dict
    options: Callable[[], tuple] = tuple          # eager-load options (avoid N+1)


def _evalue(value):
    """Render enum members by value; pass other scalars through."""
    return value.value if isinstance(value, enum.Enum) else value


# --- per-entity wiring (built lazily; see _build_entities) ------------------

def _build_entities() -> Dict[str, EntitySpec]:
    from ...models import (
        Defect,
        Doc,
        Requirement,
        TestCase,
        TestPlan,
        TestResult,
        TestRun,
        TestSuite,
    )

    def defect_scope(q: Query, project_id: int) -> Query:
        return q.filter(Defect.project_id == project_id)

    def defect_row(d: Defect) -> dict:
        return {
            "id": d.id,
            "key": d.defect_id,
            "title": d.title,
            "status": _evalue(d.status),
            "severity": _evalue(d.severity),
            "priority": _evalue(d.priority),
            "assignee_id": d.assigned_to,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }

    def requirement_scope(q: Query, project_id: int) -> Query:
        return q.filter(Requirement.project_id == project_id)

    def requirement_row(r: Requirement) -> dict:
        return {
            "id": r.id,
            "key": r.requirement_id,
            "title": r.title,
            "status": _evalue(r.status),
            "priority": _evalue(r.priority),
            "assignee_id": r.assigned_to,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }

    def testcase_scope(q: Query, project_id: int) -> Query:
        # TestCase has no project_id column — it's reached through its suite.
        return (
            q.join(TestSuite, TestCase.test_suite_id == TestSuite.id)
            .filter(TestSuite.project_id == project_id, TestCase.is_deleted.is_(False))
        )

    def testcase_row(tc: TestCase) -> dict:
        return {
            "id": tc.id,
            "key": f"TC-{tc.id}",
            "title": tc.title,
            "status": tc.status,
            "priority": tc.priority,
            "type": tc.test_type,
            "test_suite_id": tc.test_suite_id,
            "created_at": tc.created_at.isoformat() if tc.created_at else None,
            "updated_at": tc.updated_at.isoformat() if tc.updated_at else None,
        }

    def testplan_scope(q: Query, project_id: int) -> Query:
        return q.filter(TestPlan.project_id == project_id)

    def testplan_row(tp: TestPlan) -> dict:
        return {
            "id": tp.id,
            "key": f"TP-{tp.id}",
            "title": tp.title,
            "status": _evalue(tp.status),
            "created_at": tp.created_at.isoformat() if tp.created_at else None,
            "updated_at": tp.updated_at.isoformat() if tp.updated_at else None,
        }

    def execution_scope(q: Query, project_id: int) -> Query:
        # Executions are TestResult rows, reaching a project through their run.
        # Join the test case too so its title is both queryable and eager-loaded.
        return (
            q.join(TestRun, TestResult.test_run_id == TestRun.id)
            .join(TestCase, TestResult.test_case_id == TestCase.id)
            .filter(TestRun.project_id == project_id)
        )

    def execution_row(r: TestResult) -> dict:
        when = r.executed_at or r.created_at
        return {
            "id": r.id,
            "key": f"EX-{r.id}",
            "title": r.test_case.title if r.test_case else f"Execution #{r.id}",
            "status": r.status,
            "executor_id": r.executed_by,
            "test_run_id": r.test_run_id,
            "created_at": when.isoformat() if when else None,
        }

    def doc_scope(q: Query, project_id: int) -> Query:
        return q.filter(Doc.project_id == project_id)

    def doc_row(d: Doc) -> dict:
        return {
            "id": d.id,
            "key": f"DOC-{d.id}",
            "title": d.title,
            "status": _evalue(d.status),
            "tags": d.tags,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }

    return {
        "defects": EntitySpec(
            key="defects", label="Defects", registry=DEFECT_REGISTRY, model=Defect,
            scope=defect_scope, default_order=lambda: [Defect.created_at.desc()],
            serialize=defect_row,
        ),
        "requirements": EntitySpec(
            key="requirements", label="Requirements", registry=REQUIREMENT_REGISTRY,
            model=Requirement, scope=requirement_scope,
            default_order=lambda: [Requirement.created_at.desc()], serialize=requirement_row,
        ),
        "test_cases": EntitySpec(
            key="test_cases", label="Test Cases", registry=TESTCASE_REGISTRY,
            model=TestCase, scope=testcase_scope,
            default_order=lambda: [TestCase.created_at.desc()], serialize=testcase_row,
        ),
        "test_plans": EntitySpec(
            key="test_plans", label="Test Plans", registry=TESTPLAN_REGISTRY,
            model=TestPlan, scope=testplan_scope,
            default_order=lambda: [TestPlan.created_at.desc()], serialize=testplan_row,
        ),
        "test_executions": EntitySpec(
            key="test_executions", label="Test Executions", registry=TESTEXECUTION_REGISTRY,
            model=TestResult, scope=execution_scope,
            default_order=lambda: [TestResult.executed_at.desc()], serialize=execution_row,
            # test_case is already joined by execution_scope; populate it from
            # those columns (no extra query) so the serializer's title read is free.
            options=lambda: (contains_eager(TestResult.test_case),),
        ),
        "docs": EntitySpec(
            key="docs", label="Docs", registry=DOC_REGISTRY, model=Doc,
            scope=doc_scope, default_order=lambda: [Doc.created_at.desc()], serialize=doc_row,
        ),
    }


_entities: Optional[Dict[str, EntitySpec]] = None


def _all() -> Dict[str, EntitySpec]:
    global _entities
    if _entities is None:
        _entities = _build_entities()
    return _entities


def get_entity(key: str) -> EntitySpec:
    spec = _all().get(key)
    if spec is None:
        available = ", ".join(sorted(_all().keys()))
        raise TQLError(f"Unknown entity '{key}'. Available entities: {available}.")
    return spec


def field_catalog(registry: Dict[str, FieldSpec]) -> List[dict]:
    """Field metadata for the Advanced Search UI (names, ops, enum choices)."""
    catalog = []
    for name in sorted(registry.keys()):
        spec = registry[name]
        catalog.append({
            "name": name,
            "kind": spec.kind,
            "operators": sorted(spec.ops),
            "sortable": spec.sortable,
            "choices": list(spec.choices),
            "suggest": spec.suggest,
            "multivalue": spec.multivalue,
        })
    return catalog


def value_suggestions(
    db: Session,
    entity_key: str,
    field_name: str,
    project_id: int,
    q: str = "",
    limit: int = 15,
) -> List[str]:
    """Distinct existing values of a field within a project, for value autocomplete.

    Only fields flagged ``suggest`` participate; everything else returns ``[]``.
    For ``multivalue`` fields (comma-delimited, e.g. tags) the stored strings are
    split into individual tokens. Raises :class:`TQLError` for an unknown entity.
    """
    spec = get_entity(entity_key)
    field = spec.registry.get(field_name)
    if field is None or not field.suggest:
        return []

    column = field.column
    base = spec.scope(db.query(column), project_id).filter(column.isnot(None))
    needle = (q or "").strip()
    needle_lc = needle.lower()

    if field.multivalue:
        # Scan a bounded slice of rows and split each on commas.
        seen: Dict[str, str] = {}
        for (raw,) in base.limit(2000):
            for token in str(raw).split(","):
                token = token.strip()
                if token and (not needle_lc or needle_lc in token.lower()):
                    seen.setdefault(token.lower(), token)
            if len(seen) >= limit:
                break
        return sorted(seen.values())[:limit]

    if needle:
        escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        base = base.filter(column.ilike(f"%{escaped}%", escape="\\"))
    values = {str(v) for (v,) in base.distinct().limit(limit) if v is not None and str(v).strip()}
    return sorted(values)


def entity_catalog() -> List[dict]:
    """All entities + their field catalogs, for populating the search UI."""
    return [
        {"key": spec.key, "label": spec.label, "fields": field_catalog(spec.registry)}
        for spec in _all().values()
    ]


def _scoped_query(db: Session, spec: EntitySpec, project_id: int, tql: Optional[str], context: EvalContext):
    """Build the project-scoped, TQL-filtered, ordered query for an entity.

    Returns the ready-to-paginate Query. Shared by paginated search and export
    so both apply identical scoping and filtering.
    """
    query = spec.scope(db.query(spec.model), project_id)
    options = spec.options()
    if options:
        query = query.options(*options)
    order_by = spec.default_order()

    if tql and tql.strip():
        compiled = compile_tql(tql, spec.registry, context)
        if compiled.where is not None:
            query = query.filter(compiled.where)
        if compiled.order_by:
            order_by = compiled.order_by

    return query.order_by(*order_by)


def execute_search(
    db: Session,
    entity_key: str,
    project_id: int,
    tql: Optional[str],
    context: EvalContext,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Run a paginated TQL search for one entity within one project.

    Returns ``{entity, label, total, count, offset, limit, results}`` where
    ``total`` is the full match count and ``count`` is this page's size. Raises
    :class:`TQLError` for any unknown entity or query problem (HTTP 400).
    """
    spec = get_entity(entity_key)
    query = _scoped_query(db, spec, project_id, tql, context)

    # Count the full result set (ordering is irrelevant and slows the count).
    total = query.order_by(None).count()
    rows = query.offset(offset).limit(limit).all()
    return {
        "entity": spec.key,
        "label": spec.label,
        "total": total,
        "count": len(rows),
        "offset": offset,
        "limit": limit,
        "results": [spec.serialize(row) for row in rows],
    }


def export_search(
    db: Session,
    entity_key: str,
    project_id: int,
    tql: Optional[str],
    context: EvalContext,
    cap: int = 5000,
) -> tuple:
    """Materialize all matching rows (capped) for CSV export.

    Returns ``(entity_key, [serialized_row, ...])``. Raises :class:`TQLError`
    for any unknown entity or query problem.
    """
    spec = get_entity(entity_key)
    query = _scoped_query(db, spec, project_id, tql, context)
    rows = query.limit(cap).all()
    return spec.key, [spec.serialize(row) for row in rows]
