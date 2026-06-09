"""Compatibility facade for import/export routes split by domain."""

from .import_export_modules.base import router, logger
from .import_export_modules.schemas import *
from .import_export_modules.helpers import *
from .import_export_modules.test_cases import *
from .import_export_modules.projects import *

__all__ = [name for name in globals() if not name.startswith("_")]
