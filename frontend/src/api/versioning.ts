import { api } from '@/lib/api';
import { TestCaseVersion, VersionComparisonResponse, VersionStatsResponse } from '../types/versioning';

// Routed through the shared axios client (`@/lib/api`) so every request carries
// the Bearer token and benefits from the 401-refresh / error handling used by
// the rest of the app. The backend versioning router is mounted at `/versioning`
// (no `/api` prefix), matching the axios baseURL.
const API_BASE = '/versioning';

export const versioningApi = {
  // Version CRUD operations
  async createVersion(testCaseId: number, versionData: any) {
    const response = await api.post(`${API_BASE}/test-cases/${testCaseId}/versions`, versionData);
    return response.data;
  },

  async getVersions(testCaseId: number): Promise<TestCaseVersion[]> {
    const response = await api.get(`${API_BASE}/test-cases/${testCaseId}/versions`);
    return response.data;
  },

  async getLatestVersion(testCaseId: number): Promise<TestCaseVersion | null> {
    const response = await api.get(`${API_BASE}/test-cases/${testCaseId}/versions/latest`);
    return response.data; // Returns null if no version exists
  },

  async getVersion(versionId: number): Promise<TestCaseVersion> {
    const response = await api.get(`${API_BASE}/versions/${versionId}`);
    return response.data;
  },

  async updateVersion(versionId: number, updateData: any): Promise<TestCaseVersion> {
    const response = await api.put(`${API_BASE}/versions/${versionId}`, updateData);
    return response.data;
  },

  async publishVersion(versionId: number): Promise<any> {
    const response = await api.post(`${API_BASE}/versions/${versionId}/publish`);
    return response.data;
  },

  // Comparison operations
  async compareVersions(fromVersionId: number, toVersionId: number): Promise<VersionComparisonResponse> {
    const response = await api.post(`${API_BASE}/versions/compare`, {
      from_version_id: fromVersionId,
      to_version_id: toVersionId,
    });
    return response.data;
  },

  // Branch operations
  async createBranch(parentVersionId: number, branchName: string, reason: string): Promise<TestCaseVersion> {
    const response = await api.post(`${API_BASE}/versions/branch`, {
      parent_version_id: parentVersionId,
      branch_name: branchName,
      reason: reason,
    });
    return response.data;
  },

  async mergeBranch(branchVersionId: number, targetVersionId: number, mergeReason: string): Promise<TestCaseVersion> {
    const response = await api.post(`${API_BASE}/versions/merge`, {
      branch_version_id: branchVersionId,
      target_version_id: targetVersionId,
      merge_reason: mergeReason,
    });
    return response.data;
  },

  // Rollback operations
  async rollbackToVersion(testCaseId: number, targetVersionId: number, reason: string): Promise<TestCaseVersion> {
    const response = await api.post(`${API_BASE}/test-cases/${testCaseId}/rollback`, {
      target_version_id: targetVersionId,
      reason: reason,
    });
    return response.data;
  },

  // Lock operations
  async lockVersion(testCaseId: number, versionId: number | null, lockType: string, reason: string, expiresHours: number = 24): Promise<any> {
    const response = await api.post(`${API_BASE}/lock`, {
      test_case_id: testCaseId,
      version_id: versionId,
      lock_type: lockType,
      reason: reason,
      expires_hours: expiresHours,
    });
    return response.data;
  },

  async releaseLocks(testCaseId: number, versionId?: number): Promise<void> {
    await api.delete(`${API_BASE}/lock/${testCaseId}`, {
      params: versionId != null ? { version_id: versionId } : undefined,
    });
  },

  // Tag operations
  async addTag(versionId: number, tagName: string, tagType: string = 'release', description?: string, color: string = '#007bff'): Promise<any> {
    const response = await api.post(`${API_BASE}/tags`, {
      version_id: versionId,
      tag_name: tagName,
      tag_type: tagType,
      description: description,
      color: color,
    });
    return response.data;
  },

  // History and stats
  async getVersionHistory(testCaseId: number): Promise<any> {
    const response = await api.get(`${API_BASE}/test-cases/${testCaseId}/history`);
    return response.data;
  },

  async getVersionStats(testCaseId: number): Promise<VersionStatsResponse> {
    const response = await api.get(`${API_BASE}/test-cases/${testCaseId}/stats`);
    return response.data;
  },

  // Bulk operations
  async bulkOperation(testCaseIds: number[], operation: string, parameters: any): Promise<any> {
    const response = await api.post(`${API_BASE}/bulk-operation`, {
      test_case_ids: testCaseIds,
      operation: operation,
      parameters: parameters,
    });
    return response.data;
  },
};
