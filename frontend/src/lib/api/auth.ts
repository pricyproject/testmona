import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

export const authAPI = {
  login: async (usernameOrEmail: string, password: string, twoFactorCode?: string) => {
    const response = await api.post("/token", {
      username_or_email: usernameOrEmail,
      password,
      ...(twoFactorCode ? { two_factor_code: twoFactorCode } : {}),
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

  // First-run setup: token-gated creation of the initial administrator.
  completeSetup: async (
    username: string,
    email: string,
    full_name: string,
    password: string,
    setup_token: string,
  ) => {
    const response = await api.post("/system/setup", {
      username,
      email,
      full_name,
      password,
      setup_token,
    });
    return response.data;
  },

  refreshToken: async (refreshToken?: string) => {
    const response = await api.post("/refresh", refreshToken ? {
      refresh_token: refreshToken,
    } : {});
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

  setupTwoFactor: async () => {
    const response = await api.post("/users/me/2fa/setup");
    return response.data;
  },

  enableTwoFactor: async (currentPassword: string, code: string) => {
    const response = await api.post("/users/me/2fa/enable", {
      current_password: currentPassword,
      code,
    });
    return response.data;
  },

  disableTwoFactor: async (currentPassword: string, code: string) => {
    const response = await api.post("/users/me/2fa/disable", {
      current_password: currentPassword,
      code,
    });
    return response.data;
  },

  regenerateTwoFactorRecoveryCodes: async (currentPassword: string, code: string) => {
    const response = await api.post("/users/me/2fa/recovery-codes", {
      current_password: currentPassword,
      code,
    });
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
