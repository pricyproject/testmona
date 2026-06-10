"""
Token cleanup job for expired and revoked refresh tokens
"""
import asyncio
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .database import SessionLocal
from .auth import cleanup_expired_refresh_tokens
import logging

logger = logging.getLogger(__name__)


async def token_cleanup_job():
    """Background job to clean up expired refresh tokens"""
    while True:
        try:
            db = SessionLocal()
            try:
                cleaned_count = cleanup_expired_refresh_tokens(db)
                if cleaned_count > 0:
                    logger.warning(f"🧹 Cleaned up {cleaned_count} expired/revoked refresh tokens")
            finally:
                db.close()
            
            # Run every 24 hours
            await asyncio.sleep(24 * 60 * 60)
        except Exception as e:
            logger.warning(f"❌ Error in token cleanup job: {e}")
            # Wait 1 hour before retrying on error
            await asyncio.sleep(60 * 60)


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
