import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  Edit,
  Eye,
  FileText,
  History,
  Play,
  Share2,
  Tag,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { api, customFieldsAPI, requirementsAPI, sectionsAPI, testCasesAPI, testSuitesAPI } from '@/lib/api';
import { CustomFieldDefinition, CustomFieldValue, Requirement, TestCase, TestSuite } from '@/types';

type SectionCrumb = { id: number; name: string };
type CustomFieldDisplayRow = { field: CustomFieldDefinition | null; value: string; valueId?: number; fieldDefinitionId: number };

const formatDateTime = (value?: string | null) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatStatusLabel = (status?: string | null) => {
  if (!status) return 'Unknown';
  return status.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};


const getCustomFieldOptions = (field: CustomFieldDefinition): string[] => {
  if (!field.options) return [];
  if (Array.isArray(field.options)) return field.options.map(String);

  const optionValues = Array.isArray(field.options.values)
    ? field.options.values
    : Array.isArray(field.options.options)
      ? field.options.options
      : [];

  return optionValues.map(String);
};

export function TestCaseDetail() {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const navigate = useNavigate();
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [testSuite, setTestSuite] = useState<TestSuite | null>(null);
  const [section, setSection] = useState<{ name: string; path: SectionCrumb[] } | null>(null);
  const [testSteps, setTestSteps] = useState<Array<{
    step_number: number;
    action: string;
    expected_result: string;
    step_type: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [testRunHistory, setTestRunHistory] = useState<any[]>([]);
  const [linkedRequirement, setLinkedRequirement] = useState<Requirement | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [isValidatingProject, setIsValidatingProject] = useState(false);

  const isMultistepCase = useMemo(() => {
    if (!testCase) return false;
    const rawValue = (testCase as any).is_multistep;
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'string') return rawValue.toLowerCase() === 'true';
    return Boolean(rawValue);
  }, [testCase]);

  const effectiveProjectId = projectId || testSuite?.project_id?.toString() || (testCase as any)?.project_id?.toString();

  const navigateBack = () => {
    if (effectiveProjectId) {
      navigate(`/projects/${effectiveProjectId}/test-cases`);
      return;
    }
    navigate('/test-cases');
  };

  useEffect(() => {
    let isMounted = true;

    const fetchTestCaseAndSuite = async () => {
      setLoading(true);
      setIsValidatingProject(true);

      const testCaseId = Number(id);
      if (!testCaseId || Number.isNaN(testCaseId)) {
        setTestCase(null);
        setLoading(false);
        setIsValidatingProject(false);
        return;
      }

      try {
        const testCaseData = await testCasesAPI.getById(testCaseId);
        let testSuiteData: TestSuite | null = null;

        if (testCaseData.test_suite_id) {
          try {
            testSuiteData = await testSuitesAPI.getById(testCaseData.test_suite_id);
          } catch (suiteError) {
            console.error('Failed to fetch test suite:', suiteError);
          }
        }

        if (projectId && testSuiteData?.project_id && Number(projectId) !== Number(testSuiteData.project_id)) {
          if (!isMounted) return;
          setTestCase(null);
          return;
        }

        if (!isMounted) return;
        setTestCase(testCaseData);
        setTestSuite(testSuiteData);

        const projectForCustomFields = Number(projectId || testSuiteData?.project_id || testCaseData.test_suite?.project_id || (testCaseData as any).project_id);
        if (projectForCustomFields && !Number.isNaN(projectForCustomFields)) {
          setCustomFieldsLoading(true);
          customFieldsAPI.getDefinitions(projectForCustomFields)
            .then((fields) => {
              if (isMounted) setCustomFields(Array.isArray(fields) ? fields : []);
            })
            .catch((customFieldError) => {
              console.error('Failed to fetch custom field definitions:', customFieldError);
              if (isMounted) setCustomFields([]);
            })
            .finally(() => {
              if (isMounted) setCustomFieldsLoading(false);
            });
        } else {
          setCustomFields([]);
        }

        const projectForSections = projectId || testSuiteData?.project_id || (testCaseData as any).project_id;
        if (testCaseData.section_id && projectForSections) {
          try {
            const hierarchyData = await sectionsAPI.getProjectSectionHierarchy(Number(projectForSections));
            const allSections: any[] = [];

            const flattenSections = (hierarchy: any[]) => {
              hierarchy.forEach((item: any) => {
                (item.sections || []).forEach((currentSection: any) => {
                  allSections.push(currentSection);
                  if (currentSection.sections?.length) {
                    flattenSections([{ sections: currentSection.sections }]);
                  }
                });
              });
            };

            const findSectionPath = (sectionId: number): SectionCrumb[] => {
              const currentSection = allSections.find((candidate) => Number(candidate.id) === Number(sectionId));
              if (!currentSection) return [];
              const currentCrumb = { id: Number(currentSection.id), name: currentSection.name };
              if (!currentSection.parent_section_id) return [currentCrumb];
              const parentPath = findSectionPath(currentSection.parent_section_id);
              return parentPath.length > 0 ? [...parentPath, currentCrumb] : [currentCrumb];
            };

            flattenSections(hierarchyData.hierarchy || []);
            let sectionPath = findSectionPath(testCaseData.section_id);

            if (sectionPath.length === 0) {
              const sectionData = await sectionsAPI.getSectionDetails(testCaseData.section_id);
              const actualSection = sectionData.section || sectionData;
              sectionPath = [
                ...(sectionData.parent_section?.id ? [{ id: Number(sectionData.parent_section.id), name: sectionData.parent_section.name }] : []),
                ...(actualSection?.id ? [{ id: Number(actualSection.id), name: actualSection.name }] : []),
              ];
            }

            if (isMounted) {
              setSection(sectionPath.length > 0 ? {
                name: sectionPath.map((crumb) => crumb.name).join(' > '),
                path: sectionPath,
              } : null);
            }
          } catch (sectionError) {
            console.error('Failed to fetch section details:', sectionError);
            if (isMounted) setSection(null);
          }
        } else if (isMounted) {
          setSection(null);
        }

        const rawIsMultistep = (testCaseData as any).is_multistep;
        const isMultistep = typeof rawIsMultistep === 'string'
          ? rawIsMultistep.toLowerCase() === 'true'
          : Boolean(rawIsMultistep);

        if (isMultistep) {
          try {
            const steps = await testCasesAPI.getSteps(testCaseId);
            if (isMounted) setTestSteps(steps || []);
          } catch (stepsError) {
            console.error('Failed to fetch test steps:', stepsError);
            if (isMounted) setTestSteps([]);
          }
        } else if (isMounted) {
          setTestSteps([]);
        }

        setRevisionsLoading(true);
        api.get(`/test-cases/${testCaseId}/revisions`)
          .then((response) => {
            if (isMounted) setRevisions(response.data || []);
          })
          .catch((revisionError) => {
            console.error('Failed to fetch revisions:', revisionError);
            if (isMounted) setRevisions([]);
          })
          .finally(() => {
            if (isMounted) setRevisionsLoading(false);
          });

        testCasesAPI.getExecutionHistory(testCaseId, 50)
          .then((historyData) => {
            if (isMounted) setTestRunHistory(historyData || []);
          })
          .catch((historyError) => {
            console.error('Failed to fetch execution history:', historyError);
            if (isMounted) setTestRunHistory([]);
          });
      } catch (error) {
        console.error('Failed to fetch test case:', error);
        if (isMounted) setTestCase(null);
      } finally {
        if (isMounted) {
          setLoading(false);
          setIsValidatingProject(false);
        }
      }
    };

    fetchTestCaseAndSuite();

    return () => {
      isMounted = false;
    };
  }, [id, projectId]);

  useEffect(() => {
    if (!testCase?.reference || !testSuite) {
      Promise.resolve().then(() => setLinkedRequirement(null));
      return;
    }

    const reference = testCase.reference.trim();
    const isInternalRequirementRef = /^REQ-\d{3,}$/i.test(reference);
    if (!isInternalRequirementRef) {
      Promise.resolve().then(() => setLinkedRequirement(null));
      return;
    }

    const fetchRequirementDetails = async () => {
      try {
        const requirements = await requirementsAPI.getAll(Number(effectiveProjectId || testSuite.project_id), 0, 1000);
        const requirement = requirements.find((item) => item.requirement_id?.toLowerCase() === reference.toLowerCase());
        setLinkedRequirement(requirement || null);
      } catch (error) {
        console.log('No requirement found for reference:', reference);
        setLinkedRequirement(null);
      }
    };

    fetchRequirementDetails();
  }, [effectiveProjectId, testCase?.reference, testSuite]);

  const displaySteps = useMemo(() => {
    if (isMultistepCase) return testSteps;
    return (testCase?.steps || '')
      .split('\n')
      .map((step) => step.trim())
      .filter(Boolean)
      .map((step, index) => ({
        step_number: index + 1,
        action: step.replace(/^\d+\.\s*/, ''),
        expected_result: testCase?.expected_result || '',
        step_type: 'manual',
      }));
  }, [isMultistepCase, testCase, testSteps]);

  const latestExecution = testRunHistory[0];
  const uniqueRunCount = new Set(testRunHistory.map((item) => item.test_run_id).filter(Boolean)).size;
  const uniqueExecutors = new Set(
    testRunHistory
      .map((item) => item.executed_by_full_name || item.executed_by || item.executed_by_email)
      .filter(Boolean)
  ).size;

  const testCaseTags = testCase?.tags;
  const tags = useMemo(() => {
    if (!testCaseTags) return [];
    return testCaseTags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }, [testCaseTags]);
  const hasReference = Boolean(testCase?.reference?.trim());

  const customFieldRows = useMemo<CustomFieldDisplayRow[]>(() => {
    const savedValues = ((testCase as any)?.custom_field_values || []) as CustomFieldValue[];
    const valuesByFieldId = new Map(savedValues.map((value) => [value.field_definition_id, value]));
    const definitionsById = new Map(customFields.map((field) => [field.id, field]));

    const rows = customFields.map((field) => ({
      field,
      value: valuesByFieldId.get(field.id)?.value || '',
      valueId: valuesByFieldId.get(field.id)?.id,
      fieldDefinitionId: field.id,
    }));

    savedValues.forEach((value) => {
      if (!definitionsById.has(value.field_definition_id)) {
        rows.push({
          field: null,
          value: value.value || '',
          valueId: value.id,
          fieldDefinitionId: value.field_definition_id,
        });
      }
    });

    return rows.filter((row) => row.value.trim() || row.field?.is_required || !row.field);
  }, [customFields, testCase]);

  const hasCustomFieldRows = customFieldsLoading || customFieldRows.length > 0;

  const handleExecute = () => {
    if (!testCase) return;
    if (effectiveProjectId) {
      navigate(`/projects/${effectiveProjectId}/test-cases/${testCase.id}/execute`);
      return;
    }
    navigate(`/test-cases/${testCase.id}/execute`);
  };

  const handleEdit = () => {
    if (effectiveProjectId) {
      navigate(`/projects/${effectiveProjectId}/test-cases/${id}/edit`);
      return;
    }
    navigate(`/test-cases/${id}/edit`);
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({
        title: t('copied'),
        description: t('urlCopied'),
        variant: 'success',
      });
    } catch {
      toast({
        title: t('copyLink'),
        description: window.location.href,
      });
    }
  };

  const revisionsPath = effectiveProjectId ? `/projects/${effectiveProjectId}/test-cases/${testCase?.id}/revisions` : `/test-cases/${testCase?.id}/revisions`;
  const executionHistoryPath = effectiveProjectId ? `/projects/${effectiveProjectId}/test-cases/${testCase?.id}/execution-history` : `/test-cases/${testCase?.id}/execution-history`;
  const linkedRequirementPath = linkedRequirement && effectiveProjectId
    ? `/projects/${effectiveProjectId}/requirements/${linkedRequirement.id}`
    : null;
  const openRevisionsPage = () => navigate(revisionsPath);
  const openExecutionHistoryPage = () => navigate(executionHistoryPath);

  if (loading || isValidatingProject) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="h-44 animate-pulse rounded-3xl bg-slate-200 dark:bg-slate-800" />
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="h-96 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-96 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (!testCase || typeof testCase !== 'object') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="max-w-lg text-center">
          <CardHeader>
            <CardTitle>{testCase ? t('invalidTestCaseData') : t('testCaseNotFound')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {testCase ? t('unableToLoadDetails') : t('testCaseNotFoundDesc')}
            </p>
            <Button onClick={navigateBack}>{t('backToTestCases')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white px-4 py-6 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_34%),linear-gradient(135deg,_rgba(15,23,42,0.04),_transparent)] p-6 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.04),_transparent)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-4">
                <Button variant="ghost" onClick={navigateBack} className="-mx-3 h-9 text-slate-600 dark:text-slate-300">
                  {isRTL ? <ArrowRight className="ml-2 h-4 w-4" /> : <ArrowLeft className="mr-2 h-4 w-4" />}
                  {t('backToTestCases')}
                </Button>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950/80">
                      TC-{testCase.id.toString().padStart(3, '0')}
                    </Badge>
                    <Badge className={`${getStatusBadge(testCase.status)} rounded-full px-3 py-1 text-xs font-semibold`}>
                      {formatStatusLabel(testCase.status)}
                    </Badge>
                    <Badge className={`${getPriorityBadge(testCase.priority)} rounded-full px-3 py-1 text-xs font-semibold`}>
                      {formatStatusLabel(testCase.priority)}
                    </Badge>
                  </div>
                  <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 dark:text-white lg:text-4xl">
                    {testCase.title}
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {testCase.description || t('noDescription')}
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[380px] lg:grid-cols-1">
                <Button onClick={handleExecute} className="h-10 justify-center bg-blue-600 hover:bg-blue-700">
                  <Play className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                  {t('execute')}
                </Button>
                <Button variant="outline" onClick={handleEdit} className="h-10 justify-center">
                  <Edit className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                  {t('edit')}
                </Button>
                <Button variant="outline" onClick={handleShare} className="h-10 justify-center">
                  <Share2 className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                  {t('copyLink')}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-slate-200 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={t('stepCount')} value={displaySteps.length.toString()} />
            <MetricCard label={t('totalRuns')} value={uniqueRunCount.toString()} />
            <MetricCard label={t('latestResult')} value={latestExecution ? formatStatusLabel(latestExecution.status) : t('neverExecuted')} />
            <MetricCard label={t('revisionCount')} value={revisions.length.toString()} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                  <span className="rounded-lg bg-amber-100 p-1.5 dark:bg-amber-900/30">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                  </span>
                  {t('preconditions')}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                    {testCase.preconditions || t('noPreconditions')}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                  <span className="rounded-lg bg-blue-100 p-1.5 dark:bg-blue-900/30">
                    <FileText className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                  </span>
                  {t('testSteps')}
                  {isMultistepCase && (
                    <Badge className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {t('multistep')}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {isMultistepCase ? (
                  testSteps.length > 0 ? (
                    <div className="space-y-4">
                      {testSteps.map((step) => (
                        <div key={step.step_number} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                {step.step_number}
                              </span>
                              {step.step_type && (
                                <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs">
                                  {step.step_type}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <h5 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">{t('action')}</h5>
                              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600 dark:text-slate-300">
                                {step.action || t('noStepsDefined')}
                              </p>
                            </div>
                            <div>
                              <h5 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">{t('expectedResult')}</h5>
                              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600 dark:text-slate-300">
                                {step.expected_result || t('noExpectedResults')}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60">
                      <FileText className="mx-auto mb-2 h-10 w-10 text-slate-400" />
                      <p>{t('noMultistepData')}</p>
                    </div>
                  )
                ) : testCase.steps ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-300">
                      {testCase.steps}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60">
                    <FileText className="mx-auto mb-2 h-10 w-10 text-slate-400" />
                    <p>{t('noStepsDefined')}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {!isMultistepCase && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                    <span className="rounded-lg bg-emerald-100 p-1.5 dark:bg-emerald-900/30">
                      <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                    </span>
                    {t('expectedResults')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {testCase.expected_result ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                      <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-300">
                        {testCase.expected_result}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/60">
                      <CheckCircle className="mx-auto mb-2 h-10 w-10 text-slate-400" />
                      <p>{t('noExpectedResults')}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {linkedRequirement && (
              <Card className="border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5 text-violet-600" />
                    {t('linkedRequirement')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{linkedRequirement.requirement_id}</Badge>
                    <Badge>{linkedRequirement.priority}</Badge>
                    <Badge variant="secondary">{linkedRequirement.status}</Badge>
                  </div>
                  <h3 className="font-semibold text-slate-950 dark:text-white">
                    {linkedRequirementPath ? (
                      <Link to={linkedRequirementPath} className="text-blue-600 hover:underline dark:text-blue-400">
                        {linkedRequirement.title}
                      </Link>
                    ) : linkedRequirement.title}
                  </h3>
                  {linkedRequirement.description && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{linkedRequirement.description}</p>}
                  {linkedRequirement.acceptance_criteria && (
                    <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950">
                      <p className="mb-1 font-semibold">{t('acceptanceCriteria')}</p>
                      <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{linkedRequirement.acceptance_criteria}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-6">
            <Card className="border-slate-200 shadow-sm dark:border-slate-800">
              <CardHeader>
                <CardTitle className="text-base">{t('properties')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <PropertyRow label={t('testType')} value={formatStatusLabel(testCase.test_type)} />
                <PropertyRow
                  label={t('section')}
                  value={section?.path?.length ? (
                    <span className="flex flex-wrap justify-end gap-1">
                      {section.path.map((crumb, index) => (
                        <span key={crumb.id} className="inline-flex items-center gap-1">
                          {index > 0 && <span className="text-slate-400">/</span>}
                          <Link
                            to={effectiveProjectId ? `/projects/${effectiveProjectId}/sections/${crumb.id}` : '/test-cases'}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {crumb.name}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : t('noSection')}
                />
                <PropertyRow label={t('testSuite')} value={testSuite?.name || `${t('suite')} ${testCase.test_suite_id}`} />
                {hasReference && (
                  <PropertyRow
                    label={t('reference')}
                    value={linkedRequirementPath ? (
                      <Link to={linkedRequirementPath} className="text-blue-600 hover:underline dark:text-blue-400">
                        {testCase.reference as string}
                      </Link>
                    ) : testCase.reference as string}
                  />
                )}
                <PropertyRow label={t('createdBy')} value={testCase.creator?.full_name || testCase.creator?.username || t('unknown')} />
                <PropertyRow label={t('created')} value={formatDateTime(testCase.created_at)} />
                <PropertyRow label={t('updated')} value={formatDateTime(testCase.updated_at)} />
              </CardContent>
            </Card>

            {tags.length > 0 && (
              <Card className="border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Tag className="h-4 w-4 text-slate-500" />
                    {t('tags')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            )}

            {hasCustomFieldRows && (
              <Card className="border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Tag className="h-4 w-4 text-blue-600" />
                    {t('customFields')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {customFieldsLoading ? (
                    <p className="text-sm text-slate-500">{t('loadingCustomFields')}</p>
                  ) : (
                    <div className="space-y-3">
                      {customFieldRows.map((row) => (
                        <CustomFieldValueRow
                          key={`${row.fieldDefinitionId}-${row.valueId || 'definition'}`}
                          row={row}
                          notSetLabel={t('notSet')}
                          trueLabel={t('true')}
                          falseLabel={t('false')}
                          requiredLabel={t('requiredBadge')}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 shadow-sm dark:border-slate-800">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Play className="h-4 w-4 text-blue-600" />
                    {t('executionCoverage')}
                  </CardTitle>
                  {testRunHistory.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={openExecutionHistoryPage}>
                      {t('viewAll')}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <MiniStat label={t('totalRuns')} value={uniqueRunCount.toString()} />
                  <MiniStat label={t('totalExecutions')} value={testRunHistory.length.toString()} />
                  <MiniStat label={t('uniqueExecutors')} value={uniqueExecutors.toString()} />
                </div>
                {testRunHistory.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
                    {t('noExecutionHistory')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {testRunHistory.slice(0, 6).map((result) => (
                      <Link
                        key={result.id}
                        to={`/projects/${result.project_id || effectiveProjectId}/test-runs/${result.test_run_id}/test-cases/${testCase.id}`}
                        className="block rounded-2xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {result.test_run_name || `${t('testRun')} #${result.test_run_id}`}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {result.executed_by_full_name || result.executed_by || t('unknown')} • {formatDateTime(result.executed_at || result.created_at)}
                            </p>
                          </div>
                          <Badge className={getStatusBadgeClass(result.status)}>{formatStatusLabel(result.status)}</Badge>
                        </div>
                      </Link>
                    ))}
                    {testRunHistory.length > 6 && (
                      <Button variant="outline" size="sm" className="w-full" onClick={openExecutionHistoryPage}>
                        +{testRunHistory.length - 6} {t('moreExecutions')}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {(revisionsLoading || revisions.length > 0) && (
              <Card id="revision-history" className="border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4 text-amber-600" />
                    {t('revisionHistory')}
                  </CardTitle>
                  {!revisionsLoading && revisions.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={openRevisionsPage}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {revisionsLoading ? (
                    <p className="text-sm text-slate-500">{t('loadingRevisionHistory')}</p>
                  ) : (
                    <div className="space-y-3">
                      {revisions.slice(0, 5).map((revision) => (
                        <Link
                          key={revision.id}
                          to={revisionsPath}
                          className="block rounded-xl border border-slate-200 p-3 text-sm transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{t('revision')} {revision.revision_number}</span>
                            <span className="text-xs text-slate-500">{formatDateTime(revision.created_at)}</span>
                          </div>
                          {revision.change_reason && <p className="mt-1 text-xs text-slate-500">{revision.change_reason}</p>}
                        </Link>
                      ))}
                    </div>
                  )}
                  {!revisionsLoading && revisions.length > 5 && (
                    <Button variant="outline" size="sm" className="mt-3 w-full" onClick={openRevisionsPage}>
                      +{revisions.length - 5} {t('moreRevisions')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
      <p className="text-lg font-semibold text-slate-950 dark:text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function CustomFieldValueRow({
  row,
  notSetLabel,
  trueLabel,
  falseLabel,
  requiredLabel,
}: {
  row: CustomFieldDisplayRow;
  notSetLabel: string;
  trueLabel: string;
  falseLabel: string;
  requiredLabel: string;
}) {
  const fieldType = row.field?.field_type;
  const displayName = row.field?.name || `Field #${row.fieldDefinitionId}`;
  const hasValue = row.value.trim().length > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-slate-900 dark:text-white">{displayName}</p>
          {row.field?.description && (
            <p className="mt-1 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{row.field.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {fieldType && <Badge variant="outline" className="rounded-full text-[10px]">{formatStatusLabel(fieldType)}</Badge>}
          {row.field?.is_required && <Badge className="rounded-full bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{requiredLabel}</Badge>}
        </div>
      </div>
      <CustomFieldValueDisplay field={row.field} value={row.value} notSetLabel={notSetLabel} trueLabel={trueLabel} falseLabel={falseLabel} hasValue={hasValue} />
    </div>
  );
}

function CustomFieldValueDisplay({
  field,
  value,
  notSetLabel,
  trueLabel,
  falseLabel,
  hasValue,
}: {
  field: CustomFieldDefinition | null;
  value: string;
  notSetLabel: string;
  trueLabel: string;
  falseLabel: string;
  hasValue: boolean;
}) {
  if (!hasValue) {
    return <p className="text-sm text-slate-500">{notSetLabel}</p>;
  }

  if (field?.field_type === 'boolean') {
    const isTrue = value.toLowerCase() === 'true';
    return <Badge className={isTrue ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}>{isTrue ? trueLabel : falseLabel}</Badge>;
  }

  if (field?.field_type === 'multiselect') {
    const selectedValues = value.split(',').map((item) => item.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-2">
        {selectedValues.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}
      </div>
    );
  }

  if (field?.field_type === 'select') {
    const knownOption = getCustomFieldOptions(field).find((option) => option === value) || value;
    return <Badge variant="secondary">{knownOption}</Badge>;
  }

  return <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">{value}</p>;
}

function PropertyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[210px] text-right font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function getPriorityBadge(priority: string) {
  const variants: Record<string, string> = {
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return variants[priority] || variants.medium;
}

function getStatusBadge(status: string) {
  const variants: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    inactive: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    archived: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  };
  return variants[status] || variants.inactive;
}

function getStatusBadgeClass(status: string) {
  const variants: Record<string, string> = {
    pass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    passed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    skip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    skipped: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    block: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    blocked: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    not_tested: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return variants[status] || variants.pending;
}
