import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  Database,
  Edit,
  Eye,
  FileText,
  History,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Share2,
  Tag,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { WatchButton } from '@/components/WatchButton';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { api, customFieldsAPI, datasetsAPI, sectionsAPI, testCasesAPI, testSuitesAPI, type TestDataset, type GlobalParameter } from '@/lib/api';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { entityKey } from '@/lib/utils';
import { loadProjectParameters, paramsToMap, referencedKeys, resolveParameters } from '@/utils/parameters';
import { CustomFieldDefinition, CustomFieldValue, Requirement, TestCase, TestSuite } from '@/types';

type SectionCrumb = { id: number; name: string };
type CustomFieldDisplayRow = { field: CustomFieldDefinition | null; value: string; valueId?: number; fieldDefinitionId: number };

const SIDEBAR_VISIBLE_STORAGE_KEY = 'testCaseDetail.showSidebar';

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
  // The URL carries the per-project sequence; resolve it to the global test-case id.
  const { id: resolvedTcId, loading: tcIdLoading } = useResolvedEntityId(projectId, 'test-cases', id);
  const navigate = useNavigate();
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [dataset, setDataset] = useState<TestDataset | null>(null);
  const [globalParams, setGlobalParams] = useState<GlobalParameter[]>([]);
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
  const [showLinkedRequirements, setShowLinkedRequirements] = useState(true);
  const [linkedRequirements, setLinkedRequirements] = useState<Requirement[]>([]);
  const [linkedRequirementsLoading, setLinkedRequirementsLoading] = useState(false);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [isValidatingProject, setIsValidatingProject] = useState(false);
  const [showSidebar, setShowSidebar] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem(SIDEBAR_VISIBLE_STORAGE_KEY);
      return stored === null ? true : stored !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SIDEBAR_VISIBLE_STORAGE_KEY, showSidebar ? 'true' : 'false');
    } catch {
      // localStorage may be unavailable (private mode, quota); ignore.
    }
  }, [showSidebar]);

  const parseIsMultistep = (rawValue: unknown): boolean => {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'string') return rawValue.toLowerCase() === 'true';
    return Boolean(rawValue);
  };

  const isMultistepCase = useMemo(() => {
    if (!testCase) return false;
    return parseIsMultistep((testCase as any).is_multistep);
  }, [testCase]);

  const effectiveProjectId = projectId || testSuite?.project_id?.toString() || (testCase as any)?.project_id?.toString();

  const navigateBack = () => {
    if (effectiveProjectId) {
      navigate(`/projects/${effectiveProjectId}/test-cases`);
      return;
    }
    navigate('/test-cases');
  };

  const resetDetailState = () => {
    setTestCase(null);
    setTestSuite(null);
    setTestSteps([]);
    setSection(null);
    setRevisions([]);
    setTestRunHistory([]);
    setLinkedRequirements([]);
    setCustomFields([]);
  };

  useEffect(() => {
    let isMounted = true;

    const fetchTestCaseAndSuite = async () => {
      if (tcIdLoading) return;  // wait for the seq -> id resolution
      setLoading(true);
      setIsValidatingProject(true);

      const testCaseId = resolvedTcId;
      if (!testCaseId || Number.isNaN(testCaseId)) {
        resetDetailState();
        setLoading(false);
        setIsValidatingProject(false);
        return;
      }

      try {
        const testCaseData = await testCasesAPI.getById(testCaseId, { includeLinkedRequirements: true });
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
          resetDetailState();
          return;
        }

        if (!isMounted) return;
        setTestCase(testCaseData);
        setTestSuite(testSuiteData);
        setLinkedRequirements(Array.isArray(testCaseData.linked_requirements) ? testCaseData.linked_requirements : []);

        const projectForCustomFields = Number(projectId || testSuiteData?.project_id || testCaseData.test_suite?.project_id || (testCaseData as any).project_id);
        if (projectForCustomFields && !Number.isNaN(projectForCustomFields)) {
          setCustomFieldsLoading(true);
          customFieldsAPI.getDefinitions(projectForCustomFields, 'test_case')
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
            const sectionsById = new Map<number, any>();

            const flattenSections = (nodes: any[] | undefined) => {
              if (!Array.isArray(nodes)) return;
              for (const node of nodes) {
                const subSections: any[] = Array.isArray(node?.sections) ? node.sections : [];
                for (const candidate of subSections) {
                  const candidateId = Number(candidate?.id);
                  if (Number.isFinite(candidateId) && !sectionsById.has(candidateId)) {
                    sectionsById.set(candidateId, candidate);
                    if (Array.isArray(candidate.sections) && candidate.sections.length > 0) {
                      flattenSections([candidate]);
                    }
                  }
                }
              }
            };

            const findSectionPath = (sectionId: number): SectionCrumb[] => {
              const visited = new Set<number>();
              const path: SectionCrumb[] = [];
              let cursor: number | null | undefined = sectionId;
              while (cursor != null && Number.isFinite(Number(cursor))) {
                const numericId = Number(cursor);
                if (visited.has(numericId)) break; // cycle guard
                visited.add(numericId);
                const node = sectionsById.get(numericId);
                if (!node) break;
                path.unshift({ id: numericId, name: node.name });
                cursor = node.parent_section_id ?? null;
              }
              return path;
            };

            flattenSections(hierarchyData?.hierarchy || []);
            let sectionPath = findSectionPath(Number(testCaseData.section_id));

            if (sectionPath.length === 0) {
              try {
                const sectionData = await sectionsAPI.getSectionDetails(testCaseData.section_id);
                const actualSection = sectionData?.section || sectionData;
                sectionPath = [
                  ...(sectionData?.parent_section?.id ? [{ id: Number(sectionData.parent_section.id), name: sectionData.parent_section.name }] : []),
                  ...(actualSection?.id ? [{ id: Number(actualSection.id), name: actualSection.name }] : []),
                ];
              } catch (sectionFallbackError) {
                console.error('Failed to fetch section fallback details:', sectionFallbackError);
              }
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

        if (parseIsMultistep((testCaseData as any).is_multistep)) {
          try {
            const steps = await testCasesAPI.getSteps(testCaseId);
            if (isMounted) setTestSteps(Array.isArray(steps) ? steps : []);
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
            if (isMounted) setRevisions(Array.isArray(response.data) ? response.data : []);
          })
          .catch((revisionError) => {
            // 403 is expected for non-admin/manager users; keep silent in that case.
            if (revisionError?.response?.status !== 403) {
              console.error('Failed to fetch revisions:', revisionError);
            }
            if (isMounted) setRevisions([]);
          })
          .finally(() => {
            if (isMounted) setRevisionsLoading(false);
          });

        testCasesAPI.getExecutionHistory(testCaseId, 50)
          .then((historyData) => {
            if (isMounted) setTestRunHistory(Array.isArray(historyData) ? historyData : []);
          })
          .catch((historyError) => {
            console.error('Failed to fetch execution history:', historyError);
            if (isMounted) setTestRunHistory([]);
          });
      } catch (error) {
        console.error('Failed to fetch test case:', error);
        if (isMounted) resetDetailState();
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
    // resetDetailState only closes over setters (stable), so it doesn't belong in deps.

  }, [id, projectId, resolvedTcId, tcIdLoading]);

  // Load the attached dataset (if any) for read-only display.
  const attachedDatasetId = (testCase as any)?.dataset_id ?? null;
  useEffect(() => {
    if (!attachedDatasetId) {
      setDataset(null);
      return;
    }
    let cancelled = false;
    datasetsAPI
      .get(attachedDatasetId)
      .then((ds) => { if (!cancelled) setDataset(ds); })
      .catch(() => { if (!cancelled) setDataset(null); });
    return () => { cancelled = true; };
  }, [attachedDatasetId]);

  // Load the project's global parameters so we can show which ones this case
  // references via ${name} and what they resolve to.
  useEffect(() => {
    const numericProjectId = Number(effectiveProjectId);
    if (!Number.isFinite(numericProjectId)) {
      setGlobalParams([]);
      return;
    }
    let cancelled = false;
    loadProjectParameters(numericProjectId)
      .then((rows) => { if (!cancelled) setGlobalParams(rows); })
      .catch(() => { if (!cancelled) setGlobalParams([]); });
    return () => { cancelled = true; };
  }, [effectiveProjectId]);

  const displaySteps = useMemo(() => {
    const parseLegacyText = (text: string | undefined | null) =>
      (parseCodeFence(text || '')?.code ?? (text || ''))
        .split('\n')
        .map((step) => step.trim())
        .filter(Boolean)
        .map((step, index) => ({
          step_number: index + 1,
          action: step.replace(/^(\d+[.)]|[-*])\s*/, ''),
          // Only attach the test case's overall expected_result on the FINAL parsed
          // step (or on the only step) so it isn't repeated misleadingly under each row.
          expected_result: '',
          step_type: 'manual',
        }));

    if (isMultistepCase) {
      if (testSteps && testSteps.length > 0) return testSteps;
      // Fall back to legacy free-text steps if the multistep load failed or returned empty.
      return parseLegacyText(testCase?.steps);
    }

    const parsed = parseLegacyText(testCase?.steps);
    if (parsed.length > 0) {
      parsed[parsed.length - 1].expected_result = testCase?.expected_result || '';
    }
    return parsed;
  }, [isMultistepCase, testCase, testSteps]);

  // Global parameters actually referenced by this case's text, paired with the
  // value they resolve to during a run.
  const referencedParams = useMemo(() => {
    if (globalParams.length === 0) return [];
    const text = [
      testCase?.preconditions,
      testCase?.steps,
      testCase?.expected_result,
      ...displaySteps.flatMap((s) => [s.action, s.expected_result]),
    ].filter(Boolean).join('\n');
    const keys = new Set(referencedKeys(text));
    return globalParams.filter((p) => keys.has(p.name));
  }, [globalParams, testCase, displaySteps]);

  // Resolve ${name} placeholders to their global-parameter values for display.
  const globalMap = useMemo(() => paramsToMap(globalParams), [globalParams]);
  const resolve = (text: string | null | undefined): string => resolveParameters(text, globalMap);

  const latestExecution = testRunHistory[0];
  const uniqueRunCount = new Set(
    testRunHistory.map((item) => item.test_run_id).filter((value) => value != null)
  ).size;
  const uniqueExecutors = useMemo(() => {
    const ids = new Set<string>();
    for (const item of testRunHistory) {
      const explicitId = item.executed_by_id ?? null;
      if (explicitId != null) {
        ids.add(`id:${explicitId}`);
        continue;
      }
      const fallback = item.executed_by_email || item.executed_by || item.executed_by_full_name;
      if (fallback) ids.add(`name:${fallback}`);
    }
    return ids.size;
  }, [testRunHistory]);

  const testCaseTags = testCase?.tags;
  const tags = useMemo(() => {
    if (!testCaseTags) return [];
    const seen = new Set<string>();
    return testCaseTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => {
        if (!tag) return false;
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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
      navigate(`/projects/${effectiveProjectId}/test-cases/${testCase.project_seq ?? testCase.id}/execute`);
      return;
    }
    navigate(`/test-cases/${testCase.project_seq ?? testCase.id}/execute`);
  };

  const handleEdit = () => {
    if (effectiveProjectId) {
      navigate(`/projects/${effectiveProjectId}/test-cases/${testCase?.project_seq ?? testCase?.id}/edit`);
      return;
    }
    navigate(`/test-cases/${testCase?.project_seq ?? testCase?.id}/edit`);
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

  const revisionsPath = effectiveProjectId ? `/projects/${effectiveProjectId}/test-cases/${testCase?.project_seq ?? testCase?.id}/revisions` : `/test-cases/${testCase?.project_seq ?? testCase?.id}/revisions`;
  const executionHistoryPath = effectiveProjectId ? `/projects/${effectiveProjectId}/test-cases/${testCase?.project_seq ?? testCase?.id}/execution-history` : `/test-cases/${testCase?.project_seq ?? testCase?.id}/execution-history`;
  const getLinkedRequirementPath = (requirement: Requirement) => (
    effectiveProjectId ? `/projects/${effectiveProjectId}/requirements/${requirement.id}` : null
  );
  const renderReferenceValue = (reference: string) => {
    const requirementsByKey = new Map(
      linkedRequirements
        .filter((requirement) => requirement.requirement_id)
        .map((requirement) => [String(requirement.requirement_id).toLowerCase(), requirement]),
    );

    if (requirementsByKey.size === 0) return reference;

    const parts = reference.split(/(\s+|[,;|/]+)/);
    return (
      <span className="wrap-break-word">
        {parts.map((part, index) => {
          const normalized = part.trim().replace(/^[()[\]{}"']+|[()[\]{}"',.]+$/g, '').toLowerCase();
          const requirement = requirementsByKey.get(normalized);
          const path = requirement ? getLinkedRequirementPath(requirement) : null;

          if (!requirement || !path) {
            return <span key={`${part}-${index}`}>{part}</span>;
          }

          return (
            <Link
              key={`${requirement.id}-${index}`}
              to={path}
              className="font-mono text-blue-600 hover:underline dark:text-blue-400"
            >
              {part}
            </Link>
          );
        })}
      </span>
    );
  };
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

  if (!testCase) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="max-w-lg text-center">
          <CardHeader>
            <CardTitle>{t('testCaseNotFound')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('testCaseNotFoundDesc')}</p>
            <Button onClick={navigateBack}>{t('backToTestCases')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const testCaseIdLabel = entityKey('TC', testCase);

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-white px-4 py-6 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.04),transparent)] p-6 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-4">
                <Button variant="ghost" onClick={navigateBack} className="-mx-3 h-9 text-slate-600 dark:text-slate-300">
                  {isRTL ? <ArrowRight className="ml-2 h-4 w-4" /> : <ArrowLeft className="mr-2 h-4 w-4" />}
                  {t('backToTestCases')}
                </Button>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950/80">
                      {testCaseIdLabel}
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
              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[380px] lg:grid-cols-1">
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
                <WatchButton entityType="test_case" entityId={testCase.id} />
                <Button
                  variant="outline"
                  onClick={() => setShowSidebar((prev) => !prev)}
                  className="h-10 justify-center"
                  aria-pressed={showSidebar}
                  title={showSidebar ? t('hideSidebar') : t('showSidebar')}
                >
                  {showSidebar ? (
                    <PanelRightClose className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                  ) : (
                    <PanelRightOpen className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4`} />
                  )}
                  {showSidebar ? t('hideSidebar') : t('showSidebar')}
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

        <div className={`grid gap-6 ${showSidebar ? 'lg:grid-cols-[minmax(0,1fr)_380px]' : 'lg:grid-cols-1'}`}>
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
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
                  <p className="whitespace-pre-wrap wrap-break-word text-[15px] leading-7 text-slate-700 dark:text-slate-300">
                    {testCase.preconditions ? resolve(testCase.preconditions) : t('noPreconditions')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {dataset && (
              <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                    <span className="rounded-lg bg-emerald-100 p-1.5 dark:bg-emerald-900/30">
                      <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                    </span>
                    {t('testDataSet')}: {dataset.name}
                    <Badge className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {t('datasetRowCount', { count: String(dataset.rows.length) })}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('datasetUsageHint', { params: dataset.parameters.map((p) => `\${${p}}`).join(', ') })}
                  </p>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950/60">
                          <th className="px-3 py-2 text-left font-medium text-slate-500">#</th>
                          {dataset.parameters.map((p) => (
                            <th key={p} className="px-3 py-2 text-left font-mono text-xs text-slate-700 dark:text-slate-300">{p}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataset.rows.map((row, i) => (
                          <tr key={i} className="border-t border-slate-200 dark:border-slate-800">
                            <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                            {dataset.parameters.map((p) => (
                              <td key={p} className="px-3 py-2 text-slate-700 dark:text-slate-300">{row[p] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {referencedParams.length > 0 && (
              <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                    <span className="rounded-lg bg-amber-100 p-1.5 dark:bg-amber-900/30">
                      <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                    </span>
                    {t('globalParameters')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t('globalParamsReferencedHint')}</p>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950/60">
                          <th className="px-3 py-2 text-left font-mono text-xs text-slate-700 dark:text-slate-300">{t('name')}</th>
                          <th className="px-3 py-2 text-left text-xs text-slate-500">{t('value')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referencedParams.map((p) => (
                          <tr key={p.id} className="border-t border-slate-200 dark:border-slate-800">
                            <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{`\${${p.name}}`}</td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                              {p.is_encrypted ? <span className="text-slate-400">••••••</span> : p.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
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
                              <p className="whitespace-pre-wrap wrap-break-word text-sm leading-7 text-slate-600 dark:text-slate-300">
                                {step.action ? resolve(step.action) : t('noStepsDefined')}
                              </p>
                            </div>
                            <div>
                              <h5 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">{t('expectedResult')}</h5>
                              <p className="whitespace-pre-wrap wrap-break-word text-sm leading-7 text-slate-600 dark:text-slate-300">
                                {step.expected_result ? resolve(step.expected_result) : t('noExpectedResults')}
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
                    <StepsTextContent value={resolve(testCase.steps)} />
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
              <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
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
                      <p className="whitespace-pre-wrap wrap-break-word text-sm leading-7 text-slate-700 dark:text-slate-300">
                        {resolve(testCase.expected_result)}
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

          </div>

          {showSidebar && (
          <aside className="space-y-6">
            <Card className="border-slate-200 shadow-xs dark:border-slate-800">
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
                          {effectiveProjectId ? (
                            <Link
                              to={`/projects/${effectiveProjectId}/sections/${crumb.id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {crumb.name}
                            </Link>
                          ) : (
                            <span>{crumb.name}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : t('noSection')}
                />
                <PropertyRow label={t('testSuite')} value={testSuite?.name || `${t('suite')} ${testCase.test_suite_id}`} />
                {hasReference && (
                  <PropertyRow
                    label={t('reference')}
                    value={renderReferenceValue(testCase.reference as string)}
                  />
                )}
                <PropertyRow label={t('createdBy')} value={testCase.creator?.full_name || testCase.creator?.username || t('unknown')} />
                <PropertyRow label={t('created')} value={formatDateTime(testCase.created_at)} />
                <PropertyRow label={t('updated')} value={formatDateTime(testCase.updated_at)} />
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-xs dark:border-slate-800">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-violet-600" />
                    {t('linkedRequirements')}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{t('showLinkedRequirements')}</span>
                    <Switch
                      checked={showLinkedRequirements}
                      onCheckedChange={setShowLinkedRequirements}
                      aria-label={t('showLinkedRequirements')}
                    />
                  </div>
                </div>
              </CardHeader>
              {showLinkedRequirements && (
                <CardContent>
                  {linkedRequirementsLoading ? (
                    <div className="space-y-2">
                      <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
                      <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
                    </div>
                  ) : linkedRequirements.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
                      {t('noLinkedRequirementsForTestCase')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {linkedRequirements.map((requirement) => {
                        const requirementPath = getLinkedRequirementPath(requirement);
                        return (
                          <div key={requirement.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{requirement.requirement_id}</Badge>
                              <Badge>{requirement.priority}</Badge>
                              <Badge variant="secondary">{requirement.status}</Badge>
                            </div>
                            <h3 className="wrap-break-word text-sm font-semibold text-slate-950 dark:text-white">
                              {requirementPath ? (
                                <Link to={requirementPath} className="text-blue-600 hover:underline dark:text-blue-400">
                                  {requirement.title}
                                </Link>
                              ) : requirement.title}
                            </h3>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            {tags.length > 0 && (
              <Card className="border-slate-200 shadow-xs dark:border-slate-800">
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
              <Card className="border-slate-200 shadow-xs dark:border-slate-800">
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

            <Card className="border-slate-200 shadow-xs dark:border-slate-800">
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
                    {testRunHistory.slice(0, 6).map((result) => {
                      const resultProjectId = result.project_id || effectiveProjectId;
                      const linkTarget = resultProjectId && result.test_run_id
                        ? `/projects/${resultProjectId}/test-runs/${result.test_run_id}/test-cases/${testCase.id}`
                        : null;
                      const rowClassName = 'block rounded-2xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20';
                      const rowContents = (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {result.test_run_name || `${t('testRun')} #${result.test_run_id ?? '?'}`}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {result.executed_by_full_name || result.executed_by || t('unknown')} • {formatDateTime(result.executed_at || result.created_at)}
                            </p>
                          </div>
                          <Badge className={getStatusBadgeClass(result.status)}>{formatStatusLabel(result.status)}</Badge>
                        </div>
                      );
                      return linkTarget ? (
                        <Link key={result.id} to={linkTarget} className={rowClassName}>
                          {rowContents}
                        </Link>
                      ) : (
                        <div key={result.id} className={rowClassName.replace('hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-800 dark:hover:bg-blue-950/20', '')}>
                          {rowContents}
                        </div>
                      );
                    })}
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
              <Card id="revision-history" className="border-slate-200 shadow-xs dark:border-slate-800">
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
          )}
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
          <p className="wrap-break-word text-sm font-semibold text-slate-900 dark:text-white">{displayName}</p>
          {row.field?.description && (
            <p className="mt-1 wrap-break-word text-xs leading-5 text-slate-500 dark:text-slate-400">{row.field.description}</p>
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

  return <p className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-slate-700 dark:text-slate-300">{value}</p>;
}

// AI-applied Gherkin is stored as a fenced code block so the markdown step
// editor preserves its line breaks. Detect that here so the detail view renders
// it as a clean monospace block instead of leaking the ``` fence markers.
const STEPS_CODE_FENCE_RE = /^```[ \t]*([\w-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

function parseCodeFence(text: string): { language: string; code: string } | null {
  const match = (text || '').trim().match(STEPS_CODE_FENCE_RE);
  return match ? { language: match[1] || '', code: match[2] } : null;
}

function StepsTextContent({ value }: { value: string }) {
  const fence = parseCodeFence(value);
  if (fence) {
    return (
      <div className="space-y-2">
        {fence.language && (
          <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {fence.language}
          </span>
        )}
        <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-slate-900 p-3 font-mono text-[13px] leading-6 text-slate-100 dark:bg-slate-950">{fence.code}</pre>
      </div>
    );
  }
  return (
    <p className="whitespace-pre-wrap wrap-break-word text-sm leading-7 text-slate-700 dark:text-slate-300">{value}</p>
  );
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

function getStatusBadge(status: string | undefined | null) {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  const variants: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    inactive: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    under_review: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    obsolete: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    archived: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return variants[normalized] || variants.inactive;
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
    not_started: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return variants[status] || variants.pending;
}
