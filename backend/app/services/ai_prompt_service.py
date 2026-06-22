"""
Reusable AI prompt and response parsing helpers.
"""

import html
import json
import re
from typing import Any, Optional

from json_repair import repair_json


def _unescape_literal_whitespace(text: str) -> str:
    """Restore real whitespace from the literal escape sequences some models
    double-escape inside JSON strings (``\\n`` instead of a newline), so
    multi-line output such as Gherkin keeps its line breaks."""
    if "\\" not in text:
        return text
    return (
        text.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace("\\t", "\t")
    )


def clean_ai_text(value: Any, max_length: int = 4000) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False)
    text = _unescape_literal_whitespace(html.unescape(str(value))).replace("\x00", "").strip()
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text[:max_length].strip()


def clean_gherkin(value: Any, max_length: int = 8000) -> str:
    """Clean a Gherkin block while preserving its line structure (indentation
    and blank lines), only normalising escape sequences and stray nulls."""
    if not value:
        return ""
    text = _unescape_literal_whitespace(html.unescape(str(value))).replace("\x00", "")
    return text.strip()[:max_length].strip()


def strip_html(value: Optional[str]) -> str:
    if not value:
        return ""
    text = re.sub(r"<\s*br\s*/?>", "\n", value)
    text = re.sub(r"</\s*(p|div|li|h[1-6]|tr)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_json_object(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("AI response did not include a JSON object")
    candidate = cleaned[start : end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # Weaker models intermittently emit not-quite-valid JSON — a dropped
        # array-closing bracket, an unescaped quote inside a Gherkin block, a
        # trailing comma. Rather than fail the whole (paid) call, fall back to a
        # tolerant repair pass. ``repair_json`` always returns a string; an empty
        # object means it could not salvage anything, which we treat as a failure
        # so the caller still degrades gracefully.
        repaired = repair_json(candidate)
        parsed = json.loads(repaired)
        if not isinstance(parsed, dict) or not parsed:
            raise ValueError("AI response could not be parsed as a JSON object")
        return parsed


def _toon_scalar(value: Any) -> str:
    """Render a scalar for TOON. Quote only when the value would otherwise be
    ambiguous (contains a delimiter, newline, or leading/trailing space)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    needs_quote = (
        text != text.strip()
        or any(ch in text for ch in (",", ":", "\n", '"', "[", "]", "{", "}"))
    )
    if not needs_quote:
        return text
    escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def encode_toon(data: Any, indent: int = 0) -> str:
    """Minimal Token-Oriented Object Notation encoder.

    TOON drops JSON's repeated keys, braces and quotes in favour of
    indentation and a tabular form for uniform object arrays, which lowers the
    token count an LLM has to read. Supports scalars, nested mappings, scalar
    lists and lists of flat uniform objects (rendered as ``key[N]{cols}:`` rows).
    """
    pad = "  " * indent
    if isinstance(data, dict):
        lines: list[str] = []
        for key, value in data.items():
            if isinstance(value, dict):
                lines.append(f"{pad}{key}:")
                lines.append(encode_toon(value, indent + 1))
            elif isinstance(value, list):
                lines.append(_encode_toon_list(key, value, indent))
            else:
                lines.append(f"{pad}{key}: {_toon_scalar(value)}")
        return "\n".join(line for line in lines if line)
    if isinstance(data, list):
        return _encode_toon_list("items", data, indent)
    return f"{pad}{_toon_scalar(data)}"


def _encode_toon_list(key: str, value: list, indent: int) -> str:
    pad = "  " * indent
    row_pad = "  " * (indent + 1)
    if not value:
        return f"{pad}{key}[0]:"
    flat_objects = all(
        isinstance(item, dict)
        and all(not isinstance(v, (dict, list)) for v in item.values())
        for item in value
    )
    if flat_objects:
        columns = list(value[0].keys())
        if all(list(item.keys()) == columns for item in value):
            header = f"{pad}{key}[{len(value)}]{{{','.join(columns)}}}:"
            rows = [
                row_pad + ",".join(_toon_scalar(item[col]) for col in columns)
                for item in value
            ]
            return "\n".join([header, *rows])
    if all(not isinstance(item, (dict, list)) for item in value):
        joined = ",".join(_toon_scalar(item) for item in value)
        return f"{pad}{key}[{len(value)}]: {joined}"
    # Fallback: nested objects/lists, encode element by element.
    lines = [f"{pad}{key}[{len(value)}]:"]
    for item in value:
        lines.append(encode_toon(item, indent + 1))
    return "\n".join(lines)


def _requirement_payload(requirement: Any) -> dict[str, Any]:
    return {
        "key": requirement.requirement_id,
        "title": requirement.title,
        "priority": getattr(requirement.priority, "value", requirement.priority),
        "status": getattr(requirement.status, "value", requirement.status),
        "description": strip_html(requirement.description),
        "acceptance_criteria": strip_html(requirement.acceptance_criteria),
        "tags": requirement.tags or "",
    }


def build_requirement_test_case_prompt(
    requirement: Any,
    count: int,
    instructions: Optional[str],
    use_toon: bool = False,
) -> str:
    schema = """{
  "drafts": [
    {
      "title": "string",
      "description": "string",
      "preconditions": "string",
      "steps": "plain numbered steps summary",
      "expected_result": "string",
      "priority": "low|medium|high|critical",
      "test_type": "manual|smoke|regression|integration|security|performance|usability",
      "tags": "comma,separated,tags",
      "confidence": 0.0,
      "test_steps": [
        {"step_number": 1, "action": "string", "expected_result": "string", "step_type": "manual"}
      ]
    }
  ],
  "warnings": ["string"]
}"""
    # In TOON mode we also send a minified schema spec instead of the
    # pretty-printed example above. The model still returns the same JSON, but
    # the prompt carries far fewer structural tokens (whitespace/quotes), which
    # is the bulk of the per-request saving for a single requirement.
    compact_schema = (
        'Return JSON only: {"drafts":[{title,description,preconditions,'
        'steps(numbered summary),expected_result,'
        'priority(low|medium|high|critical),'
        'test_type(manual|smoke|regression|integration|security|performance|usability),'
        'tags(comma separated),confidence(0..1),'
        'test_steps:[{step_number,action,expected_result,step_type:manual}]}],'
        '"warnings":[string]}'
    )
    if use_toon:
        requirement_block = "requirement (TOON):\n" + encode_toon(_requirement_payload(requirement))
        schema_intro = compact_schema
        schema_block = ""
    else:
        payload = _requirement_payload(requirement)
        requirement_block = "\n".join(
            [
                f"Requirement key: {payload['key']}",
                f"Title: {payload['title']}",
                f"Priority: {payload['priority']}",
                f"Status: {payload['status']}",
                f"Description: {payload['description']}",
                f"Acceptance criteria: {payload['acceptance_criteria']}",
                f"Tags: {payload['tags']}",
            ]
        )
        schema_intro = "Return only valid JSON using this schema:"
        schema_block = schema
    parts = [
        f"You are a senior QA test designer. Generate exactly {count} review-ready manual test case drafts for this requirement.",
        schema_intro,
        *([schema_block] if schema_block else []),
        "",
        requirement_block,
        f"Additional instructions: {instructions or 'None'}",
    ]
    return "\n".join(parts).strip()


# The AICompletionRequest prompt field is capped at 12000 chars; stay safely
# under it so a long history + many requirements can never overflow it.
QA_PROMPT_CHAR_CEILING = 11500
_QA_HISTORY_CHAR_BUDGET = 1500


def _qa_history_block(history: Optional[list[dict[str, str]]]) -> str:
    """Render recent turns oldest-first, dropping the oldest until the block
    fits a small budget (so a long conversation can't bloat the prompt)."""
    if not history:
        return ""
    turns: list[str] = []
    for turn in history:
        role = "assistant" if str(turn.get("role")) == "assistant" else "user"
        content = clean_ai_text(turn.get("content", ""), 500)
        if content:
            turns.append(f"{role}: {content}")
    # Keep the most recent turns within budget.
    kept: list[str] = []
    used = 0
    for line in reversed(turns):
        if used + len(line) > _QA_HISTORY_CHAR_BUDGET and kept:
            break
        kept.insert(0, line)
        used += len(line) + 1
    if not kept:
        return ""
    return "Recent conversation (oldest first):\n" + "\n".join(kept) + "\n\n"


# Per-row room (chars) for the small fixed fields + TOON structure, so the
# remaining budget can be devoted to description/acceptance_criteria text.
_QA_ROW_OVERHEAD = 560
_QA_INSTRUCTIONS = (
    "You are a QA documentation assistant for a software project. Answer the user's "
    "question using ONLY the requirements provided below (TOON format: the header "
    "`requirements[N]{cols}:` names the columns, each following line is one "
    "requirement's values in that order). If the answer is not contained in these "
    "requirements, say so plainly. Put the requirement keys you relied on ONLY in the "
    "`sources` array — do not list or repeat them inside the answer text.\n"
    'Return JSON only: {"answer": "string (concise, may use GitHub-flavored markdown)", "sources": [{"key": "REQ-x"}]}'
)


def _plain_text(value: Any) -> str:
    """Stored requirement content is HTML-*escaped* (e.g. ``&lt;p&gt;``), so
    unescape entities first, THEN strip the resulting tags, leaving clean text
    the model can read (and whitespace collapsed by ``strip_html``)."""
    if not value:
        return ""
    return strip_html(html.unescape(str(value)))


def _split_text_budget(desc: str, accept: str, budget: int) -> tuple[str, str]:
    """Fit description + acceptance_criteria into ``budget`` chars. When both
    are long, split evenly; when one is short, give the slack to the other so a
    long acceptance-criteria block (where answers often live) isn't truncated."""
    if budget <= 0:
        return "", ""
    if len(desc) + len(accept) <= budget:
        return desc, accept
    half = budget // 2
    if len(desc) <= half:
        return desc, accept[: budget - len(desc)]
    if len(accept) <= half:
        return desc[: budget - len(accept)], accept
    return desc[:half], accept[: budget - half]


def _qa_row(req: Any, text_budget: int) -> dict[str, Any]:
    desc = _plain_text(req.description)
    accept = _plain_text(req.acceptance_criteria)
    desc, accept = _split_text_budget(desc, accept, text_budget)
    return {
        "key": (_plain_text(req.requirement_id) or "")[:50],
        "title": (_plain_text(req.title) or "")[:200],
        "priority": getattr(req.priority, "value", req.priority) or "",
        "status": getattr(req.status, "value", req.status) or "",
        "description": desc,
        "acceptance_criteria": accept,
        "tags": (_plain_text(req.tags) or "")[:300],
    }


def build_requirement_qa_prompt(
    requirements: list[Any],
    question: str,
    history: Optional[list[dict[str, str]]] = None,
) -> str:
    """Prompt for answering a question across many project requirements.

    The requirements are encoded as a single TOON table (keys written once for
    all rows). The available prompt budget is distributed across the selected
    requirements, so a single requirement can use almost the whole budget for
    its content (avoiding answers like "AC7.1 doesn't exist" caused by over-
    aggressive per-field truncation). The assembled prompt is guaranteed to stay
    under :data:`QA_PROMPT_CHAR_CEILING`: rows are dropped from the end (least
    relevant first — callers pass them ranked) until it fits, with a final
    hard-truncate as a backstop.
    """
    history_block = _qa_history_block(history)
    question_text = clean_ai_text(question, 2000)

    def assemble(current_rows: list[dict[str, Any]]) -> str:
        table = encode_toon({"requirements": current_rows}) if current_rows else "requirements[0]:"
        return f"{_QA_INSTRUCTIONS}\n\n{history_block}{table}\n\nQuestion: {question_text}".strip()

    n = len(requirements)
    if n == 0:
        return assemble([])

    fixed = len(_QA_INSTRUCTIONS) + len(history_block) + len(question_text) + 80
    available_text = max(0, QA_PROMPT_CHAR_CEILING - fixed - n * _QA_ROW_OVERHEAD)
    per_req_text = available_text // n

    rows = [_qa_row(req, per_req_text) for req in requirements]
    prompt = assemble(rows)
    # TOON quoting/escaping can push us over the estimate: drop the lowest-ranked
    # requirements until it fits, then hard-truncate as a last resort.
    while len(prompt) > QA_PROMPT_CHAR_CEILING and len(rows) > 1:
        rows = rows[:-1]
        prompt = assemble(rows)
    if len(prompt) > QA_PROMPT_CHAR_CEILING:
        prompt = prompt[:QA_PROMPT_CHAR_CEILING]
    return prompt


_DOC_ROW_OVERHEAD = 300
_DOC_QA_INSTRUCTIONS = (
    "You are a QA documentation assistant for a software project. Answer the user's "
    "question using ONLY the project items provided below (TOON format: the header "
    "`docs[N]{cols}:` names the columns, each following line is one item's values in "
    "that order; `type` is requirement/defect/test_plan/test_case). If the answer is "
    "not contained in these items, say so plainly. Put the keys you relied on ONLY in "
    "the `sources` array — do not list or repeat them inside the answer text.\n"
    'Return JSON only: {"answer": "string (concise, may use GitHub-flavored markdown)", "sources": [{"key": "REQ-x"}]}'
)


def build_doc_qa_prompt(
    docs: list[Any],
    question: str,
    history: Optional[list[dict[str, str]]] = None,
) -> str:
    """Project-wide Q&A prompt over mixed document types (requirements, defects,
    test plans, test cases). Each ``doc`` has ``type``, ``key``, ``title``,
    ``content``. Packs into one uniform TOON table within the prompt ceiling."""
    history_block = _qa_history_block(history)
    question_text = clean_ai_text(question, 2000)

    def assemble(current: list[Any]) -> str:
        rows = [
            {"key": d.key, "type": d.type, "title": clean_ai_text(d.title, 200), "content": d.content}
            for d in current
        ]
        table = encode_toon({"docs": rows}) if rows else "docs[0]:"
        return f"{_DOC_QA_INSTRUCTIONS}\n\n{history_block}{table}\n\nQuestion: {question_text}".strip()

    n = len(docs)
    if n == 0:
        return assemble([])

    fixed = len(_DOC_QA_INSTRUCTIONS) + len(history_block) + len(question_text) + 80
    available = max(0, QA_PROMPT_CHAR_CEILING - fixed - n * _DOC_ROW_OVERHEAD)
    per_doc = available // n

    # Build budget-limited shallow copies (don't mutate the retrieval objects).
    class _Row:
        __slots__ = ("type", "key", "title", "content")

        def __init__(self, d):
            self.type = d.type
            self.key = d.key
            self.title = d.title
            self.content = clean_ai_text(_plain_text(d.content), max(0, per_doc))

    rows = [_Row(d) for d in docs]
    prompt = assemble(rows)
    while len(prompt) > QA_PROMPT_CHAR_CEILING and len(rows) > 1:
        rows = rows[:-1]
        prompt = assemble(rows)
    if len(prompt) > QA_PROMPT_CHAR_CEILING:
        prompt = prompt[:QA_PROMPT_CHAR_CEILING]
    return prompt


_DOC_IMPACT_INSTRUCTIONS = (
    "You are a senior QA risk analyst. A documentation page is about to change. "
    "Using the change summary and the impacted project items below (TOON format: the "
    "header `items[N]{cols}:` names the columns, each following line is one item; "
    "`type` is requirement/test_case/defect, `reason` is linked or similar, and `via` "
    "names the requirement(s) a test/defect was reached through), assess the "
    "risk of publishing this change. Focus on requirements that may now be inaccurate, "
    "test cases that may need re-validation, and defects that the change could affect. "
    "Items with reason `similar` (or reached only `via` a similar requirement) are "
    "weaker, more speculative matches — weight them lower than directly `linked` items. "
    "Be specific and concise; do not invent items that are not listed.\n"
    'Return JSON only: {"summary": "string (1-3 sentences)", '
    '"recommendation": "publish|review|hold", '
    '"risks": [{"area": "requirements|tests|defects|general", '
    '"severity": "low|medium|high", "title": "string", "detail": "string", '
    '"mitigation": "string"}]}'
)


def build_doc_impact_prompt(
    doc_title: str,
    change_summary: dict[str, Any],
    impacted_items: list[dict[str, Any]],
) -> str:
    """Prompt for assessing the risk of publishing a doc change.

    ``impacted_items`` are the deterministically-derived rows (requirements, test
    cases, defects), each a flat dict with ``type``/``key``/``title``/``reason``
    (plus ``severity``/``status`` for defects). They are packed into one TOON
    table within :data:`QA_PROMPT_CHAR_CEILING`; least-important rows (callers
    pass them ordered) are dropped from the end until the prompt fits."""
    title = clean_ai_text(doc_title, 200)
    summary_lines = [f"Document: {title}", f"Change: {clean_ai_text(change_summary.get('note'), 300)}"]
    if change_summary.get("changed"):
        added = ", ".join(str(h) for h in (change_summary.get("headings_added") or [])[:15])
        removed = ", ".join(str(h) for h in (change_summary.get("headings_removed") or [])[:15])
        if added:
            summary_lines.append(f"Sections added: {added}")
        if removed:
            summary_lines.append(f"Sections removed: {removed}")
        summary_lines.append(f"Character delta: {int(change_summary.get('char_delta') or 0)}")
    summary_block = "\n".join(summary_lines)

    def _row(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": item.get("type") or "",
            "key": clean_ai_text(item.get("key"), 50),
            "title": clean_ai_text(item.get("title"), 200),
            "reason": item.get("reason") or "",
            "via": clean_ai_text(item.get("via"), 100),
            "severity": item.get("severity") or "",
            "status": item.get("status") or "",
        }

    def assemble(rows: list[dict[str, Any]]) -> str:
        table = encode_toon({"items": rows}) if rows else "items[0]:"
        return f"{_DOC_IMPACT_INSTRUCTIONS}\n\n{summary_block}\n\n{table}".strip()

    rows = [_row(item) for item in impacted_items]
    prompt = assemble(rows)
    while len(prompt) > QA_PROMPT_CHAR_CEILING and len(rows) > 1:
        rows = rows[:-1]
        prompt = assemble(rows)
    if len(prompt) > QA_PROMPT_CHAR_CEILING:
        prompt = prompt[:QA_PROMPT_CHAR_CEILING]
    return prompt


_DOC_CONVERT_ENHANCE_INSTRUCTIONS = (
    "You are a senior requirements engineer reviewing draft requirements that were "
    "mechanically extracted from a documentation page. Below are the drafts in TOON "
    "format (the header `items[N]{cols}:` names the columns; each following line is "
    "one draft: `index` is its stable id, `title` the heading, `description` the body "
    "text, `acceptance` any acceptance criteria already present).\n"
    "For EACH draft, judge it as a testable requirement and improve it:\n"
    "  - quality: integer 0-100 (clarity, atomicity, testability, completeness).\n"
    "  - issues: short phrases naming concrete defects (ambiguity, missing actor, "
    "un-testable wording, compound requirement, no measurable criteria).\n"
    "  - edge_cases: specific scenarios the draft omits (empty/invalid input, "
    "permissions, concurrency, limits, failure/timeout, localization, accessibility) "
    "— only ones genuinely relevant to this draft.\n"
    "  - suggested_title: a crisp, single-capability title (or the original if already good).\n"
    "  - suggested_description: a rewritten, unambiguous requirement statement in "
    "Markdown (use 'The system shall…' phrasing where natural). Keep the original "
    "intent; do not invent features.\n"
    "  - suggested_acceptance: testable acceptance criteria in Markdown using valid "
    "Gherkin only. Include a Scenario and Given/When/Then steps covering the happy "
    "path plus the edge cases above. Do not return bullet lists or prose here.\n"
    "Then, in `suggested_requirements`, propose NEW requirements for important "
    "capabilities the document overlooks entirely (e.g. error handling, security, "
    "auditing, performance) — each with a title, a Markdown description, Markdown "
    "acceptance criteria, and a one-line rationale. Propose at most 6, only when "
    "clearly warranted; return an empty list if the drafts are already comprehensive.\n"
    "Do not invent product features that contradict the source. Be specific and concise.\n"
    'Return JSON only: {"summary": "string (1-2 sentences on overall quality)", '
    '"items": [{"index": number, "quality": number, "issues": ["string"], '
    '"edge_cases": ["string"], "suggested_title": "string", '
    '"suggested_description": "markdown string", "suggested_acceptance": "gherkin markdown string"}], '
    '"suggested_requirements": [{"title": "string", "description": "markdown string", '
    '"acceptance": "gherkin markdown string", "rationale": "string"}]}'
)


def build_doc_convert_enhance_prompt(
    doc_title: str,
    mode: str,
    items: list[dict[str, Any]],
) -> str:
    """Prompt for the AI review of mechanically-extracted draft requirements.

    ``items`` are flat dicts with ``index``/``title``/``description``/``acceptance``
    (plain text). They are packed into one TOON table within
    :data:`QA_PROMPT_CHAR_CEILING`; the least-important drafts (callers pass them
    in document order) are dropped from the end until the prompt fits."""
    header = (
        f"Document: {clean_ai_text(doc_title, 200)}\n"
        f"Extraction mode: {'one requirement per section' if mode == 'split' else 'whole document as one requirement'}"
    )

    def _row(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "index": int(item.get("index") or 0),
            "title": clean_ai_text(item.get("title"), 200),
            "description": clean_ai_text(item.get("description"), 1600),
            "acceptance": clean_ai_text(item.get("acceptance"), 800),
        }

    def assemble(rows: list[dict[str, Any]]) -> str:
        table = encode_toon({"items": rows}) if rows else "items[0]:"
        return f"{_DOC_CONVERT_ENHANCE_INSTRUCTIONS}\n\n{header}\n\n{table}".strip()

    rows = [_row(item) for item in items]
    prompt = assemble(rows)
    while len(prompt) > QA_PROMPT_CHAR_CEILING and len(rows) > 1:
        rows = rows[:-1]
        prompt = assemble(rows)
    if len(prompt) > QA_PROMPT_CHAR_CEILING:
        prompt = prompt[:QA_PROMPT_CHAR_CEILING]
    return prompt


_RELEASE_NOTES_INSTRUCTIONS = (
    "You are a release manager writing the summary blurb for a software release. "
    "Below is the structured data (TOON format) for what changed in this release: "
    "updated documentation pages, requirements, fixed defects, still-open known "
    "issues, and test coverage. Write a concise, reader-facing summary that "
    "highlights the most important user-visible changes and notable fixes. Group "
    "thematically where natural. Do not invent items that are not listed; do not "
    "repeat the raw lists verbatim.\n"
    'Return JSON only: {"summary": "string (2-5 sentences, plain prose, no markdown headings)"}'
)


def build_release_notes_prompt(title: str, payload: dict[str, Any]) -> str:
    """Prompt for the AI-written release-notes summary blurb.

    ``payload`` is the compact dict from ``doc_release_notes_service.ai_payload``
    (changed docs, requirements, fixed/known defects, coverage). It is TOON-encoded
    and clamped to :data:`QA_PROMPT_CHAR_CEILING`."""
    header = f"Release: {clean_ai_text(title, 200)}\nPeriod: {payload.get('range_start')} to {payload.get('range_end')}"
    table = encode_toon(payload)
    prompt = f"{_RELEASE_NOTES_INSTRUCTIONS}\n\n{header}\n\n{table}".strip()
    if len(prompt) > QA_PROMPT_CHAR_CEILING:
        prompt = prompt[:QA_PROMPT_CHAR_CEILING]
    return prompt


# Operator internal name -> the symbol a user types in TQL (mirrors the
# front-end OP_SYMBOL map in AdvancedSearch.tsx). Used to render the field
# reference the NL→TQL builder model sees, so it only ever emits real operators.
_TQL_OP_SYMBOL = {
    "eq": "=",
    "ne": "!=",
    "gt": ">",
    "lt": "<",
    "gte": ">=",
    "lte": "<=",
    "contains": "~",
    "ncontains": "!~",
}

_TQL_BUILDER_INSTRUCTIONS = (
    "You are a query builder for TQL, a JQL-style filter language used by a test "
    "management tool's Advanced Search. Do two things with the user's plain-language "
    "request: (1) CHOOSE the single entity (from the list below) that best matches "
    "what the user is looking for, then (2) build ONE valid TQL expression for that "
    "entity using ONLY that entity's fields.\n"
    "TQL grammar:\n"
    "  - Conditions: FIELD OP VALUE, e.g. `status = OPEN`, `priority IN (HIGH, URGENT)`.\n"
    "  - Operators: `=` equals, `!=` not equals, `> < >= <=` ordered compare, "
    "`~` contains, `!~` not-contains, `IN (a, b)` / `NOT IN (a, b)` membership, "
    "`IS EMPTY` / `IS NOT EMPTY` for blank/non-blank.\n"
    "  - Combine with `AND`, `OR`, `NOT`, and parentheses for grouping.\n"
    "  - Functions: `currentUser()` for the signed-in user on user fields; `now()` and "
    "relative dates like `-7d`, `-30d`, `-12h`, `2w` on date fields.\n"
    "  - Dates: write absolute dates as full ISO `YYYY-MM-DD` (e.g. `updated > 2026-06-09`) "
    "— always include a 4-digit year. Resolve relative or partial dates ('last week', "
    "'since June 9', 'yesterday') against the CURRENT DATE given below: a day/month with "
    "no year means the current year, and 'last N days/weeks' is best written as a relative "
    "offset like `-7d`. Never output a date without a year, and never guess a past year.\n"
    "  - Optional trailing `ORDER BY field [ASC|DESC]`.\n"
    "  - Quote text values that contain spaces with double quotes, e.g. `summary ~ \"login page\"`.\n"
    "  - Use ONLY field names listed for the chosen entity and, for enum/keyword fields, "
    "ONLY their listed choices. Never invent an entity, field, or value.\n"
    "  - An empty request, a greeting, or a request that cannot be expressed with any "
    "listed entity's fields: still pick the most plausible entity, return an empty tql "
    "string, and say why in the explanation.\n"
    "  - A request with no filter conditions (e.g. \"show all defects\") is valid: pick "
    "the entity and return an empty tql (which matches everything), noting that.\n"
    'Return JSON only: {"entity": "the chosen entity key (exactly as listed)", '
    '"tql": "string (the TQL expression, or empty)", '
    '"explanation": "string (one short sentence: which entity and what the query matches)"}'
)


def _tql_field_lines(fields: list[dict[str, Any]]) -> str:
    """Render one entity's field catalog as model-readable lines (name, kind,
    operator symbols, and enum/keyword choices)."""
    lines: list[str] = []
    for field in fields:
        ops = " ".join(
            _TQL_OP_SYMBOL.get(op, op) for op in field.get("operators", [])
        )
        # Word operators valid on any field; surface them so the model knows them.
        extras = "IN NOT IN IS EMPTY IS NOT EMPTY"
        detail = f"- {field.get('name')} ({field.get('kind')}): {ops} {extras}".rstrip()
        choices = field.get("choices") or []
        if choices:
            detail += f" · values: {', '.join(str(c) for c in choices)}"
        if field.get("kind") == "user":
            detail += " · accepts currentUser() or a user id"
        elif field.get("kind") == "date":
            detail += " · accepts now(), ISO date, or relative (-7d)"
        lines.append(detail)
    return "\n".join(lines) if lines else "(no fields available)"


def build_tql_builder_prompt(
    entities: list[dict[str, Any]],
    question: str,
    current_datetime: Optional[Any] = None,
) -> str:
    """Prompt for translating a natural-language request into an entity + TQL query.

    ``entities`` is a list of ``{key, label, fields}`` dicts (``fields`` are
    field-catalog dicts from :func:`app.services.tql.field_catalog`). The model is
    asked to first pick the best-matching entity from this list, then build a query
    using only that entity's fields — so the result is always scoped to a real,
    enabled entity and can only reference fields that exist on it.

    ``current_datetime`` (a ``datetime``; defaults to now, UTC) is surfaced so the
    model can resolve relative/partial dates ('last week', 'since June 9') to a
    concrete year instead of guessing one."""
    from datetime import datetime, timezone

    now = current_datetime or datetime.now(timezone.utc)
    try:
        now_label = now.strftime("%Y-%m-%d (%A)")
    except Exception:  # pragma: no cover - defensive: any non-datetime falls back
        now_label = str(now)

    blocks: list[str] = []
    for ent in entities:
        key = ent.get("key", "")
        label = ent.get("label") or key
        blocks.append(f"Entity `{key}` ({label}):\n{_tql_field_lines(ent.get('fields') or [])}")
    entity_block = "\n\n".join(blocks) if blocks else "(no entities available)"
    question_text = clean_ai_text(question, 1000)
    return (
        f"{_TQL_BUILDER_INSTRUCTIONS}\n\n"
        f"Current date: {now_label}\n\n"
        f"Entities you may query:\n{entity_block}\n\n"
        f"Request: {question_text}"
    ).strip()


def build_test_case_context(test_case: Any, steps: list[Any]) -> str:
    step_text = "\n".join(
        f"{step.step_number}. {step.action} => {step.expected_result}"
        for step in steps
    )
    return f"""
Title: {test_case.title}
Description: {strip_html(test_case.description)}
Preconditions: {strip_html(test_case.preconditions)}
Steps: {strip_html(test_case.steps) or step_text}
Expected result: {strip_html(test_case.expected_result)}
Priority: {test_case.priority}
Type: {test_case.test_type}
Tags: {test_case.tags or ""}
Reference: {test_case.reference or ""}
""".strip()


def build_test_case_draft_context(payload: Any) -> str:
    step_text = "\n".join(
        f"{step.step_number}. {step.action} => {step.expected_result}"
        for step in payload.test_steps
    )
    return f"""
Title: {payload.title}
Description: {strip_html(payload.description)}
Preconditions: {strip_html(payload.preconditions)}
Steps: {strip_html(payload.steps) or step_text}
Expected result: {strip_html(payload.expected_result)}
Priority: {payload.priority}
Type: {payload.test_type}
Tags: {payload.tags or ""}
Reference: {payload.reference or ""}
""".strip()


def build_test_case_assistant_prompt(action: str, context: str, instructions: Optional[str]) -> str:
    action_guidance = {
        "suggest_steps": "Return improved test_steps and a short warnings list.",
        "improve_expected_result": (
            "Return a precise expected_result and a short warnings list. If the test case "
            "has multiple steps, ALSO return step_expected_results: a list of "
            "{step_number, expected_result} improving the expected result of each step "
            "(keep the same step_number values)."
        ),
        "add_negative_cases": "Return 2-4 negative or edge-case drafts in drafts.",
        "convert_to_gherkin": "Return gherkin text using Feature/Scenario/Given/When/Then.",
        "split_broad_case": "Return 2-5 smaller focused drafts in drafts.",
    }[action]
    return f"""
You are a senior QA test designer. Work on the test case below.
Action: {action}
Task: {action_guidance}
Return only valid JSON with any relevant keys from this schema:
{{
  "drafts": [{{"title":"string","description":"string","preconditions":"string","steps":"string","expected_result":"string","priority":"low|medium|high|critical","test_type":"manual","tags":"string","confidence":0.0,"test_steps":[{{"step_number":1,"action":"string","expected_result":"string","step_type":"manual"}}]}}],
  "steps": [{{"step_number":1,"action":"string","expected_result":"string","step_type":"manual"}}],
  "expected_result": "string",
  "step_expected_results": [{{"step_number":1,"expected_result":"string"}}],
  "gherkin": "string",
  "warnings": ["string"]
}}

Test case:
{context}
Additional instructions: {instructions or "None"}
""".strip()
