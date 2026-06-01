import { api } from '@/lib/api';

export const projectImportExportAPI = {
  exportProjects: async (projectId?: number, format = 'json', includeData = true, fields?: string, statusFilter?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.append('project_id', projectId.toString());
    params.append('format', format);
    params.append('include_data', includeData.toString());
    if (fields) params.append('fields', fields);
    if (statusFilter) params.append('status_filter', statusFilter);
    // Trailing slash matches the backend route exactly; without it FastAPI
    // issues a 307 redirect (extra round trip, and the auth header can be
    // dropped on redirect).
    const response = await api.get(`/import-export/export/projects/?${params}`);
    return response.data;
  },
  
  importProjects: async (
    file: File,
    mergeStrategy = 'skip',
    partialImport = false,
    selectedRows?: number[],
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('merge_strategy', mergeStrategy);
    formData.append('partial_import', partialImport.toString());
    // When a subset of rows was chosen in the preview, only import those.
    if (selectedRows && selectedRows.length > 0) {
      formData.append('selected_rows', selectedRows.join(','));
    }
    // Trailing slash matches the backend route exactly. A 307 redirect on a
    // multipart POST is fragile (body/headers re-sent), so hit the real path.
    const response = await api.post('/import-export/import/projects/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  
  validateProjectImport: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/import-export/import/projects/validate', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  
  getProjectImportTemplate: async (format = 'json') => {
    const response = await api.get(`/import-export/import/projects/template?format=${format}`);
    return response.data;
  },
  
  downloadExport: (filename: string, content: string, mediaType: string) => {
    const blob = new Blob([content], { type: mediaType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
};
