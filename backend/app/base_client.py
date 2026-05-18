"""
Base client for external issue tracker APIs.
Provides common functionality for retry logic, rate limiting, and error handling.
"""
import requests
import time
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod


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
        Make HTTP request with retry logic and rate limiting handling.
        
        Args:
            method: HTTP method (GET, POST, PUT, PATCH)
            url: Request URL
            **kwargs: Additional arguments for requests
            
        Returns:
            requests.Response object
        """
        headers = kwargs.pop('headers', {})
        headers.update(self.get_headers())
        
        for attempt in range(self.max_retries):
            try:
                response = requests.request(method, url, timeout=self.timeout, headers=headers, **kwargs)
                
                # Handle rate limiting
                rate_limit_code = self.get_rate_limit_status_code()
                if response.status_code == rate_limit_code:
                    wait_time = self.handle_rate_limit(response)
                    
                    if wait_time and attempt < self.max_retries - 1:
                        time.sleep(wait_time)
                        continue
                    elif wait_time:
                        raise Exception(f"API rate limit exceeded. Retry after {wait_time} seconds.")
                
                # Handle specific error codes
                if response.status_code == 401:
                    raise Exception("API authentication failed. Invalid or expired token.")
                elif response.status_code == 403:
                    raise Exception("API access forbidden. Check permissions.")
                elif response.status_code == 404:
                    raise Exception("Resource not found.")
                elif response.status_code == 422:
                    raise Exception(f"Validation error: {response.json().get('message', 'Invalid data')}")
                elif response.status_code >= 500:
                    if attempt < self.max_retries - 1:
                        time.sleep(self.retry_delay * (attempt + 1))
                        continue
                    else:
                        raise Exception(f"API server error: {response.status_code}")
                
                return response
                
            except requests.exceptions.Timeout:
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))
                    continue
                else:
                    raise Exception(f"Request timeout after {self.timeout} seconds")
            except requests.exceptions.ConnectionError:
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay * (attempt + 1))
                    continue
                else:
                    raise Exception("Connection error: Failed to connect to API")
        
        raise Exception("Max retries exceeded")
