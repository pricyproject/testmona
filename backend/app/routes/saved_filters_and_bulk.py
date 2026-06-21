"""Saved filters and bulk-edit endpoints for list pages."""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import Depends, HTTPException, Path, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from .. import crud, models, rbac, schemas
from ..auth import get_current_active_user
from ..crud import safe_commit
from ..database import get_db
from ..services import notification_engine
from .requirements_defects_plans import notify_defect_assignee, notify_defect_status_change

logger = logging.getLogger(__name__)


# NB: "advanced_search" is intentionally NOT here — those saved filters are
# created only via POST /advanced-search/saved, which validates the TQL and
# stores a computed AST. Allowing them through this generic endpoint would let
# a client persist an unvalidated definition.
_ALLOWED_SCOPES = {"test_cases", "defects", "requirements"}
_ALLOWED_TEST_CASE_STATUSES = {"active", "inactive", "archived", "draft"}
_ALLOWED_TEST_CASE_TYPES = {"manual", "automated"}


def _normalize_tags(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def _merge_tags(existing: Optional[str], add: List[str], remove: List[str], replace: Optional[str]) -> Optional[str]:
    """Combine tag updates.

    Precedence: explicit ``replace`` wins; otherwise we union ``add`` and
    set-subtract ``remove`` against the existing list. Whitespace and
    duplicate tags are normalized out. Returns ``None`` only if no changes
    were requested at all (caller can then leave the field untouched).
    """
    if replace is not None:
        # Even an empty replace clears tags — represent that as "".
        return ",".join(_normalize_tags(replace))
    if not add and not remove:
        return None
    current = _normalize_tags(existing)
    if add:
        for tag in add:
            if tag not in current:
                current.append(tag)
    if remove:
        remove_set = set(remove)
        current = [tag for tag in current if tag not in remove_set]
    return ",".join(current)


def register_saved_filters_and_bulk_routes(app) -> None:
    # --------------------------- Saved filters ---------------------------

    @app.get("/saved-filters", response_model=List[schemas.SavedFilterView])
    def list_saved_filters(
        project_id: int = Query(..., ge=1),
        scope: str = Query(..., min_length=1, max_length=32),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if scope not in _ALLOWED_SCOPES:
            raise HTTPException(status_code=400, detail=f"Unsupported scope: {scope}")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        rows = (
            db.query(models.SavedFilter)
            .filter(
                models.SavedFilter.project_id == project_id,
                models.SavedFilter.scope == scope,
            )
            .filter(
                or_(
                    models.SavedFilter.user_id == current_user.id,
                    models.SavedFilter.is_shared == True,  # noqa: E712
                )
            )
            .order_by(models.SavedFilter.is_default.desc(), models.SavedFilter.name.asc())
            .all()
        )
        return [
            schemas.SavedFilterView(
                id=row.id,
                user_id=row.user_id,
                project_id=row.project_id,
                scope=row.scope,
                name=row.name,
                definition=row.definition or {},
                is_default=row.is_default,
                is_shared=row.is_shared,
                created_at=row.created_at,
                updated_at=row.updated_at,
                owned_by_current_user=(row.user_id == current_user.id),
            )
            for row in rows
        ]

    @app.post("/saved-filters", response_model=schemas.SavedFilterView, status_code=201)
    def create_saved_filter(
        payload: schemas.SavedFilterCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.scope not in _ALLOWED_SCOPES:
            raise HTTPException(status_code=400, detail=f"Unsupported scope: {payload.scope}")
        if not rbac.has_permission(current_user, "read", payload.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        existing = (
            db.query(models.SavedFilter)
            .filter(
                models.SavedFilter.user_id == current_user.id,
                models.SavedFilter.project_id == payload.project_id,
                models.SavedFilter.scope == payload.scope,
                models.SavedFilter.name == payload.name.strip(),
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(status_code=400, detail="A filter with that name already exists")

        # Only one default per (user, project, scope).
        if payload.is_default:
            db.query(models.SavedFilter).filter(
                models.SavedFilter.user_id == current_user.id,
                models.SavedFilter.project_id == payload.project_id,
                models.SavedFilter.scope == payload.scope,
            ).update({models.SavedFilter.is_default: False})

        row = models.SavedFilter(
            user_id=current_user.id,
            project_id=payload.project_id,
            scope=payload.scope,
            name=payload.name.strip(),
            definition=payload.definition,
            is_default=payload.is_default,
            is_shared=payload.is_shared,
        )
        db.add(row)
        safe_commit(db)
        db.refresh(row)

        return schemas.SavedFilterView(
            id=row.id,
            user_id=row.user_id,
            project_id=row.project_id,
            scope=row.scope,
            name=row.name,
            definition=row.definition or {},
            is_default=row.is_default,
            is_shared=row.is_shared,
            created_at=row.created_at,
            updated_at=row.updated_at,
            owned_by_current_user=True,
        )

    @app.put("/saved-filters/{filter_id}", response_model=schemas.SavedFilterView)
    def update_saved_filter(
        payload: schemas.SavedFilterUpdate,
        filter_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        row = db.query(models.SavedFilter).filter(models.SavedFilter.id == filter_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Saved filter not found")
        if row.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="You can only edit filters you created")

        if payload.name is not None:
            stripped = payload.name.strip()
            if not stripped:
                raise HTTPException(status_code=400, detail="Name cannot be empty")
            if stripped != row.name:
                conflict = (
                    db.query(models.SavedFilter)
                    .filter(
                        models.SavedFilter.user_id == current_user.id,
                        models.SavedFilter.project_id == row.project_id,
                        models.SavedFilter.scope == row.scope,
                        models.SavedFilter.name == stripped,
                        models.SavedFilter.id != row.id,
                    )
                    .first()
                )
                if conflict is not None:
                    raise HTTPException(status_code=400, detail="A filter with that name already exists")
            row.name = stripped

        if payload.definition is not None:
            row.definition = payload.definition
        if payload.is_default is True:
            # Demote the existing default first (idempotent for the row itself).
            db.query(models.SavedFilter).filter(
                models.SavedFilter.user_id == current_user.id,
                models.SavedFilter.project_id == row.project_id,
                models.SavedFilter.scope == row.scope,
                models.SavedFilter.id != row.id,
            ).update({models.SavedFilter.is_default: False})
            row.is_default = True
        elif payload.is_default is False:
            row.is_default = False
        if payload.is_shared is not None:
            row.is_shared = payload.is_shared

        safe_commit(db)
        db.refresh(row)
        return schemas.SavedFilterView(
            id=row.id,
            user_id=row.user_id,
            project_id=row.project_id,
            scope=row.scope,
            name=row.name,
            definition=row.definition or {},
            is_default=row.is_default,
            is_shared=row.is_shared,
            created_at=row.created_at,
            updated_at=row.updated_at,
            owned_by_current_user=True,
        )

    @app.delete("/saved-filters/{filter_id}", status_code=204)
    def delete_saved_filter(
        filter_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        row = db.query(models.SavedFilter).filter(models.SavedFilter.id == filter_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Saved filter not found")
        if row.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="You can only delete filters you created")
        db.delete(row)
        safe_commit(db)
        return

    # --------------------------- Bulk: test cases ---------------------------

    @app.patch("/test-cases/bulk", response_model=schemas.BulkUpdateResult)
    def bulk_update_test_cases(
        payload: schemas.BulkTestCaseUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.status and payload.status not in _ALLOWED_TEST_CASE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported status. Allowed: {sorted(_ALLOWED_TEST_CASE_STATUSES)}",
            )
        if payload.test_type and payload.test_type not in _ALLOWED_TEST_CASE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported test_type. Allowed: {sorted(_ALLOWED_TEST_CASE_TYPES)}",
            )

        ids = list(dict.fromkeys(payload.ids))  # dedupe but preserve order
        if not ids:
            return schemas.BulkUpdateResult(updated=0)

        # Load all candidate cases in one query to validate ownership + project.
        cases = (
            db.query(models.TestCase)
            .options(joinedload(models.TestCase.test_suite))
            .filter(models.TestCase.id.in_(ids))
            .filter(models.TestCase.is_deleted == False)  # noqa: E712
            .all()
        )
        case_by_id = {case.id: case for case in cases}

        # Validate section if provided. ``TestCaseSection`` has no direct
        # ``project_id`` — its project is derived through the parent test
        # suite. Load the suite too so we can scope the move properly.
        target_section_project_id: Optional[int] = None
        if payload.section_id is not None:
            section_row = (
                db.query(models.TestCaseSection, models.TestSuite)
                .join(models.TestSuite, models.TestSuite.id == models.TestCaseSection.test_suite_id)
                .filter(models.TestCaseSection.id == payload.section_id)
                .first()
            )
            if section_row is None:
                raise HTTPException(status_code=404, detail="Target section not found")
            target_section_project_id = section_row[1].project_id

        # Test-case tags are normalized Tag rows; payloads carry name lists.
        add_tags = payload.add_tags or []
        remove_tags = payload.remove_tags or []
        remove_slugs = {crud.slugify_tag(name) for name in remove_tags}

        updated = 0
        skipped: List[int] = []
        # Cache write-permission per project so we don't query RBAC per row.
        write_cache: dict[int, bool] = {}

        for case_id in ids:
            case = case_by_id.get(case_id)
            if case is None:
                skipped.append(case_id)
                continue
            project_id = case.project_id
            if project_id is None:
                skipped.append(case_id)
                continue
            allowed = write_cache.get(project_id)
            if allowed is None:
                allowed = rbac.has_permission(current_user, "write", project_id, db)
                write_cache[project_id] = allowed
            if not allowed:
                skipped.append(case_id)
                continue
            if target_section_project_id is not None and target_section_project_id != project_id:
                # Don't silently relocate a test case to a section in another project.
                skipped.append(case_id)
                continue

            if payload.priority is not None:
                case.priority = getattr(payload.priority, "value", payload.priority)
            if payload.status is not None:
                case.status = payload.status
            if payload.test_type is not None:
                case.test_type = payload.test_type
            if payload.section_id is not None:
                case.section_id = payload.section_id

            tags_changed = False
            if payload.tags is not None:
                # Replace the whole tag set.
                case.tags = crud.resolve_or_create_tags(db, project_id, payload.tags)
                tags_changed = True
            else:
                if add_tags:
                    existing_slugs = {t.slug for t in case.tags}
                    for tag in crud.resolve_or_create_tags(db, project_id, add_tags):
                        if tag.slug not in existing_slugs:
                            case.tags.append(tag)
                            existing_slugs.add(tag.slug)
                            tags_changed = True
                if remove_slugs:
                    kept = [t for t in case.tags if t.slug not in remove_slugs]
                    if len(kept) != len(case.tags):
                        case.tags = kept
                        tags_changed = True
            if tags_changed:
                crud.sync_tags_cache(case)
            updated += 1

        if updated:
            safe_commit(db)
        return schemas.BulkUpdateResult(updated=updated, skipped_ids=skipped)

    # --------------------------- Bulk: defects ---------------------------

    @app.patch("/defects/bulk", response_model=schemas.BulkUpdateResult)
    def bulk_update_defects(
        payload: schemas.BulkDefectUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.clear_assignee and payload.assigned_to is not None:
            raise HTTPException(status_code=400, detail="Use either assigned_to or clear_assignee, not both")

        ids = list(dict.fromkeys(payload.ids))
        if not ids:
            return schemas.BulkUpdateResult(updated=0)

        defects = db.query(models.Defect).filter(models.Defect.id.in_(ids)).all()
        defect_by_id = {defect.id: defect for defect in defects}

        # Validate assignee belongs to the project before touching anything —
        # we'll re-check per defect since defects can span projects in the
        # input list.
        if payload.assigned_to is not None:
            assignee_user = db.query(models.User).filter(models.User.id == payload.assigned_to).first()
            if assignee_user is None or not assignee_user.is_active:
                raise HTTPException(status_code=400, detail="Assignee not found or inactive")
        else:
            assignee_user = None

        updated = 0
        skipped: List[int] = []
        write_cache: dict[int, bool] = {}
        assignee_project_cache: dict[int, bool] = {}
        # (defect, prior_assigned_to) for defects handed to a new assignee, and
        # (defect, prior_status) for defects whose status moved — both notified
        # after the commit so a failed write never sends a stray alert.
        newly_assigned: List[tuple] = []
        status_changed: List[tuple] = []

        for defect_id in ids:
            defect = defect_by_id.get(defect_id)
            if defect is None:
                skipped.append(defect_id)
                continue
            project_id = defect.project_id
            allowed = write_cache.get(project_id)
            if allowed is None:
                allowed = rbac.has_permission(current_user, "write", project_id, db)
                write_cache[project_id] = allowed
            if not allowed:
                skipped.append(defect_id)
                continue

            if assignee_user is not None:
                ok = assignee_project_cache.get(project_id)
                if ok is None:
                    ok = rbac.has_permission(assignee_user, "read", project_id, db)
                    assignee_project_cache[project_id] = ok
                if not ok:
                    skipped.append(defect_id)
                    continue
                prior_assigned_to = defect.assigned_to
                defect.assigned_to = assignee_user.id
                newly_assigned.append((defect, prior_assigned_to))
            elif payload.clear_assignee:
                defect.assigned_to = None

            # The Defect.{status,severity,priority} columns are typed as
            # ``Enum(<Python enum>)``. SQLAlchemy stores/reads by enum NAME
            # (e.g. ``HIGH``) — assigning the enum instance lets SQLAlchemy
            # serialize correctly; assigning ``.value`` would write the
            # lowercase string and break subsequent reads.
            if payload.status is not None:
                prior_status = defect.status
                defect.status = payload.status
                if defect.status != prior_status:
                    status_changed.append((defect, prior_status))
            if payload.severity is not None:
                defect.severity = payload.severity
            if payload.priority is not None:
                defect.priority = payload.priority
            updated += 1

        if updated:
            safe_commit(db)
            # One batch across the whole bulk op: intents for different defects key
            # on distinct entities so they never collide, while a defect that was
            # both reassigned and status-changed de-dupes via the ladder (ASSIGNMENT
            # outranks STATUS for the new assignee; the reporter still gets STATUS).
            batch = notification_engine.NotificationBatch()
            for defect, prior_assigned_to in newly_assigned:
                notify_defect_assignee(
                    db, defect, current_user, previous_assigned_to=prior_assigned_to, batch=batch
                )
            for defect, prior_status in status_changed:
                notify_defect_status_change(
                    db, defect, current_user, previous_status=prior_status, batch=batch
                )
            batch.flush(db)
        return schemas.BulkUpdateResult(updated=updated, skipped_ids=skipped)

    # --------------------------- Bulk: requirements ---------------------------

    @app.patch("/requirements/bulk", response_model=schemas.BulkUpdateResult)
    def bulk_update_requirements(
        payload: schemas.BulkRequirementUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.clear_assignee and payload.assigned_to is not None:
            raise HTTPException(status_code=400, detail="Use either assigned_to or clear_assignee, not both")

        ids = list(dict.fromkeys(payload.ids))
        if not ids:
            return schemas.BulkUpdateResult(updated=0)

        requirements = db.query(models.Requirement).filter(models.Requirement.id.in_(ids)).all()
        requirement_by_id = {requirement.id: requirement for requirement in requirements}

        if payload.assigned_to is not None:
            assignee_user = db.query(models.User).filter(models.User.id == payload.assigned_to).first()
            if assignee_user is None or not assignee_user.is_active:
                raise HTTPException(status_code=400, detail="Assignee not found or inactive")
        else:
            assignee_user = None

        add_tags = _normalize_tags(payload.add_tags)
        remove_tags = _normalize_tags(payload.remove_tags)

        updated = 0
        skipped: List[int] = []
        write_cache: dict[int, bool] = {}
        assignee_project_cache: dict[int, bool] = {}

        for requirement_id in ids:
            requirement = requirement_by_id.get(requirement_id)
            if requirement is None:
                skipped.append(requirement_id)
                continue
            project_id = requirement.project_id
            allowed = write_cache.get(project_id)
            if allowed is None:
                allowed = rbac.has_permission(current_user, "write", project_id, db)
                write_cache[project_id] = allowed
            if not allowed:
                skipped.append(requirement_id)
                continue

            if assignee_user is not None:
                ok = assignee_project_cache.get(project_id)
                if ok is None:
                    ok = rbac.has_permission(assignee_user, "read", project_id, db)
                    assignee_project_cache[project_id] = ok
                if not ok:
                    skipped.append(requirement_id)
                    continue
                requirement.assigned_to = assignee_user.id
            elif payload.clear_assignee:
                requirement.assigned_to = None

            # status/priority are Enum columns — assign the enum instance so
            # SQLAlchemy serializes by NAME, matching how they're read back.
            if payload.status is not None:
                requirement.status = payload.status
            if payload.priority is not None:
                requirement.priority = payload.priority
            new_tags = _merge_tags(requirement.tags, add_tags, remove_tags, payload.tags)
            if new_tags is not None:
                requirement.tags = new_tags
            updated += 1

        if updated:
            safe_commit(db)
        return schemas.BulkUpdateResult(updated=updated, skipped_ids=skipped)

    # POST (not DELETE) on a 2-segment path so this isn't shadowed by the
    # earlier-registered DELETE /requirements/{requirement_id}.
    @app.post("/requirements/bulk/delete", response_model=schemas.BulkUpdateResult)
    def bulk_delete_requirements(
        payload: schemas.BulkRequirementDelete,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        ids = list(dict.fromkeys(payload.ids))
        if not ids:
            return schemas.BulkUpdateResult(updated=0)

        requirements = db.query(models.Requirement).filter(models.Requirement.id.in_(ids)).all()
        requirement_by_id = {requirement.id: requirement for requirement in requirements}

        deleted = 0
        skipped: List[int] = []
        # Deleting requirements is a manager+ action (testers can edit but not
        # delete them) — mirror the single-requirement delete route.
        manage_cache: dict[int, bool] = {}

        for requirement_id in ids:
            requirement = requirement_by_id.get(requirement_id)
            if requirement is None:
                skipped.append(requirement_id)
                continue
            allowed = manage_cache.get(requirement.project_id)
            if allowed is None:
                allowed = rbac.has_permission(current_user, "manage_projects", requirement.project_id, db)
                manage_cache[requirement.project_id] = allowed
            if not allowed:
                skipped.append(requirement_id)
                continue
            # Reuse the single-delete CRUD so association/traceability rows are
            # cleaned up consistently.
            crud.delete_requirement(db, requirement_id=requirement_id)
            deleted += 1

        return schemas.BulkUpdateResult(updated=deleted, skipped_ids=skipped)
