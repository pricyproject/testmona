import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Edit, FileCheck, GitBranch, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { analyticsAPI } from '@/lib/api';
import { ReportsData } from '@/hooks/useReportsData';

const emptyAnalysis = {
  analysis_title: '',
  root_cause: '',
  severity: 'medium',
  status: 'open',
  impact_assessment: '',
  resolution_time_hours: '',
  fix_commit_hash: '',
  defect_id: '',
  requirement_id: '',
  test_case_id: '',
};

export function RootCauseAnalysisPanel({ ctx }: { ctx: ReportsData }) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const { rootCauseAnalyses, loadRootCauseAnalyses, selectedProject, error } = ctx;
  // Deleting an RCA is a manager+ action (testers can author/edit but not delete).
  const { canManageProject } = useProjectPermissions(selectedProject);
  const isLoading = !!ctx.loadingByTab['root-cause'];

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [newAnalysis, setNewAnalysis] = useState({ ...emptyAnalysis });

  const severityVariant = (severity: string) =>
    severity === 'high' || severity === 'critical' ? 'destructive' : 'secondary';

  const resetForm = () => {
    setNewAnalysis({ ...emptyAnalysis });
    setEditingId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEditDialog = (analysis: any) => {
    setNewAnalysis({
      analysis_title: analysis.analysis_title || '',
      root_cause: analysis.root_cause || '',
      severity: analysis.severity || 'medium',
      status: analysis.status || 'open',
      impact_assessment: analysis.impact_assessment || '',
      resolution_time_hours: analysis.resolution_time_hours != null ? String(analysis.resolution_time_hours) : '',
      fix_commit_hash: analysis.fix_commit_hash || '',
      defect_id: analysis.defect_id != null ? String(analysis.defect_id) : '',
      requirement_id: analysis.requirement_id != null ? String(analysis.requirement_id) : '',
      test_case_id: analysis.test_case_id != null ? String(analysis.test_case_id) : '',
    });
    setEditingId(analysis.id);
    setShowDialog(true);
  };

  const handleSave = async () => {
    const title = newAnalysis.analysis_title.trim();
    const rootCause = newAnalysis.root_cause.trim();
    if (!selectedProject || !title || !rootCause) return;
    const payload = {
      project_id: selectedProject,
      analysis_title: title,
      root_cause: rootCause,
      severity: newAnalysis.severity,
      status: newAnalysis.status,
      impact_assessment: newAnalysis.impact_assessment.trim() || null,
      resolution_time_hours: newAnalysis.resolution_time_hours ? Number(newAnalysis.resolution_time_hours) : null,
      fix_commit_hash: newAnalysis.fix_commit_hash.trim() || null,
      defect_id: newAnalysis.defect_id ? Number(newAnalysis.defect_id) : null,
      requirement_id: newAnalysis.requirement_id ? Number(newAnalysis.requirement_id) : null,
      test_case_id: newAnalysis.test_case_id ? Number(newAnalysis.test_case_id) : null,
    };
    const isEdit = editingId != null;
    setSaving(true);
    try {
      if (isEdit) {
        await analyticsAPI.updateRootCauseAnalysis(editingId!, payload);
      } else {
        await analyticsAPI.createRootCauseAnalysis(payload);
      }
      setShowDialog(false);
      resetForm();
      await loadRootCauseAnalyses();
      toast({
        title: isEdit ? t('reports_toast_analysisUpdated') : t('reports_toast_analysisAdded'),
        description: isEdit
          ? t('reports_toast_analysisUpdatedDesc', { title })
          : t('reports_toast_analysisAddedDesc', { title }),
      });
    } catch (err) {
      console.error('Failed to save root cause analysis:', err);
      toast({
        title: isEdit ? t('reports_toast_couldNotUpdateAnalysis') : t('reports_toast_couldNotAddAnalysis'),
        description: t('reports_toast_analysisSaveFailed'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (analysis: any) => {
    if (!window.confirm(t('reports_rcaDeleteConfirm', { title: analysis.analysis_title }))) return;
    try {
      await analyticsAPI.deleteRootCauseAnalysis(analysis.id);
      await loadRootCauseAnalyses();
      toast({
        title: t('reports_toast_analysisDeleted'),
        description: t('reports_toast_analysisDeletedDesc', { title: analysis.analysis_title }),
      });
    } catch (err) {
      console.error('Failed to delete root cause analysis:', err);
      toast({
        title: t('reports_toast_couldNotDeleteAnalysis'),
        description: t('reports_toast_analysisDeleteFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('reportsTabRootCause')}</h2>
          <p className="text-sm text-gray-600">{t('reports_rcaSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            {t('addRootCauseAnalysis')}
          </Button>
          <Button variant="outline" onClick={() => loadRootCauseAnalyses()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('reports_refresh')}
          </Button>
        </div>
      </div>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId != null ? t('editRootCauseAnalysis') : t('addRootCauseAnalysis')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label>{t('analysisTitle')}</Label>
              <Input
                value={newAnalysis.analysis_title}
                onChange={(e) => setNewAnalysis({ ...newAnalysis, analysis_title: e.target.value })}
                placeholder={t('enterAnalysisTitle')}
                maxLength={200}
              />
            </div>
            <div>
              <Label>{t('rootCause')}</Label>
              <Textarea
                value={newAnalysis.root_cause}
                onChange={(e) => setNewAnalysis({ ...newAnalysis, root_cause: e.target.value })}
                placeholder={t('describeRootCause')}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('severity')}</Label>
                <Select value={newAnalysis.severity} onValueChange={(value) => setNewAnalysis({ ...newAnalysis, severity: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('low')}</SelectItem>
                    <SelectItem value="medium">{t('medium')}</SelectItem>
                    <SelectItem value="high">{t('high')}</SelectItem>
                    <SelectItem value="critical">{t('critical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('status')}</Label>
                <Select value={newAnalysis.status} onValueChange={(value) => setNewAnalysis({ ...newAnalysis, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t('open')}</SelectItem>
                    <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                    <SelectItem value="resolved">{t('resolved')}</SelectItem>
                    <SelectItem value="closed">{t('closed')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t('impactAssessment')}</Label>
              <Textarea
                value={newAnalysis.impact_assessment}
                onChange={(e) => setNewAnalysis({ ...newAnalysis, impact_assessment: e.target.value })}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('resolutionTimeHours')}</Label>
                <Input
                  type="number"
                  min="0"
                  value={newAnalysis.resolution_time_hours}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, resolution_time_hours: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('linkedDefectId')}</Label>
                <Input
                  type="number"
                  min="1"
                  value={newAnalysis.defect_id}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, defect_id: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('reports_rcaRequirementIdLabel')}</Label>
                <Input
                  type="number"
                  min="1"
                  value={newAnalysis.requirement_id}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, requirement_id: e.target.value })}
                  placeholder={t('reports_rcaOptionalPlaceholder')}
                />
              </div>
              <div>
                <Label>{t('reports_rcaTestCaseIdLabel')}</Label>
                <Input
                  type="number"
                  min="1"
                  value={newAnalysis.test_case_id}
                  onChange={(e) => setNewAnalysis({ ...newAnalysis, test_case_id: e.target.value })}
                  placeholder={t('reports_rcaOptionalPlaceholder')}
                />
              </div>
            </div>
            <div>
              <Label>{t('fixCommitHash')}</Label>
              <Input
                value={newAnalysis.fix_commit_hash}
                onChange={(e) => setNewAnalysis({ ...newAnalysis, fix_commit_hash: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false);
                resetForm();
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!newAnalysis.analysis_title.trim() || !newAnalysis.root_cause.trim() || saving}
            >
              {saving ? t('saving') : editingId != null ? t('save') : t('add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-2" />
          <span className="text-gray-600">{t('reports_loadingRCA')}</span>
        </div>
      )}

      {!isLoading && rootCauseAnalyses.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GitBranch className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 text-center">{error || t('reports_noRCA')}</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && rootCauseAnalyses.length > 0 && (
        <div className="space-y-4">
          {rootCauseAnalyses.map((analysis) => (
            <Card key={analysis.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileCheck className="h-5 w-5 text-blue-600" />
                    <CardTitle className="text-base">{analysis.analysis_title || `Analysis #${analysis.id}`}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={severityVariant(analysis.severity)} className="capitalize">
                      {analysis.severity || 'unknown'}
                    </Badge>
                    <Badge variant={analysis.status === 'open' ? 'destructive' : 'secondary'} className="capitalize">
                      {String(analysis.status || 'open').replace('_', ' ')}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(analysis)} aria-label={t('reports_rcaEditAria')}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    {canManageProject && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(analysis)}
                      aria-label={t('reports_rcaDeleteAria')}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="md:col-span-2">
                    <p className="font-medium text-gray-700">{t('reports_rcaRootCauseLabel')}</p>
                    <p className="text-gray-600">{analysis.root_cause || t('reports_rcaNotDocumented')}</p>
                  </div>
                  {analysis.impact_assessment && (
                    <div className="md:col-span-2">
                      <p className="font-medium text-gray-700">{t('reports_rcaImpactLabel')}</p>
                      <p className="text-gray-600">{analysis.impact_assessment}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-gray-700">{t('reports_rcaResolutionTimeLabel')}</p>
                    <p className="text-gray-600">
                      {analysis.resolution_time_hours != null ? `${analysis.resolution_time_hours}h` : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700">{t('reports_rcaLinkedDefect')}</p>
                    <p className="text-gray-600">
                      {analysis.defect_id ? (
                        <Link
                          to={`/projects/${selectedProject}/defects/${analysis.defect_id}`}
                          className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                        >
                          #{analysis.defect_id}
                        </Link>
                      ) : (
                        'N/A'
                      )}
                    </p>
                  </div>
                  {analysis.requirement_id && (
                    <div>
                      <p className="font-medium text-gray-700">{t('reports_rcaLinkedRequirement')}</p>
                      <p className="text-gray-600">
                        <Link
                          to={`/projects/${selectedProject}/requirements/${analysis.requirement_id}`}
                          className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                        >
                          REQ #{analysis.requirement_id}
                        </Link>
                      </p>
                    </div>
                  )}
                  {analysis.test_case_id && (
                    <div>
                      <p className="font-medium text-gray-700">{t('reports_rcaLinkedTestCase')}</p>
                      <p className="text-gray-600">
                        <Link
                          to={`/projects/${selectedProject}/test-cases/${analysis.test_case_id}`}
                          className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                        >
                          TC-{analysis.test_case_id}
                        </Link>
                      </p>
                    </div>
                  )}
                  {analysis.fix_commit_hash && (
                    <div>
                      <p className="font-medium text-gray-700">{t('reports_rcaFixCommit')}</p>
                      <p className="font-mono text-xs text-green-600">{analysis.fix_commit_hash}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-gray-700">{t('reports_rcaRecorded')}</p>
                    <p className="text-gray-600">
                      {analysis.created_at ? new Date(analysis.created_at).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
