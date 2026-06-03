"""TQL — Testmona Query Language.

A small JQL-style filter expression language. Users type things like::

    status = OPEN AND priority IN (HIGH, URGENT) AND assignee = currentUser()
    AND created >= -7d AND summary ~ "login" ORDER BY priority DESC

The pipeline is: text -> AST (``parser``) -> SQLAlchemy clauses (``compiler``),
driven by a per-entity field registry (``registry``). The registry is an
allowlist: only registered fields are queryable, every value flows through a
coercer, and all values become bound parameters, so a TQL string can never
inject SQL or reach an unintended column.

Public surface:
    compile_tql(text, registry, context) -> CompiledTQL
    TQLError                              -- raised for any user-facing problem
    CompiledTQL                           -- .where (clause|None), .order_by (list)
    EvalContext                           -- runtime values for currentUser()/now()
    DEFECT_REGISTRY                       -- field registry for the Defect entity
"""

from .errors import TQLError
from .astjson import ast_to_json
from .compiler import CompiledTQL, EvalContext, compile_tql
from .parser import parse
from .registry import (
    DEFECT_REGISTRY,
    DOC_REGISTRY,
    REQUIREMENT_REGISTRY,
    TESTCASE_REGISTRY,
    TESTEXECUTION_REGISTRY,
    TESTPLAN_REGISTRY,
)
from .entities import (
    EntitySpec,
    entity_catalog,
    execute_search,
    export_search,
    field_catalog,
    get_entity,
    value_suggestions,
)

__all__ = [
    "TQLError",
    "CompiledTQL",
    "EvalContext",
    "compile_tql",
    "parse",
    "ast_to_json",
    "DEFECT_REGISTRY",
    "DOC_REGISTRY",
    "REQUIREMENT_REGISTRY",
    "TESTCASE_REGISTRY",
    "TESTEXECUTION_REGISTRY",
    "TESTPLAN_REGISTRY",
    "EntitySpec",
    "entity_catalog",
    "execute_search",
    "export_search",
    "field_catalog",
    "get_entity",
    "value_suggestions",
]
