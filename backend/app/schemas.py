"""Compatibility facade for Pydantic schemas split by domain."""

from pydantic import BaseModel

from .schema_modules.versioning import *
from .schema_modules.core import *
from .schema_modules.custom_fields import *
from .schema_modules.integrations_settings import *
from .schema_modules.requirements import *
from .schema_modules.defects import *
from .schema_modules.planning import *
from .schema_modules.notifications_analytics import *
from .schema_modules.execution_assets import *
from .schema_modules.docs import *
from .schema_modules.release_notes import *

for _schema in list(globals().values()):
    if isinstance(_schema, type) and issubclass(_schema, BaseModel) and _schema is not BaseModel:
        _schema.model_rebuild(_types_namespace=globals())

__all__ = [name for name in globals() if not name.startswith("_")]
