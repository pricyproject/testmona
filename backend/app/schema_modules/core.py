from pydantic import AliasChoices, BaseModel, EmailStr, field_validator, HttpUrl, model_validator, Field
from typing import List, Optional, Dict, Any, Union, TYPE_CHECKING
from datetime import datetime

if TYPE_CHECKING:
    # These models live in sibling schema modules and are referenced here only as
    # string forward refs (resolved by ``schemas.py`` via ``model_rebuild`` over the
    # aggregated namespace). Importing them under TYPE_CHECKING binds the names for
    # static analysis without introducing runtime circular imports.
    from .custom_fields import CustomFieldValue
    from .defects import TestResultDefectLink, User
from ..models import Priority, Status, TestStatus, ResultStatus, Role, Permission, CustomFieldType, TestType, RecycleBinType, RequirementStatus, DefectStatus, DefectSeverity, DefectPriority, DefectLinkType, MilestoneStatus, NotificationType, StepCategory, StepComplexity, DocStatus
import re
import html

from .versioning import (
    DateValidationRules,
    NumberValidationRules,
    SelectValidationRules,
    TestCaseVersionBase,
    TestCaseVersionCreate,
    TestCaseVersionUpdate,
    TextValidationRules,
    VersionComparisonBase,
    VersionComparisonCreate,
    VersionLockBase,
    VersionLockCreate,
    VersionTagBase,
    VersionTagCreate,
)
from ..services.webhook_security import normalize_webhook_url


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


class ProjectClone(BaseModel):
    """Payload for cloning a project; all fields optional and inherited from source when omitted."""
    name: Optional[str] = None
    description: Optional[str] = None
    owner_id: Optional[int] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class Project(ProjectBase):
    id: int
    owner_id: Optional[int] = None
    features: Optional[Dict[str, bool]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        use_enum_values = True


class ProjectFeaturesUpdate(BaseModel):
    """Partial update of a project's feature toggles; only listed keys change."""
    features: Dict[str, bool]


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
    # Optional bulk-move of existing test cases into the new suite. Cases that don't
    # exist or live in another project are skipped rather than failing the whole create.
    test_case_ids: Optional[List[int]] = None


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
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Populated by the routes for list/detail responses; the model attribute is set in
    # the route handler so SQLAlchemy doesn't need an additional column.
    test_case_count: int = 0

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
    tags: Optional[str] = Field(None, max_length=500)
    section_id: Optional[int] = None
    order_index: Optional[int] = 0
    is_multistep: Optional[bool] = False  # Flag to indicate multistep format
    dataset_id: Optional[int] = None  # Reusable data set this case iterates over during a run

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
    tags: Optional[str] = Field(None, max_length=500)
    section_id: Optional[int] = None
    test_suite_id: Optional[int] = None
    order_index: Optional[int] = None
    is_multistep: Optional[bool] = None  # Flag to indicate multistep format
    dataset_id: Optional[int] = None  # Reusable data set this case iterates over (null detaches)

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks.

        Unescape before escaping so re-saving an already-stored value is
        idempotent -- a plain ``html.escape`` would compound ``&lt;`` into
        ``&amp;lt;`` on every update, progressively corrupting the text.
        """
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['test_type', 'priority', 'status']:
                    data[key] = html.escape(html.unescape(value))
        return data


class TestCase(TestCaseBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
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


class TestCaseLinkedRequirement(BaseModel):
    id: int
    requirement_id: str
    title: str
    status: str
    priority: str
    description: Optional[str] = None
    acceptance_criteria: Optional[str] = None

    class Config:
        from_attributes = True
        use_enum_values = True


class TestCaseWithRelations(TestCaseBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: Optional[int] = None  # denormalised from the suite
    test_suite_id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    test_suite: Optional[TestSuiteNested] = None
    section: Optional[TestCaseSectionNested] = None
    test_steps: List[TestCaseStep] = []
    custom_field_values: List['CustomFieldValue'] = []
    creator: Optional['User'] = None
    linked_requirements: List[TestCaseLinkedRequirement] = Field(default_factory=list)
    # Per-request capability flags for the current user (Doc Hub pattern); the
    # frontend gates Edit/Delete controls on these. Populated by the read route.
    can_edit: Optional[bool] = None
    can_delete: Optional[bool] = None

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


class TestRunAssign(BaseModel):
    assigned_to: Optional[int] = Field(None, ge=1)


class TestRun(TestRunBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    test_plan_id: Optional[int] = None
    matrix_run_id: Optional[int] = None
    milestone_id: Optional[int] = None
    environment_id: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    assigned_to: Optional[int] = None
    assignee: Optional['User'] = None
    priority: Optional[str] = "medium"
    estimated_duration: Optional[int] = None
    total_tests: int = 0
    executed_tests: int = 0
    not_started_tests: int = 0
    passed_tests: int = 0
    failed_tests: int = 0
    blocked_tests: int = 0
    skipped_tests: int = 0
    progress_percent: int = 0
    # environment: Optional[str] = None  # Temporarily disabled

    class Config:
        from_attributes = True
        use_enum_values = True


class MatrixRunCreate(BaseModel):
    """Create one test run per environment, all seeded with the same cases."""
    project_id: int
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    environment_ids: List[int] = Field(..., min_length=1)
    test_case_ids: List[int] = Field(..., min_length=1)
    test_plan_id: Optional[int] = None
    milestone_id: Optional[int] = None
    assigned_to: Optional[int] = None
    priority: Optional[str] = "medium"
    estimated_duration: Optional[int] = None


class MatrixRunEnvironmentColumn(BaseModel):
    """One pivot column: the child run executing the matrix on one environment."""
    test_run_id: int
    test_run_seq: Optional[int] = None
    environment_id: Optional[int] = None
    environment_name: str
    status: str
    total_tests: int = 0
    executed_tests: int = 0
    passed_tests: int = 0
    failed_tests: int = 0
    blocked_tests: int = 0
    skipped_tests: int = 0
    not_started_tests: int = 0
    progress_percent: int = 0


class MatrixRun(BaseModel):
    id: int
    project_id: int
    project_seq: Optional[int] = None
    name: str
    description: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    status: str = "pending"
    case_count: int = 0
    progress_percent: int = 0
    environments: List[MatrixRunEnvironmentColumn] = []

    class Config:
        from_attributes = True


class MatrixRunCell(BaseModel):
    """Latest outcome of one case on one environment's run."""
    test_result_id: Optional[int] = None
    status: str = "not_started"


class MatrixRunRow(BaseModel):
    test_case_id: int
    test_case_seq: Optional[int] = None
    title: str
    priority: Optional[str] = None
    # Keyed by str(test_run_id) — JSON object keys are strings.
    results: Dict[str, MatrixRunCell] = {}


class MatrixRunDetail(MatrixRun):
    rows: List[MatrixRunRow] = []


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
    # Failure context for failed/blocked executions
    defect_link: Optional[str] = Field(None, max_length=500, description="URL to a defect in an external tracker")
    custom_link: Optional[str] = Field(None, max_length=500, description="Free-form reference URL")
    blocker_reason: Optional[str] = Field(
        None, max_length=50,
        description="Why a blocked execution couldn't be completed (environment, test_data, dependency, access, awaiting_fix, other)",
    )
    retest_needed: Optional[bool] = Field(None, description="Set when a linked defect is resolved or reopened")
    iteration_results: Optional[List[Dict[str, Any]]] = Field(
        None, description="Per-iteration outcomes for data-driven cases: [{row_index, values, status, ...}]"
    )


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
    # Failure context for failed/blocked executions
    defect_link: Optional[str] = Field(None, max_length=500, description="URL to a defect in an external tracker")
    custom_link: Optional[str] = Field(None, max_length=500, description="Free-form reference URL")
    blocker_reason: Optional[str] = Field(
        None, max_length=50,
        description="Why a blocked execution couldn't be completed (environment, test_data, dependency, access, awaiting_fix, other)",
    )
    retest_needed: Optional[bool] = Field(None, description="Set when a linked defect is resolved or reopened")
    iteration_results: Optional[List[Dict[str, Any]]] = Field(
        None, description="Per-iteration outcomes for data-driven cases: [{row_index, values, status, ...}]"
    )


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
    defect_links: List['TestResultDefectLink'] = []

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
    two_factor_enabled: bool = False
    session_version: int = 0
    notifications_muted_until: Optional[datetime] = None
    do_not_disturb: bool = False
    notification_sound_enabled: bool = True

    @field_validator('role', mode='before')
    @classmethod
    def normalize_role_value(cls, value: Any) -> str:
        from ..rbac import role_value
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


class FirstAdminSetup(BaseModel):
    """Payload for the token-gated first-run admin creation endpoint.

    Deliberately minimal — role/superuser/active are decided server-side, never
    accepted from the caller (no mass-assignment).
    """
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    password: str
    setup_token: str


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
        from ..rbac import role_value
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


# NOTE: The public ``User`` response schema is defined later in this module
# (the standalone version with a ``role`` normalizer). An earlier duplicate
# ``User(UserBase)`` used to live here and was silently shadowed by it; it has
# been removed so ``schemas.User`` no longer depends on definition order.


# User Invitation Schemas
class UserInvitationBase(BaseModel):
    email: EmailStr
    role: str = Role.TESTER.value
    project_ids: Optional[List[int]] = Field(default_factory=list, json_schema_extra={"default": []})

    @field_validator('role')
    @classmethod
    def validate_role(cls, value: str) -> str:
        from ..rbac import role_value
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


class UserInvitationPublic(UserInvitationBase):
    id: int
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
        from ..rbac import role_value
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
        from ..rbac import role_value
        return role_value(value)


class ProjectMember(BaseModel):
    """Flattened member view for the per-project roles UI."""
    assignment_id: Optional[int] = None  # None for the implicit owner row
    user_id: int
    project_id: int
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Role
    is_owner: bool = False
    assigned_at: Optional[datetime] = None
    assigned_by: Optional[int] = None

    class Config:
        from_attributes = True
        use_enum_values = True


# NOTE: The TestSchedule* schemas are defined later in this module (the set
# matching the TestSchedule DB model: schedule_type/schedule_config/project_id).
# An earlier, model-mismatched duplicate set used to live here and was silently
# shadowed by the later one; it has been removed to avoid definition-order bugs.


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
    two_factor_code: Optional[str] = None


class Token(BaseModel):
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_type: str
    requires_2fa: bool = False
    force_password_change: bool = False


class TwoFactorSetupResponse(BaseModel):
    secret: str
    provisioning_uri: str


class TwoFactorEnableRequest(BaseModel):
    current_password: str
    code: str


class TwoFactorEnableResponse(BaseModel):
    enabled: bool
    recovery_codes: List[str]


class TwoFactorDisableRequest(BaseModel):
    current_password: str
    code: str


class TwoFactorRecoveryCodesRequest(BaseModel):
    current_password: str
    code: str


class TwoFactorRecoveryCodesResponse(BaseModel):
    recovery_codes: List[str]


class AdminTwoFactorResetResponse(BaseModel):
    enabled: bool
    user_id: int


class TwoFactorStatus(BaseModel):
    enabled: bool


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


class MessageResponse(BaseModel):
    message: str


class CountResponse(BaseModel):
    count: int


class ExecutionHistoryItem(BaseModel):
    id: int
    test_run_id: Optional[int] = None
    test_run_name: Optional[str] = None
    test_run_status: Optional[str] = None
    test_run_priority: Optional[str] = None
    test_run_created_at: Optional[datetime] = None
    test_run_started_at: Optional[datetime] = None
    test_run_completed_at: Optional[datetime] = None
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    status: Optional[str] = None
    executed_by: Optional[str] = None
    executed_by_full_name: Optional[str] = None
    executed_by_email: Optional[str] = None
    executed_by_id: Optional[int] = None
    executor_source: Optional[str] = None
    executed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    comments: Optional[str] = None
    actual_result: Optional[str] = None
    execution_started_at: Optional[datetime] = None
    execution_time: Optional[float] = None
