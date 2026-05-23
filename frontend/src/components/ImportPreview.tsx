import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Eye, FileText, Folder, Loader2, RotateCcw, Save, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { CustomFieldDefinition } from '@/types';
import { ImportDuplicateMode, ImportMappedTestCaseRow, ImportProgressPhase, ImportTestCasesResult } from '@/lib/api';

interface ImportPreviewProps {
  file: File;
  testSuiteId: number;
  sectionId?: number;
  customFields: CustomFieldDefinition[];
  onConfirm: (
    validatedData: ImportMappedTestCaseRow[],
    options: { duplicateMode: ImportDuplicateMode; dryRun: boolean; filename?: string; idempotencyKey?: string; onProgress: (progress: ImportProgressState) => void },
  ) => Promise<ImportTestCasesResult>;
  onCancel: () => void;
  sections?: Array<{ id: string; name: string; parentId?: string; children?: Array<{ id: string; name: string; parentId?: string }> }>;
  existingTestCases?: Array<{ id: number; title: string }>;
}

interface ParsedRow {
  id: string;
  rowNumber: number;
  originalData: Record<string, string>;
  data: Record<string, string>;
  isEdited: boolean;
}

interface ValidatedRow extends ParsedRow {
  errors: string[];
  warnings: string[];
  isValid: boolean;
}

interface ColumnMapping {
  csvColumn: string;
  targetField: string;
  customFieldId?: number;
  confidence?: number;
}

interface ImportProgressState {
  phase: ImportProgressPhase | 'idle' | 'parsing';
  currentChunk?: number;
  totalChunks?: number;
  processedRows?: number;
  totalRows?: number;
  message?: string;
}

interface DuplicateInfo {
  isDuplicate: boolean;
  existingId?: number;
  duplicateInImport: boolean;
  effectiveAction: ImportDuplicateMode;
  suggestedTitle?: string;
}

interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
  warnings: string[];
}

type IssueFilter = 'all' | 'invalid' | 'duplicates' | 'warnings' | 'missing_required' | 'custom_field_errors';
type BulkEditableField = 'priority' | 'section_id' | 'created_at';

const IGNORE_FIELD = '__ignore__';
const CREATED_AT_COLUMN = 'created_at';
const MAX_PREVIEW_ROWS = 5000;
const VIRTUAL_ROW_HEIGHT = 230;
const VIRTUAL_OVERSCAN = 6;
const VIRTUAL_VIEWPORT_HEIGHT = 620;
const READONLY_EXPORT_COLUMNS = new Set(['id', 'test_suite_id', 'updated_at']);
const PRIORITY_VALUES = ['low', 'lowest', 'l', 'minor', 'trivial', 'medium', 'med', 'm', 'normal', 'regular', 'high', 'h', 'major', 'important', 'critical', 'crit', 'c', 'urgent', 'blocker'];
const TEST_TYPE_VALUES = ['manual', 'm', 'automated', 'auto', 'a', 'smoke', 's', 'regression', 'reg', 'r', 'integration', 'int', 'i', 'security', 'sec', 'performance', 'perf', 'p', 'usability', 'ux', 'compatibility', 'compat', 'exploratory', 'expl'];
const COMPACT_STANDARD_FIELDS = new Set(['priority', 'test_type', 'status', 'section_id', 'order_index', 'is_multistep', 'created_at']);
const MAX_MULTISTEP_PREVIEW_STEPS = 200;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const STANDARD_FIELDS = [
  { key: 'title', labelKey: 'title', required: true, type: 'text' },
  { key: 'description', labelKey: 'description', required: false, type: 'textarea' },
  { key: 'preconditions', labelKey: 'preconditions', required: false, type: 'textarea' },
  { key: 'steps', labelKey: 'testSteps', required: false, type: 'textarea' },
  { key: 'expected_result', labelKey: 'expectedResult', required: false, type: 'textarea' },
  { key: 'test_type', labelKey: 'testType', required: false, type: 'select', options: ['manual', 'automated', 'smoke', 'regression', 'integration', 'security', 'performance', 'usability', 'compatibility', 'exploratory'] },
  { key: 'priority', labelKey: 'priority', required: false, type: 'select', options: ['low', 'medium', 'high', 'critical'] },
  { key: 'status', labelKey: 'status', required: false, type: 'select', options: ['active', 'inactive', 'archived'] },
  { key: 'reference', labelKey: 'reference', required: false, type: 'text' },
  { key: 'external_key', labelKey: 'externalKey', required: false, type: 'text' },
  { key: 'tags', labelKey: 'tags', required: false, type: 'text' },
  { key: 'section_id', labelKey: 'section', required: false, type: 'number' },
  { key: 'order_index', labelKey: 'orderIndex', required: false, type: 'number' },
  { key: 'is_multistep', labelKey: 'fieldIsMultistep', required: false, type: 'boolean' },
  { key: 'multistep_data', labelKey: 'multistepData', required: false, type: 'textarea' },
  { key: 'created_at', labelKey: 'created', required: false, type: 'datetime-local' },
] as const;

type StandardFieldKey = typeof STANDARD_FIELDS[number]['key'];

const FIELD_ALIASES: Record<string, string[]> = {
  title: ['title', 'name', 'testcase', 'test case', 'case title', 'summary'],
  description: ['description', 'desc', 'details'],
  preconditions: ['preconditions', 'precondition', 'pre cond', 'setup', 'prerequisite', 'prerequisites'],
  steps: ['steps', 'step', 'test steps', 'procedure', 'actions', 'action'],
  expected_result: ['expected result', 'expected', 'result', 'outcome'],
  test_type: ['test type', 'type', 'category', 'test_type'],
  priority: ['priority', 'prio', 'severity', 'urgency'],
  status: ['status', 'state'],
  reference: ['reference', 'ref', 'requirement', 'ticket', 'issue'],
  external_key: ['external key', 'external_key', 'external id', 'external_id'],
  tags: ['tags', 'tag', 'labels', 'label'],
  section_id: ['section id', 'section_id', 'folder id'],
  order_index: ['order index', 'order', 'sort order', 'order_index'],
  is_multistep: ['is multistep', 'multi step', 'multistep', 'is_multistep'],
  multistep_data: ['multistep data', 'test case steps', 'test steps json', 'multistep_data'],
  created_at: ['created', 'created at', 'creation time', 'created_at'],
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
const normalizeTitle = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const getDefaultCreatedAt = () => {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
};

const withDefaultCreatedAt = (row: Record<string, string>, defaultCreatedAt: string, createdAtColumn: string) => ({
  ...row,
  [createdAtColumn]: row[createdAtColumn]?.trim() ? row[createdAtColumn] : defaultCreatedAt,
});

const getImportedCopyTitle = (title: string, usedTitles: Set<string>) => {
  const today = new Date().toISOString().slice(0, 10);
  let candidate = `${title} (Imported ${today})`;
  let counter = 2;
  while (usedTitles.has(normalizeTitle(candidate))) {
    candidate = `${title} (Imported ${today} ${counter})`;
    counter += 1;
  }
  return candidate;
};

const isValidDateTime = (value: string) => {
  if (!value.trim()) {
    return true;
  }
  return !Number.isNaN(Date.parse(value));
};

const getCustomFieldOptions = (field: CustomFieldDefinition): string[] => {
  if (Array.isArray(field.options)) {
    return field.options.map(String);
  }

  if (field.options && typeof field.options === 'object') {
    const rawOptions = (field.options as Record<string, unknown>).options;
    return Array.isArray(rawOptions) ? rawOptions.map(String) : Object.values(field.options).map(String);
  }

  return [];
};

const flattenSections = (sections: ImportPreviewProps['sections'] = []) => {
  const flattened: Array<{ id: string; name: string; depth: number }> = [];

  const walk = (items: NonNullable<ImportPreviewProps['sections']>, depth: number) => {
    items.forEach((section) => {
      flattened.push({ id: section.id, name: section.name, depth });
      if (section.children?.length) {
        walk(section.children, depth + 1);
      }
    });
  };

  walk(sections, 0);
  return flattened;
};

const parseCSVText = (text: string): CsvParseResult => {
  const source = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field.trim());
      if (row.some((value) => value.trim() !== '')) {
        records.push(row);
      }
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    errors.push('CSV has an unclosed quoted value.');
  }

  row.push(field.trim());
  if (row.some((value) => value.trim() !== '')) {
    records.push(row);
  }

  if (records.length === 0) {
    return { headers: [], rows: [], errors: ['CSV file is empty.'], warnings };
  }

  const seenHeaders = new Map<string, number>();
  const headers = records[0].map((header, index) => {
    const fallback = header || `Column ${index + 1}`;
    const count = seenHeaders.get(fallback) || 0;
    seenHeaders.set(fallback, count + 1);
    if (count > 0) {
      warnings.push(`Duplicate column "${fallback}" was renamed to "${fallback} (${count + 1})".`);
      return `${fallback} (${count + 1})`;
    }
    return fallback;
  });

  const rows = records.slice(1, MAX_PREVIEW_ROWS + 1).map((record) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      item[header] = record[index] ?? '';
    });
    return item;
  });

  if (records.length - 1 > MAX_PREVIEW_ROWS) {
    warnings.push(`Only the first ${MAX_PREVIEW_ROWS} data rows are loaded for import. Split the file before importing more rows.`);
  }

  return { headers, rows, errors, warnings };
};

const validateMultistepData = (value: string, t: (key: any, params?: Record<string, string | number>) => string): string[] => {
  if (!value.trim()) {
    return [];
  }

  try {
    const steps = JSON.parse(value);
    if (!Array.isArray(steps)) {
      return [t('importMultistepMustBeArray')];
    }
    if (steps.length > MAX_MULTISTEP_PREVIEW_STEPS) {
      return [t('importMultistepTooManySteps', { count: MAX_MULTISTEP_PREVIEW_STEPS })];
    }

    const errors: string[] = [];
    steps.forEach((step, index) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        errors.push(t('importMultistepStepMustBeObject', { row: index + 1 }));
        return;
      }

      const stepNumber = Number((step as Record<string, unknown>).step_number ?? index + 1);
      if (!Number.isInteger(stepNumber) || stepNumber <= 0) {
        errors.push(t('importMultistepInvalidStepNumber', { row: index + 1 }));
      }
      if (!String((step as Record<string, unknown>).action || '').trim()) {
        errors.push(t('importMultistepActionRequired', { row: index + 1 }));
      }
      if (!String((step as Record<string, unknown>).expected_result || '').trim()) {
        errors.push(t('importMultistepExpectedRequired', { row: index + 1 }));
      }
      const data = (step as Record<string, unknown>).data;
      if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) {
        errors.push(t('importMultistepDataMustBeObject', { row: index + 1 }));
      }
    });
    return errors;
  } catch {
    return [t('importMultistepInvalidJson')];
  }
};

export function ImportPreview({ file, testSuiteId, sectionId, customFields, onConfirm, onCancel, sections = [], existingTestCases = [] }: ImportPreviewProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [step, setStep] = useState<'mapping' | 'preview'>('mapping');
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>(sectionId?.toString() || 'none');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [bulkEditField, setBulkEditField] = useState<BulkEditableField>('priority');
  const [bulkEditValue, setBulkEditValue] = useState('medium');
  const [isImporting, setIsImporting] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState<ImportDuplicateMode>('skip_duplicates');
  const [rowActions, setRowActions] = useState<Record<string, ImportDuplicateMode>>({});
  const [progress, setProgress] = useState<ImportProgressState>({ phase: 'idle' });
  const [lastResult, setLastResult] = useState<ImportTestCasesResult | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const csvReadFailedMessageRef = useRef(t('importCsvReadFailed'));

  useEffect(() => {
    csvReadFailedMessageRef.current = t('importCsvReadFailed');
  }, [t]);

  const sectionOptions = useMemo(() => flattenSections(sections), [sections]);
  const sectionIdSet = useMemo(() => new Set(sectionOptions.map((section) => section.id)), [sectionOptions]);
  const mappingByColumn = useMemo(() => new Map(columnMapping.map((mapping) => [mapping.csvColumn, mapping])), [columnMapping]);
  const mappingPresetKey = useMemo(() => `test-case-import-mapping:${testSuiteId}:${file.name.split('.').pop()?.toLowerCase() || 'csv'}`, [file.name, testSuiteId]);
  const idempotencyStorageKey = useMemo(() => `test-case-import-idempotency:${testSuiteId}:${file.name}:${file.size}:${file.lastModified}`, [file.lastModified, file.name, file.size, testSuiteId]);
  const fieldTypeByColumn = useMemo(() => {
    const next = new Map<string, string>();
    columnMapping.forEach((mapping) => {
      if (!mapping.targetField) {
        next.set(mapping.csvColumn, 'text');
        return;
      }
      if (mapping.targetField === 'custom_field') {
        next.set(mapping.csvColumn, customFields.find((field) => field.id === mapping.customFieldId)?.field_type || 'text');
        return;
      }
      next.set(mapping.csvColumn, STANDARD_FIELDS.find((field) => field.key === mapping.targetField)?.type || 'text');
    });
    return next;
  }, [columnMapping, customFields]);

  const autoMapColumns = useCallback((headers: string[]): ColumnMapping[] => {
    const usedStandardFields = new Set<string>();

    return headers.map((column) => {
      const normalizedColumn = normalizeHeader(column.replace(/ \(\d+\)$/, ''));
      if (READONLY_EXPORT_COLUMNS.has(normalizedColumn.replace(/ /g, '_'))) {
        return { csvColumn: column, targetField: '' };
      }
      const customField = customFields.find((field) => {
        const names = [field.name, field.slug || ''].map(normalizeHeader).filter(Boolean);
        return names.some((name) => name === normalizedColumn || name.includes(normalizedColumn) || normalizedColumn.includes(name));
      });

      if (customField) {
        return { csvColumn: column, targetField: 'custom_field', customFieldId: customField.id, confidence: 95 };
      }

      for (const field of STANDARD_FIELDS) {
        if (usedStandardFields.has(field.key)) {
          continue;
        }

        const aliases = FIELD_ALIASES[field.key] || [field.key];
        const exactMatch = aliases.some((alias) => normalizeHeader(alias) === normalizedColumn);
        const partialMatch = aliases.some((alias) => normalizedColumn.includes(normalizeHeader(alias)));

        if (exactMatch || partialMatch) {
          usedStandardFields.add(field.key);
          return { csvColumn: column, targetField: field.key, confidence: exactMatch ? 100 : 75 };
        }
      }

      return { csvColumn: column, targetField: '' };
    });
  }, [customFields]);

  useEffect(() => {
    let cancelled = false;
    let parseTimer: ReturnType<typeof setTimeout> | undefined;
    const reader = new FileReader();
    setIsParsing(true);
    setAvailableColumns([]);
    setParsedRows([]);
    setColumnMapping([]);
    setProgress({ phase: 'parsing', message: t('importPhaseParsing') });
    setLastResult(null);
    setRowActions({});
    setIssueFilter('all');
    setVirtualScrollTop(0);

    reader.onload = (event) => {
      const text = String(event.target?.result || '');
      parseTimer = setTimeout(() => {
        if (cancelled) return;
        const result = parseCSVText(text);
        const createdAtColumn = result.headers.find((header) => normalizeHeader(header).replace(/ /g, '_') === CREATED_AT_COLUMN) || CREATED_AT_COLUMN;
        const hasCreatedAtColumn = createdAtColumn !== CREATED_AT_COLUMN || result.headers.includes(CREATED_AT_COLUMN);
        const defaultCreatedAt = getDefaultCreatedAt();
        const headers = hasCreatedAtColumn ? result.headers : [...result.headers, CREATED_AT_COLUMN];
        setAvailableColumns(headers);
        setParsedRows(result.rows.map((row, index) => {
          const rowData = withDefaultCreatedAt(row, defaultCreatedAt, createdAtColumn);
          return {
            id: `row-${index + 2}`,
            rowNumber: index + 2,
            originalData: rowData,
            data: rowData,
            isEdited: false,
          };
        }));
        let nextMapping = autoMapColumns(headers);
        try {
          const savedMappings = JSON.parse(localStorage.getItem(mappingPresetKey) || '[]') as ColumnMapping[];
          if (Array.isArray(savedMappings)) {
            nextMapping = nextMapping.map((mapping) => {
              const saved = savedMappings.find((item) => item.csvColumn === mapping.csvColumn);
              if (!saved?.targetField) return mapping;
              const customFieldExists = saved.targetField !== 'custom_field' || customFields.some((field) => field.id === saved.customFieldId);
              const standardFieldExists = saved.targetField === 'custom_field' || STANDARD_FIELDS.some((field) => field.key === saved.targetField);
              return customFieldExists && standardFieldExists ? { ...mapping, ...saved, confidence: undefined } : mapping;
            });
          }
        } catch {
          // Ignore corrupt mapping presets and fall back to smart auto-mapping.
        }
        setColumnMapping(nextMapping);
        setParseErrors(result.errors);
        setParseWarnings(result.warnings);
        setStep('mapping');
        setIsParsing(false);
        setProgress({ phase: 'validating', processedRows: result.rows.length, totalRows: result.rows.length, message: t('importPhaseValidating') });
      }, 0);
    };
    reader.onerror = () => {
      if (cancelled) return;
      setParseErrors([csvReadFailedMessageRef.current]);
      setParseWarnings([]);
      setAvailableColumns([]);
      setParsedRows([]);
      setColumnMapping([]);
      setIsParsing(false);
    };
    reader.readAsText(file);

    return () => {
      cancelled = true;
      if (parseTimer) clearTimeout(parseTimer);
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [autoMapColumns, customFields, file, mappingPresetKey, t]);

  useEffect(() => {
    if (isParsing || columnMapping.length === 0) {
      return;
    }

    try {
      localStorage.setItem(mappingPresetKey, JSON.stringify(columnMapping.map(({ csvColumn, targetField, customFieldId }) => ({ csvColumn, targetField, customFieldId }))));
    } catch {
      // Mapping presets are a convenience only; import should continue if storage is unavailable.
    }
  }, [columnMapping, isParsing, mappingPresetKey]);

  const titleMapped = useMemo(() => columnMapping.some((mapping) => mapping.targetField === 'title'), [columnMapping]);
  const duplicateMappedFields = useMemo(() => {
    const counts = new Map<string, number>();
    columnMapping.forEach((mapping) => {
      if (!mapping.targetField) {
        return;
      }
      const key = mapping.targetField === 'custom_field' ? `custom_${mapping.customFieldId}` : mapping.targetField;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([field]) => field);
  }, [columnMapping]);
  const hasDuplicateMappedFields = duplicateMappedFields.length > 0;
  const lowConfidenceMappings = useMemo(() => (
    columnMapping.filter((mapping) => mapping.targetField && mapping.confidence !== undefined && mapping.confidence < 90)
  ), [columnMapping]);

  const validateRow = useCallback((row: ParsedRow): ValidatedRow => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const mappedValues = new Map<string, string>();

    columnMapping.forEach((mapping) => {
      if (!mapping.targetField) {
        return;
      }
      const key = mapping.targetField === 'custom_field' ? `custom_${mapping.customFieldId}` : mapping.targetField;
      if (mappedValues.has(key)) {
        return;
      }
      mappedValues.set(key, row.data[mapping.csvColumn] || '');
    });

    const title = mappedValues.get('title') || '';
    if (hasDuplicateMappedFields) {
      errors.push(t('importDuplicateMappedFields'));
    }
    if (!title.trim()) {
      errors.push(t('importTitleRequired'));
    } else if (title.trim().length > 255) {
      errors.push(t('importTitleTooLong'));
    }

    const priority = mappedValues.get('priority');
    if (priority && !PRIORITY_VALUES.includes(priority.toLowerCase().trim())) {
      errors.push(t('importInvalidPriority', { value: priority }));
    }

    const testType = mappedValues.get('test_type');
    if (testType && !TEST_TYPE_VALUES.includes(testType.toLowerCase().trim())) {
      errors.push(t('importInvalidTestType', { value: testType }));
    }

    const status = mappedValues.get('status');
    if (status && !['active', 'inactive', 'archived'].includes(status.toLowerCase().trim())) {
      errors.push(t('importInvalidStatus', { value: status }));
    }

    const reference = mappedValues.get('reference');
    if (reference && reference.trim().length > 255) {
      errors.push(t('importReferenceTooLong'));
    }

    const tags = mappedValues.get('tags');
    if (tags && tags.trim().length > 500) {
      errors.push(t('importTagsTooLong'));
    }

    const orderIndex = mappedValues.get('order_index');
    if (orderIndex && !Number.isInteger(Number(orderIndex))) {
      errors.push(t('importInvalidOrderIndex', { value: orderIndex }));
    }

    const rowSectionId = mappedValues.get('section_id');
    if (rowSectionId && (!Number.isInteger(Number(rowSectionId)) || Number(rowSectionId) <= 0)) {
      errors.push(t('importInvalidSectionId', { value: rowSectionId }));
    } else if (rowSectionId && sectionIdSet.size > 0 && !sectionIdSet.has(rowSectionId.trim())) {
      errors.push(t('importSectionNotInCurrentSuite', { value: rowSectionId }));
    }

    const isMultistep = mappedValues.get('is_multistep');
    if (isMultistep && !['true', 'false', '1', '0', 'yes', 'no'].includes(isMultistep.toLowerCase().trim())) {
      errors.push(t('importInvalidBoolean', { value: isMultistep }));
    }
    const multistepData = mappedValues.get('multistep_data') || '';
    const isMultistepEnabled = isMultistep ? ['true', '1', 'yes'].includes(isMultistep.toLowerCase().trim()) : false;
    if (isMultistepEnabled && multistepData.trim()) {
      errors.push(...validateMultistepData(multistepData, t));
    }

    customFields.forEach((field) => {
      const value = mappedValues.get(`custom_${field.id}`) || '';
      if (field.is_required && !value.trim()) {
        errors.push(t('fieldRequired', { field: field.name }));
      }

      if (!value.trim()) {
        return;
      }

      if (field.field_type === 'number' && Number.isNaN(Number(value))) {
        errors.push(t('fieldMustBeNumber', { field: field.name }));
      }

      if (field.field_type === 'select') {
        const options = getCustomFieldOptions(field);
        if (options.length > 0 && !options.includes(value)) {
          errors.push(t('fieldMustBeOneOf', { field: field.name, options: options.join(', ') }));
        }
      }

      if (field.field_type === 'multiselect') {
        const options = getCustomFieldOptions(field);
        const values = value.split(',').map((item) => item.trim()).filter(Boolean);
        const invalidValues = values.filter((item) => !options.includes(item));
        if (options.length > 0 && invalidValues.length > 0) {
          errors.push(t('fieldMustBeOneOf', { field: field.name, options: options.join(', ') }));
        }
      }
    });

    if (!mappedValues.has('priority')) {
      warnings.push(t('importDefaultPriorityWarning'));
    }
    if (!mappedValues.has('test_type')) {
      warnings.push(t('importDefaultTestTypeWarning'));
    }

    return { ...row, errors, warnings, isValid: errors.length === 0 };
  }, [columnMapping, customFields, hasDuplicateMappedFields, sectionIdSet, t]);

  const validatedRows = useMemo(() => parsedRows.map(validateRow), [parsedRows, validateRow]);

  const stats = useMemo(() => {
    const total = validatedRows.length;
    const valid = validatedRows.filter((row) => row.isValid).length;
    const invalid = total - valid;
    const warnings = validatedRows.filter((row) => row.warnings.length > 0).length + parseWarnings.length;
    const edited = validatedRows.filter((row) => row.isEdited).length;
    return { total, valid, invalid, warnings, edited };
  }, [parseWarnings.length, validatedRows]);

  const previewColumns = useMemo(() => (
    availableColumns.filter((column) => Boolean(mappingByColumn.get(column)?.targetField))
  ), [availableColumns, mappingByColumn]);
  const primaryPreviewColumns = useMemo(() => (
    previewColumns.filter((column) => {
      const mapping = mappingByColumn.get(column);
      return mapping?.targetField === 'title' || Boolean(mapping?.targetField && COMPACT_STANDARD_FIELDS.has(mapping.targetField));
    })
  ), [mappingByColumn, previewColumns]);
  const detailPreviewColumns = useMemo(() => (
    previewColumns.filter((column) => !primaryPreviewColumns.includes(column))
  ), [previewColumns, primaryPreviewColumns]);
  const ignoredColumnCount = availableColumns.length - previewColumns.length;
  const titlePreviewColumn = useMemo(() => (
    previewColumns.find((column) => mappingByColumn.get(column)?.targetField === 'title')
  ), [mappingByColumn, previewColumns]);
  const selectedSectionName = useMemo(() => {
    if (selectedSectionId === 'none') {
      return t('noSection');
    }
    return sectionOptions.find((section) => section.id === selectedSectionId)?.name || `${t('section')} ${selectedSectionId}`;
  }, [sectionOptions, selectedSectionId, t]);
  const existingTitleMap = useMemo(() => new Map(existingTestCases.map((item) => [normalizeTitle(item.title), item.id])), [existingTestCases]);
  const duplicateInfoByRow = useMemo(() => {
    const info = new Map<string, DuplicateInfo>();
    const seen = new Set<string>();
    const usedTitles = new Set(existingTitleMap.keys());

    validatedRows.forEach((row) => {
      const title = titlePreviewColumn ? row.data[titlePreviewColumn]?.trim() : '';
      const normalizedTitle = normalizeTitle(title);
      const existingId = normalizedTitle ? existingTitleMap.get(normalizedTitle) : undefined;
      const duplicateInImport = Boolean(normalizedTitle && seen.has(normalizedTitle));
      const isDuplicate = Boolean(existingId || duplicateInImport);
      const effectiveAction = rowActions[row.id] || duplicateMode;
      const suggestedTitle = isDuplicate ? getImportedCopyTitle(title || `${t('row')} ${row.rowNumber}`, usedTitles) : undefined;

      info.set(row.id, { isDuplicate, existingId, duplicateInImport, effectiveAction, suggestedTitle });
      if (normalizedTitle) {
        seen.add(normalizedTitle);
        usedTitles.add(normalizedTitle);
      }
      if (suggestedTitle && effectiveAction === 'create_copy') {
        usedTitles.add(normalizeTitle(suggestedTitle));
      }
    });

    return info;
  }, [duplicateMode, existingTitleMap, rowActions, t, titlePreviewColumn, validatedRows]);
  const importSummary = useMemo(() => {
    let duplicates = 0;
    let willImport = 0;
    let newRows = 0;

    validatedRows.forEach((row) => {
      const duplicateInfo = duplicateInfoByRow.get(row.id);
      if (duplicateInfo?.isDuplicate) {
        duplicates += 1;
      } else if (row.isValid) {
        newRows += 1;
      }
      if (row.isValid && (!duplicateInfo?.isDuplicate || !['skip_duplicates', 'create_only'].includes(duplicateInfo.effectiveAction))) {
        willImport += 1;
      }
    });

    return {
      newRows,
      duplicates,
      invalid: stats.invalid,
      willImport,
    };
  }, [duplicateInfoByRow, stats.invalid, validatedRows]);

  const missingRequiredMessages = useMemo(() => new Set([
    t('importTitleRequired'),
    ...customFields.map((field) => t('fieldRequired', { field: field.name })),
  ]), [customFields, t]);

  const rowHasMissingRequired = useCallback((row: ValidatedRow) => (
    row.errors.some((error) => missingRequiredMessages.has(error) || error.toLowerCase().includes('required'))
  ), [missingRequiredMessages]);

  const rowHasCustomFieldError = useCallback((row: ValidatedRow) => (
    row.errors.some((error) => customFields.some((field) => error.includes(field.name)))
  ), [customFields]);

  const issueCounts = useMemo(() => ({
    all: validatedRows.length,
    invalid: validatedRows.filter((row) => !row.isValid).length,
    duplicates: validatedRows.filter((row) => duplicateInfoByRow.get(row.id)?.isDuplicate).length,
    warnings: validatedRows.filter((row) => row.warnings.length > 0).length,
    missing_required: validatedRows.filter(rowHasMissingRequired).length,
    custom_field_errors: validatedRows.filter(rowHasCustomFieldError).length,
  }), [duplicateInfoByRow, rowHasCustomFieldError, rowHasMissingRequired, validatedRows]);

  const filteredRows = useMemo(() => {
    switch (issueFilter) {
      case 'invalid':
        return validatedRows.filter((row) => !row.isValid);
      case 'duplicates':
        return validatedRows.filter((row) => duplicateInfoByRow.get(row.id)?.isDuplicate);
      case 'warnings':
        return validatedRows.filter((row) => row.warnings.length > 0);
      case 'missing_required':
        return validatedRows.filter(rowHasMissingRequired);
      case 'custom_field_errors':
        return validatedRows.filter(rowHasCustomFieldError);
      default:
        return validatedRows;
    }
  }, [duplicateInfoByRow, issueFilter, rowHasCustomFieldError, rowHasMissingRequired, validatedRows]);

  useEffect(() => {
    setVirtualScrollTop(0);
    previewScrollRef.current?.scrollTo({ top: 0 });
  }, [issueFilter]);

  const virtualRows = useMemo(() => {
    const visibleCount = Math.ceil(VIRTUAL_VIEWPORT_HEIGHT / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    const maxStartIndex = Math.max(0, filteredRows.length - visibleCount);
    const startIndex = Math.min(maxStartIndex, Math.max(0, Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN));
    const endIndex = Math.min(filteredRows.length, startIndex + visibleCount);
    return {
      rows: filteredRows.slice(startIndex, endIndex),
      startIndex,
      offsetTop: startIndex * VIRTUAL_ROW_HEIGHT,
      bottomPadding: Math.max(0, (filteredRows.length - endIndex) * VIRTUAL_ROW_HEIGHT),
      totalHeight: filteredRows.length * VIRTUAL_ROW_HEIGHT,
    };
  }, [filteredRows, virtualScrollTop]);

  const allValidRowsSkippedAsDuplicates = stats.valid > 0 && importSummary.willImport === 0 && importSummary.duplicates >= stats.valid;

  const updateMapping = (csvColumn: string, value: string) => {
    setColumnMapping((previous) => previous.map((mapping) => {
      const isCurrentColumn = mapping.csvColumn === csvColumn;
      const nextTargetField = value.startsWith('custom_') ? 'custom_field' : value;
      const nextCustomFieldId = value.startsWith('custom_') ? Number(value.replace('custom_', '')) : undefined;

      if (!isCurrentColumn && value !== IGNORE_FIELD) {
        const sameStandardField = mapping.targetField === nextTargetField && nextTargetField !== 'custom_field';
        const sameCustomField = mapping.targetField === 'custom_field' && nextTargetField === 'custom_field' && mapping.customFieldId === nextCustomFieldId;
        if (sameStandardField || sameCustomField) {
          return { ...mapping, targetField: '', customFieldId: undefined, confidence: undefined };
        }
      }

      if (mapping.csvColumn !== csvColumn) {
        return mapping;
      }

      if (value === IGNORE_FIELD) {
        return { ...mapping, targetField: '', customFieldId: undefined, confidence: undefined };
      }

      if (value.startsWith('custom_')) {
        return { ...mapping, targetField: 'custom_field', customFieldId: Number(value.replace('custom_', '')), confidence: undefined };
      }

      return { ...mapping, targetField: value, customFieldId: undefined, confidence: undefined };
    }));
  };

  const updateCellValue = (rowId: string, csvColumn: string, value: string) => {
    setParsedRows((previous) => previous.map((row) => (
      row.id === rowId ? { ...row, data: { ...row.data, [csvColumn]: value }, isEdited: true } : row
    )));
  };

  const resetEdits = () => {
    setParsedRows((previous) => previous.map((row) => ({ ...row, data: row.originalData, isEdited: false })));
  };

  const ensureStandardFieldColumn = (fieldKey: StandardFieldKey) => {
    const existingColumn = columnMapping.find((mapping) => mapping.targetField === fieldKey)?.csvColumn;
    if (existingColumn) {
      return existingColumn;
    }

    let column: string = fieldKey;
    let index = 2;
    while (availableColumns.includes(column)) {
      column = `${fieldKey}_${index}`;
      index += 1;
    }

    setAvailableColumns((previous) => [...previous, column]);
    setColumnMapping((previous) => [...previous, { csvColumn: column, targetField: fieldKey }]);
    setParsedRows((previous) => previous.map((row) => ({
      ...row,
      originalData: { ...row.originalData, [column]: '' },
      data: { ...row.data, [column]: '' },
    })));
    return column;
  };

  const applyBulkEdit = (fieldKey: BulkEditableField, value: string, onlyEmpty = false) => {
    const column = ensureStandardFieldColumn(fieldKey);
    setParsedRows((previous) => previous.map((row) => {
      const currentValue = row.data[column] || '';
      if (onlyEmpty && currentValue.trim()) {
        return row;
      }
      return {
        ...row,
        data: { ...row.data, [column]: value },
        isEdited: true,
      };
    }));
  };

  const handleBulkFieldChange = (value: BulkEditableField) => {
    setBulkEditField(value);
    if (value === 'priority') setBulkEditValue('medium');
    if (value === 'created_at') setBulkEditValue(getDefaultCreatedAt());
    if (value === 'section_id') setBulkEditValue(selectedSectionId !== 'none' ? selectedSectionId : '');
  };

  const getMappingValue = (mapping?: ColumnMapping) => {
    if (!mapping?.targetField) {
      return IGNORE_FIELD;
    }
    return mapping.targetField === 'custom_field' ? `custom_${mapping.customFieldId}` : mapping.targetField;
  };

  const getRequiredMappingLabel = (mapping?: ColumnMapping) => {
    if (!mapping?.targetField) {
      return '';
    }
    if (mapping.targetField === 'custom_field') {
      return customFields.find((field) => field.id === mapping.customFieldId)?.is_required ? t('required') : '';
    }
    return STANDARD_FIELDS.find((field) => field.key === mapping.targetField)?.required ? t('required') : '';
  };

  const getCoverageLabel = (column: string, mapping?: ColumnMapping) => {
    const normalizedColumn = normalizeHeader(column.replace(/ \(\d+\)$/, '')).replace(/ /g, '_');
    if (READONLY_EXPORT_COLUMNS.has(normalizedColumn)) {
      return t('fieldCoverageReadOnly');
    }
    if (!mapping?.targetField) {
      return t('fieldCoverageNeedsMapping');
    }
    return mapping.targetField === 'custom_field' || STANDARD_FIELDS.some((field) => field.key === mapping.targetField)
      ? t('fieldCoverageSupported')
      : t('fieldCoverageIgnored');
  };

  const getPreviewFieldLabel = (column: string) => {
    const mapping = mappingByColumn.get(column);
    if (!mapping?.targetField) {
      return column;
    }
    if (mapping.targetField === 'custom_field') {
      return customFields.find((field) => field.id === mapping.customFieldId)?.name || column;
    }
    const standardField = STANDARD_FIELDS.find((field) => field.key === mapping.targetField);
    return standardField ? t(standardField.labelKey as any) : column;
  };

  const getPreviewFieldClass = (column: string) => {
    const mapping = mappingByColumn.get(column);
    const type = fieldTypeByColumn.get(column);
    if (type === 'textarea' || mapping?.targetField === 'multistep_data') {
      return 'md:col-span-2';
    }
    if (mapping?.targetField === 'title') {
      return 'md:col-span-2';
    }
    return '';
  };

  const getPreviewRowTitle = (row: ValidatedRow) => {
    const title = titlePreviewColumn ? row.data[titlePreviewColumn]?.trim() : '';
    return title || `${t('row')} ${row.rowNumber}`;
  };

  const renderPreviewField = (row: ValidatedRow, column: string, compact = false) => {
    const mapping = mappingByColumn.get(column);
    const requiredMappingLabel = getRequiredMappingLabel(mapping);

    return (
      <div key={column} className={`min-w-0 ${compact ? '' : getPreviewFieldClass(column)}`}>
        <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
          <Label className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title={column}>
            {getPreviewFieldLabel(column)}
          </Label>
          {requiredMappingLabel ? <span className="text-[11px] font-medium text-destructive">{requiredMappingLabel}</span> : null}
        </div>
        {renderEditableCell(row, column)}
      </div>
    );
  };

  const prepareImportRows = (): ImportMappedTestCaseRow[] => validatedRows
    .filter((row) => row.isValid)
    .map((row) => {
      const payload: ImportMappedTestCaseRow = {
        row_number: row.rowNumber,
        title: '',
        test_suite_id: testSuiteId,
        section_id: selectedSectionId !== 'none' ? Number(selectedSectionId) : undefined,
        priority: 'medium',
        test_type: 'manual',
        import_action: duplicateInfoByRow.get(row.id)?.effectiveAction || duplicateMode,
        duplicate_hint: duplicateInfoByRow.get(row.id)?.isDuplicate || false,
        custom_field_values: [],
      };

      columnMapping.forEach((mapping) => {
        if (!mapping.targetField) {
          return;
        }

        const value = row.data[mapping.csvColumn]?.trim() || '';
        if (mapping.targetField === 'custom_field' && mapping.customFieldId) {
          if (value) {
            payload.custom_field_values?.push({ field_definition_id: mapping.customFieldId, value });
          }
          return;
        }

        if (value || mapping.targetField === 'title') {
          const targetPayload = payload as unknown as Record<string, unknown>;
          if (mapping.targetField === 'section_id') {
            if (value) {
              targetPayload.section_id = Number(value);
            }
          } else if (mapping.targetField === 'order_index') {
            targetPayload.order_index = value ? Number(value) : 0;
          } else if (mapping.targetField === 'is_multistep') {
            targetPayload[mapping.targetField] = ['true', '1', 'yes'].includes(value.toLowerCase());
          } else {
            targetPayload[mapping.targetField] = value;
          }
        }
      });

      const duplicateInfo = duplicateInfoByRow.get(row.id);
      if (duplicateInfo?.isDuplicate && duplicateInfo.effectiveAction === 'create_copy' && duplicateInfo.suggestedTitle) {
        payload.title = duplicateInfo.suggestedTitle;
      }

      return payload;
    });

  const downloadImportReport = (format: 'csv' | 'json') => {
    if (!lastResult) return;
    const rows = lastResult.row_results || [];
    const filename = `test-case-import-report.${format}`;
    const content = format === 'json'
      ? JSON.stringify(rows, null, 2)
      : [
          ['row_number', 'title', 'status', 'created_id', 'updated_id', 'existing_id', 'warning', 'error'].join(','),
          ...rows.map((row) => [
            row.row_number,
            row.title,
            row.status,
            row.created_id || '',
            row.updated_id || '',
            row.existing_id || '',
            row.warning || '',
            row.error || '',
          ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')),
        ].join('\n');
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirm = async (dryRun = false) => {
    const importRows = prepareImportRows();
    if (importRows.length === 0) {
      toast({ title: t('importFailed'), description: t('importNoValidRows'), variant: 'destructive' });
      return;
    }
    if (!dryRun && importSummary.willImport === 0) {
      toast({ title: t('importFailed'), description: t('importNoRowsWillBeImported'), variant: 'destructive' });
      return;
    }

    setIsImporting(true);
    setLastResult(null);
    setProgress({ phase: dryRun ? 'validating' : 'uploading', processedRows: 0, totalRows: importRows.length, message: dryRun ? t('importPhaseValidating') : t('importPhaseUploading') });
    try {
      const now = Date.now();
      const storedIdempotency = localStorage.getItem(idempotencyStorageKey);
      let parsedIdempotency: { key?: string; createdAt?: number } | null = null;
      try {
        parsedIdempotency = storedIdempotency ? JSON.parse(storedIdempotency) : null;
      } catch {
        localStorage.removeItem(idempotencyStorageKey);
      }
      const idempotencyKey = parsedIdempotency?.key && parsedIdempotency.createdAt && now - parsedIdempotency.createdAt < IDEMPOTENCY_TTL_MS
        ? parsedIdempotency.key
        : (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(idempotencyStorageKey, JSON.stringify({ key: idempotencyKey, createdAt: now }));
      const result = await onConfirm(importRows, {
        duplicateMode,
        dryRun,
        filename: file.name,
        idempotencyKey,
        onProgress: setProgress,
      });
      setLastResult(result);
      if (!dryRun && !result.errors?.length) {
        localStorage.removeItem(idempotencyStorageKey);
      }
      if (result.errors?.length) {
        toast({ title: t('importCompletedWithIssues'), description: result.message, variant: 'destructive' });
      } else if (result.warnings?.length || result.skipped_rows > 0) {
        toast({ title: t('importCompletedWithIssues'), description: result.message });
      } else {
        toast({ title: t('importComplete'), description: result.message || t('successfullyImportedTestCases', { count: result.imported_rows }) });
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const message = Array.isArray(detail) ? detail.map((item: any) => item.msg).join(', ') : detail || error?.message || t('failedToImportTestCases');
      toast({ title: t('importFailed'), description: message, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  const renderEditableCell = (row: ValidatedRow, column: string) => {
    const type = fieldTypeByColumn.get(column) || 'text';
    const value = row.data[column] || '';
    const mapping = mappingByColumn.get(column);

    if (!mapping?.targetField) {
      return <span className="text-xs text-muted-foreground">{t('importIgnoredColumn')}</span>;
    }

    if (type === 'textarea') {
      return <Textarea value={value} onChange={(event) => updateCellValue(row.id, column, event.target.value)} rows={2} className="min-h-[64px] w-full resize-y bg-background text-sm text-foreground" />;
    }

    if (type === 'boolean') {
      return (
        <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
          <Checkbox checked={['true', '1', 'yes'].includes(value.toLowerCase())} onCheckedChange={(checked) => updateCellValue(row.id, column, checked ? 'true' : 'false')} />
          <span className="text-sm text-muted-foreground">{value || 'false'}</span>
        </div>
      );
    }

    if (type === 'select' || type === 'multiselect') {
      const standardField = STANDARD_FIELDS.find((field) => field.key === mapping.targetField);
      const customField = mapping.targetField === 'custom_field' ? customFields.find((field) => field.id === mapping.customFieldId) : undefined;
      const options = (standardField && 'options' in standardField ? standardField.options : undefined) || (customField ? getCustomFieldOptions(customField) : []);

      if (type === 'select' && options.length > 0) {
        return (
          <Select value={value} onValueChange={(nextValue) => updateCellValue(row.id, column, nextValue)}>
            <SelectTrigger className="h-9 w-full bg-background text-foreground">
              <SelectValue placeholder={t('selectValue')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>
        );
      }
    }

    const inputType = ['number', 'date', 'datetime-local'].includes(type) ? type : 'text';
    return <Input type={inputType} value={value} onChange={(event) => updateCellValue(row.id, column, event.target.value)} className="h-9 w-full bg-background text-foreground" />;
  };

  if (isParsing) {
    return (
      <div className="flex min-h-72 items-center justify-center py-10" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="rounded-2xl border bg-card p-8 text-center text-card-foreground shadow-xs">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
          <div className="font-semibold">{t('importParsingCsv')}</div>
          <div className="mt-1 text-sm text-muted-foreground">{file.name}</div>
        </div>
      </div>
    );
  }

  if (parseErrors.length > 0) {
    return (
      <div className="space-y-5 py-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="flex gap-3 p-5">
            <X className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-2">
              <h3 className="font-semibold text-destructive">{t('importCsvCouldNotBeParsed')}</h3>
              {parseErrors.map((error) => <p key={error} className="text-sm text-destructive">{error}</p>)}
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="rounded-2xl border bg-card p-5 text-card-foreground shadow-lg">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary"><Upload className="h-5 w-5" /></div>
              <div>
                <h2 className="text-xl font-semibold">{t('importCsvFlowTitle')}</h2>
                <p className="text-sm text-muted-foreground">{t('importCsvFlowDescription')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted/80"><FileText className="mr-1 h-3 w-3" />{file.name}</Badge>
              <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted/80">{(file.size / 1024).toFixed(1)} KB</Badge>
              <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted/80">{stats.total} {t('rows')}</Badge>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs md:min-w-80">
            {[
              { id: 'mapping', label: t('importStepMap') },
              { id: 'preview', label: t('importStepReview') },
              { id: 'finish', label: t('importStepImport') },
            ].map((item, index) => {
              const active = item.id === step || (item.id === 'finish' && isImporting);
              return (
                <div key={item.id} className={`rounded-xl border px-3 py-2 ${active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                  <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-background">{index + 1}</div>
                  {item.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>

	      {(parseWarnings.length > 0 || !titleMapped || hasDuplicateMappedFields) && (
        <Card className="border-primary/30 bg-primary/10">
          <CardContent className="space-y-2 p-4 text-sm text-primary">
            {!titleMapped && <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{t('importTitleMustBeMapped')}</div>}
            {hasDuplicateMappedFields && <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{t('importDuplicateMappedFields')}</div>}
            {parseWarnings.map((warning) => <div key={warning} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{warning}</div>)}
          </CardContent>
        </Card>
      )}

      {step === 'mapping' ? (
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,0.8fr)_minmax(280px,1fr)] md:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Folder className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">{t('targetSection')}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{t('selectSection')}</p>
                </div>
              </div>
              <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                <SelectTrigger className="h-11 w-full bg-background"><SelectValue placeholder={t('selectSection')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('noSection')}</SelectItem>
                  {sectionOptions.map((section) => (
                    <SelectItem key={section.id} value={section.id}>{`${'  '.repeat(section.depth)}${section.name}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20 px-3 py-2.5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-base">{t('columnMapping')}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{t('importRequiredField')}</Badge>
                  <span className="text-sm text-muted-foreground">{columnMapping.filter((mapping) => mapping.targetField).length} / {availableColumns.length} {t('columnsMapped')}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {availableColumns.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{t('importNoColumnsFound')}</div>
              ) : availableColumns.map((column, index) => {
                const mapping = mappingByColumn.get(column);
                const mapped = Boolean(mapping?.targetField);
                const requiredMappingLabel = getRequiredMappingLabel(mapping);
                return (
                  <div key={column} className={`grid gap-2 rounded-lg border px-3 py-2 md:grid-cols-[minmax(0,0.9fr)_minmax(220px,1fr)] md:items-center ${mapped ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${mapped ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{column}</div>
                          <div className="text-xs text-muted-foreground">{t('csvColumn')}</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Select value={getMappingValue(mapping)} onValueChange={(value) => updateMapping(column, value)}>
                        <SelectTrigger className="h-9 bg-background"><SelectValue placeholder={t('selectField')} /></SelectTrigger>
                        <SelectContent className="max-h-80">
                          <SelectItem value={IGNORE_FIELD}>{t('ignoreThisColumn')}</SelectItem>
                          {STANDARD_FIELDS.map((field) => <SelectItem key={field.key} value={field.key}>{t(field.labelKey as any)}{field.required ? ` - ${t('importRequiredField')}` : ''}</SelectItem>)}
                          {customFields.length > 0 && <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{t('customFields')}</div>}
                          {customFields.map((field) => <SelectItem key={field.id} value={`custom_${field.id}`}>{field.name}{field.is_required ? ` (${t('required')})` : ''}</SelectItem>)}
                        </SelectContent>
                      </Select>
	                      <div className="flex flex-wrap gap-1.5">
	                        <Badge variant="secondary">{getCoverageLabel(column, mapping)}</Badge>
	                        {requiredMappingLabel ? <Badge variant="destructive">{requiredMappingLabel}</Badge> : null}
	                        {mapping?.confidence ? <Badge variant="outline">{t('importAutoMatched', { confidence: mapping.confidence })}</Badge> : null}
	                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {lowConfidenceMappings.length > 0 && (
            <Card className="border-amber-400/40 bg-amber-50/80 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{t('lowConfidenceMappings')}</div>
                <div className="flex flex-wrap gap-2">
                  {lowConfidenceMappings.map((mapping) => <Badge key={mapping.csvColumn} variant="outline">{mapping.csvColumn} → {getPreviewFieldLabel(mapping.csvColumn)} ({mapping.confidence}%)</Badge>)}
                </div>
                <p className="text-xs opacity-80">{t('lowConfidenceMappingsHint')}</p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">{t('importMapRequiredHint')}</p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
              <Button onClick={() => setStep('preview')} disabled={!titleMapped || hasDuplicateMappedFields || stats.total === 0}>{t('continueToPreview')}<ChevronRight className={`h-4 w-4 ${isRTL ? 'mr-2 rotate-180' : 'ml-2'}`} /></Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2 text-sm shadow-xs">
            {[
              { label: t('totalRows'), value: stats.total, className: 'bg-muted text-muted-foreground' },
              { label: t('validRows'), value: stats.valid, className: 'bg-primary/10 text-primary' },
              { label: t('invalidRows'), value: stats.invalid, className: stats.invalid > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground' },
              { label: t('warnings'), value: stats.warnings, className: 'bg-muted text-muted-foreground' },
              { label: t('edited'), value: stats.edited, className: 'bg-primary/10 text-primary' },
            ].map((item) => (
              <div key={item.label} className={`rounded-xl px-3 py-1.5 ${item.className}`}>
                <span className="font-semibold">{item.value}</span>
                <span className="ml-1 opacity-75">{item.label}</span>
              </div>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardContent className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-center">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setStep('mapping')}><RotateCcw className="mr-2 h-4 w-4" />{t('remapColumns')}</Button>
                  <Button variant={issueFilter === 'all' ? 'outline-solid' : 'default'} size="sm" onClick={() => setIssueFilter(issueFilter === 'all' ? 'invalid' : 'all')}><Eye className="mr-2 h-4 w-4" />{issueFilter === 'all' ? t('showOnlyIssues') : t('showAllRows')}</Button>
                  <Button variant="outline" size="sm" onClick={resetEdits} disabled={stats.edited === 0}><RotateCcw className="mr-2 h-4 w-4" />{t('resetEdits')}</Button>
                </div>
	                <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
	                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('duplicateResolutionMode')}</Label>
	                  <Select value={duplicateMode} onValueChange={(value) => setDuplicateMode(value as ImportDuplicateMode)}>
	                    <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
	                    <SelectContent>
	                      <SelectItem value="create_only">{t('duplicateModeCreateOnly')}</SelectItem>
	                      <SelectItem value="skip_duplicates">{t('duplicateModeSkip')}</SelectItem>
	                      <SelectItem value="update_existing">{t('duplicateModeUpdate')}</SelectItem>
	                      <SelectItem value="create_copy">{t('duplicateModeCopy')}</SelectItem>
	                    </SelectContent>
	                  </Select>
	                </div>
	                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
	                  <Badge variant="outline">{t('importReadyCount', { count: stats.valid })}</Badge>
	                  <Badge variant="outline">{previewColumns.length} / {availableColumns.length} {t('columnsMapped')}</Badge>
	                  {ignoredColumnCount > 0 ? <Badge variant="outline">{ignoredColumnCount} {t('importIgnoredColumn')}</Badge> : null}
	                </div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('targetSection')}</div>
                    <div className="truncate text-sm font-medium text-foreground">{selectedSectionName}</div>
                  </div>
                  <Folder className="h-5 w-5 shrink-0 text-primary" />
                </div>
                <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                  <SelectTrigger className="h-9 w-full bg-background"><SelectValue placeholder={t('selectSection')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('noSection')}</SelectItem>
                    {sectionOptions.map((section) => (
                      <SelectItem key={section.id} value={section.id}>{`${'  '.repeat(section.depth)}${section.name}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
	          </Card>

	          <Card className="border-primary/20 bg-primary/5">
	            <CardContent className="grid gap-2 p-3 text-sm grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
	              <div className="rounded-xl bg-background p-3"><div className="text-xs text-muted-foreground">{t('importSummaryNew')}</div><div className="text-xl font-semibold">{importSummary.newRows}</div></div>
	              <div className="rounded-xl bg-background p-3"><div className="text-xs text-muted-foreground">{t('importSummaryDuplicates')}</div><div className="text-xl font-semibold">{importSummary.duplicates}</div></div>
	              <div className="rounded-xl bg-background p-3"><div className="text-xs text-muted-foreground">{t('importSummaryInvalid')}</div><div className="text-xl font-semibold">{importSummary.invalid}</div></div>
	              <div className="rounded-xl bg-background p-3"><div className="text-xs text-muted-foreground">{t('importSummaryWillImport')}</div><div className="text-xl font-semibold">{importSummary.willImport}</div></div>
	            </CardContent>
	          </Card>

          {allValidRowsSkippedAsDuplicates && (
            <Card className="border-amber-400/50 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              <CardContent className="flex gap-3 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">{t('importNoRowsDueToDuplicatesTitle')}</div>
                  <div className="mt-1 opacity-85">{t('importNoRowsDueToDuplicatesHint')}</div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20 px-3 py-2.5">
              <CardTitle className="text-base">{t('bulkEditColumns')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-3 lg:grid-cols-[180px_minmax(180px,1fr)_auto] lg:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('field')}</Label>
                <Select value={bulkEditField} onValueChange={(value) => handleBulkFieldChange(value as BulkEditableField)}>
                  <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">{t('priority')}</SelectItem>
                    <SelectItem value="section_id">{t('section')}</SelectItem>
                    <SelectItem value="created_at">{t('created')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('value')}</Label>
                {bulkEditField === 'priority' ? (
                  <Select value={bulkEditValue} onValueChange={setBulkEditValue}>
                    <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['low', 'medium', 'high', 'critical'].map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : bulkEditField === 'section_id' ? (
                  <Select value={bulkEditValue || 'none'} onValueChange={(value) => setBulkEditValue(value === 'none' ? '' : value)}>
                    <SelectTrigger className="h-9 bg-background"><SelectValue placeholder={t('selectSection')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('noSection')}</SelectItem>
                      {sectionOptions.map((section) => <SelectItem key={section.id} value={section.id}>{`${'  '.repeat(section.depth)}${section.name}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type="datetime-local" value={bulkEditValue} onChange={(event) => setBulkEditValue(event.target.value)} className="h-9 bg-background" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => applyBulkEdit(bulkEditField, bulkEditValue)} disabled={bulkEditField === 'section_id' && !bulkEditValue}>{t('applyToAllRows')}</Button>
                {bulkEditField === 'created_at' ? <Button variant="outline" size="sm" onClick={() => applyBulkEdit('created_at', getDefaultCreatedAt(), true)}>{t('setEmptyCreationTimesToNow')}</Button> : null}
                <Button variant="outline" size="sm" onClick={() => applyBulkEdit('priority', 'medium')}>{t('setAllPriorityMedium')}</Button>
              </div>
            </CardContent>
          </Card>

	          {isImporting && (
	            <Card className="border-primary/30">
	              <CardContent className="flex flex-col gap-2 p-4 text-sm md:flex-row md:items-center md:justify-between">
	                <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" />{progress.message || t(`importPhase${progress.phase.charAt(0).toUpperCase()}${progress.phase.slice(1)}` as any)}</div>
	                {progress.totalRows ? <Badge variant="outline">{progress.processedRows || 0} / {progress.totalRows} {t('rows')}</Badge> : null}
	                {progress.totalChunks ? <Badge variant="outline">{t('importChunkProgress', { current: progress.currentChunk || 0, total: progress.totalChunks })}</Badge> : null}
	              </CardContent>
	            </Card>
	          )}

	          {lastResult && (
	            <Card className="border-border">
	              <CardContent className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between">
	                <div>
	                  <div className="font-semibold">{lastResult.message}</div>
	                  <div className="text-muted-foreground">{t('importResultReportHint')}</div>
	                </div>
	                <div className="flex flex-wrap gap-2">
	                  <Button variant="outline" size="sm" onClick={() => downloadImportReport('csv')}>{t('downloadCsvReport')}</Button>
	                  <Button variant="outline" size="sm" onClick={() => downloadImportReport('json')}>{t('downloadJsonReport')}</Button>
	                </div>
	              </CardContent>
	            </Card>
	          )}

	          <Card className="overflow-hidden rounded-2xl">
            <CardHeader className="border-b bg-muted/30 px-3 py-2.5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">{t('dataPreview')}</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {filteredRows.length} {t('rows')} · {previewColumns.length} {t('columnsMapped')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  <Badge>{t('validRows')}: {stats.valid}</Badge>
                  {stats.invalid > 0 ? <Badge variant="destructive">{t('invalidRows')}: {stats.invalid}</Badge> : null}
                  {stats.warnings > 0 ? <Badge variant="outline">{t('warnings')}: {stats.warnings}</Badge> : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-b bg-background/80 px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['all', t('allRows'), issueCounts.all],
                    ['invalid', t('invalidRows'), issueCounts.invalid],
                    ['duplicates', t('importSummaryDuplicates'), issueCounts.duplicates],
                    ['warnings', t('warnings'), issueCounts.warnings],
                    ['missing_required', t('missingRequiredFields'), issueCounts.missing_required],
                    ['custom_field_errors', t('customFieldErrors'), issueCounts.custom_field_errors],
                  ] as Array<[IssueFilter, string, number]>).map(([filter, label, count]) => (
                    <Button key={filter} variant={issueFilter === filter ? 'default' : 'outline-solid'} size="sm" onClick={() => setIssueFilter(filter)}>
                      {label} <Badge variant="secondary" className="ml-2">{count}</Badge>
                    </Button>
                  ))}
                </div>
              </div>
              <div
                ref={previewScrollRef}
                className="h-[58vh] min-h-[360px] overflow-y-auto overflow-x-hidden bg-muted/10 p-2 md:p-3"
                onScroll={(event) => setVirtualScrollTop(event.currentTarget.scrollTop)}
              >
                {virtualRows.rows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('importNoRowsMatchFilter')}</div>
                ) : (
                  <div style={{ minHeight: virtualRows.totalHeight || undefined }}>
                    <div style={{ paddingTop: virtualRows.offsetTop, paddingBottom: virtualRows.bottomPadding }} className="space-y-2">
                      {virtualRows.rows.map((row) => {
                        const duplicateInfo = duplicateInfoByRow.get(row.id);
                        return (
                          <div
                            key={row.id}
                            className={`rounded-xl border bg-card shadow-xs transition-colors [contain-intrinsic-size:220px] [content-visibility:auto] ${row.isValid ? 'border-border' : 'border-destructive/40 bg-destructive/5'} ${row.isEdited ? 'ring-1 ring-primary/50' : ''}`}
                          >
                            <div className="flex flex-col gap-2 border-b bg-background/80 px-3 py-2 md:flex-row md:items-center md:justify-between">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-border">
                                  {row.rowNumber}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {row.isValid ? <Badge><Check className="mr-1 h-3 w-3" />{t('valid')}</Badge> : <Badge variant="destructive"><X className="mr-1 h-3 w-3" />{t('invalid')}</Badge>}
                                    {row.isEdited ? <Badge variant="outline">{t('edited')}</Badge> : null}
                                    {duplicateInfo?.isDuplicate ? <Badge variant="outline">{t('importDuplicateBadge')}</Badge> : null}
                                  </div>
                                  <div className="mt-0.5 truncate text-sm font-medium text-foreground">{getPreviewRowTitle(row)}</div>
                                  {duplicateInfo?.effectiveAction === 'create_copy' && duplicateInfo.suggestedTitle ? <div className="mt-0.5 truncate text-xs text-primary">{t('willRenameTo', { title: duplicateInfo.suggestedTitle })}</div> : null}
                                </div>
                              </div>
                              {(row.errors.length > 0 || row.warnings.length > 0 || duplicateInfo?.isDuplicate) && (
                                <div className="flex flex-wrap gap-1.5 md:justify-end">
                                  {duplicateInfo?.isDuplicate ? (
                                    <Select value={duplicateInfo.effectiveAction} onValueChange={(value) => setRowActions((previous) => ({ ...previous, [row.id]: value as ImportDuplicateMode }))}>
                                      <SelectTrigger className="h-8 w-44 bg-background"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="create_only">{t('rowActionCreateOnly')}</SelectItem>
                                        <SelectItem value="skip_duplicates">{t('rowActionSkip')}</SelectItem>
                                        <SelectItem value="update_existing">{t('rowActionOverwrite')}</SelectItem>
                                        <SelectItem value="create_copy">{t('rowActionCopy')}</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : null}
                                  {row.errors.map((error) => <Badge key={error} variant="destructive">{error}</Badge>)}
                                  {row.warnings.map((warning) => <Badge key={warning} variant="outline">{warning}</Badge>)}
                                </div>
                              )}
                            </div>
                            <div className="space-y-3 p-3">
                              {primaryPreviewColumns.length > 0 && (
                                <div className="grid gap-x-3 gap-y-2 grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))]">
                                  {primaryPreviewColumns.map((column) => renderPreviewField(row, column, true))}
                                </div>
                              )}
                              {detailPreviewColumns.length > 0 && (
                                <div className="grid gap-x-3 gap-y-2 border-t pt-3 grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))]">
                                  {detailPreviewColumns.map((column) => renderPreviewField(row, column))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 z-30 rounded-2xl border bg-background/95 p-3 shadow-2xl backdrop-blur-sm supports-backdrop-filter:bg-background/80">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button variant="outline" size="sm" onClick={() => setStep('mapping')} disabled={isImporting}><RotateCcw className="mr-2 h-4 w-4" />{t('back')}</Button>
                <Badge variant="outline">{t('validRows')}: {stats.valid}</Badge>
                <Badge variant="outline">{t('importSummaryWillImport')}: {importSummary.willImport}</Badge>
                <span className="text-xs text-muted-foreground">{t('importInvalidRowsSkipped')}</span>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                <div className="grid gap-1 md:w-56">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('duplicateResolutionMode')}</Label>
                  <Select value={duplicateMode} onValueChange={(value) => setDuplicateMode(value as ImportDuplicateMode)}>
                    <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="create_only">{t('duplicateModeCreateOnly')}</SelectItem>
                      <SelectItem value="skip_duplicates">{t('duplicateModeSkip')}</SelectItem>
                      <SelectItem value="update_existing">{t('duplicateModeUpdate')}</SelectItem>
                      <SelectItem value="create_copy">{t('duplicateModeCopy')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onCancel} disabled={isImporting}>{t('cancel')}</Button>
                  <Button variant="outline" onClick={() => handleConfirm(true)} disabled={stats.valid === 0 || isImporting}>{t('validateOnly')}</Button>
                  <Button onClick={() => handleConfirm(false)} disabled={stats.valid === 0 || importSummary.willImport === 0 || isImporting} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {isImporting ? t('importing') : t('importValidTestCases', { count: importSummary.willImport })}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
