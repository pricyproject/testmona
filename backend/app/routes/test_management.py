"""Compatibility registrar for test management route modules."""

from .test_management_suites_cases import register_suite_case_routes
from .test_management_runs import register_run_routes
from .test_management_matrix import register_matrix_run_routes
from .test_management_sections_steps import register_section_step_routes
from .test_management_analysis import register_analysis_routes
from .test_management_results import register_result_routes


def register_test_management_routes(app):
    register_suite_case_routes(app)
    register_run_routes(app)
    register_matrix_run_routes(app)
    register_section_step_routes(app)
    register_analysis_routes(app)
    register_result_routes(app)
