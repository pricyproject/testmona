export interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
  updated_at?: string;
  avatar_url?: string;
  bio?: string;
  location?: string;
  website?: string;
  company?: string;
}

export interface Project {
  id: number;
  name: string;
  description?: string;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at?: string;
}

export interface TestSuite {
  id: number;
  name: string;
  description?: string;
  project_id: number;
  status: 'active' | 'inactive' | 'archived';
  // Backend-supplied number of non-deleted test cases that belong to this suite.
  test_case_count?: number;
  // Legacy local-only field; kept for callers that still read it but no longer hydrated by the API.
  test_case_ids?: number[];
  created_at: string;
  updated_at?: string;
}

export interface TestCase {
  id: number;
  title: string;
  description?: string;
  test_type: string;
  preconditions?: string;
  steps?: string;
  expected_result?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'inactive' | 'archived';
  test_suite_id: number;
  section_id?: number;
  section?: string;
  tags?: string;
  reference?: string;
  order_index?: number;
  created_by?: number;
  created_at: string;
  updated_at?: string;
  is_multistep?: boolean;
  test_steps?: Array<{
    step_number: number;
    action: string;
    expected_result: string;
    step_type: string;
  }>;
  custom_field_values?: CustomFieldValue[];
  linked_requirements?: Requirement[];
  // Nested relationships
  creator?: User;
  test_suite?: {
    id: number;
    name: string;
    project_id: number;
    project?: {
      id: number;
      name: string;
    };
  };
  // For backward compatibility
  project_name?: string;
}

export interface TestCaseSection {
  id: number;
  name: string;
  description?: string;
  test_suite_id?: number;
  parent_section_id?: number;
  order_index?: number;
  is_active?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface SharedStep {
  id: number;
  name: string;
  description?: string | null;
  action: string;
  expected_result: string;
  project_id: number;
  created_by: number;
  created_at: string;
  updated_at?: string | null;
  is_active: boolean;
  usage_count: number;
}

export interface SharedStepCreate {
  name: string;
  description?: string | null;
  action: string;
  expected_result: string;
  project_id: number;
}

export interface SharedStepUpdate {
  name?: string;
  description?: string | null;
  action?: string;
  expected_result?: string;
  is_active?: boolean;
}

export interface TestRun {
  id: number;
  name: string;
  description?: string;
  project_id: number;
  test_plan_id?: number;
  milestone_id?: number;
  status: 'pending' | 'running' | 'in_progress' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'completed';
  environment_id?: number;
  environment?: {
    id: number;
    name: string;
    environment_type: string;
    description?: string;
  };
  started_at?: string;
  completed_at?: string;
  scheduled_date?: string;
  assigned_to?: number;
  assignee?: User;
  estimated_duration?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  total_tests?: number;
  executed_tests?: number;
  not_tested_tests?: number;
  passed_tests?: number;
  failed_tests?: number;
  blocked_tests?: number;
  skipped_tests?: number;
  progress_percent?: number;
  created_at: string;
  updated_at?: string;
  // Nested relationships
  creator?: User;
  test_suite?: {
    id: number;
    name: string;
    project_id: number;
    project?: {
      id: number;
      name: string;
    };
  };
  // For backward compatibility
  project_name?: string;
}

export interface TestResult {
  id: number;
  test_case_id: number;
  test_run_id: number;
  test_case?: {
    id: number;
    title: string;
    section?: {
      id: number;
      name: string;
    };
    priority?: string;
  };
  status: 'pass' | 'fail' | 'skip' | 'block' | 'not_tested';
  actual_result?: string;
  comments?: string;
  execution_time?: number;
  execution_started_at?: string;
  executed_by?: string | number;
  executor?: User;
  executed_at: string;
  created_at: string;
  updated_at?: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  bio?: string;
  location?: string;
  website?: string;
  company?: string;
  role: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
  updated_at?: string;
}

export interface TestRunStatistics {
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  pass_rate: number;
  execution_time?: number;
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect';

export interface CustomFieldDefinition {
  id: number;
  name: string;
  slug?: string;
  field_type: CustomFieldType;
  description?: string;
  project_id: number;
  is_required: boolean;
  default_value?: string;
  options?: Record<string, any>;
  validation_rules?: Record<string, any>;
  created_at: string;
  updated_at?: string;
}

export interface CustomFieldValue {
  id: number;
  field_definition_id: number;
  test_case_id: number;
  value?: string;
  created_at: string;
  updated_at?: string;
}

export interface TestCaseWithCustomFields extends TestCase {
  custom_field_values: CustomFieldValue[];
}

export interface CustomFieldDefinitionWithValues extends CustomFieldDefinition {
  values: CustomFieldValue[];
}

export interface JiraIntegration {
  id: number;
  name?: string;
  project_id: number;
  jira_url: string;
  username: string;
  api_token: string;
  project_key: string;
  is_active: boolean;
  sync_test_cases: boolean;
  sync_test_results: boolean;
  created_at: string;
  updated_at?: string;
}

export interface JiraIssue {
  id: number;
  integration_id: number;
  test_case_id?: number;
  test_result_id?: number;
  jira_issue_key: string;
  jira_issue_id: string;
  issue_type: string;
  status: string;
  summary?: string;
  description?: string;
  assignee?: string;
  reporter?: string;
  priority?: string;
  created_at: string;
  updated_at?: string;
}

export interface Notification {
  id: number;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  is_read: boolean;
  related_entity_type?: string;
  related_entity_id?: number;
  created_at: string;
  user_id: number;
}

// Audit Trail Types
export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'execute' | 'assign' | 'unassign' | 'approve' | 'reject' | 'archive' | 'restore' | 'export' | 'import' | 'sync';

export type EntityType = 'user' | 'project' | 'test_case' | 'test_suite' | 'test_run' | 'test_result' | 'test_plan' | 'requirement' | 'defect' | 'milestone' | 'custom_field' | 'jira_integration' | 'notification' | 'test_case_section' | 'test_schedule' | 'test_execution' | 'invitation' | 'shared_step' | 'shared_step_template' | 'system_setting' | 'global_parameter' | 'test_execution_settings' | 'automation_settings' | 'kpi_data' | 'test_step_result' | 'shareable_report' | 'root_cause_analysis' | 'dashboard_widget' | 'traceability_entry' | 'coverage_report';

export interface AuditTrail {
  id: number;
  user_id: number;
  username?: string;
  user_full_name?: string;
  action: AuditAction;
  entity_type: EntityType;
  entity_id?: number;
  project_id?: number;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  field_changes?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  description?: string;
  additional_metadata?: Record<string, any>;
  created_at: string;
}

export interface AuditTrailList {
  items: AuditTrail[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditTrailFilters {
  user_id?: number;
  action?: AuditAction;
  entity_type?: EntityType;
  entity_id?: number;
  project_id?: number;
  date_from?: string;
  date_to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ActivitySummary {
  user_id?: number;
  project_id?: number;
  days: number;
  total_activities: number;
  activity_counts: Array<{ action: AuditAction; count: number }>;
  entity_counts: Array<{ entity_type: EntityType; count: number }>;
  date_from: string;
  date_to: string;
  top_users?: Array<{ user_id: number; activity_count: number }>;
}

export interface EntityHistory {
  entity_type: EntityType;
  entity_id: number;
  total_changes: number;
  history: AuditTrail[];
}

export interface Requirement {
  id: number;
  title: string;
  description?: string;
  requirement_id: string;
  status: 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
  priority: 'low' | 'medium' | 'high' | 'critical';
  project_id: number;
  parent_requirement_id?: number;
  created_by: number;
  assigned_to?: number;
  tags?: string;
  acceptance_criteria?: string;
  estimated_effort?: number;
  created_at: string;
  updated_at?: string;
}

export interface RequirementCreate {
  title: string;
  description?: string;
  requirement_id: string;
  status?: 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  parent_requirement_id?: number;
  assigned_to?: number;
  tags?: string;
  acceptance_criteria?: string;
  estimated_effort?: number;
  project_id: number;
  created_by: number;
}

export interface RequirementUpdate {
  title?: string;
  description?: string;
  status?: 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  parent_requirement_id?: number;
  assigned_to?: number;
  tags?: string;
  acceptance_criteria?: string;
  estimated_effort?: number;
}

export interface RequirementExternalDocumentRequest {
  project_id: number;
  url: string;
}

export interface RequirementExternalDocumentResponse {
  source_type: 'jira' | 'confluence' | string;
  title: string;
  description?: string;
  acceptance_criteria?: string;
  external_key?: string;
  url: string;
}

export interface RequirementTraceabilitySummary {
  linked_count: number;
  active_count: number;
  missing_coverage: number;
  failed_related_runs: number;
  blocked_related_runs: number;
}

export type RequirementCoverageStatus = 'covered' | 'partial' | 'failing' | 'blocked' | 'uncovered';

export interface RequirementCoverageItem {
  requirement_id: number;
  linked_count: number;
  active_count: number;
  failed_related_runs: number;
  blocked_related_runs: number;
  status: RequirementCoverageStatus;
}

export interface RequirementCoverageList {
  items: RequirementCoverageItem[];
}

export interface RequirementVersionAuthor {
  id: number;
  username: string;
  full_name?: string | null;
}

export interface RequirementVersion {
  id: number;
  requirement_id: number;
  version_number: number;
  action: 'created' | 'updated' | 'restored' | string;
  title: string;
  description?: string | null;
  acceptance_criteria?: string | null;
  status?: string | null;
  priority?: string | null;
  tags?: string | null;
  estimated_effort?: number | null;
  change_note?: string | null;
  created_at: string;
  author?: RequirementVersionAuthor | null;
}

export interface RequirementComment {
  id: number;
  requirement_id: number;
  parent_id?: number | null;
  body: string;
  is_resolved: boolean;
  created_at: string;
  updated_at?: string | null;
  author?: RequirementVersionAuthor | null;
  replies: RequirementComment[];
}

export interface RequirementLinkedTestCase extends TestCase {
  suite_name?: string;
  section_name?: string;
  linked: boolean;
  link_id?: number;
  latest_run_status?: string;
  latest_run_at?: string;
}

export interface RequirementLinkedTestCaseList {
  items: RequirementLinkedTestCase[];
  total: number;
  skip: number;
  limit: number;
  summary: RequirementTraceabilitySummary;
}

export interface RequirementLinkedTestCaseBulkResponse {
  linked_count: number;
  unlinked_count: number;
  skipped_count: number;
  items: RequirementLinkedTestCase[];
  summary: RequirementTraceabilitySummary;
}

export interface RequirementLinkedTestCaseHistoryItem {
  id: number;
  action: 'link' | 'unlink' | string;
  test_case_id?: number;
  test_case_title?: string;
  user_id: number;
  username?: string;
  full_name?: string;
  created_at: string;
  description?: string;
}

export interface RequirementLinkedTestCaseHistory {
  items: RequirementLinkedTestCaseHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RequirementLinkedTestPlan {
  id: number;
  title: string;
  status?: string;
  milestone_id?: number;
  milestone_title?: string;
  target_start_date?: string;
  target_end_date?: string;
  linked: boolean;
}

export interface RequirementLinkedTestPlanList {
  items: RequirementLinkedTestPlan[];
  total: number;
  skip: number;
  limit: number;
}

export interface RequirementLinkedTestPlanBulkResponse {
  linked_count: number;
  unlinked_count: number;
  skipped_count: number;
  items: RequirementLinkedTestPlan[];
}

export interface RequirementRelationshipCount {
  total: number;
  items: Array<Record<string, any>>;
}

export interface RequirementRelationshipSummary {
  test_cases: RequirementTraceabilitySummary;
  defects: RequirementRelationshipCount;
  test_plans: RequirementRelationshipCount;
  milestones: RequirementRelationshipCount;
  test_runs: RequirementRelationshipCount;
  coverage_reports: RequirementRelationshipCount;
}

// Milestone Types
export type MilestoneStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type MilestoneHealth = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'blocked' | 'at_risk';

export interface MilestoneLinkedTestPlan {
  id: number;
  title: string;
  status?: string;
  target_start_date?: string;
  target_end_date?: string;
}

export interface Milestone {
  id: number;
  title: string;
  description?: string;
  status: MilestoneStatus;
  target_date?: string;
  actual_date?: string;
  progress_percentage: number;
  project_id: number;
  created_by?: number;
  created_at: string;
  updated_at?: string;
  test_plan_count: number;
  test_run_count: number;
  test_case_count: number;
  result_count: number;
  passed_count: number;
  failed_count: number;
  blocked_count: number;
  skipped_count: number;
  not_tested_count: number;
  execution_progress: number;
  pass_rate: number;
  open_defect_count: number;
  critical_defect_count: number;
  requirement_count: number;
  verified_requirement_count: number;
  is_overdue: boolean;
  health: MilestoneHealth;
  linked_test_plans: MilestoneLinkedTestPlan[];
}

export interface MilestoneCreate {
  title: string;
  description?: string;
  target_date?: string;
  project_id: number;
  created_by?: number;
}

export interface MilestoneUpdate {
  title?: string;
  description?: string;
  target_date?: string;
  status?: MilestoneStatus;
  actual_date?: string;
  progress_percentage?: number;
}

export interface MilestoneStats {
  total: number;
  planned: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
  atRisk: number;
  testPlans: number;
  testRuns: number;
  testCases: number;
  openDefects: number;
  averageExecutionProgress: number;
}
