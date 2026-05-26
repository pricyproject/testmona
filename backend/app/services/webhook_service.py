"""Outbound webhook delivery — HMAC-signed, persisted, retried.

Design notes:

- Every dispatch creates a ``WebhookDelivery`` row first so we have a durable
  record for redelivery and auditing even if the process dies mid-attempt.
- Delivery runs on FastAPI's background-task pool. There is no separate
  worker process, so retries are in-process with capped exponential backoff
  (1s → 5s → 30s, max 3 attempts). For higher reliability, swap the
  ``threading``-based runner for a real queue (RQ/Celery) without touching
  the public surface of this module.
- Payloads are signed with ``X-Webhook-Signature: sha256=<hex>`` using the
  subscription's secret. Subscribers verify by computing the same HMAC over
  the raw body. Timestamp and event id headers are included so consumers can
  reject replays.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import requests
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import WebhookDelivery, WebhookSubscription
from .webhook_security import normalize_webhook_url

logger = logging.getLogger(__name__)


SUPPORTED_EVENTS = {
    "test_run.completed",
    "defect.created",
    "defect.updated",
}

_MAX_ATTEMPTS = 3
_BACKOFFS_SECONDS = (1, 5, 30)
_RESPONSE_BODY_CAP = 4000
_REQUEST_TIMEOUT_SECONDS = 10


def generate_secret() -> str:
    """Return a 64-char random secret suitable for HMAC signing."""
    return secrets.token_urlsafe(48)


def _sign(secret: str, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256)
    return mac.hexdigest()


def _normalize_events(events: Iterable[str]) -> List[str]:
    cleaned: List[str] = []
    seen: set = set()
    for event in events or []:
        if not isinstance(event, str):
            continue
        key = event.strip()
        if not key or key in seen:
            continue
        if key not in SUPPORTED_EVENTS:
            raise ValueError(f"Unsupported webhook event: {key}")
        seen.add(key)
        cleaned.append(key)
    if not cleaned:
        raise ValueError("At least one event is required")
    return cleaned


def validate_events(events: Iterable[str]) -> List[str]:
    """Public wrapper for routes to validate event lists before persisting."""
    return _normalize_events(events)


def _deliver_once(url: str, secret: str, event: str, body: bytes, delivery_id: int) -> requests.Response:
    timestamp = str(int(time.time()))
    signature = _sign(secret, body)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "testmona-webhook/1.0",
        "X-Webhook-Event": event,
        "X-Webhook-Delivery": str(delivery_id),
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": f"sha256={signature}",
    }
    return requests.post(url, data=body, headers=headers, timeout=_REQUEST_TIMEOUT_SECONDS)


def _run_delivery(delivery_id: int) -> None:
    """Run a single delivery (with retries) on a fresh DB session."""
    db: Session = SessionLocal()
    try:
        delivery = db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
        if delivery is None:
            logger.warning("Webhook delivery %s vanished before dispatch", delivery_id)
            return
        subscription = db.query(WebhookSubscription).filter(WebhookSubscription.id == delivery.subscription_id).first()
        if subscription is None or not subscription.is_active:
            delivery.status = "failed"
            delivery.error = "subscription missing or inactive"
            delivery.updated_at = datetime.now(timezone.utc)
            db.commit()
            return
        try:
            target_url = normalize_webhook_url(subscription.url)
        except ValueError as exc:
            delivery.status = "failed"
            delivery.error = str(exc)
            delivery.updated_at = datetime.now(timezone.utc)
            db.commit()
            return

        body = json.dumps(delivery.payload, default=str, ensure_ascii=False).encode("utf-8")

        last_error: Optional[str] = None
        last_status: Optional[int] = None
        last_body: Optional[str] = None
        success = False

        for attempt_index in range(_MAX_ATTEMPTS):
            delivery.attempts = attempt_index + 1
            try:
                response = _deliver_once(target_url, subscription.secret, delivery.event, body, delivery.id)
                last_status = response.status_code
                last_body = (response.text or "")[:_RESPONSE_BODY_CAP]
                if 200 <= response.status_code < 300:
                    success = True
                    break
                last_error = f"HTTP {response.status_code}"
            except requests.RequestException as exc:
                last_error = str(exc)[:500]
            # If there's a next attempt, back off.
            if attempt_index + 1 < _MAX_ATTEMPTS:
                time.sleep(_BACKOFFS_SECONDS[attempt_index])

        delivery.status = "success" if success else "failed"
        delivery.response_status = last_status
        delivery.response_body = last_body
        delivery.error = None if success else last_error
        if success:
            delivery.delivered_at = datetime.now(timezone.utc)
        delivery.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        logger.exception("Unhandled error delivering webhook %s", delivery_id)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def _spawn(delivery_id: int) -> None:
    """Run delivery on a daemon thread so request handlers don't block."""
    thread = threading.Thread(target=_run_delivery, args=(delivery_id,), daemon=True)
    thread.start()


def enqueue_delivery(db: Session, subscription: WebhookSubscription, event: str, payload: Dict[str, Any]) -> WebhookDelivery:
    """Persist a delivery row and kick off the dispatch thread.

    Returns the delivery so the caller can include its id in a response if
    desired (e.g. for redeliver / status checks).
    """
    delivery = WebhookDelivery(
        subscription_id=subscription.id,
        event=event,
        payload=payload,
        status="pending",
        attempts=0,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    _spawn(delivery.id)
    return delivery


def emit_event(db: Session, project_id: int, event: str, payload: Dict[str, Any]) -> int:
    """Fan an event out to every active subscription on the project matching it.

    Returns the number of deliveries enqueued. Never raises — webhook
    delivery is best-effort and must not block the originating business
    operation.
    """
    if event not in SUPPORTED_EVENTS:
        logger.warning("emit_event called with unsupported event %s", event)
        return 0
    try:
        subs = (
            db.query(WebhookSubscription)
            .filter(
                WebhookSubscription.project_id == project_id,
                WebhookSubscription.is_active == True,  # noqa: E712
            )
            .all()
        )
    except Exception:
        logger.exception("Failed to fetch webhook subscriptions for project %s", project_id)
        return 0

    count = 0
    for sub in subs:
        events = sub.events or []
        if event not in events:
            continue
        try:
            enqueue_delivery(db, sub, event, payload)
            count += 1
        except Exception:
            logger.exception("Failed to enqueue webhook delivery for sub %s", sub.id)
            try:
                db.rollback()
            except Exception:
                pass
    return count


def redeliver(db: Session, delivery: WebhookDelivery) -> WebhookDelivery:
    """Reset a delivery to pending and re-dispatch it."""
    delivery.status = "pending"
    delivery.attempts = 0
    delivery.response_status = None
    delivery.response_body = None
    delivery.error = None
    delivery.delivered_at = None
    delivery.updated_at = datetime.now(timezone.utc)
    db.commit()
    _spawn(delivery.id)
    return delivery
