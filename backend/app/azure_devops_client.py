"""
Azure DevOps API client for issue tracker integration.
Handles creating, updating, and syncing work items with Azure DevOps.
"""
import requests
import time
from typing import Optional, Dict, Any, List
from datetime import datetime
from .base_client import BaseClient


class AzureDevOpsClient(BaseClient):
    """Client for interacting with Azure DevOps API."""
    
    def __init__(self, api_url: str, api_token: str, organization: str, project: str, timeout: int = 30):
        """
        Initialize Azure DevOps client.
        
        Args:
            api_url: Azure DevOps API URL (e.g., https://dev.azure.com)
            api_token: Azure DevOps personal access token
            organization: Azure DevOps organization name
            project: Azure DevOps project name
            timeout: Timeout for API requests (optional, default: 30)
        """
        super().__init__(timeout=timeout)
        self.api_url = api_url.rstrip('/')
        self.api_token = api_token
        self.organization = organization
        self.project = project
    
    def _encode_token(self, token: str) -> str:
        """Encode token for basic auth."""
        import base64
        credentials = f':{token}'
        return base64.b64encode(credentials.encode()).decode()
    
    def get_headers(self) -> Dict[str, str]:
        """Get Azure DevOps API headers."""
        return {
            'Authorization': f'Basic {self._encode_token(self.api_token)}',
            'Content-Type': 'application/json'
        }
    
    def get_rate_limit_status_code(self) -> int:
        """Azure DevOps returns 429 for rate limiting."""
        return 429
    
    def handle_rate_limit(self, response: requests.Response) -> Optional[int]:
        """
        Handle Azure DevOps rate limiting.
        
        Args:
            response: HTTP response object
            
        Returns:
            Wait time in seconds, or None if not rate limited
        """
        retry_after = response.headers.get('Retry-After')
        if retry_after:
            return int(retry_after)
        return 60  # Default wait time if no Retry-After header
    
    def get_error_message(self, status_code: int) -> str:
        """Get error message for Azure DevOps status codes."""
        if status_code == 401:
            return "Azure DevOps API authentication failed. Invalid or expired token."
        elif status_code == 403:
            return "Azure DevOps API access forbidden. Check permissions."
        elif status_code == 404:
            return "Resource not found in Azure DevOps."
        elif status_code == 422:
            return "Validation error."
        elif status_code >= 500:
            return f"Azure DevOps API server error: {status_code}"
        return f"Azure DevOps API error: {status_code}"
    
    def test_connection(self) -> Dict[str, Any]:
        """
        Test connection to Azure DevOps API.
        
        Returns:
            Dict with success status and message
        """
        try:
            # Test by getting project info
            response = self._make_request(
                'GET',
                f"{self.api_url}/{self.organization}/_apis/projects/{self.project}",
                headers=self.headers
            )
            
            if response.status_code == 200:
                return {
                    'success': True,
                    'message': 'Successfully connected to Azure DevOps',
                    'project': response.json().get('name')
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to connect to Azure DevOps: {response.status_code}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Connection error: {str(e)}'
            }
    
    def create_work_item(self, title: str, description: str, work_item_type: str = 'Bug', 
                        priority: str = '2', assignee: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a new work item in Azure DevOps.
        
        Args:
            title: Work item title
            description: Work item description
            work_item_type: Work item type (Bug, Task, Issue, etc.)
            priority: Priority (1-3, where 1 is highest)
            assignee: Assignee email or ID
            
        Returns:
            Dict with work item data or error
        """
        try:
            # Get work item type reference
            type_response = self._make_request(
                'GET',
                f"{self.api_url}/{self.organization}/{self.project}/_apis/wit/workitemtypes/{work_item_type}",
                headers=self.headers
            )
            
            if type_response.status_code != 200:
                return {
                    'success': False,
                    'message': f'Failed to get work item type: {type_response.status_code}'
                }

            # Create work item
            payload = [
                {
                    "op": "add",
                    "path": "/fields/System.Title",
                    "value": title
                },
                {
                    "op": "add",
                    "path": "/fields/System.Description",
                    "value": description
                },
                {
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Common.Priority",
                    "value": int(priority)
                }
            ]
            
            if assignee:
                payload.append({
                    "op": "add",
                    "path": "/fields/System.AssignedTo",
                    "value": assignee
                })
            
            # Azure DevOps work-item create/update use a JSON Patch document and
            # require the json-patch media type; plain application/json returns 415.
            patch_headers = dict(self.headers)
            patch_headers['Content-Type'] = 'application/json-patch+json'

            response = self._make_request(
                'POST',
                f"{self.api_url}/{self.organization}/{self.project}/_apis/wit/workitems/${work_item_type}",
                headers=patch_headers,
                json=payload
            )

            if response.status_code == 200:
                work_item = response.json()
                return {
                    'success': True,
                    'work_item_id': str(work_item.get('id')),
                    'work_item_url': f"{self.api_url}/{self.organization}/{self.project}/_workitems/edit/{work_item.get('id')}",
                    'work_item': work_item
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to create work item: {response.status_code} - {response.text}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error creating work item: {str(e)}'
            }
    
    def update_work_item(self, work_item_id: str, title: Optional[str] = None, 
                        description: Optional[str] = None, priority: Optional[str] = None) -> Dict[str, Any]:
        """
        Update an existing work item in Azure DevOps.
        
        Args:
            work_item_id: Work item ID
            title: New title (optional)
            description: New description (optional)
            priority: New priority (optional)
            
        Returns:
            Dict with work item data or error
        """
        try:
            payload = []
            
            if title:
                payload.append({
                    "op": "add",
                    "path": "/fields/System.Title",
                    "value": title
                })
            
            if description:
                payload.append({
                    "op": "add",
                    "path": "/fields/System.Description",
                    "value": description
                })
            
            if priority:
                payload.append({
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Common.Priority",
                    "value": int(priority)
                })

            if not payload:
                return {
                    'success': False,
                    'message': 'No fields provided to update'
                }

            # JSON Patch document requires the json-patch media type.
            patch_headers = dict(self.headers)
            patch_headers['Content-Type'] = 'application/json-patch+json'

            response = self._make_request(
                'PATCH',
                f"{self.api_url}/{self.organization}/{self.project}/_apis/wit/workitems/{work_item_id}",
                headers=patch_headers,
                json=payload
            )
            
            if response.status_code == 200:
                work_item = response.json()
                return {
                    'success': True,
                    'work_item': work_item
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to update work item: {response.status_code} - {response.text}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error updating work item: {str(e)}'
            }
    
    def get_work_item(self, work_item_id: str) -> Dict[str, Any]:
        """
        Get a work item from Azure DevOps.
        
        Args:
            work_item_id: Work item ID
            
        Returns:
            Dict with work item data or error
        """
        try:
            response = self._make_request(
                'GET',
                f"{self.api_url}/{self.organization}/{self.project}/_apis/wit/workitems/{work_item_id}",
                headers=self.headers
            )
            
            if response.status_code == 200:
                return {
                    'success': True,
                    'work_item': response.json()
                }
            else:
                return {
                    'success': False,
                    'message': f'Failed to get work item: {response.status_code}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error getting work item: {str(e)}'
            }
