"""
Project-wide AI chat over a project's requirements.

Lets users ask questions across all requirements in a project. Each question
lexically retrieves the most relevant requirements, packs them into a TOON
table within the completion prompt budget, and returns a cited answer.
Conversations and their turns are persisted.
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas, rbac
from ..auth import get_current_active_user
from ..database import get_db
from ..models import EntityType
from ..services.ai_manager import (
    AICompletionRequest,
    generate_ai_completion,
    get_requirement_chat_settings,
)
from ..services.ai_prompt_service import build_doc_qa_prompt, clean_ai_text, extract_json_object
from ..services.requirement_retrieval import retrieve_relevant_docs

logger = logging.getLogger(__name__)


def _require_project_permission(current_user, project_id: int, db: Session, permission: str) -> None:
    # 404 before 403 only when the project truly doesn't exist, so an admin
    # can't create a conversation against a missing project (FK violation).
    if crud.get_project(db, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not rbac.has_permission(current_user, permission, project_id, db):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _require_project_read(current_user, project_id: int, db: Session) -> None:
    _require_project_permission(current_user, project_id, db, "read")


def _conversation_or_404(db: Session, conversation_id: int, project_id: int, current_user):
    # Conversations are private to their creator. A wrong project, or another
    # user's conversation, both 404 (don't leak existence to non-owners).
    conversation = crud.get_chat_conversation(db, conversation_id)
    if (
        not conversation
        or conversation.project_id != project_id
        or conversation.created_by != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _normalize_public_id(public_id: str) -> str:
    try:
        return UUID(public_id).hex
    except (AttributeError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc


_EMPTY_SCOPE_ANSWER = (
    "There's nothing in the selected sources for this project yet, so there's "
    "nothing to answer questions about. Add some content (or broaden the source "
    "scope in AI Manager settings), then ask again."
)


def _effective_source_types(requested, enabled: list) -> list:
    """Intersect a user's requested scopes with the admin-enabled set so a
    request can only narrow the scope, never broaden it. Falls back to all
    enabled scopes when nothing valid is requested."""
    if not requested:
        return enabled
    narrowed = [t for t in requested if t in enabled]
    return narrowed or enabled


async def _produce_answer(db: Session, project_id: int, current_user, question: str,
                          prior_messages: list, chat_settings: dict,
                          source_types: Optional[list] = None) -> dict:
    """Run retrieval + completion for ``question`` given prior conversation
    turns. Returns answer text, typed sources, prompt tokens, and retrieval
    stats. Shared by the ask and regenerate endpoints. Persists nothing."""
    last_user_turn = next((m.content for m in reversed(prior_messages) if m.role == "user"), None)
    retrieval = retrieve_relevant_docs(
        db, project_id, question,
        source_types=source_types or chat_settings["source_types"],
        extra_context=last_user_turn,
        max_docs=chat_settings["max_context_requirements"],
    )

    if retrieval.considered == 0:
        return {"answer": _EMPTY_SCOPE_ANSWER, "sources": [], "prompt_tokens": 0,
                "retrieval": retrieval, "truncated": False}

    turns = chat_settings["history_turns"]
    recent = prior_messages[-turns:] if turns > 0 else []
    history = [{"role": m.role, "content": m.content} for m in recent]
    prompt = build_doc_qa_prompt(retrieval.selected, question, history)

    try:
        result = await generate_ai_completion(
            db,
            AICompletionRequest(prompt=prompt, max_tokens=1500, temperature=0.2, timeout_seconds=120),
            operation="requirement_project_qa",
            project_id=project_id, user_id=current_user.id,
            entity_type="project", entity_id=project_id,
        )
    except HTTPException:
        raise
    except Exception as exc:  # network, timeout, provider SDK errors, etc.
        logger.warning("AI completion failed for requirement QA: %s", exc)
        raise HTTPException(status_code=502, detail="AI request failed. Please try again.") from exc

    try:
        parsed = extract_json_object(result.content)
        answer = clean_ai_text(parsed.get("answer"), 8000) or ""
        raw_sources = parsed.get("sources") or []
        if not isinstance(raw_sources, list):
            raw_sources = []
    except Exception as exc:
        logger.warning("Failed to parse requirement QA response: %s", exc)
        answer = clean_ai_text(result.content, 8000) or ""
        raw_sources = []

    if not answer:
        raise HTTPException(status_code=502, detail="AI did not return an answer")

    # Map cited keys back to docs (first/most-relevant wins on key collisions).
    by_key: dict = {}
    for doc in retrieval.selected:
        by_key.setdefault(doc.key, doc)
    sources: list = []
    seen = set()
    for item in raw_sources:
        key = (item or {}).get("key") if isinstance(item, dict) else None
        doc = by_key.get(key)
        if doc is not None and (doc.type, doc.id) not in seen:
            seen.add((doc.type, doc.id))
            sources.append({"type": doc.type, "id": doc.id, "key": doc.key, "title": doc.title})

    return {"answer": answer, "sources": sources, "prompt_tokens": result.prompt_tokens,
            "retrieval": retrieval, "truncated": retrieval.truncated}


def register_requirement_chat_routes(app):
    @app.get(
        "/projects/{project_id}/ai/conversations",
        response_model=list[schemas.RequirementChatConversationView],
    )
    def list_conversations(
        project_id: int,
        archived: bool = False,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_read(current_user, project_id, db)
        return crud.get_chat_conversations(db, project_id, current_user.id, archived=archived)

    @app.post(
        "/projects/{project_id}/ai/conversations",
        response_model=schemas.RequirementChatConversationView,
    )
    def create_conversation(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_read(current_user, project_id, db)
        return crud.create_chat_conversation(db, project_id, current_user.id)

    @app.get(
        "/projects/{project_id}/ai/conversations/by-link/{public_id}",
        response_model=schemas.RequirementChatSharedView,
    )
    def get_shared_conversation(
        project_id: int,
        public_id: str,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # Requester must be a project member; a private conversation is only
        # visible to its owner (others get 404 even with the correct link).
        _require_project_read(current_user, project_id, db)
        conversation = crud.get_chat_conversation_by_public_id(db, _normalize_public_id(public_id))
        if not conversation or conversation.project_id != project_id:
            raise HTTPException(status_code=404, detail="Conversation not found")
        is_owner = conversation.created_by == current_user.id
        if not is_owner and conversation.share_scope != "project":
            raise HTTPException(status_code=404, detail="Conversation not found")
        return schemas.RequirementChatSharedView(conversation=conversation, read_only=not is_owner)

    @app.get(
        "/projects/{project_id}/ai/conversations/{conversation_id}",
        response_model=schemas.RequirementChatConversationView,
    )
    def get_conversation(
        project_id: int,
        conversation_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_read(current_user, project_id, db)
        return _conversation_or_404(db, conversation_id, project_id, current_user)

    @app.patch(
        "/projects/{project_id}/ai/conversations/{conversation_id}",
        response_model=schemas.RequirementChatConversationView,
    )
    def update_conversation(
        project_id: int,
        conversation_id: int,
        payload: schemas.RequirementChatConversationUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_read(current_user, project_id, db)
        _conversation_or_404(db, conversation_id, project_id, current_user)
        return crud.update_chat_conversation(
            db, conversation_id, title=payload.title, archived=payload.archived,
            share_scope=payload.share_scope,
        )

    @app.delete("/projects/{project_id}/ai/conversations/{conversation_id}")
    def delete_conversation(
        project_id: int,
        conversation_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_read(current_user, project_id, db)
        _conversation_or_404(db, conversation_id, project_id, current_user)
        crud.delete_chat_conversation(db, conversation_id)
        return {"status": "deleted"}

    @app.post(
        "/projects/{project_id}/ai/ask",
        response_model=schemas.RequirementChatAskResponse,
    )
    async def ask_about_requirements(
        project_id: int,
        payload: schemas.RequirementChatAsk,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # Asking spends the project's AI token budget and persists turns, so it
        # requires write (read-only viewers cannot trigger paid AI calls).
        _require_project_permission(current_user, project_id, db, "write")

        chat_settings = get_requirement_chat_settings(db)
        if not chat_settings["enabled"]:
            raise HTTPException(status_code=403, detail="The requirement AI assistant is disabled.")

        # Resolve the conversation up front (so a bad id 404s), but DON'T
        # persist anything yet: we only commit the user + assistant turns once
        # we have a successful answer, so a failed AI call leaves no orphan
        # turn or empty conversation behind (matching the client's rollback).
        existing = None
        prior_messages: list = []
        if payload.conversation_id is not None:
            existing = _conversation_or_404(db, payload.conversation_id, project_id, current_user)
            prior_messages = list(existing.messages)

        source_types = _effective_source_types(payload.source_types, chat_settings["source_types"])
        produced = await _produce_answer(
            db, project_id, current_user, payload.question, prior_messages, chat_settings,
            source_types=source_types,
        )

        # Answer in hand — now persist the conversation (create lazily) and turns.
        if existing is None:
            title = clean_ai_text(payload.question, 80) or "New conversation"
            existing = crud.create_chat_conversation(db, project_id, current_user.id, title=title)
        crud.add_chat_message(db, existing.id, "user", payload.question)
        message = crud.add_chat_message(
            db, existing.id, "assistant", produced["answer"],
            sources=produced["sources"], prompt_tokens=produced["prompt_tokens"],
        )

        _audit(db, current_user, project_id)

        return schemas.RequirementChatAskResponse(
            conversation_id=existing.id,
            message=message,
            retrieval_truncated=produced["truncated"],
            requirements_considered=produced["retrieval"].considered,
            requirements_used=len(produced["retrieval"].selected),
        )

    @app.post(
        "/projects/{project_id}/ai/conversations/{conversation_id}/regenerate",
        response_model=schemas.RequirementChatAskResponse,
    )
    async def regenerate_answer(
        project_id: int,
        conversation_id: int,
        payload: schemas.RequirementChatRegenerate = schemas.RequirementChatRegenerate(),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_permission(current_user, project_id, db, "write")
        chat_settings = get_requirement_chat_settings(db)
        if not chat_settings["enabled"]:
            raise HTTPException(status_code=403, detail="The requirement AI assistant is disabled.")

        conversation = _conversation_or_404(db, conversation_id, project_id, current_user)
        messages = list(conversation.messages)
        last_user_idx = next((i for i in range(len(messages) - 1, -1, -1) if messages[i].role == "user"), None)
        if last_user_idx is None:
            raise HTTPException(status_code=400, detail="Nothing to regenerate")

        question = messages[last_user_idx].content
        prior_messages = messages[:last_user_idx]
        source_types = _effective_source_types(payload.source_types, chat_settings["source_types"])

        # Produce the new answer FIRST so a failure leaves the existing answer
        # intact; only then drop the stale assistant turn(s) and append the new.
        produced = await _produce_answer(
            db, project_id, current_user, question, prior_messages, chat_settings,
            source_types=source_types,
        )
        stale_ids = [m.id for m in messages[last_user_idx + 1:]]
        crud.delete_chat_messages(db, stale_ids)
        message = crud.add_chat_message(
            db, conversation.id, "assistant", produced["answer"],
            sources=produced["sources"], prompt_tokens=produced["prompt_tokens"],
        )

        _audit(db, current_user, project_id)

        return schemas.RequirementChatAskResponse(
            conversation_id=conversation.id,
            message=message,
            retrieval_truncated=produced["truncated"],
            requirements_considered=produced["retrieval"].considered,
            requirements_used=len(produced["retrieval"].selected),
        )


def _audit(db: Session, current_user, project_id: int) -> None:
    try:
        from ..models import AuditAction
        from ..schemas_audit import AuditTrailCreate
        from ..services.audit_service import get_audit_service

        get_audit_service(db).create_audit_trail(
            AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.REQUIREMENT.value if hasattr(EntityType, "REQUIREMENT") else "project",
                entity_id=project_id,
                project_id=project_id,
                description="Asked AI a question across project requirements",
            )
        )
    except Exception as exc:  # pragma: no cover - audit must never break the request
        logger.exception("Failed to audit requirement QA event: %s", exc)
