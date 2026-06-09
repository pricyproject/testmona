import { Project, TestSuite, TestCase, TestRun, TestResult, User, TestRunStatistics, CustomFieldDefinition, CustomFieldValue, TestCaseWithCustomFields, JiraIntegration, JiraIssue, Notification, AuditTrail, AuditTrailList, AuditTrailFilters, ActivitySummary, EntityHistory, Requirement, RequirementCreate, RequirementUpdate, RequirementCoverageList, RequirementVersion, RequirementComment, RequirementFolder, Milestone, MilestoneCreate, MilestoneUpdate, MilestoneStats, SharedStep, SharedStepCreate, SharedStepUpdate, DocSpace, DocSpaceCreate, DocFolder, Doc, DocListItem, DocCreate, DocUpdate, DocVersion, DocRequirementLink, DocConvertRequest, DocConvertPreview, DocConvertResult, DocConvertEnhanceRequest, DocConvertEnhanceResult, DocShareInfo, DocShareScope, DocShareGrantCreate, DocShareAuditEntry, DocPublicView, DocStats, DocStatsOverview, DocRelatedLink, DocSuggestion, DocFacets, DocListPage, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocDuplicateCandidate, DocMergeResult, DocImpactRequest, DocImpactAnalysis, ReleaseNotesGenerateRequest, ReleaseNotesPreview, ReleaseNote, ReleaseNoteListItem, ReleaseNoteCreate, ReleaseNoteUpdate, ReleaseNoteStatus } from "@/types";
import { api, resolveProjectSeq, seqAPI, getApiErrorMessage } from "./client";

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
    const response = await api.get(`/import-export/export/test-cases/${params}`, {
      timeout: 300000,
    });
    return response.data as ExportTestCasesResult;
  },
  importTestCases: async (file: File, testSuiteId?: number, sectionId?: number, idempotencyKey?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (testSuiteId) formData.append('test_suite_id', testSuiteId.toString());
    if (sectionId) formData.append('section_id', sectionId.toString());
    
    const response = await api.post('/import-export/import/test-cases/', formData, {
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
