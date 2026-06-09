"""Compatibility facade for CRUD functions split by domain."""

from .crud_modules.projects import *
from .crud_modules.test_management import *
from .crud_modules.users import *
from .crud_modules.custom_fields import *
from .crud_modules.integrations import *
from .crud_modules.requirements import *
from .crud_modules.defects_planning import *
from .crud_modules.notifications_analytics import *
from .crud_modules.assets_execution import *
from .crud_modules.settings_versions import *

__all__ = [name for name in globals() if not name.startswith("_")]
