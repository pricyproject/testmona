"""TQL compiler: :class:`~.nodes.Query` AST -> SQLAlchemy clauses.

Walks the AST against a field registry and produces a ``where`` clause plus an
``order_by`` list. Every value is run through its field's coercer and lands in
the query as a bound parameter — never string-interpolated — so a TQL string
cannot inject SQL or reach an unregistered column.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy import and_, func, literal, not_, or_
from sqlalchemy.sql.elements import ColumnElement

from . import nodes
from .context import EvalContext
from .errors import TQLError
from .parser import parse
from .registry import FieldSpec

__all__ = ["CompiledTQL", "EvalContext", "compile_tql"]


@dataclass
class CompiledTQL:
    """Result of compiling a TQL string.

    ``where`` is ``None`` when the query had no filter expression (e.g. only an
    ``ORDER BY``, or an empty string). ``order_by`` is a list of ready-to-use
    SQLAlchemy ordering elements (``col.asc()`` / ``col.desc()``); empty when the
    query specified no ordering.
    """
    where: Optional[ColumnElement] = None
    order_by: List[ColumnElement] = field(default_factory=list)


def compile_tql(text: str, registry: dict, context: Optional[EvalContext] = None) -> CompiledTQL:
    """Parse and compile ``text`` against ``registry``.

    Raises :class:`TQLError` for any syntax, field, operator, or value problem.
    """
    ctx = context or EvalContext()
    query = parse(text)
    where = _compile_node(query.where, registry, ctx) if query.where is not None else None
    order_by = [_compile_order(key, registry) for key in query.order_by]
    return CompiledTQL(where=where, order_by=order_by)


# --- LIKE escaping (mirrors the manual escaping already used in crud) --------

def _like_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _multivalue_member(column, raw: str) -> ColumnElement:
    """Match ``raw`` as a member of a comma-delimited column (e.g. tags).

    ``tags = "security"`` must hit a row stored as ``"security,login"``. We
    normalize both sides (lowercase, strip spaces), wrap the column in delimiters,
    and look for ``,token,`` — exact token membership, tolerant of ``a, b`` vs
    ``a,b`` spacing, and portable across SQLite/Postgres.
    """
    token = raw.strip().lower().replace(" ", "")
    escaped = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    haystack = literal(",").concat(func.replace(func.lower(column), " ", "")).concat(literal(","))
    return haystack.like(f"%,{escaped},%", escape="\\")


# --- node dispatch ----------------------------------------------------------

def _compile_node(node: nodes.BoolNode, registry: dict, ctx: EvalContext) -> ColumnElement:
    if isinstance(node, nodes.And):
        return and_(*[_compile_node(p, registry, ctx) for p in node.parts])
    if isinstance(node, nodes.Or):
        return or_(*[_compile_node(p, registry, ctx) for p in node.parts])
    if isinstance(node, nodes.Not):
        return not_(_compile_node(node.node, registry, ctx))
    if isinstance(node, nodes.Comparison):
        return _compile_comparison(node, registry, ctx)
    if isinstance(node, nodes.InList):
        return _compile_in(node, registry, ctx)
    if isinstance(node, nodes.EmptyCheck):
        return _compile_empty(node, registry)
    raise TQLError("Unsupported expression.")


def _field(name: str, registry: dict) -> FieldSpec:
    spec = registry.get(name)
    if spec is None:
        available = ", ".join(sorted(registry.keys()))
        raise TQLError(f"Unknown field '{name}'. Available fields: {available}.")
    return spec


def _require_op(name: str, op: str, spec: FieldSpec) -> None:
    if op not in spec.ops:
        raise TQLError(f"Operator not supported on field '{name}'.")


def _compile_comparison(node: nodes.Comparison, registry: dict, ctx: EvalContext) -> ColumnElement:
    spec = _field(node.field, registry)
    _require_op(node.field, node.op, spec)
    column = spec.column

    if node.op in ("contains", "ncontains"):
        text = _coerce_text(node.value)
        clause = column.ilike(_like_pattern(text), escape="\\")
        return not_(clause) if node.op == "ncontains" else clause

    # On a comma-delimited field, eq/ne mean "is (not) one of the tags".
    if spec.multivalue and node.op in ("eq", "ne"):
        clause = _multivalue_member(column, _coerce_text(node.value))
        return not_(clause) if node.op == "ne" else clause

    value = spec.coerce(node.value, ctx)
    if node.op == "eq":
        return column == value
    if node.op == "ne":
        return column != value
    if node.op == "gt":
        return column > value
    if node.op == "lt":
        return column < value
    if node.op == "gte":
        return column >= value
    if node.op == "lte":
        return column <= value
    raise TQLError(f"Operator '{node.op}' is not supported.")


def _compile_in(node: nodes.InList, registry: dict, ctx: EvalContext) -> ColumnElement:
    spec = _field(node.field, registry)
    # IN is an equality family operator; allow it wherever eq is allowed.
    if "eq" not in spec.ops:
        raise TQLError(f"IN is not supported on field '{node.field}'.")
    if not node.values:
        raise TQLError("IN requires at least one value.")
    # On a comma-delimited field, IN means "shares any of these tags".
    if spec.multivalue:
        clause = or_(*[_multivalue_member(spec.column, _coerce_text(v)) for v in node.values])
    else:
        clause = spec.column.in_([spec.coerce(v, ctx) for v in node.values])
    return not_(clause) if node.negate else clause


def _compile_empty(node: nodes.EmptyCheck, registry: dict) -> ColumnElement:
    spec = _field(node.field, registry)
    clause = spec.column.is_(None)
    return spec.column.isnot(None) if node.negate else clause


def _compile_order(key: nodes.OrderKey, registry: dict) -> ColumnElement:
    spec = _field(key.field, registry)
    if not spec.sortable:
        raise TQLError(f"Field '{key.field}' is not sortable.")
    return spec.column.desc() if key.descending else spec.column.asc()


def _coerce_text(value: nodes.Value) -> str:
    if isinstance(value, nodes.StringVal):
        return value.value
    if isinstance(value, nodes.BarewordVal):
        return value.value
    if isinstance(value, nodes.NumberVal):
        return str(int(value.value)) if value.value.is_integer() else str(value.value)
    raise TQLError("The ~ operator expects a text value.")
