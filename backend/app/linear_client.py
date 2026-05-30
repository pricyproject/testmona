"""
Linear API client for issue tracker integration.
Handles creating, updating, and syncing issues with Linear.
"""
import requests
import time
from typing import Optional, Dict, Any, List
from datetime import datetime
from .base_client import BaseClient


class LinearClient(BaseClient):
    """Client for interacting with Linear API."""
    
    def __init__(self, api_url: str, api_token: str, team_key: str, timeout: int = 30):
        """
        Initialize Linear client.
        
        Args:
            api_url: Linear API URL (e.g., https://api.linear.app)
            api_token: Linear API token
            team_key: Linear team key
            timeout: Timeout for API requests (optional, default: 30)
        """
        super().__init__(timeout=timeout)
        self.api_url = api_url.rstrip('/')
        self.api_token = api_token
        self.team_key = team_key
    
    def get_headers(self) -> Dict[str, str]:
        """Get Linear API headers."""
        return {
            'Authorization': self.api_token,
            'Content-Type': 'application/json'
        }
    
    def get_rate_limit_status_code(self) -> int:
        """Linear returns 429 for rate limiting."""
        return 429
    
    def handle_rate_limit(self, response: requests.Response) -> Optional[int]:
        """
        Handle Linear rate limiting.
        
        Args:
            response: HTTP response object
            
        Returns:
            Wait time in seconds, or None if not rate limited
        """
        retry_after = response.headers.get('Retry-After')
        if retry_after:
            return int(retry_after)
        return 60  # Default wait time if no Retry-After header
    
    @staticmethod
    def _map_priority(priority: Optional[str]) -> int:
        """Map a textual priority to Linear's integer scale.

        Linear uses: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.
        The API rejects a string priority, so callers' labels must be converted.
        """
        if priority is None:
            return 0
        return {
            'urgent': 1, 'critical': 1,
            'high': 2,
            'medium': 3, 'normal': 3,
            'low': 4,
            'no priority': 0, 'none': 0,
        }.get(str(priority).strip().lower(), 0)

    def get_error_message(self, status_code: int) -> str:
        """Get error message for Linear status codes."""
        if status_code == 401:
            return "Linear API authentication failed. Invalid or expired token."
        elif status_code == 403:
            return "Linear API access forbidden. Check permissions."
        elif status_code == 404:
            return "Resource not found in Linear."
        elif status_code == 422:
            return "Validation error."
        elif status_code >= 500:
            return f"Linear API server error: {status_code}"
        return f"Linear API error: {status_code}"
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to Linear API.
        
        Returns:
            Dict with success status and message
        """
        try:
            # Test by getting current user
            response = self._make_request(
                'POST',
                f"{self.api_url}/graphql",
                headers=self.headers,
                json={
                    'query': 'query { viewer { id name email } }'
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'errors' in data:
                    return {
                        'success': False,
                        'message': f'GraphQL error: {data["errors"][0].get("message")}'
                    }
                return {
                    'success': True,
                    'message': 'Successfully connected to Linear',
                    'user': data.get('data', {}).get('viewer', {})
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to connect to Linear: {response.status_code}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Connection error: {str(e)}'
            }
    
    def create_issue(self, title: str, description: str, issue_type: str = 'Bug', 
                     priority: str = 'Medium', assignee_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a new issue in Linear.
        
        Args:
            title: Issue title
            description: Issue description
            issue_type: Issue type (Bug, Incident, Task, etc.)
            priority: Priority (Urgent, High, Medium, Low, No Priority)
            assignee_id: Assignee user ID
            
        Returns:
            Dict with issue data or error
        """
        try:
            # Get team ID from team key
            team_query = {
                'query': '''
                    query($teamKey: String!) {
                        team(key: $teamKey) {
                            id
                            name
                        }
                    }
                ''',
                'variables': {'teamKey': self.team_key}
            }
            
            team_response = self._make_request(
                'POST',
                f"{self.api_url}/graphql",
                headers=self.headers,
                json=team_query
            )
            
            if team_response.status_code != 200:
                return {
                    'success': False,
                    'message': f'Failed to get team: {team_response.status_code}'
                }
            
            team_data = team_response.json()
            if 'errors' in team_data:
                return {
                    'success': False,
                    'message': f'GraphQL error: {team_data["errors"][0].get("message")}'
                }
            
            team_id = team_data.get('data', {}).get('team', {}).get('id')
            if not team_id:
                return {
                    'success': False,
                    'message': 'Team not found'
                }
            
            # Create issue mutation.
            # Note: Linear's IssueCreateInput has no "issueType" field and expects
            # an integer priority, so issue_type is intentionally not sent here.
            mutation = {
                'query': '''
                    mutation($title: String!, $description: String!, $teamId: String!, $priority: Int, $assigneeId: String) {
                        issueCreate(
                            input: {
                                title: $title
                                description: $description
                                teamId: $teamId
                                priority: $priority
                                assigneeId: $assigneeId
                            }
                        ) {
                            success
                            issue {
                                id
                                identifier
                                title
                                url
                                state {
                                    name
                                }
                            }
                        }
                    }
                ''',
                'variables': {
                    'title': title,
                    'description': description,
                    'teamId': team_id,
                    'priority': self._map_priority(priority),
                    'assigneeId': assignee_id
                }
            }
            
            response = self._make_request(
                'POST',
                f"{self.api_url}/graphql",
                headers=self.headers,
                json=mutation
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'errors' in data:
                    return {
                        'success': False,
                        'message': f'GraphQL error: {data["errors"][0].get("message")}'
                    }
                
                issue_data = data.get('data', {}).get('issueCreate', {})
                if issue_data.get('success'):
                    issue = issue_data.get('issue', {})
                    return {
                        'success': True,
                        'issue_id': issue.get('id'),
                        'issue_url': issue.get('url'),
                        'issue_identifier': issue.get('identifier'),
                        'issue': issue
                    }
                else:
                    return {
                        'success': False,
                        'message': 'Failed to create issue'
                    }
            else:
                return {
                    'success': False,
                    'message': f'Failed to create issue: {response.status_code}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error creating issue: {str(e)}'
            }
    
    def update_issue(self, issue_id: str, title: Optional[str] = None, 
                    description: Optional[str] = None, priority: Optional[str] = None) -> Dict[str, Any]:
        """
        Update an existing issue in Linear.
        
        Args:
            issue_id: Issue ID
            title: New title (optional)
            description: New description (optional)
            priority: New priority (optional)
            
        Returns:
            Dict with issue data or error
        """
        try:
            mutation = {
                'query': '''
                    mutation($issueId: String!, $title: String, $description: String, $priority: Int) {
                        issueUpdate(
                            id: $issueId
                            input: {
                                title: $title
                                description: $description
                                priority: $priority
                            }
                        ) {
                            success
                            issue {
                                id
                                title
                                url
                            }
                        }
                    }
                ''',
                'variables': {
                    'issueId': issue_id,
                    'title': title,
                    'description': description,
                    # Only convert when a priority was supplied; leave it null
                    # otherwise so an update doesn't reset it to "No priority".
                    'priority': self._map_priority(priority) if priority is not None else None
                }
            }
            
            response = self._make_request(
                'POST',
                f"{self.api_url}/graphql",
                headers=self.headers,
                json=mutation
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'errors' in data:
                    return {
                        'success': False,
                        'message': f'GraphQL error: {data["errors"][0].get("message")}'
                    }
                
                issue_data = data.get('data', {}).get('issueUpdate', {})
                if issue_data.get('success'):
                    issue = issue_data.get('issue', {})
                    return {
                        'success': True,
                        'issue': issue
                    }
                else:
                    return {
                        'success': False,
                        'message': 'Failed to update issue'
                    }
            else:
                return {
                    'success': False,
                    'message': f'Failed to update issue: {response.status_code}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error updating issue: {str(e)}'
            }
    
    def get_issue(self, issue_id: str) -> Dict[str, Any]:
        """
        Get an issue from Linear.
        
        Args:
            issue_id: Issue ID
            
        Returns:
            Dict with issue data or error
        """
        try:
            query = {
                'query': '''
                    query($issueId: ID!) {
                        issue(id: $issueId) {
                            id
                            identifier
                            title
                            description
                            state {
                                name
                            }
                            priority
                            url
                        }
                    }
                ''',
                'variables': {'issueId': issue_id}
            }
            
            response = self._make_request(
                'POST',
                f"{self.api_url}/graphql",
                headers=self.headers,
                json=query
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'errors' in data:
                    return {
                        'success': False,
                        'message': f'GraphQL error: {data["errors"][0].get("message")}'
                }
                
                issue = data.get('data', {}).get('issue', {})
                return {
                    'success': True,
                    'issue': issue
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to get issue: {response.status_code}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error getting issue: {str(e)}'
            }
