"""Per-project feature toggles.

A project can enable or disable optional feature modules (test cases, doc hub,
Ask AI, reports, ...). The catalog below is the single source of truth for which
features are toggleable. Anything not listed here — Overview, Project Members,
Project Settings — is always available, so a project can never lock itself out of
its own settings.

Features default to *enabled*: a key missing from a project's stored `features`
map is treated as on. This keeps every existing project fully featured until an
admin/owner/manager explicitly turns something off, and means new features added
to the catalog later are on by default.

The frontend mirrors these keys in ``frontend/src/lib/projectFeatures.ts``; keep
the two lists in sync.
"""

from typing import Dict

# Canonical, ordered list of toggleable feature keys.
PROJECT_FEATURES = (
    "requirements",
    "doc_hub",
    "doc_revisions",
    "test_cases",
    "test_suites",
    "test_runs",
    "milestones",
    "test_plans",
    "defects",
    "advanced_search",
    "reports",
    "test_asset_health",
    "ask_ai",
    "custom_fields",
    "shared_steps",
    "global_parameters",
    "test_data",
    "webhooks",
    "environments",
)

PROJECT_FEATURE_SET = frozenset(PROJECT_FEATURES)


def normalize_features(features) -> Dict[str, bool]:
    """Return a complete ``{feature_key: bool}`` map.

    Unknown keys in the stored value are dropped and any catalog key that is
    missing defaults to ``True`` (enabled).
    """
    raw = features if isinstance(features, dict) else {}
    return {key: bool(raw.get(key, True)) for key in PROJECT_FEATURES}


def is_feature_enabled(project, feature_key: str) -> bool:
    """Whether ``feature_key`` is enabled for ``project``.

    Non-catalog keys are always considered enabled (they are not toggleable), as
    is any feature for a project whose ``features`` column has never been set.
    """
    if feature_key not in PROJECT_FEATURE_SET:
        return True
    raw = getattr(project, "features", None)
    if not isinstance(raw, dict):
        return True
    return bool(raw.get(feature_key, True))
