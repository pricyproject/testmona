import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, History, User, Calendar, GitCompare, 
  FileText, AlertTriangle, CheckCircle, XCircle, Eye, EyeOff
} from 'lucide-react';
import { testCasesAPI, api } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';

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
}

export function TestCaseRevisions() {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [currentTestCase, setCurrentTestCase] = useState<TestCase | null>(null);
  const [selectedRevisions, setSelectedRevisions] = useState<number[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<Revision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDifferences, setShowDifferences] = useState(false);

  useEffect(() => {
    const fetchRevisionsAndTestCase = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch current test case
        const testCaseData = await testCasesAPI.getById(parseInt(id || '1'));
        setCurrentTestCase(testCaseData);

        // Fetch revisions
        const revisionsData = await api.get(`/test-cases/${id}/revisions`);
        setRevisions(revisionsData.data || []);
      } catch (error: any) {
        console.error('Failed to fetch revisions:', error);
        // Don't show error message, just don't display revisions section
        setRevisions([]);
        setError(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRevisionsAndTestCase();
  }, [id]);

  const handleBack = () => {
    if (projectId) {
      navigate(`/projects/${projectId}/test-cases/${id}`);
    } else {
      navigate(`/test-cases/${id}`);
    }
  };

  const handleRevisionSelect = (revisionId: number) => {
    setSelectedRevisions(prev => {
      if (prev.includes(revisionId)) {
        return prev.filter(id => id !== revisionId);
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
      setShowDifferences(true);
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

  const renderFieldComparison = (field: string, oldValue: any, newValue: any) => {
    const hasChanged = oldValue !== newValue;
    
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
                <pre className="whitespace-pre-wrap text-xs">{oldValue || t('nA')}</pre>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('newValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                <pre className="whitespace-pre-wrap text-xs">{newValue || t('nA')}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('oldValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                {oldValue || t('nA')}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('newValue')}:</p>
              <div className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
                {newValue || t('nA')}
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
    
    return (
      <Card className="shadow-xs border-0 bg-white dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t('revisionDetails')} #{revision.revision_number}
            </CardTitle>
            <div className="flex items-center gap-2">
              {previousRevision && (
                <Button variant="outline" onClick={() => setSelectedRevision(previousRevision)}>
                  <ArrowLeft className={`h-4 w-4 ${isRTL ? 'mr-2' : 'ml-2'}`} />
                  {t('previousRevision')}
                </Button>
              )}
              <Button variant="outline" onClick={handleBackToList}>
                <ArrowLeft className={`h-4 w-4 ${isRTL ? 'mr-2' : 'ml-2'}`} />
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
              {new Date(revision.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {revision.change_reason && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-sm text-blue-900 dark:text-blue-100 mb-2">{t('changeReason')}</h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {revision.change_reason.replace(/Updated fields/gi, t('updatedFields'))}
              </p>
            </div>
          )}
          
          {revision.changed_fields && Object.keys(revision.changed_fields).length > 0 && (
            <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
              <h4 className="font-medium text-sm text-orange-900 dark:text-orange-100 mb-2">{t('changedFields')}</h4>
              <div className="flex flex-wrap gap-1">
                {Object.keys(revision.changed_fields).map((field: string) => (
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
              {(revision.description || (revision.changed_fields?.description && previousRevision?.description)) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldDescription')}</h5>
                  {revision.changed_fields?.description && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{previousRevision.description || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{revision.description || t('nA')}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{revision.description || t('noDescription')}</pre>
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
              {(revision.preconditions || (revision.changed_fields?.preconditions && previousRevision?.preconditions)) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldPreconditions')}</h5>
                  {revision.changed_fields?.preconditions && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{previousRevision.preconditions || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{revision.preconditions}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{revision.preconditions}</pre>
                    </div>
                  )}
                </div>
              )}
              
              {/* Test Steps */}
              {(revision.steps || (revision.changed_fields?.steps && previousRevision?.steps)) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldSteps')}</h5>
                  {revision.changed_fields?.steps && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{previousRevision.steps || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{revision.steps}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{revision.steps}</pre>
                    </div>
                  )}
                </div>
              )}
              
              {/* Expected Result */}
              {(revision.expected_result || (revision.changed_fields?.expected_result && previousRevision?.expected_result)) && (
                <div className="border rounded-lg p-4 border-gray-200 dark:border-gray-700">
                  <h5 className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('fieldExpectedResult')}</h5>
                  {revision.changed_fields?.expected_result && previousRevision ? (
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">{t('before')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{previousRevision.expected_result || t('nA')}</pre>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">{t('after')}:</p>
                        <div className="text-sm text-gray-900 dark:text-gray-100">
                          <pre className="whitespace-pre-wrap">{revision.expected_result}</pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <pre className="whitespace-pre-wrap">{revision.expected_result}</pre>
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

  const getPriorityBadge = (priority: string) => {
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
    // Don't show error message, just redirect back or show empty state
    return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xs border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                onClick={handleBack}
                className="hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ArrowLeft className={`h-4 w-4 ${isRTL ? 'mr-2' : 'ml-2'}`} />
                {t('backToTestCase')}
              </Button>
          </div>
        </div>
      </div>
    );
  }

  const compareRevision1 = selectedRevisions[0] ? getRevisionById(selectedRevisions[0]) : null;
  const compareRevision2 = selectedRevisions[1] ? getRevisionById(selectedRevisions[1]) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xs border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                onClick={handleBack}
                className="hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ArrowLeft className={`h-4 w-4 ${isRTL ? 'mr-2' : 'ml-2'}`} />
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
                <span>Revision #{compareRevision1.revision_number}</span>
                <span>→</span>
                <span>Revision #{compareRevision2.revision_number}</span>
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
                {revisions.map((revision) => (
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
                              Revision #{revision.revision_number}
                            </h3>
                            {revision.changed_fields && Object.keys(revision.changed_fields).length > 0 && (
                              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
                                {Object.keys(revision.changed_fields).length} {t('fieldsChanged')}
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
                              {new Date(revision.created_at).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>

                          {revision.changed_fields && Object.keys(revision.changed_fields).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {Object.keys(revision.changed_fields).map((field: string) => (
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
                              {t('reason')}: {revision.change_reason.replace(/Updated fields/gi, t('updatedFields'))}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
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
