import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, TestAssetDebtDetectionResult, TestAssetHealthSummary, TestDebtItem, TestDebtAction, TestDebtSeverity, TestDebtType, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

// Projects API
type ProjectStatusFilter = 'active' | 'inactive' | 'archived';

export const projectsAPI = {
  getAll: async (
    skip = 0,
    limit = 100,
    filters: { status?: ProjectStatusFilter; includeArchived?: boolean } = {}
  ) => {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });
    if (filters.status) params.append('status', filters.status);
    if (filters.includeArchived !== undefined) params.append('include_archived', String(filters.includeArchived));

    const response = await api.get(`/projects?${params}`);
    return response.data;
  },
  getById: async (id: number, signal?: AbortSignal) => {
    const response = await api.get(`/projects/${id}`, { signal });
    return response.data;
  },
  create: async (project: any) => {
    const response = await api.post('/projects', project);
    return response.data;
  },
  update: async (id: number, project: any) => {
    const response = await api.put(`/projects/${id}`, project);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/projects/${id}`);
    return response.data;
  },
  clone: async (id: number, payload: { name?: string; description?: string; owner_id?: number }) => {
    const response = await api.post(`/projects/${id}/clone`, payload);
    return response.data;
  },
  getFeatures: async (id: number): Promise<{ features: Record<string, boolean>; catalog: string[] }> => {
    const response = await api.get(`/projects/${id}/features`);
    return response.data;
  },
  updateFeatures: async (id: number, features: Record<string, boolean>) => {
    const response = await api.put(`/projects/${id}/features`, { features });
    return response.data;
  },
};

// Test Suites API
export const testSuitesAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    const response = await api.get(`/test-suites?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/test-suites/${id}`);
    return response.data;
  },
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'test-suites', seq);
    const response = await api.get(`/test-suites/${id}`);
    return response.data;
  },
  create: async (testSuite: any) => {
    const response = await api.post('/test-suites', testSuite);
    return response.data;
  },
  update: async (id: number, testSuite: any) => {
    const response = await api.put(`/test-suites/${id}`, testSuite);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/test-suites/${id}`);
    return response.data;
  },
  createRun: async (id: number, testRun: any) => {
    const response = await api.post(`/test-suites/${id}/test-runs`, testRun);
    return response.data;
  },
};

// Sections API
export const sectionsAPI = {
  getAll: async (testSuiteId?: number, parentSectionId?: number, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (testSuiteId) params.append('test_suite_id', testSuiteId.toString());
    if (parentSectionId) params.append('parent_section_id', parentSectionId.toString());
    const response = await api.get(`/test-case-sections?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/test-case-sections/${id}`);
    return response.data;
  },
  create: async (section: any) => {
    const response = await api.post('/test-case-sections', section);
    return response.data;
  },
  update: async (id: number, section: any) => {
    const response = await api.put(`/test-case-sections/${id}`, section);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/test-case-sections/${id}`);
    return response.data;
  },
  getProjectSectionHierarchy: async (projectId: number) => {
    const response = await api.get(`/projects/${projectId}/sections/hierarchy`);
    return response.data;
  },
  getByProject: async (projectId: number, skip = 0, limit = 500) => {
    const params = new URLSearchParams({
      project_id: projectId.toString(),
      skip: skip.toString(),
      limit: limit.toString(),
    });
    const response = await api.get(`/sections/?${params}`);
    return response.data;
  },
  getSectionDetails: async (sectionId: number) => {
    const response = await api.get(`/sections/${sectionId}/details`);
    return response.data;
  },
};

export const testAssetHealthAPI = {
  getSummary: async (projectId: number): Promise<TestAssetHealthSummary> => {
    const response = await api.get(`/projects/${projectId}/test-asset-health/summary`);
    return response.data;
  },
  listDebtItems: async (
    projectId: number,
    filters: { debt_type?: TestDebtType | 'all'; severity?: TestDebtSeverity | 'all'; resolved?: 'active' | 'resolved' | 'all'; skip?: number; limit?: number } = {},
  ): Promise<{ items: TestDebtItem[]; total: number }> => {
    const params = new URLSearchParams({
      skip: String(filters.skip ?? 0),
      limit: String(filters.limit ?? 25),
      resolved: filters.resolved || 'active',
    });
    if (filters.debt_type && filters.debt_type !== 'all') params.append('debt_type', filters.debt_type);
    if (filters.severity && filters.severity !== 'all') params.append('severity', filters.severity);
    const response = await api.get(`/projects/${projectId}/test-asset-health/debt-items?${params}`);
    return {
      items: response.data,
      total: parseInt(response.headers['x-total-count'] ?? '0', 10),
    };
  },
  detect: async (projectId: number): Promise<TestAssetDebtDetectionResult> => {
    const response = await api.post(`/projects/${projectId}/test-asset-health/detect`);
    return response.data;
  },
  resolve: async (projectId: number, itemId: number): Promise<TestDebtItem> => {
    const response = await api.post(`/projects/${projectId}/test-asset-health/debt-items/${itemId}/resolve`);
    return response.data;
  },
  update: async (
    projectId: number,
    itemId: number,
    payload: Partial<{ severity: TestDebtSeverity; suggested_action: TestDebtAction; details: string | null; resolved_at: string | null }>,
  ): Promise<TestDebtItem> => {
    const response = await api.patch(`/projects/${projectId}/test-asset-health/debt-items/${itemId}`, payload);
    return response.data;
  },
  create: async (
    projectId: number,
    payload: { test_case_id: number; debt_type: TestDebtType; severity: TestDebtSeverity; suggested_action: TestDebtAction; details?: string | null },
  ): Promise<TestDebtItem> => {
    const response = await api.post(`/projects/${projectId}/test-asset-health/debt-items`, payload);
    return response.data;
  },
};

// Requirements API
