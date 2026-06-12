"""Centralised structlog-based logging configuration.

The application historically relied on uvicorn's default logging and ad-hoc
``logging.getLogger(__name__)`` calls with free-form (sometimes emoji-prefixed)
messages. That is fine for eyeballing a dev console but is not ingestion
friendly: there is no consistent structure, no timestamps on every line, and no
machine-parseable fields.

``configure_logging`` wires up structlog so that:

* structlog-native loggers (``structlog.get_logger()`` / the ``get_logger``
  re-export below) and the existing stdlib ``logging`` loggers BOTH render
  through the same pipeline — so the ~360 existing ``logger.info(...)`` call
  sites get the new formatting for free, no rewrite required.
* In production-like environments the output is one JSON object per line
  (timestamp, level, logger, event, plus any bound key/values), ready for a log
  shipper. In development it's a coloured, human-readable console renderer.

Call ``configure_logging()`` once, as early as possible at process startup
(done at import time in ``app.main``).
"""

from __future__ import annotations

import logging
import sys

import structlog

from .config import settings

# Environments that should default to machine-readable JSON output.
_JSON_DEFAULT_ENVIRONMENTS = {"production", "prod", "staging", "stage"}

# uvicorn installs its own handlers/formatters on these loggers. We strip those
# and let the records propagate to the root handler so everything is rendered by
# our single pipeline (otherwise access logs would still be plain text).
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")

# Processors shared between structlog-native and stdlib ("foreign") records so
# both produce the same set of fields.
_SHARED_PROCESSORS: list = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.StackInfoRenderer(),
]

# Guard so repeated imports / test fixtures don't stack duplicate handlers.
_configured = False


def _resolve_format() -> str:
    """Return ``"json"`` or ``"console"`` honouring config, then environment."""
    configured = (settings.log_format or "").strip().lower()
    if configured in {"json", "console"}:
        return configured
    if configured:
        # Unknown value: don't silently pick the wrong renderer.
        raise ValueError(
            f"Invalid LOG_FORMAT={configured!r}; expected 'json' or 'console'."
        )
    env = (settings.environment or "").strip().lower()
    return "json" if env in _JSON_DEFAULT_ENVIRONMENTS else "console"


def _resolve_level() -> int:
    name = (settings.log_level or "INFO").strip().upper()
    level = logging.getLevelName(name)
    # getLevelName returns the string "Level <name>" for unknown names.
    return level if isinstance(level, int) else logging.INFO


def configure_logging() -> None:
    """Configure structlog + stdlib logging for the whole process. Idempotent."""
    global _configured
    if _configured:
        return

    level = _resolve_level()
    renderer = (
        structlog.processors.JSONRenderer()
        if _resolve_format() == "json"
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )

    # structlog-native loggers: run the shared processors, then hand the event
    # dict off to the stdlib ProcessorFormatter for final rendering, so there is
    # exactly one rendering path for both worlds.
    structlog.configure(
        processors=_SHARED_PROCESSORS
        + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        # foreign_pre_chain runs for records coming from stdlib logging (the
        # existing logger.* call sites) so they gain the same shared fields.
        foreign_pre_chain=_SHARED_PROCESSORS,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.format_exc_info,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Let uvicorn's records flow through the root handler instead of its own.
    for name in _UVICORN_LOGGERS:
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

    _configured = True


# Re-export so new code can do ``from app.logging_config import get_logger``.
get_logger = structlog.get_logger
