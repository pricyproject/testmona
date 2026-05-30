import requests
from requests.auth import HTTPBasicAuth
from typing import Dict, List, Optional, Any
from .models import JiraIntegration
import base64
import json
import re
from urllib.parse import urlparse
import ipaddress


def is_safe_url(url: str) -> bool:
    """
    Validate URL to prevent SSRF attacks.
    Only allows http/https to public IPs.
    Blocks localhost, private IPs, and internal networks.
    """
    try:
        parsed = urlparse(url)
        
        # Only allow http and https
        if parsed.scheme not in ['http', 'https']:
            return False
        
        # Must have a hostname
        if not parsed.hostname:
            return False
        
        # Block localhost variants
        hostname = parsed.hostname.lower()
        if hostname in ['localhost', '127.0.0.1', '::1', '0.0.0.0']:
            return False
        
        # Block private IP ranges
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        except ValueError:
            # Not an IP address, check hostname
            pass
        
        # Block metadata services
        if 'metadata' in hostname or '169.254.169.254' in url:
            return False
        
        # Block internal network hostnames
        internal_patterns = [
            r'.*\.local$',
            r'.*\.internal$',
            r'.*\.corp$',
            r'.*\.private$',
        ]
        for pattern in internal_patterns:
            if re.match(pattern, hostname):
                return False
        
        return True
    except Exception:
        return False


class JiraService:
    def __init__(self, integration: JiraIntegration):
        self.integration = integration
        self.base_url = integration.jira_url.rstrip('/')
        
        # Validate URL to prevent SSRF attacks
        if not is_safe_url(self.base_url):
            raise ValueError(f"Invalid or unsafe Jira URL: {self.base_url}")
        
        self.auth = HTTPBasicAuth(integration.username, integration.api_token)
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }

    def test_connection(self) -> bool:
        """Test if the Jira connection is working"""
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/myself",
                auth=self.auth,
                headers=self.headers,
                timeout=10
            )
            return response.status_code == 200
        except Exception:
            return False

    def get_project_info(self) -> Optional[Dict]:
        """Get Jira project information"""
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/project/{self.integration.project_key}",
                auth=self.auth,
                headers=self.headers,
                timeout=10
            )
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass
        return None

    def create_issue(self, issue_data: Dict[str, Any]) -> Optional[Dict]:
        """Create a new Jira issue"""
        try:
            payload = {
                "fields": {
                    "project": {
                        "key": self.integration.project_key
                    },
                    "summary": issue_data.get("summary", ""),
                    "description": {
                        "type": "doc",
                        "version": 1,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": issue_data.get("description", "")
                                    }
                                ]
                            }
                        ]
                    },
                    "issuetype": {
                        "name": issue_data.get("issue_type", "Bug")
                    }
                }
            }

            # Add optional fields
            if issue_data.get("priority"):
                payload["fields"]["priority"] = {"name": issue_data["priority"]}
            
            if issue_data.get("assignee"):
                payload["fields"]["assignee"] = {"name": issue_data["assignee"]}

            response = requests.post(
                f"{self.base_url}/rest/api/3/issue",
                auth=self.auth,
                headers=self.headers,
                json=payload,
                timeout=10
            )

            if response.status_code == 201:
                return response.json()
        except Exception as e:
            print(f"Error creating Jira issue: {e}")
        return None

    def update_issue(self, issue_key: str, update_data: Dict[str, Any]) -> bool:
        """Update an existing Jira issue"""
        try:
            payload = {"fields": {}}
            
            if update_data.get("summary"):
                payload["fields"]["summary"] = update_data["summary"]
            
            if update_data.get("description"):
                payload["fields"]["description"] = {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": update_data["description"]
                                }
                            ]
                        }
                    ]
                }
            
            if update_data.get("assignee"):
                payload["fields"]["assignee"] = {"name": update_data["assignee"]}
            
            if update_data.get("priority"):
                payload["fields"]["priority"] = {"name": update_data["priority"]}

            response = requests.put(
                f"{self.base_url}/rest/api/3/issue/{issue_key}",
                auth=self.auth,
                headers=self.headers,
                json=payload,
                timeout=10
            )
            
            return response.status_code in [200, 204]
        except Exception as e:
            print(f"Error updating Jira issue: {e}")
        return False

    def get_issue(self, issue_key: str) -> Optional[Dict]:
        """Get issue details from Jira"""
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/issue/{issue_key}",
                auth=self.auth,
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            print(f"Error getting Jira issue: {e}")
        return None

    def add_comment(self, issue_key: str, comment: str) -> bool:
        """Add a comment to a Jira issue"""
        try:
            payload = {
                "body": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": comment
                                }
                            ]
                        }
                    ]
                }
            }

            response = requests.post(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/comment",
                auth=self.auth,
                headers=self.headers,
                json=payload,
                timeout=10
            )
            
            return response.status_code == 201
        except Exception as e:
            print(f"Error adding comment to Jira issue: {e}")
        return False

    def transition_issue(self, issue_key: str, transition_name: str) -> bool:
        """Transition issue to a new status"""
        try:
            # First get available transitions
            response = requests.get(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/transitions",
                auth=self.auth,
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                transitions = response.json().get("transitions", [])
                target_transition = None
                
                for transition in transitions:
                    if transition["name"].lower() == transition_name.lower():
                        target_transition = transition
                        break
                
                if target_transition:
                    payload = {
                        "transition": {
                            "id": target_transition["id"]
                        }
                    }
                    
                    response = requests.post(
                        f"{self.base_url}/rest/api/3/issue/{issue_key}/transitions",
                        auth=self.auth,
                        headers=self.headers,
                        json=payload,
                        timeout=10
                    )
                    
                    return response.status_code == 204
        except Exception as e:
            print(f"Error transitioning Jira issue: {e}")
        return False

    def search_issues(self, jql: str) -> Optional[List[Dict]]:
        """Search for issues using JQL"""
        try:
            payload = {
                "jql": jql,
                "fields": ["id", "key", "summary", "status", "assignee", "priority", "created", "updated"]
            }

            response = requests.post(
                f"{self.base_url}/rest/api/3/search",
                auth=self.auth,
                headers=self.headers,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                return response.json().get("issues", [])
        except Exception as e:
            print(f"Error searching Jira issues: {e}")
        return None
