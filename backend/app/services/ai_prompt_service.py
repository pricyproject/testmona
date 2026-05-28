"""
Reusable AI prompt and response parsing helpers.
"""

import html
import json
import re
from typing import Any, Optional


def clean_ai_text(value: Any, max_length: int = 4000) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False)
    text = html.unescape(str(value)).replace("\x00", "").strip()
    text = re.sub(r"\s+\n", "\n", text)
    return text[:max_length].strip()


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
    return json.loads(cleaned[start : end + 1])


def build_requirement_test_case_prompt(requirement: Any, count: int, instructions: Optional[str]) -> str:
    return f"""
You are a senior QA test designer. Generate exactly {count} review-ready manual test case drafts for this requirement.
Return only valid JSON using this schema:
{{
  "drafts": [
    {{
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
        {{"step_number": 1, "action": "string", "expected_result": "string", "step_type": "manual"}}
      ]
    }}
  ],
  "warnings": ["string"]
}}

Requirement key: {requirement.requirement_id}
Title: {requirement.title}
Priority: {getattr(requirement.priority, "value", requirement.priority)}
Status: {getattr(requirement.status, "value", requirement.status)}
Description: {strip_html(requirement.description)}
Acceptance criteria: {strip_html(requirement.acceptance_criteria)}
Tags: {requirement.tags or ""}
Additional instructions: {instructions or "None"}
""".strip()


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
        "improve_expected_result": "Return a precise expected_result and a short warnings list.",
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
  "gherkin": "string",
  "warnings": ["string"]
}}

Test case:
{context}
Additional instructions: {instructions or "None"}
""".strip()
