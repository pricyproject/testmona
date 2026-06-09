import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

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

export type AISourceType = "requirements" | "defects" | "test_plans" | "test_cases" | "docs";

export interface RequirementChatSettings {
  enabled: boolean;
  max_context_requirements: number;
  history_turns: number;
  source_types: AISourceType[];
}

export interface AIRoutingTarget {
  provider: AIProviderName | null;
  model: string | null;
}

export interface AIRoutingSettings {
  qa: AIRoutingTarget;
  generation: AIRoutingTarget;
  assistant: AIRoutingTarget;
  // General Doc Hub group + optional per-feature overrides (fall back to `docs`).
  docs: AIRoutingTarget;
  doc_impact: AIRoutingTarget;
  doc_release_notes: AIRoutingTarget;
  doc_convert: AIRoutingTarget;
}

export interface AIFallbackSettings {
  enabled: boolean;
  order: AIProviderName[];
}

export interface AITestCaseGenerationSettings {
  default_count: number;
  max_tokens: number;
}

export interface AIManagerSettings {
  active_provider: AIProviderName;
  per_project_monthly_token_limit?: number | null;
  requirement_chat?: RequirementChatSettings;
  system_prompt?: string;
  compact_payload_default?: boolean;
  test_case_generation?: AITestCaseGenerationSettings;
  routing?: AIRoutingSettings;
  fallback?: AIFallbackSettings;
  providers: AIProviderConfig[];
}

export interface AIManagerStatus {
  active_provider: AIProviderName;
  available: boolean;
  reason?: "active_provider_not_configured" | "active_provider_disabled" | "token_missing" | null;
  provider?: AIProviderConfig | null;
  requirement_chat_enabled?: boolean;
  requirement_chat_source_types?: AISourceType[];
  compact_payload_default?: boolean;
  test_case_default_count?: number;
}

export interface AIOperationUsage {
  operation: string;
  requests: number;
  failures: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
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
    by_operation?: AIOperationUsage[];
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
