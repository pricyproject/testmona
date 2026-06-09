import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

export const usersAPI = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await api.get(`/users?skip=${skip}&limit=${limit}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/users/${id}`);
    return response.data;
  },
  create: async (user: any) => {
    const response = await api.post('/users', user);
    return response.data;
  },
  update: async (id: number, user: any) => {
    const response = await api.put(`/users/${id}`, user);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },
  resetTwoFactor: async (id: number) => {
    const response = await api.post(`/users/${id}/2fa/reset`);
    return response.data;
  },
};

// Saved filters
export type SavedFilterScope = 'test_cases' | 'defects' | 'requirements';

export interface SavedFilter {
  id: number;
  user_id: number;
  project_id: number;
  scope: SavedFilterScope;
  name: string;
  definition: Record<string, any>;
  is_default: boolean;
  is_shared: boolean;
  owned_by_current_user: boolean;
  created_at: string;
  updated_at?: string | null;
}

export const savedFiltersAPI = {
  list: async (projectId: number, scope: SavedFilterScope): Promise<SavedFilter[]> => {
    const response = await api.get('/saved-filters', { params: { project_id: projectId, scope } });
    return response.data;
  },
  create: async (payload: { project_id: number; scope: SavedFilterScope; name: string; definition: Record<string, any>; is_default?: boolean; is_shared?: boolean }): Promise<SavedFilter> => {
    const response = await api.post('/saved-filters', payload);
    return response.data;
  },
  update: async (id: number, payload: { name?: string; definition?: Record<string, any>; is_default?: boolean; is_shared?: boolean }): Promise<SavedFilter> => {
    const response = await api.put(`/saved-filters/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/saved-filters/${id}`);
  },
};

// Test datasets (case-level parameterization)
export interface TestDataset {
  id: number;
  project_id: number;
  name: string;
  description?: string | null;
  parameters: string[];
  rows: Record<string, string>[];
  is_active: boolean;
  created_by: number;
  created_at: string;
  updated_at?: string | null;
}

export const datasetsAPI = {
  list: async (projectId: number): Promise<TestDataset[]> => {
    const response = await api.get('/test-datasets', { params: { project_id: projectId } });
    return response.data;
  },
  get: async (id: number): Promise<TestDataset> => {
    const response = await api.get(`/test-datasets/${id}`);
    return response.data;
  },
  create: async (payload: { project_id: number; name: string; description?: string; parameters: string[]; rows: Record<string, string>[] }): Promise<TestDataset> => {
    const response = await api.post('/test-datasets', payload);
    return response.data;
  },
  update: async (id: number, payload: { name?: string; description?: string; parameters?: string[]; rows?: Record<string, string>[]; is_active?: boolean }): Promise<TestDataset> => {
    const response = await api.put(`/test-datasets/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/test-datasets/${id}`);
  },
};

// Global parameters (single key->value, project-scoped or global)
export interface GlobalParameter {
  id: number;
  name: string;
  value: string;
  description?: string | null;
  parameter_type: string;
  project_id?: number | null;
  is_active: boolean;
  is_encrypted: boolean;
  created_by: number;
  created_at: string;
  updated_at?: string | null;
}

export const globalParametersAPI = {
  list: async (projectId?: number): Promise<GlobalParameter[]> => {
    const response = await api.get('/global-parameters', { params: projectId != null ? { project_id: projectId } : {} });
    return response.data;
  },
  create: async (payload: { name: string; value: string; description?: string; parameter_type: string; project_id?: number | null; is_encrypted?: boolean }): Promise<GlobalParameter> => {
    const response = await api.post('/global-parameters/', payload);
    return response.data;
  },
  update: async (id: number, payload: { name?: string; value?: string; description?: string; parameter_type?: string; is_encrypted?: boolean }): Promise<GlobalParameter> => {
    const response = await api.put(`/global-parameters/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/global-parameters/${id}`);
  },
};

// Bulk edit
export const bulkAPI = {
  testCases: async (payload: { ids: number[]; priority?: string; status?: string; test_type?: string; section_id?: number; tags?: string; add_tags?: string; remove_tags?: string }) => {
    const response = await api.patch('/test-cases/bulk', payload);
    return response.data as { updated: number; skipped_ids: number[]; reason?: string | null };
  },
  defects: async (payload: { ids: number[]; status?: string; severity?: string; priority?: string; assigned_to?: number; clear_assignee?: boolean }) => {
    const response = await api.patch('/defects/bulk', payload);
    return response.data as { updated: number; skipped_ids: number[]; reason?: string | null };
  },
  requirements: async (payload: { ids: number[]; status?: string; priority?: string; assigned_to?: number; clear_assignee?: boolean; tags?: string; add_tags?: string; remove_tags?: string }) => {
    const response = await api.patch('/requirements/bulk', payload);
    return response.data as { updated: number; skipped_ids: number[]; reason?: string | null };
  },
  deleteRequirements: async (payload: { ids: number[] }) => {
    const response = await api.post('/requirements/bulk/delete', payload);
    return response.data as { updated: number; skipped_ids: number[]; reason?: string | null };
  },
};

// API tokens (personal)
export const apiTokensAPI = {
  list: async () => {
    const response = await api.get('/api-tokens');
    return response.data;
  },
  create: async (payload: { name: string; expires_at?: string | null }) => {
    const response = await api.post('/api-tokens', payload);
    return response.data;
  },
  revoke: async (id: number) => {
    await api.delete(`/api-tokens/${id}`);
  },
};

// Outbound webhooks (project-scoped)
export const webhooksAPI = {
  supportedEvents: async (): Promise<string[]> => {
    const response = await api.get('/webhooks/supported-events');
    return response.data;
  },
  list: async (projectId: number) => {
    const response = await api.get(`/projects/${projectId}/webhooks`);
    return response.data;
  },
  create: async (projectId: number, payload: { name: string; url: string; events: string[]; is_active?: boolean }) => {
    const response = await api.post(`/projects/${projectId}/webhooks`, {
      project_id: projectId,
      ...payload,
    });
    return response.data;
  },
  update: async (
    projectId: number,
    id: number,
    payload: { name?: string; url?: string; events?: string[]; is_active?: boolean; rotate_secret?: boolean },
  ) => {
    const response = await api.put(`/projects/${projectId}/webhooks/${id}`, payload);
    return response.data;
  },
  remove: async (projectId: number, id: number) => {
    await api.delete(`/projects/${projectId}/webhooks/${id}`);
  },
  deliveries: async (projectId: number, id: number, limit = 50) => {
    const response = await api.get(`/projects/${projectId}/webhooks/${id}/deliveries?limit=${limit}`);
    return response.data;
  },
  redeliver: async (projectId: number, webhookId: number, deliveryId: number) => {
    const response = await api.post(`/projects/${projectId}/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`);
    return response.data;
  },
  test: async (projectId: number, webhookId: number) => {
    const response = await api.post(`/projects/${projectId}/webhooks/${webhookId}/test`);
    return response.data;
  },
};
