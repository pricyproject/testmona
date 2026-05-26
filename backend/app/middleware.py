"""
Middleware for rate limiting and security headers.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.requests import Request
from collections import defaultdict
from time import time

from .services.request_context import (
    get_request_client_ip,
    get_request_user_agent,
    reset_request_metadata,
    set_request_metadata,
)


class RequestMetadataMiddleware(BaseHTTPMiddleware):
    """Expose request metadata to service-layer audit logging."""

    async def dispatch(self, request: Request, call_next):
        tokens = set_request_metadata(
            get_request_client_ip(request),
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
    
    async def dispatch(self, request: Request, call_next):
        # Get client IP
        client_ip = get_request_client_ip(request) or "unknown"
        
        # Get current time
        current_time = time()
        
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
