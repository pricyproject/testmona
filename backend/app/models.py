"""Compatibility facade for SQLAlchemy models split by domain."""

from .model_modules.base import *
from .model_modules.shared_assets import *
from .model_modules.core_testing import *
from .model_modules.integrations_requirements import *
from .model_modules.defects_planning import *
from .model_modules.analytics_execution import *
from .model_modules.integrations_audit import *
from .model_modules.docs import *

__all__ = [name for name in globals() if not name.startswith("_")]

# Auto-allocate per-project ``project_seq`` on insert for every project-scoped,
# URL/badge-bearing entity, and keep the denormalised ``TestCase.project_id``
# in sync with its suite (see services/sequence_service.py). Registration must
# live here, after every model module is imported.
from .services.sequence_service import register_sequence_listeners as _register_sequence_listeners

_register_sequence_listeners()
