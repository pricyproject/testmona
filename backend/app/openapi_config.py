"""
OpenAPI/Swagger configuration for the Test Management System API.
This module centralizes all API documentation settings to keep main.py modular.
"""


def get_openapi_config():
    """
    Returns the FastAPI configuration dictionary for OpenAPI/Swagger documentation.
    
    This includes:
    - API title, description, and version
    - Contact information
    - License information
    - Organized tags for grouping endpoints
    """
    return {
        "title": "Test Management System API",
        "description": """
        Comprehensive Test Management System API for managing test cases, test suites, requirements, defects, and test execution.
        
        ## Features
        - **Project Management**: Create and manage test projects with team assignments
        - **Test Management**: Create test suites, test cases, and test steps
        - **Test Execution**: Schedule and execute test runs with detailed results
        - **Defect Management**: Track and manage defects with severity and priority
        - **Requirements Management**: Link requirements to test cases for traceability
        - **User Management**: User authentication, roles, and permissions
        - **Analytics**: Dashboard with test coverage and execution statistics
        
        ## Authentication
        Most endpoints require JWT authentication. Use the `/token` endpoint to obtain an access token.
        
        ## Rate Limiting
        API is rate-limited to 1000 requests per 60 seconds per IP address.
        
        ## Common Error Responses
        
        ### 400 Bad Request
        - Invalid request data or parameters
        - Duplicate resource (e.g., username/email already exists)
        - Business logic violations (e.g., deleting project with dependencies)
        - File upload errors (invalid type, too large)
        
        ### 401 Unauthorized
        - Missing or invalid authentication token
        - Incorrect login credentials
        - Expired or revoked refresh token
        
        ### 403 Forbidden
        - Insufficient permissions for the requested operation
        - Attempting to access another user's data without admin role
        - Attempting to perform admin-only operations without proper role
        
        ### 404 Not Found
        - Requested resource does not exist
        - Invalid ID or reference to non-existent entity
        
        ### 422 Unprocessable Entity
        - Validation errors (missing required fields, invalid data types)
        - Constraint violations (e.g., empty project name, password too short)
        - Invalid enum values (e.g., invalid status, priority)
        
        ### 429 Too Many Requests
        - Rate limit exceeded (1000 requests per 60 seconds per IP)
        
        ## Edge Cases Handled
        
        ### Authentication Edge Cases
        - Login with invalid credentials (401)
        - Login with missing fields (422)
        - Access protected endpoints without token (401)
        - Access with invalid/expired token (401)
        - Refresh token rotation and invalidation
        - Duplicate username/email registration (400)
        - Weak password validation (422)
        
        ### Validation Edge Cases
        - Empty or whitespace-only required fields (422)
        - Field length exceeding maximum limits (422)
        - Invalid enum values for status/priority/severity (422)
        - Invalid email format (422)
        - Password complexity requirements (422)
        - Missing required fields in nested objects (422)
        
        ### Permission Edge Cases
        - Accessing projects without read permission (403)
        - Modifying resources without write permission (403)
        - Deleting resources without delete permission (403)
        - Viewing other users without admin role (403)
        - Performing superuser-only operations (403)
        
        ### Data Integrity Edge Cases
        - Duplicate resource names within same scope (400)
        - Deleting resources with dependencies (400 or cascade)
        - Creating results for non-existent test runs/cases (404)
        - Assigning users to non-existent projects (404)
        - Duplicate requirement IDs (400)
        
        ### Pagination Edge Cases
        - Negative skip/limit values (422)
        - Extremely large limit values (422 or truncation)
        - Zero limit value (empty array or 422)
        - Non-numeric pagination parameters (422)
        
        ### File Upload Edge Cases
        - Invalid file types (400)
        - Files exceeding size limits (400 - max 5MB for avatars)
        - Missing file field (422)
        - Invalid file formats for import (400)
        
        ### Security Edge Cases
        - XSS injection attempts (sanitized or rejected)
        - SQL injection attempts (sanitized or rejected)
        - Null bytes in input (rejected)
        - Path traversal in file operations (rejected)
        
        ### Special Character Support
        - Unicode characters (supported)
        - Emoji (supported)
        - Special characters in names/descriptions (supported with sanitization)
        
        ### Notification Preference Edge Cases
        - Mute duration too short (< 1 hour) (400)
        - Mute duration too long (> 168 hours) (400)
        - Negative mute duration (400)
        
        ### Account Deletion Edge Cases
        - Wrong password verification (400)
        - Incorrect confirmation text (400)
        - Missing password or confirmation (400)
        
        ### Project Deletion Verification
        - Project name mismatch (400)
        - Missing project name in request (400)
        """,
        "version": "1.0.0",
        "contact": {
            "name": "Test Management System Support",
            "email": "support@testmona.com"
        },
        "license_info": {
            "name": "MIT License",
        },
        "openapi_tags": [
            {
                "name": "Authentication",
                "description": "User registration, login, token management, and logout operations"
            },
            {
                "name": "Users",
                "description": "User profile management, user CRUD operations, and invitations"
            },
            {
                "name": "Projects",
                "description": "Project management, assignments, schedules, and execution settings"
            },
            {
                "name": "Test Management",
                "description": "Test suites, test cases, test runs, test results, and test steps"
            },
            {
                "name": "Requirements",
                "description": "Requirements management and traceability"
            },
            {
                "name": "Docs",
                "description": "Doc Hub spaces, folders, Markdown docs, version history, sharing, import/export, and requirement conversion"
            },
            {
                "name": "Defects",
                "description": "Defect tracking, management, and resolution"
            },
            {
                "name": "Test Plans",
                "description": "Test planning and milestone management"
            },
            {
                "name": "Analytics",
                "description": "Dashboard analytics and coverage reports"
            },
            {
                "name": "System Settings",
                "description": "System configuration and settings management"
            },
            {
                "name": "Notifications",
                "description": "User notifications and alerts"
            },
            {
                "name": "Custom Fields",
                "description": "Custom field definitions and management"
            },
            {
                "name": "Shared Steps",
                "description": "Reusable test steps library"
            },
            {
                "name": "Import/Export",
                "description": "Data import and export operations"
            },
            {
                "name": "Audit Trails",
                "description": "System audit logs and activity tracking"
            },
            {
                "name": "Versioning",
                "description": "Test case versioning and change management"
            },
            {
                "name": "Defect Management",
                "description": "Advanced defect management with attachments"
            }
        ]
    }
