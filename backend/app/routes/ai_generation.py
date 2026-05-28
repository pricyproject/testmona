"""
AI-assisted requirement and test case draft generation routes.
"""

import logging
from typing import Any, List, Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import crud, schemas, rbac
from ..auth import get_current_active_user
from ..database import get_db
from ..services.ai_manager import AICompletionRequest, generate_ai_completion
from ..services.ai_prompt_service import (
    build_requirement_test_case_prompt,
    build_test_case_assistant_prompt,
    build_test_case_context,
    build_test_case_draft_context,
    clean_ai_text,
    extract_json_object,
)

logger = logging.getLogger(__name__)


class AIDraftStep(BaseModel):
    step_number: int = Field(..., ge=1, le=100)
    action: str = Field(..., min_length=1, max_length=2000)
    expected_result: str = Field(..., min_length=1, max_length=2000)
    step_type: str = Field(default="manual", max_length=20)

    @field_validator("action", "expected_result", "step_type", mode="before")
    @classmethod
    def normalize_step_text(cls, value: Any) -> str:
        return _clean_text(value, max_length=2000)


class AIDraftTestCase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=4000)
    preconditions: str = Field(default="No preconditions defined", max_length=4000)
    steps: str = Field(default="", max_length=8000)
    expected_result: str = Field(default="", max_length=4000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    test_type: str = Field(default="manual", max_length=40)
    tags: str = Field(default="", max_length=500)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    test_steps: List[AIDraftStep] = Field(default_factory=list, max_length=30)

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: Any) -> str:
        return _clean_text(value, max_length=255) or "Generated test case"

    @field_validator("description", "preconditions", "steps", "expected_result", "test_type", "tags", mode="before")
    @classmethod
    def normalize_text_fields(cls, value: Any) -> str:
        return _clean_text(value)

    @field_validator("priority", mode="before")
    @classmethod
    def normalize_priority(cls, value: Any) -> str:
        raw = str(value or "medium").strip().lower()
        aliases = {
            "urgent": "critical",
            "blocker": "critical",
            "p0": "critical",
            "major": "high",
            "p1": "high",
            "normal": "medium",
            "med": "medium",
            "p2": "medium",
            "minor": "low",
            "trivial": "low",
            "p3": "low",
        }
        normalized = aliases.get(raw, raw)
        return normalized if normalized in {"low", "medium", "high", "critical"} else "medium"


class RequirementTestCaseGenerationRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=10)
    instructions: Optional[str] = Field(default=None, max_length=2000)


class RequirementTestCaseGenerationResponse(BaseModel):
    requirement_id: int
    provider: str
    model: str
    drafts: List[AIDraftTestCase]
    warnings: List[str] = Field(default_factory=list)


class TestCaseAssistantRequest(BaseModel):
    action: Literal[
        "suggest_steps",
        "improve_expected_result",
        "add_negative_cases",
        "convert_to_gherkin",
        "split_broad_case",
    ]
    instructions: Optional[str] = Field(default=None, max_length=2000)


class TestCaseDraftAssistantRequest(TestCaseAssistantRequest):
    project_id: int = Field(..., gt=0)
    title: str = Field(default="", max_length=255)
    description: Optional[str] = Field(default="", max_length=4000)
    preconditions: Optional[str] = Field(default="", max_length=4000)
    steps: Optional[str] = Field(default="", max_length=8000)
    expected_result: Optional[str] = Field(default="", max_length=4000)
    priority: str = Field(default="medium", max_length=20)
    test_type: str = Field(default="manual", max_length=40)
    tags: Optional[str] = Field(default="", max_length=500)
    reference: Optional[str] = Field(default="", max_length=255)
    test_steps: List[AIDraftStep] = Field(default_factory=list, max_length=30)


class TestCaseAssistantResponse(BaseModel):
    provider: str
    model: str
    action: str
    drafts: List[AIDraftTestCase] = Field(default_factory=list)
    steps: List[AIDraftStep] = Field(default_factory=list)
    expected_result: Optional[str] = None
    gherkin: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


def _clean_text(value: Any, max_length: int = 4000) -> str:
    return clean_ai_text(value, max_length=max_length)


def _extract_json_object(raw: str) -> dict[str, Any]:
    return extract_json_object(raw)


def _normalize_drafts(raw_drafts: Any) -> List[AIDraftTestCase]:
    if not isinstance(raw_drafts, list):
        return []
    drafts: List[AIDraftTestCase] = []
    for index, item in enumerate(raw_drafts[:10], start=1):
        if not isinstance(item, dict):
            continue
        steps = item.get("test_steps") or []
        if not isinstance(steps, list):
            steps = []
        item["test_steps"] = [
            {
                "step_number": step.get("step_number") or step_index,
                "action": step.get("action") or step.get("step") or "",
                "expected_result": step.get("expected_result") or step.get("expected") or "",
                "step_type": step.get("step_type") or "manual",
            }
            for step_index, step in enumerate(steps[:30], start=1)
            if isinstance(step, dict) and (step.get("action") or step.get("step"))
        ]
        steps = item["test_steps"]
        if steps and not item.get("steps"):
            item["steps"] = "\n".join(
                f"{step.get('step_number', step_index)}. {step.get('action', '')}"
                for step_index, step in enumerate(steps, start=1)
                if isinstance(step, dict)
            )
        if steps and not item.get("expected_result"):
            item["expected_result"] = steps[-1].get("expected_result", "") if isinstance(steps[-1], dict) else ""
        item.setdefault("title", f"Generated test case {index}")
        item.setdefault("priority", "medium")
        item.setdefault("test_type", "manual")
        item.setdefault("preconditions", "No preconditions defined")
        item["title"] = _clean_text(item.get("title"), 255) or f"Generated test case {index}"
        item["description"] = _clean_text(item.get("description"), 4000)
        item["preconditions"] = _clean_text(item.get("preconditions"), 4000) or "No preconditions defined"
        item["steps"] = _clean_text(item.get("steps"), 8000)
        item["expected_result"] = _clean_text(item.get("expected_result"), 4000)
        item["test_type"] = _clean_text(item.get("test_type"), 40) or "manual"
        item["tags"] = _clean_text(item.get("tags"), 500)
        try:
            drafts.append(AIDraftTestCase(**item))
        except Exception as exc:
            logger.warning("Skipping malformed AI draft %s: %s", index, exc)
    return drafts


def _assistant_response_from_parsed(result: Any, action: str, parsed: dict[str, Any]) -> TestCaseAssistantResponse:
    raw_drafts = parsed.get("drafts")
    drafts = _normalize_drafts(raw_drafts)
    response_steps: List[AIDraftStep] = []
    raw_steps = parsed.get("steps")
    raw_steps_list = raw_steps if isinstance(raw_steps, list) else []
    for index, step in enumerate(raw_steps_list[:30], start=1):
        if not isinstance(step, dict):
            continue
        try:
            response_steps.append(AIDraftStep(
                step_number=step.get("step_number") or index,
                action=step.get("action") or step.get("step") or "",
                expected_result=step.get("expected_result") or step.get("expected") or "",
                step_type=step.get("step_type") or "manual",
            ))
        except Exception as exc:
            logger.warning("Skipping malformed AI step %s: %s", index, exc)
    warnings = [str(item) for item in parsed.get("warnings", []) if item]
    if isinstance(raw_drafts, list) and len(drafts) < len(raw_drafts):
        warnings.append("Some AI draft items were ignored because they were incomplete or malformed.")
    if isinstance(raw_steps, list) and len(response_steps) < min(len(raw_steps), 30):
        warnings.append("Some AI steps were ignored because they were incomplete or malformed.")
    if not drafts and not response_steps and not parsed.get("expected_result") and not parsed.get("gherkin"):
        warnings.append("AI returned no applicable draft content. Try again with more specific instructions.")
    return TestCaseAssistantResponse(
        provider=result.provider,
        model=result.model,
        action=action,
        drafts=drafts,
        steps=response_steps,
        expected_result=parsed.get("expected_result") if isinstance(parsed.get("expected_result"), str) else None,
        gherkin=parsed.get("gherkin") if isinstance(parsed.get("gherkin"), str) else None,
        warnings=warnings,
    )


def _audit_ai_generation(
    db: Session,
    current_user: schemas.User,
    project_id: int,
    entity_type: Any,
    entity_id: Optional[int],
    description: str,
) -> None:
    try:
        from ..models import AuditAction
        from ..schemas_audit import AuditTrailCreate
        from ..services.audit_service import get_audit_service

        get_audit_service(db).create_audit_trail(
            AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.CREATE.value,
                entity_type=entity_type.value if hasattr(entity_type, "value") else entity_type,
                entity_id=entity_id,
                project_id=project_id,
                description=description,
            )
        )
    except Exception as exc:
        logger.exception("Failed to audit AI generation event: %s", exc)


def register_ai_generation_routes(app):
    """Register AI generation routes with the FastAPI app."""

    @app.post("/requirements/{requirement_id}/ai/test-cases", response_model=RequirementTestCaseGenerationResponse)
    async def generate_requirement_test_cases(
        requirement_id: int,
        payload: RequirementTestCaseGenerationRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        requirement = crud.get_requirement(db, requirement_id)
        if not requirement:
            raise HTTPException(status_code=404, detail="Requirement not found")
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        result = await generate_ai_completion(
            db,
            AICompletionRequest(
                prompt=build_requirement_test_case_prompt(requirement, payload.count, payload.instructions),
                max_tokens=3000,
                temperature=0.2,
                timeout_seconds=180,
            ),
            operation="requirement_test_case_generation",
            project_id=requirement.project_id,
            user_id=current_user.id,
            entity_type="requirement",
            entity_id=requirement.id,
        )
        try:
            parsed = _extract_json_object(result.content)
            raw_drafts = parsed.get("drafts")
            drafts = _normalize_drafts(raw_drafts)
            warnings = [str(item) for item in parsed.get("warnings", []) if item]
            if isinstance(raw_drafts, list) and len(drafts) < len(raw_drafts):
                warnings.append("Some AI draft items were ignored because they were incomplete or malformed.")
        except Exception as exc:
            logger.warning("Failed to parse AI requirement generation response: %s", exc)
            raise HTTPException(status_code=502, detail="AI response could not be parsed into test case drafts") from exc
        if not drafts:
            raise HTTPException(status_code=502, detail="AI did not return any test case drafts")
        from ..models import EntityType
        _audit_ai_generation(
            db,
            current_user,
            requirement.project_id,
            EntityType.REQUIREMENT,
            requirement.id,
            f"AI generated {len(drafts)} test case draft(s) for requirement {requirement.requirement_id}",
        )
        return RequirementTestCaseGenerationResponse(
            requirement_id=requirement.id,
            provider=result.provider,
            model=result.model,
            drafts=drafts,
            warnings=warnings,
        )

    @app.post("/test-cases/{test_case_id}/ai/assist", response_model=TestCaseAssistantResponse)
    async def assist_test_case(
        test_case_id: int,
        payload: TestCaseAssistantRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_case = crud.get_test_case(db, test_case_id)
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")
        project_id = test_case.project_id
        if not project_id or not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        steps = crud.get_test_case_steps(db, test_case_id)
        result = await generate_ai_completion(
            db,
            AICompletionRequest(
                prompt=build_test_case_assistant_prompt(
                    payload.action,
                    build_test_case_context(test_case, steps),
                    payload.instructions,
                ),
                max_tokens=3000,
                temperature=0.2,
            ),
            operation=f"test_case_assistant_{payload.action}",
            project_id=project_id,
            user_id=current_user.id,
            entity_type="test_case",
            entity_id=test_case.id,
        )
        try:
            parsed = _extract_json_object(result.content)
        except Exception as exc:
            logger.warning("Failed to parse AI test case assistant response: %s", exc)
            raise HTTPException(status_code=502, detail="AI response could not be parsed into a test case draft") from exc
        from ..models import EntityType
        _audit_ai_generation(
            db,
            current_user,
            project_id,
            EntityType.TEST_CASE,
            test_case.id,
            f"AI assistant action '{payload.action}' generated draft output for test case {test_case.id}",
        )
        return _assistant_response_from_parsed(result, payload.action, parsed)

    @app.post("/test-cases/ai/assist", response_model=TestCaseAssistantResponse)
    async def assist_test_case_draft(
        payload: TestCaseDraftAssistantRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "write", payload.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        result = await generate_ai_completion(
            db,
            AICompletionRequest(
                prompt=build_test_case_assistant_prompt(
                    payload.action,
                    build_test_case_draft_context(payload),
                    payload.instructions,
                ),
                max_tokens=3000,
                temperature=0.2,
            ),
            operation=f"test_case_draft_assistant_{payload.action}",
            project_id=payload.project_id,
            user_id=current_user.id,
            entity_type="test_case_draft",
        )
        try:
            parsed = _extract_json_object(result.content)
        except Exception as exc:
            logger.warning("Failed to parse AI test case draft assistant response: %s", exc)
            raise HTTPException(status_code=502, detail="AI response could not be parsed into a test case draft") from exc
        from ..models import EntityType
        _audit_ai_generation(
            db,
            current_user,
            payload.project_id,
            EntityType.PROJECT,
            payload.project_id,
            f"AI assistant action '{payload.action}' generated output for a new test case draft",
        )
        return _assistant_response_from_parsed(result, payload.action, parsed)
