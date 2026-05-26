"""Routes for API tokens (user-scoped) and outbound webhooks (project-scoped)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from .. import models, rbac, schemas
from ..auth import get_current_active_user
from ..database import get_db
from ..services import api_token_service, webhook_service

logger = logging.getLogger(__name__)


def register_tokens_and_webhooks_routes(app) -> None:
    # ----------------------------- API tokens -----------------------------

    @app.get("/api-tokens", response_model=List[schemas.ApiTokenView])
    def list_api_tokens(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        rows = (
            db.query(models.ApiToken)
            .filter(models.ApiToken.user_id == current_user.id)
            .order_by(models.ApiToken.created_at.desc())
            .all()
        )
        return rows

    @app.post("/api-tokens", response_model=schemas.ApiTokenCreated, status_code=201)
    def create_api_token(
        payload: schemas.ApiTokenCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.expires_at is not None and payload.expires_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="expires_at must be in the future")

        raw_token, prefix, token_hash = api_token_service.generate_token()
        token = models.ApiToken(
            user_id=current_user.id,
            name=payload.name.strip(),
            prefix=prefix,
            token_hash=token_hash,
            expires_at=payload.expires_at,
        )
        db.add(token)
        db.commit()
        db.refresh(token)

        return schemas.ApiTokenCreated(
            id=token.id,
            name=token.name,
            prefix=token.prefix,
            last_used_at=token.last_used_at,
            expires_at=token.expires_at,
            revoked_at=token.revoked_at,
            created_at=token.created_at,
            token=raw_token,
        )

    @app.delete("/api-tokens/{token_id}", status_code=204)
    def revoke_api_token(
        token_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        token = db.query(models.ApiToken).filter(models.ApiToken.id == token_id).first()
        if token is None or token.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Token not found")
        # We delete rather than just setting ``revoked_at`` because a revoked
        # token has no future use; this also frees up the unique hash slot.
        db.delete(token)
        db.commit()
        return

    # ----------------------------- Webhooks -----------------------------

    def _require_webhook_admin(current_user, project_id: int, db: Session) -> None:
        if not rbac.can_manage_project(current_user, project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    def _get_subscription_or_404(db: Session, sub_id: int) -> models.WebhookSubscription:
        sub = db.query(models.WebhookSubscription).filter(models.WebhookSubscription.id == sub_id).first()
        if sub is None:
            raise HTTPException(status_code=404, detail="Webhook subscription not found")
        return sub

    @app.get("/webhooks/supported-events", response_model=List[str])
    def list_supported_events(
        current_user: schemas.User = Depends(get_current_active_user),  # noqa: ARG001 - auth gate only
    ):
        return sorted(webhook_service.SUPPORTED_EVENTS)

    @app.get("/projects/{project_id}/webhooks", response_model=List[schemas.WebhookSubscriptionView])
    def list_webhooks(
        project_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        rows = (
            db.query(models.WebhookSubscription)
            .filter(models.WebhookSubscription.project_id == project_id)
            .order_by(models.WebhookSubscription.created_at.desc())
            .all()
        )
        return rows

    @app.post(
        "/projects/{project_id}/webhooks",
        response_model=schemas.WebhookSubscriptionCreated,
        status_code=201,
    )
    def create_webhook(
        payload: schemas.WebhookSubscriptionCreate,
        project_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.project_id != project_id:
            raise HTTPException(status_code=400, detail="Project id mismatch")
        _require_webhook_admin(current_user, project_id, db)

        try:
            events = webhook_service.validate_events(payload.events)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")

        sub = models.WebhookSubscription(
            project_id=project_id,
            created_by=current_user.id,
            name=name,
            url=payload.url,
            secret=webhook_service.generate_secret(),
            events=events,
            is_active=payload.is_active,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)

        return schemas.WebhookSubscriptionCreated(
            id=sub.id,
            project_id=sub.project_id,
            name=sub.name,
            url=sub.url,
            events=list(sub.events or []),
            is_active=sub.is_active,
            created_by=sub.created_by,
            created_at=sub.created_at,
            updated_at=sub.updated_at,
            secret=sub.secret,
        )

    @app.put(
        "/projects/{project_id}/webhooks/{webhook_id}",
        response_model=schemas.WebhookSubscriptionView,
    )
    def update_webhook(
        payload: schemas.WebhookSubscriptionUpdate,
        project_id: int = Path(..., ge=1),
        webhook_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_webhook_admin(current_user, project_id, db)
        sub = _get_subscription_or_404(db, webhook_id)
        if sub.project_id != project_id:
            raise HTTPException(status_code=404, detail="Webhook subscription not found")

        if payload.name is not None:
            stripped = payload.name.strip()
            if not stripped:
                raise HTTPException(status_code=400, detail="Name cannot be empty")
            sub.name = stripped
        if payload.url is not None:
            sub.url = payload.url
        if payload.events is not None:
            try:
                sub.events = webhook_service.validate_events(payload.events)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
        if payload.is_active is not None:
            sub.is_active = payload.is_active
        if payload.rotate_secret:
            sub.secret = webhook_service.generate_secret()

        db.commit()
        db.refresh(sub)
        return sub

    @app.delete("/projects/{project_id}/webhooks/{webhook_id}", status_code=204)
    def delete_webhook(
        project_id: int = Path(..., ge=1),
        webhook_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_webhook_admin(current_user, project_id, db)
        sub = _get_subscription_or_404(db, webhook_id)
        if sub.project_id != project_id:
            raise HTTPException(status_code=404, detail="Webhook subscription not found")
        db.query(models.WebhookDelivery).filter(models.WebhookDelivery.subscription_id == webhook_id).delete()
        db.delete(sub)
        db.commit()
        return

    @app.get(
        "/projects/{project_id}/webhooks/{webhook_id}/deliveries",
        response_model=List[schemas.WebhookDeliveryView],
    )
    def list_webhook_deliveries(
        project_id: int = Path(..., ge=1),
        webhook_id: int = Path(..., ge=1),
        limit: int = Query(50, ge=1, le=200),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        sub = _get_subscription_or_404(db, webhook_id)
        if sub.project_id != project_id:
            raise HTTPException(status_code=404, detail="Webhook subscription not found")
        rows = (
            db.query(models.WebhookDelivery)
            .filter(models.WebhookDelivery.subscription_id == webhook_id)
            .order_by(models.WebhookDelivery.created_at.desc())
            .limit(limit)
            .all()
        )
        return rows

    @app.post(
        "/projects/{project_id}/webhooks/{webhook_id}/deliveries/{delivery_id}/redeliver",
        response_model=schemas.WebhookDeliveryView,
    )
    def redeliver_webhook(
        project_id: int = Path(..., ge=1),
        webhook_id: int = Path(..., ge=1),
        delivery_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_webhook_admin(current_user, project_id, db)
        sub = _get_subscription_or_404(db, webhook_id)
        if sub.project_id != project_id:
            raise HTTPException(status_code=404, detail="Webhook subscription not found")
        delivery = (
            db.query(models.WebhookDelivery)
            .filter(
                models.WebhookDelivery.id == delivery_id,
                models.WebhookDelivery.subscription_id == webhook_id,
            )
            .first()
        )
        if delivery is None:
            raise HTTPException(status_code=404, detail="Delivery not found")
        return webhook_service.redeliver(db, delivery)

    @app.post("/projects/{project_id}/webhooks/{webhook_id}/test", response_model=schemas.WebhookDeliveryView)
    def test_webhook(
        project_id: int = Path(..., ge=1),
        webhook_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Send a ``ping`` payload to the configured URL so users can verify
        endpoint reachability without waiting for a real event."""
        _require_webhook_admin(current_user, project_id, db)
        sub = _get_subscription_or_404(db, webhook_id)
        if sub.project_id != project_id:
            raise HTTPException(status_code=404, detail="Webhook subscription not found")
        # The ``ping`` event isn't in SUPPORTED_EVENTS by design (we don't
        # want users to subscribe to it). Bypass the fan-out path and
        # enqueue directly against this one subscription.
        delivery = webhook_service.enqueue_delivery(
            db,
            sub,
            event="ping",
            payload={
                "event": "ping",
                "subscription_id": sub.id,
                "project_id": project_id,
                "triggered_by": current_user.id,
                "triggered_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return delivery
