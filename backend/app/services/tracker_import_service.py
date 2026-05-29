"""
Import a single requirement source from an external issue tracker
(Asana task, Linear issue, or Monday item) using a project's configured
IssueTrackerIntegration credentials.

Mirrors the shape returned by ``atlassian_document_service.fetch_requirement_source``
so the requirements form can populate from any supported source.
"""
import logging
import re
from typing import Dict, List, Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ..jira_service import is_safe_url
from ..models import IssueTrackerIntegration
from ..monday_client import MondayClient
from ..asana_client import AsanaClient
from ..linear_client import LinearClient

logger = logging.getLogger(__name__)

SUPPORTED_SOURCES = {"asana", "linear", "monday"}

# Hosts we expect for each source, used to sanity-check the pasted URL.
_SOURCE_HOST_SUFFIXES = {
    "asana": ("asana.com",),
    "linear": ("linear.app",),
    "monday": ("monday.com",),
}

_LINEAR_IDENTIFIER = re.compile(r"/issue/([A-Za-z0-9]+-\d+)", re.IGNORECASE)


def _host_matches_source(host: str, source: str) -> bool:
    host = host.lower()
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in _SOURCE_HOST_SUFFIXES[source])


def _matching_integration(db: Session, project_id: int, source: str) -> Optional[IssueTrackerIntegration]:
    return (
        db.query(IssueTrackerIntegration)
        .filter(
            IssueTrackerIntegration.project_id == project_id,
            IssueTrackerIntegration.is_active == True,  # noqa: E712
            IssueTrackerIntegration.tracker_type.ilike(source),
        )
        .first()
    )


def _extract_asana_task_id(url: str) -> Optional[str]:
    """The Asana task gid is the last numeric segment of the path."""
    numeric_segments = re.findall(r"\d{6,}", urlparse(url).path)
    return numeric_segments[-1] if numeric_segments else None


def _extract_linear_identifier(url: str) -> Optional[str]:
    match = _LINEAR_IDENTIFIER.search(urlparse(url).path)
    return match.group(1).upper() if match else None


def _extract_monday_item_id(url: str) -> Optional[str]:
    match = re.search(r"/pulses/(\d+)", urlparse(url).path)
    return match.group(1) if match else None


def _integration_config(integration: IssueTrackerIntegration) -> Dict[str, str]:
    return {
        "api_url": integration.api_url or "",
        "api_token": integration.api_token or "",
        "project_key": integration.project_key or "",
    }


def _columns_to_text(column_values: List[dict]) -> str:
    lines = []
    for column in column_values or []:
        text = (column.get("text") or "").strip()
        if text:
            lines.append(f"{column.get('id', 'field')}: {text}")
    return "\n".join(lines)


def fetch_requirement_from_tracker(db: Session, project_id: int, source: str, url: str) -> Dict[str, Optional[str]]:
    """Fetch a single item from an external tracker and normalize it.

    Raises:
        ValueError: invalid source / URL / unparseable link.
        PermissionError: credentials lack access.
        FileNotFoundError: item not found.
        ConnectionError: tracker unreachable.
    """
    source = (source or "").strip().lower()
    if source not in SUPPORTED_SOURCES:
        raise ValueError("Unsupported import source.")

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or not is_safe_url(url):
        raise ValueError("The link URL is not allowed.")
    if not _host_matches_source(parsed.hostname, source):
        raise ValueError(f"This does not look like a {source.title()} link.")

    integration = _matching_integration(db, project_id, source)
    if not integration:
        raise ValueError(f"No active {source.title()} integration is configured for this project.")

    config = _integration_config(integration)
    if not config["api_token"]:
        raise ValueError(f"The {source.title()} integration is missing an API token.")

    if source == "asana":
        return _fetch_asana(config, url)
    if source == "linear":
        return _fetch_linear(config, url)
    return _fetch_monday(config, url)


def _fetch_asana(config: Dict[str, str], url: str) -> Dict[str, Optional[str]]:
    task_id = _extract_asana_task_id(url)
    if not task_id:
        raise ValueError("Could not find an Asana task ID in that link.")

    client = AsanaClient(
        api_url=config["api_url"] or "https://app.asana.com/api/1.0",
        api_token=config["api_token"],
        workspace_id="",
        project_id="",
    )
    result = client.get_task(task_id)
    if not result.get("success"):
        raise _tracker_error(result.get("message", "Unable to fetch the Asana task."))

    data = (result.get("task") or {}).get("data") or {}
    return {
        "source_type": "asana",
        "external_key": str(data.get("gid") or task_id),
        "title": data.get("name") or f"Asana task {task_id}",
        "description": data.get("notes") or "",
        "acceptance_criteria": "",
        "url": data.get("permalink_url") or url,
    }


def _fetch_linear(config: Dict[str, str], url: str) -> Dict[str, Optional[str]]:
    identifier = _extract_linear_identifier(url)
    if not identifier:
        raise ValueError("Could not find a Linear issue identifier in that link.")

    client = LinearClient(
        api_url=config["api_url"] or "https://api.linear.app",
        api_token=config["api_token"],
        team_key=config["project_key"],
    )
    result = client.get_issue(identifier)
    if not result.get("success"):
        raise _tracker_error(result.get("message", "Unable to fetch the Linear issue."))

    issue = result.get("issue") or {}
    if not issue:
        raise FileNotFoundError("Linear issue was not found.")
    return {
        "source_type": "linear",
        "external_key": issue.get("identifier") or identifier,
        "title": issue.get("title") or identifier,
        "description": issue.get("description") or "",
        "acceptance_criteria": "",
        "url": issue.get("url") or url,
    }


def _fetch_monday(config: Dict[str, str], url: str) -> Dict[str, Optional[str]]:
    item_id = _extract_monday_item_id(url)
    if not item_id:
        raise ValueError("Could not find a Monday item ID in that link.")

    client = MondayClient(
        api_url=config["api_url"] or "https://api.monday.com/v2",
        api_token=config["api_token"],
    )
    result = client.get_item(item_id)
    if not result.get("success"):
        raise _tracker_error(result.get("message", "Unable to fetch the Monday item."))

    item = result.get("item") or {}
    return {
        "source_type": "monday",
        "external_key": str(item.get("id") or item_id),
        "title": item.get("name") or f"Monday item {item_id}",
        "description": _columns_to_text(item.get("column_values")),
        "acceptance_criteria": "",
        "url": item.get("url") or url,
    }


def _tracker_error(message: str) -> Exception:
    """Map a client error message onto the exception types the route handles."""
    lowered = message.lower()
    if "authentication" in lowered or "forbidden" in lowered or "access" in lowered:
        return PermissionError(message)
    if "not found" in lowered:
        return FileNotFoundError(message)
    if "connection" in lowered or "timeout" in lowered or "unreachable" in lowered:
        return ConnectionError(message)
    return ValueError(message)
