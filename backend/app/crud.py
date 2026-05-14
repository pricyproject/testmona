from sqlalchemy.orm import Session, joinedload, noload, selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy import func, or_, text
from typing import List, Optional
from datetime import datetime, timedelta
import re
from . import schemas
from .services.execution_timing import apply_test_result_execution_timing
from .models import Project, TestSuite, TestCase, TestCaseStep, TestRun, TestResult, User, Role, CustomFieldDefinition, CustomFieldValue, CustomFieldType, JiraIntegration, JiraIssue, Requirement, Defect, TestPlan, Milestone, TraceabilityMatrix, CoverageReport, Notification, TestCaseSection, SharedStep, GlobalParameter, TestMindmap, ImpactAnalysis, ExecutionEnvironment, ExecutionLog, TestSchedule, ExecutionEngine, TestRunEnvironment, DefectComment, DefectAttachment, DefectHistory, DefectWorkflow, DefectTemplate, IssueTrackerIntegration, SyncLog, KPIData, TestStepResult, ShareableReport, RootCauseAnalysis, DashboardWidget, TestCaseRevision, RequirementStatus, Priority, TestTypeDefinition, PriorityDefinition, SharedStepTemplate, TestExecutionSettings, NotificationSettings, AutomationSettings, SystemSettings, OnboardingChecklist
from .schemas import (
    ProjectCreate, ProjectUpdate,
    TestSuiteCreate, TestSuiteUpdate,
    TestCaseCreate, TestCaseUpdate,
    TestRunCreate, TestRunUpdate,
    TestResultCreate, TestResultUpdate,
    UserCreate, UserUpdate,
    CustomFieldDefinitionCreate, CustomFieldDefinitionUpdate,
    CustomFieldValueCreate, CustomFieldValueUpdate,
    JiraIntegrationCreate, JiraIntegrationUpdate,
    JiraIssueCreate, JiraIssueUpdate,
    RequirementCreate, RequirementUpdate,
    DefectCreate, DefectUpdate,
    TestPlanCreate, TestPlanUpdate,
    MilestoneCreate, MilestoneUpdate,
    TraceabilityMatrixCreate,
    CoverageReportCreate,
    NotificationCreate, NotificationUpdate,
    TestCaseSectionCreate, TestCaseSectionUpdate,
    TestCaseRevisionCreate,
    # Test Case Steps schemas
    TestCaseStepCreate, TestCaseStepUpdate,
    # Analytics schemas
    KPIDataCreate, TestStepResultCreate, ShareableReportCreate, RootCauseAnalysisCreate,
    DashboardWidgetCreate,
    # Test Management Settings schemas
    TestTypeDefinitionCreate, TestTypeDefinitionUpdate,
    PriorityDefinitionCreate, PriorityDefinitionUpdate,
    SharedStepTemplateCreate, SharedStepTemplateUpdate,
    TestExecutionSettingsCreate, TestExecutionSettingsUpdate,
    NotificationSettingsCreate, NotificationSettingsUpdate,
    AutomationSettingsCreate, AutomationSettingsUpdate,
    SystemSettingsCreate, SystemSettingsUpdate
)


def safe_commit(db: Session) -> bool:
    """Safely commit a transaction with rollback on error.
    Returns True if commit succeeded, False otherwise.
    """
    try:
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise


def get_project(db: Session, project_id: int):
    project = db.query(Project).filter(Project.id == project_id).first()
    if project:
        # Add test case counts for the project
        test_case_count = db.query(TestCase).join(TestSuite).filter(TestSuite.project_id == project.id).count()
        test_suite_count = db.query(TestSuite).filter(TestSuite.project_id == project.id).count()
        test_run_count = db.query(TestRun).filter(TestRun.project_id == project.id).count()
        
        # Add counts as attributes
        project.test_cases_count = test_case_count
        project.test_suites_count = test_suite_count
        project.test_runs_count = test_run_count
    
    return project


def get_projects(db: Session, skip: int = 0, limit: int = 100):
    projects = db.query(Project).offset(skip).limit(limit).all()
    
    # Add test case counts for each project
    for project in projects:
        # Count test cases through test suites
        test_case_count = db.query(TestCase).join(TestSuite).filter(TestSuite.project_id == project.id).count()
        test_suite_count = db.query(TestSuite).filter(TestSuite.project_id == project.id).count()
        test_run_count = db.query(TestRun).filter(TestRun.project_id == project.id).count()
        
        # Add counts as attributes (these won't be saved to DB but will be returned)
        project.test_cases_count = test_case_count
        project.test_suites_count = test_suite_count
        project.test_runs_count = test_run_count
    
    return projects


def create_project(db: Session, project: ProjectCreate):
    db_project = Project(**project.model_dump())
    db.add(db_project)
    safe_commit(db)
    db.refresh(db_project)
    return db_project


def update_project(db: Session, project_id: int, project: ProjectUpdate):
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if db_project:
        for key, value in project.model_dump(exclude_unset=True).items():
            setattr(db_project, key, value)
        safe_commit(db)
        db.refresh(db_project)
    return db_project


def delete_project(db: Session, project_id: int):
    db_project = db.query(Project).options(
        noload(Project.test_suites),
        noload(Project.test_runs),
        noload(Project.test_plans),
        noload(Project.milestones),
        noload(Project.requirements),
        noload(Project.defects),
        noload(Project.coverage_reports),
        noload(Project.user_assignments),
        noload(Project.owner),
        noload(Project.custom_field_definitions),
        noload(Project.jira_integrations)
    ).filter(Project.id == project_id).first()
    if db_project:
        # Delete all related data in the correct order to avoid foreign key constraints
        
        # Delete test results (through test runs)
        from .models import TestResult, TestRun, TestCase, TestSuite
        test_runs = db.query(TestRun).filter(TestRun.project_id == project_id).all()
        for test_run in test_runs:
            db.query(TestResult).filter(TestResult.test_run_id == test_run.id).delete()
        
        # Delete test runs
        db.query(TestRun).filter(TestRun.project_id == project_id).delete()
        
        # Delete test cases (through test suites)
        test_suites = db.query(TestSuite).filter(TestSuite.project_id == project_id).all()
        for test_suite in test_suites:
            db.query(TestCase).filter(TestCase.test_suite_id == test_suite.id).delete()
        
        # Delete test suites
        db.query(TestSuite).filter(TestSuite.project_id == project_id).delete()
        
        # Delete traceability matrix entries (through requirements and test cases)
        # TraceabilityMatrix links requirements to test cases, so we need to delete entries
        # where either the requirement or test case belongs to this project
        from .models import (
            TestPlan, Milestone, Requirement, Defect, CoverageReport,
            ProjectAssignment, CustomFieldDefinition, JiraIntegration,
            TraceabilityMatrix, KPIData, ShareableReport, DashboardWidget
        )
        
        # Get all test case IDs in this project
        test_case_ids = []
        for test_suite in test_suites:
            tc_ids = db.query(TestCase.id).filter(TestCase.test_suite_id == test_suite.id).all()
            test_case_ids.extend([tc_id[0] for tc_id in tc_ids])
        
        # Get all requirement IDs in this project
        requirement_ids = [req[0] for req in db.query(Requirement.id).filter(Requirement.project_id == project_id).all()]
        
        # Delete traceability matrix entries
        if test_case_ids:
            db.query(TraceabilityMatrix).filter(TraceabilityMatrix.test_case_id.in_(test_case_ids)).delete()
        if requirement_ids:
            db.query(TraceabilityMatrix).filter(TraceabilityMatrix.requirement_id.in_(requirement_ids)).delete()
        
        # Delete test plans
        db.query(TestPlan).filter(TestPlan.project_id == project_id).delete()
        db.query(Milestone).filter(Milestone.project_id == project_id).delete()
        db.query(Requirement).filter(Requirement.project_id == project_id).delete()
        db.query(Defect).filter(Defect.project_id == project_id).delete()
        db.query(CoverageReport).filter(CoverageReport.project_id == project_id).delete()
        db.query(ProjectAssignment).filter(ProjectAssignment.project_id == project_id).delete()
        db.query(CustomFieldDefinition).filter(CustomFieldDefinition.project_id == project_id).delete()
        db.query(JiraIntegration).filter(JiraIntegration.project_id == project_id).delete()
        db.query(KPIData).filter(KPIData.project_id == project_id).delete()
        db.query(ShareableReport).filter(ShareableReport.project_id == project_id).delete()
        db.query(DashboardWidget).filter(DashboardWidget.project_id == project_id).delete()
        
        # Finally delete the project
        db.delete(db_project)
        safe_commit(db)
    return db_project


def get_test_suite(db: Session, test_suite_id: int):
    return db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()


def get_test_suites(db: Session, project_id: Optional[int] = None, skip: int = 0, limit: int = 100):
    query = db.query(TestSuite)
    if project_id:
        query = query.filter(TestSuite.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def create_test_suite(db: Session, test_suite: TestSuiteCreate):
    db_test_suite = TestSuite(**test_suite.model_dump())
    db.add(db_test_suite)
    safe_commit(db)
    db.refresh(db_test_suite)
    return db_test_suite


def update_test_suite(db: Session, test_suite_id: int, test_suite: TestSuiteUpdate):
    db_test_suite = db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()
    if db_test_suite:
        for key, value in test_suite.model_dump(exclude_unset=True).items():
            setattr(db_test_suite, key, value)
        safe_commit(db)
        db.refresh(db_test_suite)
    return db_test_suite


def delete_test_suite(db: Session, test_suite_id: int):
    db_test_suite = db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()
    if db_test_suite:
        db.delete(db_test_suite)
        safe_commit(db)
    return db_test_suite


def get_test_case(db: Session, test_case_id: int):
    return db.query(TestCase).options(
        joinedload(TestCase.test_suite).joinedload(TestSuite.project),
        joinedload(TestCase.section),
        joinedload(TestCase.creator),
        selectinload(TestCase.custom_field_values)
    ).filter(TestCase.id == test_case_id).first()


def get_test_cases(db: Session, test_suite_id: Optional[int] = None, section_id: Optional[int] = None, skip: int = 0, limit: int = 100):
    from sqlalchemy.orm import joinedload
    
    query = db.query(TestCase).options(
        joinedload(TestCase.test_suite).joinedload(TestSuite.project),
        joinedload(TestCase.section),
        joinedload(TestCase.creator),
        selectinload(TestCase.custom_field_values)
    )
    if test_suite_id:
        query = query.filter(TestCase.test_suite_id == test_suite_id)
    if section_id:
        query = query.filter(TestCase.section_id == section_id)
    return query.offset(skip).limit(limit).all()


def create_test_case(db: Session, test_case: TestCaseCreate, created_by: int):
    # Extract test_steps from the create schema before creating the test case
    test_steps_data = test_case.test_steps
    test_case_dict = test_case.model_dump(exclude={'test_steps'})
    
    db_test_case = TestCase(**test_case_dict)
    db_test_case.created_by = created_by
    
    # If multi-step data is provided, set is_multistep flag
    if test_steps_data and len(test_steps_data) > 0:
        db_test_case.is_multistep = True
    
    db.add(db_test_case)
    safe_commit(db)
    db.refresh(db_test_case)
    
    # Create test steps if provided (multi-step support)
    if test_steps_data and len(test_steps_data) > 0:
        for step_data in test_steps_data:
            step_dict = step_data.model_dump(exclude={'test_case_id'})
            db_step = TestCaseStep(**step_dict, test_case_id=db_test_case.id)
            db.add(db_step)
        safe_commit(db)
        db.refresh(db_test_case)
    
    return db_test_case


def update_test_case(db: Session, test_case_id: int, test_case: TestCaseUpdate):
    db_test_case = db.query(TestCase).filter(TestCase.id == test_case_id).first()
    if db_test_case:
        for key, value in test_case.model_dump(exclude_unset=True).items():
            setattr(db_test_case, key, value)
        safe_commit(db)
        db.refresh(db_test_case)
    return db_test_case


def delete_test_case(db: Session, test_case_id: int):
    db_test_case = db.query(TestCase).filter(TestCase.id == test_case_id).first()
    if db_test_case:
        db.delete(db_test_case)
        safe_commit(db)
    return db_test_case


# Test Case Step CRUD functions
def get_test_case_steps(db: Session, test_case_id: int):
    return db.query(TestCaseStep).filter(TestCaseStep.test_case_id == test_case_id).order_by(TestCaseStep.step_number).all()


def get_test_case_step(db: Session, step_id: int):
    return db.query(TestCaseStep).filter(TestCaseStep.id == step_id).first()


def create_test_case_step(db: Session, step: schemas.TestCaseStepCreate):
    step_dict = step.model_dump()
    if not step_dict.get('test_case_id'):
        raise ValueError('test_case_id is required when creating a standalone test case step')

    db_step = TestCaseStep(**step_dict)
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def create_test_case_steps(db: Session, test_case_id: int, steps: List[schemas.TestCaseStepCreate]):
    # Delete existing steps for this test case
    db.query(TestCaseStep).filter(TestCaseStep.test_case_id == test_case_id).delete()
    
    # Create new steps
    db_steps = []
    for step_data in steps:
        step_dict = step_data.model_dump(exclude={'test_case_id'})
        db_step = TestCaseStep(**step_dict, test_case_id=test_case_id)
        db.add(db_step)
        db_steps.append(db_step)
    
    safe_commit(db)
    for step in db_steps:
        db.refresh(step)
    return db_steps


def update_test_case_step(db: Session, step_id: int, step: schemas.TestCaseStepUpdate):
    db_step = db.query(TestCaseStep).filter(TestCaseStep.id == step_id).first()
    if db_step:
        for key, value in step.model_dump(exclude_unset=True).items():
            setattr(db_step, key, value)
        safe_commit(db)
        db.refresh(db_step)
    return db_step


def delete_test_case_step(db: Session, step_id: int):
    db_step = db.query(TestCaseStep).filter(TestCaseStep.id == step_id).first()
    if db_step:
        db.delete(db_step)
        safe_commit(db)
    return db_step


def get_test_case_with_steps(db: Session, test_case_id: int):
    test_case = db.query(TestCase).options(
        joinedload(TestCase.test_suite).joinedload(TestSuite.project),
        joinedload(TestCase.section),
        joinedload(TestCase.test_steps)
    ).filter(TestCase.id == test_case_id).first()
    return test_case


def get_test_run(db: Session, test_run_id: int):
    return db.query(TestRun).filter(TestRun.id == test_run_id).first()


def get_test_runs(
    db: Session,
    project_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to: Optional[int] = None,
    test_plan_id: Optional[int] = None,
    milestone_id: Optional[int] = None,
):
    query = db.query(TestRun)
    if project_id:
        query = query.filter(TestRun.project_id == project_id)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                TestRun.name.ilike(search_pattern),
                TestRun.description.ilike(search_pattern),
            )
        )
    if status:
        query = query.filter(TestRun.status == status)
    if priority:
        query = query.filter(TestRun.priority == priority)
    if assigned_to:
        query = query.filter(TestRun.assigned_to == assigned_to)
    if test_plan_id:
        query = query.filter(TestRun.test_plan_id == test_plan_id)
    if milestone_id:
        query = query.outerjoin(TestPlan, TestRun.test_plan_id == TestPlan.id).filter(
            or_(TestRun.milestone_id == milestone_id, TestPlan.milestone_id == milestone_id)
        )
    query = query.order_by(TestRun.created_at.desc(), TestRun.id.desc())
    return query.offset(skip).limit(limit).all()


def create_test_run(db: Session, test_run: TestRunCreate):
    # Convert assigned_to from string to int if needed
    test_run_data = test_run.model_dump()
    if test_run_data.get('assigned_to') and isinstance(test_run_data['assigned_to'], str):
        test_run_data['assigned_to'] = int(test_run_data['assigned_to'])
    
    # Create TestRun without relationship handling
    db_test_run = TestRun(
        name=test_run_data['name'],
        description=test_run_data.get('description'),
        project_id=test_run_data['project_id'],
        test_plan_id=test_run_data.get('test_plan_id'),
        milestone_id=test_run_data.get('milestone_id'),
        status=test_run_data.get('status', 'pending'),
        # environment=test_run_data.get('environment'),  # Temporarily disabled
        environment_id=test_run_data.get('environment_id'),
        assigned_to=test_run_data.get('assigned_to'),
        priority=test_run_data.get('priority'),
        estimated_duration=test_run_data.get('estimated_duration'),
        schedule_id=test_run_data.get('schedule_id')
    )
    
    db.add(db_test_run)
    safe_commit(db)
    db.refresh(db_test_run)
    return db_test_run


def create_test_suite_run(db: Session, test_suite: TestSuite, test_cases: List[TestCase], run_data: schemas.TestSuiteRunCreate):
    """Create a test run and its initial results atomically for a suite."""
    if not test_cases:
        raise ValueError("Cannot create a test run for a suite with no test cases")

    run_values = run_data.model_dump(exclude_unset=True)
    db_test_run = TestRun(
        name=run_values.get("name") or f"Test Run - {test_suite.name}",
        description=run_values.get("description") or f"Test run for {test_suite.name}",
        project_id=test_suite.project_id,
        status="pending",
        assigned_to=run_values.get("assigned_to"),
        priority=run_values.get("priority") or "medium",
        estimated_duration=run_values.get("estimated_duration"),
    )
    db.add(db_test_run)
    db.flush()

    test_results = [
        TestResult(
            test_run_id=db_test_run.id,
            test_case_id=test_case.id,
            status="not_tested",
        )
        for test_case in test_cases
    ]
    db.add_all(test_results)
    safe_commit(db)
    db.refresh(db_test_run)
    for test_result in test_results:
        db.refresh(test_result)

    db_test_run.test_results = test_results
    return db_test_run


def update_test_run(db: Session, test_run_id: int, test_run: TestRunUpdate):
    db_test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
    if db_test_run:
        for key, value in test_run.model_dump(exclude_unset=True).items():
            setattr(db_test_run, key, value)
        safe_commit(db)
        db.refresh(db_test_run)
    return db_test_run


def delete_test_run(db: Session, test_run_id: int):
    db_test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
    if db_test_run:
        db.delete(db_test_run)
        safe_commit(db)
    return db_test_run


def get_test_result(db: Session, test_result_id: int):
    return db.query(TestResult).filter(TestResult.id == test_result_id).first()


def get_test_results(db: Session, test_run_id: Optional[int] = None, test_case_id: Optional[int] = None, skip: int = 0, limit: int = 100):
    query = db.query(TestResult).options(
        joinedload(TestResult.test_case).joinedload(TestCase.section),
        joinedload(TestResult.test_case).selectinload(TestCase.custom_field_values),
        joinedload(TestResult.executor)
    ).filter(
        TestResult.test_case_id.isnot(None),
        TestResult.test_run_id.isnot(None)
    )
    if test_run_id:
        query = query.filter(TestResult.test_run_id == test_run_id)
    if test_case_id:
        query = query.filter(TestResult.test_case_id == test_case_id)
    return query.offset(skip).limit(limit).all()


def create_test_result(db: Session, test_result: TestResultCreate):
    test_result_data = test_result.model_dump()
    db_test_result = TestResult(**test_result_data)
    apply_test_result_execution_timing(db_test_result, test_result_data)
    db.add(db_test_result)
    safe_commit(db)
    db.refresh(db_test_result)
    return db_test_result


def update_test_result(db: Session, test_result_id: int, test_result: TestResultUpdate):
    db_test_result = db.query(TestResult).filter(TestResult.id == test_result_id).first()
    if db_test_result:
        test_result_data = test_result.model_dump(exclude_unset=True)
        for key, value in test_result_data.items():
            setattr(db_test_result, key, value)
        apply_test_result_execution_timing(db_test_result, test_result_data)
        safe_commit(db)
        db.refresh(db_test_result)
    return db_test_result


def delete_test_result(db: Session, test_result_id: int):
    db_test_result = db.query(TestResult).filter(TestResult.id == test_result_id).first()
    if db_test_result:
        db.delete(db_test_result)
        safe_commit(db)
    return db_test_result


def get_user(db: Session, user_id: int):
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()


def get_users(db: Session, skip: int = 0, limit: int = 100):
    return db.query(User).offset(skip).limit(limit).all()


def create_user(db: Session, user: UserCreate):
    from .auth import get_password_hash
    from .rbac import role_value
    hashed_password = get_password_hash(user.password)
    db_user = User(
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        hashed_password=hashed_password,
        role=role_value(user.role, Role.TESTER),
        is_active=user.is_active,
        force_password_change=user.force_password_change
    )
    db.add(db_user)
    safe_commit(db)
    db.refresh(db_user)
    return db_user


def update_user(db: Session, user_id: int, user: UserUpdate):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user:
        from .rbac import role_value
        update_data = user.model_dump(exclude_unset=True)
        if "password" in update_data:
            from .auth import get_password_hash
            update_data["hashed_password"] = get_password_hash(update_data.pop("password"))
        for key, value in update_data.items():
            # Convert Role enum to string value for database compatibility
            if key == "role":
                value = role_value(value)
            setattr(db_user, key, value)
        safe_commit(db)
        db.refresh(db_user)
    return db_user


def delete_user(db: Session, user_id: int):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user:
        db.delete(db_user)
        safe_commit(db)
    return db_user


# Custom Field Definition CRUD
def get_custom_field_definition(db: Session, field_id: int):
    return db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()


def get_custom_field_definitions(db: Session, project_id: int, skip: int = 0, limit: int = 100):
    return db.query(CustomFieldDefinition).filter(CustomFieldDefinition.project_id == project_id).offset(skip).limit(limit).all()


def create_custom_field_definition(db: Session, field: CustomFieldDefinitionCreate, user_id: Optional[int] = None):
    field_dict = field.model_dump()
    
    # Generate slug if not provided
    if not field_dict.get('slug'):
        import re
        slug = field_dict['name'].lower()
        slug = re.sub(r'[^a-z0-9]+', '_', slug)
        slug = slug.strip('_')
        field_dict['slug'] = slug
    
    db_field = CustomFieldDefinition(**field_dict)
    db.add(db_field)
    safe_commit(db)
    db.refresh(db_field)
    
    # Create audit trail
    try:
        from .services.audit_service import get_audit_service
        from .schemas_audit import AuditTrailCreate
        audit_service = get_audit_service(db)
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action="create",
            entity_type="custom_field_definition",
            entity_id=db_field.id,
            description=f"Created custom field definition '{db_field.name}' in project {db_field.project_id}",
            ip_address=None,
            user_agent=None
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        print(f"Failed to create audit trail for custom field definition: {e}")
    
    return db_field


def update_custom_field_definition(db: Session, field_id: int, field: CustomFieldDefinitionUpdate, user_id: Optional[int] = None):
    db_field = db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()
    if db_field:
        update_data = field.model_dump(exclude_unset=True)
        
        # Check if is_required is being changed from False to True
        if 'is_required' in update_data and update_data['is_required'] == True and db_field.is_required == False:
            # Validate that all test cases in the project have values for this field
            from .models import TestCase
            test_cases = db.query(TestCase).filter(TestCase.project_id == db_field.project_id).all()
            
            # If there are no test cases, allow the change
            if test_cases:
                # Get all test case IDs that have values for this field
                test_case_ids_with_values = db.query(CustomFieldValue.test_case_id).filter(
                    CustomFieldValue.field_definition_id == field_id
                ).all()
                test_case_ids_with_values = set([tc_id[0] for tc_id in test_case_ids_with_values])
                
                # Find test cases without values
                test_cases_without_values = [tc for tc in test_cases if tc.id not in test_case_ids_with_values]
                
                if test_cases_without_values:
                    raise ValueError(
                        f"Cannot make field required. {len(test_cases_without_values)} test case(s) lack values for this field. "
                        f"Please provide values for all test cases before making the field required."
                    )
        
        # If name is being updated but slug is not provided, regenerate slug
        if 'name' in update_data and 'slug' not in update_data:
            import re
            slug = update_data['name'].lower()
            slug = re.sub(r'[^a-z0-9]+', '_', slug)
            slug = slug.strip('_')
            update_data['slug'] = slug
        
        for key, value in update_data.items():
            setattr(db_field, key, value)
        safe_commit(db)
        db.refresh(db_field)
        
        # Create audit trail
        try:
            from .services.audit_service import get_audit_service
            from .schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            changes = ', '.join([f"{k}={v}" for k, v in update_data.items()])
            audit_data = AuditTrailCreate(
                user_id=user_id,
                action="update",
                entity_type="custom_field_definition",
                entity_id=db_field.id,
                description=f"Updated custom field definition '{db_field.name}' in project {db_field.project_id}. Changes: {changes}",
                ip_address=None,
                user_agent=None
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for custom field definition update: {e}")
        
        return db_field


def delete_custom_field_definition(db: Session, field_id: int, user_id: Optional[int] = None):
    db_field = db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()
    if db_field:
        field_name = db_field.name
        project_id = db_field.project_id
        db.delete(db_field)
        safe_commit(db)
        
        # Create audit trail
        try:
            from .services.audit_service import get_audit_service
            from .schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=user_id,
                action="delete",
                entity_type="custom_field_definition",
                entity_id=field_id,
                description=f"Deleted custom field definition '{field_name}' from project {project_id}",
                ip_address=None,
                user_agent=None
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for custom field definition delete: {e}")
    
    return db_field


# Custom Field Value CRUD
def get_custom_field_value(db: Session, value_id: int):
    return db.query(CustomFieldValue).filter(CustomFieldValue.id == value_id).first()


def get_custom_field_values(db: Session, test_case_id: Optional[int] = None, field_definition_id: Optional[int] = None):
    query = db.query(CustomFieldValue)
    if test_case_id:
        query = query.filter(CustomFieldValue.test_case_id == test_case_id)
    if field_definition_id:
        query = query.filter(CustomFieldValue.field_definition_id == field_definition_id)
    return query.all()


def validate_custom_field_value(value: Optional[str], field_definition: CustomFieldDefinition) -> Optional[str]:
    """
    Validate a custom field value against its definition's validation rules.
    Returns error message if validation fails, None if valid.
    """
    value_str = "" if value is None else str(value)
    normalized_value = value_str.strip()

    # For boolean fields, "true"/"false" are both valid explicit values.
    if field_definition.field_type == CustomFieldType.BOOLEAN:
        if normalized_value == "":
            return None if not field_definition.is_required else f"Field '{field_definition.name}' is required"
        if normalized_value.lower() not in {"true", "false"}:
            return f"Field '{field_definition.name}' must be either true or false"
        return None

    if normalized_value == "":
        return None if not field_definition.is_required else f"Field '{field_definition.name}' is required"
    
    # Apply validation rules
    if field_definition.validation_rules:
        rules = field_definition.validation_rules
        field_type = field_definition.field_type
        
        if field_type == CustomFieldType.TEXT:
            min_length = rules.get('min_length')
            max_length = rules.get('max_length')
            regex_pattern = rules.get('regex_pattern')
            
            if min_length and len(value_str) < min_length:
                return f"Field '{field_definition.name}' too short. Minimum length: {min_length}"
            
            if max_length and len(value_str) > max_length:
                return f"Field '{field_definition.name}' too long. Maximum length: {max_length}"
            
            if regex_pattern:
                try:
                    if not re.match(regex_pattern, value_str):
                        return f"Field '{field_definition.name}' does not match required pattern"
                except re.error:
                    pass  # Pattern validation already done at definition level
        
        elif field_type == CustomFieldType.NUMBER:
            try:
                num_value = float(value_str)
                min_value = rules.get('min_value')
                max_value = rules.get('max_value')
                integer_only = rules.get('integer_only', False)
                
                if integer_only and not value_str.isdigit() and not (value_str.startswith('-') and value_str[1:].isdigit()):
                    return f"Field '{field_definition.name}' must be an integer"
                
                if min_value is not None and num_value < min_value:
                    return f"Field '{field_definition.name}' too small. Minimum value: {min_value}"
                
                if max_value is not None and num_value > max_value:
                    return f"Field '{field_definition.name}' too large. Maximum value: {max_value}"
            except ValueError:
                return f"Field '{field_definition.name}' must be a valid number"
        
        elif field_type == CustomFieldType.DATE:
            try:
                from datetime import datetime
                date_value = datetime.fromisoformat(value_str)
                min_date = rules.get('min_date')
                max_date = rules.get('max_date')
                future_only = rules.get('future_only', False)
                past_only = rules.get('past_only', False)
                
                if min_date:
                    min_dt = datetime.fromisoformat(min_date)
                    if date_value < min_dt:
                        return f"Field '{field_definition.name}' must be after {min_date}"
                
                if max_date:
                    max_dt = datetime.fromisoformat(max_date)
                    if date_value > max_dt:
                        return f"Field '{field_definition.name}' must be before {max_date}"
                
                if future_only and date_value <= datetime.now():
                    return f"Field '{field_definition.name}' must be a future date"
                
                if past_only and date_value >= datetime.now():
                    return f"Field '{field_definition.name}' must be a past date"
            except ValueError:
                return f"Field '{field_definition.name}' must be a valid date in ISO format (YYYY-MM-DD)"
        
        elif field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            min_length = rules.get('min_length')
            max_length = rules.get('max_length')
            
            if min_length and len(value_str) < min_length:
                return f"Field '{field_definition.name}' too short. Minimum length: {min_length}"
            
            if max_length and len(value_str) > max_length:
                return f"Field '{field_definition.name}' too long. Maximum length: {max_length}"
            
            # Validate against field options
            if field_definition.options:
                if field_type == CustomFieldType.SELECT:
                    if value_str not in field_definition.options:
                        return f"Invalid option for field '{field_definition.name}': {value_str}. Valid options: {field_definition.options}"
                elif field_type == CustomFieldType.MULTISELECT:
                    # Parse comma-separated values
                    selected_values = [v.strip() for v in value_str.split(',') if v.strip()]
                    invalid_values = [v for v in selected_values if v not in field_definition.options]
                    if invalid_values:
                        return f"Invalid options for field '{field_definition.name}': {invalid_values}. Valid options: {field_definition.options}"
    
    return None


def create_custom_field_value(db: Session, value: CustomFieldValueCreate, user_id: Optional[int] = None):
    # Get field definition to validate against
    field_definition = db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.id == value.field_definition_id
    ).first()
    
    if not field_definition:
        raise ValueError(f"Custom field definition with id {value.field_definition_id} does not exist")
    
    # Get test case to verify project match
    from .models import TestCase
    test_case = db.query(TestCase).filter(TestCase.id == value.test_case_id).first()
    
    if not test_case:
        raise ValueError(f"Test case with id {value.test_case_id} does not exist")
    
    # Verify field definition belongs to the same project as the test case
    if field_definition.project_id != test_case.project_id:
        raise ValueError(
            f"Field definition belongs to project {field_definition.project_id} but test case belongs to project {test_case.project_id}. "
            "Cross-project field assignment is not allowed."
        )
    
    # Validate value against field definition rules
    validation_error = validate_custom_field_value(value.value, field_definition)
    if validation_error:
        raise ValueError(validation_error)
    
    db_value = CustomFieldValue(**value.model_dump())
    db.add(db_value)
    safe_commit(db)
    db.refresh(db_value)
    
    # Create audit trail
    try:
        from .services.audit_service import get_audit_service
        from .schemas_audit import AuditTrailCreate
        audit_service = get_audit_service(db)
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action="create",
            entity_type="custom_field_value",
            entity_id=db_value.id,
            description=f"Created custom field value for field '{field_definition.name}' on test case {test_case.id} in project {field_definition.project_id}",
            ip_address=None,
            user_agent=None
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        print(f"Failed to create audit trail for custom field value: {e}")
    
    return db_value


def update_custom_field_value(db: Session, value_id: int, value: CustomFieldValueUpdate, user_id: Optional[int] = None):
    db_value = db.query(CustomFieldValue).filter(CustomFieldValue.id == value_id).first()
    if not db_value:
        raise ValueError(f"Custom field value with id {value_id} does not exist")
    
    # Get field definition to validate against
    field_definition = db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.id == db_value.field_definition_id
    ).first()
    
    if not field_definition:
        raise ValueError(f"Custom field definition with id {db_value.field_definition_id} does not exist")
    
    value_data = value.model_dump(exclude_unset=True)
    new_test_case_id = value_data.get("test_case_id")

    # If updating test_case_id, verify project match
    if new_test_case_id is not None and new_test_case_id != db_value.test_case_id:
        from .models import TestCase
        test_case = db.query(TestCase).filter(TestCase.id == new_test_case_id).first()
        
        if not test_case:
            raise ValueError(f"Test case with id {new_test_case_id} does not exist")
        
        # Verify field definition belongs to the same project as the new test case
        if field_definition.project_id != test_case.project_id:
            raise ValueError(
                f"Field definition belongs to project {field_definition.project_id} but test case belongs to project {test_case.project_id}. "
                "Cross-project field assignment is not allowed."
            )
    
    # Validate new value against field definition rules
    if "value" in value_data:
        validation_error = validate_custom_field_value(value_data.get("value"), field_definition)
        if validation_error:
            raise ValueError(validation_error)
    
    for key, val in value_data.items():
        setattr(db_value, key, val)
    safe_commit(db)
    db.refresh(db_value)
    
    # Create audit trail
    try:
        from .services.audit_service import get_audit_service
        from .schemas_audit import AuditTrailCreate
        audit_service = get_audit_service(db)
        changes = ', '.join([f"{k}={v}" for k, v in value_data.items()])
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action="update",
            entity_type="custom_field_value",
            entity_id=value_id,
            description=f"Updated custom field value for field '{field_definition.name}' on test case {db_value.test_case_id}. Changes: {changes}",
            ip_address=None,
            user_agent=None
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        print(f"Failed to create audit trail for custom field value update: {e}")
    
    return db_value


def delete_custom_field_value(db: Session, value_id: int, user_id: Optional[int] = None):
    db_value = db.query(CustomFieldValue).filter(CustomFieldValue.id == value_id).first()
    if db_value:
        # Get field definition for audit trail
        field_definition = db.query(CustomFieldDefinition).filter(
            CustomFieldDefinition.id == db_value.field_definition_id
        ).first()
        
        field_name = field_definition.name if field_definition else "unknown"
        test_case_id = db_value.test_case_id
        
        db.delete(db_value)
        safe_commit(db)
        
        # Create audit trail
        try:
            from .services.audit_service import get_audit_service
            from .schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=user_id,
                action="delete",
                entity_type="custom_field_value",
                entity_id=value_id,
                description=f"Deleted custom field value for field '{field_name}' on test case {test_case_id}",
                ip_address=None,
                user_agent=None
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for custom field value delete: {e}")
    
    return db_value


def get_test_case_with_custom_fields(db: Session, test_case_id: int):
    test_case = db.query(TestCase).options(
        selectinload(TestCase.custom_field_values).joinedload(CustomFieldValue.field_definition)
    ).filter(TestCase.id == test_case_id).first()
    return test_case


# Jira Integration CRUD
def get_jira_integration(db: Session, integration_id: int):
    return db.query(JiraIntegration).filter(JiraIntegration.id == integration_id).first()


def get_jira_integrations(db: Session, project_id: int, skip: int = 0, limit: int = 100):
    return db.query(JiraIntegration).filter(JiraIntegration.project_id == project_id).offset(skip).limit(limit).all()


def create_jira_integration(db: Session, integration: JiraIntegrationCreate):
    db_integration = JiraIntegration(**integration.model_dump())
    db.add(db_integration)
    safe_commit(db)
    db.refresh(db_integration)
    return db_integration


def update_jira_integration(db: Session, integration_id: int, integration: JiraIntegrationUpdate):
    db_integration = db.query(JiraIntegration).filter(JiraIntegration.id == integration_id).first()
    if db_integration:
        for key, value in integration.model_dump(exclude_unset=True).items():
            setattr(db_integration, key, value)
        safe_commit(db)
        db.refresh(db_integration)
    return db_integration


def delete_jira_integration(db: Session, integration_id: int):
    db_integration = db.query(JiraIntegration).filter(JiraIntegration.id == integration_id).first()
    if db_integration:
        db.delete(db_integration)
        safe_commit(db)
    return db_integration


# Jira Issue CRUD
def get_jira_issue(db: Session, issue_id: int):
    return db.query(JiraIssue).filter(JiraIssue.id == issue_id).first()


def get_jira_issues(db: Session, integration_id: Optional[int] = None, test_case_id: Optional[int] = None, test_result_id: Optional[int] = None):
    query = db.query(JiraIssue)
    if integration_id:
        query = query.filter(JiraIssue.integration_id == integration_id)
    if test_case_id:
        query = query.filter(JiraIssue.test_case_id == test_case_id)
    if test_result_id:
        query = query.filter(JiraIssue.test_result_id == test_result_id)
    return query.all()


def create_jira_issue(db: Session, issue: JiraIssueCreate):
    db_issue = JiraIssue(**issue.model_dump())
    db.add(db_issue)
    safe_commit(db)
    db.refresh(db_issue)
    return db_issue


def update_jira_issue(db: Session, issue_id: int, issue: JiraIssueUpdate):
    db_issue = db.query(JiraIssue).filter(JiraIssue.id == issue_id).first()
    if db_issue:
        for key, value in issue.model_dump(exclude_unset=True).items():
            setattr(db_issue, key, value)
        safe_commit(db)
        db.refresh(db_issue)
    return db_issue


def delete_jira_issue(db: Session, issue_id: int):
    db_issue = db.query(JiraIssue).filter(JiraIssue.id == issue_id).first()
    if db_issue:
        db.delete(db_issue)
        safe_commit(db)
    return db_issue


# Requirement CRUD
def get_requirement(db: Session, requirement_id: int):
    return db.query(Requirement).filter(Requirement.id == requirement_id).first()


def get_requirements(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(Requirement)
    if project_id:
        query = query.filter(Requirement.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def create_requirement(db: Session, requirement: RequirementCreate):
    # Validate estimated_effort
    if requirement.estimated_effort is not None and requirement.estimated_effort < 0:
        raise ValueError("Estimated effort must be a positive number")
    
    # Create the requirement object
    db_requirement = Requirement()
    db_requirement.title = requirement.title
    db_requirement.description = requirement.description
    db_requirement.requirement_id = requirement.requirement_id
    db_requirement.project_id = requirement.project_id
    db_requirement.created_by = requirement.created_by
    
    # Handle optional fields
    if requirement.parent_requirement_id:
        db_requirement.parent_requirement_id = requirement.parent_requirement_id
    if requirement.assigned_to:
        db_requirement.assigned_to = requirement.assigned_to
    if requirement.tags:
        db_requirement.tags = requirement.tags
    if requirement.acceptance_criteria:
        db_requirement.acceptance_criteria = requirement.acceptance_criteria
    if requirement.estimated_effort:
        db_requirement.estimated_effort = requirement.estimated_effort
    
    # Handle enums - convert to proper enum objects
    if requirement.status:
        db_requirement.status = RequirementStatus(requirement.status)
    if requirement.priority:
        db_requirement.priority = Priority(requirement.priority)
    
    db.add(db_requirement)
    safe_commit(db)
    db.refresh(db_requirement)
    return db_requirement


def update_requirement(db: Session, requirement_id: int, requirement: RequirementUpdate):
    db_requirement = db.query(Requirement).filter(Requirement.id == requirement_id).first()
    if db_requirement:
        update_data = requirement.model_dump(exclude_unset=True)
        
        # Handle enum conversions
        if 'status' in update_data and update_data['status'] is not None:
            update_data['status'] = RequirementStatus(update_data['status'])
        if 'priority' in update_data and update_data['priority'] is not None:
            update_data['priority'] = Priority(update_data['priority'])
        
        # Validate estimated_effort
        if 'estimated_effort' in update_data and update_data['estimated_effort'] is not None:
            if update_data['estimated_effort'] < 0:
                raise ValueError("Estimated effort must be a positive number")
        
        for key, value in update_data.items():
            setattr(db_requirement, key, value)
        safe_commit(db)
        db.refresh(db_requirement)
    return db_requirement


def delete_requirement(db: Session, requirement_id: int):
    db_requirement = db.query(Requirement).filter(Requirement.id == requirement_id).first()
    if db_requirement:
        db.delete(db_requirement)
        safe_commit(db)
    return db_requirement


# Defect CRUD
def get_defect(db: Session, defect_id: int):
    return db.query(Defect).filter(Defect.id == defect_id).first()


def get_defects(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(Defect)
    if project_id:
        query = query.filter(Defect.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def create_defect(db: Session, defect: DefectCreate):
    db_defect = Defect(**defect.model_dump())
    db.add(db_defect)
    safe_commit(db)
    db.refresh(db_defect)
    return db_defect


def update_defect(db: Session, defect_id: int, defect: DefectUpdate):
    db_defect = db.query(Defect).filter(Defect.id == defect_id).first()
    if db_defect:
        for key, value in defect.model_dump(exclude_unset=True).items():
            setattr(db_defect, key, value)
        safe_commit(db)
        db.refresh(db_defect)
    return db_defect


def delete_defect(db: Session, defect_id: int):
    db_defect = db.query(Defect).filter(Defect.id == defect_id).first()
    if db_defect:
        db.delete(db_defect)
        safe_commit(db)
    return db_defect


# Test Plan CRUD
def get_test_plan(db: Session, test_plan_id: int):
    return db.query(TestPlan).filter(TestPlan.id == test_plan_id).first()


def get_test_plans(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(TestPlan)
    if project_id:
        query = query.filter(TestPlan.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def create_test_plan(db: Session, test_plan: TestPlanCreate):
    db_test_plan = TestPlan(**test_plan.model_dump())
    db.add(db_test_plan)
    safe_commit(db)
    db.refresh(db_test_plan)
    return db_test_plan


def update_test_plan(db: Session, test_plan_id: int, test_plan: TestPlanUpdate):
    db_test_plan = db.query(TestPlan).filter(TestPlan.id == test_plan_id).first()
    if db_test_plan:
        for key, value in test_plan.model_dump(exclude_unset=True).items():
            setattr(db_test_plan, key, value)
        safe_commit(db)
        db.refresh(db_test_plan)
    return db_test_plan


def delete_test_plan(db: Session, test_plan_id: int):
    db_test_plan = db.query(TestPlan).filter(TestPlan.id == test_plan_id).first()
    if db_test_plan:
        db.delete(db_test_plan)
        safe_commit(db)
    return db_test_plan


# Milestone CRUD
def get_milestone(db: Session, milestone_id: int):
    return db.query(Milestone).filter(Milestone.id == milestone_id).first()


def get_milestones(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(Milestone)
    if project_id:
        query = query.filter(Milestone.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def create_milestone(db: Session, milestone: MilestoneCreate):
    db_milestone = Milestone(**milestone.model_dump())
    db.add(db_milestone)
    safe_commit(db)
    db.refresh(db_milestone)
    return db_milestone


def update_milestone(db: Session, milestone_id: int, milestone: MilestoneUpdate):
    db_milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
    if db_milestone:
        for key, value in milestone.model_dump(exclude_unset=True).items():
            setattr(db_milestone, key, value)
        safe_commit(db)
        db.refresh(db_milestone)
    return db_milestone


def delete_milestone(db: Session, milestone_id: int):
    db_milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
    if db_milestone:
        db.delete(db_milestone)
        safe_commit(db)
    return db_milestone


# Traceability Matrix CRUD
def get_traceability_matrix(db: Session, matrix_id: int):
    return db.query(TraceabilityMatrix).filter(TraceabilityMatrix.id == matrix_id).first()


def get_traceability_matrix_entries(db: Session, requirement_id: int = None, test_case_id: int = None):
    query = db.query(TraceabilityMatrix)
    if requirement_id:
        query = query.filter(TraceabilityMatrix.requirement_id == requirement_id)
    if test_case_id:
        query = query.filter(TraceabilityMatrix.test_case_id == test_case_id)
    return query.all()


def create_traceability_matrix_entry(db: Session, entry: TraceabilityMatrixCreate):
    db_entry = TraceabilityMatrix(**entry.model_dump())
    db.add(db_entry)
    safe_commit(db)
    db.refresh(db_entry)
    return db_entry


def update_traceability_matrix_entry(db: Session, entry_id: int, entry: dict):
    db_entry = db.query(TraceabilityMatrix).filter(TraceabilityMatrix.id == entry_id).first()
    if db_entry:
        for key, value in entry.items():
            setattr(db_entry, key, value)
        safe_commit(db)
        db.refresh(db_entry)
    return db_entry


def delete_traceability_matrix_entry(db: Session, entry_id: int):
    db_entry = db.query(TraceabilityMatrix).filter(TraceabilityMatrix.id == entry_id).first()
    if db_entry:
        db.delete(db_entry)
        safe_commit(db)
    return db_entry


# Coverage Report CRUD
def get_coverage_report(db: Session, report_id: int):
    return db.query(CoverageReport).filter(CoverageReport.id == report_id).first()


def get_coverage_reports(db: Session, project_id: int = None, test_run_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(CoverageReport)
    if project_id:
        query = query.filter(CoverageReport.project_id == project_id)
    if test_run_id:
        query = query.filter(CoverageReport.test_run_id == test_run_id)
    return query.offset(skip).limit(limit).all()


def create_coverage_report(db: Session, report: CoverageReportCreate):
    db_report = CoverageReport(**report.model_dump())
    db.add(db_report)
    safe_commit(db)
    db.refresh(db_report)
    return db_report


def update_coverage_report(db: Session, report_id: int, report: dict):
    db_report = db.query(CoverageReport).filter(CoverageReport.id == report_id).first()
    if db_report:
        for key, value in report.items():
            setattr(db_report, key, value)
        safe_commit(db)
        db.refresh(db_report)
    return db_report


def delete_coverage_report(db: Session, report_id: int):
    db_report = db.query(CoverageReport).filter(CoverageReport.id == report_id).first()
    if db_report:
        db.delete(db_report)
        safe_commit(db)
    return db_report


# Notification CRUD functions
def create_notification(db: Session, notification: NotificationCreate):
    db_notification = Notification(**notification.model_dump())
    db.add(db_notification)
    safe_commit(db)
    db.refresh(db_notification)
    return db_notification


def get_notifications(db: Session, user_id: int, skip: int = 0, limit: int = 100):
    return db.query(Notification).filter(Notification.user_id == user_id).order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def get_notification(db: Session, notification_id: int):
    return db.query(Notification).filter(Notification.id == notification_id).first()


def update_notification(db: Session, notification_id: int, notification: NotificationUpdate):
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        update_data = notification.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_notification, field, value)
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def delete_notification(db: Session, notification_id: int):
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db.delete(db_notification)
        safe_commit(db)
    return db_notification


def get_unread_notification_count(db: Session, user_id: int):
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).count()


def mark_all_notifications_as_read(db: Session, user_id: int):
    result = db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).update({"is_read": True})
    safe_commit(db)
    return result


def delete_old_notifications(db: Session, user_id: int, days_old: int = 30):
    """Delete notifications older than specified days for a user"""
    from datetime import datetime, timedelta
    cutoff_date = datetime.now() - timedelta(days=days_old)
    result = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.created_at < cutoff_date,
        Notification.is_read == True  # Only delete read notifications
    ).delete()
    safe_commit(db)
    return result


def mark_notification_as_unread(db: Session, notification_id: int):
    """Mark a specific notification as unread"""
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db_notification.is_read = False
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def delete_all_notifications(db: Session, user_id: int):
    """Delete all notifications for a user"""
    result = db.query(Notification).filter(Notification.user_id == user_id).delete()
    safe_commit(db)
    return result


def get_notifications_filtered(db: Session, user_id: int, notification_type: str = None, skip: int = 0, limit: int = 100):
    """Get notifications filtered by type"""
    from .models import NotificationType
    query = db.query(Notification).filter(Notification.user_id == user_id)
    if notification_type:
        # Validate the type against allowed values
        allowed_types = ['info', 'success', 'warning', 'error']
        if notification_type.lower() not in allowed_types:
            return []
        # Compare against uppercase since SQLite stores enums as uppercase strings
        query = query.filter(Notification.type == notification_type.upper())
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def search_notifications(db: Session, user_id: int, search_query: str, skip: int = 0, limit: int = 100):
    """Search notifications by title or message"""
    if not search_query or not search_query.strip():
        return []
    # Escape SQL wildcard characters to prevent SQL injection
    escaped_query = search_query.replace('%', '\\%').replace('_', '\\_')
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        (Notification.title.ilike(f'%{escaped_query}%')) | (Notification.message.ilike(f'%{escaped_query}%'))
    )
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def get_notifications_filtered_and_searched(db: Session, user_id: int, notification_type: str = None, search_query: str = None, skip: int = 0, limit: int = 100):
    """Get notifications filtered by type and search query"""
    from .models import NotificationType
    query = db.query(Notification).filter(Notification.user_id == user_id)
    
    if notification_type:
        # Validate the type against allowed values
        allowed_types = ['info', 'success', 'warning', 'error']
        if notification_type.lower() not in allowed_types:
            return []
        # Compare against uppercase since SQLite stores enums as uppercase strings
        query = query.filter(Notification.type == notification_type.upper())
    
    if search_query and search_query.strip():
        # Escape SQL wildcard characters to prevent SQL injection
        escaped_query = search_query.replace('%', '\\%').replace('_', '\\_')
        query = query.filter(
            (Notification.title.ilike(f'%{escaped_query}%')) | (Notification.message.ilike(f'%{escaped_query}%'))
        )
    
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def bulk_update_notifications(db: Session, user_id: int, notification_ids: List[int], is_read: bool = None):
    """Bulk update notifications (mark as read/unread)"""
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.id.in_(notification_ids)
    )
    if is_read is not None:
        result = query.update({"is_read": is_read})
    safe_commit(db)
    return result


def bulk_delete_notifications(db: Session, user_id: int, notification_ids: List[int]):
    """Bulk delete notifications"""
    result = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.id.in_(notification_ids)
    ).delete()
    safe_commit(db)
    return result


# Analytics and Reporting CRUD functions

# KPI Data CRUD
def create_kpi_data(db: Session, kpi_data: KPIDataCreate):
    db_kpi = KPIData(**kpi_data.model_dump())
    db.add(db_kpi)
    safe_commit(db)
    db.refresh(db_kpi)
    return db_kpi


def get_kpi_data(db: Session, project_id: int, metric_type: str = None, time_period: str = None, skip: int = 0, limit: int = 100):
    query = db.query(KPIData).filter(KPIData.project_id == project_id)
    if metric_type:
        query = query.filter(KPIData.metric_type == metric_type)
    if time_period:
        query = query.filter(KPIData.time_period == time_period)
    return query.order_by(KPIData.recorded_at.desc()).offset(skip).limit(limit).all()


def get_latest_kpi_data(db: Session, project_id: int, metric_types: List[str] = None):
    query = db.query(KPIData).filter(KPIData.project_id == project_id)
    if metric_types:
        query = query.filter(KPIData.metric_type.in_(metric_types))
    
    # Get latest record for each metric type
    latest_records = []
    for metric_type in metric_types or ["coverage", "pass_rate", "failure_trends", "flakiness", "cycle_time"]:
        latest = query.filter(KPIData.metric_type == metric_type).order_by(KPIData.recorded_at.desc()).first()
        if latest:
            latest_records.append(latest)
    
    return latest_records


# Test Step Results CRUD
def create_test_step_result(db: Session, step_result: TestStepResultCreate):
    db_step = TestStepResult(**step_result.model_dump())
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def get_test_step_results(db: Session, project_id: int = None, test_run_id: int = None, test_case_id: int = None, 
                         filter_type: str = "all", skip: int = 0, limit: int = 100):
    query = db.query(TestStepResult).join(TestResult).join(TestCase)
    
    if project_id:
        query = query.join(TestSuite).filter(TestSuite.project_id == project_id)
    if test_run_id:
        query = query.filter(TestResult.test_run_id == test_run_id)
    if test_case_id:
        query = query.filter(TestResult.test_case_id == test_case_id)
    
    if filter_type == "failed":
        query = query.filter(TestStepResult.step_status == "failed")
    elif filter_type == "slow":
        query = query.filter(TestStepResult.step_duration > 5.0)  # Steps taking more than 5 seconds
    
    return query.order_by(TestStepResult.created_at.desc()).offset(skip).limit(limit).all()


def get_test_step_results_by_test_result(db: Session, test_result_id: int):
    return db.query(TestStepResult).filter(TestStepResult.test_result_id == test_result_id).order_by(TestStepResult.step_number).all()


# Shareable Reports CRUD
def create_shareable_report(db: Session, report: ShareableReportCreate, created_by: int):
    import secrets
    share_token = secrets.token_urlsafe(32)
    
    db_report = ShareableReport(**report.model_dump(), share_token=share_token, created_by=created_by)
    db.add(db_report)
    safe_commit(db)
    db.refresh(db_report)
    return db_report


def get_shareable_reports(db: Session, project_id: int, created_by: int = None, skip: int = 0, limit: int = 100):
    query = db.query(ShareableReport).filter(ShareableReport.project_id == project_id, ShareableReport.is_active == True)
    if created_by:
        query = query.filter(ShareableReport.created_by == created_by)
    return query.order_by(ShareableReport.created_at.desc()).offset(skip).limit(limit).all()


def get_shareable_report_by_token(db: Session, share_token: str):
    report = db.query(ShareableReport).filter(ShareableReport.share_token == share_token, ShareableReport.is_active == True).first()
    if report:
        # Increment view count and update last viewed
        report.view_count += 1
        report.last_viewed = func.now()
        safe_commit(db)
    return report


def update_shareable_report(db: Session, report_id: int, report_data: dict):
    db_report = db.query(ShareableReport).filter(ShareableReport.id == report_id).first()
    if db_report:
        for key, value in report_data.items():
            setattr(db_report, key, value)
        safe_commit(db)
        db.refresh(db_report)
    return db_report


# Root Cause Analysis CRUD
def create_root_cause_analysis(db: Session, analysis: RootCauseAnalysisCreate):
    db_analysis = RootCauseAnalysis(**analysis.model_dump())
    db.add(db_analysis)
    safe_commit(db)
    db.refresh(db_analysis)
    return db_analysis


def get_root_cause_analyses(db: Session, project_id: int, requirement_id: int = None, test_case_id: int = None, 
                           defect_id: int = None, status: str = None, skip: int = 0, limit: int = 100):
    query = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.project_id == project_id)
    if requirement_id:
        query = query.filter(RootCauseAnalysis.requirement_id == requirement_id)
    if test_case_id:
        query = query.filter(RootCauseAnalysis.test_case_id == test_case_id)
    if defect_id:
        query = query.filter(RootCauseAnalysis.defect_id == defect_id)
    if status:
        query = query.filter(RootCauseAnalysis.status == status)
    return query.order_by(RootCauseAnalysis.created_at.desc()).offset(skip).limit(limit).all()


def update_root_cause_analysis(db: Session, analysis_id: int, analysis_data: dict):
    db_analysis = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()
    if db_analysis:
        for key, value in analysis_data.items():
            setattr(db_analysis, key, value)
        db_analysis.updated_at = func.now()
        safe_commit(db)
        db.refresh(db_analysis)
    return db_analysis


# Dashboard Widgets CRUD
def create_dashboard_widget(db: Session, widget: DashboardWidgetCreate):
    db_widget = DashboardWidget(**widget.model_dump())
    db.add(db_widget)
    safe_commit(db)
    db.refresh(db_widget)
    return db_widget


def get_dashboard_widgets(db: Session, user_id: int, project_id: int = None):
    query = db.query(DashboardWidget).filter(DashboardWidget.user_id == user_id, DashboardWidget.is_visible == True)
    if project_id:
        query = query.filter(DashboardWidget.project_id == project_id)
    return query.order_by(DashboardWidget.position_y, DashboardWidget.position_x).all()


def update_dashboard_widget(db: Session, widget_id: int, widget_data: dict):
    db_widget = db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()
    if db_widget:
        for key, value in widget_data.items():
            setattr(db_widget, key, value)
        db_widget.updated_at = func.now()
        safe_commit(db)
        db.refresh(db_widget)
    return db_widget


def delete_dashboard_widget(db: Session, widget_id: int):
    db_widget = db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()
    if db_widget:
        db.delete(db_widget)
        safe_commit(db)
    return db_widget


# Analytics aggregation functions
def _normalized_result_status(status: str) -> str:
    status_map = {
        "pass": "passed",
        "passed": "passed",
        "fail": "failed",
        "failed": "failed",
        "block": "blocked",
        "blocked": "blocked",
        "skip": "skipped",
        "skipped": "skipped",
        "not_tested": "not_tested",
    }
    return status_map.get((status or "").lower(), (status or "").lower())


def calculate_project_kpis(db: Session, project_id: int, time_period: str = "7d"):
    from datetime import datetime, timedelta
    from .models import Defect, TestRun, TestResult, TestCase, TestSuite
    from sqlalchemy import func
    
    time_mapping = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}
    days = time_mapping.get(time_period, 7)
    current_start_date = datetime.now() - timedelta(days=days)
    previous_start_date = current_start_date - timedelta(days=days)
    
    total_test_cases = db.query(TestCase).join(TestSuite).filter(
        TestSuite.project_id == project_id,
        TestCase.is_deleted == False,
    ).count()
    
    current_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= current_start_date,
    ).all()
    previous_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= previous_start_date,
        TestResult.executed_at < current_start_date,
    ).all()
    
    current_statuses = [_normalized_result_status(result.status) for result in current_results]
    previous_statuses = [_normalized_result_status(result.status) for result in previous_results]
    executed_statuses = {"passed", "failed", "blocked", "skipped"}
    executed_results = [result for result in current_results if _normalized_result_status(result.status) in executed_statuses]
    
    total_tests = len(executed_results)
    passed_tests = current_statuses.count("passed")
    failed_tests = current_statuses.count("failed")
    blocked_tests = current_statuses.count("blocked")
    skipped_tests = current_statuses.count("skipped")
    pass_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    executed_test_cases = len({result.test_case_id for result in executed_results})
    coverage = (executed_test_cases / total_test_cases * 100) if total_test_cases > 0 else 0
    
    execution_times = [result.execution_time for result in executed_results if result.execution_time is not None]
    avg_execution_time = (sum(execution_times) / len(execution_times) / 3600) if execution_times else 0
    
    completed_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.status.in_(["completed", "passed", "failed"]),
        TestRun.created_at >= current_start_date,
        TestRun.completed_at.isnot(None),
    ).all()
    cycle_times = [
        (run.completed_at - run.created_at).total_seconds() / 3600
        for run in completed_runs
        if run.created_at and run.completed_at
    ]
    cycle_time = sum(cycle_times) / len(cycle_times) if cycle_times else 0
    
    test_case_results = {}
    for result in current_results:
        normalized_status = _normalized_result_status(result.status)
        if normalized_status in {"passed", "failed"}:
            test_case_results.setdefault(result.test_case_id, set()).add(normalized_status)
    flaky_tests = len([
        test_case_id for test_case_id, statuses in test_case_results.items()
        if {"passed", "failed"}.issubset(statuses)
    ])
    flakiness = (flaky_tests / len(test_case_results) * 100) if test_case_results else 0
    
    current_failure_rate = (failed_tests / total_tests * 100) if total_tests else 0
    
    total_defects = db.query(Defect).filter(Defect.project_id == project_id).count()
    defect_density = (total_defects / total_test_cases) if total_test_cases > 0 else 0
    productivity_score = min(100, (total_tests / days) * 10) if days > 0 else 0
    
    return {
        "coverage": round(coverage, 1),
        "pass_rate": round(pass_rate, 1),
        "failure_trends": round(current_failure_rate, 1),
        "flakiness": round(flakiness, 1),
        "cycle_time": round(cycle_time, 2),
        "defect_density": round(defect_density, 2),
        "total_tests": total_tests,
        "passed_tests": passed_tests,
        "failed_tests": failed_tests,
        "blocked_tests": blocked_tests,
        "skipped_tests": skipped_tests,
        "avg_execution_time": round(avg_execution_time, 2),
        "productivity_score": round(productivity_score, 1)
    }


def generate_dashboard_analytics(db: Session, project_id: int, time_period: str = "7d"):
    from datetime import datetime, timedelta
    import sqlalchemy as sa
    from .models import TestRun, TestResult, TestCase, TestSuite
    
    # Get current KPI data
    kpis = calculate_project_kpis(db, project_id, time_period)
    
    # Calculate previous period data for trends
    time_mapping = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}
    days = time_mapping.get(time_period, 7)
    
    # Get previous period data by doubling the days lookback
    start_date = datetime.now() - timedelta(days=days * 2)
    end_date = datetime.now() - timedelta(days=days)
    
    # Get test results from previous period
    previous_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= start_date,
        TestResult.executed_at < end_date
    ).all()
    
    # Calculate previous period metrics
    prev_total_tests = len(previous_results)
    prev_statuses = [_normalized_result_status(r.status) for r in previous_results]
    prev_passed_tests = prev_statuses.count('passed')
    prev_failed_tests = prev_statuses.count('failed')
    
    prev_pass_rate = (prev_passed_tests / prev_total_tests * 100) if prev_total_tests > 0 else 0
    
    # Calculate previous coverage
    total_test_cases = db.query(TestCase).join(TestSuite).filter(TestSuite.project_id == project_id, TestCase.is_deleted == False).count()
    prev_executed_test_cases = len(set([r.test_case_id for r in previous_results]))
    prev_coverage = (prev_executed_test_cases / total_test_cases * 100) if total_test_cases > 0 else 0
    
    # Calculate previous flakiness
    prev_test_case_results = {}
    for result in previous_results:
        if result.test_case_id not in prev_test_case_results:
            prev_test_case_results[result.test_case_id] = set()
        prev_test_case_results[result.test_case_id].add(_normalized_result_status(result.status))
    
    prev_flaky_tests = len([tc_id for tc_id, statuses in prev_test_case_results.items() 
                           if len(statuses) > 1 and ('passed' in statuses and 'failed' in statuses)])
    prev_flakiness = (prev_flaky_tests / len(prev_test_case_results) * 100) if prev_test_case_results else 0
    
    prev_failure_trends = (prev_failed_tests / prev_total_tests * 100) if prev_total_tests > 0 else 0
    
    # Previous cycle time
    prev_test_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.created_at >= start_date,
        TestRun.created_at < end_date
    ).all()
    
    prev_completed_runs = [run for run in prev_test_runs if run.status == 'completed']
    prev_cycle_times = []
    for run in prev_completed_runs:
        if hasattr(run, 'completed_at') and run.completed_at:
            duration = (run.completed_at - run.created_at).total_seconds() / 3600
            prev_cycle_times.append(duration)
    
    prev_cycle_time = sum(prev_cycle_times) / len(prev_cycle_times) if prev_cycle_times else 0
    
    # Calculate previous defect density
    from .models import Defect
    prev_defects = db.query(Defect).filter(
        Defect.project_id == project_id,
        Defect.created_at >= start_date,
        Defect.created_at < end_date
    ).count()
    prev_defect_density = (prev_defects / total_test_cases) if total_test_cases > 0 else 0
    
    previous_kpis = {
        "coverage": prev_coverage,
        "pass_rate": prev_pass_rate,
        "failure_trends": prev_failure_trends,
        "flakiness": prev_flakiness,
        "cycle_time": prev_cycle_time,
        "defect_density": prev_defect_density
    }
    
    # Calculate trends
    def calculate_trend(current, previous):
        if previous == 0:
            return {"current": current, "trend": "up" if current > 0 else "stable", "change": current}
        change = current - previous
        trend = "up" if change > 0 else "down" if change < 0 else "stable"
        return {"current": current, "trend": trend, "change": round(change, 1)}
    
    # Get recent activity data
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    test_runs_today = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.created_at >= today_start
    ).count()
    
    # Get tests executed today
    tests_executed_today = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= today_start
    ).count()
    
    # Get defects found (could be from a defects table or failed tests)
    defects_found_today = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= today_start,
        TestResult.status.in_(['fail', 'failed'])
    ).count()
    
    # Get team performance data for the selected period. Prefer actual executors; fallback to assigned runs.
    current_period_start = datetime.now() - timedelta(days=days)
    active_testers = db.query(TestResult.executed_by).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= current_period_start,
        TestResult.executed_by.isnot(None)
    ).distinct().count()
    if active_testers == 0:
        active_testers = db.query(TestRun.assigned_to).filter(
            TestRun.project_id == project_id,
            TestRun.created_at >= current_period_start,
            TestRun.assigned_to.isnot(None)
        ).distinct().count()
    
    # Get upcoming items
    scheduled_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.status == 'scheduled'
    ).count()
    
    # Get pending reviews (test cases with status 'pending_review' or similar)
    # TestCase doesn't have direct project_id, need to join through TestSuite
    pending_reviews = db.query(TestCase).join(TestSuite).filter(
        TestSuite.project_id == project_id,
        TestCase.status.in_(['pending_review', 'draft'])
    ).count()
    
    # Release deadline - database doesn't have target_end_date column in test_plans
    # Return N/A until database schema is updated
    release_deadline = "N/A"
    
    return {
        "project_id": project_id,
        "time_period": time_period,
        "kpi_data": {
            "coverage": calculate_trend(kpis["coverage"], previous_kpis["coverage"]),
            "passRate": calculate_trend(kpis["pass_rate"], previous_kpis["pass_rate"]),
            "failureTrends": calculate_trend(kpis["failure_trends"], previous_kpis["failure_trends"]),
            "flakiness": calculate_trend(kpis["flakiness"], previous_kpis["flakiness"]),
            "cycleTime": calculate_trend(kpis["cycle_time"], previous_kpis["cycle_time"]),
            "defectDensity": calculate_trend(kpis["defect_density"], previous_kpis["defect_density"])
        },
        "recent_activity": {
            "test_runs_today": test_runs_today,
            "tests_executed": tests_executed_today,
            "defects_found": defects_found_today
        },
        "team_performance": {
            "active_testers": active_testers,
            "avg_execution_time": kpis["avg_execution_time"],
            "productivity_score": kpis["productivity_score"]
        },
        "upcoming_items": {
            "scheduled_runs": scheduled_runs,
            "pending_reviews": pending_reviews,
            "release_deadline": release_deadline
        }
    }


# Test Case Section CRUD functions
def create_test_case_section(db: Session, section: TestCaseSectionCreate):
    db_section = TestCaseSection(**section.model_dump())
    db.add(db_section)
    safe_commit(db)
    db.refresh(db_section)
    return db_section


def get_test_case_sections(db: Session, test_suite_id: int = None, parent_section_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(TestCaseSection)
    if test_suite_id:
        query = query.filter(TestCaseSection.test_suite_id == test_suite_id)
    if parent_section_id is not None:
        query = query.filter(TestCaseSection.parent_section_id == parent_section_id)
    return query.offset(skip).limit(limit).all()


def get_test_case_section(db: Session, section_id: int):
    return db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()


def update_test_case_section(db: Session, section_id: int, section: TestCaseSectionUpdate):
    db_section = db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()
    if db_section:
        update_data = section.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_section, field, value)
        safe_commit(db)
        db.refresh(db_section)
    return db_section


def delete_test_case_section(db: Session, section_id: int):
    db_section = db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()
    if db_section:
        db.delete(db_section)
        safe_commit(db)
    return db_section


# Shared Step CRUD functions
def create_shared_step(db: Session, step: dict):
    db_step = SharedStep(**step)
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def get_shared_steps(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(SharedStep).filter(SharedStep.is_active == True)
    if project_id:
        query = query.filter(SharedStep.project_id == project_id)
    return query.order_by(SharedStep.usage_count.desc()).offset(skip).limit(limit).all()


def get_shared_step(db: Session, step_id: int):
    return db.query(SharedStep).filter(SharedStep.id == step_id, SharedStep.is_active == True).first()


def update_shared_step(db: Session, step_id: int, step: dict):
    db_step = db.query(SharedStep).filter(SharedStep.id == step_id).first()
    if db_step:
        for key, value in step.items():
            setattr(db_step, key, value)
        safe_commit(db)
        db.refresh(db_step)
    return db_step


def delete_shared_step(db: Session, step_id: int):
    db_step = db.query(SharedStep).filter(SharedStep.id == step_id).first()
    if db_step:
        db_step.is_active = False
        safe_commit(db)
        db.refresh(db_step)
    return db_step


def increment_shared_step_usage(db: Session, step_id: int):
    db_step = db.query(SharedStep).filter(SharedStep.id == step_id).first()
    if db_step:
        db_step.usage_count += 1
        safe_commit(db)
        db.refresh(db_step)
    return db_step


# Global Parameter CRUD functions
def create_global_parameter(db: Session, parameter: dict):
    db_param = GlobalParameter(**parameter)
    db.add(db_param)
    safe_commit(db)
    db.refresh(db_param)
    return db_param


def get_global_parameters(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(GlobalParameter).filter(GlobalParameter.is_active == True)
    if project_id is None:
        # Global parameters (project_id is null)
        query = query.filter(GlobalParameter.project_id.is_(None))
    else:
        # Project-specific parameters
        query = query.filter(GlobalParameter.project_id == project_id)
    return query.order_by(GlobalParameter.name).offset(skip).limit(limit).all()


def get_global_parameter(db: Session, param_id: int):
    return db.query(GlobalParameter).filter(GlobalParameter.id == param_id, GlobalParameter.is_active == True).first()


def get_global_parameter_by_name(db: Session, name: str, project_id: int = None):
    query = db.query(GlobalParameter).filter(GlobalParameter.name == name, GlobalParameter.is_active == True)
    if project_id is None:
        query = query.filter(GlobalParameter.project_id.is_(None))
    else:
        query = query.filter(GlobalParameter.project_id == project_id)
    return query.first()


def update_global_parameter(db: Session, param_id: int, parameter: dict):
    db_param = db.query(GlobalParameter).filter(GlobalParameter.id == param_id).first()
    if db_param:
        for key, value in parameter.items():
            setattr(db_param, key, value)
        safe_commit(db)
        db.refresh(db_param)
    return db_param


def delete_global_parameter(db: Session, param_id: int):
    db_param = db.query(GlobalParameter).filter(GlobalParameter.id == param_id).first()
    if db_param:
        db_param.is_active = False
        safe_commit(db)
        db.refresh(db_param)
    return db_param


# Test Mindmap CRUD functions
def create_test_mindmap(db: Session, mindmap: dict):
    db_mindmap = TestMindmap(**mindmap)
    db.add(db_mindmap)
    safe_commit(db)
    db.refresh(db_mindmap)
    return db_mindmap


def get_test_mindmaps(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(TestMindmap).filter(TestMindmap.is_active == True)
    if project_id:
        query = query.filter(TestMindmap.project_id == project_id)
    return query.order_by(TestMindmap.name).offset(skip).limit(limit).all()


def get_test_mindmap(db: Session, mindmap_id: int):
    return db.query(TestMindmap).filter(TestMindmap.id == mindmap_id, TestMindmap.is_active == True).first()


def update_test_mindmap(db: Session, mindmap_id: int, mindmap: dict):
    db_mindmap = db.query(TestMindmap).filter(TestMindmap.id == mindmap_id).first()
    if db_mindmap:
        for key, value in mindmap.items():
            setattr(db_mindmap, key, value)
        safe_commit(db)
        db.refresh(db_mindmap)
    return db_mindmap


def delete_test_mindmap(db: Session, mindmap_id: int):
    db_mindmap = db.query(TestMindmap).filter(TestMindmap.id == mindmap_id).first()
    if db_mindmap:
        db_mindmap.is_active = False
        safe_commit(db)
        db.refresh(db_mindmap)
    return db_mindmap


# Impact Analysis CRUD functions
def create_impact_analysis(db: Session, analysis: dict):
    db_analysis = ImpactAnalysis(**analysis)
    db.add(db_analysis)
    safe_commit(db)
    db.refresh(db_analysis)
    return db_analysis


def get_impact_analyses(db: Session, project_id: int = None, entity_type: str = None, entity_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(ImpactAnalysis)
    if project_id:
        query = query.filter(ImpactAnalysis.project_id == project_id)
    if entity_type:
        query = query.filter(ImpactAnalysis.entity_type == entity_type)
    if entity_id:
        query = query.filter(ImpactAnalysis.entity_id == entity_id)
    return query.order_by(ImpactAnalysis.created_at.desc()).offset(skip).limit(limit).all()


def get_impact_analysis(db: Session, analysis_id: int):
    return db.query(ImpactAnalysis).filter(ImpactAnalysis.id == analysis_id).first()


def update_impact_analysis(db: Session, analysis_id: int, analysis: dict):
    db_analysis = db.query(ImpactAnalysis).filter(ImpactAnalysis.id == analysis_id).first()
    if db_analysis:
        for key, value in analysis.items():
            setattr(db_analysis, key, value)
        safe_commit(db)
        db.refresh(db_analysis)
    return db_analysis


def delete_impact_analysis(db: Session, analysis_id: int):
    db_analysis = db.query(ImpactAnalysis).filter(ImpactAnalysis.id == analysis_id).first()
    if db_analysis:
        db.delete(db_analysis)
        safe_commit(db)
    return db_analysis


# Execution Environment CRUD
def get_execution_environments(db: Session, project_id: int = None):
    query = db.query(ExecutionEnvironment)
    if project_id:
        query = query.filter(ExecutionEnvironment.project_id == project_id)
    return query.all()


def get_execution_environment(db: Session, environment_id: int):
    return db.query(ExecutionEnvironment).filter(ExecutionEnvironment.id == environment_id).first()


def create_execution_environment(db: Session, environment: dict):
    db_environment = ExecutionEnvironment(**environment)
    db.add(db_environment)
    safe_commit(db)
    db.refresh(db_environment)
    return db_environment


def update_execution_environment(db: Session, environment_id: int, environment: dict):
    db_environment = db.query(ExecutionEnvironment).filter(ExecutionEnvironment.id == environment_id).first()
    if db_environment:
        for key, value in environment.items():
            setattr(db_environment, key, value)
        safe_commit(db)
        db.refresh(db_environment)
    return db_environment


def delete_execution_environment(db: Session, environment_id: int):
    db_environment = db.query(ExecutionEnvironment).filter(ExecutionEnvironment.id == environment_id).first()
    if db_environment:
        db.delete(db_environment)
        safe_commit(db)
    return db_environment


# Test Schedule CRUD
def get_test_schedules(db: Session, project_id: int = None):
    query = db.query(TestSchedule)
    if project_id:
        query = query.filter(TestSchedule.project_id == project_id)
    return query.all()


def get_test_schedule(db: Session, schedule_id: int):
    return db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()


def create_test_schedule(db: Session, schedule: dict):
    db_schedule = TestSchedule(**schedule)
    db.add(db_schedule)
    safe_commit(db)
    db.refresh(db_schedule)
    return db_schedule


def update_test_schedule(db: Session, schedule_id: int, schedule: dict):
    db_schedule = db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()
    if db_schedule:
        for key, value in schedule.items():
            setattr(db_schedule, key, value)
        safe_commit(db)
        db.refresh(db_schedule)
    return db_schedule


def delete_test_schedule(db: Session, schedule_id: int):
    db_schedule = db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()
    if db_schedule:
        db.delete(db_schedule)
        safe_commit(db)
    return db_schedule


# Execution Engine CRUD
def get_execution_engines(db: Session):
    return db.query(ExecutionEngine).filter(ExecutionEngine.is_active == True).all()


def get_execution_engine(db: Session, engine_id: int):
    return db.query(ExecutionEngine).filter(ExecutionEngine.id == engine_id).first()


def create_execution_engine(db: Session, engine: dict):
    db_engine = ExecutionEngine(**engine)
    db.add(db_engine)
    safe_commit(db)
    db.refresh(db_engine)
    return db_engine


def update_execution_engine(db: Session, engine_id: int, engine: dict):
    db_engine = db.query(ExecutionEngine).filter(ExecutionEngine.id == engine_id).first()
    if db_engine:
        for key, value in engine.items():
            setattr(db_engine, key, value)
        safe_commit(db)
        db.refresh(db_engine)
    return db_engine


def delete_execution_engine(db: Session, engine_id: int):
    db_engine = db.query(ExecutionEngine).filter(ExecutionEngine.id == engine_id).first()
    if db_engine:
        db.delete(db_engine)
        safe_commit(db)
    return db_engine


# Execution Log CRUD
def get_execution_logs(db: Session, test_run_id: int = None, test_result_id: int = None):
    query = db.query(ExecutionLog)
    if test_run_id:
        query = query.filter(ExecutionLog.test_run_id == test_run_id)
    if test_result_id:
        query = query.filter(ExecutionLog.test_result_id == test_result_id)
    return query.order_by(ExecutionLog.timestamp.desc()).all()


def create_execution_log(db: Session, log: dict):
    db_log = ExecutionLog(**log)
    db.add(db_log)
    safe_commit(db)
    db.refresh(db_log)
    return db_log


# Test Run Environment CRUD
def get_test_run_environments(db: Session, test_run_id: int):
    return db.query(TestRunEnvironment).filter(TestRunEnvironment.test_run_id == test_run_id).all()


def create_test_run_environment(db: Session, test_run_environment: dict):
    db_test_run_env = TestRunEnvironment(**test_run_environment)
    db.add(db_test_run_env)
    safe_commit(db)
    db.refresh(db_test_run_env)
    return db_test_run_env


# Enhanced Defect Management CRUD

# Defect Comments
def get_defect_comments(db: Session, defect_id: int):
    return db.query(DefectComment).filter(DefectComment.defect_id == defect_id).order_by(DefectComment.created_at.desc()).all()


def create_defect_comment(db: Session, comment: dict):
    db_comment = DefectComment(**comment)
    db.add(db_comment)
    safe_commit(db)
    db.refresh(db_comment)
    return db_comment


def update_defect_comment(db: Session, comment_id: int, comment: dict):
    db_comment = db.query(DefectComment).filter(DefectComment.id == comment_id).first()
    if db_comment:
        for key, value in comment.items():
            setattr(db_comment, key, value)
        safe_commit(db)
        db.refresh(db_comment)
    return db_comment


def delete_defect_comment(db: Session, comment_id: int):
    db_comment = db.query(DefectComment).filter(DefectComment.id == comment_id).first()
    if db_comment:
        db.delete(db_comment)
        safe_commit(db)
    return db_comment


# Defect Attachments
def get_defect_attachments(db: Session, defect_id: int):
    return db.query(DefectAttachment).filter(DefectAttachment.defect_id == defect_id).order_by(DefectAttachment.uploaded_at.desc()).all()


def create_defect_attachment(db: Session, attachment: dict):
    db_attachment = DefectAttachment(**attachment)
    db.add(db_attachment)
    safe_commit(db)
    db.refresh(db_attachment)
    return db_attachment


def delete_defect_attachment(db: Session, attachment_id: int):
    db_attachment = db.query(DefectAttachment).filter(DefectAttachment.id == attachment_id).first()
    if db_attachment:
        db.delete(db_attachment)
        safe_commit(db)
    return db_attachment


# Defect History
def get_defect_history(db: Session, defect_id: int):
    return db.query(DefectHistory).filter(DefectHistory.defect_id == defect_id).order_by(DefectHistory.created_at.desc()).all()


def create_defect_history(db: Session, history: dict):
    db_history = DefectHistory(**history)
    db.add(db_history)
    safe_commit(db)
    db.refresh(db_history)
    return db_history


# Defect Workflows
def get_defect_workflows(db: Session, project_id: int):
    return db.query(DefectWorkflow).filter(DefectWorkflow.project_id == project_id).all()


def get_default_defect_workflow(db: Session, project_id: int):
    return db.query(DefectWorkflow).filter(DefectWorkflow.project_id == project_id, DefectWorkflow.is_default == True).first()


def create_defect_workflow(db: Session, workflow: dict):
    db_workflow = DefectWorkflow(**workflow)
    db.add(db_workflow)
    safe_commit(db)
    db.refresh(db_workflow)
    return db_workflow


def update_defect_workflow(db: Session, workflow_id: int, workflow: dict):
    db_workflow = db.query(DefectWorkflow).filter(DefectWorkflow.id == workflow_id).first()
    if db_workflow:
        for key, value in workflow.items():
            setattr(db_workflow, key, value)
        safe_commit(db)
        db.refresh(db_workflow)
    return db_workflow


def delete_defect_workflow(db: Session, workflow_id: int):
    db_workflow = db.query(DefectWorkflow).filter(DefectWorkflow.id == workflow_id).first()
    if db_workflow:
        db.delete(db_workflow)
        safe_commit(db)
    return db_workflow


# Defect Templates
def get_defect_templates(db: Session, project_id: int):
    return db.query(DefectTemplate).filter(DefectTemplate.project_id == project_id, DefectTemplate.is_active == True).all()


def get_defect_template(db: Session, template_id: int):
    return db.query(DefectTemplate).filter(DefectTemplate.id == template_id).first()


def create_defect_template(db: Session, template: dict):
    db_template = DefectTemplate(**template)
    db.add(db_template)
    safe_commit(db)
    db.refresh(db_template)
    return db_template


def update_defect_template(db: Session, template_id: int, template: dict):
    db_template = db.query(DefectTemplate).filter(DefectTemplate.id == template_id).first()
    if db_template:
        for key, value in template.items():
            setattr(db_template, key, value)
        safe_commit(db)
        db.refresh(db_template)
    return db_template


def delete_defect_template(db: Session, template_id: int):
    db_template = db.query(DefectTemplate).filter(DefectTemplate.id == template_id).first()
    if db_template:
        db.delete(db_template)
        safe_commit(db)
    return db_template


# Issue Tracker Integrations
def get_issue_tracker_integrations(db: Session, project_id: int):
    return db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.project_id == project_id).all()


def get_issue_tracker_integration(db: Session, integration_id: int):
    return db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.id == integration_id).first()


def create_issue_tracker_integration(db: Session, integration: dict):
    db_integration = IssueTrackerIntegration(**integration)
    db.add(db_integration)
    safe_commit(db)
    db.refresh(db_integration)
    return db_integration


def update_issue_tracker_integration(db: Session, integration_id: int, integration: dict):
    db_integration = db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.id == integration_id).first()
    if db_integration:
        for key, value in integration.items():
            setattr(db_integration, key, value)
        safe_commit(db)
        db.refresh(db_integration)
    return db_integration


def delete_issue_tracker_integration(db: Session, integration_id: int):
    db_integration = db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.id == integration_id).first()
    if db_integration:
        db.delete(db_integration)
        safe_commit(db)
    return db_integration


# Sync Logs
def get_sync_logs(db: Session, integration_id: int = None, limit: int = 100):
    query = db.query(SyncLog)
    if integration_id:
        query = query.filter(SyncLog.integration_id == integration_id)
    return query.order_by(SyncLog.started_at.desc()).limit(limit).all()


def create_sync_log(db: Session, log: dict):
    db_log = SyncLog(**log)
    db.add(db_log)
    safe_commit(db)
    db.refresh(db_log)
    return db_log


# Enhanced Defect Functions
def get_defects_with_relations(db: Session, project_id: int = None):
    query = db.query(Defect)
    if project_id:
        query = query.filter(Defect.project_id == project_id)
    return query.all()


def update_defect_with_history(db: Session, defect_id: int, defect_data: dict, user_id: int, change_reason: str = None):
    db_defect = db.query(Defect).filter(Defect.id == defect_id).first()
    if db_defect:
        # Track changes
        for field, new_value in defect_data.items():
            old_value = getattr(db_defect, field, None)
            if old_value != new_value:
                history = {
                    'defect_id': defect_id,
                    'user_id': user_id,
                    'field_name': field,
                    'old_value': str(old_value) if old_value is not None else None,
                    'new_value': str(new_value) if new_value is not None else None,
                    'change_reason': change_reason
                }
                create_defect_history(db, history)
        
        # Update defect
        for key, value in defect_data.items():
            setattr(db_defect, key, value)
        
        safe_commit(db)
        db.refresh(db_defect)
    return db_defect


# User Invitation CRUD
def create_user_invitation(db: Session, invitation: dict, invited_by_id: int):
    import secrets
    from datetime import timedelta
    from .rbac import role_value
    
    # Generate a secure token
    token = secrets.token_urlsafe(32)
    
    # Set expiration to 7 days from now
    expires_at = datetime.now() + timedelta(days=7)
    
    # Convert project_ids list to comma-separated string
    project_ids_str = ','.join(map(str, invitation.get('project_ids', []))) if invitation.get('project_ids') else ''
    
    from .models import UserInvitation
    db_invitation = UserInvitation(
        email=invitation['email'],
        token=token,
        role=role_value(invitation.get('role', Role.TESTER)),
        project_ids=project_ids_str,
        invited_by=invited_by_id,
        expires_at=expires_at,
        is_used=False
    )
    db.add(db_invitation)
    safe_commit(db)
    db.refresh(db_invitation)
    return db_invitation


def get_user_invitation_by_token(db: Session, token: str):
    from .models import UserInvitation
    return db.query(UserInvitation).filter(UserInvitation.token == token, UserInvitation.is_used == False).first()


def get_user_invitation(db: Session, invitation_id: int):
    from .models import UserInvitation
    return db.query(UserInvitation).filter(UserInvitation.id == invitation_id).first()


def get_user_invitations(db: Session, skip: int = 0, limit: int = 100):
    from .models import UserInvitation
    return db.query(UserInvitation).offset(skip).limit(limit).all()


def mark_invitation_as_used(db: Session, invitation_id: int):
    from .models import UserInvitation
    db_invitation = db.query(UserInvitation).filter(UserInvitation.id == invitation_id).first()
    if db_invitation:
        db_invitation.is_used = True
        db_invitation.accepted_at = datetime.now()
        safe_commit(db)
        db.refresh(db_invitation)
    return db_invitation


def delete_user_invitation(db: Session, invitation_id: int):
    from .models import UserInvitation
    db_invitation = db.query(UserInvitation).filter(UserInvitation.id == invitation_id).first()
    if db_invitation:
        db.delete(db_invitation)
        safe_commit(db)
    return db_invitation


# Test Case Revision CRUD functions
def get_test_case_revisions(db: Session, test_case_id: int):
    return db.query(TestCaseRevision).filter(
        TestCaseRevision.test_case_id == test_case_id
    ).order_by(TestCaseRevision.revision_number.desc()).all()


def create_test_case_revision(db: Session, revision: TestCaseRevisionCreate):
    # Get the next revision number
    last_revision = db.query(TestCaseRevision).filter(
        TestCaseRevision.test_case_id == revision.test_case_id
    ).order_by(TestCaseRevision.revision_number.desc()).first()
    
    next_revision_number = (last_revision.revision_number + 1) if last_revision else 1
    
    # Convert enum values to proper enum types
    from .models import TestType, Priority
    
    try:
        # Handle test_type conversion
        test_type_enum = None
        if revision.test_type:
            if isinstance(revision.test_type, str):
                test_type_enum = getattr(TestType, revision.test_type.upper())
            else:
                test_type_enum = revision.test_type
        
        # Handle priority conversion
        priority_enum = None
        if revision.priority:
            if isinstance(revision.priority, str):
                priority_enum = getattr(Priority, revision.priority.upper())
            else:
                priority_enum = revision.priority
        
        db_revision = TestCaseRevision(
            test_case_id=revision.test_case_id,
            revision_number=next_revision_number,
            title=revision.title,
            description=revision.description,
            test_type=test_type_enum,
            preconditions=revision.preconditions,
            steps=revision.steps,
            expected_result=revision.expected_result,
            priority=priority_enum,
            tags=revision.tags,
            changed_fields=revision.changed_fields,
            change_reason=revision.change_reason,
            created_by=revision.created_by
        )
        
        db.add(db_revision)
        safe_commit(db)
        db.refresh(db_revision)
        return db_revision
    except Exception as e:
        print(f"CRUD: Error creating revision: {e}")
        raise


# Test Management Settings CRUD functions

# Test Type Definition CRUD
def _normalize_definition_name(value: Optional[str]) -> str:
    return (value or "").strip().lower().replace("_", " ").replace("-", " ")


def _apply_test_type_usage_counts(db: Session, definitions: List[TestTypeDefinition]) -> List[TestTypeDefinition]:
    if not definitions:
        return definitions

    usage_rows = (
        db.query(TestCase.test_type, func.count(TestCase.id))
        .filter(TestCase.test_type.isnot(None))
        .group_by(TestCase.test_type)
        .all()
    )
    usage_by_name = {
        _normalize_definition_name(test_type): count
        for test_type, count in usage_rows
        if _normalize_definition_name(test_type)
    }

    for definition in definitions:
        set_committed_value(definition, "usage_count", usage_by_name.get(_normalize_definition_name(definition.name), 0))

    return definitions


def get_test_type_definitions(db: Session, skip: int = 0, limit: int = 100):
    definitions = (
        db.query(TestTypeDefinition)
        .filter(TestTypeDefinition.is_active == True)
        .order_by(TestTypeDefinition.name)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return _apply_test_type_usage_counts(db, definitions)


def get_test_type_definition(db: Session, test_type_id: int):
    definition = db.query(TestTypeDefinition).filter(TestTypeDefinition.id == test_type_id).first()
    if definition:
        _apply_test_type_usage_counts(db, [definition])
    return definition


def create_test_type_definition(db: Session, test_type: TestTypeDefinitionCreate):
    db_test_type = TestTypeDefinition(**test_type.model_dump())
    db.add(db_test_type)
    safe_commit(db)
    db.refresh(db_test_type)
    return db_test_type


def update_test_type_definition(db: Session, test_type_id: int, test_type: TestTypeDefinitionUpdate):
    db_test_type = db.query(TestTypeDefinition).filter(TestTypeDefinition.id == test_type_id).first()
    if db_test_type:
        update_data = test_type.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_test_type, field, value)
        safe_commit(db)
        db.refresh(db_test_type)
    return db_test_type


def delete_test_type_definition(db: Session, test_type_id: int):
    db_test_type = db.query(TestTypeDefinition).filter(TestTypeDefinition.id == test_type_id).first()
    if db_test_type:
        db_test_type.is_active = False
        safe_commit(db)
    return db_test_type


# Priority Definition CRUD
def get_priority_definitions(db: Session, skip: int = 0, limit: int = 100):
    return db.query(PriorityDefinition).filter(PriorityDefinition.is_active == True).order_by(PriorityDefinition.value.desc()).offset(skip).limit(limit).all()


def get_priority_definition(db: Session, priority_id: int):
    return db.query(PriorityDefinition).filter(PriorityDefinition.id == priority_id).first()


def ensure_default_priority_and_test_type_definitions(db: Session, created_by: int):
    """
    Ensure default priority and test type definitions exist in the database.
    If they don't exist, create them automatically.
    """
    # Check if any priority definitions exist
    priority_count = db.query(PriorityDefinition).count()
    if priority_count == 0:
        # Create default priority definitions
        default_priorities = [
            {"name": "Critical", "value": 4, "color": "#DC2626", "description": "Critical priority - immediate attention required", "is_default": False},
            {"name": "High", "value": 3, "color": "#F97316", "description": "High priority - urgent attention required", "is_default": False},
            {"name": "Medium", "value": 2, "color": "#F59E0B", "description": "Medium priority - normal attention required", "is_default": True},
            {"name": "Low", "value": 1, "color": "#6B7280", "description": "Low priority - can be addressed later", "is_default": False},
        ]
        for priority_data in default_priorities:
            priority = PriorityDefinitionCreate(**priority_data, created_by=created_by)
            create_priority_definition(db, priority)
    
    # Check if any test type definitions exist
    test_type_count = db.query(TestTypeDefinition).count()
    if test_type_count == 0:
        # Create default test type definitions
        default_test_types = [
            {"name": "Manual", "description": "Manual testing - executed by human testers", "color": "#3B82F6", "icon": "🖱️"},
            {"name": "Automated", "description": "Automated testing - executed by scripts/tools", "color": "#10B981", "icon": "🤖"},
            {"name": "Smoke", "description": "Smoke testing - basic functionality checks", "color": "#6B7280", "icon": "💨"},
            {"name": "Regression", "description": "Regression testing - verify existing functionality", "color": "#F97316", "icon": "🔄"},
            {"name": "Integration", "description": "Integration testing - test component interactions", "color": "#8B5CF6", "icon": "🔗"},
            {"name": "Security", "description": "Security testing - identify vulnerabilities", "color": "#EF4444", "icon": "🔒"},
            {"name": "Performance", "description": "Performance testing - measure system performance", "color": "#F59E0B", "icon": "⚡"},
            {"name": "Usability", "description": "Usability testing - evaluate user experience", "color": "#EC4899", "icon": "👥"},
        ]
        for test_type_data in default_test_types:
            test_type = TestTypeDefinitionCreate(**test_type_data, created_by=created_by)
            create_test_type_definition(db, test_type)


def ensure_default_environment_definitions(db: Session, project_id: int, created_by: int):
    """
    Ensure default execution environments exist for a project.
    If they don't exist, create them automatically.
    """
    # Check if any environments exist for this project
    environment_count = db.query(ExecutionEnvironment).filter(ExecutionEnvironment.project_id == project_id).count()
    if environment_count == 0:
        # Create default execution environments
        default_environments = [
            {
                "name": "Development",
                "description": "Development environment for testing",
                "environment_type": "development",
                "config_data": {"url": "http://localhost:3000"},
                "build_info": {"version": "dev"},
                "is_active": True,
                "project_id": project_id
            },
            {
                "name": "Staging",
                "description": "Staging environment for pre-production testing",
                "environment_type": "staging",
                "config_data": {"url": "https://staging.example.com"},
                "build_info": {"version": "staging"},
                "is_active": True,
                "project_id": project_id
            },
            {
                "name": "Production",
                "description": "Production environment for live testing",
                "environment_type": "production",
                "config_data": {"url": "https://example.com"},
                "build_info": {"version": "prod"},
                "is_active": True,
                "project_id": project_id
            }
        ]
        for env_data in default_environments:
            create_execution_environment(db, env_data)


def create_priority_definition(db: Session, priority: PriorityDefinitionCreate):
    # If this is set as default, remove default from others
    if priority.is_default:
        db.query(PriorityDefinition).filter(PriorityDefinition.is_default == True).update({"is_default": False})
    
    db_priority = PriorityDefinition(**priority.model_dump())
    db.add(db_priority)
    safe_commit(db)
    db.refresh(db_priority)
    return db_priority


def update_priority_definition(db: Session, priority_id: int, priority: PriorityDefinitionUpdate):
    db_priority = db.query(PriorityDefinition).filter(PriorityDefinition.id == priority_id).first()
    if db_priority:
        update_data = priority.model_dump(exclude_unset=True)
        
        # If this is set as default, remove default from others
        if update_data.get("is_default", False):
            db.query(PriorityDefinition).filter(PriorityDefinition.is_default == True).filter(PriorityDefinition.id != priority_id).update({"is_default": False})
        
        for field, value in update_data.items():
            setattr(db_priority, field, value)
        safe_commit(db)
        db.refresh(db_priority)
    return db_priority


def delete_priority_definition(db: Session, priority_id: int):
    db_priority = db.query(PriorityDefinition).filter(PriorityDefinition.id == priority_id).first()
    if db_priority:
        db_priority.is_active = False
        safe_commit(db)
    return db_priority


# Shared Step Template CRUD
def get_shared_step_templates(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(SharedStepTemplate).filter(SharedStepTemplate.is_active == True)
    if project_id:
        query = query.filter(SharedStepTemplate.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def get_shared_step_template(db: Session, template_id: int):
    return db.query(SharedStepTemplate).filter(SharedStepTemplate.id == template_id).first()


def create_shared_step_template(db: Session, template: SharedStepTemplateCreate):
    db_template = SharedStepTemplate(**template.model_dump())
    db.add(db_template)
    safe_commit(db)
    db.refresh(db_template)
    return db_template


def update_shared_step_template(db: Session, template_id: int, template: SharedStepTemplateUpdate):
    db_template = db.query(SharedStepTemplate).filter(SharedStepTemplate.id == template_id).first()
    if db_template:
        update_data = template.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_template, field, value)
        safe_commit(db)
        db.refresh(db_template)
    return db_template


def delete_shared_step_template(db: Session, template_id: int):
    db_template = db.query(SharedStepTemplate).filter(SharedStepTemplate.id == template_id).first()
    if db_template:
        db_template.is_active = False
        safe_commit(db)
    return db_template


def increment_shared_step_usage(db: Session, template_id: int):
    db_template = db.query(SharedStepTemplate).filter(SharedStepTemplate.id == template_id).first()
    if db_template:
        db_template.usage_count += 1
        safe_commit(db)
    return db_template


# Test Execution Settings CRUD
def get_test_execution_settings(db: Session, project_id: Optional[int] = None):
    query = db.query(TestExecutionSettings)
    if project_id:
        query = query.filter(TestExecutionSettings.project_id == project_id)
    else:
        query = query.filter(TestExecutionSettings.project_id.is_(None))
    return query.first()


def create_test_execution_settings(db: Session, settings: TestExecutionSettingsCreate):
    db_settings = TestExecutionSettings(**settings.model_dump())
    db.add(db_settings)
    safe_commit(db)
    db.refresh(db_settings)
    return db_settings


def update_test_execution_settings(db: Session, settings_id: int, settings: TestExecutionSettingsUpdate):
    db_settings = db.query(TestExecutionSettings).filter(TestExecutionSettings.id == settings_id).first()
    if db_settings:
        update_data = settings.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_settings, field, value)
        safe_commit(db)
        db.refresh(db_settings)
    return db_settings


# Notification Settings CRUD
def get_notification_settings(db: Session, user_id: Optional[int] = None, project_id: Optional[int] = None):
    query = db.query(NotificationSettings)
    if user_id:
        query = query.filter(NotificationSettings.created_by == user_id)
    if project_id:
        query = query.filter(NotificationSettings.project_id == project_id)
    elif not user_id:
        query = query.filter(NotificationSettings.project_id.is_(None))
    return query.first()


def create_notification_settings(db: Session, settings: NotificationSettingsCreate):
    settings_dict = settings.model_dump()
    db_settings = NotificationSettings(**settings_dict)
    db.add(db_settings)
    safe_commit(db)
    db.refresh(db_settings)
    return db_settings


def update_notification_settings(db: Session, settings_id: int, settings: NotificationSettingsUpdate):
    db_settings = db.query(NotificationSettings).filter(NotificationSettings.id == settings_id).first()
    if db_settings:
        update_data = settings.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_settings, field, value)
        safe_commit(db)
        db.refresh(db_settings)
    return db_settings


# Automation Settings CRUD
def get_automation_settings(db: Session, project_id: Optional[int] = None):
    query = db.query(AutomationSettings)
    if project_id:
        query = query.filter(AutomationSettings.project_id == project_id)
    else:
        query = query.filter(AutomationSettings.project_id.is_(None))
    return query.first()


def create_automation_settings(db: Session, settings: AutomationSettingsCreate):
    settings_dict = settings.model_dump()
    db_settings = AutomationSettings(**settings_dict)
    db.add(db_settings)
    safe_commit(db)
    db.refresh(db_settings)
    return db_settings


def update_automation_settings(db: Session, settings_id: int, settings: AutomationSettingsUpdate):
    db_settings = db.query(AutomationSettings).filter(AutomationSettings.id == settings_id).first()
    if db_settings:
        update_data = settings.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_settings, field, value)
        safe_commit(db)
        db.refresh(db_settings)
    return db_settings


# System Settings CRUD
def get_system_setting(db: Session, key: str):
    return db.query(SystemSettings).filter(SystemSettings.key == key).first()


def get_system_settings(db: Session, skip: int = 0, limit: int = 100):
    return db.query(SystemSettings).offset(skip).limit(limit).all()


def create_system_setting(db: Session, setting: SystemSettingsCreate):
    # Check if setting with this key already exists
    existing = db.query(SystemSettings).filter(SystemSettings.key == setting.key).first()
    if existing:
        return None  # Return None to indicate duplicate key
    
    setting_dict = setting.model_dump()
    db_setting = SystemSettings(**setting_dict)
    db.add(db_setting)
    safe_commit(db)
    db.refresh(db_setting)
    return db_setting


def update_system_setting(db: Session, key: str, setting: SystemSettingsUpdate):
    db_setting = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if db_setting:
        update_data = setting.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_setting, field, value)
        safe_commit(db)
        db.refresh(db_setting)
    return db_setting


def delete_system_setting(db: Session, key: str):
    db_setting = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if db_setting:
        db.delete(db_setting)
        safe_commit(db)
    return db_setting


def initialize_onboarding_checklist(db: Session, user_id: int):
    """Initialize default onboarding checklist for a new user"""
    default_tasks = [
        {
            "task_key": "change_password",
            "task_name": "Change Default Password",
            "description": "Change your default password to secure your account"
        },
        {
            "task_key": "create_project",
            "task_name": "Create Your First Project",
            "description": "Create a project to start managing your tests"
        },
        {
            "task_key": "create_test_suite",
            "task_name": "Create a Test Suite",
            "description": "Organize your test cases into test suites"
        },
        {
            "task_key": "create_test_case",
            "task_name": "Create Your First Test Case",
            "description": "Write your first test case"
        },
        {
            "task_key": "review_settings",
            "task_name": "Review System Settings",
            "description": "Configure system settings for your needs"
        }
    ]
    
    for task in default_tasks:
        existing = db.query(OnboardingChecklist).filter(
            OnboardingChecklist.user_id == user_id,
            OnboardingChecklist.task_key == task["task_key"]
        ).first()
        
        if not existing:
            checklist_item = OnboardingChecklist(
                user_id=user_id,
                task_key=task["task_key"],
                task_name=task["task_name"],
                description=task["description"],
                is_completed=False
            )
            db.add(checklist_item)
    
    safe_commit(db)


def get_onboarding_checklist(db: Session, user_id: int):
    """Get onboarding checklist for a user"""
    return db.query(OnboardingChecklist).filter(
        OnboardingChecklist.user_id == user_id
    ).all()


def update_onboarding_task(db: Session, user_id: int, task_key: str, is_completed: bool):
    """Update onboarding task completion status"""
    task = db.query(OnboardingChecklist).filter(
        OnboardingChecklist.user_id == user_id,
        OnboardingChecklist.task_key == task_key
    ).first()
    
    if task:
        task.is_completed = is_completed
        if is_completed:
            task.completed_at = datetime.now()
        else:
            task.completed_at = None
        safe_commit(db)
        db.refresh(task)
    
    return task
