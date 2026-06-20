import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

export const projectAssignmentsAPI = {
  listMembers: async (projectId: number) => {
    const response = await api.get(`/projects/${projectId}/members`);
    return response.data;
  },
  add: async (projectId: number, userId: number, role: string) => {
    const response = await api.post('/project-assignments', {
      project_id: projectId,
      user_id: userId,
      role,
    });
    return response.data;
  },
  updateRole: async (assignmentId: number, role: string) => {
    const response = await api.put(`/project-assignments/${assignmentId}`, { role });
    return response.data;
  },
  remove: async (assignmentId: number) => {
    const response = await api.delete(`/project-assignments/${assignmentId}`);
    return response.data;
  },
};

// Defects API
export const defectsAPI = {
  getAll: async (
    projectId?: number,
    skip = 0,
    limit = 100,
    filters: { search?: string; status?: string; milestoneId?: number } = {},
  ) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    if (filters.search?.trim()) params.append('search', filters.search.trim());
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.milestoneId) params.append('milestone_id', filters.milestoneId.toString());
    const response = await api.get(`/defects?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/defects/${id}`);
    return response.data;
  },
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'defects', seq);
    const response = await api.get(`/defects/${id}`);
    return response.data;
  },
  getDetail: async (id: number, signal?: AbortSignal) => {
    const response = await api.get(`/defects/${id}/detail`, { signal });
    return response.data;
  },
  create: async (defect: any) => {
    const response = await api.post('/defects', defect);
    return response.data;
  },
  update: async (id: number, defect: any) => {
    const response = await api.put(`/defects/${id}`, defect);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/defects/${id}`);
    return response.data;
  },
  getResultLinks: async (id: number) => {
    const response = await api.get(`/defects/${id}/result-links`);
    return response.data;
  },
};

// Milestones API
export const milestonesAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    const response = await api.get(`/milestones?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/milestones/${id}`);
    return response.data;
  },
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'milestones', seq);
    const response = await api.get(`/milestones/${id}`);
    return response.data;
  },
  create: async (milestone: any) => {
    const response = await api.post('/milestones', milestone);
    return response.data;
  },
  update: async (id: number, milestone: any) => {
    const response = await api.put(`/milestones/${id}`, milestone);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/milestones/${id}`);
    return response.data;
  },
  getStats: async (projectId: number) => {
    const response = await api.get(`/milestones/stats/${projectId}`);
    return response.data;
  },
  getRuns: async (id: number) => {
    const response = await api.get(`/milestones/${id}/runs`);
    return response.data;
  },
};

// Environments API
export const environmentsAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    const response = await api.get(`/environments?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/environments/${id}`);
    return response.data;
  },
  create: async (environment: any) => {
    const response = await api.post('/environments', environment);
    return response.data;
  },
  update: async (id: number, environment: any) => {
    const response = await api.put(`/environments/${id}`, environment);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/environments/${id}`);
    return response.data;
  },
};

const traceabilityMatrixRequests = new Map<string, Promise<any>>();

// Analytics API
export const analyticsAPI = {
  getDashboardStatistics: async (projectId?: number, signal?: AbortSignal) => {
    const params = projectId ? `?project_id=${projectId}` : '';
    const response = await api.get(`/dashboard/statistics${params}`, { signal });
    return response.data;
  },
  getDashboard: async (projectId?: number) => {
    const response = await api.post(`/analytics/dashboard`, { project_id: projectId });
    return response.data;
  },
  getKPIs: async (projectId?: number) => {
    const params = projectId ? `?project_id=${projectId}` : '';
    const response = await api.get(`/analytics/kpis${params}`);
    return response.data;
  },
  getDashboardAnalytics: async (projectId: number, timeRange: string) => {
    const params = `?project_id=${projectId}&time_range=${timeRange}`;
    const response = await api.get(`/analytics/dashboard/analytics${params}`);
    return response.data;
  },
  getAnalyticsTimeSeries: async (projectId: number, timeRange: string, granularity = "day") => {
    const response = await api.get("/analytics/time-series", {
      params: { project_id: projectId, time_range: timeRange, granularity },
    });
    return response.data;
  },
  getGranularInsights: async (params: { project_id: number; filter_type: string; time_range?: string }) => {
    const response = await api.get(`/analytics/granular-insights`, { params });
    return response.data;
  },
  getShareableReports: async (projectId: number) => {
    const response = await api.get(`/analytics/shareable-reports/${projectId}`);
    return response.data;
  },
  createShareableReport: async (report: any) => {
    const response = await api.post('/analytics/shareable-reports', report);
    return response.data;
  },
  previewShareableReport: async (reportId: number) => {
    const response = await api.get(`/analytics/shareable-reports/${reportId}/preview`);
    return response.data;
  },
  downloadShareableReport: async (reportId: number, format: 'json' | 'csv' = 'json') => {
    const response = await api.get(`/analytics/shareable-reports/${reportId}/download`, {
      params: { format },
      responseType: format === 'csv' ? 'blob' : 'json',
    });
    return response.data;
  },
  regenerateShareableReport: async (reportId: number) => {
    const response = await api.post(`/analytics/shareable-reports/${reportId}/regenerate`);
    return response.data;
  },
  revokeShareableReport: async (reportId: number) => {
    const response = await api.delete(`/analytics/shareable-reports/${reportId}`);
    return response.data;
  },
  // Dashboard widget persistence — used so layout syncs across devices for a user.
  getDashboardWidgets: async (projectId: number) => {
    const response = await api.get(`/analytics/dashboard-widgets/${projectId}`);
    return response.data;
  },
  createDashboardWidget: async (widget: any) => {
    const response = await api.post('/analytics/dashboard-widgets', widget);
    return response.data;
  },
  updateDashboardWidget: async (widgetId: number, widget: any) => {
    const response = await api.put(`/analytics/dashboard-widgets/${widgetId}`, widget);
    return response.data;
  },
  getRootCauseAnalyses: async (
    projectId: number,
    filters: { defectId?: number; requirementId?: number; testCaseId?: number; status?: string } = {},
  ) => {
    const params = new URLSearchParams({ project_id: String(projectId) });
    if (filters.defectId) params.append('defect_id', String(filters.defectId));
    if (filters.requirementId) params.append('requirement_id', String(filters.requirementId));
    if (filters.testCaseId) params.append('test_case_id', String(filters.testCaseId));
    if (filters.status) params.append('status', filters.status);
    const response = await api.get(`/analytics/root-cause-analyses?${params}`);
    return response.data;
  },
  createRootCauseAnalysis: async (analysis: any) => {
    const response = await api.post('/analytics/root-cause-analysis', analysis);
    return response.data;
  },
  updateRootCauseAnalysis: async (analysisId: number, analysis: any) => {
    const response = await api.put(`/analytics/root-cause-analysis/${analysisId}`, analysis);
    return response.data;
  },
  deleteRootCauseAnalysis: async (analysisId: number) => {
    const response = await api.delete(`/analytics/root-cause-analysis/${analysisId}`);
    return response.data;
  },
  // Public viewer — works without authentication (the share token gates access).
  getSharedReport: async (shareToken: string) => {
    const response = await api.get(`/analytics/shareable-reports/shared/${shareToken}`);
    return response.data;
  },
  getTraceabilityMatrix: async (
    projectId: number,
    filters?: { priority?: string; coverage_status?: string; test_status?: string; search?: string; skip?: number; limit?: number },
  ) => {
    const params: Record<string, string> = { project_id: String(projectId) };
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = String(value);
        }
      });
    }
    const requestKey = JSON.stringify(params);
    const existingRequest = traceabilityMatrixRequests.get(requestKey);
    if (existingRequest) return existingRequest;

    const request = api
      .get(`/analytics/traceability-matrix`, { params })
      .then((response) => response.data)
      .finally(() => {
        traceabilityMatrixRequests.delete(requestKey);
      });
    traceabilityMatrixRequests.set(requestKey, request);
    return request;
  },
  getCoverageReports: async (projectId: number) => {
    const response = await api.get(`/analytics/coverage-reports?project_id=${projectId}`);
    return response.data;
  },
  generateCoverageReport: async (projectId: number) => {
    const response = await api.post(`/analytics/coverage-reports/generate`, { project_id: projectId });
    return response.data;
  },
  getTestExecutionStatus: async (projectId: number) => {
    const response = await api.get(`/analytics/test-execution-status?project_id=${projectId}`);
    return response.data;
  },
  getTestActivity: async (projectId: number, startDate: string, endDate: string, granularity: string) => {
    const params = `?project_id=${projectId}&start_date=${startDate}&end_date=${endDate}&granularity=${granularity}`;
    const response = await api.get(`/analytics/test-activity${params}`);
    return response.data;
  },
};

// Audit API
export const auditAPI = {
  getAuditTrails: async (filters?: AuditTrailFilters, signal?: AbortSignal): Promise<AuditTrailList> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }
    const response = await api.get(`/audit-trails?${params}`, { signal });
    return response.data;
  },
  getAll: async (filters?: any, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ offset: skip.toString(), limit: limit.toString() });
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }
    const response = await api.get(`/audit-trails?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/audit-trails/${id}`);
    return response.data;
  },
  getProjectActivitySummary: async (projectId: number, days: number) => {
    const response = await api.get(`/audit-trails/project/${projectId}/summary?days=${days}`);
    return response.data;
  },
  getProjectAuditCounts: async (): Promise<Record<string, number>> => {
    const response = await api.get('/audit-trails/project-counts');
    return response.data ?? {};
  },
  deleteProjectAuditTrails: async (projectId: number): Promise<{ message: string; deleted: number }> => {
    const response = await api.delete(`/audit-trails/project/${projectId}`);
    return response.data;
  },
};
