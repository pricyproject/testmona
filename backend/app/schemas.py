from pydantic import AliasChoices, BaseModel, EmailStr, field_validator, HttpUrl, model_validator, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from .models import Priority, Status, TestStatus, ResultStatus, Role, Permission, CustomFieldType, TestType, RecycleBinType, RequirementStatus, DefectStatus, DefectSeverity, DefectPriority, MilestoneStatus, NotificationType
import re
import html


# Validation Rules Schemas
class TextValidationRules(BaseModel):
    min_length: Optional[int] = Field(None, ge=0, description="Minimum string length")
    max_length: Optional[int] = Field(None, ge=0, description="Maximum string length")
    regex_pattern: Optional[str] = Field(None, description="Regex pattern for validation")


class NumberValidationRules(BaseModel):
    min_value: Optional[float] = Field(None, description="Minimum numeric value")
    max_value: Optional[float] = Field(None, description="Maximum numeric value")
    integer_only: Optional[bool] = Field(False, description="Require integer values only")


class DateValidationRules(BaseModel):
    min_date: Optional[str] = Field(None, description="Minimum date (ISO format)")
    max_date: Optional[str] = Field(None, description="Maximum date (ISO format)")
    future_only: Optional[bool] = Field(False, description="Require future dates only")
    past_only: Optional[bool] = Field(False, description="Require past dates only")


class SelectValidationRules(BaseModel):
    min_length: Optional[int] = Field(None, ge=0, description="Minimum string length for selected option")
    max_length: Optional[int] = Field(None, ge=0, description="Maximum string length for selected option")


# Versioning Schemas
class TestCaseVersionBase(BaseModel):
    version_name: Optional[str] = None
    version_label: Optional[str] = None
    description: Optional[str] = None
    change_summary: Optional[str] = None
    change_reason: Optional[str] = None
    changed_fields: Optional[Dict[str, Any]] = None
    branch_name: Optional[str] = None


class TestCaseVersionCreate(TestCaseVersionBase):
    pass


class TestCaseVersionUpdate(BaseModel):
    version_name: Optional[str] = None
    version_label: Optional[str] = None
    description: Optional[str] = None
    change_summary: Optional[str] = None
    change_reason: Optional[str] = None
    changed_fields: Optional[Dict[str, Any]] = None


class VersionComparisonBase(BaseModel):
    comparison_type: str = "full"


class VersionComparisonCreate(VersionComparisonBase):
    pass


class VersionTagBase(BaseModel):
    tag_name: str
    tag_type: str = "release"
    description: Optional[str] = None
    color: str = "#007bff"


class VersionTagCreate(VersionTagBase):
    pass


class VersionLockBase(BaseModel):
    lock_type: str = "edit"
    lock_reason: Optional[str] = None
    expires_hours: int = 24


class VersionLockCreate(VersionLockBase):
    pass


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    status: Status = Status.ACTIVE

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError('Project name cannot be empty')
        if len(v.strip()) > 100:
            raise ValueError('Project name cannot exceed 100 characters')
        return v.strip()
    
    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v and len(v) > 1000:
            raise ValueError('Project description cannot exceed 1000 characters')
        return v

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class ProjectCreate(ProjectBase):
    owner_id: Optional[int] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[Status] = None
    owner_id: Optional[int] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class Project(ProjectBase):
    id: int
    owner_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        use_enum_values = True


class TestSuiteBase(BaseModel):
    name: str
    description: Optional[str] = None
    status: Status = Status.ACTIVE

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class TestSuiteCreate(TestSuiteBase):
    project_id: int


class TestSuiteUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[Status] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class TestSuite(TestSuiteBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        use_enum_values = True


class TestCaseBase(BaseModel):
    title: str
    description: Optional[str] = None
    test_type: str = "manual"
    preconditions: Optional[str] = None
    steps: Optional[str] = None  # Legacy simple text field - kept for backward compatibility
    expected_result: Optional[str] = None
    priority: str = "medium"
    status: str = "active"
    reference: Optional[str] = None  # Reference field for requirements, JIRA tickets, etc.
    tags: Optional[str] = None
    section_id: Optional[int] = None
    order_index: Optional[int] = 0
    is_multistep: Optional[bool] = False  # Flag to indicate multistep format

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['test_type', 'priority', 'status']:
                    data[key] = html.escape(value)
        return data


class TestCaseCreate(TestCaseBase):
    test_suite_id: int
    test_steps: Optional[List['TestCaseStepCreate']] = None  # Multi-step support; test_case_id is assigned by the API

    @model_validator(mode='before')
    @classmethod
    def set_defaults(cls, data):
        """Set default values for required fields if not provided"""
        if isinstance(data, dict):
            if 'preconditions' not in data or data['preconditions'] is None or data['preconditions'] == "":
                data['preconditions'] = "No preconditions defined"
            if 'steps' not in data or data['steps'] is None or data['steps'] == "":
                data['steps'] = "No steps defined"
            if 'expected_result' not in data or data['expected_result'] is None or data['expected_result'] == "":
                data['expected_result'] = "No expected results defined"
        return data


class TestCaseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    test_type: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None  # Legacy simple text field - kept for backward compatibility
    expected_result: Optional[str] = None  # Legacy simple text field - kept for backward compatibility
    priority: Optional[str] = None
    status: Optional[str] = None
    reference: Optional[str] = None  # Reference field for requirements, JIRA tickets, etc.
    tags: Optional[str] = None
    section_id: Optional[int] = None
    test_suite_id: Optional[int] = None
    order_index: Optional[int] = None
    is_multistep: Optional[bool] = None  # Flag to indicate multistep format

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['test_type', 'priority', 'status']:
                    data[key] = html.escape(value)
        return data


class TestCase(TestCaseBase):
    id: int
    test_suite_id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Case Step Schemas
class TestCaseStepBase(BaseModel):
    step_number: int
    action: str
    expected_result: str
    step_type: str = "manual"  # manual, automated, verification
    data: Optional[Dict[str, Any]] = None
    order_index: Optional[int] = 0


class TestCaseStepCreate(TestCaseStepBase):
    test_case_id: Optional[int] = None


class TestCaseStepUpdate(BaseModel):
    step_number: Optional[int] = None
    action: Optional[str] = None
    expected_result: Optional[str] = None
    step_type: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    order_index: Optional[int] = None


class TestCaseStep(TestCaseStepBase):
    id: int
    test_case_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Enhanced TestCase response with nested relationships
class TestSuiteNested(BaseModel):
    id: int
    name: str
    project_id: int
    project: Optional['Project'] = None
    
    class Config:
        from_attributes = True


class TestCaseSectionNested(BaseModel):
    id: int
    name: str
    
    class Config:
        from_attributes = True


class TestCaseWithRelations(TestCaseBase):
    id: int
    test_suite_id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    test_suite: Optional[TestSuiteNested] = None
    section: Optional[TestCaseSectionNested] = None
    test_steps: List[TestCaseStep] = []
    custom_field_values: List['CustomFieldValue'] = []
    creator: Optional['User'] = None

    class Config:
        from_attributes = True


class TestRunBase(BaseModel):
    name: str
    description: Optional[str] = None
    # environment: Optional[str] = None  # Temporarily disabled
    status: str = "pending"
    test_plan_id: Optional[int] = None
    milestone_id: Optional[int] = None
    schedule_id: Optional[int] = None
    environment_id: Optional[int] = None
    assigned_to: Optional[int] = None
    priority: Optional[str] = "medium"
    estimated_duration: Optional[int] = None


class TestRunCreate(TestRunBase):
    project_id: int


class TestRunUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    # environment: Optional[str] = None  # Temporarily disabled
    status: Optional[str] = None
    test_plan_id: Optional[int] = None
    milestone_id: Optional[int] = None
    schedule_id: Optional[int] = None
    environment_id: Optional[int] = None
    assigned_to: Optional[int] = None
    priority: Optional[str] = None
    estimated_duration: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class TestRun(TestRunBase):
    id: int
    project_id: int
    test_plan_id: Optional[int] = None
    milestone_id: Optional[int] = None
    environment_id: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    assigned_to: Optional[int] = None
    priority: Optional[str] = "medium"
    estimated_duration: Optional[int] = None
    # environment: Optional[str] = None  # Temporarily disabled

    class Config:
        from_attributes = True
        use_enum_values = True


class TestSuiteRunCreate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = "medium"
    assigned_to: Optional[int] = None
    estimated_duration: Optional[int] = None


class TestSuiteRun(TestRun):
    test_results: List['TestResult'] = []


class TestResultBase(BaseModel):
    status: str
    actual_result: Optional[str] = None
    comments: Optional[str] = None
    execution_time: Optional[float] = Field(None, description="Elapsed execution time in seconds")
    execution_started_at: Optional[datetime] = None
    executed_by: Optional[int] = None
    # New fields for pause/resume functionality
    execution_state: Optional[str] = Field(None, description="Execution state: idle, running, paused, completed")
    paused_at: Optional[datetime] = None
    total_paused_time: Optional[float] = Field(0.0, description="Total time spent in paused state (seconds)")
    manual_time_adjustment: Optional[float] = Field(0.0, description="Manual time adjustments (seconds)")


class TestResultCreate(TestResultBase):
    test_case_id: int
    test_run_id: int


class TestResultUpdate(BaseModel):
    status: Optional[str] = None
    actual_result: Optional[str] = None
    comments: Optional[str] = None
    execution_time: Optional[float] = Field(None, description="Elapsed execution time in seconds")  # Allow negative for updates
    execution_started_at: Optional[datetime] = None
    executed_by: Optional[int] = None
    # New fields for pause/resume functionality
    execution_state: Optional[str] = Field(None, description="Execution state: idle, running, paused, completed")
    paused_at: Optional[datetime] = None
    total_paused_time: Optional[float] = Field(None, ge=0, description="Total time spent in paused state (seconds)")
    manual_time_adjustment: Optional[float] = Field(None, description="Manual time adjustments (seconds)")


class TestResult(TestResultBase):
    id: int
    test_case_id: int
    test_run_id: int
    executed_at: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Include new fields in response
    execution_state: Optional[str] = None
    paused_at: Optional[datetime] = None
    total_paused_time: Optional[float] = 0.0
    manual_time_adjustment: Optional[float] = 0.0

    class Config:
        from_attributes = True
        use_enum_values = True


class TestResultWithDetails(TestResultBase):
    id: int
    test_case_id: int
    test_run_id: int
    executed_at: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None
    test_case: Optional['TestCaseWithRelations'] = None
    executor: Optional['User'] = None
    # Include new fields in detailed response
    execution_state: Optional[str] = None
    paused_at: Optional[datetime] = None
    total_paused_time: Optional[float] = 0.0
    manual_time_adjustment: Optional[float] = 0.0

    class Config:
        from_attributes = True
        use_enum_values = True


class UserBase(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    company: Optional[str] = None
    role: Role = Role.TESTER
    is_active: bool = True
    force_password_change: bool = False
    notifications_muted_until: Optional[datetime] = None
    do_not_disturb: bool = False
    notification_sound_enabled: bool = True

    @field_validator('role', mode='before')
    @classmethod
    def normalize_role_value(cls, value: Any) -> str:
        from .rbac import role_value
        return role_value(value)

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['role', 'email', 'website']:
                    data[key] = html.escape(value)
        return data


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    force_password_change: Optional[bool] = None
    password: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    company: Optional[str] = None

    @field_validator('role', mode='before')
    @classmethod
    def normalize_role_value(cls, value: Any) -> Optional[str]:
        if value is None:
            return value
        from .rbac import role_value
        return role_value(value)

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['role', 'email', 'website', 'password']:
                    data[key] = html.escape(value)
        return data


class UserProfileUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    company: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['email', 'website']:
                    data[key] = html.escape(value)
        return data

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) < 3:
            raise ValueError('Username must be at least 3 characters')
        if len(v) > 30:
            raise ValueError('Username must not exceed 30 characters')
        # Check allowed characters (alphanumeric, underscores, hyphens)
        if not re.match(r'^[a-zA-Z0-9_-]+$', v):
            raise ValueError('Username can only contain letters, numbers, underscores, and hyphens')
        # Check reserved words
        reserved_words = [
            'admin', 'administrator', 'root', 'system', 'api', 'www', 'mail',
            'ftp', 'localhost', 'test', 'demo', 'guest', 'user', 'users',
            'support', 'help', 'info', 'contact', 'sales', 'marketing',
            'billing', 'account', 'accounts', 'login', 'logout', 'register',
            'signup', 'signin', 'auth', 'authentication', 'password', 'reset',
            'verify', 'confirm', 'settings', 'profile', 'dashboard', 'home',
            'about', 'terms', 'privacy', 'legal', 'copyright', 'license'
        ]
        if v.lower() in reserved_words:
            raise ValueError('This username is reserved and cannot be used')
        if any(v.lower().startswith(reserved + '-') for reserved in reserved_words):
            raise ValueError('Username cannot start with a reserved word')
        return v.strip()
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) > 255:
            raise ValueError('Email must not exceed 255 characters')
        return v.strip().lower()
    
    @field_validator('full_name')
    @classmethod
    def validate_full_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) > 100:
            raise ValueError('Full name must not exceed 100 characters')
        return v.strip()
    
    @field_validator('bio')
    @classmethod
    def validate_bio(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) > 500:
            raise ValueError('Bio must not exceed 500 characters')
        return v.strip()
    
    @field_validator('location')
    @classmethod
    def validate_location(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) > 100:
            raise ValueError('Location must not exceed 100 characters')
        # Basic validation for location format (allow letters, numbers, commas, periods, spaces, hyphens)
        if not re.match(r'^[a-zA-Z0-9,\.\s-]+$', v):
            raise ValueError('Location contains invalid characters')
        return v.strip()
    
    @field_validator('website')
    @classmethod
    def validate_website(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v.strip() == '':
            return v
        if len(v) > 255:
            raise ValueError('Website must not exceed 255 characters')
        # Validate URL format
        try:
            from urllib.parse import urlparse
            result = urlparse(v)
            if not all([result.scheme, result.netloc]):
                raise ValueError('Invalid URL format')
            if result.scheme not in ['http', 'https']:
                raise ValueError('Website must use HTTP or HTTPS protocol')
        except Exception:
            raise ValueError('Invalid URL format')
        return v.strip()
    
    @field_validator('company')
    @classmethod
    def validate_company(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) > 100:
            raise ValueError('Company must not exceed 100 characters')
        # Basic validation for company name (allow letters, numbers, spaces, hyphens, apostrophes, periods, commas)
        if not re.match(r'^[a-zA-Z0-9\s\-\'\.,]+$', v):
            raise ValueError('Company name contains invalid characters')
        return v.strip()


class User(UserBase):
    id: int
    is_superuser: bool
    force_password_change: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        use_enum_values = True


# User Invitation Schemas
class UserInvitationBase(BaseModel):
    email: EmailStr
    role: str = Role.TESTER.value
    project_ids: Optional[List[int]] = Field(default_factory=list, json_schema_extra={"default": []})

    @field_validator('role')
    @classmethod
    def validate_role(cls, value: str) -> str:
        from .rbac import role_value
        return role_value(value)


class UserInvitationCreate(UserInvitationBase):
    pass


class UserInvitation(UserInvitationBase):
    id: int
    token: str
    invited_by: int
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    is_used: bool
    created_at: datetime

    @field_validator('project_ids', mode='before')
    @classmethod
    def deserialize_project_ids(cls, value: Any) -> List[int]:
        if value in (None, ''):
            return []
        if isinstance(value, str):
            return [int(project_id.strip()) for project_id in value.split(',') if project_id.strip()]
        return value

    class Config:
        from_attributes = True


class UserInvitationAccept(BaseModel):
    token: str
    username: str
    password: str
    full_name: Optional[str] = None


class ProjectAssignmentBase(BaseModel):
    user_id: int
    project_id: int
    role: Role = Role.TESTER

    @field_validator('role', mode='before')
    @classmethod
    def normalize_role_value(cls, value: Any) -> str:
        from .rbac import role_value
        return role_value(value)


class ProjectAssignmentCreate(ProjectAssignmentBase):
    assigned_by: Optional[int] = None


class ProjectAssignment(ProjectAssignmentBase):
    id: int
    assigned_at: datetime
    assigned_by: Optional[int] = None

    class Config:
        from_attributes = True


class ProjectAssignmentUpdate(BaseModel):
    user_id: Optional[int] = None
    project_id: Optional[int] = None
    role: Optional[Role] = None

    @field_validator('role', mode='before')
    @classmethod
    def normalize_role_value(cls, value: Any) -> Optional[str]:
        if value is None:
            return value
        from .rbac import role_value
        return role_value(value)


class TestScheduleBase(BaseModel):
    name: str
    description: Optional[str] = None
    test_suite_id: int
    execution_time: datetime
    is_recurring: bool = False
    recurrence_pattern: Optional[str] = None
    status: Status = Status.ACTIVE


class TestScheduleCreate(TestScheduleBase):
    scheduled_by: int


class TestScheduleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    execution_time: Optional[datetime] = None
    is_recurring: Optional[bool] = None
    recurrence_pattern: Optional[str] = None
    status: Optional[Status] = None


class TestSchedule(TestScheduleBase):
    id: int
    scheduled_by: int
    scheduled_at: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TestExecutionBase(BaseModel):
    test_case_id: int
    test_run_id: int
    executor_id: int
    status: TestStatus = TestStatus.PENDING
    step_results: Optional[str] = None
    screenshots: Optional[str] = None
    logs: Optional[str] = None


class TestExecutionCreate(TestExecutionBase):
    pass


class TestExecutionUpdate(BaseModel):
    status: Optional[TestStatus] = None
    step_results: Optional[str] = None
    screenshots: Optional[str] = None
    logs: Optional[str] = None
    completed_at: Optional[datetime] = None


class TestExecution(TestExecutionBase):
    id: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    username_or_email: str = Field(
        ...,
        validation_alias=AliasChoices("username_or_email", "username"),
        description="Username or email address used to sign in",
    )
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str


class TokenData(BaseModel):
    username: Optional[str] = None


class TestRunWithResults(TestRun):
    test_results: List[TestResult] = []


class TestCaseWithSuite(TestCase):
    test_suite: TestSuite


class TestSuiteWithCases(TestSuite):
    test_cases: List[TestCase] = []


class ProjectWithSuites(Project):
    test_suites: List[TestSuite] = []


class TestRunStatistics(BaseModel):
    total_tests: int
    passed: int
    failed: int
    skipped: int
    blocked: int
    pass_rate: float
    execution_time: Optional[float] = None


class CustomFieldDefinitionBase(BaseModel):
    name: str
    slug: Optional[str] = None
    field_type: CustomFieldType
    description: Optional[str] = None
    is_required: bool = False
    default_value: Optional[str] = None
    options: Optional[Union[List[str], Dict[str, Any]]] = None
    validation_rules: Optional[Dict[str, Any]] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['field_type']:
                    data[key] = html.escape(value)
                elif isinstance(value, list) and key == 'options':
                    # Sanitize strings in options array
                    data[key] = [html.escape(item) if isinstance(item, str) else item for item in value]
        return data

    @model_validator(mode='after')
    def validate_options(self):
        if self.options and self.field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            # If options is a dict with 'values' key, extract the array (legacy support)
            if isinstance(self.options, dict):
                if 'values' in self.options and isinstance(self.options['values'], list):
                    self.options = self.options['values']
                else:
                    raise ValueError("Options for select/multiselect must be an array or a dict with 'values' key")
            elif not isinstance(self.options, list):
                raise ValueError("Options for select/multiselect must be an array")
        return self

    @model_validator(mode='after')
    def validate_validation_rules(self):
        if self.validation_rules and self.field_type:
            field_type = self.field_type
            rules = self.validation_rules
            
            # Validate rules based on field type
            if field_type == CustomFieldType.TEXT:
                self._validate_text_rules(rules)
            elif field_type == CustomFieldType.NUMBER:
                self._validate_number_rules(rules)
            elif field_type == CustomFieldType.DATE:
                self._validate_date_rules(rules)
            elif field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
                self._validate_select_rules(rules)
            elif field_type == CustomFieldType.BOOLEAN:
                if rules:
                    raise ValueError("Boolean fields do not support validation rules")
        
        return self
    
    def _validate_text_rules(self, rules: Dict[str, Any]):
        """Validate text field validation rules"""
        valid_keys = {'min_length', 'max_length', 'regex_pattern'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for text field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")
        
        if 'regex_pattern' in rules:
            if not isinstance(rules['regex_pattern'], str):
                raise ValueError("regex_pattern must be a string")
            try:
                re.compile(rules['regex_pattern'])
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    def _validate_number_rules(self, rules: Dict[str, Any]):
        """Validate number field validation rules"""
        valid_keys = {'min_value', 'max_value', 'integer_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for number field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_value' in rules:
            if not isinstance(rules['min_value'], (int, float)):
                raise ValueError("min_value must be a number")
        
        if 'max_value' in rules:
            if not isinstance(rules['max_value'], (int, float)):
                raise ValueError("max_value must be a number")
        
        if 'min_value' in rules and 'max_value' in rules:
            if rules['min_value'] > rules['max_value']:
                raise ValueError("min_value cannot be greater than max_value")
        
        if 'integer_only' in rules:
            if not isinstance(rules['integer_only'], bool):
                raise ValueError("integer_only must be a boolean")
    
    def _validate_date_rules(self, rules: Dict[str, Any]):
        """Validate date field validation rules"""
        valid_keys = {'min_date', 'max_date', 'future_only', 'past_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for date field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_date' in rules:
            if not isinstance(rules['min_date'], str):
                raise ValueError("min_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['min_date'])
            except ValueError:
                raise ValueError("min_date must be in ISO format (YYYY-MM-DD)")
        
        if 'max_date' in rules:
            if not isinstance(rules['max_date'], str):
                raise ValueError("max_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['max_date'])
            except ValueError:
                raise ValueError("max_date must be in ISO format (YYYY-MM-DD)")
        
        if 'min_date' in rules and 'max_date' in rules:
            if datetime.fromisoformat(rules['min_date']) > datetime.fromisoformat(rules['max_date']):
                raise ValueError("min_date cannot be greater than max_date")
        
        if 'future_only' in rules and 'past_only' in rules:
            if rules['future_only'] and rules['past_only']:
                raise ValueError("Cannot specify both future_only and past_only")
        
        if 'future_only' in rules:
            if not isinstance(rules['future_only'], bool):
                raise ValueError("future_only must be a boolean")
        
        if 'past_only' in rules:
            if not isinstance(rules['past_only'], bool):
                raise ValueError("past_only must be a boolean")
    
    def _validate_select_rules(self, rules: Dict[str, Any]):
        """Validate select/multiselect field validation rules"""
        valid_keys = {'min_length', 'max_length'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for select field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")


class CustomFieldDefinitionCreate(CustomFieldDefinitionBase):
    project_id: int


class CustomFieldDefinitionUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    field_type: Optional[CustomFieldType] = None
    description: Optional[str] = None
    is_required: Optional[bool] = None
    default_value: Optional[str] = None
    options: Optional[Union[List[str], Dict[str, Any]]] = None
    validation_rules: Optional[Dict[str, Any]] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['field_type']:
                    data[key] = html.escape(value)
                elif isinstance(value, list) and key == 'options':
                    # Sanitize strings in options array
                    data[key] = [html.escape(item) if isinstance(item, str) else item for item in value]
        return data

    @model_validator(mode='after')
    def validate_options(self):
        if self.options and self.field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            # If options is a dict with 'values' key, extract the array (legacy support)
            if isinstance(self.options, dict):
                if 'values' in self.options and isinstance(self.options['values'], list):
                    self.options = self.options['values']
                else:
                    raise ValueError("Options for select/multiselect must be an array or a dict with 'values' key")
            elif not isinstance(self.options, list):
                raise ValueError("Options for select/multiselect must be an array")
        return self

    @model_validator(mode='after')
    def validate_validation_rules(self):
        if self.validation_rules and self.field_type:
            field_type = self.field_type
            rules = self.validation_rules
            
            # Validate rules based on field type
            if field_type == CustomFieldType.TEXT:
                self._validate_text_rules(rules)
            elif field_type == CustomFieldType.NUMBER:
                self._validate_number_rules(rules)
            elif field_type == CustomFieldType.DATE:
                self._validate_date_rules(rules)
            elif field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
                self._validate_select_rules(rules)
            elif field_type == CustomFieldType.BOOLEAN:
                if rules:
                    raise ValueError("Boolean fields do not support validation rules")
        
        return self
    
    def _validate_text_rules(self, rules: Dict[str, Any]):
        """Validate text field validation rules"""
        valid_keys = {'min_length', 'max_length', 'regex_pattern'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for text field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")
        
        if 'regex_pattern' in rules:
            if not isinstance(rules['regex_pattern'], str):
                raise ValueError("regex_pattern must be a string")
            try:
                re.compile(rules['regex_pattern'])
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    def _validate_number_rules(self, rules: Dict[str, Any]):
        """Validate number field validation rules"""
        valid_keys = {'min_value', 'max_value', 'integer_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for number field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_value' in rules:
            if not isinstance(rules['min_value'], (int, float)):
                raise ValueError("min_value must be a number")
        
        if 'max_value' in rules:
            if not isinstance(rules['max_value'], (int, float)):
                raise ValueError("max_value must be a number")
        
        if 'min_value' in rules and 'max_value' in rules:
            if rules['min_value'] > rules['max_value']:
                raise ValueError("min_value cannot be greater than max_value")
        
        if 'integer_only' in rules:
            if not isinstance(rules['integer_only'], bool):
                raise ValueError("integer_only must be a boolean")
    
    def _validate_date_rules(self, rules: Dict[str, Any]):
        """Validate date field validation rules"""
        valid_keys = {'min_date', 'max_date', 'future_only', 'past_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for date field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_date' in rules:
            if not isinstance(rules['min_date'], str):
                raise ValueError("min_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['min_date'])
            except ValueError:
                raise ValueError("min_date must be in ISO format (YYYY-MM-DD)")
        
        if 'max_date' in rules:
            if not isinstance(rules['max_date'], str):
                raise ValueError("max_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['max_date'])
            except ValueError:
                raise ValueError("max_date must be in ISO format (YYYY-MM-DD)")
        
        if 'min_date' in rules and 'max_date' in rules:
            if datetime.fromisoformat(rules['min_date']) > datetime.fromisoformat(rules['max_date']):
                raise ValueError("min_date cannot be greater than max_date")
        
        if 'future_only' in rules and 'past_only' in rules:
            if rules['future_only'] and rules['past_only']:
                raise ValueError("Cannot specify both future_only and past_only")
        
        if 'future_only' in rules:
            if not isinstance(rules['future_only'], bool):
                raise ValueError("future_only must be a boolean")
        
        if 'past_only' in rules:
            if not isinstance(rules['past_only'], bool):
                raise ValueError("past_only must be a boolean")
    
    def _validate_select_rules(self, rules: Dict[str, Any]):
        """Validate select/multiselect field validation rules"""
        valid_keys = {'min_length', 'max_length'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for select field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")


class CustomFieldDefinition(CustomFieldDefinitionBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomFieldValueBase(BaseModel):
    field_definition_id: int
    test_case_id: int
    value: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class CustomFieldValueCreate(CustomFieldValueBase):
    pass


class CustomFieldValueUpdate(BaseModel):
    test_case_id: Optional[int] = None
    value: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class CustomFieldValue(CustomFieldValueBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TestCaseWithCustomFields(TestCase):
    custom_field_values: List[CustomFieldValue] = []


class CustomFieldDefinitionWithValues(CustomFieldDefinition):
    values: List[CustomFieldValue] = []


class JiraIntegrationBase(BaseModel):
    jira_url: str
    username: str
    api_token: str
    project_key: str
    is_active: bool = True
    sync_test_cases: bool = True
    sync_test_results: bool = True


class JiraIntegrationCreate(JiraIntegrationBase):
    project_id: int


class JiraIntegrationUpdate(BaseModel):
    jira_url: Optional[str] = None
    username: Optional[str] = None
    api_token: Optional[str] = None
    project_key: Optional[str] = None
    is_active: Optional[bool] = None
    sync_test_cases: Optional[bool] = None
    sync_test_results: Optional[bool] = None


class JiraIntegration(JiraIntegrationBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JiraIssueBase(BaseModel):
    jira_issue_key: str
    jira_issue_id: str
    issue_type: str
    status: str
    summary: Optional[str] = None
    description: Optional[str] = None
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    priority: Optional[str] = None


class JiraIssueCreate(JiraIssueBase):
    integration_id: int
    test_case_id: Optional[int] = None
    test_result_id: Optional[int] = None


class JiraIssueUpdate(BaseModel):
    status: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[str] = None


class JiraIssue(JiraIssueBase):
    id: int
    integration_id: int
    test_case_id: Optional[int] = None
    test_result_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class TestTypeDefinitionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    color: str = "#3B82F6"
    icon: str = Field("🖱️", min_length=1, max_length=10)
    is_active: bool = True

    @field_validator('name')
    @classmethod
    def validate_test_type_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Test type name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_test_type_color(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class TestTypeDefinitionCreate(TestTypeDefinitionBase):
    created_by: int

class TestTypeDefinitionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    color: Optional[str] = None
    icon: Optional[str] = Field(None, min_length=1, max_length=10)
    is_active: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def validate_test_type_update_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Test type name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_test_type_update_color(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class TestTypeDefinition(TestTypeDefinitionBase):
    id: int
    usage_count: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class PriorityDefinitionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    value: int = Field(..., ge=1, le=10)
    color: str = "#F59E0B"
    description: Optional[str] = Field(None, max_length=1000)
    is_default: bool = False
    is_active: bool = True

    @field_validator('name')
    @classmethod
    def validate_priority_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Priority name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_priority_color(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class PriorityDefinitionCreate(PriorityDefinitionBase):
    created_by: int

class PriorityDefinitionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    value: Optional[int] = Field(None, ge=1, le=10)
    color: Optional[str] = None
    description: Optional[str] = Field(None, max_length=1000)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def validate_priority_update_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Priority name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_priority_update_color(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class PriorityDefinition(PriorityDefinitionBase):
    id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class SharedStepTemplateBase(BaseModel):
    name: str
    description: Optional[str] = None
    category: str
    tags: Optional[List[str]] = []
    complexity: str
    estimated_time: int = 1
    prerequisites: Optional[List[str]] = []
    related_steps: Optional[List[str]] = []
    is_active: bool = True

class SharedStepTemplateCreate(SharedStepTemplateBase):
    created_by: int

class SharedStepTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    complexity: Optional[str] = None
    estimated_time: Optional[int] = None
    prerequisites: Optional[List[str]] = None
    related_steps: Optional[List[str]] = None
    is_active: Optional[bool] = None

class SharedStepTemplate(SharedStepTemplateBase):
    id: int
    usage_count: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class TestExecutionSettingsBase(BaseModel):
    auto_save_interval: int = 30
    screenshot_on_failure: bool = True
    video_recording: bool = False
    step_timeout: int = 300
    retry_attempts: int = 2
    parallel_execution: bool = True
    max_parallel_threads: int = 4
    cleanup_on_failure: bool = True

class TestExecutionSettingsCreate(TestExecutionSettingsBase):
    project_id: Optional[int] = None
    created_by: int

class TestExecutionSettingsUpdate(BaseModel):
    auto_save_interval: Optional[int] = None
    screenshot_on_failure: Optional[bool] = None
    video_recording: Optional[bool] = None
    step_timeout: Optional[int] = None
    retry_attempts: Optional[int] = None
    parallel_execution: Optional[bool] = None
    max_parallel_threads: Optional[int] = None
    cleanup_on_failure: Optional[bool] = None

class TestExecutionSettings(TestExecutionSettingsBase):
    id: int
    project_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class NotificationSettingsBase(BaseModel):
    email_notifications: bool = True
    slack_notifications: bool = False
    test_failure_alerts: bool = True
    test_completion_reports: bool = True
    weekly_summary: bool = True
    real_time_updates: bool = False

class NotificationSettingsCreate(NotificationSettingsBase):
    project_id: Optional[int] = None
    created_by: int

class NotificationSettingsUpdate(BaseModel):
    email_notifications: Optional[bool] = None
    slack_notifications: Optional[bool] = None
    test_failure_alerts: Optional[bool] = None
    test_completion_reports: Optional[bool] = None
    weekly_summary: Optional[bool] = None
    real_time_updates: Optional[bool] = None

class NotificationSettings(NotificationSettingsBase):
    id: int
    project_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class AutomationSettingsBase(BaseModel):
    ai_suggestions: bool = False
    smart_step_recommendations: bool = True
    auto_categorization: bool = False
    duplicate_detection: bool = True
    performance_optimization: bool = True

class AutomationSettingsCreate(AutomationSettingsBase):
    project_id: Optional[int] = None
    created_by: int

class AutomationSettingsUpdate(BaseModel):
    ai_suggestions: Optional[bool] = None
    smart_step_recommendations: Optional[bool] = None
    auto_categorization: Optional[bool] = None
    duplicate_detection: Optional[bool] = None
    performance_optimization: Optional[bool] = None

class AutomationSettings(AutomationSettingsBase):
    id: int
    project_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SystemSettingsBase(BaseModel):
    key: str
    value: Optional[str] = None
    description: Optional[str] = None


class SystemSettingsCreate(SystemSettingsBase):
    pass


class SystemSettingsUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None


class SystemSettings(SystemSettingsBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Audit Trail Configuration Schemas
class AuditTrailConfig(BaseModel):
    """Configuration for enabling/disabling audit trails per entity type"""
    enabled: bool = Field(default=True, description="Global enable/disable for audit trails")
    entity_settings: Dict[str, bool] = Field(
        default_factory=dict,
        description="Per-entity audit trail settings. Key is entity_type, value is enabled/disabled"
    )

    @field_validator('entity_settings')
    @classmethod
    def validate_entity_types(cls, v):
        """Validate that entity types are valid"""
        from .models import EntityType
        valid_entities = {e.value for e in EntityType}
        for entity_type in v.keys():
            if entity_type not in valid_entities:
                raise ValueError(f"Invalid entity type: {entity_type}")
        return v


class AuditTrailConfigUpdate(BaseModel):
    """Update schema for audit trail configuration"""
    enabled: Optional[bool] = None
    entity_settings: Optional[Dict[str, bool]] = None

    @field_validator('entity_settings')
    @classmethod
    def validate_entity_types(cls, v):
        """Validate that entity types are valid"""
        if v is None:
            return v
        from .models import EntityType
        valid_entities = {e.value for e in EntityType}
        for entity_type in v.keys():
            if entity_type not in valid_entities:
                raise ValueError(f"Invalid entity type: {entity_type}")
        return v


# Test Case Section Schemas
class TestCaseSectionBase(BaseModel):
    name: str
    description: Optional[str] = None
    parent_section_id: Optional[int] = None
    order_index: Optional[int] = 0
    is_active: Optional[bool] = True

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class TestCaseSectionCreate(TestCaseSectionBase):
    test_suite_id: int


class TestCaseSectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_section_id: Optional[int] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class TestCaseSection(TestCaseSectionBase):
    id: int
    test_suite_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Case Revision Schemas
class TestCaseRevisionBase(BaseModel):
    revision_number: Optional[int] = None
    title: str
    description: Optional[str] = None
    test_type: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected_result: Optional[str] = None
    priority: Optional[Priority] = None
    tags: Optional[str] = None
    changed_fields: Optional[Dict[str, Any]] = None
    change_reason: Optional[str] = None


class TestCaseRevisionCreate(TestCaseRevisionBase):
    test_case_id: int
    created_by: int


class TestCaseRevision(TestCaseRevisionBase):
    id: int
    test_case_id: int
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


# Recycle Bin Schemas
class RecycleBinBase(BaseModel):
    item_type: RecycleBinType
    item_id: int
    item_data: Dict[str, Any]
    restore_until: Optional[datetime] = None


class RecycleBinCreate(RecycleBinBase):
    deleted_by: int


class RecycleBin(RecycleBinBase):
    id: int
    deleted_by: int
    deleted_at: datetime

    class Config:
        from_attributes = True


# Export Schemas
class TestCaseExport(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    test_type: str
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected_result: Optional[str] = None
    priority: str
    tags: Optional[str] = None
    created_at: datetime


class TestSuiteWithSections(TestSuite):
    sections: List[TestCaseSection] = []


class TestCaseSectionWithCases(TestCaseSection):
    test_cases: List[TestCase] = []


# Requirement Schemas
class RequirementBase(BaseModel):
    title: str
    description: Optional[str] = None
    requirement_id: str
    status: RequirementStatus = RequirementStatus.DRAFT
    priority: Priority = Priority.MEDIUM
    parent_requirement_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    estimated_effort: Optional[float] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status', 'priority']:
                    data[key] = html.escape(value)
        return data


class RequirementCreate(RequirementBase):
    project_id: int
    created_by: int


class RequirementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[RequirementStatus] = None
    priority: Optional[Priority] = None
    parent_requirement_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    estimated_effort: Optional[float] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status', 'priority']:
                    data[key] = html.escape(value)
        return data


class Requirement(RequirementBase):
    id: int
    project_id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Defect Schemas
class DefectBase(BaseModel):
    title: str
    description: Optional[str] = None
    defect_id: str
    status: DefectStatus = DefectStatus.OPEN
    severity: DefectSeverity = DefectSeverity.MEDIUM
    priority: DefectPriority = DefectPriority.MEDIUM
    test_case_id: Optional[int] = None
    test_run_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    steps_to_reproduce: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    environment: Optional[str] = None
    browser_info: Optional[str] = None
    attachments: Optional[str] = None
    estimated_fix_time: Optional[float] = None
    actual_fix_time: Optional[float] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status', 'severity', 'priority']:
                    data[key] = html.escape(value)
        return data


class DefectCreate(DefectBase):
    project_id: int
    reported_by: Optional[int] = None


class DefectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[DefectStatus] = None
    severity: Optional[DefectSeverity] = None
    priority: Optional[DefectPriority] = None
    test_case_id: Optional[int] = None
    test_run_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    steps_to_reproduce: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    environment: Optional[str] = None
    browser_info: Optional[str] = None
    attachments: Optional[str] = None
    estimated_fix_time: Optional[float] = None
    actual_fix_time: Optional[float] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status', 'severity', 'priority']:
                    data[key] = html.escape(value)
        return data


class Defect(DefectBase):
    id: int
    project_id: int
    reported_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Enhanced Defect Management Schemas
class DefectManagementBase(BaseModel):
    title: str
    description: Optional[str] = None
    defect_id: str
    status: DefectStatus = DefectStatus.OPEN
    severity: DefectSeverity = DefectSeverity.MEDIUM
    priority: DefectPriority = DefectPriority.MEDIUM
    test_case_id: Optional[int] = None
    test_run_id: Optional[int] = None
    requirement_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    steps_to_reproduce: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    environment: Optional[str] = None
    browser_info: Optional[str] = None
    estimated_fix_time: Optional[float] = None
    actual_fix_time: Optional[float] = None
    external_issue_id: Optional[str] = None
    external_issue_url: Optional[str] = None
    external_sync_status: Optional[str] = "not_synced"
    resolution: Optional[str] = None
    root_cause: Optional[str] = None
    fix_version: Optional[str] = None
    found_in_version: Optional[str] = None
    duplicate_of: Optional[int] = None


class DefectManagementCreate(DefectManagementBase):
    pass


class DefectManagementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[DefectStatus] = None
    severity: Optional[DefectSeverity] = None
    priority: Optional[DefectPriority] = None
    test_case_id: Optional[int] = None
    test_run_id: Optional[int] = None
    requirement_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    steps_to_reproduce: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    environment: Optional[str] = None
    browser_info: Optional[str] = None
    estimated_fix_time: Optional[float] = None
    actual_fix_time: Optional[float] = None
    external_issue_id: Optional[str] = None
    external_issue_url: Optional[str] = None
    external_sync_status: Optional[str] = None
    resolution: Optional[str] = None
    root_cause: Optional[str] = None
    fix_version: Optional[str] = None
    found_in_version: Optional[str] = None
    duplicate_of: Optional[int] = None


class User(BaseModel):
    id: int
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    company: Optional[str] = None
    role: Role = Role.TESTER
    is_active: bool = True
    is_superuser: bool = False
    force_password_change: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    @field_validator('role', mode='before')
    @classmethod
    def normalize_role_value(cls, value: Any) -> str:
        from .rbac import role_value
        return role_value(value)

    class Config:
        from_attributes = True


class DefectManagement(DefectManagementBase):
    id: int
    project_id: int
    reported_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    reporter: Optional[User] = None
    assignee: Optional[User] = None
    test_case: Optional[Dict[str, Any]] = None
    requirement: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class DefectManagementDetail(DefectManagement):
    comments: List['DefectComment'] = []
    attachments_files: List['DefectAttachment'] = []
    history: List['DefectHistory'] = []
    duplicate: Optional['DefectManagement'] = None


# Defect Comments Schemas
class DefectCommentBase(BaseModel):
    comment: str
    is_internal: bool = False


class DefectCommentCreate(DefectCommentBase):
    pass


class DefectCommentUpdate(BaseModel):
    comment: Optional[str] = None
    is_internal: Optional[bool] = None


class DefectComment(DefectCommentBase):
    id: int
    defect_id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    author: Optional[User] = None

    class Config:
        from_attributes = True


# Defect Attachments Schemas
class DefectAttachmentBase(BaseModel):
    filename: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None


class DefectAttachment(DefectAttachmentBase):
    id: int
    defect_id: int
    file_path: str
    uploaded_by: int
    uploaded_at: datetime
    uploader: Optional[User] = None

    class Config:
        from_attributes = True


# Defect History Schemas
class DefectHistoryBase(BaseModel):
    field_name: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    change_reason: Optional[str] = None


class DefectHistory(DefectHistoryBase):
    id: int
    defect_id: int
    user_id: int
    created_at: datetime
    changed_by: Optional[User] = None

    class Config:
        from_attributes = True


# Issue Tracker Integration Schemas
class IssueTrackerIntegrationBase(BaseModel):
    name: str
    tracker_type: str
    api_url: str
    api_token: Optional[str] = None
    username: Optional[str] = None
    project_key: Optional[str] = None
    sync_direction: str = "bidirectional"
    sync_config: Optional[Dict[str, Any]] = None
    is_active: bool = True


class IssueTrackerIntegrationCreate(IssueTrackerIntegrationBase):
    pass


class IssueTrackerIntegrationUpdate(BaseModel):
    name: Optional[str] = None
    tracker_type: Optional[str] = None
    api_url: Optional[str] = None
    api_token: Optional[str] = None
    username: Optional[str] = None
    project_key: Optional[str] = None
    sync_direction: Optional[str] = None
    sync_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class IssueTrackerIntegration(IssueTrackerIntegrationBase):
    id: int
    project_id: int
    last_sync: Optional[datetime] = None
    sync_status: Optional[str] = "not_synced"
    sync_error: Optional[str] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    creator: Optional[User] = None

    class Config:
        from_attributes = True


# Defect Sync Schemas
class DefectSyncRequest(BaseModel):
    integration_id: int
    sync_type: str = "manual"  # manual, automatic
    action: str = "sync"  # sync, create, update


class DefectSyncResponse(BaseModel):
    success: bool
    message: str
    external_issue_id: Optional[str] = None
    external_issue_url: Optional[str] = None
    sync_status: Optional[str] = None


# Defect Templates Schemas
class DefectTemplateBase(BaseModel):
    name: str
    description: Optional[str] = None
    template_data: Optional[Dict[str, Any]] = None
    is_active: bool = True


class DefectTemplateCreate(DefectTemplateBase):
    pass


class DefectTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    template_data: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class DefectTemplate(DefectTemplateBase):
    id: int
    project_id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    creator: Optional[User] = None

    class Config:
        from_attributes = True


# Test Plan Schemas
class TestPlanBase(BaseModel):
    title: str
    description: Optional[str] = None
    milestone_id: Optional[int] = None
    status: TestStatus = TestStatus.PENDING
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    test_objectives: Optional[str] = None
    scope_inclusions: Optional[str] = None
    scope_exclusions: Optional[str] = None
    test_environment: Optional[str] = None
    entry_criteria: Optional[str] = None
    exit_criteria: Optional[str] = None
    risks_assumptions: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class TestPlanCreate(TestPlanBase):
    project_id: int
    created_by: int


class TestPlanUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    milestone_id: Optional[int] = None
    status: Optional[TestStatus] = None
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    test_objectives: Optional[str] = None
    scope_inclusions: Optional[str] = None
    scope_exclusions: Optional[str] = None
    test_environment: Optional[str] = None
    entry_criteria: Optional[str] = None
    exit_criteria: Optional[str] = None
    risks_assumptions: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class TestPlan(TestPlanBase):
    id: int
    project_id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Milestone Schemas
class MilestoneBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: MilestoneStatus = MilestoneStatus.PLANNED
    target_date: Optional[datetime] = None
    actual_date: Optional[datetime] = None
    progress_percentage: int = 0

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if not v or not v.strip():
            raise ValueError('Title cannot be empty')
        if len(v.strip()) > 255:
            raise ValueError('Title cannot exceed 255 characters')
        return v.strip()
    
    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v and len(v) > 5000:
            raise ValueError('Description cannot exceed 5000 characters')
        return v
    
    @field_validator('progress_percentage')
    @classmethod
    def validate_progress(cls, v):
        if v < 0 or v > 100:
            raise ValueError('Progress percentage must be between 0 and 100')
        return v
    
    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class MilestoneCreate(MilestoneBase):
    project_id: int
    created_by: Optional[int] = None


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[MilestoneStatus] = None
    target_date: Optional[datetime] = None
    actual_date: Optional[datetime] = None
    progress_percentage: Optional[int] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if v is not None:
            if not v or not v.strip():
                raise ValueError('Title cannot be empty')
            if len(v.strip()) > 255:
                raise ValueError('Title cannot exceed 255 characters')
            return v.strip()
        return v
    
    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v is not None and len(v) > 5000:
            raise ValueError('Description cannot exceed 5000 characters')
        return v
    
    @field_validator('progress_percentage')
    @classmethod
    def validate_progress(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Progress percentage must be between 0 and 100')
        return v
    
    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data


class MilestoneLinkedTestPlan(BaseModel):
    id: int
    title: str
    status: Optional[str] = None
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None


class Milestone(MilestoneBase):
    id: int
    project_id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    test_plan_count: int = 0
    test_run_count: int = 0
    test_case_count: int = 0
    result_count: int = 0
    passed_count: int = 0
    failed_count: int = 0
    blocked_count: int = 0
    skipped_count: int = 0
    not_tested_count: int = 0
    execution_progress: int = 0
    pass_rate: int = 0
    open_defect_count: int = 0
    critical_defect_count: int = 0
    requirement_count: int = 0
    verified_requirement_count: int = 0
    is_overdue: bool = False
    health: str = "planned"
    linked_test_plans: List[MilestoneLinkedTestPlan] = []

    class Config:
        from_attributes = True


# Traceability Matrix Schemas
class TraceabilityMatrixBase(BaseModel):
    requirement_id: int
    test_case_id: int
    coverage_type: str = "functional"
    coverage_percentage: float = 100.0


class TraceabilityMatrixCreate(TraceabilityMatrixBase):
    pass


class TraceabilityMatrix(TraceabilityMatrixBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Coverage Report Schemas
class CoverageReportBase(BaseModel):
    test_run_id: Optional[int] = None
    report_type: str = "summary"
    total_requirements: int = 0
    covered_requirements: int = 0
    coverage_percentage: float = 0.0
    total_test_cases: int = 0
    executed_test_cases: int = 0
    passed_test_cases: int = 0
    failed_test_cases: int = 0
    blocked_test_cases: int = 0
    report_data: Optional[Dict[str, Any]] = None


class CoverageReportCreate(CoverageReportBase):
    project_id: int
    generated_by: int


class CoverageReport(CoverageReportBase):
    id: int
    project_id: int
    generated_by: int
    generated_at: datetime

    class Config:
        from_attributes = True


# Enhanced schemas with relationships
class RequirementWithChildren(Requirement):
    child_requirements: List["RequirementWithChildren"] = []
    test_cases: List[TestCase] = []


class ProjectWithAdvancedFeatures(Project):
    requirements: List[Requirement] = []
    defects: List[Defect] = []
    milestones: List[Milestone] = []
    test_plans: List[TestPlan] = []
    coverage_reports: List[CoverageReport] = []


class NotificationBase(BaseModel):
    title: str
    message: str
    type: NotificationType = NotificationType.INFO
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['type']:
                    data[key] = html.escape(value)
        return data


class NotificationCreate(NotificationBase):
    user_id: int


class NotificationUpdate(BaseModel):
    is_read: Optional[bool] = None


class BulkNotificationUpdate(BaseModel):
    notification_ids: List[int]
    is_read: Optional[bool] = None


class BulkNotificationDelete(BaseModel):
    notification_ids: List[int]


class NotificationPreferencesUpdate(BaseModel):
    do_not_disturb: Optional[bool] = None
    notification_sound_enabled: Optional[bool] = None
    mute_duration_hours: Optional[int] = None


class Notification(NotificationBase):
    id: int
    user_id: int
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Analytics and Reporting Schemas

class KPIDataBase(BaseModel):
    metric_type: str
    metric_value: float
    trend_direction: str = "neutral"
    trend_change: float = 0.0
    time_period: str
    additional_data: Optional[Dict[str, Any]] = None


class KPIDataCreate(KPIDataBase):
    project_id: int


class KPIData(KPIDataBase):
    id: int
    project_id: int
    recorded_at: datetime

    class Config:
        from_attributes = True


class TestStepResultBase(BaseModel):
    step_number: int
    step_name: str
    step_status: str
    step_duration: float = 0.0
    error_message: Optional[str] = None
    screenshot_path: Optional[str] = None
    step_data: Optional[Dict[str, Any]] = None


class TestStepResultCreate(TestStepResultBase):
    test_result_id: int


class TestStepResult(TestStepResultBase):
    id: int
    test_result_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ShareableReportBase(BaseModel):
    title: str
    report_type: str
    report_content: Dict[str, Any]
    access_level: str = "read-only"
    shared_with: Optional[List[Union[int, str]]] = None
    expires_at: Optional[datetime] = None


class ShareableReportCreate(ShareableReportBase):
    project_id: int


class ShareableReport(ShareableReportBase):
    id: int
    project_id: int
    share_token: str
    created_by: int
    view_count: int
    last_viewed: Optional[datetime]
    created_at: datetime
    is_active: bool

    class Config:
        from_attributes = True


class RootCauseAnalysisBase(BaseModel):
    analysis_title: str
    root_cause: str
    impact_assessment: Optional[str] = None
    resolution_time_hours: Optional[float] = None
    fix_commit_hash: Optional[str] = None
    assigned_to: Optional[int] = None
    status: str = "open"
    severity: str = "medium"
    analysis_data: Optional[Dict[str, Any]] = None


class RootCauseAnalysisCreate(RootCauseAnalysisBase):
    project_id: int
    requirement_id: Optional[int] = None
    test_case_id: Optional[int] = None
    defect_id: Optional[int] = None
    discovered_by: int


class RootCauseAnalysis(RootCauseAnalysisBase):
    id: int
    project_id: int
    requirement_id: Optional[int]
    test_case_id: Optional[int]
    defect_id: Optional[int]
    discovered_by: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class DashboardWidgetBase(BaseModel):
    widget_type: str
    widget_title: str
    widget_config: Dict[str, Any]
    position_x: int = 0
    position_y: int = 0
    width: int = 1
    height: int = 1
    is_visible: bool = True


class DashboardWidgetCreate(DashboardWidgetBase):
    user_id: int
    project_id: Optional[int] = None


class DashboardWidget(DashboardWidgetBase):
    id: int
    user_id: int
    project_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# Analytics Request/Response Schemas

class DashboardAnalyticsRequest(BaseModel):
    project_id: int
    time_period: str = "7d"
    metrics: List[str] = ["coverage", "pass_rate", "failure_trends", "flakiness", "cycle_time"]


class DashboardAnalyticsResponse(BaseModel):
    project_id: int
    time_period: str
    kpi_data: List[KPIData]
    recent_activity: Dict[str, Any]
    team_performance: Dict[str, Any]
    upcoming_items: Dict[str, Any]


class GranularInsightsRequest(BaseModel):
    project_id: Optional[int] = None
    test_run_id: Optional[int] = None
    test_case_id: Optional[int] = None
    filter_type: str = "all"  # all, failed, slow


class GranularInsightsResponse(BaseModel):
    test_step_results: List[TestStepResult]
    summary: Dict[str, Any]


class ShareableReportRequest(BaseModel):
    project_id: int
    title: str
    report_type: str
    shared_with: List[Union[int, str]]
    access_level: str = "read-only"
    expires_in_days: Optional[int] = None


class RootCauseAnalysisRequest(BaseModel):
    project_id: int
    requirement_id: Optional[int] = None
    test_case_id: Optional[int] = None
    defect_id: Optional[int] = None


class ReportGenerationRequest(BaseModel):
    project_id: int
    report_type: str
    time_period: str = "7d"
    include_sections: List[str] = []
    format: str = "json"  # json, pdf, excel


# Shared Step Schemas
class SharedStepBase(BaseModel):
    name: str
    description: Optional[str] = None
    action: str
    expected_result: str
    project_id: int
    is_active: bool = True
    usage_count: int = 0


class SharedStepCreate(SharedStepBase):
    created_by: int


class SharedStepUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    action: Optional[str] = None
    expected_result: Optional[str] = None
    is_active: Optional[bool] = None


class SharedStep(SharedStepBase):
    id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Global Parameter Schemas
class GlobalParameterBase(BaseModel):
    name: str
    value: str
    description: Optional[str] = None
    parameter_type: str = "string"
    project_id: Optional[int] = None
    is_active: bool = True
    is_encrypted: bool = False


class GlobalParameterCreate(GlobalParameterBase):
    created_by: int


class GlobalParameterUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[str] = None
    description: Optional[str] = None
    parameter_type: Optional[str] = None
    project_id: Optional[int] = None
    is_active: Optional[bool] = None
    is_encrypted: Optional[bool] = None


class GlobalParameter(GlobalParameterBase):
    id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Mindmap Schemas
class TestMindmapBase(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: int
    mindmap_data: Optional[dict] = None
    is_active: bool = True


class TestMindmapCreate(TestMindmapBase):
    created_by: int


class TestMindmapUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    mindmap_data: Optional[dict] = None
    is_active: Optional[bool] = None


class TestMindmap(TestMindmapBase):
    id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Impact Analysis Schemas
class ImpactAnalysisBase(BaseModel):
    title: str
    description: Optional[str] = None
    entity_type: str
    entity_id: int
    change_type: str
    project_id: int
    impact_data: Optional[dict] = None
    status: str = "pending"


class ImpactAnalysisCreate(ImpactAnalysisBase):
    created_by: int


class ImpactAnalysisUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    impact_data: Optional[dict] = None
    status: Optional[str] = None


class ImpactAnalysis(ImpactAnalysisBase):
    id: int
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


# Execution Environment Schemas
class ExecutionEnvironmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    environment_type: str
    config_data: Optional[dict] = None
    build_info: Optional[dict] = None
    is_active: bool = True


class ExecutionEnvironmentCreate(ExecutionEnvironmentBase):
    project_id: int


class ExecutionEnvironmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    environment_type: Optional[str] = None
    config_data: Optional[dict] = None
    build_info: Optional[dict] = None
    is_active: Optional[bool] = None


class ExecutionEnvironment(ExecutionEnvironmentBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Schedule Schemas
class TestScheduleBase(BaseModel):
    name: str
    description: Optional[str] = None
    schedule_type: str
    schedule_config: Optional[dict] = None
    is_active: bool = True


class TestScheduleCreate(TestScheduleBase):
    project_id: int
    test_suite_id: Optional[int] = None
    environment_id: Optional[int] = None
    created_by: int


class TestScheduleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schedule_type: Optional[str] = None
    schedule_config: Optional[dict] = None
    is_active: Optional[bool] = None
    test_suite_id: Optional[int] = None
    environment_id: Optional[int] = None


class TestSchedule(TestScheduleBase):
    id: int
    project_id: int
    test_suite_id: Optional[int] = None
    environment_id: Optional[int] = None
    created_by: int
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Execution Engine Schemas
class ExecutionEngineBase(BaseModel):
    name: str
    engine_type: str
    config_data: Optional[dict] = None
    max_concurrent_runs: int = 10
    is_active: bool = True


class ExecutionEngineCreate(ExecutionEngineBase):
    pass


class ExecutionEngineUpdate(BaseModel):
    name: Optional[str] = None
    engine_type: Optional[str] = None
    config_data: Optional[dict] = None
    max_concurrent_runs: Optional[int] = None
    is_active: Optional[bool] = None


class ExecutionEngine(ExecutionEngineBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Execution Log Schemas
class ExecutionLogBase(BaseModel):
    log_level: str
    message: str
    metadata: Optional[dict] = None


class ExecutionLogCreate(ExecutionLogBase):
    test_run_id: int
    test_result_id: Optional[int] = None


class ExecutionLog(ExecutionLogBase):
    id: int
    test_run_id: int
    test_result_id: Optional[int] = None
    timestamp: datetime

    class Config:
        from_attributes = True


# Test Run Environment Schemas
class TestRunEnvironmentBase(BaseModel):
    config_snapshot: Optional[dict] = None
    build_snapshot: Optional[dict] = None


class TestRunEnvironmentCreate(TestRunEnvironmentBase):
    test_run_id: int
    environment_id: int


class TestRunEnvironment(TestRunEnvironmentBase):
    id: int
    test_run_id: int
    environment_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Add to exports for OpenAPI
__all__ = [
    "ProjectBase", "ProjectCreate", "ProjectUpdate", "Project",
    "TestSuiteBase", "TestSuiteCreate", "TestSuiteUpdate", "TestSuite", 
    "TestCaseBase", "TestCaseCreate", "TestCaseUpdate", "TestCase",
    "TestRunBase", "TestRunCreate", "TestRunUpdate", "TestRun", "TestSuiteRunCreate", "TestSuiteRun",
    "TestResultBase", "TestResultCreate", "TestResultUpdate", "TestResult",
    "UserBase", "UserCreate", "UserUpdate", "User",
    "ProjectAssignmentBase", "ProjectAssignmentCreate", "ProjectAssignmentUpdate", "ProjectAssignment",
    "TestScheduleBase", "TestScheduleCreate", "TestScheduleUpdate", "TestSchedule",
    "TestExecutionBase", "TestExecutionCreate", "TestExecutionUpdate", "TestExecution",
    "Token", "TokenData", "LoginRequest",
    "TestRunWithResults", "TestCaseWithSuite", "TestSuiteWithCases", "ProjectWithSuites",
    "TestRunStatistics",
    "CustomFieldDefinitionBase", "CustomFieldDefinitionCreate", "CustomFieldDefinitionUpdate", "CustomFieldDefinition",
    "CustomFieldValueBase", "CustomFieldValueCreate", "CustomFieldValueUpdate", "CustomFieldValue",
    "TestCaseWithCustomFields", "CustomFieldDefinitionWithValues",
    "JiraIntegrationBase", "JiraIntegrationCreate", "JiraIntegrationUpdate", "JiraIntegration",
    "JiraIssueBase", "JiraIssueCreate", "JiraIssueUpdate", "JiraIssue",
    "TestCaseSectionBase", "TestCaseSectionCreate", "TestCaseSectionUpdate", "TestCaseSection",
    "TestCaseRevisionBase", "TestCaseRevisionCreate", "TestCaseRevision",
    "RecycleBinBase", "RecycleBinCreate", "RecycleBin",
    "TestCaseExport", "TestSuiteWithSections", "TestCaseSectionWithCases",
    "RequirementBase", "RequirementCreate", "RequirementUpdate", "Requirement",
    "DefectBase", "DefectCreate", "DefectUpdate", "Defect",
    "TestPlanBase", "TestPlanCreate", "TestPlanUpdate", "TestPlan",
    "MilestoneBase", "MilestoneCreate", "MilestoneUpdate", "MilestoneLinkedTestPlan", "Milestone",
    "TraceabilityMatrixBase", "TraceabilityMatrixCreate", "TraceabilityMatrix",
    "CoverageReportBase", "CoverageReportCreate", "CoverageReport",
    "NotificationBase", "NotificationCreate", "NotificationUpdate", "Notification",
    "SharedStepBase", "SharedStepCreate", "SharedStepUpdate", "SharedStep",
    "GlobalParameterBase", "GlobalParameterCreate", "GlobalParameterUpdate", "GlobalParameter",
    "TestMindmapBase", "TestMindmapCreate", "TestMindmapUpdate", "TestMindmap",
    "ImpactAnalysisBase", "ImpactAnalysisCreate", "ImpactAnalysisUpdate", "ImpactAnalysis",
    "ExecutionEnvironmentBase", "ExecutionEnvironmentCreate", "ExecutionEnvironmentUpdate", "ExecutionEnvironment",
    "TestScheduleBase", "TestScheduleCreate", "TestScheduleUpdate", "TestSchedule",
    "ExecutionEngineBase", "ExecutionEngineCreate", "ExecutionEngineUpdate", "ExecutionEngine",
    "ExecutionLogBase", "ExecutionLogCreate", "ExecutionLog",
    "TestRunEnvironmentBase", "TestRunEnvironmentCreate", "TestRunEnvironment",
    "TestTypeDefinitionBase", "TestTypeDefinitionCreate", "TestTypeDefinitionUpdate", "TestTypeDefinition",
    "PriorityDefinitionBase", "PriorityDefinitionCreate", "PriorityDefinitionUpdate", "PriorityDefinition",
    "SharedStepTemplateBase", "SharedStepTemplateCreate", "SharedStepTemplateUpdate", "SharedStepTemplate",
    "TestExecutionSettingsBase", "TestExecutionSettingsCreate", "TestExecutionSettingsUpdate", "TestExecutionSettings",
    "NotificationSettingsBase", "NotificationSettingsCreate", "NotificationSettingsUpdate", "NotificationSettings",
    "AutomationSettingsBase", "AutomationSettingsCreate", "AutomationSettingsUpdate", "AutomationSettings"
]
