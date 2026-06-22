import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

export const testManagementAPI = {
  getStatistics: async (projectId?: number) => {
    const params = projectId ? `?project_id=${projectId}` : '';
    const response = await api.get(`/test-management/statistics${params}`);
    return response.data;
  },
  getUserNotificationPreferences: async () => {
    const response = await api.get('/users/me/notification-preferences');
    return response.data;
  },
  updateUserNotificationPreferences: async (prefs: any) => {
    const response = await api.put('/users/me/notification-preferences', prefs);
    return response.data;
  },
  getSharedStepTemplates: async (skip = 0, limit = 100, projectId?: number) => {
    const response = await api.get(`/shared-step-templates/?skip=${skip}&limit=${limit}${projectId ? `&project_id=${projectId}` : ''}`);
    return response.data;
  },
  getSharedStepTemplate: async (templateId: number) => {
    const response = await api.get(`/shared-step-templates/${templateId}`);
    return response.data;
  },
  createSharedStepTemplate: async (template: any) => {
    const response = await api.post('/shared-step-templates/', template);
    return response.data;
  },
  updateSharedStepTemplate: async (templateId: number, template: any) => {
    const response = await api.put(`/shared-step-templates/${templateId}`, template);
    return response.data;
  },
  deleteSharedStepTemplate: async (templateId: number) => {
    const response = await api.delete(`/shared-step-templates/${templateId}`);
    return response.data;
  },
  getTestExecutionSettings: async () => {
    const response = await api.get('/test-execution-settings');
    return response.data;
  },
  updateTestExecutionSettings: async (settingsId: number, settings: any) => {
    const response = await api.put(`/test-execution-settings/${settingsId}`, settings);
    return response.data;
  },
  getNotificationSettings: async () => {
    const response = await api.get('/notification-settings');
    return response.data;
  },
  updateNotificationSettings: async (settingsId: number, settings: any) => {
    const response = await api.put(`/notification-settings/${settingsId}`, settings);
    return response.data;
  },
  getAutomationSettings: async () => {
    const response = await api.get('/automation-settings');
    return response.data;
  },
  updateAutomationSettings: async (settingsId: number, settings: any) => {
    const response = await api.put(`/automation-settings/${settingsId}`, settings);
    return response.data;
  },
};

let testTypesRequest: Promise<any> | null = null;

// Enums API
export const enumsAPI = {
  getPriorities: async (projectId?: number) => {
    const response = await api.get('/enums/priorities' + (projectId ? `?project_id=${projectId}` : ''));
    return response.data;
  },
  getTestTypes: async (projectId?: number) => {
    // Per-project lists are fetched fresh; only the global list is cached.
    if (projectId) {
      const response = await api.get(`/enums/test-types?project_id=${projectId}`);
      return response.data;
    }
    if (!testTypesRequest) {
      testTypesRequest = api.get('/enums/test-types')
        .then((response) => response.data)
        .catch((error) => {
          testTypesRequest = null;
          throw error;
        });
    }

    return testTypesRequest;
  },
};

export const sharedStepsAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100, signal?: AbortSignal): Promise<SharedStep[]> => {
    const response = await api.get('/shared-steps/', {
      params: {
        ...(projectId ? { project_id: projectId } : {}),
        skip,
        limit,
      },
      signal,
    });
    return response.data;
  },
  create: async (sharedStep: SharedStepCreate): Promise<SharedStep> => {
    const response = await api.post('/shared-steps/', sharedStep);
    return response.data;
  },
  update: async (stepId: number, sharedStep: SharedStepUpdate): Promise<SharedStep> => {
    const response = await api.put(`/shared-steps/${stepId}`, sharedStep);
    return response.data;
  },
  delete: async (stepId: number): Promise<void> => {
    await api.delete(`/shared-steps/${stepId}`);
  },
  incrementUsage: async (stepId: number): Promise<{ message: string; usage_count: number }> => {
    const response = await api.post(`/shared-steps/${stepId}/increment-usage`);
    return response.data;
  },
};


// Test Plans API
export const testPlansAPI = {
  getAll: async (
    projectId?: number,
    options: {
      milestoneId?: number;
      status?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
      skip?: number;
      limit?: number;
    } = {}
  ) => {
    const { milestoneId, status, search, sortBy = 'created_at', sortOrder = 'desc', skip = 0, limit = 100 } = options;
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString(), sort_by: sortBy, sort_order: sortOrder });
    if (projectId) params.append('project_id', projectId.toString());
    if (milestoneId) params.append('milestone_id', milestoneId.toString());
    if (status) params.append('status', status);
    if (search) params.append('search', search);
    const response = await api.get(`/test-plans?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/test-plans/${id}`);
    return response.data;
  },
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'test-plans', seq);
    const response = await api.get(`/test-plans/${id}`);
    return response.data;
  },
  create: async (testPlan: any) => {
    const response = await api.post('/test-plans', testPlan);
    return response.data;
  },
  update: async (id: number, testPlan: any) => {
    const response = await api.put(`/test-plans/${id}`, testPlan);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/test-plans/${id}`);
    return response.data;
  },
  getRequirements: async (
    id: number,
    filters: { search?: string; linked?: boolean; skip?: number; limit?: number } = {},
  ) => {
    const params = new URLSearchParams({
      skip: String(filters.skip ?? 0),
      limit: String(filters.limit ?? 50),
    });
    if (filters.search) params.append('search', filters.search);
    if (filters.linked !== undefined) params.append('linked', String(filters.linked));
    const response = await api.get(`/test-plans/${id}/requirements?${params}`);
    return response.data;
  },
  bulkUpdateRequirements: async (
    id: number,
    payload: { requirement_ids: number[]; action: 'link' | 'unlink' },
  ) => {
    const response = await api.post(`/test-plans/${id}/requirements/bulk`, payload);
    return response.data;
  },
};

// --- Advanced Search (TQL across entities) ---------------------------------

export interface AdvancedSearchField {
  name: string;
  kind: 'text' | 'enum' | 'keyword' | 'user' | 'date' | 'number';
  operators: string[];
  sortable: boolean;
  choices: string[];
  suggest: boolean;
  multivalue: boolean;
}

export interface AdvancedSearchEntity {
  key: string;
  label: string;
  fields: AdvancedSearchField[];
}

export interface AdvancedSearchResult {
  entity: string;
  label: string;
  total: number;
  count: number;
  offset: number;
  limit: number;
  results: Array<Record<string, any>>;
}

export interface SavedSearch {
  id: number;
  name: string;
  entity: string;
  tql: string;
  is_shared: boolean;
  is_owner: boolean;
}

export interface TqlBuildResult {
  entity: string;
  tql: string;
  explanation: string;
  valid: boolean;
  validation_error: string | null;
  provider: string;
  model: string;
}

export const advancedSearchAPI = {
  getEntities: async (projectId: number): Promise<{ entities: AdvancedSearchEntity[] }> => {
    const response = await api.get(`/advanced-search/entities?project_id=${projectId}`);
    return response.data;
  },
  search: async (
    projectId: number,
    entity: string,
    tql: string,
    limit = 50,
    offset = 0,
  ): Promise<AdvancedSearchResult> => {
    const params = new URLSearchParams({
      project_id: projectId.toString(),
      entity,
      limit: limit.toString(),
      offset: offset.toString(),
      // Send the browser's UTC offset so bare date literals in the query are
      // interpreted in the user's timezone (matching the locally-displayed dates).
      tz_offset: new Date().getTimezoneOffset().toString(),
    });
    if (tql.trim()) params.append('tql', tql.trim());
    const response = await api.get(`/advanced-search?${params}`);
    return response.data;
  },
  // Turn a plain-language question into a TQL query via the AI provider. The AI
  // also auto-detects the best-matching entity unless `entity` is passed to pin one.
  aiBuild: async (
    projectId: number,
    question: string,
    entity?: string,
  ): Promise<TqlBuildResult> => {
    const response = await api.post('/advanced-search/ai-build', {
      project_id: projectId,
      question,
      ...(entity ? { entity } : {}),
    });
    return response.data;
  },
  // Distinct existing values of a field, for value autocomplete (e.g. tags).
  fieldValues: async (
    projectId: number,
    entity: string,
    field: string,
    q: string,
  ): Promise<string[]> => {
    const params = new URLSearchParams({
      project_id: projectId.toString(),
      entity,
      field,
      q,
    });
    const response = await api.get(`/advanced-search/values?${params}`);
    return response.data.values ?? [];
  },
  listSaved: async (projectId: number): Promise<SavedSearch[]> => {
    const response = await api.get('/advanced-search/saved', { params: { project_id: projectId } });
    return response.data.saved ?? [];
  },
  saveSearch: async (
    projectId: number,
    name: string,
    entity: string,
    tql: string,
    isShared = false,
  ): Promise<SavedSearch> => {
    const response = await api.post('/advanced-search/saved', {
      project_id: projectId,
      name,
      entity,
      tql,
      is_shared: isShared,
    });
    return response.data;
  },
  deleteSaved: async (id: number): Promise<void> => {
    await api.delete(`/advanced-search/saved/${id}`);
  },
  // Triggers a CSV download of all matching rows (capped server-side).
  exportCsv: async (projectId: number, entity: string, tql: string): Promise<void> => {
    const params = new URLSearchParams({
      project_id: projectId.toString(),
      entity,
      tz_offset: new Date().getTimezoneOffset().toString(),
    });
    if (tql.trim()) params.append('tql', tql.trim());
    const response = await api.get(`/advanced-search/export?${params}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${entity}-search.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

// --- Notification category preferences (per-user mute grid) -----------------
// Phase 8: a Settings grid that lets each user mute individual notification
// categories. Distinct from the legacy /notification-settings (project email/
// slack toggles) and the do-not-disturb /users/me/notification-preferences.

export interface NotificationCategoryInfo {
  key: string;
  label: string;
  actionable: boolean;
  in_app: boolean;
  email: boolean;
}

export const notificationCategoryPrefsAPI = {
  get: async (): Promise<NotificationCategoryInfo[]> => {
    const response = await api.get('/notification-preferences');
    return response.data.categories as NotificationCategoryInfo[];
  },
  update: async (
    preferences: Array<{ category: string; in_app: boolean; email: boolean }>
  ): Promise<NotificationCategoryInfo[]> => {
    const response = await api.put('/notification-preferences', { preferences });
    return response.data.categories as NotificationCategoryInfo[];
  },
};

// --- Admin announcements (Phase 7) -----------------------------------------
// Admin-only broadcast emitted as a bell-only SYSTEM notification.

export interface AnnouncementResult {
  message: string;
  audience: string;
  project_id: number | null;
  notified_count: number;
}

export const announcementsAPI = {
  send: async (payload: {
    title: string;
    message: string;
    audience: 'all' | 'project';
    project_id?: number;
  }): Promise<AnnouncementResult> => {
    const response = await api.post('/admin/announcements', payload);
    return response.data;
  },
};
