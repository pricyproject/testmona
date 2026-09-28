"""Gherkin ``.feature`` file import/export for requirements.

A requirement's ``acceptance_criteria`` holds Gherkin (Background + Scenarios).
This module renders a requirement into a canonical ``.feature`` document and
parses uploaded ``.feature`` files back into requirement drafts, so a project's
BDD specs can round-trip through the standard Cucumber/Gherkin file format.

Everything here is pure (no DB/HTTP) and string-only, so it is trivially
testable and reusable by the route layer.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import List, Optional

# Block-level keywords that open a scenario-ish section.
_BLOCK_RE = re.compile(r"^(Background|Scenario Outline|Scenario|Example|Rule):", re.IGNORECASE)
_FEATURE_RE = re.compile(r"^\s*Feature:\s*(.*)$", re.IGNORECASE)
# Detects a Feature line anywhere in a multi-line block (not just at the start).
_HAS_FEATURE_RE = re.compile(r"^\s*Feature:", re.IGNORECASE | re.MULTILINE)
_STEP_RE = re.compile(r"^(Given|When|Then|And|But|\*)\b", re.IGNORECASE)
_FENCE_RE = re.compile(r'^("""|```)')
_REQ_KEY_RE = re.compile(r"\bREQ-\d+\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Extracting raw Gherkin from stored acceptance criteria
# ---------------------------------------------------------------------------

# Tags emitted by ``markdown_to_html`` plus the Gherkin code-block wrapper. Only
# these are stripped, so Scenario Outline placeholders like ``<value>`` (which
# look like tags after entity-decoding) are preserved verbatim.
_HTML_TAGS = (
    "a|abbr|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|img|ins|kbd|li|ol|p|pre|"
    "s|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul"
)
_STRUCTURAL_TAG_RE = re.compile(r"<\s*br\s*/?>|</\s*(?:p|div|li|h[1-6]|tr|pre)\s*>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(rf"</?(?:{_HTML_TAGS})(?:\s[^>]*)?/?>", re.IGNORECASE)


def _strip_markup(value: str) -> str:
    """Strip known HTML markup, mapping structural tags to line breaks. Assumes
    entity references have already been decoded (so ``<pre>`` matches, not
    ``&lt;pre&gt;``). A deliberate whitelist — anything that is not a recognised
    HTML tag (e.g. a ``<value>`` outline placeholder) is left untouched."""
    text = _STRUCTURAL_TAG_RE.sub("\n", value)
    return _HTML_TAG_RE.sub("", text)


def gherkin_text_from_acceptance(value: Optional[str]) -> str:
    """Recover plain Gherkin text from a stored ``acceptance_criteria`` value.

    Acceptance criteria are persisted HTML-escaped and may be wrapped in a
    ``<pre><code class="language-gherkin">`` block (AI-converted) or stored as
    entity-escaped raw text (Gherkin editor). Both must collapse back to the
    original multi-line Gherkin, with line breaks preserved.

    Entities are decoded *first* so the wrapping tags become real markup that the
    stripper can remove; any inner entities (``&quot;`` inside a step) are decoded
    by a second pass.
    """
    if not value:
        return ""
    text = _strip_markup(html.unescape(value))
    text = html.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip("\n").rstrip()


# ---------------------------------------------------------------------------
# Deterministic acceptance criteria → Gherkin (no AI involved)
# ---------------------------------------------------------------------------

# Localized Gherkin keywords (Persian/Arabic) mapped to canonical English so the
# rest of the pipeline works against a single grammar.
_LOCALIZED_GHERKIN_PATTERNS: List[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^\s*(ویژگی|قابلیت)\s*[:：]\s*", re.IGNORECASE), "Feature: "),
    (re.compile(r"^\s*(خاصية|ميزة|الميزة)\s*[:：]\s*", re.IGNORECASE), "Feature: "),
    (re.compile(r"^\s*(طرح سناریو|مخطط السيناريو)\s*[:：]\s*", re.IGNORECASE), "Scenario Outline: "),
    (re.compile(r"^\s*(سناریو|سيناريو)\s*[:：]\s*", re.IGNORECASE), "Scenario: "),
    (re.compile(r"^\s*(پیش‌زمینه|پیش زمینه|الخلفية|خلفية)\s*[:：]\s*", re.IGNORECASE), "Background: "),
    (re.compile(r"^\s*(با فرض|فرض|بفرض)\s+", re.IGNORECASE), "Given "),
    (re.compile(r"^\s*(وقتی|زمانی که|هنگامی که|عندما|متى)\s+", re.IGNORECASE), "When "),
    (re.compile(r"^\s*(آنگاه|سپس|إذن|اذاً|عندئذ)\s+", re.IGNORECASE), "Then "),
    (re.compile(r"^\s*(اما|ولی|لكن)\s+", re.IGNORECASE), "But "),
    (re.compile(r"^\s*(و)\s+", re.IGNORECASE), "And "),
]

# Leading list/section markers an author may bake into a criterion line.
_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+")
# Markdown task-list checkbox ("- [ ] foo" / "- [x] foo"). The list marker is
# stripped first, so this only needs to handle the bare "[ ]"/"[x]" prefix.
_CHECKBOX_RE = re.compile(r"^\s*\[[ xX]?\]\s*")
_CRITERIA_STEP_RE = re.compile(r"^(Given|When|Then|And|But)\b[ \t]*(.*)$", re.IGNORECASE)
_CRITERIA_STAR_RE = re.compile(r"^\*[ \t]+(.*)$")
_FEATURE_LINE_RE = re.compile(r"^\s*Feature:\s*(.*)$", re.IGNORECASE)
_AC_HEADER_RE = re.compile(r"^\s*(?:acceptance\s+(?:criteria|tests?|conditions?)|success\s+criteria|definition\s+of\s+done|done\s+criteria)\s*[:：]?\s*$", re.IGNORECASE)
_CONDITIONAL_RE = re.compile(r"^(?:if|when)\s+(.+?)\s*,?\s*then\s+(.+)$", re.IGNORECASE)
_CONDITION_ONLY_RE = re.compile(r"^(?:if|when)\s+(.+)$", re.IGNORECASE)
_MAX_CRITERIA_SCENARIOS = 30


def _normalize_localized_keywords(value: str) -> str:
    """Rewrite Persian/Arabic Gherkin keywords on each line to English."""
    out: List[str] = []
    for line in value.split("\n"):
        stripped = line.lstrip()
        indent = line[: len(line) - len(stripped)]
        replaced: Optional[str] = None
        for pattern, prefix in _LOCALIZED_GHERKIN_PATTERNS:
            if pattern.search(stripped):
                replaced = indent + pattern.sub(prefix, stripped)
                break
        out.append(replaced if replaced is not None else line)
    return "\n".join(out)


def _strip_code_fence(value: str) -> str:
    text = re.sub(r"^```(?:gherkin|feature)?\s*", "", value.strip(), flags=re.IGNORECASE)
    return re.sub(r"```$", "", text, flags=re.IGNORECASE).strip()


def _criteria_lines(text: str) -> List[str]:
    """Flatten acceptance prose/HTML-ish text into clean criterion lines: list
    markers, task-list checkboxes and a leading "Acceptance Criteria" header are
    removed and blank lines dropped. Structured Gherkin lines (blocks, steps,
    Examples, tables, doc strings) are kept as-is."""
    lines: List[str] = []
    for raw in text.split("\n"):
        line = _CHECKBOX_RE.sub("", _LIST_MARKER_RE.sub("", raw)).strip()
        if not line or _AC_HEADER_RE.match(line):
            continue
        lines.append(line)
    return lines


@dataclass
class _Scenario:
    kind: str  # Scenario | Scenario Outline | Background
    title: str
    steps: List[tuple[str, str]] = field(default_factory=list)
    extras: List[str] = field(default_factory=list)  # Examples line + table rows


def _build_scenarios(title: str, lines: List[str]) -> tuple[str, List[_Scenario]]:
    """Group criterion lines into Gherkin scenarios.

    Explicit Gherkin (``Feature``/``Scenario``/``Examples`` + ``Given/When/Then``)
    is grouped verbatim; plain prose criteria each become their own ``Then``
    scenario, and ``If/When … then …`` prose is split into When/Then steps. This
    never emits a bare non-step line inside a scenario, so the result always
    parses as valid Gherkin."""
    feature_title = title
    scenarios: List[_Scenario] = []
    current: Optional[_Scenario] = None

    def open_scenario(kind: str, scenario_title: str) -> None:
        nonlocal current
        current = _Scenario(kind=kind, title=scenario_title)
        scenarios.append(current)

    def has_then() -> bool:
        return current is not None and any(keyword == "Then" for keyword, _ in current.steps)

    for line in lines:
        feature_match = _FEATURE_LINE_RE.match(line)
        if feature_match:
            feature_title = feature_match.group(1).strip() or title
            current = None
            continue
        if re.match(r"^Rule:", line, re.IGNORECASE):
            current = None
            continue
        block_match = _BLOCK_RE.match(line)
        if block_match:
            raw_kind = block_match.group(1).lower()
            kind = (
                "Scenario Outline" if raw_kind.startswith("scenario outline")
                else "Background" if raw_kind.startswith("background")
                else "Scenario"
            )
            open_scenario(kind, line.split(":", 1)[1].strip() or title)
            continue
        if re.match(r"^Examples:", line, re.IGNORECASE):
            if current is not None:
                current.extras.append(line)
            continue
        if line.startswith(("|", "@", "#", '"""', "```")):
            if current is not None:
                current.extras.append(line)
            continue

        step_match = _CRITERIA_STEP_RE.match(line)
        star_match = _CRITERIA_STAR_RE.match(line)
        if step_match or star_match:
            keyword = step_match.group(1) if step_match else "And"
            text = (step_match.group(2) if step_match else star_match.group(1)).strip()
            # A fresh ``Given`` starts a new scenario only when the current one
            # already has steps; a Scenario block that was just opened (empty) is
            # reused so its explicit title/kind survive.
            if current is None or (keyword.lower() == "given" and current.steps):
                open_scenario("Scenario", title)
            if keyword.lower() in {"and", "but"} and not any(
                existing in {"Given", "When", "Then"} for existing, _ in current.steps
            ):
                keyword = "Given"
            keyword = "And" if keyword == "*" else keyword.capitalize()
            current.steps.append((keyword, text))
            if len(scenarios) >= _MAX_CRITERIA_SCENARIOS:
                break
            continue

        conditional = _CONDITIONAL_RE.match(line)
        if conditional:
            if current is None or has_then():
                open_scenario("Scenario", title)
            current.steps.append(("When", conditional.group(1).strip()))
            current.steps.append(("Then", conditional.group(2).strip()))
            continue
        condition_only = _CONDITION_ONLY_RE.match(line)
        if condition_only:
            if current is None or has_then():
                open_scenario("Scenario", title)
            current.steps.append(("When", condition_only.group(1).strip()))
            continue

        # Plain prose criterion → its own outcome scenario.
        if current is None or has_then():
            open_scenario("Scenario", title)
        current.steps.append(("Then", line))
        if len(scenarios) >= _MAX_CRITERIA_SCENARIOS:
            break

    scenarios = [s for s in scenarios if s.steps]
    if not scenarios:
        scenarios = [_Scenario(kind="Scenario", title=title,
                               steps=[("Then", f"{title} is satisfied")])]
    return feature_title, scenarios


def _render_scenarios(feature_title: str, scenarios: List[_Scenario]) -> str:
    out: List[str] = [f"Feature: {feature_title}"]
    total = len(scenarios)
    for index, scenario in enumerate(scenarios):
        kind = scenario.kind or "Scenario"
        name = scenario.title or feature_title
        if total > 1 and name == feature_title:
            name = f"{feature_title} - criterion {index + 1}"
        out.append("")
        out.append(f"{kind}: {name}")
        if kind != "Background" and not any(keyword == "Given" for keyword, _ in scenario.steps):
            out.append(f"Given {feature_title} is in scope")
        out.extend(f"{keyword} {text}" for keyword, text in scenario.steps)
        out.extend(scenario.extras)
    return "\n".join(out)


def acceptance_to_feature(
    title: str,
    acceptance_value: Optional[str] = None,
    fallback_value: Optional[str] = None,
) -> str:
    """Turn acceptance criteria (already-Gherkin, prose bullets, numbered or
    task lists, or ``If … then …`` sentences) into a valid ``Feature`` document.

    This is the deterministic, no-AI path used when converting a doc to
    requirements: it repairs/keeps existing Gherkin and otherwise synthesises a
    scenario per criterion. ``acceptance_value`` wins; ``fallback_value`` (e.g.
    the section body) is used only when the acceptance is empty."""
    safe_title = (title or "Requirement").strip() or "Requirement"
    text = _recover_acceptance_text(acceptance_value) or _recover_acceptance_text(fallback_value)
    text = _normalize_localized_keywords(_strip_code_fence(text))
    feature_title, scenarios = _build_scenarios(safe_title, _criteria_lines(text))
    return format_gherkin(_render_scenarios(feature_title, scenarios))


_BLOCK_TAG_RE = re.compile(r"<(?:ul|ol|li|p|div|h[1-6]|table|tbody|thead|tr|td|th|br|pre)\b", re.IGNORECASE)


def _recover_acceptance_text(value: Optional[str]) -> str:
    """Recover plain Gherkin text from an acceptance value, preserving
    ``<placeholder>`` tokens (e.g. ``<a>``/``<value>``) that look like HTML tags.

    Values from the converter/AI are wrapped in ``<pre><code>``; the inner text
    is taken as-is. Plain HTML prose (``<ul>``/``<p>`` …) is stripped normally."""
    if not value:
        return ""
    decoded = html.unescape(str(value))
    match = re.search(r"<pre[^>]*>\s*<code[^>]*>(.*?)</code>", decoded, re.IGNORECASE | re.DOTALL)
    if match:
        body = match.group(1)
    else:
        body = decoded
        if _BLOCK_TAG_RE.search(body):
            body = _strip_markup(body)
    body = html.unescape(body)
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    body = re.sub(r"[ \t]+\n", "\n", body)
    return body.strip("\n").rstrip()


def _description_to_text(value: Optional[str]) -> str:
    """Flatten an HTML/entity-escaped description into plain, paragraph-spaced text."""
    if not value:
        return ""
    text = _strip_markup(html.unescape(value))
    text = html.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip() for ln in text.split("\n")]
    # Collapse runs of blank lines.
    out: List[str] = []
    for ln in lines:
        if not ln and (not out or not out[-1]):
            continue
        out.append(ln)
    return "\n".join(out).strip()


# ---------------------------------------------------------------------------
# Canonical Gherkin formatting (2-space ladder + aligned tables)
# ---------------------------------------------------------------------------

def _split_cells(line: str) -> List[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def format_gherkin(value: str) -> str:
    """Re-indent a Gherkin document to the canonical two-space ladder
    (Feature → 0, Scenario/Background → 2, steps/Examples → 4, tables/doc
    strings → 6) and align pipe-table columns. Doc-string bodies are preserved
    verbatim. Mirrors the frontend ``formatGherkin`` so files round-trip."""
    if not value.strip():
        return value
    FEATURE, BLOCK, STEP, INNER = "", "  ", "    ", "      "
    out: List[str] = []
    feature_seen = False
    in_doc = False
    table: List[str] = []

    def flush_table() -> None:
        nonlocal table
        if not table:
            return
        rows = [_split_cells(r) for r in table]
        col_count = max(len(r) for r in rows)
        widths = [max((len(r[c]) if c < len(r) else 0) for r in rows) for c in range(col_count)]
        for r in rows:
            cells = [(r[c] if c < len(r) else "").ljust(widths[c]) for c in range(col_count)]
            out.append(f"{INNER}| " + " | ".join(cells) + " |")
        table = []

    for raw in value.replace("\t", "  ").split("\n"):
        trimmed = raw.strip()
        if in_doc:
            if _FENCE_RE.match(trimmed):
                out.append(f"{INNER}{trimmed}")
                in_doc = False
            else:
                out.append(raw.rstrip())
            continue
        if trimmed.startswith("|"):
            table.append(trimmed)
            continue
        flush_table()
        if not trimmed:
            out.append("")
            continue
        if _FENCE_RE.match(trimmed):
            out.append(f"{INNER}{trimmed}")
            in_doc = True
            continue
        if trimmed.startswith("#") or trimmed.startswith("@"):
            out.append(f"{BLOCK if feature_seen else FEATURE}{trimmed}")
            continue
        if re.match(r"^Feature:", trimmed, re.IGNORECASE):
            feature_seen = True
            out.append(f"{FEATURE}{trimmed}")
            continue
        if re.match(r"^Examples:", trimmed, re.IGNORECASE):
            out.append(f"{STEP}{trimmed}")
            continue
        if _BLOCK_RE.match(trimmed):
            out.append(f"{BLOCK}{trimmed}")
            continue
        if _STEP_RE.match(trimmed):
            out.append(f"{STEP}{trimmed}")
            continue
        out.append(f"{STEP if feature_seen else BLOCK}{trimmed}")
    flush_table()
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def _dedent(text: str) -> str:
    """Strip the common leading indentation from every line (textwrap.dedent
    that ignores blank lines). Turns ``  Scenario:`` / ``    Given`` into
    ``Scenario:`` / ``  Given`` — the storage shape used elsewhere."""
    lines = text.split("\n")
    indents = [len(ln) - len(ln.lstrip(" ")) for ln in lines if ln.strip()]
    if not indents:
        return text.strip("\n")
    cut = min(indents)
    out = [ln[cut:] if len(ln) >= cut else ln.lstrip(" ") for ln in lines]
    return "\n".join(out).strip("\n")


# ---------------------------------------------------------------------------
# Export: requirement → .feature
# ---------------------------------------------------------------------------

def _tags_to_gherkin(tags: Optional[str]) -> List[str]:
    if not tags:
        return []
    out: List[str] = []
    for raw in re.split(r"[,\s]+", tags.strip()):
        raw = raw.strip().lstrip("@")
        if not raw:
            continue
        out.append("@" + re.sub(r"\s+", "-", raw))
    return out


def build_feature_file(
    *,
    title: str,
    description: Optional[str],
    acceptance_criteria: Optional[str],
    requirement_key: Optional[str] = None,
    tags: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
) -> str:
    """Render a requirement as a canonical ``.feature`` document.

    When the acceptance criteria already declare a ``Feature:`` line it is kept
    verbatim (just reformatted); otherwise a ``Feature:`` header is synthesised
    from the title with the description as the feature narrative, and the stored
    scenarios are nested beneath it. Requirement metadata is emitted as leading
    comments/tags so an export can be re-imported with its identity intact.
    """
    body = gherkin_text_from_acceptance(acceptance_criteria)
    desc = _description_to_text(description)

    header: List[str] = []
    if requirement_key:
        header.append(f"# Requirement: {requirement_key}")
    meta = " | ".join(
        part for part in (
            f"Status: {status}" if status else "",
            f"Priority: {priority}" if priority else "",
        ) if part
    )
    if meta:
        header.append(f"# {meta}")

    tag_line = " ".join(_tags_to_gherkin(tags))

    if _HAS_FEATURE_RE.search(body):
        # Already a full feature — reformat as-is.
        document = format_gherkin(body)
        # Inject the requirement tag above the Feature line if not present.
        if tag_line and tag_line not in document:
            document = f"{tag_line}\n{document}"
    else:
        parts = [f"Feature: {title.strip() or 'Untitled'}"]
        if desc:
            parts += ["", desc]
        if body:
            parts += ["", body]
        raw = "\n".join(parts)
        if tag_line:
            raw = f"{tag_line}\n{raw}"
        document = format_gherkin(raw)

    prefix = ("\n".join(header) + "\n") if header else ""
    return f"{prefix}{document}\n"


def feature_filename(requirement_key: Optional[str], title: str) -> str:
    """A filesystem-safe ``.feature`` name, e.g. ``REQ-007-user-login.feature``."""
    slug = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:60]
    key = (requirement_key or "").strip()
    stem = "-".join(part for part in (key, slug) if part) or "requirement"
    return f"{stem}.feature"


# ---------------------------------------------------------------------------
# Import: .feature → requirement drafts
# ---------------------------------------------------------------------------

@dataclass
class ParsedFeature:
    title: str
    description: str = ""
    scenarios: str = ""
    tags: List[str] = field(default_factory=list)
    source_key: Optional[str] = None  # REQ-xxx recovered from comment/tag, if any


def _meta_key_from_lines(lines: List[str]) -> Optional[str]:
    for ln in lines:
        m = _REQ_KEY_RE.search(ln)
        if m:
            return m.group(0).upper()
    return None


def parse_feature_documents(text: str, fallback_title: str = "Imported Feature") -> List[ParsedFeature]:
    """Parse a ``.feature`` file (one or more ``Feature:`` blocks) into drafts.

    Tags/comments immediately preceding a ``Feature:`` line are attributed to
    that feature. Everything from the first block keyword (Background/Scenario/
    Rule) onward becomes the scenario body; lines between the ``Feature:`` line
    and the first block keyword become the description narrative.
    """
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")

    feature_idxs = [i for i, ln in enumerate(lines) if _FEATURE_RE.match(ln)]
    if not feature_idxs:
        # No Feature header — treat the whole file as one requirement's scenarios.
        scenarios = _dedent(normalized)
        if not scenarios.strip():
            return []
        leading = [ln for ln in lines if ln.strip().startswith("#") or ln.strip().startswith("@")]
        return [ParsedFeature(
            title=fallback_title,
            scenarios=scenarios,
            tags=[t for ln in leading for t in ln.split() if t.startswith("@")],
            source_key=_meta_key_from_lines(lines),
        )]

    # Determine the start of each feature chunk: walk back over the contiguous
    # tag/comment/blank lines that decorate the Feature header.
    starts: List[int] = []
    for fi in feature_idxs:
        s = fi
        while s - 1 >= 0:
            prev = lines[s - 1].strip()
            if prev == "" or prev.startswith("@") or prev.startswith("#"):
                s -= 1
            else:
                break
        starts.append(s)

    features: List[ParsedFeature] = []
    for k, fi in enumerate(feature_idxs):
        chunk_start = starts[k]
        chunk_end = starts[k + 1] if k + 1 < len(starts) else len(lines)
        decoration = lines[chunk_start:fi]
        body_lines = lines[fi:chunk_end]

        title = (_FEATURE_RE.match(lines[fi]).group(1) or "").strip() or fallback_title
        tags = [t for ln in decoration for t in ln.split() if t.startswith("@")]

        # Split description (post-Feature narrative) from the scenario body.
        desc_lines: List[str] = []
        scenario_lines: List[str] = []
        seen_block = False
        for ln in body_lines[1:]:  # skip the Feature: line itself
            stripped = ln.strip()
            if not seen_block and (_BLOCK_RE.match(stripped) or stripped.startswith("@") or re.match(r"^Examples:", stripped, re.IGNORECASE)):
                seen_block = True
            if seen_block:
                scenario_lines.append(ln)
            elif stripped.startswith("#"):
                continue  # comments in the narrative are dropped
            else:
                desc_lines.append(ln)

        features.append(ParsedFeature(
            title=title[:255],
            description="\n".join(desc_lines).strip(),
            scenarios=_dedent("\n".join(scenario_lines)),
            tags=tags,
            source_key=_meta_key_from_lines(decoration),
        ))

    return features
