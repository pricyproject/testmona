"""User-facing TQL errors.

Anything raised as a ``TQLError`` is safe to surface back to the caller (it
describes a problem with their query, not an internal failure) and is mapped to
an HTTP 400 by the route layer.
"""


class TQLError(ValueError):
    """Raised for any user-correctable problem in a TQL string.

    Covers syntax errors, unknown fields, operators not allowed on a field, and
    values that can't be coerced to the field's type.
    """
