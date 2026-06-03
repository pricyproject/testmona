"""TQL abstract syntax tree.

The parser produces these nodes; the compiler walks them. Keeping the AST as a
small set of dataclasses (rather than raw Lark trees) gives us a stable,
serializable shape — the same structure can later back a saved-filter
``definition`` JSON or a visual query builder.

Operator vocabulary (the ``op`` field on :class:`Comparison`):
    eq ne gt lt gte lte    -- scalar comparisons
    contains ncontains     -- substring match / its negation  (~ , !~)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Union


# --- value literals ---------------------------------------------------------

@dataclass
class StringVal:
    value: str


@dataclass
class NumberVal:
    value: float


@dataclass
class BarewordVal:
    """An unquoted token, e.g. the ``OPEN`` in ``status = OPEN``.

    Resolved by the field's coercer (enum member, plain text, ...).
    """
    value: str


@dataclass
class FuncVal:
    """A zero-arg function call like ``currentUser()`` or ``now()``."""
    name: str


@dataclass
class RelDateVal:
    """A relative date offset such as ``-7d`` (amount=-7, unit='d').

    Units: d=days, w=weeks, h=hours, m=minutes.
    """
    amount: int
    unit: str


Value = Union[StringVal, NumberVal, BarewordVal, FuncVal, RelDateVal]


# --- conditions / boolean structure ----------------------------------------

@dataclass
class Comparison:
    field: str
    op: str           # eq, ne, gt, lt, gte, lte, contains, ncontains
    value: Value


@dataclass
class InList:
    field: str
    values: List[Value]
    negate: bool = False


@dataclass
class EmptyCheck:
    field: str
    negate: bool = False   # True => IS NOT EMPTY


@dataclass
class And:
    parts: List["BoolNode"]


@dataclass
class Or:
    parts: List["BoolNode"]


@dataclass
class Not:
    node: "BoolNode"


BoolNode = Union[Comparison, InList, EmptyCheck, And, Or, Not]


# --- ordering / top-level query --------------------------------------------

@dataclass
class OrderKey:
    field: str
    descending: bool = False


@dataclass
class Query:
    where: Optional[BoolNode] = None
    order_by: List[OrderKey] = field(default_factory=list)
