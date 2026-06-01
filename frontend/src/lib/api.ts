import axios from "axios";
import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate } from "@/types";
import { useAuthStore } from "@/stores/authStore";

// System Settings API
export const systemSettingsAPI = {
  getPublicSetting: async (key: string) => {
    const response = await api.get(`/system/settings/public/${encodeURIComponent(key)}`);
    return response.data;
  },

  getSetting: async (key: string) => {
    const response = await api.get(`/system/settings/${key}`);
    return response.data;
  },
  
  getAllSettings: async () => {
    const response = await api.get("/system/settings");
    return response.data;
  },
  
  updateSetting: async (key: string, value: string, description?: string) => {
    const response = await api.put(`/system/settings/${key}`, {
      value,
      description,
    });
    return response.data;
  },
  
  createSetting: async (key: string, value: string, description?: string) => {
    const response = await api.post("/system/settings", {
      key,
      value,
      description,
    });
    return response.data;
  },
  
  deleteSetting: async (key: string) => {
    const response = await api.delete(`/system/settings/${key}`);
    return response.data;
  },
};

export type AIProviderName = "openai" | "openrouter" | "anthropic" | "huggingface" | "litellm";

export interface AIProviderConfig {
  provider: AIProviderName;
  enabled: boolean;
  api_key?: string;
  model: string;
  base_url: string;
  request_timeout_seconds: number;
  monthly_token_limit?: number | null;
  token_configured?: boolean;
  api_key_masked?: string | null;
  api_key_required?: boolean;
}

export interface AIManagerSettings {
  active_provider: AIProviderName;
  per_project_monthly_token_limit?: number | null;
  providers: AIProviderConfig[];
}

export interface AIManagerStatus {
  active_provider: AIProviderName;
  available: boolean;
  reason?: "active_provider_not_configured" | "active_provider_disabled" | "token_missing" | null;
  provider?: AIProviderConfig | null;
}

export interface AIUsageLimitEntry {
  used_tokens: number;
  limit: number | null;
  remaining_tokens: number | null;
  percent_used: number;
  status: "unlimited" | "ok" | "warning" | "exceeded";
  requests?: number;
  failures?: number;
}

export interface AIUsageSummary {
  current_month?: string;
  totals?: Record<string, number>;
  providers?: Record<AIProviderName, Record<string, number>>;
  monthly?: Record<string, unknown>;
  recent_events?: Array<Record<string, unknown>>;
  limits?: {
    current_month: string;
    active_provider: AIProviderName;
    providers: Record<AIProviderName, AIUsageLimitEntry>;
    active_provider_limit?: AIUsageLimitEntry | null;
    project_monthly_limit: {
      limit: number | null;
      total_projects: number;
      projects_over_limit: number;
      projects_near_limit: number;
      top_projects: Array<AIUsageLimitEntry & { project_id: string }>;
    };
  };
}

export const aiManagerAPI = {
  getSettings: async (): Promise<AIManagerSettings> => {
    const response = await api.get("/ai-manager/settings");
    return response.data;
  },

  getStatus: async (): Promise<AIManagerStatus> => {
    const response = await api.get("/ai-manager/status");
    return response.data;
  },

  updateSettings: async (settings: AIManagerSettings): Promise<AIManagerSettings> => {
    const response = await api.put("/ai-manager/settings", settings);
    return response.data;
  },

  getUsage: async (): Promise<AIUsageSummary> => {
    const response = await api.get("/ai-manager/usage");
    return response.data;
  },

  resetUsage: async (): Promise<AIUsageSummary> => {
    const response = await api.delete("/ai-manager/usage");
    return response.data;
  },

  clearRecentActions: async (): Promise<AIUsageSummary> => {
    const response = await api.delete("/ai-manager/recent-actions");
    return response.data;
  },

  testProvider: async (provider?: AIProviderName, prompt?: string) => {
    const response = await api.post("/ai-manager/test", { provider, prompt });
    return response.data;
  },
};

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) => item?.msg || item?.message)
        .filter(Boolean)
        .join(", ") || fallback;
    }
    const message = error.response?.data?.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return error instanceof Error ? error.message : fallback;
};

// Add refresh flag to prevent multiple simultaneous refresh attempts
(api as any)._refreshing = false;
(api as any)._refreshPromise = null;

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = String(originalRequest?.url || "");
    const isAuthEndpoint =
      requestUrl.includes("/refresh") ||
      requestUrl.includes("/token") ||
      requestUrl.includes("/login") ||
      requestUrl.includes("/logout");
    
    // Handle 403 Password Change Required
    if (error.response?.status === 403 && 
        error.response?.data?.detail?.includes("Password change required")) {
      // Prevent duplicate event dispatches using a flag
      if (!(api as any)._passwordChangeDialogShown) {
        console.log('Password change required - dispatching event');
        (api as any)._passwordChangeDialogShown = true;
        // Dispatch custom event to show password change dialog
        window.dispatchEvent(new CustomEvent('passwordChangeRequired'));
      }
      return Promise.reject(error);
    }
    
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      // If a refresh is already in progress, wait for it before setting retry flag
      // This prevents multiple simultaneous refresh attempts
      if ((api as any)._refreshing && (api as any)._refreshPromise) {
        try {
          await (api as any)._refreshPromise;
          const token = localStorage.getItem("token");
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return api(originalRequest);
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      }
      
      // Mark request as retried to prevent infinite loops
      originalRequest._retry = true;
      
      try {
        (api as any)._refreshing = true;
        const refreshToken = localStorage.getItem("refreshToken");
        
        if (refreshToken) {
          // Create a single refresh promise that all requests can wait for
          (api as any)._refreshPromise = authAPI.refreshToken(refreshToken);
          const response = await (api as any)._refreshPromise;
          
          localStorage.setItem("token", response.access_token);
          if (response.refresh_token) {
            localStorage.setItem("refreshToken", response.refresh_token);
          }
          
          // Sync with authStore to keep state consistent
          useAuthStore.setState({
            token: response.access_token,
            refreshToken: response.refresh_token || refreshToken,
          });
          
          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${response.access_token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, clear tokens and redirect to login
        if (!axios.isAxiosError(refreshError) || refreshError.response?.status !== 401) {
          console.error("Token refresh failed:", refreshError);
        }
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        
        // Clear authStore state
        useAuthStore.setState({
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          user: null,
        });
        
        // Only redirect if not already on login page
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        (api as any)._refreshing = false;
        (api as any)._refreshPromise = null;
      }
    }
    
    if (error.response?.status === 401 && isAuthEndpoint) {
      localStorage.removeItem("token");
      localStorage.removeItem("refreshToken");
      useAuthStore.setState({
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        user: null,
      });
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: async (usernameOrEmail: string, password: string) => {
    const response = await api.post("/token", {
      username_or_email: usernameOrEmail,
      password,
    });
    return response.data;
  },

  signup: async (username: string, email: string, full_name: string, password: string) => {
    const response = await api.post("/register", {
      username,
      email,
      full_name,
      password,
    });
    return response.data;
  },

  refreshToken: async (refreshToken: string) => {
    const response = await api.post("/refresh", {
      refresh_token: refreshToken,
    });
    return response.data;
  },

  logout: async (data?: { refresh_token?: string }) => {
    const response = await api.post("/logout", data);
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await api.get("/users/me");
    return response.data;
  },
};

export interface InvitationDetails {
  email: string;
  role: string;
  expires_at: string;
}

export interface InvitationAcceptPayload {
  token: string;
  username: string;
  password: string;
  full_name?: string;
}

export const invitationsAPI = {
  getByToken: async (token: string): Promise<InvitationDetails> => {
    const response = await api.get(`/invitations/${encodeURIComponent(token)}`);
    return response.data;
  },

  accept: async (token: string, payload: InvitationAcceptPayload): Promise<{ message: string; user_id: number }> => {
    const response = await api.post(`/invitations/${encodeURIComponent(token)}/accept`, payload);
    return response.data;
  },
};


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

// Requirements API
export const requirementsAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100, filters: { milestoneId?: number } = {}) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    if (filters.milestoneId) params.append('milestone_id', filters.milestoneId.toString());
    const response = await api.get(`/requirements?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/requirements/${id}`);
    return response.data;
  },
  create: async (requirement: any) => {
    const response = await api.post('/requirements', requirement);
    return response.data;
  },
  update: async (id: number, requirement: any) => {
    const response = await api.put(`/requirements/${id}`, requirement);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/requirements/${id}`);
    return response.data;
  },
  fetchExternalDocument: async (payload: { project_id: number; url: string }) => {
    const response = await api.post('/requirements/fetch-external-document', payload);
    return response.data;
  },
  importFromTracker: async (payload: { project_id: number; source: 'asana' | 'linear' | 'monday'; url: string }) => {
    const response = await api.post('/requirements/import-from-tracker', payload);
    return response.data;
  },
  coverage: async (projectId: number): Promise<RequirementCoverageList> => {
    const response = await api.get('/requirements/coverage', { params: { project_id: projectId } });
    return response.data;
  },
  // Version history
  listVersions: async (id: number): Promise<RequirementVersion[]> => {
    const response = await api.get(`/requirements/${id}/versions`);
    return response.data;
  },
  restoreVersion: async (id: number, versionId: number, changeNote?: string): Promise<Requirement> => {
    const response = await api.post(`/requirements/${id}/versions/${versionId}/restore`, { change_note: changeNote ?? null });
    return response.data;
  },
  // Comments / review threads
  listComments: async (id: number): Promise<RequirementComment[]> => {
    const response = await api.get(`/requirements/${id}/comments`);
    return response.data;
  },
  addComment: async (id: number, payload: { body: string; parent_id?: number | null }): Promise<RequirementComment> => {
    const response = await api.post(`/requirements/${id}/comments`, payload);
    return response.data;
  },
  updateComment: async (commentId: number, payload: { body?: string; is_resolved?: boolean }): Promise<RequirementComment> => {
    const response = await api.patch(`/requirements/comments/${commentId}`, payload);
    return response.data;
  },
  deleteComment: async (commentId: number): Promise<void> => {
    await api.delete(`/requirements/comments/${commentId}`);
  },
  searchTestCases: async (
    id: number,
    filters: {
      search?: string;
      linked?: boolean;
      status?: string;
      priority?: string;
      suite_id?: number;
      section_id?: number;
      skip?: number;
      limit?: number;
    } = {}
  ) => {
    const params = new URLSearchParams({
      skip: String(filters.skip ?? 0),
      limit: String(filters.limit ?? 25),
    });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && key !== 'skip' && key !== 'limit' && value !== '') {
        params.append(key, String(value));
      }
    });
    const response = await api.get(`/requirements/${id}/test-cases?${params}`);
    return response.data;
  },
  bulkUpdateTestCases: async (id: number, payload: { test_case_ids: number[]; action: 'link' | 'unlink' }) => {
    const response = await api.post(`/requirements/${id}/test-cases/bulk`, payload);
    return response.data;
  },
  createAndLinkTestCase: async (id: number, payload: any) => {
    const response = await api.post(`/requirements/${id}/test-cases`, payload);
    return response.data;
  },
  generateTestCases: async (id: number, payload: { count?: number; instructions?: string }) => {
    const response = await api.post(`/requirements/${id}/ai/test-cases`, payload);
    return response.data;
  },
  checkTestCaseDuplicates: async (
    id: number,
    payload: {
      test_suite_id: number;
      section_id?: number;
      scope?: 'section' | 'suite';
      drafts: Array<{
        index: number;
        title?: string;
        description?: string;
        preconditions?: string;
        steps?: string;
        expected_result?: string;
        test_steps?: Array<{ action?: string; expected_result?: string }>;
      }>;
    }
  ) => {
    const response = await api.post(`/requirements/${id}/ai/test-cases/duplicate-check`, payload);
    return response.data;
  },
  getTestCaseHistory: async (id: number, offset = 0, limit = 20) => {
    const response = await api.get(`/requirements/${id}/test-cases/history?offset=${offset}&limit=${limit}`);
    return response.data;
  },
  searchTestPlans: async (
    id: number,
    filters: {
      search?: string;
      linked?: boolean;
      status?: string;
      milestone_id?: number;
      skip?: number;
      limit?: number;
    } = {}
  ) => {
    const params = new URLSearchParams({
      skip: String(filters.skip ?? 0),
      limit: String(filters.limit ?? 25),
    });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && key !== 'skip' && key !== 'limit' && value !== '') {
        params.append(key, String(value));
      }
    });
    const response = await api.get(`/requirements/${id}/test-plans?${params}`);
    return response.data;
  },
  bulkUpdateTestPlans: async (id: number, payload: { test_plan_ids: number[]; action: 'link' | 'unlink' }) => {
    const response = await api.post(`/requirements/${id}/test-plans/bulk`, payload);
    return response.data;
  },
  getRelationships: async (id: number) => {
    const response = await api.get(`/requirements/${id}/relationships`);
    return response.data;
  },
};

// Test Cases API
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

// Users API
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

// Project Assignments / Members API
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
  getRootCauseAnalyses: async (projectId: number) => {
    const response = await api.get(`/analytics/root-cause-analyses?project_id=${projectId}`);
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

// Custom Fields API
export type CustomFieldEntityType = 'test_case' | 'test_run' | 'defect' | 'requirement';

export const CUSTOM_FIELD_ENTITY_TYPES: CustomFieldEntityType[] = [
  'test_case',
  'test_run',
  'defect',
  'requirement',
];

export const customFieldsAPI = {
  getAll: async (projectId?: number, skip = 0, limit = 100) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() });
    if (projectId) params.append('project_id', projectId.toString());
    const response = await api.get(`/custom-fields?${params}`);
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/custom-fields/${id}`);
    return response.data;
  },
  create: async (customField: any) => {
    const response = await api.post('/custom-fields', customField);
    return response.data;
  },
  update: async (id: number, customField: any) => {
    const response = await api.put(`/custom-fields/${id}`, customField);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/custom-fields/${id}`);
    return response.data;
  },
  getDefinitions: async (projectId?: number, entityType?: CustomFieldEntityType) => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', String(projectId));
    if (entityType) params.append('entity_type', entityType);
    const qs = params.toString();
    const response = await api.get(`/custom-fields/definitions${qs ? `?${qs}` : ''}`);
    return response.data;
  },
  createDefinition: async (customField: any) => {
    const response = await api.post('/custom-fields/definitions', customField);
    return response.data;
  },
  updateDefinition: async (id: number, customField: any) => {
    const response = await api.put(`/custom-fields/definitions/${id}`, customField);
    return response.data;
  },
  deleteDefinition: async (id: number) => {
    const response = await api.delete(`/custom-fields/definitions/${id}`);
    return response.data;
  },
  getValues: async (testCaseId?: number, fieldDefinitionId?: number) => {
    const params = new URLSearchParams();
    if (testCaseId) params.append('test_case_id', testCaseId.toString());
    if (fieldDefinitionId) params.append('field_definition_id', fieldDefinitionId.toString());
    const response = await api.get(`/custom-field-values/?${params}`);
    return response.data;
  },
  createValue: async (value: any) => {
    const response = await api.post('/custom-field-values/', value);
    return response.data;
  },
  updateValue: async (id: number, value: any) => {
    const response = await api.put(`/custom-field-values/${id}`, value);
    return response.data;
  },
  deleteValue: async (id: number) => {
    const response = await api.delete(`/custom-field-values/${id}`);
    return response.data;
  },
  // Polymorphic engine: same endpoints regardless of entity type.
  listEntityValues: async (entityType: CustomFieldEntityType, entityId: number) => {
    const response = await api.get(`/custom-fields/entities/${entityType}/${entityId}/values`);
    return response.data;
  },
  createEntityValue: async (
    entityType: CustomFieldEntityType,
    entityId: number,
    fieldDefinitionId: number,
    value: string | null,
  ) => {
    const body: Record<string, unknown> = {
      field_definition_id: fieldDefinitionId,
      [`${entityType}_id`]: entityId,
      value,
    };
    const response = await api.post(`/custom-fields/entities/${entityType}/${entityId}/values`, body);
    return response.data;
  },
  updateEntityValue: async (
    entityType: CustomFieldEntityType,
    entityId: number,
    valueId: number,
    value: string | null,
  ) => {
    const response = await api.put(
      `/custom-fields/entities/${entityType}/${entityId}/values/${valueId}`,
      { value },
    );
    return response.data;
  },
  deleteEntityValue: async (entityType: CustomFieldEntityType, entityId: number, valueId: number) => {
    await api.delete(`/custom-fields/entities/${entityType}/${entityId}/values/${valueId}`);
  },
};

// Jira API
export const jiraAPI = {
  getIntegrations: async (projectId?: number) => {
    const params = projectId ? `?project_id=${projectId}` : '';
    const response = await api.get(`/jira-integrations/${params}`);
    return response.data;
  },
  createIntegration: async (integration: any) => {
    const response = await api.post('/jira-integrations', integration);
    return response.data;
  },
  deleteIntegration: async (integrationId: number) => {
    const response = await api.delete(`/jira-integrations/${integrationId}`);
    return response.data;
  },
  testConnection: async (integrationId: number) => {
    const response = await api.post(`/jira-integrations/${integrationId}/test-connection`);
    return response.data;
  },
  syncIssues: async (integrationId: number) => {
    const response = await api.post(`/jira-integrations/${integrationId}/sync`);
    return response.data;
  },
};

// User Preferences API
export const userPreferencesAPI = {
  get: async () => {
    const response = await api.get('/user-preferences');
    return response.data;
  },
  update: async (preferences: any) => {
    const response = await api.put('/user-preferences', preferences);
    return response.data;
  },
  getItemsPerPage: async () => {
    const response = await api.get('/user/preferences/items-per-page');
    return response.data;
  },
  updateItemsPerPage: async (itemsPerPage: number) => {
    const response = await api.put('/user/preferences/items-per-page', { items_per_page: itemsPerPage });
    return response.data;
  },
};

export interface ImportMappedCustomFieldValue {
  field_definition_id: number;
  value: string;
}

export type ImportMode = 'create_only' | 'skip_duplicates' | 'update_existing' | 'create_copy';
export type ImportDuplicateMode = ImportMode;
export type ImportProgressPhase = 'validating' | 'uploading' | 'importing' | 'refreshing' | 'complete';

export interface ImportMappedTestCaseRow {
  row_number?: number;
  title: string;
  test_suite_id?: number;
  section_id?: number;
  description?: string;
  preconditions?: string;
  steps?: string;
  expected_result?: string;
  priority?: string;
  test_type?: string;
  status?: string;
  reference?: string;
  tags?: string;
  order_index?: number;
  is_multistep?: boolean;
  multistep_data?: string;
  created_at?: string;
  updated_at?: string;
  id?: number;
  external_key?: string;
  import_action?: ImportDuplicateMode;
  duplicate_hint?: boolean;
  custom_field_values?: ImportMappedCustomFieldValue[];
}

export interface ImportRowResult {
  row_number: number;
  title: string;
  status: string;
  action?: ImportDuplicateMode;
  created_id?: number | null;
  updated_id?: number | null;
  existing_id?: number | null;
  warning?: string | null;
  error?: string | null;
}

export interface ImportTestCasesResult {
  message: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error_rows: number;
  errors: string[];
  warnings: string[];
  created_ids?: number[];
  row_results?: ImportRowResult[];
  import_job_id?: string;
  dry_run?: boolean;
  duplicate_detection?: {
    duplicates_by_title: number;
    duplicates_by_id: number;
    potential_duplicates: number;
  };
}

export interface ExportTestCasesResult {
  filename: string;
  content: string;
  media_type: string;
  total_rows?: number;
  truncated?: boolean;
  warnings?: string[];
}

export interface ImportMappedTestCasesOptions {
  duplicateMode?: ImportDuplicateMode;
  importMode?: ImportMode;
  filename?: string;
  idempotencyKey?: string;
  dryRun?: boolean;
  chunkSize?: number;
  onProgress?: (progress: {
    phase: ImportProgressPhase;
    currentChunk?: number;
    totalChunks?: number;
    processedRows?: number;
    totalRows?: number;
    message?: string;
  }) => void;
}


const getImportModeForDuplicateMode = (mode?: ImportDuplicateMode): ImportMode => mode || 'skip_duplicates';

const createIdempotencyKey = () => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

// Import/Export API
export const importExportAPI = {
  exportTestCases: async (testSuiteId?: number, format = 'csv') => {
    const params = testSuiteId ? `?test_suite_id=${testSuiteId}&format=${format}` : `?format=${format}`;
    const response = await api.get(`/import-export/export/test-cases${params}`, {
      timeout: 300000,
    });
    return response.data as ExportTestCasesResult;
  },
  importTestCases: async (file: File, testSuiteId?: number, sectionId?: number, idempotencyKey?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (testSuiteId) formData.append('test_suite_id', testSuiteId.toString());
    if (sectionId) formData.append('section_id', sectionId.toString());
    
    const response = await api.post('/import-export/import/test-cases', formData, {
      headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': idempotencyKey || createIdempotencyKey() },
      timeout: 300000,
    });
    return response.data as ImportTestCasesResult;
  },
  createImportJob: async (totalRows: number, totalChunks: number, filename?: string) => {
    const response = await api.post('/import-export/import-jobs', {
      total_rows: totalRows,
      total_chunks: totalChunks,
      filename,
    }, {
      timeout: 300000,
    });
    return response.data as { id: string; status: string };
  },
  getImportJob: async (jobId: string) => {
    const response = await api.get(`/import-export/import-jobs/${jobId}`, {
      timeout: 300000,
    });
    return response.data;
  },
  importMappedTestCases: async (
    testSuiteId: number,
    rows: ImportMappedTestCaseRow[],
    skipDuplicatesOrOptions: boolean | ImportMappedTestCasesOptions = true,
  ) => {
    const options = typeof skipDuplicatesOrOptions === 'boolean'
      ? { duplicateMode: skipDuplicatesOrOptions ? 'skip_duplicates' : 'create_copy' } as ImportMappedTestCasesOptions
      : skipDuplicatesOrOptions;
    const response = await api.post('/import-export/import/test-cases/previewed', {
      test_suite_id: testSuiteId,
      rows,
      skip_duplicates: (options.duplicateMode || 'skip_duplicates') === 'skip_duplicates',
      duplicate_mode: options.duplicateMode || 'skip_duplicates',
      import_mode: options.importMode || getImportModeForDuplicateMode(options.duplicateMode),
      filename: options.filename,
      dry_run: options.dryRun || false,
    }, {
      headers: { 'Idempotency-Key': options.idempotencyKey || createIdempotencyKey() },
      timeout: 300000,
    });
    return response.data as ImportTestCasesResult;
  },
  importMappedTestCasesChunked: async (
    testSuiteId: number,
    rows: ImportMappedTestCaseRow[],
    options: ImportMappedTestCasesOptions = {},
  ) => {
    const chunkSize = options.chunkSize || 500;
    const chunks: ImportMappedTestCaseRow[][] = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }

    if (options.dryRun || chunks.length <= 1) {
      options.onProgress?.({
        phase: options.dryRun ? 'validating' : 'importing',
        currentChunk: 1,
        totalChunks: Math.max(chunks.length, 1),
        processedRows: 0,
        totalRows: rows.length,
      });
      const result = await importExportAPI.importMappedTestCases(testSuiteId, rows, options);
      options.onProgress?.({
        phase: 'complete',
        currentChunk: Math.max(chunks.length, 1),
        totalChunks: Math.max(chunks.length, 1),
        processedRows: rows.length,
        totalRows: rows.length,
      });
      return result;
    }

    const baseIdempotencyKey = options.idempotencyKey || createIdempotencyKey();
    options.onProgress?.({ phase: 'uploading', currentChunk: 0, totalChunks: chunks.length, processedRows: 0, totalRows: rows.length });
    const job = await importExportAPI.createImportJob(rows.length, chunks.length, options.filename);
    const aggregate: ImportTestCasesResult = {
      message: '',
      total_rows: rows.length,
      imported_rows: 0,
      skipped_rows: 0,
      error_rows: 0,
      errors: [],
      warnings: [],
      created_ids: [],
      row_results: [],
      import_job_id: job.id,
      dry_run: options.dryRun || false,
      duplicate_detection: { duplicates_by_title: 0, duplicates_by_id: 0, potential_duplicates: 0 },
    };

    for (let index = 0; index < chunks.length; index += 1) {
      const processedRows = chunks.slice(0, index).reduce((total, chunk) => total + chunk.length, 0);
      options.onProgress?.({ phase: 'importing', currentChunk: index + 1, totalChunks: chunks.length, processedRows, totalRows: rows.length });
      const response = await api.post('/import-export/import/test-cases/previewed', {
        test_suite_id: testSuiteId,
        rows: chunks[index],
        skip_duplicates: (options.duplicateMode || 'skip_duplicates') === 'skip_duplicates',
        duplicate_mode: options.duplicateMode || 'skip_duplicates',
        import_mode: options.importMode || getImportModeForDuplicateMode(options.duplicateMode),
        filename: options.filename,
        dry_run: options.dryRun || false,
        import_job_id: job.id,
        chunk_index: index,
        total_chunks: chunks.length,
      }, {
        headers: { 'Idempotency-Key': `${baseIdempotencyKey}:chunk:${index}` },
        timeout: 300000,
      });
      const result = response.data as ImportTestCasesResult;
      aggregate.imported_rows += result.imported_rows || 0;
      aggregate.skipped_rows += result.skipped_rows || 0;
      aggregate.error_rows += result.error_rows || 0;
      aggregate.errors.push(...(result.errors || []));
      aggregate.warnings.push(...(result.warnings || []));
      aggregate.created_ids?.push(...(result.created_ids || []));
      aggregate.row_results?.push(...(result.row_results || []));
      if (aggregate.duplicate_detection && result.duplicate_detection) {
        aggregate.duplicate_detection.duplicates_by_title += result.duplicate_detection.duplicates_by_title || 0;
        aggregate.duplicate_detection.duplicates_by_id += result.duplicate_detection.duplicates_by_id || 0;
        aggregate.duplicate_detection.potential_duplicates += result.duplicate_detection.potential_duplicates || 0;
      }
    }

    aggregate.message = options.dryRun
      ? `Successfully validated ${aggregate.imported_rows} test cases${aggregate.skipped_rows ? `, ${aggregate.skipped_rows} rows skipped` : ''}${aggregate.error_rows ? `, ${aggregate.error_rows} errors` : ''}`
      : `Successfully imported ${aggregate.imported_rows} test cases${aggregate.skipped_rows ? `, ${aggregate.skipped_rows} rows skipped` : ''}${aggregate.error_rows ? `, ${aggregate.error_rows} errors` : ''}`;
    options.onProgress?.({ phase: 'complete', currentChunk: chunks.length, totalChunks: chunks.length, processedRows: rows.length, totalRows: rows.length });
    return aggregate;
  },
};

// Test Management API
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
  getSharedStepTemplates: async (skip = 0, limit = 100) => {
    const response = await api.get(`/shared-step-templates/?skip=${skip}&limit=${limit}`);
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
  getPriorities: async () => {
    const response = await api.get('/enums/priorities');
    return response.data;
  },
  getTestTypes: async () => {
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

export { api };
