"""
Middleware for rate limiting and security headers.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.requests import Request
from collections import defaultdict
from time import time

from .config import settings
from .services.request_context import (
    get_rate_limit_key,
    get_request_client_ip,
    get_request_user_agent,
    reset_request_metadata,
    set_request_metadata,
)


class RequestMetadataMiddleware(BaseHTTPMiddleware):
    """Expose request metadata to service-layer audit logging."""

    async def dispatch(self, request: Request, call_next):
        tokens = set_request_metadata(
            get_request_client_ip(request, settings.trusted_proxy_ips),
            get_request_user_agent(request),
        )
        try:
            return await call_next(request)
        finally:
            reset_request_metadata(tokens)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiting middleware"""

    def __init__(self, app, calls: int = 100, period: int = 60):
        super().__init__(app)
        self.calls = calls  # Max calls per period
        self.period = period  # Time period in seconds
        self.requests = defaultdict(list)

    def _prune(self, current_time: float) -> None:
        """Drop buckets whose whole window has expired.

        Without this, every distinct client IP leaves a permanently resident
        key, so the table grows without bound and is never reclaimed.
        """
        stale = [
            key
            for key, hits in self.requests.items()
            if not hits or current_time - hits[-1] >= self.period
        ]
        for key in stale:
            del self.requests[key]

    async def dispatch(self, request: Request, call_next):
        # Keyed on an address the client cannot forge: a spoofed X-Forwarded-For
        # would otherwise hand every request a fresh bucket and void the limit.
        client_ip = get_rate_limit_key(request, settings.trusted_proxy_ips)

        # Get current time
        current_time = time()
        self._prune(current_time)
        
        # Clean up old requests
        self.requests[client_ip] = [
            req_time for req_time in self.requests[client_ip]
            if current_time - req_time < self.period
        ]
        
        # Check if rate limit exceeded
        if len(self.requests[client_ip]) >= self.calls:
            return Response(
                content='{"detail": "Rate limit exceeded"}',
                status_code=429,
                media_type="application/json"
            )
        
        # Add current request
        self.requests[client_ip].append(current_time)
        
        # Process request
        response = await call_next(request)
        
        # Add rate limit headers
        response.headers["X-RateLimit-Limit"] = str(self.calls)
        response.headers["X-RateLimit-Remaining"] = str(self.calls - len(self.requests[client_ip]))
        response.headers["X-RateLimit-Reset"] = str(int(self.period))
        
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses"""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # CSRF protection headers (defense in depth, JWT already provides some protection)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        # Content Security Policy (basic)
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
        
        return response
