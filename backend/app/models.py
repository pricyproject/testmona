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
