"""
GitHub API client for issue tracker integration.
Handles creating, updating, and syncing issues with GitHub.
"""
import requests
import time
from typing import Optional, Dict, Any, List
from datetime import datetime
from .base_client import BaseClient


class GitHubClient(BaseClient):
    """Client for interacting with GitHub API."""
    
    def __init__(self, api_url: str, api_token: str, repository_owner: str, repository_name: Optional[str] = None, timeout: int = 30):
        """
        Initialize GitHub client.
        
        Args:
            api_url: GitHub API URL
            api_token: GitHub personal access token
            repository_owner: Repository owner (username or organization)
            repository_name: Repository name
            timeout: Timeout for API requests (optional, default: 30)
        """
        super().__init__(timeout=timeout)
        self.token = api_token
        self.owner = repository_owner
        self.repo = repository_name
        self.api_url = api_url.rstrip('/') if api_url else "https://api.github.com"
        self.base_url = self.api_url
        
        # Determine full repository path
        if repository_name:
            self.repo_path = f"{repository_owner}/{repository_name}"
        else:
            # Assume repository_owner contains "owner/repo"
            self.repo_path = repository_owner
    
    def get_headers(self) -> Dict[str, str]:
        """Get GitHub API headers."""
        return {
            'Authorization': f'token {self.token}',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'TestManagement/1.0'
        }
    
    def get_rate_limit_status_code(self) -> int:
        """GitHub returns 403 for rate limiting."""
        return 403
    
    def handle_rate_limit(self, response: requests.Response) -> Optional[int]:
        """
        Handle GitHub rate limiting.
        
        Args:
            response: HTTP response object
            
        Returns:
            Wait time in seconds, or None if not rate limited
        """
        rate_limit_remaining = response.headers.get('X-RateLimit-Remaining')
        rate_limit_reset = response.headers.get('X-RateLimit-Reset')
        
        if rate_limit_remaining == '0' and rate_limit_reset:
            reset_time = int(rate_limit_reset)
            current_time = int(time.time())
            return max(reset_time - current_time, 1)
        
        return None
    
    def get_error_message(self, status_code: int) -> str:
        """Get error message for GitHub status codes."""
        if status_code == 401:
            return "GitHub API authentication failed. Invalid or expired token."
        elif status_code == 404:
            return "Resource not found in GitHub."
        elif status_code == 422:
            return "Validation error."
        elif status_code >= 500:
            return f"GitHub API server error: {status_code}"
        return f"GitHub API error: {status_code}"
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to GitHub API.
        
        Returns:
            Dict with success status and message
        """
        try:
            # Test by getting user info
            response = self._make_request('GET', f"{self.api_url}/user", headers=self.headers)
            
            if response.status_code == 200:
                # Also test if we can access the repository
                repo_response = self._make_request('GET', f"{self.api_url}/repos/{self.repo_path}", headers=self.headers)
                
                if repo_response.status_code == 200:
                    return {
                        'success': True,
                        'message': 'Successfully connected to GitHub and repository',
                        'user': response.json().get('login'),
                        'repository': self.repo_path
                    }
                else:
                    return {
                        'success': False,
                        'message': f'Connected to GitHub but cannot access repository: {repo_response.status_code} - {repo_response.json().get("message", "Unknown error")}'
                    }
            else:
                return {
                    'success': False,
                    'message': f'Authentication failed: {response.status_code} - {response.json().get("message", "Unknown error")}'
                }
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'message': 'Connection timeout'
            }
        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'message': 'Connection error - unable to reach GitHub'
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'Unexpected error: {str(e)}'
            }
    
    def create_issue(self, title: str, body: str, labels: Optional[List[str]] = None, 
                    assignee: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a new issue in GitHub.
        
        Args:
            title: Issue title
            body: Issue body/description
            labels: List of labels to add
            assignee: Username to assign the issue to
            
        Returns:
            Dict with issue data or error
        """
        try:
            issue_data = {
                'title': title,
                'body': body
            }
            
            if labels:
                issue_data['labels'] = labels
            
            if assignee:
                issue_data['assignees'] = [assignee]
            
            response = self._make_request('POST', f"{self.api_url}/repos/{self.repo_path}/issues", json=issue_data, headers=self.headers)
            
            if response.status_code == 201:
                issue = response.json()
                return {
                    'success': True,
                    'issue_id': str(issue['number']),
                    'issue_url': issue['html_url'],
                    'issue': issue
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to create issue: {response.status_code} - {response.json().get("message", "Unknown error")}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error creating issue: {str(e)}'
            }
    
    def update_issue(self, issue_number: int, title: Optional[str] = None, 
                    body: Optional[str] = None, state: Optional[str] = None,
                    labels: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Update an existing issue in GitHub.
        
        Args:
            issue_number: GitHub issue number
            title: New title (optional)
            body: New body (optional)
            state: New state ('open' or 'closed')
            labels: New labels (optional)
            
        Returns:
            Dict with updated issue data or error
        """
        try:
            issue_data = {}
            
            if title:
                issue_data['title'] = title
            if body:
                issue_data['body'] = body
            if state:
                issue_data['state'] = state
            if labels is not None:
                issue_data['labels'] = labels
            
            response = self._make_request('PATCH', f"{self.api_url}/repos/{self.repo_path}/issues/{issue_number}", json=issue_data, headers=self.headers)
            
            if response.status_code == 200:
                issue = response.json()
                return {
                    'success': True,
                    'issue': issue
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to update issue: {response.status_code} - {response.json().get("message", "Unknown error")}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error updating issue: {str(e)}'
            }
    
    def get_issue(self, issue_number: int) -> Dict[str, Any]:
        """
        Get an issue from GitHub.
        
        Args:
            issue_number: GitHub issue number
            
        Returns:
            Dict with issue data or error
        """
        try:
            response = self._make_request('GET', f"{self.api_url}/repos/{self.repo_path}/issues/{issue_number}", headers=self.headers)
            
            if response.status_code == 200:
                return {
                    'success': True,
                    'issue': response.json()
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to get issue: {response.status_code} - {response.json().get("message", "Unknown error")}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error getting issue: {str(e)}'
            }
    
    def add_comment(self, issue_number: int, body: str) -> Dict[str, Any]:
        """
        Add a comment to an issue.
        
        Args:
            issue_number: GitHub issue number
            body: Comment body
            
        Returns:
            Dict with comment data or error
        """
        try:
            response = self._make_request('POST', f"{self.api_url}/repos/{self.repo_path}/issues/{issue_number}/comments", json={'body': body}, headers=self.headers)
            
            if response.status_code == 201:
                return {
                    'success': True,
                    'comment': response.json()
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to add comment: {response.status_code} - {response.json().get("message", "Unknown error")}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error adding comment: {str(e)}'
            }
    
    def get_issues(self, state: str = 'open', since: Optional[datetime] = None, 
                   labels: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Get issues from repository.
        
        Args:
            state: Issue state ('open', 'closed', 'all')
            since: Only return issues updated since this date
            labels: Filter by labels
            
        Returns:
            Dict with list of issues or error
        """
        try:
            params = {'state': state}
            
            if since:
                params['since'] = since.isoformat()
            
            if labels:
                params['labels'] = ','.join(labels)
            
            response = self._make_request('GET', f"{self.api_url}/repos/{self.repo_path}/issues", params=params, headers=self.headers)
            
            if response.status_code == 200:
                return {
                    'success': True,
                    'issues': response.json()
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to get issues: {response.status_code} - {response.json().get("message", "Unknown error")}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error getting issues: {str(e)}'
            }
