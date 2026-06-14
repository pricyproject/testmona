// Enhanced Defect Management API functions
import { api } from './api';

export interface DefectManagement {
  id: number;
  title: string;
  description?: string;
  defect_id: string;
  status: string;
  severity: string;
  priority: string;
  project_id: number;
  test_case_id?: number;
  test_run_id?: number;
  requirement_id?: number;
  reported_by: number;
  assigned_to?: number;
  tags?: string;
  steps_to_reproduce?: string;
  expected_result?: string;
  actual_result?: string;
  environment?: string;
  browser_info?: string;
  estimated_fix_time?: number;
  actual_fix_time?: number;
  external_issue_id?: string;
  external_issue_url?: string;
  external_sync_status?: string;
  resolution?: string;
  root_cause?: string;
  fix_version?: string;
  found_in_version?: string;
  duplicate_of?: number;
  created_at: string;
  updated_at?: string;
  reporter?: any;
  assignee?: any;
  test_case?: any;
  requirement?: any;
  comments?: DefectComment[];
  attachments?: DefectAttachment[];
  history?: DefectHistory[];
  duplicate?: DefectManagement;
}

export interface DefectComment {
  id: number;
  defect_id: number;
  parent_id?: number | null;
  user_id: number;
  comment: string;
  is_internal: boolean;
  created_at: string;
  updated_at?: string;
  author?: any;
}

export interface DefectAttachment {
  id: number;
  defect_id: number;
  filename: string;
  file_path: string;
  file_size?: number;
  mime_type?: string;
  uploaded_by: number;
  uploaded_at: string;
  uploader?: any;
}

export interface DefectHistory {
  id: number;
  defect_id: number;
  user_id: number;
  field_name: string;
  old_value?: string;
  new_value?: string;
  change_reason?: string;
  created_at: string;
  changed_by?: any;
}

export interface IssueTrackerIntegration {
  id: number;
  name: string;
  tracker_type: string;
  api_url: string;
  api_token?: string;
  username?: string;
  project_key?: string;
  sync_direction: string;
  sync_config?: any;
  is_active: boolean;
  project_id: number;
  last_sync?: string;
  sync_status: string;
  sync_error?: string;
  created_by: number;
  created_at: string;
  updated_at?: string;
  creator?: any;
}

export interface DefectTemplate {
  id: number;
  name: string;
  description?: string;
  template_data?: any;
  is_active: boolean;
  project_id: number;
  created_by: number;
  created_at: string;
  updated_at?: string;
  creator?: any;
}

export const defectManagementAPI = {
  // Defect Management
  getDefects: async (projectId: number, params?: {
    skip?: number;
    limit?: number;
    status?: string;
    severity?: string;
    priority?: string;
    assigned_to?: number;
    search?: string;
  }): Promise<DefectManagement[]> => {
    const response = await api.get(`/projects/${projectId}/defects-management`, { params });
    return response.data;
  },

  getDefectById: async (projectId: number, defectId: number): Promise<DefectManagement> => {
    const response = await api.get(`/projects/${projectId}/defects-management/${defectId}`);
    return response.data;
  },

  createDefect: async (projectId: number, defect: Partial<DefectManagement>): Promise<DefectManagement> => {
    const response = await api.post(`/projects/${projectId}/defects-management`, defect);
    return response.data;
  },

  updateDefect: async (projectId: number, defectId: number, defect: Partial<DefectManagement>): Promise<DefectManagement> => {
    const response = await api.put(`/projects/${projectId}/defects-management/${defectId}`, defect);
    return response.data;
  },

  deleteDefect: async (projectId: number, defectId: number): Promise<void> => {
    await api.delete(`/projects/${projectId}/defects-management/${defectId}`);
  },

  // Defect Comments
  getDefectComments: async (projectId: number, defectId: number, params?: {
    skip?: number;
    limit?: number;
  }): Promise<DefectComment[]> => {
    const response = await api.get(`/projects/${projectId}/defects-management/${defectId}/comments`, { params });
    return response.data;
  },

  createDefectComment: async (projectId: number, defectId: number, comment: {
    comment: string;
    is_internal?: boolean;
    parent_id?: number | null;
  }): Promise<DefectComment> => {
    const response = await api.post(`/projects/${projectId}/defects-management/${defectId}/comments`, comment);
    return response.data;
  },

  updateDefectComment: async (projectId: number, defectId: number, commentId: number, comment: {
    comment?: string;
    is_internal?: boolean;
  }): Promise<DefectComment> => {
    const response = await api.put(`/projects/${projectId}/defects-management/${defectId}/comments/${commentId}`, comment);
    return response.data;
  },

  deleteDefectComment: async (projectId: number, defectId: number, commentId: number): Promise<void> => {
    await api.delete(`/projects/${projectId}/defects-management/${defectId}/comments/${commentId}`);
  },

  // Defect Attachments
  getDefectAttachments: async (projectId: number, defectId: number): Promise<DefectAttachment[]> => {
    const response = await api.get(`/projects/${projectId}/defects-management/${defectId}/attachments`);
    return response.data;
  },

  uploadDefectAttachment: async (projectId: number, defectId: number, file: File): Promise<DefectAttachment> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await api.post(`/projects/${projectId}/defects-management/${defectId}/attachments`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  deleteDefectAttachment: async (projectId: number, defectId: number, attachmentId: number): Promise<void> => {
    await api.delete(`/projects/${projectId}/defects-management/${defectId}/attachments/${attachmentId}`);
  },

  // Defect History
  getDefectHistory: async (projectId: number, defectId: number, params?: {
    skip?: number;
    limit?: number;
  }): Promise<DefectHistory[]> => {
    const response = await api.get(`/projects/${projectId}/defects-management/${defectId}/history`, { params });
    return response.data;
  },

  // Issue Tracker Integrations
  getIssueTrackerIntegrations: async (projectId: number): Promise<IssueTrackerIntegration[]> => {
    const response = await api.get(`/projects/${projectId}/issue-tracker-integrations`);
    return response.data;
  },

  createIssueTrackerIntegration: async (projectId: number, integration: Partial<IssueTrackerIntegration>): Promise<IssueTrackerIntegration> => {
    const response = await api.post(`/projects/${projectId}/issue-tracker-integrations`, integration);
    return response.data;
  },

  updateIssueTrackerIntegration: async (projectId: number, integrationId: number, integration: Partial<IssueTrackerIntegration>): Promise<IssueTrackerIntegration> => {
    const response = await api.put(`/projects/${projectId}/issue-tracker-integrations/${integrationId}`, integration);
    return response.data;
  },

  deleteIssueTrackerIntegration: async (projectId: number, integrationId: number): Promise<void> => {
    await api.delete(`/projects/${projectId}/issue-tracker-integrations/${integrationId}`);
  },

  testIssueTrackerConnection: async (projectId: number, integrationId: number): Promise<any> => {
    const response = await api.post(`/projects/${projectId}/issue-tracker-integrations/${integrationId}/test-connection`);
    return response.data;
  },

  syncDefectWithExternal: async (projectId: number, defectId: number, syncData: {
    integration_id: number;
    sync_type?: string;
    action?: string;
  }): Promise<any> => {
    const response = await api.post(`/projects/${projectId}/defects-management/${defectId}/sync-with-external`, syncData);
    return response.data;
  },

  // Defect Templates
  getDefectTemplates: async (projectId: number): Promise<DefectTemplate[]> => {
    const response = await api.get(`/projects/${projectId}/defect-templates`);
    return response.data;
  },

  createDefectTemplate: async (projectId: number, template: Partial<DefectTemplate>): Promise<DefectTemplate> => {
    const response = await api.post(`/projects/${projectId}/defect-templates`, template);
    return response.data;
  },

  updateDefectTemplate: async (projectId: number, templateId: number, template: Partial<DefectTemplate>): Promise<DefectTemplate> => {
    const response = await api.put(`/projects/${projectId}/defect-templates/${templateId}`, template);
    return response.data;
  },

  deleteDefectTemplate: async (projectId: number, templateId: number): Promise<void> => {
    await api.delete(`/projects/${projectId}/defect-templates/${templateId}`);
  },
};
