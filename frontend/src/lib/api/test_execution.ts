import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

// Normalized, project-scoped test-case tags.
export const tagsAPI = {
  getAll: async (projectId: number) => {
    const response = await api.get(`/tags?project_id=${projectId}`);
    return response.data;
  },
  create: async (tag: { project_id: number; name: string; color?: string; description?: string }) => {
    const response = await api.post('/tags', tag);
    return response.data;
  },
  update: async (id: number, tag: { name?: string; color?: string; description?: string; is_active?: boolean }) => {
    const response = await api.put(`/tags/${id}`, tag);
    return response.data;
  },
  remove: async (id: number) => {
    const response = await api.delete(`/tags/${id}`);
    return response.data;
  },
  merge: async (id: number, targetId: number) => {
    const response = await api.post(`/tags/${id}/merge`, { target_id: targetId });
    return response.data;
  },
};

export const testCasesAPI = {
  getAll: async (projectId?: number, testSuiteId?: number, sectionId?: number, sortBy = 'id', sortOrder = 'asc', skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString(), sort_by: sortBy, sort_order: sortOrder });
    if (projectId) params.append('project_id', projectId.toString());
    if (testSuiteId) params.append('test_suite_id', testSuiteId.toString());
    if (sectionId) params.append('section_id', sectionId.toString());
    const response = await api.get(`/test-cases?${params}`);
    return response.data;
  },
  getById: async (id: number, options: { includeLinkedRequirements?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.includeLinkedRequirements !== undefined) {
      params.append('include_linked_requirements', String(options.includeLinkedRequirements));
    }
    const query = params.toString();
    const response = await api.get(`/test-cases/${id}${query ? `?${query}` : ''}`);
    return response.data;
  },
  create: async (testCase: any) => {
    const response = await api.post('/test-cases', testCase);
    return response.data;
  },
  update: async (id: number, testCase: any) => {
    const response = await api.put(`/test-cases/${id}`, testCase);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/test-cases/${id}`);
    return response.data;
  },
  getCount: async (projectId?: number, testSuiteId?: number, sectionId?: number) => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId.toString());
    if (testSuiteId) params.append('test_suite_id', testSuiteId.toString());
    if (sectionId) params.append('section_id', sectionId.toString());
    const response = await api.get(`/test-cases/count?${params}`);
    return response.data;
  },
  getSteps: async (id: number) => {
    const response = await api.get(`/test-cases/${id}/steps`);
    return response.data;
  },
  getExecutionHistory: async (id: number, limit: number = 50) => {
    const response = await api.get(`/test-cases/${id}/execution-history?limit=${limit}`);
    return response.data;
  },
  createWithSteps: async (testCaseId: number, steps: any[]) => {
    const stepsWithTestCaseId = steps.map(step => ({
      ...step,
      test_case_id: testCaseId
    }));
    const response = await api.post(`/test-cases/${testCaseId}/steps`, stepsWithTestCaseId);
    return response.data;
  },
  assist: async (
    testCaseId: number,
    payload: {
      action: 'suggest_steps' | 'improve_expected_result' | 'add_negative_cases' | 'convert_to_gherkin' | 'split_broad_case';
      instructions?: string;
    }
  ) => {
    const response = await api.post(`/test-cases/${testCaseId}/ai/assist`, payload);
    return response.data;
  },
  assistDraft: async (payload: any) => {
    const response = await api.post('/test-cases/ai/assist', payload);
    return response.data;
  },
};


// Test Runs API
export interface TestRunFilters {
  search?: string;
  status?: string;
  priority?: string;
  assigned_to?: number;
  test_plan_id?: number;
  milestone_id?: number;
  environment_id?: number;
}

export const testRunsAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100, filters: TestRunFilters = {}) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    if (filters.search?.trim()) params.append('search', filters.search.trim());
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.priority && filters.priority !== 'all') params.append('priority', filters.priority);
    if (filters.assigned_to) params.append('assigned_to', filters.assigned_to.toString());
    if (filters.test_plan_id) params.append('test_plan_id', filters.test_plan_id.toString());
    if (filters.milestone_id) params.append('milestone_id', filters.milestone_id.toString());
    if (filters.environment_id) params.append('environment_id', filters.environment_id.toString());
    const response = await api.get(`/test-runs?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/test-runs/${id}`);
    return response.data;
  },
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'test-runs', seq);
    const response = await api.get(`/test-runs/${id}`);
    return response.data;
  },
  create: async (testRun: any) => {
    const response = await api.post('/test-runs', testRun);
    return response.data;
  },
  update: async (id: number, testRun: any) => {
    const response = await api.put(`/test-runs/${id}`, testRun);
    return response.data;
  },
  assign: async (id: number, assignedTo?: number | null) => {
    const response = await api.put(`/test-runs/${id}/assign`, { assigned_to: assignedTo ?? null });
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/test-runs/${id}`);
    return response.data;
  },
  resetTime: async (id: number) => {
    const response = await api.put(`/test-runs/${id}/reset-time`);
    return response.data;
  },
  getDefectCoverage: async (id: number) => {
    const response = await api.get(`/test-runs/${id}/defect-coverage`);
    return response.data;
  },
  getFlakiness: async (id: number) => {
    const response = await api.get(`/test-runs/${id}/flakiness`);
    return response.data;
  },
  getEnvironment: async (id: number) => {
    const response = await api.get(`/test-runs/${id}/environment`);
    return response.data;
  },
  importResults: async (
    id: number,
    file: File,
    options: { format?: 'junit' | 'ctrf'; autoCreate?: boolean } = {},
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options.format) formData.append('format', options.format);
    if (options.autoCreate) formData.append('auto_create', 'true');
    const response = await api.post(`/test-runs/${id}/import-results`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

// Environment Matrix Runs API — same case selection executed across N environments
export const matrixRunsAPI = {
  getAll: async (projectId: number, skip = 0, limit = 100, search?: string) => {
    const params = new URLSearchParams({
      project_id: projectId.toString(),
      skip: skip.toString(),
      limit: limit.toString(),
    });
    if (search?.trim()) params.append('search', search.trim());
    const response = await api.get(`/matrix-runs?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/matrix-runs/${id}`);
    return response.data;
  },
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'matrix-runs', seq);
    const response = await api.get(`/matrix-runs/${id}`);
    return response.data;
  },
  create: async (matrixRun: {
    project_id: number;
    name: string;
    description?: string;
    environment_ids: number[];
    test_case_ids: number[];
    test_plan_id?: number;
    milestone_id?: number;
    assigned_to?: number;
    priority?: string;
    estimated_duration?: number;
  }) => {
    const response = await api.post('/matrix-runs', matrixRun);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/matrix-runs/${id}`);
    return response.data;
  },
};

// Test Execution Settings API
export const executionSettingsAPI = {
  get: async (projectId?: number) => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId.toString());
    const query = params.toString();
    const response = await api.get(`/test-execution-settings${query ? `?${query}` : ''}`);
    return response.data;
  },
};

// Test Results API
export const testResultsAPI = {
  getAll: async (testRunId?: number, testCaseId?: number, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (testRunId) params.append('test_run_id', testRunId.toString());
    if (testCaseId) params.append('test_case_id', testCaseId.toString());
    const response = await api.get(`/test-results?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/test-results/${id}`);
    return response.data;
  },
  create: async (testResult: any) => {
    const response = await api.post('/test-results', testResult);
    return response.data;
  },
  update: async (id: number, testResult: any) => {
    const response = await api.put(`/test-results/${id}`, testResult);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/test-results/${id}`);
    return response.data;
  },
  resetTime: async (id: number) => {
    const response = await api.put(`/test-results/${id}/reset-time`);
    return response.data;
  },
  pause: async (id: number) => {
    const response = await api.put(`/test-results/${id}/pause`);
    return response.data;
  },
  resume: async (id: number) => {
    const response = await api.put(`/test-results/${id}/resume`);
    return response.data;
  },
  addTime: async (id: number, hours: number) => {
    const response = await api.put(`/test-results/${id}/add-time`, { hours });
    return response.data;
  },
  // Per-step pass/fail outcomes for a result
  getStepResults: async (id: number) => {
    const response = await api.get(`/test-results/${id}/step-results`);
    return response.data;
  },
  saveStepResults: async (id: number, stepResults: Array<{
    step_number: number;
    step_name: string;
    step_status: string;
    step_duration?: number;
    error_message?: string | null;
  }>) => {
    const response = await api.put(`/test-results/${id}/step-results`, stepResults);
    return response.data;
  },
  // Defect links for a specific execution result
  getDefectLinks: async (id: number) => {
    const response = await api.get(`/test-results/${id}/defect-links`);
    return response.data;
  },
  linkDefect: async (id: number, payload: {
    defect_id?: number;
    link_type?: string;
    new_defect?: any;
    failing_step?: {
      step_id?: number;
      step_number?: number;
      status?: string;
      actual_result?: string;
      notes?: string;
    };
  }) => {
    const response = await api.post(`/test-results/${id}/defect-links`, payload);
    return response.data;
  },
  unlinkDefect: async (id: number, linkId: number) => {
    const response = await api.delete(`/test-results/${id}/defect-links/${linkId}`);
    return response.data;
  },
  updateDefectLinkSnapshot: async (id: number, linkId: number, payload: {
    failing_step?: {
      step_id?: number;
      step_number?: number;
      status?: string;
      actual_result?: string;
      notes?: string;
    };
    clear_failing_step?: boolean;
  }) => {
    const response = await api.put(`/test-results/${id}/defect-links/${linkId}/snapshot`, payload);
    return response.data;
  },
};
