import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, ArrowRight, History, User, Calendar, GitCompare,
  Eye, EyeOff, RotateCcw
} from 'lucide-react';
import { getApiErrorMessage } from '@/lib/api';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useTestCaseRevisions, useRestoreRevision } from '@/hooks/queries/testCaseRevisions';

interface Revision {
  id: number;
  test_case_id: number;
  revision_number: number;
  title: string;
  description?: string;
  test_type?: string;
  preconditions?: string;
  steps?: string;
  expected_result?: string;
  priority?: string;
  tags?: string;
  changed_fields?: Record<string, string>;
  change_reason?: string;
  created_by: number;
  created_at: string;
  creator?: {
    id: number;
    username: string;
    full_name?: string;
  };
}

interface TestCase {
  id: number;
  title: string;
  description?: string;
  test_type?: string;
  preconditions?: string;
  steps?: string;
  expected_result?: string;
  priority?: string;
  tags?: string;
  test_suite?: {
    id: number;
    project_id: number;
  };
}

const parsePositiveId = (value?: string): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const decodeHtmlEntities = (input: string): string => {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return namedEntities[entity] ?? match;
  });
};

const toDisplayText = (value?: string | null): string => {
  if (!value) return '';
  const decoded = decodeHtmlEntities(decodeHtmlEntities(String(value)));
  if (!/<[a-z][\s\S]*>/i.test(decoded)) {
    return decoded.replace(/\s+/g, ' ').trim();
  }

  const htmlForText = decoded
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote|section)\s*>/gi, '\n');

  if (typeof window === 'undefined') {
    return htmlForText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const parsed = new DOMParser().parseFromString(htmlForText, 'text/html');
  return (parsed.body.textContent || decoded).replace(/\s+/g, ' ').trim();
};

export function TestCaseRevisions() {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  // The URL carries the per-project sequence; resolve it to the global test-case id.
  const { id: testCaseId, loading: testCaseIdLoading } = useResolvedEntityId(projectId, 'test-cases', id);
  const routeProjectId = useMemo(() => parsePositiveId(projectId), [projectId]);
  const [selectedRevisions, setSelectedRevisions] = useState<number[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<Revision | null>(null);
  const [showDifferences, setShowDifferences] = useState(false);
  const [restoringRevisionNumber, setRestoringRevisionNumber] = useState<number | null>(null);
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  const revisionsQuery = useTestCaseRevisions(testCaseId, !testCaseIdLoading && !!testCaseId);
  const restoreRevision = useRestoreRevision(testCaseId);

  const currentTestCase: TestCase | null = revisionsQuery.data?.testCase ?? null;
  // A test case whose suite belongs to another project must not surface here.
  const projectMismatch = Boolean(
    routeProjectId &&
    currentTestCase?.test_suite?.project_id &&
    Number(currentTestCase.test_suite.project_id) !== routeProjectId,
  );
  const revisions: Revision[] = projectMismatch ? [] : (revisionsQuery.data?.revisions ?? []);
  const loading = testCaseIdLoading || (!!testCaseId && revisionsQuery.isLoading);
  const error: string | null =
    !testCaseIdLoading && !testCaseId
      ? t('invalidTestCaseId')
      : projectMismatch
        ? t('invalidProjectId')
        : revisionsQuery.isError
          ? getApiErrorMessage(revisionsQuery.error, t('failedToLoadTestCase'))
          : null;

  // Reset the selected revision / diff view whenever a fresh load lands
  // (initial load and after a restore refetch), matching the previous behaviour.
  useEffect(() => {
    if (revisionsQuery.data) {
      setSelectedRevision(null);
      setShowDifferences(false);
    }
  }, [revisionsQuery.data]);

  const handleBack = () => {
    const targetTestCaseId = testCaseId ?? id;
    const targetProjectId = routeProjectId ?? currentTestCase?.test_suite?.project_id;
    if (targetProjectId) {
      navigate(`/projects/${targetProjectId}/test-cases/${targetTestCaseId}`);
    } else {
      navigate(`/test-cases/${targetTestCaseId}`);
    }
  };

  const handleRevisionSelect = (revisionId: number) => {
    setSelectedRevisions(prev => {
      if (prev.includes(revisionId)) {
        return prev.filter(selectedId => selectedId !== revisionId);
      } else if (prev.length < 2) {
        return [...prev, revisionId];
      } else {
        return [prev[1], revisionId]; // Keep the latest and add new one
      }
    });
  };

  const handleRevisionClick = (revision: Revision) => {
    setSelectedRevision(revision);
    setShowDifferences(false);
  };

  const handleBackToList = () => {
    setSelectedRevision(null);
  };

  const handleCompare = () => {
    if (selectedRevisions.length === 2) {
      setSelectedRevision(null);
      setShowDifferences(true);
    }
  };

  const handleRestoreRevision = async (revision: Revision) => {
    if (!testCaseId) {
      toast({ title: t('error'), description: t('invalidTestCaseId'), variant: 'destructive' });
      return;
    }
    if (!window.confirm(t('confirmRestoreRevision'))) return;

    setRestoringRevisionNumber(revision.revision_number);
    try {
      await restoreRevision.mutateAsync(revision.revision_number);
      toast({ title: t('success'), description: t('revisionRestored') });
    } catch (restoreError: unknown) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(restoreError, t('failedToRestoreRevision')),
        variant: 'destructive',
      });
    } finally {
      setRestoringRevisionNumber(null);
    }
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      title: t('fieldTitle'),
      description: t('fieldDescription'),
      test_type: t('fieldTestType'),
      preconditions: t('fieldPreconditions'),
      steps: t('fieldSteps'),
      expected_result: t('fieldExpectedResult'),
      priority: t('fieldPriority'),
      tags: t('tags')
    };
    return labels[field] || field;
  };

  const getRevisionById = (revisionId: number) => {
    return revisions.find(r => r.id === revisionId);
  };

  const getChangedFieldKeys = (revision: Revision): string[] => {
    if (!revision.changed_fields || Array.isArray(revision.changed_fields) || typeof revision.changed_fields !== 'object') {
      return [];
    }
    return Object.keys(revision.changed_fields).filter(Boolean);
  };

  const formatDateTime = (value?: string): string => {
    if (!value) return t('nA');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('nA');
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatChangeReason = (value?: string): string => {
    if (!value) return '';
    return value.replace(/Updated fields/gi, t('updatedFields'));
  };

  const renderFieldComparison = (field: string, oldValue: any, newValue: any) => {
    const hasChanged = oldValue !== newValue;
    const oldDisplayValue = toDisplayText(oldValue) || t('nA');
    const newDisplayValue = toDisplayText(newValue) || t('nA');
    
    return (
      <div key={field} className={`border rounded-lg p-4 ${hasChanged ? 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20' : 'border-gray-200 dark:border-gray-700'}`}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-sm text-gray-900 dark:text-white">{getFieldLabel(field)}</h4>
          {hasChanged && (
            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
              {t('changed')}
            </Badge>
          )}
        </div>
        
        {field === 'steps' || field === 'preconditions' || field === 'expected_result' || field === 'description' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('oldValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                <pre className="whitespace-pre-wrap text-xs">{oldDisplayValue}</pre>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('newValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                <pre className="whitespace-pre-wrap text-xs">{newDisplayValue}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('oldValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                {oldDisplayValue}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('newValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                {newDisplayValue}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSingleRevisionDetails = (revision: Revision) => {
    // Get the previous revision to show before/after comparison
    const previousRevision = revisions.find(r => r.revision_number === revision.revision_number - 1);
    const changedFieldKeys = getChangedFieldKeys(revision);
    
    return (
      <Card className="shadow-xs border-0 bg-white dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t('revisionDetails')} #{revision.revision_number}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => handleRestoreRevision(revision)}
                disabled={restoringRevisionNumber === revision.revision_number}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                {restoringRevisionNumber === revision.revision_number ? t('loading') : t('restore')}
              </Button>
              {previousRevision && (
                <Button variant="outline" onClick={() => setSelectedRevision(previousRevision)} className="gap-2">
                  <BackIcon className="h-4 w-4" />
                  {t('previousRevision')}
                </Button>
              )}
              <Button variant="outline" onClick={handleBackToList} className="gap-2">
                <BackIcon className="h-4 w-4" />
                {t('backToList')}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {revision.creator?.full_name || revision.creator?.username || `User ${revision.created_by}`}
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateTime(revision.created_at)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {revision.change_reason && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-sm text-blue-900 dark:text-blue-100 mb-2">{t('changeReason')}</h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {formatChangeReason(revision.change_reason)}
              </p>
            </div>
          )}
          
          {changedFieldKeys.length > 0 && (
            <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
              <h4 className="font-medium text-sm text-orange-900 dark:text-orange-100 mb-2">{t('changedFields')}</h4>
              <div className="flex flex-wrap gap-1">
                {changedFieldKeys.map((field: string) => (
                  <Badge 
                    key={field} 
                    className="px-2 py-1 text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                  >
                    {getFieldLabel(field)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h4 className="font-medium text-sm text-gray-900 dark:text-white">{t('revisionContent')}</h4>
            
            <div className="grid grid-cols-1 gap-4">
              {/* Title */}
              <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldTitle')}</h5>
                {revision.changed_fields?.title && previousRevision ? (
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                      <p className="text-sm text-gray-900 dark:text-gray-100 line-through">{previousRevision.title}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                      <p className="text-sm text-gray-900 dark:text-gray-100 font-semibold">{revision.title}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-900 dark:text-gray-100">{revision.title}</p>
                )}
              </div>
              
              {/* Description */}
              {(toDisplayText(revision.description) || (revision.changed_fields?.description && toDisplayText(previousRevision?.description))) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldDescription')}</h5>
                  {revision.changed_fields?.description && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(previousRevision.description) || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(revision.description) || t('nA')}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{toDisplayText(revision.description) || t('noDescription')}</pre>
                    </div>
                  )}
                </div>
              )}
              
              {/* Test Type and Priority */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldTestType')}</h5>
                  {revision.changed_fields?.test_type && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                          {previousRevision.test_type}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          {revision.test_type}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                      {revision.test_type}
                    </Badge>
                  )}
                </div>
                
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldPriority')}</h5>
                  {revision.changed_fields?.priority && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <Badge className={`${getPriorityBadge(previousRevision.priority)} text-xs`}>
                          {previousRevision.priority}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <Badge className={`${getPriorityBadge(revision.priority)} text-xs`}>
                          {revision.priority}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <Badge className={`${getPriorityBadge(revision.priority)} text-xs`}>
                      {revision.priority}
                    </Badge>
                  )}
                </div>
              </div>
              
              {/* Preconditions */}
              {(toDisplayText(revision.preconditions) || (revision.changed_fields?.preconditions && toDisplayText(previousRevision?.preconditions))) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldPreconditions')}</h5>
                  {revision.changed_fields?.preconditions && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(previousRevision.preconditions) || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(revision.preconditions) || t('nA')}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{toDisplayText(revision.preconditions)}</pre>
                    </div>
                  )}
                </div>
              )}
              
              {/* Test Steps */}
              {(toDisplayText(revision.steps) || (revision.changed_fields?.steps && toDisplayText(previousRevision?.steps))) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldSteps')}</h5>
                  {revision.changed_fields?.steps && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(previousRevision.steps) || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(revision.steps) || t('nA')}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{toDisplayText(revision.steps)}</pre>
                    </div>
                  )}
                </div>
              )}
              
              {/* Expected Result */}
              {(toDisplayText(revision.expected_result) || (revision.changed_fields?.expected_result && toDisplayText(previousRevision?.expected_result))) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldExpectedResult')}</h5>
                  {revision.changed_fields?.expected_result && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(previousRevision.expected_result) || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{toDisplayText(revision.expected_result) || t('nA')}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{toDisplayText(revision.expected_result)}</pre>
                    </div>
                  )}
                </div>
              )}
              
              {/* Tags */}
              {(revision.tags || (revision.changed_fields?.tags && previousRevision?.tags)) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('tags')}</h5>
                  {revision.changed_fields?.tags && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="flex flex-wrap gap-1">
                          {(previousRevision.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).map((tag, index) => (
                            <Badge 
                              key={`${tag}-${index}`} 
                              variant="secondary" 
                              className="px-2 py-1 text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="flex flex-wrap gap-1">
                          {(revision.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).map((tag, index) => (
                            <Badge 
                              key={`${tag}-${index}`} 
                              variant="secondary" 
                              className="px-2 py-1 text-xs bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(revision.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).map((tag, index) => (
                        <Badge 
                          key={`${tag}-${index}`} 
                          variant="secondary" 
                          className="px-2 py-1 text-xs bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const getPriorityBadge = (priority?: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xs border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Button 
              variant="ghost" 
              onClick={handleBack}
              className="w-fit gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <BackIcon className="h-4 w-4" />
              {t('backToTestCase')}
            </Button>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const comparePair = selectedRevisions
    .map((revisionId) => getRevisionById(revisionId))
    .filter((revision): revision is Revision => Boolean(revision))
    .sort((a, b) => a.revision_number - b.revision_number);
  const compareRevision1 = comparePair[0] || null;
  const compareRevision2 = comparePair[1] || null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xs border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={handleBack}
                className="gap-2 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <BackIcon className="h-4 w-4" />
                {t('backToTestCase')}
              </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {selectedRevision ? `${t('revisionDetails')} #${selectedRevision.revision_number}` : t('revisionHistory')}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('testCase')}: {currentTestCase?.title || t('loading')}
              </p>
            </div>
          </div>
          
          {!selectedRevision && selectedRevisions.length === 2 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDifferences(!showDifferences)}
                className="flex items-center gap-2"
              >
                {showDifferences ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showDifferences ? t('hideDifferences') : t('showDifferences')}
              </Button>
              <Button
                onClick={handleCompare}
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
              >
                <GitCompare className="h-4 w-4" />
                {t('compareRevisions')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Show Single Revision Details */}
      {selectedRevision && renderSingleRevisionDetails(selectedRevision)}

      {/* Comparison View */}
      {!selectedRevision && showDifferences && compareRevision1 && compareRevision2 && (
        <Card className="shadow-xs border-0 bg-white dark:bg-gray-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              {t('revisionComparison')}
            </CardTitle>
            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-2">
                <span>{t('revision')} #{compareRevision1.revision_number}</span>
                <span>-&gt;</span>
                <span>{t('revision')} #{compareRevision2.revision_number}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderFieldComparison('title', compareRevision1.title, compareRevision2.title)}
            {renderFieldComparison('description', compareRevision1.description, compareRevision2.description)}
            {renderFieldComparison('test_type', compareRevision1.test_type, compareRevision2.test_type)}
            {renderFieldComparison('priority', compareRevision1.priority, compareRevision2.priority)}
            {renderFieldComparison('preconditions', compareRevision1.preconditions, compareRevision2.preconditions)}
            {renderFieldComparison('steps', compareRevision1.steps, compareRevision2.steps)}
            {renderFieldComparison('expected_result', compareRevision1.expected_result, compareRevision2.expected_result)}
            {renderFieldComparison('tags', compareRevision1.tags, compareRevision2.tags)}
          </CardContent>
        </Card>
      )}

      {/* Revisions List */}
      {!selectedRevision && (
        <Card className="shadow-xs border-0 bg-white dark:bg-gray-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t('allRevisions')} ({revisions.length})
            </CardTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('selectRevisionsToCompare')}
            </p>
          </CardHeader>
          <CardContent>
            {revisions.length > 0 ? (
              <div className="space-y-3">
                {revisions.map((revision) => {
                  const changedFieldKeys = getChangedFieldKeys(revision);
                  return (
                  <div 
                    key={revision.id} 
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedRevisions.includes(revision.id) 
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-400' 
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    onClick={() => handleRevisionClick(revision)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedRevisions.includes(revision.id)}
                          onChange={() => handleRevisionSelect(revision.id)}
                          className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-gray-900 dark:text-white">
                              {t('revision')} #{revision.revision_number}
                            </h3>
                            {changedFieldKeys.length > 0 && (
                              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
                                {changedFieldKeys.length} {t('fieldsChanged')}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400 mb-2">
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {revision.creator?.full_name || revision.creator?.username || `User ${revision.created_by}`}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDateTime(revision.created_at)}
                            </div>
                          </div>

                          {changedFieldKeys.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {changedFieldKeys.map((field: string) => (
                                <Badge 
                                  key={field} 
                                  variant="secondary" 
                                  className="px-1.5 py-0 text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                >
                                  {getFieldLabel(field)}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {revision.change_reason && (
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                              {t('reason')}: {formatChangeReason(revision.change_reason)}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRestoreRevision(revision);
                        }}
                        disabled={restoringRevisionNumber === revision.revision_number}
                        className="shrink-0 gap-2"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {restoringRevisionNumber === revision.revision_number ? t('loading') : t('restore')}
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <History className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p className="text-lg font-medium">{t('noRevisionsFound')}</p>
                <p className="text-sm mt-1">{t('editToCreateRevision')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
