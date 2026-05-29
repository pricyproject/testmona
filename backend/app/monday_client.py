"""
Monday.com API client for issue tracker integration.
Handles reading items from Monday boards via the GraphQL API.
"""
import requests
from typing import Optional, Dict, Any
from .base_client import BaseClient


class MondayClient(BaseClient):
    """Client for interacting with the Monday.com API."""

    def __init__(self, api_url: str, api_token: str, board_id: Optional[str] = None, timeout: int = 30):
        """
        Initialize Monday client.

        Args:
            api_url: Monday API URL (e.g., https://api.monday.com/v2)
            api_token: Monday personal API token
            board_id: Default board ID (optional)
            timeout: Timeout for API requests (optional, default: 30)
        """
        super().__init__(timeout=timeout)
        self.api_url = api_url.rstrip('/')
        self.api_token = api_token
        self.board_id = board_id

    def get_headers(self) -> Dict[str, str]:
        """Get Monday API headers."""
        return {
            'Authorization': self.api_token,
            'Content-Type': 'application/json',
            'API-Version': '2023-10',
        }

    def get_rate_limit_status_code(self) -> int:
        """Monday returns 429 for rate limiting."""
        return 429

    def handle_rate_limit(self, response: requests.Response) -> Optional[int]:
        """Handle Monday rate limiting."""
        retry_after = response.headers.get('Retry-After')
        if retry_after:
            try:
                return int(retry_after)
            except ValueError:
                pass
        return 60

    def get_error_message(self, status_code: int) -> str:
        """Get error message for Monday status codes."""
        if status_code == 401:
            return "Monday API authentication failed. Invalid or expired token."
        elif status_code == 403:
            return "Monday API access forbidden. Check permissions."
        elif status_code == 404:
            return "Resource not found in Monday."
        elif status_code >= 500:
            return f"Monday API server error: {status_code}"
        return f"Monday API error: {status_code}"

    def test_connection(self) -> Dict[str, Any]:
        """Test connection to Monday API."""
        try:
            response = self._make_request(
                'POST',
                self.api_url,
                headers=self.headers,
                json={'query': 'query { me { id name email } }'},
            )
            if response.status_code == 200:
                data = response.json()
                if data.get('errors'):
                    return {'success': False, 'message': f"GraphQL error: {data['errors'][0].get('message')}"}
                return {
                    'success': True,
                    'message': 'Successfully connected to Monday',
                    'user': data.get('data', {}).get('me', {}),
                }
            return {'success': False, 'message': f'Failed to connect to Monday: {response.status_code}'}
        except Exception as e:
            return {'success': False, 'message': f'Connection error: {str(e)}'}

    def get_item(self, item_id: str) -> Dict[str, Any]:
        """
        Get a single item (and its column values) from Monday.

        Args:
            item_id: Monday item ID

        Returns:
            Dict with item data or error
        """
        try:
            query = {
                'query': '''
                    query ($itemId: [ID!]) {
                        items (ids: $itemId) {
                            id
                            name
                            url
                            board { id name }
                            column_values { id text type }
                        }
                    }
                ''',
                'variables': {'itemId': [str(item_id)]},
            }

            response = self._make_request(
                'POST',
                self.api_url,
                headers=self.headers,
                json=query,
            )

            if response.status_code != 200:
                return {'success': False, 'message': f'Failed to get item: {response.status_code}'}

            data = response.json()
            if data.get('errors'):
                return {'success': False, 'message': f"GraphQL error: {data['errors'][0].get('message')}"}

            items = (data.get('data') or {}).get('items') or []
            if not items:
                return {'success': False, 'message': 'Item not found'}

            return {'success': True, 'item': items[0]}
        except Exception as e:
            return {'success': False, 'message': f'Error getting item: {str(e)}'}
