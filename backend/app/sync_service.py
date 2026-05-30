"""
Sync service for handling defect synchronization with external issue trackers.
Maps application defects to GitHub/GitLab/Jira/Azure DevOps/Linear/Asana issues and handles bidirectional sync.
"""
from typing import Dict, Any, Optional, List
from datetime import datetime
import html
from .github_client import GitHubClient
from .gitlab_client import GitLabClient
from .jira_service import JiraService
from .azure_devops_client import AzureDevOpsClient
from .linear_client import LinearClient
from .asana_client import AsanaClient


class SyncService:
    """Service for syncing defects with external issue trackers."""
    DEFAULT_APP_NAME = "TestMona"
    
    @staticmethod
    def sanitize_text(text: Optional[str]) -> str:
        """
        Sanitize text before sending to external APIs.
        
        Args:
            text: Text to sanitize
            
        Returns:
            Sanitized text
        """
        if not text:
            return ""
        
        # Convert to string if not already
        text = str(text)
        
        # Escape HTML entities to prevent XSS
        text = html.escape(text)
        
        # Remove null bytes
        text = text.replace('\x00', '')
        
        # Trim whitespace
        text = text.strip()
        
        # Limit length to prevent oversized payloads
        max_length = 65535  # GitHub/GitLab max body length
        if len(text) > max_length:
            text = text[:max_length] + "\n\n[...truncated due to length limit]"
        
        return text

    @staticmethod
    def get_app_name(defect: Dict[str, Any]) -> str:
        """Return the configured app name for external sync references."""
        return SyncService.sanitize_text(defect.get('app_name') or SyncService.DEFAULT_APP_NAME)

    @staticmethod
    def build_sync_reference(defect: Dict[str, Any]) -> str:
        """Build the footer used to identify synced defects in external systems."""
        app_name = SyncService.get_app_name(defect)
        defect_id = SyncService.sanitize_text(defect.get('defect_id', 'N/A'))
        return f"\n---\n*Synced from {app_name} - Defect ID: {defect_id}*"
    
    @staticmethod
    def map_defect_to_github(defect: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map an application defect to a GitHub issue format.
        
        Args:
            defect: application defect data
            
        Returns:
            Dict with GitHub issue data
        """
        # Sanitize all text fields
        title = SyncService.sanitize_text(defect.get('title', '')) or 'Untitled Defect'
        description_parts = []
        
        if defect.get('description'):
            description_parts.append(SyncService.sanitize_text(defect['description']))
        
        if defect.get('severity'):
            description_parts.append(f"**Severity:** {SyncService.sanitize_text(defect['severity'])}")
        
        if defect.get('priority'):
            description_parts.append(f"**Priority:** {SyncService.sanitize_text(defect['priority'])}")
        
        if defect.get('status'):
            description_parts.append(f"**Status:** {SyncService.sanitize_text(defect['status'])}")
        
        if defect.get('steps_to_reproduce'):
            description_parts.append(f"**Steps to Reproduce:**\n{SyncService.sanitize_text(defect['steps_to_reproduce'])}")
        
        if defect.get('environment'):
            description_parts.append(f"**Environment:** {SyncService.sanitize_text(defect['environment'])}")
        
        if defect.get('expected_result'):
            description_parts.append(f"**Expected Result:** {SyncService.sanitize_text(defect['expected_result'])}")
        
        if defect.get('actual_result'):
            description_parts.append(f"**Actual Result:** {SyncService.sanitize_text(defect['actual_result'])}")
        
        if defect.get('root_cause'):
            description_parts.append(f"**Root Cause:**\n{SyncService.sanitize_text(defect['root_cause'])}")
        
        description_parts.append(SyncService.build_sync_reference(defect))
        
        body = '\n'.join(description_parts)
        
        # Map labels
        labels = []
        
        # Add severity as label
        if defect.get('severity'):
            labels.append(f"severity:{SyncService.sanitize_text(defect['severity']).lower()}")
        
        # Add priority as label
        if defect.get('priority'):
            labels.append(f"priority:{SyncService.sanitize_text(defect['priority']).lower()}")
        
        # Add status as label
        if defect.get('status'):
            labels.append(f"status:{SyncService.sanitize_text(defect['status']).lower().replace('_', '-')}")
        
        # Map assignee
        assignee = None
        if defect.get('assignee'):
            assignee = SyncService.sanitize_text(str(defect['assignee']))
            # For now, we'll skip this or use email as placeholder
            assignee = None
        
        return {
            'title': title,
            'body': body,
            'labels': labels,
            'assignee': assignee
        }
    
    @staticmethod
    def map_defect_to_gitlab(defect: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map an application defect to a GitLab issue format.
        
        Args:
            defect: application defect data
            
        Returns:
            Dict with GitLab issue data
        """
        # Build issue description from defect fields
        description_parts = []
        
        if defect.get('description'):
            description_parts.append(f"## Description\n{SyncService.sanitize_text(defect['description'])}\n")
        
        if defect.get('steps_to_reproduce'):
            description_parts.append(f"## Steps to Reproduce\n```\n{SyncService.sanitize_text(defect['steps_to_reproduce'])}\n```\n")
        
        if defect.get('expected_result'):
            description_parts.append(f"## Expected Result\n{SyncService.sanitize_text(defect['expected_result'])}\n")
        
        if defect.get('actual_result'):
            description_parts.append(f"## Actual Result\n{SyncService.sanitize_text(defect['actual_result'])}\n")
        
        if defect.get('environment'):
            description_parts.append(f"## Environment\n{SyncService.sanitize_text(defect['environment'])}\n")
        
        if defect.get('browser_info'):
            description_parts.append(f"## Browser\n{SyncService.sanitize_text(defect['browser_info'])}\n")
        
        if defect.get('root_cause'):
            description_parts.append(f"## Root Cause\n{SyncService.sanitize_text(defect['root_cause'])}\n")
        
        description_parts.append(SyncService.build_sync_reference(defect))
        
        description = '\n'.join(description_parts)
        
        # Map labels
        labels = []
        
        # Add severity as label
        if defect.get('severity'):
            labels.append(f"severity::{SyncService.sanitize_text(defect['severity']).lower()}")
        
        # Add priority as label
        if defect.get('priority'):
            labels.append(f"priority::{SyncService.sanitize_text(defect['priority']).lower()}")
        
        # Add status as label
        if defect.get('status'):
            labels.append(f"status::{SyncService.sanitize_text(defect['status']).lower().replace('_', '-')}")
        
        # Add tags if present
        if defect.get('tags'):
            tags = defect['tags'].split(',') if isinstance(defect['tags'], str) else defect['tags']
            labels.extend([tag.strip() for tag in tags if tag.strip()])
        
        return {
            'title': SyncService.sanitize_text(defect.get('title', 'Untitled Defect')),
            'description': description,
            'labels': labels
        }
    
    @staticmethod
    def map_defect_to_jira(defect: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map an application defect to a Jira issue format.
        
        Args:
            defect: application defect data
            
        Returns:
            Dict with Jira issue data
        """
        # Sanitize all text fields
        summary = SyncService.sanitize_text(defect.get('title', ''))
        
        # Build description
        description_parts = []
        
        if defect.get('description'):
            description_parts.append(SyncService.sanitize_text(defect['description']))
        
        if defect.get('severity'):
            description_parts.append(f"**Severity:** {SyncService.sanitize_text(defect['severity'])}")
        
        if defect.get('priority'):
            description_parts.append(f"**Priority:** {SyncService.sanitize_text(defect['priority'])}")
        
        if defect.get('status'):
            description_parts.append(f"**Status:** {SyncService.sanitize_text(defect['status'])}")
        
        if defect.get('steps_to_reproduce'):
            description_parts.append(f"**Steps to Reproduce:**\n{SyncService.sanitize_text(defect['steps_to_reproduce'])}")
        
        if defect.get('environment'):
            description_parts.append(f"**Environment:** {SyncService.sanitize_text(defect['environment'])}")
        
        if defect.get('expected_result'):
            description_parts.append(f"**Expected Result:** {SyncService.sanitize_text(defect['expected_result'])}")
        
        if defect.get('actual_result'):
            description_parts.append(f"**Actual Result:** {SyncService.sanitize_text(defect['actual_result'])}")
        
        if defect.get('root_cause'):
            description_parts.append(f"**Root Cause:**\n{SyncService.sanitize_text(defect['root_cause'])}")
        
        description_parts.append(SyncService.build_sync_reference(defect))
        
        description = '\n'.join(description_parts)
        
        # Map priority
        priority_map = {
            'low': 'Low',
            'medium': 'Medium',
            'high': 'High',
            'critical': 'Highest'
        }
        priority = priority_map.get(defect.get('priority', 'medium').lower(), 'Medium')
        
        return {
            'summary': summary,
            'description': description,
            'priority': priority,
            'issue_type': 'Bug'
        }
    
    @staticmethod
    def map_jira_to_defect(issue: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map a Jira issue to an application defect format.
        
        Args:
            issue: Jira issue data
            
        Returns:
            Dict with defect data
        """
        fields = issue.get('fields', {})
        
        # Extract description from Jira's Atlassian Document Format
        description = ''
        description_obj = fields.get('description')
        if description_obj and isinstance(description_obj, dict):
            content = description_obj.get('content', [])
            if content and isinstance(content, list):
                text_parts = []
                for item in content:
                    if isinstance(item, dict):
                        item_content = item.get('content', [])
                        if isinstance(item_content, list):
                            for text_item in item_content:
                                if isinstance(text_item, dict):
                                    text_parts.append(text_item.get('text', ''))
                description = ' '.join(text_parts)
        
        # Map priority
        priority_obj = fields.get('priority')
        priority = 'medium'
        if priority_obj:
            priority_name = priority_obj.get('name', '').lower()
            if 'highest' in priority_name or 'critical' in priority_name:
                priority = 'critical'
            elif 'high' in priority_name:
                priority = 'high'
            elif 'low' in priority_name:
                priority = 'low'
        
        # Map status
        status_obj = fields.get('status')
        status = 'open'
        if status_obj:
            status_name = status_obj.get('name', '').lower()
            if 'done' in status_name or 'closed' in status_name or 'resolved' in status_name:
                status = 'closed'
            elif 'in progress' in status_name:
                status = 'in_progress'
        
        return {
            'title': fields.get('summary', ''),
            'description': description,
            'severity': 'medium',  # Jira doesn't have severity, default to medium
            'priority': priority,
            'status': status,
            'external_issue_id': issue.get('key'),
            'external_issue_url': f"{fields.get('self', '')}",
            'external_sync_status': 'synced'
        }
    
    @staticmethod
    def map_defect_to_azure_devops(defect: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map an application defect to an Azure DevOps work item format.
        
        Args:
            defect: application defect data
            
        Returns:
            Dict with Azure DevOps work item data
        """
        # Sanitize all text fields
        title = SyncService.sanitize_text(defect.get('title', ''))
        
        # Build description
        description_parts = []
        
        if defect.get('description'):
            description_parts.append(SyncService.sanitize_text(defect['description']))
        
        if defect.get('severity'):
            description_parts.append(f"**Severity:** {SyncService.sanitize_text(defect['severity'])}")
        
        if defect.get('priority'):
            description_parts.append(f"**Priority:** {SyncService.sanitize_text(defect['priority'])}")
        
        if defect.get('status'):
            description_parts.append(f"**Status:** {SyncService.sanitize_text(defect['status'])}")
        
        if defect.get('steps_to_reproduce'):
            description_parts.append(f"**Steps to Reproduce:**\n{SyncService.sanitize_text(defect['steps_to_reproduce'])}")
        
        if defect.get('environment'):
            description_parts.append(f"**Environment:** {SyncService.sanitize_text(defect['environment'])}")
        
        if defect.get('expected_result'):
            description_parts.append(f"**Expected Result:** {SyncService.sanitize_text(defect['expected_result'])}")
        
        if defect.get('actual_result'):
            description_parts.append(f"**Actual Result:** {SyncService.sanitize_text(defect['actual_result'])}")
        
        if defect.get('root_cause'):
            description_parts.append(f"**Root Cause:**\n{SyncService.sanitize_text(defect['root_cause'])}")
        
        description_parts.append(SyncService.build_sync_reference(defect))
        
        description = '\n'.join(description_parts)
        
        # Map priority (Azure DevOps uses 1-3, where 1 is highest)
        priority_map = {
            'critical': '1',
            'high': '1',
            'medium': '2',
            'low': '3'
        }
        priority = priority_map.get(defect.get('priority', 'medium').lower(), '2')
        
        return {
            'title': title,
            'description': description,
            'priority': priority,
            'work_item_type': 'Bug'
        }
    
    @staticmethod
    def map_defect_to_linear(defect: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map an application defect to a Linear issue format.
        
        Args:
            defect: application defect data
            
        Returns:
            Dict with Linear issue data
        """
        # Sanitize all text fields
        title = SyncService.sanitize_text(defect.get('title', ''))
        
        # Build description
        description_parts = []
        
        if defect.get('description'):
            description_parts.append(SyncService.sanitize_text(defect['description']))
        
        if defect.get('severity'):
            description_parts.append(f"**Severity:** {SyncService.sanitize_text(defect['severity'])}")
        
        if defect.get('priority'):
            description_parts.append(f"**Priority:** {SyncService.sanitize_text(defect['priority'])}")
        
        if defect.get('status'):
            description_parts.append(f"**Status:** {SyncService.sanitize_text(defect['status'])}")
        
        if defect.get('steps_to_reproduce'):
            description_parts.append(f"**Steps to Reproduce:**\n{SyncService.sanitize_text(defect['steps_to_reproduce'])}")
        
        if defect.get('environment'):
            description_parts.append(f"**Environment:** {SyncService.sanitize_text(defect['environment'])}")
        
        if defect.get('expected_result'):
            description_parts.append(f"**Expected Result:** {SyncService.sanitize_text(defect['expected_result'])}")
        
        if defect.get('actual_result'):
            description_parts.append(f"**Actual Result:** {SyncService.sanitize_text(defect['actual_result'])}")
        
        if defect.get('root_cause'):
            description_parts.append(f"**Root Cause:**\n{SyncService.sanitize_text(defect['root_cause'])}")
        
        description_parts.append(SyncService.build_sync_reference(defect))
        
        description = '\n'.join(description_parts)
        
        # Map priority
        priority_map = {
            'critical': 'Urgent',
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low'
        }
        priority = priority_map.get(defect.get('priority', 'medium').lower(), 'Medium')
        
        return {
            'title': title,
            'description': description,
            'priority': priority,
            'issue_type': 'Bug'
        }
    
    @staticmethod
    def map_defect_to_asana(defect: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map an application defect to an Asana task format.
        
        Args:
            defect: application defect data
            
        Returns:
            Dict with Asana task data
        """
        # Sanitize all text fields
        name = SyncService.sanitize_text(defect.get('title', ''))
        
        # Build description
        description_parts = []
        
        if defect.get('description'):
            description_parts.append(SyncService.sanitize_text(defect['description']))
        
        if defect.get('severity'):
            description_parts.append(f"**Severity:** {SyncService.sanitize_text(defect['severity'])}")
        
        if defect.get('priority'):
            description_parts.append(f"**Priority:** {SyncService.sanitize_text(defect['priority'])}")
        
        if defect.get('status'):
            description_parts.append(f"**Status:** {SyncService.sanitize_text(defect['status'])}")
        
        if defect.get('steps_to_reproduce'):
            description_parts.append(f"**Steps to Reproduce:**\n{SyncService.sanitize_text(defect['steps_to_reproduce'])}")
        
        if defect.get('environment'):
            description_parts.append(f"**Environment:** {SyncService.sanitize_text(defect['environment'])}")
        
        if defect.get('expected_result'):
            description_parts.append(f"**Expected Result:** {SyncService.sanitize_text(defect['expected_result'])}")
        
        if defect.get('actual_result'):
            description_parts.append(f"**Actual Result:** {SyncService.sanitize_text(defect['actual_result'])}")
        
        if defect.get('root_cause'):
            description_parts.append(f"**Root Cause:**\n{SyncService.sanitize_text(defect['root_cause'])}")
        
        description_parts.append(SyncService.build_sync_reference(defect))
        
        notes = '\n'.join(description_parts)
        
        # Map priority
        priority_map = {
            'critical': 'High',
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low'
        }
        priority = priority_map.get(defect.get('priority', 'medium').lower(), 'Medium')
        
        return {
            'name': name,
            'notes': notes,
            'priority': priority
        }
    
    @staticmethod
    def map_github_to_defect(issue: Dict[str, Any]) -> Dict[str, Any]:
        # Extract labels
        labels = issue.get('labels', [])
        severity = None
        priority = None
        status = None
        tags = []
        
        for label in labels:
            label_name = label.get('name', '')
            if label_name.startswith('severity:'):
                severity = label_name.replace('severity:', '')
            elif label_name.startswith('priority:'):
                priority = label_name.replace('priority:', '')
            elif label_name.startswith('status:'):
                status = label_name.replace('status:', '')
            else:
                tags.append(label_name)
        
        # Map GitHub state to the local defect status
        github_state = issue.get('state', 'open')
        if not status:
            if github_state == 'open':
                status = 'open'
            elif github_state == 'closed':
                status = 'closed'
        
        return {
            'title': issue.get('title'),
            'description': issue.get('body', '').split('---')[0].strip(),  # Get content before sync reference
            'severity': severity or 'medium',
            'priority': priority or 'medium',
            'status': status,
            'tags': ','.join(tags) if tags else None,
            'external_issue_id': str(issue.get('number')),
            'external_issue_url': issue.get('html_url'),
            'external_sync_status': 'synced'
        }
    
    @staticmethod
    def map_gitlab_to_defect(issue: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map a GitLab issue to the local defect format.
        
        Args:
            issue: GitLab issue data
            
        Returns:
            Dict with local defect data
        """
        # Extract labels
        labels = issue.get('labels', [])
        severity = None
        priority = None
        status = None
        tags = []
        
        for label in labels:
            if label.startswith('severity::'):
                severity = label.replace('severity::', '')
            elif label.startswith('priority::'):
                priority = label.replace('priority::', '')
            elif label.startswith('status::'):
                status = label.replace('status::', '')
            else:
                tags.append(label)
        
        # Map GitLab state to the local defect status
        gitlab_state = issue.get('state', 'opened')
        if not status:
            if gitlab_state == 'opened':
                status = 'open'
            elif gitlab_state == 'closed':
                status = 'closed'
        
        return {
            'title': issue.get('title'),
            'description': issue.get('description', '').split('---')[0].strip(),  # Get content before sync reference
            'severity': severity or 'medium',
            'priority': priority or 'medium',
            'status': status,
            'tags': ','.join(tags) if tags else None,
            'external_issue_id': str(issue.get('iid')),
            'external_issue_url': issue.get('web_url'),
            'external_sync_status': 'synced'
        }
    
    @staticmethod
    def create_github_client(integration: Dict[str, Any], timeout: int = 30) -> GitHubClient:
        """
        Create a GitHub client from integration configuration.
        
        Args:
            integration: Integration configuration
            timeout: Timeout for API requests (optional, default: 30)
            
        Returns:
            GitHubClient instance
        """
        # Parse project_key to get owner and repo
        project_key = integration.get('project_key', '')
        if '/' in project_key:
            owner, repo = project_key.split('/', 1)
        else:
            owner = project_key
            repo = None
        
        api_url = integration.get('api_url', 'https://api.github.com')
        api_token = integration.get('api_token', '')
        
        return GitHubClient(
            api_url=api_url,
            api_token=api_token,
            repository_owner=owner,
            repository_name=repo,
            timeout=timeout
        )
    
    @staticmethod
    def create_jira_client(integration: Dict[str, Any], timeout: int = 30) -> JiraService:
        """
        Create a Jira service from integration configuration.
        
        Args:
            integration: Integration configuration
            timeout: Timeout for API requests (optional, default: 30)
            
        Returns:
            JiraService instance
        """
        from .models import JiraIntegration
        
        # Create a JiraIntegration object from the integration dict
        jira_integration = JiraIntegration(
            jira_url=integration.get('api_url', ''),
            username=integration.get('username', ''),
            api_token=integration.get('api_token', ''),
            project_key=integration.get('project_key', ''),
            name=integration.get('name', '')
        )
        
        return JiraService(jira_integration)
    
    @staticmethod
    def create_azure_devops_client(integration: Dict[str, Any], timeout: int = 30) -> AzureDevOpsClient:
        """
        Create an Azure DevOps client from integration configuration.
        
        Args:
            integration: Integration configuration
            timeout: Timeout for API requests (optional, default: 30)
            
        Returns:
            AzureDevOpsClient instance
        """
        # Parse project_key to get organization and project
        project_key = integration.get('project_key', '')
        if '/' in project_key:
            organization, project = project_key.split('/', 1)
        else:
            organization = project_key
            project = None
        
        api_url = integration.get('api_url', 'https://dev.azure.com')
        api_token = integration.get('api_token', '')
        
        return AzureDevOpsClient(
            api_url=api_url,
            api_token=api_token,
            organization=organization,
            project=project or '',
            timeout=timeout
        )
    
    @staticmethod
    def create_linear_client(integration: Dict[str, Any], timeout: int = 30) -> LinearClient:
        """
        Create a Linear client from integration configuration.
        
        Args:
            integration: Integration configuration
            timeout: Timeout for API requests (optional, default: 30)
            
        Returns:
            LinearClient instance
        """
        api_url = integration.get('api_url', 'https://api.linear.app')
        api_token = integration.get('api_token', '')
        team_key = integration.get('project_key', '')
        
        return LinearClient(
            api_url=api_url,
            api_token=api_token,
            team_key=team_key,
            timeout=timeout
        )
    
    @staticmethod
    def create_asana_client(integration: Dict[str, Any], timeout: int = 30) -> AsanaClient:
        """
        Create an Asana client from integration configuration.
        
        Args:
            integration: Integration configuration
            timeout: Timeout for API requests (optional, default: 30)
            
        Returns:
            AsanaClient instance
        """
        # Parse project_key to get workspace and project
        project_key = integration.get('project_key', '')
        if '/' in project_key:
            workspace_id, project_id = project_key.split('/', 1)
        else:
            workspace_id = project_key
            project_id = None
        
        api_url = integration.get('api_url', 'https://app.asana.com/api/1.0')
        api_token = integration.get('api_token', '')
        
        return AsanaClient(
            api_url=api_url,
            api_token=api_token,
            workspace_id=workspace_id,
            project_id=project_id or '',
            timeout=timeout
        )
    
    @staticmethod
    def create_gitlab_client(integration: Dict[str, Any], timeout: int = 30) -> GitLabClient:
        """
        Create a GitLab client from integration configuration.
        
        Args:
            integration: Integration configuration
            timeout: Timeout for API requests (optional, default: 30)
            
        Returns:
            GitLabClient instance
        """
        # Parse project_key to get namespace and project
        project_key = integration.get('project_key', '')
        if '/' in project_key:
            namespace, project = project_key.split('/', 1)
        else:
            namespace = project_key
            project = None
        
        api_url = integration.get('api_url', 'https://gitlab.com/api/v4')
        api_token = integration.get('api_token', '')
        
        return GitLabClient(
            api_url=api_url,
            api_token=api_token,
            namespace=namespace,
            project_name=project,
            timeout=timeout
        )
    
    @staticmethod
    def sync_defect_to_external(defect: Dict[str, Any], integration: Dict[str, Any], 
                               action: str = 'create') -> Dict[str, Any]:
        """
        Sync a defect to an external issue tracker.
        
        Args:
            defect: application defect data
            integration: Integration configuration
            action: Sync action ('create' or 'update')
            
        Returns:
            Dict with sync result
        """
        tracker_type = integration.get('tracker_type', '').lower()
        
        try:
            if tracker_type == 'github':
                client = SyncService.create_github_client(integration, timeout=30)
                issue_data = SyncService.map_defect_to_github(defect)
                
                if action == 'create':
                    result = client.create_issue(
                        title=issue_data['title'],
                        body=issue_data['body'],
                        labels=issue_data['labels'],
                        assignee=issue_data['assignee']
                    )
                else:  # update
                    if defect.get('external_issue_id'):
                        result = client.update_issue(
                            issue_number=int(defect['external_issue_id']),
                            title=issue_data['title'],
                            body=issue_data['body'],
                            labels=issue_data['labels']
                        )
                    else:
                        return {
                            'success': False,
                            'message': 'Cannot update: defect has no external_issue_id'
                        }
                
                return result
            
            elif tracker_type == 'gitlab':
                client = SyncService.create_gitlab_client(integration, timeout=30)
                issue_data = SyncService.map_defect_to_gitlab(defect)
                
                if action == 'create':
                    result = client.create_issue(
                        title=issue_data['title'],
                        description=issue_data['description'],
                        labels=issue_data['labels']
                    )
                else:  # update
                    if defect.get('external_issue_id'):
                        result = client.update_issue(
                            issue_iid=int(defect['external_issue_id']),
                            title=issue_data['title'],
                            description=issue_data['description'],
                            labels=issue_data['labels']
                        )
                    else:
                        return {
                            'success': False,
                            'message': 'Cannot update: defect has no external_issue_id'
                        }
                
                return result
            
            elif tracker_type == 'jira':
                client = SyncService.create_jira_client(integration, timeout=30)
                issue_data = SyncService.map_defect_to_jira(defect)
                
                if action == 'create':
                    result = client.create_issue(issue_data)
                    if result:
                        return {
                            'success': True,
                            'issue_id': result.get('key'),
                            'issue_url': f"{client.base_url}/browse/{result.get('key')}"
                        }
                    else:
                        return {
                            'success': False,
                            'message': 'Failed to create Jira issue'
                        }
                else:  # update
                    if defect.get('external_issue_id'):
                        success = client.update_issue(defect['external_issue_id'], issue_data)
                        if success:
                            return {
                                'success': True,
                                'issue_id': defect['external_issue_id'],
                                'issue_url': f"{client.base_url}/browse/{defect['external_issue_id']}"
                            }
                        else:
                            return {
                                'success': False,
                                'message': 'Failed to update Jira issue'
                            }
                    else:
                        return {
                            'success': False,
                            'message': 'Cannot update: defect has no external_issue_id'
                        }
            
            elif tracker_type == 'azure-devops':
                client = SyncService.create_azure_devops_client(integration, timeout=30)
                issue_data = SyncService.map_defect_to_azure_devops(defect)
                
                if action == 'create':
                    result = client.create_work_item(
                        title=issue_data['title'],
                        description=issue_data['description'],
                        work_item_type=issue_data['work_item_type'],
                        priority=issue_data['priority']
                    )
                    return result
                else:  # update
                    if defect.get('external_issue_id'):
                        result = client.update_work_item(
                            work_item_id=defect['external_issue_id'],
                            title=issue_data['title'],
                            description=issue_data['description'],
                            priority=issue_data['priority']
                        )
                        return result
                    else:
                        return {
                            'success': False,
                            'message': 'Cannot update: defect has no external_issue_id'
                        }
            
            elif tracker_type == 'linear':
                client = SyncService.create_linear_client(integration, timeout=30)
                issue_data = SyncService.map_defect_to_linear(defect)
                
                if action == 'create':
                    result = client.create_issue(
                        title=issue_data['title'],
                        description=issue_data['description'],
                        issue_type=issue_data['issue_type'],
                        priority=issue_data['priority']
                    )
                    return result
                else:  # update
                    if defect.get('external_issue_id'):
                        result = client.update_issue(
                            issue_id=defect['external_issue_id'],
                            title=issue_data['title'],
                            description=issue_data['description'],
                            priority=issue_data['priority']
                        )
                        return result
                    else:
                        return {
                            'success': False,
                            'message': 'Cannot update: defect has no external_issue_id'
                        }
            
            elif tracker_type == 'asana':
                client = SyncService.create_asana_client(integration, timeout=30)
                issue_data = SyncService.map_defect_to_asana(defect)
                
                if action == 'create':
                    result = client.create_task(
                        name=issue_data['name'],
                        notes=issue_data['notes'],
                        priority=issue_data['priority']
                    )
                    return result
                else:  # update
                    if defect.get('external_issue_id'):
                        result = client.update_task(
                            task_id=defect['external_issue_id'],
                            name=issue_data['name'],
                            notes=issue_data['notes'],
                            priority=issue_data['priority']
                        )
                        return result
                    else:
                        return {
                            'success': False,
                            'message': 'Cannot update: defect has no external_issue_id'
                        }
            
            else:
                return {
                    'success': False,
                    'message': f'Unsupported tracker type: {tracker_type}'
                }
        
        except Exception as e:
            return {
                'success': False,
                'message': f'Sync error: {str(e)}'
            }
    
    @staticmethod
    def test_connection(integration: Dict[str, Any]) -> Dict[str, Any]:
        """
        Test connection to an external issue tracker.
        
        Args:
            integration: Integration configuration
            
        Returns:
            Dict with test result
        """
        tracker_type = integration.get('tracker_type', '').lower()
        
        try:
            if tracker_type == 'github':
                client = SyncService.create_github_client(integration, timeout=30)
                return client.test_connection()
            
            elif tracker_type == 'gitlab':
                client = SyncService.create_gitlab_client(integration, timeout=30)
                return client.test_connection()
            
            elif tracker_type == 'jira':
                client = SyncService.create_jira_client(integration, timeout=30)
                success = client.test_connection()
                if success:
                    return {
                        'success': True,
                        'message': 'Successfully connected to Jira'
                    }
                else:
                    return {
                        'success': False,
                        'message': 'Failed to connect to Jira'
                    }
            
            elif tracker_type == 'azure-devops':
                client = SyncService.create_azure_devops_client(integration, timeout=30)
                return client.test_connection()
            
            elif tracker_type == 'linear':
                client = SyncService.create_linear_client(integration, timeout=30)
                return client.test_connection()
            
            elif tracker_type == 'asana':
                client = SyncService.create_asana_client(integration, timeout=30)
                return client.test_connection()
            
            else:
                return {
                    'success': False,
                    'message': f'Unsupported tracker type: {tracker_type}'
                }
        
        except Exception as e:
            return {
                'success': False,
                'message': f'Connection test error: {str(e)}'
            }
