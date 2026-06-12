"""
Token cleanup job for expired and revoked refresh tokens.

Every web replica starts this background loop, but the actual deletes must run
in only one place: with N replicas, an unguarded loop fires N identical
``DELETE`` storms against the database every cycle. We coordinate through a
DB-backed lease (a row in ``system_settings``) so exactly one replica performs
the cleanup per interval — no external scheduler or leader-election infra
required, and it degrades to a plain single-runner on single-node SQLite.
"""
import asyncio
import logging
from datetime import datetime, timedelta, UTC

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import cleanup_expired_refresh_tokens
from .database import SessionLocal

logger = logging.getLogger(__name__)

# Run the cleanup at most once per this window, cluster-wide.
CLEANUP_INTERVAL = timedelta(hours=24)
# How often each replica wakes to *try* to acquire the lease. Shorter than the
# cleanup interval so that if the replica holding the lease dies, another takes
# over within roughly this long instead of waiting a full interval.
POLL_INTERVAL_SECONDS = 60 * 60

_LEASE_KEY = "token_cleanup_last_run"


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    # Stored as UTC ISO; tolerate naive values written by older code.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _try_acquire_cleanup_lease(db: Session) -> bool:
    """Claim the cluster-wide cleanup lease for this cycle.

    Returns ``True`` (and advances the stored timestamp) only when at least
    ``CLEANUP_INTERVAL`` has elapsed since the last successful claim. The
    ``SELECT ... FOR UPDATE`` serialises concurrent replicas on server
    backends; the unique ``key`` constraint resolves the first-run create race.
    """
    from .models import SystemSettings

    now = datetime.now(UTC)
    row = (
        db.query(SystemSettings)
        .filter(SystemSettings.key == _LEASE_KEY)
        .with_for_update()
        .first()
    )

    if row is None:
        db.add(
            SystemSettings(
                key=_LEASE_KEY,
                value=now.isoformat(),
                description="Last cluster-wide refresh-token cleanup run (UTC).",
            )
        )
        try:
            db.commit()
        except IntegrityError:
            # Another replica created the row first; let it own this cycle.
            db.rollback()
            return False
        return True

    last_run = _parse_timestamp(row.value)
    if last_run is not None and now - last_run < CLEANUP_INTERVAL:
        db.rollback()  # release the row lock without changes
        return False

    row.value = now.isoformat()
    db.commit()
    return True


async def token_cleanup_job():
    """Background loop: try to acquire the lease, and clean up if we win it."""
    while True:
        try:
            db = SessionLocal()
            try:
                if _try_acquire_cleanup_lease(db):
                    cleaned_count = cleanup_expired_refresh_tokens(db)
                    if cleaned_count > 0:
                        logger.info(
                            "🧹 Cleaned up %s expired/revoked refresh tokens",
                            cleaned_count,
                        )
            finally:
                db.close()
        except Exception as e:  # keep the loop alive across transient DB errors
            logger.warning("❌ Error in token cleanup job: %s", e)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def start_token_cleanup():
    """Start the token cleanup background job"""
    import threading

    def run_cleanup():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(token_cleanup_job())

    cleanup_thread = threading.Thread(target=run_cleanup, daemon=True)
    cleanup_thread.start()
    logger.info("🚀 Token cleanup job started in background")


if __name__ == "__main__":
    start_token_cleanup()
    # Keep the main thread alive
    try:
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("🛑 Token cleanup job stopped")
