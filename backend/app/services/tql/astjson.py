"""Serialize a parsed TQL AST to a JSON-able dict.

Persisted into ``SavedFilter.definition`` so a saved Advanced Search keeps its
structured form (not just the text) — the foundation for a future visual query
builder that can read/edit the tree without re-parsing.
"""

from __future__ import annotations

from typing import Optional

from . import nodes


def _value_to_json(value: nodes.Value) -> dict:
    if isinstance(value, nodes.StringVal):
        return {"kind": "string", "value": value.value}
    if isinstance(value, nodes.NumberVal):
        return {"kind": "number", "value": value.value}
    if isinstance(value, nodes.BarewordVal):
        return {"kind": "bareword", "value": value.value}
    if isinstance(value, nodes.FuncVal):
        return {"kind": "func", "name": value.name}
    if isinstance(value, nodes.RelDateVal):
        return {"kind": "reldate", "amount": value.amount, "unit": value.unit}
    return {"kind": "unknown"}


def _node_to_json(node: Optional[nodes.BoolNode]) -> Optional[dict]:
    if node is None:
        return None
    if isinstance(node, nodes.And):
        return {"type": "and", "parts": [_node_to_json(p) for p in node.parts]}
    if isinstance(node, nodes.Or):
        return {"type": "or", "parts": [_node_to_json(p) for p in node.parts]}
    if isinstance(node, nodes.Not):
        return {"type": "not", "node": _node_to_json(node.node)}
    if isinstance(node, nodes.Comparison):
        return {"type": "comparison", "field": node.field, "op": node.op,
                "value": _value_to_json(node.value)}
    if isinstance(node, nodes.InList):
        return {"type": "in", "field": node.field, "negate": node.negate,
                "values": [_value_to_json(v) for v in node.values]}
    if isinstance(node, nodes.EmptyCheck):
        return {"type": "empty", "field": node.field, "negate": node.negate}
    return None


def ast_to_json(query: nodes.Query) -> dict:
    """Convert a :class:`~.nodes.Query` into a plain, JSON-serializable dict."""
    return {
        "where": _node_to_json(query.where),
        "order_by": [{"field": k.field, "descending": k.descending} for k in query.order_by],
    }
