"""TQL grammar and parser: text -> :class:`~.nodes.Query` AST.

Uses Lark's Earley parser. TQL strings are short (a single filter expression),
so parse speed is irrelevant and Earley's tolerance for an ambiguous,
human-friendly grammar is worth more than LALR's speed.

lark is imported lazily (inside :func:`_build`) so that merely importing this
package never requires lark — the app boots without it, and a ``?tql=`` request
made before ``pip install lark`` fails with a clear, actionable message instead
of crashing route import.

Keywords (AND OR NOT IN IS EMPTY ORDER BY ASC DESC) are case-insensitive and
reserved; to use one as a literal value, quote it (``status = "in"``).
"""

from __future__ import annotations

from .errors import TQLError
from . import nodes


_GRAMMAR = r"""
    start: _expr? order_clause?

    _expr: or_expr

    or_expr: and_expr (OR and_expr)*
    and_expr: term (AND term)*

    ?term: "(" or_expr ")"
         | NOT term                   -> negate
         | condition

    ?condition: NAME OP value         -> binary
              | NAME IN list           -> in_list
              | NAME NOT IN list       -> not_in_list
              | NAME IS EMPTY          -> is_empty
              | NAME IS NOT EMPTY      -> is_not_empty
              | NAME IS value          -> binary_is
              | NAME IS NOT value      -> binary_is_not

    list: "(" value ("," value)* ")"

    ?value: ESCAPED_STRING            -> string
          | RELDATE                   -> reldate
          | DATE                      -> date_value
          | SIGNED_NUMBER             -> number
          | func
          | VALUE_TOKEN               -> bareword

    func: NAME "(" ")"

    order_clause: ORDER BY order_key ("," order_key)*
    order_key: NAME (ASC | DESC)?

    OP: "!=" | ">=" | "<=" | "!~" | "=" | ">" | "<" | "~"
    AND.5:   /\band\b/i
    OR.5:    /\bor\b/i
    NOT.5:   /\bnot\b/i
    IN.5:    /\bin\b/i
    IS.5:    /\bis\b/i
    EMPTY.5: /\bempty\b/i
    ORDER.5: /\border\b/i
    BY.5:    /\bby\b/i
    ASC.5:   /\basc\b/i
    DESC.5:  /\bdesc\b/i

    RELDATE.4: /[+-]\d+[dwhm]\b/
    // Unquoted ISO date (date, or date+time): `2026-06-09`, `2026-06-09T13:20:00`.
    // Higher priority than SIGNED_NUMBER so `2026-06-09` lexes as one date token
    // rather than the number `2026` followed by an unparseable `-06-09`.
    DATE.6: /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/
    NAME: /[a-zA-Z_][a-zA-Z0-9_]*/
    // Unquoted value: starts with a letter/underscore, may contain hyphens,
    // dots, slashes, colons — so keys like DEF-2 / REQ-10 / feature/x need no quotes.
    VALUE_TOKEN: /[a-zA-Z_][a-zA-Z0-9_.\-\/:]*/

    %import common.ESCAPED_STRING
    %import common.SIGNED_NUMBER
    %import common.WS
    %ignore WS
"""

_OP_NAMES = {
    "=": "eq",
    "!=": "ne",
    ">": "gt",
    "<": "lt",
    ">=": "gte",
    "<=": "lte",
    "~": "contains",
    "!~": "ncontains",
}


# (parser, transformer) built lazily on first use and cached here.
_cached = None


def _build():
    """Import lark, define the transformer, and build the parser. Cached.

    Raises :class:`TQLError` (not ImportError) when lark is missing so callers get
    a clean, user-facing message.
    """
    global _cached
    if _cached is not None:
        return _cached

    try:
        from lark import Lark, Token, Transformer, v_args
        from lark.exceptions import LarkError  # noqa: F401  (referenced in parse())
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise TQLError(
            "Query language support is not installed on the server "
            "(missing dependency 'lark')."
        ) from exc

    @v_args(inline=True)
    class _ToAst(Transformer):
        # --- values ---
        def string(self, tok):
            # ESCAPED_STRING includes the surrounding quotes and backslash escapes.
            raw = str(tok)[1:-1]
            return nodes.StringVal(raw.replace('\\"', '"').replace("\\\\", "\\"))

        def number(self, tok):
            return nodes.NumberVal(float(tok))

        def bareword(self, tok):
            return nodes.BarewordVal(str(tok))

        def reldate(self, tok):
            text = str(tok)
            return nodes.RelDateVal(amount=int(text[:-1]), unit=text[-1])

        def date_value(self, tok):
            # Unquoted ISO date literal. Kept as a string so the date coercer
            # parses it on date fields (and it reads as plain text elsewhere) —
            # identical to a quoted "2026-06-09", just without the quotes.
            return nodes.StringVal(str(tok))

        def func(self, name):
            return nodes.FuncVal(str(name))

        def list(self, *values):
            return list(values)

        # --- conditions ---
        def binary(self, field, op, value):
            return nodes.Comparison(field=str(field), op=_OP_NAMES[str(op)], value=value)

        # IS / IS NOT read as natural-language synonyms for = / != when followed
        # by a value (EMPTY is a reserved keyword, so "IS EMPTY" still parses as
        # the null check above, never as "IS <value=empty>").
        def binary_is(self, field, _is, value):
            return nodes.Comparison(field=str(field), op="eq", value=value)

        def binary_is_not(self, field, _is, _not, value):
            return nodes.Comparison(field=str(field), op="ne", value=value)

        def in_list(self, field, _in, values):
            return nodes.InList(field=str(field), values=values, negate=False)

        def not_in_list(self, field, _not, _in, values):
            return nodes.InList(field=str(field), values=values, negate=True)

        def is_empty(self, field, _is, _empty):
            return nodes.EmptyCheck(field=str(field), negate=False)

        def is_not_empty(self, field, _is, _not, _empty):
            return nodes.EmptyCheck(field=str(field), negate=True)

        def negate(self, _not, node):
            return nodes.Not(node)

        # --- boolean structure (AND/OR keyword tokens are dropped) ---
        def and_expr(self, *children):
            parts = [c for c in children if not isinstance(c, Token)]
            return parts[0] if len(parts) == 1 else nodes.And(parts)

        def or_expr(self, *children):
            parts = [c for c in children if not isinstance(c, Token)]
            return parts[0] if len(parts) == 1 else nodes.Or(parts)

        # --- ordering / top level ---
        def order_key(self, name, direction=None):
            descending = direction is not None and str(direction).lower() == "desc"
            return nodes.OrderKey(field=str(name), descending=descending)

        def order_clause(self, *children):
            return [c for c in children if isinstance(c, nodes.OrderKey)]

        @v_args(inline=False)
        def start(self, children):
            where = None
            order_by = []
            for child in children:
                if isinstance(child, list):
                    order_by = child
                elif child is not None:
                    where = child
            return nodes.Query(where=where, order_by=order_by)

    parser = Lark(_GRAMMAR, parser="earley", maybe_placeholders=False)
    _cached = (parser, _ToAst())
    return _cached


def parse(text: str) -> nodes.Query:
    """Parse a TQL string into a :class:`~.nodes.Query`.

    Raises :class:`TQLError` on any syntax problem (or if lark is unavailable).
    """
    if text is None or not text.strip():
        return nodes.Query()

    parser, transformer = _build()
    from lark.exceptions import LarkError

    try:
        tree = parser.parse(text)
        return transformer.transform(tree)
    except LarkError as exc:
        raise TQLError(_friendly(exc, text)) from exc


# Reserved keywords that must be quoted to be used as a literal value.
_RESERVED = {"AND", "OR", "NOT", "IN", "IS", "EMPTY", "ORDER", "BY", "ASC", "DESC"}


def _friendly(exc, text: str) -> str:
    """Turn a lark parse error into a concise, actionable message.

    lark's own messages dump grammar internals (terminal names, expected sets)
    that mean nothing to a user. We translate the common failure shapes —
    unfinished query, missing operator, missing connector, reserved word used as
    a value — into plain guidance, and only fall back to lark's text otherwise.
    """
    from lark.exceptions import UnexpectedCharacters, UnexpectedEOF, UnexpectedToken

    unfinished = "The query looks unfinished — check for a missing value, an unclosed quote, or a missing ')'."

    if isinstance(exc, UnexpectedEOF):
        return unfinished

    if isinstance(exc, UnexpectedToken):
        token = str(exc.token).strip()
        if not token or getattr(exc.token, "type", "") == "$END":
            return unfinished
        col = getattr(exc, "column", None)
        where = f" at position {col}" if isinstance(col, int) else ""
        return f"Unexpected '{token}'{where}.{_token_hint(exc, token)}"

    if isinstance(exc, UnexpectedCharacters):
        # The dynamic lexer reports most structural slips (missing operator or
        # AND/OR, unquoted value, unclosed quote) here, at the column where it got
        # stuck. We can't always tell which, so we anchor on the word it choked on
        # and list the usual causes rather than guess one.
        col = getattr(exc, "column", None)
        near = ""
        if isinstance(col, int) and 0 < col <= len(text):
            rest = text[col - 1:].strip()
            word = rest.split()[0] if rest else ""
            if word:
                near = f" near '{word}'"
        where = f" (position {col})" if isinstance(col, int) else ""
        return (f"Couldn't parse the query{near}{where}. Check for a missing operator "
                "(=, !=, ~, IN, IS), a missing AND/OR between conditions, an unclosed "
                "quote, or a value that needs double quotes.")

    first = str(exc).strip().splitlines()[0] if str(exc).strip() else "syntax error"
    return f"Could not parse query: {first}"


def _token_hint(exc, token: str) -> str:
    """A targeted follow-up hint based on what the parser expected next."""
    expected = set(getattr(exc, "expected", set()) or set())
    # Two conditions run together with no connector is the most common slip.
    if {"AND", "OR"} & expected:
        return " Did you forget AND or OR between conditions?"
    # A field with no operator after it.
    if {"OP", "IN", "IS"} & expected:
        return " Expected a comparison operator here (=, !=, >, <, ~, IN, IS)."
    # A reserved keyword sitting in a value position needs quoting.
    if token.upper() in _RESERVED:
        return f' To use "{token}" as a value, wrap it in double quotes.'
    return ""
