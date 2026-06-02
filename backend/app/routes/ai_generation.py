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
from ..services.ai_manager import (
    AICompletionRequest,
    generate_ai_completion,
    get_compact_payload_default,
    get_test_case_generation_settings,
)
from ..services.ai_prompt_service import (
    build_requirement_test_case_prompt,
    build_test_case_assistant_prompt,
    build_test_case_context,
    build_test_case_draft_context,
    clean_ai_text,
    clean_gherkin,
    extract_json_object,
)
from ..services.similarity_service import (
    MAX_EXISTING_SCAN,
    MAX_MATCHES_PER_DRAFT,
    DUPLICATE_THRESHOLD,
    SIMILAR_THRESHOLD,
    TestCaseSignature,
    build_signature,
    score_signatures,
    status_for_score,
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
    # All optional: when omitted, defaults come from AI Manager settings.
    count: Optional[int] = Field(default=None, ge=1, le=20)
    instructions: Optional[str] = Field(default=None, max_length=2000)
    payload_format: Optional[Literal["text", "toon"]] = None


class RequirementTestCaseGenerationResponse(BaseModel):
    requirement_id: int
    provider: str
    model: str
    drafts: List[AIDraftTestCase]
    warnings: List[str] = Field(default_factory=list)
    prompt_tokens: int = 0


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


class AIStepExpectedResult(BaseModel):
    step_number: int = Field(..., ge=1, le=100)
    expected_result: str = Field(..., min_length=1, max_length=2000)

    @field_validator("expected_result", mode="before")
    @classmethod
    def normalize_expected_result(cls, value: Any) -> str:
        return _clean_text(value, max_length=2000)


class TestCaseAssistantResponse(BaseModel):
    provider: str
    model: str
    action: str
    drafts: List[AIDraftTestCase] = Field(default_factory=list)
    steps: List[AIDraftStep] = Field(default_factory=list)
    expected_result: Optional[str] = None
    step_expected_results: List[AIStepExpectedResult] = Field(default_factory=list)
    gherkin: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class DuplicateCheckDraftStep(BaseModel):
    action: str = Field(default="", max_length=2000)
    expected_result: str = Field(default="", max_length=2000)

    @field_validator("action", "expected_result", mode="before")
    @classmethod
    def normalize_step_text(cls, value: Any) -> str:
        return _clean_text(value, max_length=2000)


class DuplicateCheckDraft(BaseModel):
    index: int = Field(..., ge=0, le=1000)
    title: str = Field(default="", max_length=255)
    description: str = Field(default="", max_length=4000)
    preconditions: str = Field(default="", max_length=4000)
    steps: str = Field(default="", max_length=8000)
    expected_result: str = Field(default="", max_length=4000)
    test_steps: List[DuplicateCheckDraftStep] = Field(default_factory=list, max_length=30)


class DuplicateCheckRequest(BaseModel):
    test_suite_id: int = Field(..., gt=0)
    section_id: Optional[int] = Field(default=None, gt=0)
    # "section" restricts the comparison to the target section; "suite" scans the
    # whole suite so a draft that already exists anywhere in the suite is caught.
    scope: Literal["section", "suite"] = "suite"
    drafts: List[DuplicateCheckDraft] = Field(default_factory=list, max_length=10)


class DuplicateMatch(BaseModel):
    # "existing" => an already-persisted test case; "draft" => another draft in
    # the same batch (internal duplicate).
    kind: Literal["existing", "draft"]
    score: float
    title_score: float
    body_score: float
    status: str
    title: str
    test_case_id: Optional[int] = None
    reference: Optional[str] = None
    section_name: Optional[str] = None
    in_target_section: bool = False
    draft_index: Optional[int] = None


class DuplicateCheckFinding(BaseModel):
    index: int
    status: str
    score: float
    matches: List[DuplicateMatch] = Field(default_factory=list)


class DuplicateCheckResponse(BaseModel):
    findings: List[DuplicateCheckFinding]
    duplicate_count: int = 0
    similar_count: int = 0
    existing_compared: int = 0
    existing_truncated: bool = False
    scope: str = "suite"
    thresholds: dict = Field(default_factory=dict)


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
    step_expected_results: List[AIStepExpectedResult] = []
    raw_step_expected = parsed.get("step_expected_results")
    if isinstance(raw_step_expected, list):
        for index, item in enumerate(raw_step_expected[:100], start=1):
            if not isinstance(item, dict):
                continue
            expected = item.get("expected_result") or item.get("expected")
            if not expected:
                continue
            try:
                step_expected_results.append(AIStepExpectedResult(
                    step_number=item.get("step_number") or index,
                    expected_result=expected,
                ))
            except Exception as exc:
                logger.warning("Skipping malformed AI step expected result %s: %s", index, exc)
    warnings = [str(item) for item in parsed.get("warnings", []) if item]
    if isinstance(raw_drafts, list) and len(drafts) < len(raw_drafts):
        warnings.append("Some AI draft items were ignored because they were incomplete or malformed.")
    if isinstance(raw_steps, list) and len(response_steps) < min(len(raw_steps), 30):
        warnings.append("Some AI steps were ignored because they were incomplete or malformed.")
    if not drafts and not response_steps and not step_expected_results and not parsed.get("expected_result") and not parsed.get("gherkin"):
        warnings.append("AI returned no applicable draft content. Try again with more specific instructions.")
    return TestCaseAssistantResponse(
        provider=result.provider,
        model=result.model,
        action=action,
        drafts=drafts,
        steps=response_steps,
        expected_result=parsed.get("expected_result") if isinstance(parsed.get("expected_result"), str) else None,
        step_expected_results=step_expected_results,
        gherkin=(clean_gherkin(parsed.get("gherkin")) or None) if isinstance(parsed.get("gherkin"), str) else None,
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


class _ExistingCase:
    """Lightweight holder for an existing test case used in similarity checks."""

    __slots__ = ("id", "title", "section_id", "section_name", "signature")

    def __init__(self, id: int, title: str, section_id: Optional[int], section_name: Optional[str], signature: TestCaseSignature):
        self.id = id
        self.title = title
        self.section_id = section_id
        self.section_name = section_name
        self.signature = signature


def _load_existing_cases(
    db: Session,
    test_suite_id: int,
    target_section_id: Optional[int],
    scope: str,
) -> tuple[List[_ExistingCase], bool]:
    """Load existing (non-deleted) test cases to compare against.

    Returns ``(cases, truncated)`` where ``truncated`` is True when the suite has
    more cases than the scan cap. Steps are bulk-loaded in a single query so the
    body signature reflects multi-step cases whose legacy ``steps`` text is empty.
    """
    from ..models import TestCase, TestCaseSection, TestCaseStep

    query = (
        db.query(TestCase)
        .filter(
            TestCase.test_suite_id == test_suite_id,
            ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))),
        )
    )
    if scope == "section":
        # Compare only within the target section (None matches the "no section" bucket).
        query = query.filter(TestCase.section_id.is_(target_section_id) if target_section_id is None
                             else TestCase.section_id == target_section_id)

    rows = query.order_by(TestCase.id.desc()).limit(MAX_EXISTING_SCAN + 1).all()
    truncated = len(rows) > MAX_EXISTING_SCAN
    rows = rows[:MAX_EXISTING_SCAN]
    if not rows:
        return [], truncated

    case_ids = [row.id for row in rows]
    steps_by_case: dict[int, List[str]] = {}
    step_rows = (
        db.query(TestCaseStep.test_case_id, TestCaseStep.action, TestCaseStep.expected_result)
        .filter(TestCaseStep.test_case_id.in_(case_ids))
        .order_by(TestCaseStep.test_case_id, TestCaseStep.step_number)
        .all()
    )
    for case_id, action, expected in step_rows:
        bucket = steps_by_case.setdefault(case_id, [])
        if action:
            bucket.append(action)
        if expected:
            bucket.append(expected)

    section_names: dict[int, str] = {}
    section_ids = {row.section_id for row in rows if row.section_id is not None}
    if section_ids:
        for section_id, name in (
            db.query(TestCaseSection.id, TestCaseSection.name)
            .filter(TestCaseSection.id.in_(section_ids))
            .all()
        ):
            section_names[section_id] = name

    cases: List[_ExistingCase] = []
    for row in rows:
        signature = build_signature(
            title=row.title,
            description=row.description,
            preconditions=row.preconditions,
            steps=row.steps,
            expected_result=row.expected_result,
            step_lines=steps_by_case.get(row.id),
        )
        if signature.is_empty:
            continue
        cases.append(_ExistingCase(
            id=row.id,
            title=row.title or "",
            section_id=row.section_id,
            section_name=section_names.get(row.section_id) if row.section_id else None,
            signature=signature,
        ))
    return cases, truncated


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

        # Resolve defaults from AI Manager settings when the client omits them.
        gen_settings = get_test_case_generation_settings(db)
        count = payload.count or gen_settings["default_count"]
        if payload.payload_format is not None:
            use_toon = payload.payload_format == "toon"
        else:
            use_toon = get_compact_payload_default(db)

        result = await generate_ai_completion(
            db,
            AICompletionRequest(
                prompt=build_requirement_test_case_prompt(
                    requirement,
                    count,
                    payload.instructions,
                    use_toon=use_toon,
                ),
                max_tokens=gen_settings["max_tokens"],
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
            prompt_tokens=result.prompt_tokens,
        )

    @app.post(
        "/requirements/{requirement_id}/ai/test-cases/duplicate-check",
        response_model=DuplicateCheckResponse,
    )
    def check_requirement_test_case_duplicates(
        requirement_id: int,
        payload: DuplicateCheckRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Flag drafts that duplicate an existing case or another draft in the batch.

        Compares each candidate draft against existing test cases in the target
        suite/section and against earlier drafts, returning the strongest matches
        and an overall status (unique / similar / duplicate) per draft. This runs
        entirely on stored data — it does not call the AI provider.
        """
        requirement = crud.get_requirement(db, requirement_id)
        if not requirement:
            raise HTTPException(status_code=404, detail="Requirement not found")
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_suite = crud.get_test_suite(db, test_suite_id=payload.test_suite_id)
        if not test_suite or test_suite.project_id != requirement.project_id:
            raise HTTPException(status_code=400, detail="Test suite must belong to this requirement project")

        if payload.section_id is not None:
            section = crud.get_test_case_section(db, payload.section_id)
            if not section or section.test_suite_id != test_suite.id:
                raise HTTPException(status_code=400, detail="Section must belong to the selected test suite")

        existing_cases, truncated = _load_existing_cases(
            db, test_suite.id, payload.section_id, payload.scope
        )

        findings: List[DuplicateCheckFinding] = []
        # Signatures of drafts already processed, so later drafts can be compared
        # against earlier ones in the same batch (internal duplicates).
        prior_drafts: List[tuple[int, str, TestCaseSignature]] = []
        duplicate_count = 0
        similar_count = 0

        for draft in payload.drafts:
            candidate = build_signature(
                title=draft.title,
                description=draft.description,
                preconditions=draft.preconditions,
                steps=draft.steps,
                expected_result=draft.expected_result,
                step_lines=[
                    f"{step.action} {step.expected_result}".strip()
                    for step in draft.test_steps
                    if step.action or step.expected_result
                ],
            )
            matches: List[DuplicateMatch] = []

            if not candidate.is_empty:
                for existing in existing_cases:
                    overall, title_score, body_score = score_signatures(candidate, existing.signature)
                    if overall < SIMILAR_THRESHOLD:
                        continue
                    matches.append(DuplicateMatch(
                        kind="existing",
                        score=overall,
                        title_score=title_score,
                        body_score=body_score,
                        status=status_for_score(overall),
                        title=existing.title,
                        test_case_id=existing.id,
                        reference=f"TC-{existing.id:03d}",
                        section_name=existing.section_name,
                        in_target_section=existing.section_id == payload.section_id,
                    ))

                for prior_index, prior_title, prior_signature in prior_drafts:
                    overall, title_score, body_score = score_signatures(candidate, prior_signature)
                    if overall < SIMILAR_THRESHOLD:
                        continue
                    matches.append(DuplicateMatch(
                        kind="draft",
                        score=overall,
                        title_score=title_score,
                        body_score=body_score,
                        status=status_for_score(overall),
                        title=prior_title,
                        draft_index=prior_index,
                    ))

            matches.sort(key=lambda match: match.score, reverse=True)
            best_score = matches[0].score if matches else 0.0
            status = status_for_score(best_score)
            if status == "duplicate":
                duplicate_count += 1
            elif status == "similar":
                similar_count += 1

            findings.append(DuplicateCheckFinding(
                index=draft.index,
                status=status,
                score=best_score,
                matches=matches[:MAX_MATCHES_PER_DRAFT],
            ))

            if not candidate.is_empty:
                prior_drafts.append((draft.index, draft.title or "", candidate))

        return DuplicateCheckResponse(
            findings=findings,
            duplicate_count=duplicate_count,
            similar_count=similar_count,
            existing_compared=len(existing_cases),
            existing_truncated=truncated,
            scope=payload.scope,
            thresholds={
                "duplicate": DUPLICATE_THRESHOLD,
                "similar": SIMILAR_THRESHOLD,
            },
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
