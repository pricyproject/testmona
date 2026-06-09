"""Compatibility facade for suite and case route registrars."""

from .test_management_suites import register_suite_routes
from .test_management_cases import register_case_routes


def register_suite_case_routes(app):
    register_suite_routes(app)
    register_case_routes(app)
