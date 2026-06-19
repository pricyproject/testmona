import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocSpaceUpdate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocReviewView, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus, WatchStatus, WatchEntityType } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

// Watch / change-notification subscriptions, shared by docs, requirements, and
// work items. The backend exposes `/{collection}/{id}/watch` per entity kind.
const watchCollection: Record<WatchEntityType, string> = {
  doc: 'docs',
  requirement: 'requirements',
  defect: 'defects',
  test_case: 'test-cases',
  test_plan: 'test-plans',
};
const watchBasePath = (entityType: WatchEntityType, id: number): string =>
  `/${watchCollection[entityType]}/${id}/watch`;

export const watchAPI = {
  get: async (entityType: WatchEntityType, id: number): Promise<WatchStatus> => {
    const response = await api.get(watchBasePath(entityType, id));
    return response.data;
  },
  watch: async (entityType: WatchEntityType, id: number): Promise<WatchStatus> => {
    const response = await api.post(watchBasePath(entityType, id));
    return response.data;
  },
  unwatch: async (entityType: WatchEntityType, id: number): Promise<WatchStatus> => {
    const response = await api.delete(watchBasePath(entityType, id));
    return response.data;
  },
};
import type { AISourceType } from "./system_ai";

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
  getBySeq: async (projectId: number, seq: number) => {
    const id = await resolveProjectSeq(projectId, 'requirements', seq);
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
  // Gherkin .feature export — downloads a .feature file (single match) or a .zip bundle.
  exportFeatureFiles: async (projectId: number, ids?: number[], folderId?: number): Promise<void> => {
    const params = new URLSearchParams({ project_id: String(projectId) });
    if (ids && ids.length) params.append('ids', ids.join(','));
    if (folderId) params.append('folder_id', String(folderId));
    const response = await api.get(`/requirements/export-feature-files?${params}`, { responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] || '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    const contentType = String(response.headers['content-type'] || 'application/octet-stream');
    const fallback = contentType.includes('zip') ? `requirements-project-${projectId}-features.zip` : 'requirement.feature';
    triggerBlobDownload(response.data, match?.[1] || fallback, contentType);
  },
  // Gherkin .feature import — accepts a single .feature file or a .zip bundle.
  importFeatureFiles: async (
    projectId: number,
    file: File,
    folderId?: number,
  ): Promise<{ created: Requirement[]; skipped: string[] }> => {
    const formData = new FormData();
    formData.append('project_id', String(projectId));
    if (folderId) formData.append('folder_id', String(folderId));
    formData.append('file', file);
    const response = await api.post('/requirements/import-feature-files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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
  generateTestCases: async (id: number, payload: { count?: number; instructions?: string; payload_format?: 'text' | 'toon' }) => {
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

// Requirement folders / categories
export const requirementFoldersAPI = {
  list: async (projectId: number): Promise<RequirementFolder[]> => {
    const response = await api.get(`/requirements/folders?project_id=${projectId}`);
    return response.data;
  },
  create: async (payload: { project_id: number; name: string; description?: string | null; parent_folder_id?: number | null }): Promise<RequirementFolder> => {
    const response = await api.post('/requirements/folders', payload);
    return response.data;
  },
  update: async (id: number, payload: { name?: string; description?: string | null; parent_folder_id?: number | null }): Promise<RequirementFolder> => {
    const response = await api.put(`/requirements/folders/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/requirements/folders/${id}`);
  },
};

// Doc Hub — Docs-as-Code documentation
const triggerBlobDownload = (data: BlobPart, filename: string, type: string) => {
  const blob = new Blob([data], { type });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

export interface DocListParams {
  spaceId?: number;
  projectId?: number;
  folderId?: number;
  classification?: string;
  status?: string;
  tag?: string;
  q?: string;
  includeGlobal?: boolean;
  pinnedOnly?: boolean;
  visitedOnly?: boolean;
  sort?: 'latest_edited' | 'latest_visited' | 'created' | 'title';
  skip?: number;
  limit?: number;
}

const docListQuery = (params: DocListParams) => ({
  space_id: params.spaceId,
  project_id: params.projectId,
  folder_id: params.folderId,
  classification: params.classification,
  status: params.status,
  tag: params.tag,
  q: params.q,
  include_global: params.includeGlobal,
  pinned_only: params.pinnedOnly,
  visited_only: params.visitedOnly,
  sort: params.sort,
  skip: params.skip,
  limit: params.limit,
});

export const docsAPI = {
  // Spaces
  listSpaces: async (params: { projectId?: number; includeGlobal?: boolean } = {}): Promise<DocSpace[]> => {
    const response = await api.get('/docs/spaces', {
      params: {
        project_id: params.projectId,
        include_global: params.includeGlobal ?? true,
      },
    });
    return response.data;
  },
  getSpace: async (id: number): Promise<DocSpace> => {
    const response = await api.get(`/docs/spaces/${id}`);
    return response.data;
  },
  createSpace: async (payload: DocSpaceCreate): Promise<DocSpace> => {
    const response = await api.post('/docs/spaces', payload);
    return response.data;
  },
  updateSpace: async (id: number, payload: DocSpaceUpdate): Promise<DocSpace> => {
    const response = await api.put(`/docs/spaces/${id}`, payload);
    return response.data;
  },
  reorderSpaces: async (spaceIds: number[]): Promise<DocSpace[]> => {
    const response = await api.post('/docs/spaces/reorder', { space_ids: spaceIds });
    return response.data;
  },
  deleteSpace: async (id: number): Promise<void> => {
    await api.delete(`/docs/spaces/${id}`);
  },

  // Folders
  listFolders: async (spaceId: number): Promise<DocFolder[]> => {
    const response = await api.get('/docs/folders', { params: { space_id: spaceId } });
    return response.data;
  },
  createFolder: async (payload: { space_id: number; name: string; parent_folder_id?: number | null }): Promise<DocFolder> => {
    const response = await api.post('/docs/folders', payload);
    return response.data;
  },
  updateFolder: async (id: number, payload: { name?: string; parent_folder_id?: number | null; order_index?: number }): Promise<DocFolder> => {
    const response = await api.put(`/docs/folders/${id}`, payload);
    return response.data;
  },
  deleteFolder: async (id: number): Promise<void> => {
    await api.delete(`/docs/folders/${id}`);
  },

  // Docs
  list: async (params: DocListParams = {}): Promise<DocListItem[]> => {
    const response = await api.get('/docs', { params: docListQuery(params) });
    return response.data;
  },
  listPaged: async (params: DocListParams = {}): Promise<DocListPage> => {
    const response = await api.get('/docs', { params: docListQuery(params) });
    const total = Number(response.headers['x-total-count'] ?? response.data.length);
    return { items: response.data, total: Number.isFinite(total) ? total : response.data.length };
  },
  getFacets: async (params: { spaceId?: number; projectId?: number; includeGlobal?: boolean } = {}): Promise<DocFacets> => {
    const response = await api.get('/docs/facets', {
      params: { space_id: params.spaceId, project_id: params.projectId, include_global: params.includeGlobal },
    });
    return response.data;
  },
  get: async (id: number): Promise<Doc> => {
    const response = await api.get(`/docs/${id}`);
    return response.data;
  },
  setPinned: async (id: number, pinned: boolean): Promise<DocListItem> => {
    const response = await api.put(`/docs/${id}/pin`, { pinned });
    return response.data;
  },
  create: async (payload: DocCreate): Promise<Doc> => {
    const response = await api.post('/docs', payload);
    return response.data;
  },
  update: async (id: number, payload: DocUpdate): Promise<Doc> => {
    const response = await api.put(`/docs/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await api.delete(`/docs/${id}`);
  },
  // Move a doc into review and notify the chosen reviewers (Work Inbox "Reviews").
  requestReview: async (
    id: number,
    payload: { reviewer_ids: number[]; note?: string | null }
  ): Promise<{ message: string; doc_id: number; status: string; notified_count: number; reviewer_ids: number[]; round_id?: number | null }> => {
    const response = await api.post(`/docs/${id}/request-review`, payload);
    return response.data;
  },
  // Current review round + history + the viewer's actionable state.
  getReview: async (id: number): Promise<DocReviewView> => {
    const response = await api.get(`/docs/${id}/review`);
    return response.data;
  },
  // Record the viewer's verdict on the open round (approve / request changes).
  submitReviewDecision: async (
    id: number,
    payload: { decision: 'approved' | 'changes_requested'; comment?: string | null }
  ): Promise<DocReviewView> => {
    const response = await api.post(`/docs/${id}/review/decision`, payload);
    return response.data;
  },
  // Withdraw the open review round (requester / project writer).
  cancelReview: async (id: number, payload?: { note?: string | null }): Promise<DocReviewView> => {
    const response = await api.post(`/docs/${id}/review/cancel`, payload ?? {});
    return response.data;
  },
  getPublic: async (publicId: string): Promise<DocPublicView> => {
    const response = await api.get(`/docs/public/${publicId}`);
    return response.data;
  },
  getMarkdown: async (id: number): Promise<{ id: number; title: string; markdown: string; status: string; tags?: string | null; classification?: string | null }> => {
    const response = await api.get(`/docs/${id}/markdown`);
    return response.data;
  },

  // Versions
  listVersions: async (id: number): Promise<DocVersion[]> => {
    const response = await api.get(`/docs/${id}/versions`);
    return response.data;
  },
  restoreVersion: async (id: number, versionId: number, changeNote?: string): Promise<Doc> => {
    const response = await api.post(`/docs/${id}/versions/${versionId}/restore`, { change_note: changeNote ?? null });
    return response.data;
  },
  clearVersions: async (id: number): Promise<Doc> => {
    const response = await api.delete(`/docs/${id}/versions`);
    return response.data;
  },
  getShare: async (id: number): Promise<DocShareInfo> => {
    const response = await api.get(`/docs/${id}/share`);
    return response.data;
  },
  updateShare: async (id: number, payload: { share_scope: DocShareScope; share_expires_at?: string | null }): Promise<DocShareInfo> => {
    const response = await api.put(`/docs/${id}/share`, payload);
    return response.data;
  },
  addShareGrant: async (id: number, payload: DocShareGrantCreate): Promise<DocShareInfo> => {
    const response = await api.post(`/docs/${id}/share/grants`, payload);
    return response.data;
  },
  removeShareGrant: async (id: number, grantId: number): Promise<DocShareInfo> => {
    const response = await api.delete(`/docs/${id}/share/grants/${grantId}`);
    return response.data;
  },
  getShareAudit: async (id: number, limit = 100): Promise<DocShareAuditEntry[]> => {
    const response = await api.get(`/docs/${id}/share/audit`, { params: { limit } });
    return response.data;
  },
  getStats: async (id: number): Promise<DocStats> => {
    const response = await api.get(`/docs/${id}/stats`);
    return response.data;
  },
  getStatsOverview: async (params: { spaceId?: number; projectId?: number; includeGlobal?: boolean } = {}): Promise<DocStatsOverview> => {
    const response = await api.get('/docs/stats/overview', {
      params: { space_id: params.spaceId, project_id: params.projectId, include_global: params.includeGlobal },
    });
    return response.data;
  },
  getFeedback: async (id: number): Promise<DocFeedbackSummary> => {
    const response = await api.get(`/docs/${id}/feedback`);
    return response.data;
  },
  submitFeedback: async (id: number, payload: { feedback_type: DocFeedbackType; comment?: string | null; section_text?: string | null }): Promise<DocFeedbackSummary> => {
    const response = await api.put(`/docs/${id}/feedback`, payload);
    return response.data;
  },
  deleteFeedback: async (id: number): Promise<DocFeedbackSummary> => {
    const response = await api.delete(`/docs/${id}/feedback`);
    return response.data;
  },
  listFeedback: async (id: number, includeResolved = false): Promise<DocFeedback[]> => {
    const response = await api.get(`/docs/${id}/feedback/items`, { params: { include_resolved: includeResolved } });
    return response.data;
  },
  resolveFeedback: async (id: number, feedbackId: number, resolved: boolean): Promise<DocFeedback> => {
    const response = await api.put(`/docs/${id}/feedback/${feedbackId}`, { resolved });
    return response.data;
  },
  listRelated: async (id: number): Promise<DocRelatedLink[]> => {
    const response = await api.get(`/docs/${id}/related`);
    return response.data;
  },
  addRelated: async (id: number, relatedDocId: number): Promise<DocRelatedLink> => {
    const response = await api.post(`/docs/${id}/related`, { related_doc_id: relatedDocId });
    return response.data;
  },
  removeRelated: async (id: number, relatedDocId: number): Promise<void> => {
    await api.delete(`/docs/${id}/related/${relatedDocId}`);
  },
  suggestions: async (id: number, limit = 6): Promise<DocSuggestion[]> => {
    const response = await api.get(`/docs/${id}/suggestions`, { params: { limit } });
    return response.data;
  },
  duplicates: async (id: number, limit = 5): Promise<DocDuplicateCandidate[]> => {
    const response = await api.get(`/docs/${id}/duplicates`, { params: { limit } });
    return response.data;
  },
  mergeDuplicate: async (id: number, sourceDocId: number, note?: string | null): Promise<DocMergeResult> => {
    const response = await api.post(`/docs/${id}/merge`, { source_doc_id: sourceDocId, note: note ?? null });
    return response.data;
  },

  // Requirement links + converter
  listRequirementLinks: async (id: number): Promise<DocRequirementLink[]> => {
    const response = await api.get(`/docs/${id}/requirement-links`);
    return response.data;
  },
  addRequirementLink: async (id: number, requirementId: number): Promise<DocRequirementLink> => {
    const response = await api.post(`/docs/${id}/requirement-links`, { requirement_id: requirementId });
    return response.data;
  },
  removeRequirementLink: async (id: number, requirementId: number): Promise<void> => {
    await api.delete(`/docs/${id}/requirement-links/${requirementId}`);
  },
  previewConvert: async (id: number, payload: DocConvertRequest): Promise<DocConvertPreview> => {
    const response = await api.post(`/docs/${id}/convert-to-requirements/preview`, payload);
    return response.data;
  },
  convert: async (id: number, payload: DocConvertRequest): Promise<DocConvertResult> => {
    const response = await api.post(`/docs/${id}/convert-to-requirements`, payload);
    return response.data;
  },
  // Optional AI review of the draft requirements (quality, edge cases, refined
  // wording, suggested extra requirements). Accepts an AbortSignal so the (paid)
  // call can be cancelled when the user closes the dialog.
  enhanceConvert: async (
    id: number,
    payload: DocConvertEnhanceRequest,
    signal?: AbortSignal,
  ): Promise<DocConvertEnhanceResult> => {
    const response = await api.post(`/docs/${id}/convert-to-requirements/enhance`, payload, { timeout: 130000, signal });
    return response.data;
  },

  // Change impact analysis (AI risk assessment can take a while — longer timeout).
  // Accepts an AbortSignal so the caller can cancel the (paid) AI request when
  // the user closes the dialog before it finishes.
  analyzeImpact: async (id: number, payload: DocImpactRequest = {}, signal?: AbortSignal): Promise<DocImpactAnalysis> => {
    const response = await api.post(`/docs/${id}/impact-analysis`, payload, { timeout: 130000, signal });
    return response.data;
  },

  // Import / export
  importFile: async (spaceId: number, file: File, folderId?: number | null): Promise<DocListItem[]> => {
    const formData = new FormData();
    formData.append('space_id', String(spaceId));
    if (folderId != null) formData.append('folder_id', String(folderId));
    formData.append('file', file);
    const response = await api.post('/docs/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  exportDoc: async (id: number, filename: string): Promise<void> => {
    const response = await api.get(`/docs/${id}/export`, { responseType: 'blob' });
    triggerBlobDownload(response.data, filename, 'text/markdown');
  },
  exportSpace: async (id: number, filename: string): Promise<void> => {
    const response = await api.get(`/docs/spaces/${id}/export`, { responseType: 'blob' });
    triggerBlobDownload(response.data, filename, 'application/zip');
  },

  // Living release notes
  generateReleaseNotes: async (payload: ReleaseNotesGenerateRequest, signal?: AbortSignal): Promise<ReleaseNotesPreview> => {
    const response = await api.post('/docs/release-notes/generate', payload, { timeout: 130000, signal });
    return response.data;
  },
  listReleaseNotes: async (projectId: number, status?: ReleaseNoteStatus): Promise<ReleaseNoteListItem[]> => {
    const response = await api.get('/docs/release-notes', { params: { project_id: projectId, status } });
    return response.data;
  },
  getReleaseNote: async (id: number): Promise<ReleaseNote> => {
    const response = await api.get(`/docs/release-notes/${id}`);
    return response.data;
  },
  createReleaseNote: async (payload: ReleaseNoteCreate): Promise<ReleaseNote> => {
    const response = await api.post('/docs/release-notes', payload);
    return response.data;
  },
  updateReleaseNote: async (id: number, payload: ReleaseNoteUpdate): Promise<ReleaseNote> => {
    const response = await api.put(`/docs/release-notes/${id}`, payload);
    return response.data;
  },
  publishReleaseNote: async (id: number): Promise<ReleaseNote> => {
    const response = await api.post(`/docs/release-notes/${id}/publish`);
    return response.data;
  },
  unpublishReleaseNote: async (id: number): Promise<ReleaseNote> => {
    const response = await api.post(`/docs/release-notes/${id}/unpublish`);
    return response.data;
  },
  deleteReleaseNote: async (id: number): Promise<void> => {
    await api.delete(`/docs/release-notes/${id}`);
  },
};

// Project-wide requirement AI chat
export const requirementChatAPI = {
  listConversations: async (projectId: number, archived = false) => {
    const response = await api.get(`/projects/${projectId}/ai/conversations`, { params: { archived } });
    return response.data;
  },
  getConversation: async (projectId: number, conversationId: number) => {
    const response = await api.get(`/projects/${projectId}/ai/conversations/${conversationId}`);
    return response.data;
  },
  getConversationByLink: async (projectId: number, publicId: string) => {
    const response = await api.get(`/projects/${projectId}/ai/conversations/by-link/${publicId}`);
    return response.data;
  },
  createConversation: async (projectId: number) => {
    const response = await api.post(`/projects/${projectId}/ai/conversations`);
    return response.data;
  },
  updateConversation: async (projectId: number, conversationId: number, payload: {
    title?: string;
    archived?: boolean;
    pinned?: boolean;
    share_scope?: 'private' | 'project' | 'restricted';
    share_expires_at?: string | null;
    share_allowed_user_ids?: number[] | null;
  }) => {
    const response = await api.patch(`/projects/${projectId}/ai/conversations/${conversationId}`, payload);
    return response.data;
  },
  deleteConversation: async (projectId: number, conversationId: number) => {
    const response = await api.delete(`/projects/${projectId}/ai/conversations/${conversationId}`);
    return response.data;
  },
  ask: async (projectId: number, payload: { question: string; conversation_id?: number; source_types?: AISourceType[] }, signal?: AbortSignal) => {
    const response = await api.post(`/projects/${projectId}/ai/ask`, payload, { signal, timeout: 130000 });
    return response.data;
  },
  regenerate: async (projectId: number, conversationId: number, sourceTypes?: AISourceType[], signal?: AbortSignal) => {
    const response = await api.post(
      `/projects/${projectId}/ai/conversations/${conversationId}/regenerate`,
      { source_types: sourceTypes },
      { signal, timeout: 130000 },
    );
    return response.data;
  },
};
