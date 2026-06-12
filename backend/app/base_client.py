"""
Base client for external issue tracker APIs.
Provides common functionality for retry logic, rate limiting, and error handling.
"""
import requests
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod

from .retry_utils import RetryableTrackerError, tracker_retry


class BaseClient(ABC):
    """Base class for external API clients with common retry/rate limiting logic."""
    
    def __init__(self, timeout: int = 30, max_retries: int = 3, retry_delay: int = 1):
        """
        Initialize base client.
        
        Args:
            timeout: Timeout for API requests (optional, default: 30)
            max_retries: Maximum number of retry attempts (optional, default: 3)
            retry_delay: Base delay between retries in seconds (optional, default: 1)
        """
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
    
    @abstractmethod
    def get_headers(self) -> Dict[str, str]:
        """
        Get authentication headers for the API.
        
        Returns:
            Dict with headers
        """
        pass

    @property
    def headers(self) -> Dict[str, str]:
        return self.get_headers()
    
    @abstractmethod
    def get_rate_limit_status_code(self) -> int:
        """
        Get the HTTP status code that indicates rate limiting.
        
        Returns:
            HTTP status code (e.g., 403 for GitHub, 429 for GitLab)
        """
        pass
    
    @abstractmethod
    def handle_rate_limit(self, response: requests.Response) -> Optional[int]:
        """
        Handle rate limiting response and return wait time in seconds.
        
        Args:
            response: HTTP response object
            
        Returns:
            Wait time in seconds, or None if not rate limited
        """
        pass
    
    @abstractmethod
    def get_error_message(self, status_code: int) -> str:
        """
        Get error message for a given status code.
        
        Args:
            status_code: HTTP status code
            
        Returns:
            Error message string
        """
        pass
    
    def _make_request(self, method: str, url: str, **kwargs) -> requests.Response:
        """
        Make HTTP request, retrying transient failures with exponential backoff.

        Retries (via tenacity) on timeouts, connection errors, 5xx and rate
        limiting — honouring the tracker's rate-limit reset when one is provided.
        Auth/permission/not-found/validation errors fail fast (no retry).

        Args:
            method: HTTP method (GET, POST, PUT, PATCH)
            url: Request URL
            **kwargs: Additional arguments for requests

        Returns:
            requests.Response object
        """
        # Start from the client's auth headers, then let any per-call headers
        # override them (e.g. a request-specific Content-Type). The previous
        # order discarded per-call overrides because get_headers() won.
        headers = self.get_headers()
        headers.update(kwargs.pop('headers', {}))

        @tracker_retry(max_attempts=self.max_retries)
        def _attempt() -> requests.Response:
            return self._request_once(method, url, headers=headers, **kwargs)

        return _attempt()

    def _request_once(self, method: str, url: str, **kwargs) -> requests.Response:
        """Single HTTP attempt; raises ``RetryableTrackerError`` for transient failures.

        Terminal errors (401/403/404/422) raise a plain ``Exception`` so the
        ``tracker_retry`` policy lets them propagate immediately.
        """
        try:
            response = requests.request(method, url, timeout=self.timeout, **kwargs)
        except requests.exceptions.Timeout:
            raise RetryableTrackerError(f"Request timeout after {self.timeout} seconds")
        except requests.exceptions.ConnectionError:
            raise RetryableTrackerError("Connection error: Failed to connect to API")

        # Rate limiting (checked first: GitHub signals it with a 403 + reset header).
        if response.status_code == self.get_rate_limit_status_code():
            wait_time = self.handle_rate_limit(response)
            if wait_time:
                raise RetryableTrackerError(
                    f"API rate limit exceeded. Retry after {wait_time} seconds.",
                    retry_after=wait_time,
                )

        if response.status_code == 401:
            raise Exception("API authentication failed. Invalid or expired token.")
        elif response.status_code == 403:
            raise Exception("API access forbidden. Check permissions.")
        elif response.status_code == 404:
            raise Exception("Resource not found.")
        elif response.status_code == 422:
            raise Exception(f"Validation error: {response.json().get('message', 'Invalid data')}")
        elif response.status_code >= 500:
            raise RetryableTrackerError(f"API server error: {response.status_code}")

        return response
