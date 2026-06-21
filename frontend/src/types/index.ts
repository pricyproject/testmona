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
  project_seq?: number | null;
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

// Normalized, project-scoped tag (replaces the legacy comma-separated string).
export interface Tag {
  id: number;
  name: string;
  slug?: string;
  color: string;
  project_id?: number | null;
  description?: string | null;
  is_active?: boolean;
  usage_count?: number;
}

export interface TestCase {
  id: number;
  project_seq?: number | null;
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
  tags?: Tag[];
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
  project_seq?: number | null;
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
  project_seq?: number | null;
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
  not_started_tests?: number;
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

export interface MatrixRunEnvironmentColumn {
  test_run_id: number;
  test_run_seq?: number | null;
  environment_id?: number | null;
  environment_name: string;
  status: string;
  total_tests: number;
  executed_tests: number;
  passed_tests: number;
  failed_tests: number;
  blocked_tests: number;
  skipped_tests: number;
  not_started_tests: number;
  progress_percent: number;
}

export interface MatrixRunCell {
  test_result_id?: number | null;
  status: string;
}

export interface MatrixRunRow {
  test_case_id: number;
  test_case_seq?: number | null;
  title: string;
  priority?: string | null;
  /** Keyed by String(test_run_id) of the environment column. */
  results: Record<string, MatrixRunCell>;
}

export interface MatrixRun {
  id: number;
  project_id: number;
  project_seq?: number | null;
  name: string;
  description?: string | null;
  created_by?: number | null;
  created_at: string;
  updated_at?: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  case_count: number;
  progress_percent: number;
  environments: MatrixRunEnvironmentColumn[];
}

export interface MatrixRunDetail extends MatrixRun {
  rows: MatrixRunRow[];
}

export interface TestResult {
  id: number;
  test_case_id: number;
  test_run_id: number;
  test_case?: {
    id: number;
    project_seq?: number | null;
    project_id?: number | null;
    title: string;
    test_type?: string;
    section?: {
      id: number;
      name: string;
    };
    priority?: string;
  };
  status: 'pass' | 'fail' | 'skip' | 'block' | 'not_started';
  actual_result?: string;
  comments?: string;
  execution_time?: number;
  execution_started_at?: string;
  executed_by?: string | number;
  executor?: User;
  executed_at: string;
  created_at: string;
  updated_at?: string;
  retest_needed?: boolean;
  defect_links?: Array<{ id: number; link_type: string; defect?: { id: number; defect_id?: string; title?: string } }>;
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
  project_seq?: number | null;
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

export type TestDebtType = 'stale' | 'duplicate' | 'orphan' | 'always_pass' | 'never_run' | 'no_requirement_link';
export type TestDebtSeverity = 'low' | 'medium' | 'high' | 'critical';
export type TestDebtAction = 'update' | 'merge' | 'archive' | 'link_req' | 'review';

export interface TestDebtItem {
  id: number;
  project_id: number;
  test_case_id: number;
  debt_type: TestDebtType;
  severity: TestDebtSeverity;
  suggested_action: TestDebtAction;
  details?: string | null;
  auto_detected: boolean;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  test_case?: {
    id: number;
    project_seq?: number | null;
    title: string;
    priority?: string | null;
    status?: string | null;
    updated_at?: string | null;
  } | null;
}

export interface TestAssetHealthSummary {
  total_cases: number;
  active_debt_items: number;
  resolved_debt_items: number;
  affected_cases: number;
  healthy_cases: number;
  health_score: number;
  by_debt_type: Record<string, number>;
  by_severity: Record<string, number>;
  by_action: Record<string, number>;
  last_detected_at?: string | null;
}

export interface TestDebtBulkResolveResult {
  resolved: number;
  summary: TestAssetHealthSummary;
}

export interface TestAssetDebtDetectionResult {
  created: number;
  updated: number;
  auto_resolved: number;
  active_debt_items: number;
  summary: TestAssetHealthSummary;
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
  // Notification engine category key (e.g. 'mention', 'assignment'). Present on
  // engine-emitted rows; absent on legacy/manual ones.
  category?: string | null;
  // Work Inbox dismissal: an archived item is "done".
  archived?: boolean;
  // Work Inbox triage lifecycle (Plan B / W0): while snoozed_until is set and in
  // the future the item is hidden from the open inbox; done_at records when it
  // was archived. Both null/absent until the item is snoozed or done.
  snoozed_until?: string | null;
  done_at?: string | null;
  // Who triggered the notification + their resolved display name (inbox avatar/byline).
  actor_id?: number | null;
  actor_name?: string | null;
  // Owning project, resolved per page by the inbox route (group-by-project view).
  // Absent/null when the entity has no project or has been deleted.
  project_id?: number | null;
  project_name?: string | null;
  related_entity_type?: string;
  related_entity_id?: number;
  created_at: string;
  user_id: number;
}

// Work Inbox: per-category open/snoozed/done/unread counts for the filter rail.
export interface InboxCategorySummary {
  key: string;
  label: string;
  open: number;
  // Deferred (snoozed into the future) items — excluded from the open count.
  snoozed: number;
  done: number;
  unread: number;
}

export interface InboxSummary {
  total_open: number;
  total_unread: number;
  total_snoozed: number;
  categories: InboxCategorySummary[];
}

// Watch / change-notification subscription status for a doc or requirement.
export type WatchEntityType = 'doc' | 'requirement' | 'defect' | 'test_case' | 'test_plan';

export interface WatchStatus {
  watching: boolean;
  watcher_count: number;
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
  project_seq?: number | null;
  title: string;
  description?: string;
  requirement_id: string;
  status: 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
  priority: 'low' | 'medium' | 'high' | 'critical';
  project_id: number;
  parent_requirement_id?: number;
  folder_id?: number | null;
  created_by: number;
  assigned_to?: number;
  tags?: string;
  acceptance_criteria?: string;
  estimated_effort?: number;
  created_at: string;
  updated_at?: string;
}

export interface RequirementFolder {
  id: number;
  project_seq?: number | null;
  name: string;
  description?: string | null;
  project_id: number;
  parent_folder_id?: number | null;
  requirement_count: number;
  created_at: string;
  updated_at?: string | null;
}

export interface RequirementCreate {
  title: string;
  description?: string;
  requirement_id: string;
  status?: 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  parent_requirement_id?: number;
  folder_id?: number | null;
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
  folder_id?: number | null;
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

export type RequirementChatSourceType = 'requirement' | 'defect' | 'test_plan' | 'test_case';

export interface RequirementChatSource {
  type?: RequirementChatSourceType;
  id?: number | null;
  requirement_id?: number | null; // legacy rows
  key: string;
  title: string;
  excerpt?: string | null;
}

export interface RequirementChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources: RequirementChatSource[];
  prompt_tokens?: number | null;
  created_at: string;
}

export type RequirementChatShareScope = 'private' | 'project' | 'restricted';

export interface RequirementChatConversation {
  id: number;
  public_id: string;
  project_id: number;
  title: string;
  archived: boolean;
  pinned: boolean;
  share_scope: RequirementChatShareScope;
  share_expires_at?: string | null;
  share_allowed_user_ids: number[];
  created_at: string;
  updated_at?: string | null;
  messages: RequirementChatMessage[];
}

export interface RequirementChatSharedView {
  conversation: RequirementChatConversation;
  read_only: boolean;
}

export interface RequirementChatAskResponse {
  conversation_id: number;
  message: RequirementChatMessage;
  retrieval_truncated: boolean;
  requirements_considered: number;
  requirements_used: number;
  items_considered?: number;
  items_used?: number;
  source_counts?: Record<string, number>;
  selected_source_counts?: Record<string, number>;
  confidence?: 'none' | 'low' | 'medium' | 'high';
  insufficient_context?: boolean;
  coverage_note?: string | null;
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
  project_seq?: number | null;
  title: string;
  description?: string;
  status: MilestoneStatus;
  target_date?: string;
  actual_date?: string;
  progress_percentage: number;
  project_id: number;
  created_by?: number;
  owner_id?: number | null;
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
  not_started_count: number;
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
  owner_id?: number | null;
}

export interface MilestoneUpdate {
  title?: string;
  description?: string;
  target_date?: string;
  status?: MilestoneStatus;
  actual_date?: string;
  progress_percentage?: number;
  owner_id?: number | null;
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

// ─── Doc Hub ────────────────────────────────────────────────────────────────

export type DocStatus = 'draft' | 'in_review' | 'published' | 'archived';
export type DocDir = 'ltr' | 'rtl' | 'auto';

export interface DocSpace {
  id: number;
  project_seq?: number | null;
  uuid?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  classification?: string | null;
  icon?: string | null;
  color?: string | null;
  project_id?: number | null;
  order_index: number;
  doc_count: number;
  draft_count: number;
  published_count: number;
  archived_count: number;
  folder_count: number;
  last_doc_updated_at?: string | null;
  created_by: number;
  created_at: string;
  updated_at?: string | null;
}

export interface DocSpaceCreate {
  name: string;
  description?: string | null;
  classification?: string | null;
  icon?: string | null;
  color?: string | null;
  project_id?: number | null;
}

export interface DocSpaceUpdate {
  name?: string;
  description?: string | null;
  classification?: string | null;
  icon?: string | null;
  color?: string | null;
  order_index?: number;
}

export interface DocFolder {
  id: number;
  uuid?: string | null;
  name: string;
  space_id: number;
  parent_folder_id?: number | null;
  order_index: number;
  created_at: string;
  updated_at?: string | null;
}

export interface DocFacetValue {
  value: string;
  count: number;
}

export interface DocFacets {
  tags: DocFacetValue[];
  classifications: DocFacetValue[];
}

export interface DocListPage {
  items: DocListItem[];
  total: number;
}

export interface DocListItem {
  id: number;
  project_seq?: number | null;
  uuid?: string | null;
  title: string;
  slug: string;
  space_id: number;
  folder_id?: number | null;
  project_id?: number | null;
  classification?: string | null;
  status: DocStatus;
  tags?: string | null;
  dir?: DocDir | null;
  language?: string | null;
  excerpt?: string | null;
  current_version: number;
  share_scope: DocShareScope;
  view_count?: number | null;
  last_viewed_at?: string | null;
  my_last_visited_at?: string | null;
  is_pinned: boolean;
  created_by: number;
  updated_by?: number | null;
  created_at: string;
  updated_at?: string | null;
}

export interface Doc {
  id: number;
  project_seq?: number | null;
  uuid?: string | null;
  title: string;
  slug: string;
  content_markdown: string;
  space_id: number;
  folder_id?: number | null;
  project_id?: number | null;
  classification?: string | null;
  status: DocStatus;
  tags?: string | null;
  dir?: DocDir | null;
  language?: string | null;
  current_version: number;
  public_id?: string | null;
  share_scope: DocShareScope;
  share_expires_at?: string | null;
  view_count?: number | null;
  last_viewed_at?: string | null;
  my_last_visited_at?: string | null;
  is_pinned: boolean;
  created_by: number;
  updated_by?: number | null;
  created_at: string;
  updated_at?: string | null;
  can_edit: boolean;
  can_delete: boolean;
  can_share: boolean;
  can_view_stats: boolean;
}

export type DocShareScope = 'private' | 'restricted' | 'public';
export type DocShareGrantType = 'user' | 'role' | 'project';
export type DocShareRole = 'viewer' | 'tester' | 'manager' | 'admin';

export interface DocShareGrant {
  id: number;
  grant_type: DocShareGrantType;
  subject_user_id?: number | null;
  subject_role?: DocShareRole | string | null;
  subject_project_id?: number | null;
  subject_label?: string | null;
  subject_sublabel?: string | null;
  expires_at?: string | null;
  is_expired: boolean;
  created_by?: number | null;
  created_at?: string | null;
}

export interface DocShareGrantCreate {
  grant_type: DocShareGrantType;
  subject_user_id?: number | null;
  subject_role?: DocShareRole | null;
  subject_project_id?: number | null;
  expires_at?: string | null;
}

export interface DocShareAuditEntry {
  id: number;
  action: 'scope_changed' | 'grant_added' | 'grant_removed' | 'accessed' | 'public_accessed' | string;
  detail?: string | null;
  actor_id?: number | null;
  actor_name?: string | null;
  created_at?: string | null;
}

export interface DocShareInfo {
  share_scope: DocShareScope;
  public_id?: string | null;
  share_expires_at?: string | null;
  share_url?: string | null;
  grants: DocShareGrant[];
}

export interface DocPublicView {
  id: number;
  uuid?: string | null;
  title: string;
  slug: string;
  content_markdown: string;
  classification?: string | null;
  tags?: string | null;
  dir?: DocDir | null;
  status: DocStatus;
  current_version: number;
  updated_at?: string | null;
}

export interface DocStats {
  doc_id: number;
  view_count: number;
  unique_visitors: number;
  last_viewed_at?: string | null;
  latest_visits: Array<{ user_id: number; name: string; visit_count: number; last_visited_at?: string | null }>;
}

export interface DocStatsMostViewed {
  id: number;
  project_seq?: number | null;
  title: string;
  space_id: number;
  project_id?: number | null;
  status: DocStatus;
  view_count: number;
  last_viewed_at?: string | null;
}

export interface DocStatsOverview {
  total_docs: number;
  total_views: number;
  unique_visitors: number;
  by_status: Record<string, number>;
  most_viewed: DocStatsMostViewed[];
}

export type DocFeedbackType = 'helpful' | 'not_helpful' | 'clarification' | 'outdated';

export interface DocFeedbackUser {
  id: number;
  username: string;
  full_name?: string | null;
  email?: string | null;
}

export interface DocFeedback {
  id: number;
  doc_id: number;
  user_id: number;
  feedback_type: DocFeedbackType;
  comment?: string | null;
  section_text?: string | null;
  resolved: boolean;
  created_at: string;
  updated_at?: string | null;
  user?: DocFeedbackUser | null;
}

export interface DocFeedbackSummary {
  doc_id: number;
  helpful: number;
  not_helpful: number;
  clarification: number;
  outdated: number;
  unresolved: number;
  my_feedback?: DocFeedback | null;
}

export type DocReviewRoundStatus = 'open' | 'approved' | 'changes_requested' | 'cancelled';
export type DocReviewDecision = 'pending' | 'approved' | 'changes_requested';

export interface DocReviewer {
  id: number;
  reviewer_id: number;
  username?: string | null;
  full_name?: string | null;
  decision: DocReviewDecision;
  comment?: string | null;
  decided_at?: string | null;
}

export interface DocReviewRound {
  id: number;
  doc_id: number;
  status: DocReviewRoundStatus;
  note?: string | null;
  resolution_note?: string | null;
  requested_by: number;
  requested_by_name?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  reviewers: DocReviewer[];
  approved_count: number;
  changes_requested_count: number;
  pending_count: number;
}

export interface DocReviewView {
  doc_id: number;
  doc_status: DocStatus;
  current_round?: DocReviewRound | null;
  history: DocReviewRound[];
  my_decision?: DocReviewDecision | null;
  can_decide: boolean;
  can_manage: boolean;
}

export interface DocRelatedLink {
  id: number;
  doc_id: number;
  related_doc_id: number;
  related_doc_title?: string | null;
  related_doc_project_id?: number | null;
  created_at: string;
}

export interface DocSuggestion {
  id: number;
  uuid?: string | null;
  title: string;
  slug: string;
  space_id: number;
  project_id?: number | null;
  classification?: string | null;
  status: DocStatus;
  tags?: string | null;
  excerpt?: string | null;
  current_version: number;
  score: number;
  matched_tags: string[];
}

export interface DocDuplicateCandidate extends DocSuggestion {
  reasons: string[];
}

export interface DocMergeResult {
  target_doc: Doc;
  archived_source_doc: Doc;
  transferred: Record<string, number>;
  preserved_reference_count: number;
}

export interface DocCreate {
  title: string;
  content_markdown?: string;
  space_id: number;
  folder_id?: number | null;
  classification?: string | null;
  status?: DocStatus;
  tags?: string | null;
  dir?: DocDir;
  language?: string | null;
}

export interface DocUpdate {
  title?: string;
  content_markdown?: string;
  classification?: string | null;
  status?: DocStatus;
  tags?: string | null;
  dir?: DocDir;
  language?: string | null;
  folder_id?: number | null;
  space_id?: number;
  change_note?: string | null;
}

export interface DocVersion {
  id: number;
  doc_id: number;
  version_number: number;
  action: 'created' | 'updated' | 'restored' | 'published' | string;
  title: string;
  content_markdown?: string | null;
  status?: string | null;
  classification?: string | null;
  tags?: string | null;
  change_note?: string | null;
  created_at: string;
  author?: RequirementVersionAuthor | null;
}

export interface DocRequirementLink {
  id: number;
  doc_id: number;
  requirement_id: number;
  requirement_key?: string | null;
  requirement_title?: string | null;
  created_at: string;
}

export interface DocConvertItemOverride {
  index: number;
  title: string;
  include: boolean;
  description_html?: string | null;
  acceptance_html?: string | null;
}

export interface DocConvertExtraItem {
  title: string;
  description_html?: string;
  acceptance_html?: string | null;
}

export interface DocConvertRequest {
  mode: 'single' | 'split';
  heading_level?: number; // 0 = auto-detect
  target_project_id?: number | null;
  folder_id?: number | null;
  default_status?: Requirement['status'];
  default_priority?: Requirement['priority'];
  items?: DocConvertItemOverride[];
  extra_items?: DocConvertExtraItem[];
}

export interface DocConvertPreviewItem {
  index: number;
  title: string;
  description_html: string;
  is_acceptance_criteria: boolean;
  acceptance_html?: string;
}

export interface DocConvertPreview {
  mode: string;
  items: DocConvertPreviewItem[];
}

export interface DocConvertResult {
  created: Requirement[];
  links: DocRequirementLink[];
}

// --- AI conversion enhancement ---

export interface DocConvertEnhanceRequest {
  mode: 'single' | 'split';
  heading_level?: number;
  items?: DocConvertItemOverride[];
}

export interface DocConvertEnhanceItem {
  index: number;
  quality_score: number;
  issues: string[];
  edge_cases: string[];
  suggested_title: string;
  suggested_description_html: string;
  suggested_acceptance_html: string;
}

export interface DocConvertSuggestedRequirement {
  title: string;
  description_html: string;
  acceptance_html: string;
  rationale: string;
}

export interface DocConvertEnhanceResult {
  ai_available: boolean;
  ai_skipped_reason?: string | null;
  summary?: string | null;
  items: DocConvertEnhanceItem[];
  suggested_requirements: DocConvertSuggestedRequirement[];
  provider?: string | null;
  model?: string | null;
}

// --- Change impact analysis ---

export interface DocImpactRequest {
  candidate_markdown?: string | null;
  include_ai?: boolean;
}

export interface DocImpactItem {
  type: 'requirement' | 'test_case' | 'defect';
  id: number;
  key: string;
  title: string;
  reason: 'linked' | 'similar';
  score: number;
  status?: string | null;
  severity?: string | null;
  is_open?: boolean | null;
  via?: string[];
}

export interface DocImpactChangeSummary {
  changed: boolean;
  headings_added: string[];
  headings_removed: string[];
  char_delta: number;
  note: string;
}

export interface DocImpactRiskSignals {
  impacted_requirements: number;
  impacted_test_cases: number;
  impacted_defects: number;
  open_defects: number;
  high_severity_defects: number;
  uncovered_requirements: number;
}

export interface DocImpactRisk {
  area: 'requirements' | 'tests' | 'defects' | 'general';
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  mitigation: string;
}

export interface DocImpactAnalysis {
  doc_id: number;
  project_id?: number | null;
  change_summary: DocImpactChangeSummary;
  requirements: DocImpactItem[];
  test_cases: DocImpactItem[];
  defects: DocImpactItem[];
  risk_signals: DocImpactRiskSignals;
  ai_available: boolean;
  ai_skipped_reason?: string | null;
  ai_summary?: string | null;
  recommendation?: 'publish' | 'review' | 'hold' | null;
  risks: DocImpactRisk[];
  provider?: string | null;
  model?: string | null;
}

// ── Living release notes ─────────────────────────────────────────────────
export type ReleaseNoteStatus = 'draft' | 'published';

export interface ReleaseNotesGenerateRequest {
  project_id: number;
  since?: string | null;
  until?: string | null;
  include_ai?: boolean;
  /** UI language — drives the calendar of dates baked into the draft. */
  lang?: string;
}

export interface ReleaseNotesChangedDoc {
  doc_id: number;
  title: string;
  actions: string[];
  versions: number;
  headings_added: string[];
  last_changed_at?: string | null;
}

export interface ReleaseNotesEntry {
  type: 'requirement' | 'defect';
  id: number;
  key: string;
  title: string;
  status?: string | null;
  severity?: string | null;
  via_docs: string[];
}

export interface ReleaseNotesCoverage {
  requirements_total: number;
  requirements_covered: number;
  requirements_uncovered: number;
  test_cases: number;
  coverage_pct: number;
}

export interface ReleaseNotesSource {
  range_start?: string | null;
  range_end?: string | null;
  changed_docs: ReleaseNotesChangedDoc[];
  requirements: ReleaseNotesEntry[];
  resolved_defects: ReleaseNotesEntry[];
  open_defects: ReleaseNotesEntry[];
  coverage: ReleaseNotesCoverage;
}

export interface ReleaseNotesPreview {
  project_id: number;
  title: string;
  content_markdown: string;
  summary?: string | null;
  source: ReleaseNotesSource;
  ai_available: boolean;
  ai_skipped_reason?: string | null;
  provider?: string | null;
  model?: string | null;
}

export interface ReleaseNoteUser {
  id: number;
  username: string;
  full_name?: string | null;
}

export interface ReleaseNote {
  id: number;
  uuid?: string | null;
  project_id: number;
  title: string;
  version?: string | null;
  status: ReleaseNoteStatus;
  content_markdown: string;
  summary?: string | null;
  range_start?: string | null;
  range_end?: string | null;
  source_data?: ReleaseNotesSource | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  creator?: ReleaseNoteUser | null;
  editor?: ReleaseNoteUser | null;
  publisher?: ReleaseNoteUser | null;
}

export interface ReleaseNoteListItem {
  id: number;
  project_id: number;
  title: string;
  version?: string | null;
  status: ReleaseNoteStatus;
  summary?: string | null;
  range_start?: string | null;
  range_end?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ReleaseNoteCreate {
  project_id: number;
  title: string;
  version?: string | null;
  content_markdown?: string;
  summary?: string | null;
  range_start?: string | null;
  range_end?: string | null;
  source_data?: ReleaseNotesSource | null;
}

export interface ReleaseNoteUpdate {
  title?: string;
  version?: string | null;
  content_markdown?: string;
  summary?: string | null;
}
