import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContentEditor } from '@/components/ui/content-editor';
import { ReferenceField } from '@/components/ui/reference-field';
import { ArrowLeft, Save, Trash2, Plus, AlertTriangle, RefreshCw } from 'lucide-react';
import { testCasesAPI, testSuitesAPI, projectsAPI, sectionsAPI, customFieldsAPI, enumsAPI } from '@/lib/api';
import { CustomFieldDefinition } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

type TestCasePriority = 'low' | 'medium' | 'high' | 'critical';
type TestCaseStatus = 'active' | 'inactive' | 'archived';
type TestCaseType = string;
type SelectOption = { value: string; label: string };

const parseBooleanFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
};

export function TestCaseEdit() {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const navigate = useNavigate();
  const { setSelectedProject, projects } = useProjectStore();
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    preconditions: '',
    steps: '',
    expected_result: '',
    test_type: 'manual' as TestCaseType,
    priority: 'medium' as TestCasePriority,
    status: 'active' as TestCaseStatus,
    tags: '',
    reference: '',
    test_suite_id: null as number | null,
    section_id: null as number | null,
    is_multistep: false,
  });
  
  // Multistep test case steps state
  const [testSteps, setTestSteps] = useState<any[]>([]);
  const [isValidatingProject, setIsValidatingProject] = useState(false);
  const [sectionOptions, setSectionOptions] = useState<{ id: number; name: string; indent: number }[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [testSuiteOptions, setTestSuiteOptions] = useState<{ id: number; name: string }[]>([]);
  const [testSuitesLoading, setTestSuitesLoading] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<number, string>>({});
  const [existingCustomFieldValueIds, setExistingCustomFieldValueIds] = useState<Record<number, number>>({});
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [testTypeOptions, setTestTypeOptions] = useState<SelectOption[]>([]);
  const [testTypesLoading, setTestTypesLoading] = useState(false);

  const displayedTestTypeOptions = useMemo(() => {
    if (!formData.test_type || testTypeOptions.some((option) => option.value === formData.test_type)) {
      return testTypeOptions;
    }

    return [
      { value: formData.test_type, label: formData.test_type },
      ...testTypeOptions,
    ];
  }, [formData.test_type, testTypeOptions]);

  const navigateBack = () => {
    const targetProjectId = currentProjectId || (projectId ? parseInt(projectId, 10) : null);
    if (targetProjectId) {
      navigate(`/projects/${targetProjectId}/test-cases/${id}`);
    } else {
      navigate(`/test-cases/${id}`);
    }
  };

  const [loadError, setLoadError] = useState<string | null>(null);
  const [originalIsMultistep, setOriginalIsMultistep] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchTestCase = async () => {
      setLoading(true);
      setIsValidatingProject(true);
      setLoadError(null);

      const numericId = Number(id);
      if (!id || !Number.isFinite(numericId) || numericId <= 0) {
        if (isMounted) {
          setLoadError('invalidTestCaseId');
          setLoading(false);
          setIsValidatingProject(false);
        }
        return;
      }

      try {
        const testCaseData = await testCasesAPI.getById(numericId);
        if (!isMounted) return;

        if (projectId && testCaseData.test_suite_id) {
          try {
            const testSuiteData = await testSuitesAPI.getById(testCaseData.test_suite_id);
            if (!isMounted) return;
            const requestedProjectId = Number(projectId);
            const actualProjectId = Number(testSuiteData?.project_id);
            if (
              Number.isFinite(actualProjectId) &&
              Number.isFinite(requestedProjectId) &&
              actualProjectId !== requestedProjectId
            ) {
              navigate(`/projects/${actualProjectId}/test-cases/${numericId}/edit`, { replace: true });
              return;
            }
          } catch (suiteError) {
            console.error('Failed to validate test case project:', suiteError);
            // Surface a non-blocking warning; user can still edit if the API recovers.
          }
        }

        const suiteId = (testCaseData as any).test_suite_id ?? null;
        const sectionId = (testCaseData as any).section_id ?? null;
        const existingCustomValues = ((testCaseData as any).custom_field_values || []).reduce(
          (
            values: {
              fieldValues: Record<number, string>;
              valueIds: Record<number, number>;
            },
            fieldValue: { id: number; field_definition_id: number; value?: string | null }
          ) => {
            values.fieldValues[fieldValue.field_definition_id] = fieldValue.value || '';
            values.valueIds[fieldValue.field_definition_id] = fieldValue.id;
            return values;
          },
          { fieldValues: {}, valueIds: {} }
        );

        const isMultistep = parseBooleanFlag((testCaseData as any).is_multistep);

        if (!isMounted) return;
        setFormData({
          title: testCaseData.title || '',
          description: testCaseData.description || '',
          preconditions: testCaseData.preconditions || '',
          steps: testCaseData.steps || '',
          expected_result: testCaseData.expected_result || '',
          test_type: (testCaseData.test_type as TestCaseType) || 'manual',
          priority: (testCaseData.priority as TestCasePriority) || 'medium',
          status: (testCaseData.status as TestCaseStatus) || 'active',
          tags: testCaseData.tags || '',
          reference: testCaseData.reference || '',
          test_suite_id: suiteId,
          section_id: sectionId,
          is_multistep: isMultistep,
        });
        setCustomFieldValues(existingCustomValues.fieldValues);
        setExistingCustomFieldValueIds(existingCustomValues.valueIds);
        setOriginalIsMultistep(isMultistep);

        if (isMultistep) {
          try {
            const steps = await testCasesAPI.getSteps(numericId);
            if (isMounted) setTestSteps(Array.isArray(steps) ? steps : []);
          } catch (stepsError) {
            console.error('Failed to load test steps:', stepsError);
            if (isMounted) setTestSteps([]);
          }
        } else if (isMounted) {
          setTestSteps([]);
        }

        let determinedProjectId: number | null = null;
        if (projectId) {
          const parsed = Number(projectId);
          if (Number.isFinite(parsed) && parsed > 0) determinedProjectId = parsed;
        } else if (suiteId) {
          try {
            const suite = await testSuitesAPI.getById(suiteId);
            determinedProjectId = suite?.project_id || null;
          } catch (error) {
            console.error('Failed to fetch test suite:', error);
          }
        }

        if (!isMounted) return;
        if (determinedProjectId) {
          setCurrentProjectId(determinedProjectId);
          const projList = Array.isArray(projects) ? projects : [];
          const proj = projList.find((p) => p.id === determinedProjectId)
            || await projectsAPI.getById(determinedProjectId).catch(() => null);
          if (isMounted && proj) setSelectedProject(proj);
        }
      } catch (error) {
        console.error('Failed to fetch test case:', error);
        if (isMounted) setLoadError('failedToLoadTestCase');
      } finally {
        if (isMounted) {
          setLoading(false);
          setIsValidatingProject(false);
        }
      }
    };

    fetchTestCase();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, projectId]);

  useEffect(() => {
    const loadTestTypes = async () => {
      setTestTypesLoading(true);
      try {
        const definitions = await enumsAPI.getTestTypes();
        const options = (Array.isArray(definitions) ? definitions : [])
          .filter((definition: any) => definition?.name)
          .map((definition: any) => ({
            value: String(definition.name).toLowerCase(),
            label: String(definition.name),
          }));

        setTestTypeOptions(options);
      } catch (error) {
        console.error('Failed to load test type definitions:', error);
        setTestTypeOptions([
          { value: 'manual', label: t('manual') },
          { value: 'automated', label: t('automated') },
          { value: 'smoke', label: t('smoke') },
          { value: 'regression', label: 'Regression' },
          { value: 'integration', label: 'Integration' },
          { value: 'security', label: t('security') },
          { value: 'performance', label: t('performance') },
          { value: 'usability', label: 'Usability' },
        ]);
      } finally {
        setTestTypesLoading(false);
      }
    };

    loadTestTypes();
  }, [language]);

  useEffect(() => {
    const loadCustomFields = async () => {
      if (!currentProjectId) {
        setCustomFields([]);
        return;
      }

      setCustomFieldsLoading(true);
      try {
        const fields = await customFieldsAPI.getDefinitions(currentProjectId);
        setCustomFields(Array.isArray(fields) ? fields : []);
      } catch (error) {
        console.error('Failed to load custom fields:', error);
        setCustomFields([]);
      } finally {
        setCustomFieldsLoading(false);
      }
    };

    loadCustomFields();
  }, [currentProjectId]);

  useEffect(() => {
    const loadTestSuites = async () => {
      if (!currentProjectId) {
        setTestSuiteOptions([]);
        return;
      }
      setTestSuitesLoading(true);
      try {
        const testSuites = await testSuitesAPI.getAll(currentProjectId);
        setTestSuiteOptions(testSuites.map(suite => ({ id: suite.id, name: suite.name })));
      } catch (error) {
        console.error('Failed to load test suites:', error);
        setTestSuiteOptions([]);
      } finally {
        setTestSuitesLoading(false);
      }
    };
    loadTestSuites();
  }, [currentProjectId]);

  useEffect(() => {
    const loadSections = async () => {
      if (!currentProjectId || !formData.test_suite_id) {
        setSectionOptions([]);
        return;
      }
      setSectionsLoading(true);
      try {
        const data = await sectionsAPI.getProjectSectionHierarchy(currentProjectId);
        const hierarchy = data?.hierarchy ?? [];
        const suiteBlock = hierarchy.find(
          (h: { test_suite: { id: number } }) => h.test_suite?.id === formData.test_suite_id
        );
        
        if (!suiteBlock) {
          setSectionOptions([]);
          return;
        }

        // Use a Set to track unique section IDs and prevent duplicates
        const seenSections = new Set<number>();
        const flat: { id: number; name: string; indent: number }[] = [];
        
        const pushSection = (s: { id: number; name: string; subsections?: { id: number; name: string; subsections?: any[] }[] }, indent: number) => {
          // Skip if we've already seen this section (prevents duplicates)
          if (seenSections.has(s.id)) {
            return;
          }
          seenSections.add(s.id);
          flat.push({ id: s.id, name: s.name, indent });
          (s.subsections ?? []).forEach((sub: { id: number; name: string; subsections?: any[] }) =>
            pushSection(sub, indent + 1)
          );
        };
        
        (suiteBlock.sections ?? []).forEach((s: { id: number; name: string; subsections?: { id: number; name: string; subsections?: any[] }[] }) =>
          pushSection(s, 0)
        );
        
        setSectionOptions(flat);
      } catch (error) {
        console.error('Failed to load sections:', error);
        setSectionOptions([]);
      } finally {
        setSectionsLoading(false);
      }
    };
    loadSections();
  }, [currentProjectId, formData.test_suite_id]);

  const handleInputChange = (field: string, value: string | number | null) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        [field]: value
      };
      
      // If test suite changes, reset section
      if (field === 'test_suite_id' && value !== prev.test_suite_id) {
        updated.section_id = null;
      }
      
      return updated;
    });
  };

  // Multistep handlers
  const handleMultistepToggle = (isMultistep: boolean) => {
    setFormData(prev => ({ ...prev, is_multistep: isMultistep }));
    if (isMultistep && testSteps.length === 0) {
      // Initialize with one empty step
      setTestSteps([{
        step_number: 1,
        action: '',
        expected_result: '',
        step_type: 'manual'
      }]);
    }
  };

  const handleAddStep = () => {
    const newStepNumber = testSteps.length + 1;
    setTestSteps(prev => [...prev, {
      step_number: newStepNumber,
      action: '',
      expected_result: '',
      step_type: 'manual'
    }]);
  };

  const handleRemoveStep = (stepNumber: number) => {
    setTestSteps(prev => {
      const filtered = prev.filter(step => step.step_number !== stepNumber);
      // Renumber remaining steps
      return filtered.map((step, index) => ({
        ...step,
        step_number: index + 1
      }));
    });
  };

  const handleStepChange = (stepNumber: number, field: 'action' | 'expected_result' | 'step_type', value: string) => {
    setTestSteps(prev => prev.map(step => 
      step.step_number === stepNumber 
        ? { ...step, [field]: value }
        : step
    ));
  };

  const getCustomFieldOptions = (field: CustomFieldDefinition): string[] => {
    if (!field.options) {
      return [];
    }

    if (Array.isArray(field.options)) {
      return field.options.map(String);
    }

    const optionValues = Array.isArray(field.options.values)
      ? field.options.values
      : Array.isArray(field.options.options)
        ? field.options.options
        : [];

    return optionValues.map(String);
  };

  const parseMultiSelectValues = (value: string | undefined): string[] =>
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const formatMultiSelectValues = (values: string[]): string =>
    Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(',');

  const handleCustomFieldChange = (fieldId: number, value: string | boolean) => {
    setCustomFieldValues((prev) => ({
      ...prev,
      [fieldId]: String(value),
    }));
  };

  const handleCustomFieldMultiSelectToggle = (fieldId: number, option: string, checked: boolean) => {
    setCustomFieldValues((prev) => {
      const current = parseMultiSelectValues(prev[fieldId]);
      const next = checked
        ? [...current, option]
        : current.filter((value) => value !== option);

      return {
        ...prev,
        [fieldId]: formatMultiSelectValues(next),
      };
    });
  };

  const getCustomFieldValidationError = (field: CustomFieldDefinition): string => {
    const value = customFieldValues[field.id];
    if (field.field_type === 'boolean') {
      if (field.is_required && value !== 'true' && value !== 'false') {
        return t('fieldRequired', { field: field.name });
      }
      return '';
    }

    if (field.is_required && (!value || !String(value).trim())) {
      return t('fieldRequired', { field: field.name });
    }

    if (field.field_type === 'number' && value && Number.isNaN(Number(value))) {
      return t('fieldMustBeValidNumber', { field: field.name });
    }

    const options = getCustomFieldOptions(field);

    if (field.field_type === 'select' && value && options.length > 0 && !options.includes(value)) {
      return t('fieldRequired', { field: field.name });
    }

    if (field.field_type === 'multiselect' && value) {
      const selectedOptions = parseMultiSelectValues(value);
      const invalidOptions = selectedOptions.filter((selectedOption) => !options.includes(selectedOption));
      if (invalidOptions.length > 0) {
        return t('fieldRequired', { field: field.name });
      }
    }

    return '';
  };

  const customFieldValidationErrors = useMemo(() => {
    const errors: Record<number, string> = {};
    customFields.forEach((field) => {
      const error = getCustomFieldValidationError(field);
      if (error) {
        errors[field.id] = error;
      }
    });
    return errors;
  }, [customFields, customFieldValues, language]);

  const syncCustomFieldValues = async (testCaseId: number): Promise<{ failedFields: string[] }> => {
    const results = await Promise.allSettled(customFields.map(async (field) => {
      const rawValue = customFieldValues[field.id];
      let value = field.field_type === 'boolean'
        ? (rawValue === 'true' || rawValue === 'false' ? rawValue : '')
        : (rawValue === undefined || rawValue === null ? '' : String(rawValue));
      if (field.field_type === 'multiselect') {
        const allowedOptions = new Set(getCustomFieldOptions(field));
        const sanitizedValues = parseMultiSelectValues(value).filter((selectedOption) => allowedOptions.has(selectedOption));
        value = formatMultiSelectValues(sanitizedValues);
      }
      const existingValueId = existingCustomFieldValueIds[field.id];

      if (existingValueId && value.trim() === '') {
        await customFieldsAPI.deleteValue(existingValueId);
        return;
      }

      if (existingValueId) {
        await customFieldsAPI.updateValue(existingValueId, { value });
        return;
      }

      if (value.trim() !== '') {
        await customFieldsAPI.createValue({
          field_definition_id: field.id,
          test_case_id: testCaseId,
          value,
        });
      }
    }));

    const failedFields: string[] = [];
    results.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        const fieldName = customFields[index]?.name || `Field #${customFields[index]?.id ?? '?'}`;
        failedFields.push(fieldName);
        console.error(`Failed to sync custom field "${fieldName}":`, outcome.reason);
      }
    });

    return { failedFields };
  };

  const handleSave = async () => {
    const numericId = Number(id);
    if (!id || !Number.isFinite(numericId) || numericId <= 0) {
      toast({
        variant: 'destructive',
        title: t('validationError'),
        description: t('invalidTestCaseId'),
      });
      return;
    }

    if (!formData.title || formData.title.trim().length === 0) {
      toast({
        variant: 'destructive',
        title: t('validationError'),
        description: t('titleRequired'),
      });
      return;
    }

    if (formData.tags.length > 500) {
      toast({
        variant: 'destructive',
        title: t('validationError'),
        description: t('tagLengthExceeded', { max: 500 }),
      });
      return;
    }

    if (formData.test_suite_id === null) {
      toast({
        variant: 'destructive',
        title: t('validationError'),
        description: t('testSuiteRequired'),
      });
      return;
    }

    const customFieldError = customFields
      .map(getCustomFieldValidationError)
      .find(Boolean);

    if (customFieldError) {
      toast({
        variant: 'destructive',
        title: t('validationError'),
        description: customFieldError,
      });
      return;
    }

    setSaving(true);
    try {
      // Payload notes:
      //   - test_suite_id: must be a number (backend column is non-nullable). Null was
      //     blocked above.
      //   - section_id: explicit null clears the assignment server-side, which would
      //     otherwise be impossible because exclude_unset drops undefined fields.
      const payload = {
        ...formData,
        title: formData.title.trim(),
        test_suite_id: formData.test_suite_id,
        section_id: formData.section_id,
      };

      await testCasesAPI.update(numericId, payload);

      const { failedFields } = await syncCustomFieldValues(numericId);

      // Avoid an extra round-trip when the user was never in multistep mode
      // and didn't toggle on — there's nothing to clear.
      if (formData.is_multistep) {
        await testCasesAPI.createWithSteps(numericId, testSteps);
      } else if (originalIsMultistep) {
        await testCasesAPI.createWithSteps(numericId, []);
      }

      if (failedFields.length > 0) {
        toast({
          variant: 'destructive',
          title: t('saveFailed'),
          description: t('customFieldsPartialFailure', { fields: failedFields.join(', ') }),
        });
        return;
      }

      navigateBack();
    } catch (error) {
      console.error('Failed to save test case:', error);
      toast({
        variant: 'destructive',
        title: t('saveFailed'),
        description: t('failedToSaveTestCase'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || isValidatingProject) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={navigateBack}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'mr-0 ml-2' : 'mr-2'}`} />
            {t('back')}
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-500" />
            <p className="text-sm text-muted-foreground">
              {t(loadError as 'invalidTestCaseId' | 'failedToLoadTestCase')}
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2 mr-0' : 'mr-2'}`} />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={navigateBack}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'mr-0 ml-2' : 'mr-2'}`} />
          {t('back')}
        </Button>
        <h1 className="text-2xl font-bold">{t('editTestCase')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('testCaseDetails')}</CardTitle>
          {!currentProjectId && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
              ⚠️ {t('testCaseNotAssociatedWarning')}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="title">
              {t('title')}<span className="text-red-500 ml-1">*</span>
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder={t('enterTestCaseTitle')}
              className="w-full"
              required
              aria-invalid={formData.title.trim().length === 0}
            />
            {formData.title.trim().length === 0 && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t('titleRequired')}</p>
            )}
          </div>

          <ReferenceField
            value={formData.reference}
            onChange={(value) => handleInputChange('reference', value)}
            projectId={currentProjectId}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="test_suite">{t('testSuite')} {currentProjectId && <span className="text-xs text-muted-foreground">({t('projectId')}: {currentProjectId})</span>}</Label>
              <Select
                value={formData.test_suite_id === null ? '' : String(formData.test_suite_id)}
                onValueChange={(value) => handleInputChange('test_suite_id', value ? parseInt(value, 10) : null)}
                disabled={testSuitesLoading || !currentProjectId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={
                    testSuitesLoading
                      ? t('loadingTestSuites')
                      : !currentProjectId
                        ? t('noProjectSelected')
                        : testSuiteOptions.length === 0
                          ? t('noTestSuitesAvailable')
                          : t('selectTestSuite')
                  } />
                </SelectTrigger>
                <SelectContent>
                  {testSuiteOptions.map((suite) => (
                    <SelectItem key={suite.id} value={String(suite.id)}>
                      {suite.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.test_suite_id === null && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t('testSuiteRequired')}</p>
              )}
              {!testSuitesLoading && !currentProjectId && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {t('ensureTestCaseBelongsToProject')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="test_type">{t('testType')}</Label>
              <Select value={formData.test_type} onValueChange={(value) => handleInputChange('test_type', value as TestCaseType)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={testTypesLoading ? t('loading') : t('selectTestType')} />
                </SelectTrigger>
                <SelectContent>
                  {displayedTestTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="priority">{t('priority')}</Label>
              <Select value={formData.priority} onValueChange={(value) => handleInputChange('priority', value as TestCasePriority)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('selectPriority')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('low')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="critical">{t('critical')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">{t('status')}</Label>
              <Select value={formData.status} onValueChange={(value) => handleInputChange('status', value as TestCaseStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('selectStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="inactive">{t('inactive')}</SelectItem>
                  <SelectItem value="archived">{t('archived')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {currentProjectId && formData.test_suite_id && (
            <div>
              <Label htmlFor="section">{t('section')}</Label>
              <Select
                value={formData.section_id === null ? 'no-section' : String(formData.section_id)}
                onValueChange={(value) =>
                  handleInputChange('section_id', value === 'no-section' ? null : parseInt(value, 10))
                }
                disabled={sectionsLoading || sectionOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={
                    sectionsLoading 
                      ? t('loadingSections') 
                      : sectionOptions.length === 0 
                        ? t('noSectionsAvailable') 
                        : t('selectSection')
                  } />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no-section">
                    {t('noSection')}
                  </SelectItem>
                  {sectionOptions.map((opt) => (
                    <SelectItem key={opt.id} value={String(opt.id)}>
                      {'\u00A0'.repeat(opt.indent * 2)}{opt.indent > 0 ? '↳ ' : ''}{opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!sectionsLoading && sectionOptions.length === 0 && formData.test_suite_id && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('noSectionsFoundForSuite')}
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="tags">{t('tags')}</Label>
            <Input
              id="tags"
              value={formData.tags}
              onChange={(e) => handleInputChange('tags', e.target.value)}
              placeholder={t('enterTagsSeparatedByCommas')}
              maxLength={500}
              className="w-full"
            />
            <p className="mt-1 text-xs text-muted-foreground">{formData.tags.length}/500</p>
          </div>

          <div>
            <Label htmlFor="description">{t('description')}</Label>
            <ContentEditor
              value={formData.description}
              onChange={(value) => handleInputChange('description', value)}
              placeholder={t('enterTestCaseDescription')}
              format="markdown"
              minHeight="120px"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="preconditions">{t('preconditions')}</Label>
            <ContentEditor
              value={formData.preconditions}
              onChange={(value) => handleInputChange('preconditions', value)}
              placeholder={t('describePreconditions')}
              format="markdown"
              minHeight="120px"
              className="mt-1"
            />
          </div>

          {(customFieldsLoading || customFields.length > 0) && (
            <Card className="border-slate-200 shadow-xs dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">{t('customFields')}</CardTitle>
                {customFieldsLoading && (
                  <p className="text-sm text-muted-foreground">{t('loadingCustomFields')}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {!customFieldsLoading && customFields.map((field) => {
                  const fieldError = customFieldValidationErrors[field.id];
                  const fieldOptions = getCustomFieldOptions(field);
                  const selectedValues = parseMultiSelectValues(customFieldValues[field.id]);

                  return (
                    <div key={field.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <Label htmlFor={`custom-field-${field.id}`} className="text-sm font-semibold text-slate-900 dark:text-white">
                            {field.name}
                            {field.is_required && <span className="text-red-500 ml-1">*</span>}
                          </Label>
                          {field.description && (
                            <p className="text-xs leading-5 text-muted-foreground">{field.description}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="rounded-full text-[10px]">{field.field_type}</Badge>
                          {field.is_required && (
                            <Badge className="rounded-full bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{t('requiredBadge')}</Badge>
                          )}
                        </div>
                      </div>

                      {field.field_type === 'boolean' ? (
                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                          <Checkbox
                            id={`custom-field-${field.id}`}
                            checked={customFieldValues[field.id] === 'true'}
                            onCheckedChange={(checked) => handleCustomFieldChange(field.id, checked === true)}
                          />
                          <Label htmlFor={`custom-field-${field.id}`} className="text-sm text-slate-700 dark:text-slate-300">
                            {customFieldValues[field.id] === 'true' ? t('true') : t('false')}
                          </Label>
                          {field.is_required && customFieldValues[field.id] !== 'true' && customFieldValues[field.id] !== 'false' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleCustomFieldChange(field.id, false)}
                            >
                              {t('setDefaultFalse')}
                            </Button>
                          )}
                        </div>
                      ) : field.field_type === 'select' ? (
                        <Select
                          value={customFieldValues[field.id] || '__none__'}
                          onValueChange={(value) => handleCustomFieldChange(field.id, value === '__none__' ? '' : value)}
                        >
                          <SelectTrigger id={`custom-field-${field.id}`} className="bg-white dark:bg-slate-900">
                            <SelectValue placeholder={t('customFieldValue')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t('noDefaultValue')}</SelectItem>
                            {fieldOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : field.field_type === 'multiselect' ? (
                        <div id={`custom-field-${field.id}`} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                          {fieldOptions.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('noCustomFieldValues')}</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {fieldOptions.map((option) => {
                                const isChecked = selectedValues.includes(option);
                                return (
                                  <label key={option} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800">
                                    <Checkbox
                                      checked={isChecked}
                                      onCheckedChange={(checked) => handleCustomFieldMultiSelectToggle(field.id, option, checked === true)}
                                    />
                                    <span>{option}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <Input
                          id={`custom-field-${field.id}`}
                          type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                          value={customFieldValues[field.id] || ''}
                          onChange={(event) => handleCustomFieldChange(field.id, event.target.value)}
                          placeholder={t('enterCustomFieldValue')}
                          className="bg-white dark:bg-slate-900"
                        />
                      )}

                      {fieldError && (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{fieldError}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="steps">{t('testSteps')}</Label>
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <span className="text-sm text-gray-600">{t('simple')}</span>
                <button
                  type="button"
                  onClick={() => handleMultistepToggle(!formData.is_multistep)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.is_multistep ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isRTL
                        ? formData.is_multistep
                          ? '-translate-x-6'
                          : '-translate-x-1'
                        : formData.is_multistep
                          ? 'translate-x-6'
                          : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-gray-600">{t('multistep')}</span>
              </div>
            </div>
            {!formData.is_multistep ? (
              <ContentEditor
                value={formData.steps}
                onChange={(value) => handleInputChange('steps', value)}
                placeholder={t('stepOneTwoThree')}
                format="markdown"
                minHeight="180px"
                className="mt-1"
              />
            ) : (
              <div className="space-y-4 mt-2">
                {testSteps.map((step) => (
                  <div key={step.step_number} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{t('stepNumber', { number: step.step_number })}</h4>
                      {testSteps.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStep(step.step_number)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t('action')}</Label>
                        <Textarea
                          value={step.action}
                          onChange={(e) => handleStepChange(step.step_number, 'action', e.target.value)}
                          placeholder={t('describeAction')}
                          rows={3}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('expectedResult')}</Label>
                        <Textarea
                          value={step.expected_result}
                          onChange={(e) => handleStepChange(step.step_number, 'expected_result', e.target.value)}
                          placeholder={t('describeExpectedResult')}
                          rows={3}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('stepType')}</Label>
                      <Select
                        value={step.step_type}
                        onValueChange={(value) => handleStepChange(step.step_number, 'step_type', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">{t('manual')}</SelectItem>
                          <SelectItem value="automated">{t('automated')}</SelectItem>
                          <SelectItem value="verification">{t('verification')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddStep}
                  className="w-full"
                >
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2 mr-0' : 'mr-2'}`} />
                  {t('addStep')}
                </Button>
              </div>
            )}
          </div>

          {!formData.is_multistep && (
            <div>
              <Label htmlFor="expected_result">{t('expectedResult')}</Label>
              <ContentEditor
                value={formData.expected_result}
                onChange={(value) => handleInputChange('expected_result', value)}
                placeholder={t('describeExpectedOutcome')}
                format="markdown"
                minHeight="150px"
                className="mt-1"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={navigateBack}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || formData.title.trim().length === 0 || formData.test_suite_id === null}
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {t('saving')}
                </>
              ) : (
                <>
                  <Save className={`h-4 w-4 ${isRTL ? 'ml-2 mr-0' : 'mr-2'}`} />
                  {t('saveChanges')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
