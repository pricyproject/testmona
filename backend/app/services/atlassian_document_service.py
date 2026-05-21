import html
import logging
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

import requests
from requests.auth import HTTPBasicAuth
from sqlalchemy.orm import Session

from ..jira_service import is_safe_url
from ..models import JiraIntegration

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 10
JIRA_KEY_PATTERN = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        if tag in {"p", "br", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        return "\n".join(line.strip() for line in " ".join(self.parts).splitlines() if line.strip())


def _html_to_text(value: Optional[str]) -> str:
    if not value:
        return ""
    parser = _TextExtractor()
    parser.feed(html.unescape(value))
    return parser.text()


def _adf_to_text(node: Any) -> str:
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "\n".join(part for part in (_adf_to_text(item) for item in node) if part.strip())
    if not isinstance(node, dict):
        return ""

    node_type = node.get("type")
    if node_type == "text":
        return str(node.get("text") or "")
    if node_type == "hardBreak":
        return "\n"

    content = node.get("content")
    if not content:
        return ""

    separator = "\n" if node_type in {"doc", "paragraph", "bulletList", "orderedList", "listItem", "heading"} else " "
    text = separator.join(part for part in (_adf_to_text(item) for item in content) if part.strip())
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _extract_jira_key(url: str) -> Optional[str]:
    parsed = urlparse(url)
    query_values = parse_qs(parsed.query)
    for key in ("selectedIssue", "issueKey"):
        value = query_values.get(key, [None])[0]
        if value and JIRA_KEY_PATTERN.fullmatch(value):
            return value

    match = JIRA_KEY_PATTERN.search(parsed.path)
    return match.group(0) if match else None


def _extract_confluence_page_id(url: str) -> Optional[str]:
    parsed = urlparse(url)
    query_values = parse_qs(parsed.query)
    for key in ("pageId", "pageId[]"):
        value = query_values.get(key, [None])[0]
        if value and value.isdigit():
            return value

    match = re.search(r"/pages/(\d+)", parsed.path)
    if match:
        return match.group(1)
    return None


def _extract_confluence_space_title(url: str) -> Optional[Tuple[str, str]]:
    parsed = urlparse(url)
    match = re.search(r"/spaces/([^/]+)/pages/([^/?#]+)", parsed.path)
    if not match:
        return None

    space_key = unquote(match.group(1)).strip()
    page_title = unquote(match.group(2)).replace("+", " ").strip()
    if not space_key or not page_title or page_title.isdigit():
        return None
    return space_key, page_title


def _matching_integration(db: Session, project_id: int, url: str) -> Optional[JiraIntegration]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or not is_safe_url(url):
        return None

    integrations = (
        db.query(JiraIntegration)
        .filter(JiraIntegration.project_id == project_id, JiraIntegration.is_active == True)  # noqa: E712
        .all()
    )
    for integration in integrations:
        integration_host = urlparse(integration.jira_url).hostname
        if integration_host and integration_host.lower() == parsed.hostname.lower():
            return integration
    return None


def _request_json(integration: JiraIntegration, url: str) -> Dict[str, Any]:
    if not is_safe_url(url):
        raise ValueError("The document URL is not allowed.")

    try:
        response = requests.get(
            url,
            auth=HTTPBasicAuth(integration.username, integration.api_token),
            headers={"Accept": "application/json"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.exceptions.Timeout as e:
        raise TimeoutError("Atlassian document fetch timed out.") from e
    except requests.exceptions.RequestException as e:
        logger.warning("Atlassian request failed for %s: %s", url, e)
        raise ConnectionError("Unable to reach the Atlassian document.") from e
    if response.status_code in {401, 403}:
        raise PermissionError("Atlassian credentials do not have access to this document.")
    if response.status_code == 404:
        raise FileNotFoundError("Atlassian document was not found.")
    if response.status_code >= 400:
        logger.warning("Atlassian fetch failed with status %s for %s", response.status_code, url)
        raise ValueError("Unable to fetch the Atlassian document.")
    try:
        return response.json()
    except ValueError as e:
        raise ValueError("Atlassian returned an invalid JSON response.") from e


def fetch_requirement_source(db: Session, project_id: int, url: str) -> Dict[str, Optional[str]]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or not is_safe_url(url):
        raise ValueError("The document URL is not allowed.")

    integration = _matching_integration(db, project_id, url)
    if not integration:
        raise ValueError("No active Jira integration matches this Atlassian link.")

    base_url = integration.jira_url.rstrip("/")
    jira_key = _extract_jira_key(url)
    if jira_key:
        issue = _request_json(
            integration,
            f"{base_url}/rest/api/3/issue/{jira_key}?fields=summary,description,issuetype,status,priority,labels",
        )
        fields = issue.get("fields") or {}
        description = _adf_to_text(fields.get("description"))
        issue_type = (fields.get("issuetype") or {}).get("name")
        status = (fields.get("status") or {}).get("name")
        labels = fields.get("labels") or []
        metadata = "\n".join(
            item for item in [
                f"Source: Jira {jira_key}",
                f"Type: {issue_type}" if issue_type else "",
                f"Status: {status}" if status else "",
                f"Labels: {', '.join(labels)}" if labels else "",
            ] if item
        )
        return {
            "source_type": "jira",
            "external_key": jira_key,
            "title": fields.get("summary") or jira_key,
            "description": "\n\n".join(part for part in [metadata, description] if part),
            "acceptance_criteria": "",
            "url": url,
        }

    page_id = _extract_confluence_page_id(url)
    space_title = _extract_confluence_space_title(url)
    if page_id or space_title:
        confluence_base = f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}/wiki"
        if page_id:
            try:
                page = _request_json(
                    integration,
                    f"{confluence_base}/api/v2/pages/{page_id}?body-format=storage",
                )
                body = ((page.get("body") or {}).get("storage") or {}).get("value")
                title = page.get("title") or f"Confluence page {page_id}"
            except (FileNotFoundError, ValueError):
                page = _request_json(
                    integration,
                    f"{confluence_base}/rest/api/content/{page_id}?expand=body.storage",
                )
                body = (((page.get("body") or {}).get("storage") or {}).get("value"))
                title = page.get("title") or f"Confluence page {page_id}"
            external_key = page_id
        else:
            space_key, page_title = space_title
            page = _request_json(
                integration,
                f"{confluence_base}/rest/api/content?spaceKey={quote(space_key, safe='')}&title={quote(page_title, safe='')}&expand=body.storage",
            )
            results = page.get("results") or []
            if not results:
                raise FileNotFoundError("Confluence page was not found.")
            content = results[0]
            body = (((content.get("body") or {}).get("storage") or {}).get("value"))
            title = content.get("title") or page_title
            external_key = str(content.get("id") or page_title)

        return {
            "source_type": "confluence",
            "external_key": external_key,
            "title": title,
            "description": _html_to_text(body),
            "acceptance_criteria": "",
            "url": url,
        }

    raise ValueError("Paste a Jira issue link or a Confluence page link.")
