import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Plus, Edit, Trash2, Loader2, UserCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { analyticsAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { RootCauseAnalysisModal } from '@/components/reports/RootCauseAnalysisModal';
import { useRcaFormData } from '@/components/reports/useRcaFormData';

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  closed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const STATUS_LABEL_KEY: Record<string, string> = {
  open: 'open',
  in_progress: 'inProgress',
  resolved: 'resolved',
  closed: 'closed',
};

/**
 * Root Cause Analysis section for a single defect. Lists the analyses anchored to
 * this defect and lets the user author/edit them inline (the defect link is
 * pre-filled and locked in the modal). Deleting is a manager+ action.
 */
export function DefectRootCauseCard({
  projectId,
  defect,
  canWrite,
}: {
  projectId: number;
  defect: { id: number; defect_id?: string | null; title?: string | null };
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { canManageProject } = useProjectPermissions(projectId);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const listQuery = useQuery<any[]>({
    queryKey: ['rca', 'list', projectId, 'defect', defect.id],
    enabled: !!projectId && !!defect.id,
    queryFn: async () => {
      const data = await analyticsAPI.getRootCauseAnalyses(projectId, { defectId: defect.id });
      return Array.isArray(data) ? data : [];
    },
  });
  const analyses = listQuery.data ?? [];

  const { formData, isLoading: formDataLoading } = useRcaFormData(projectId, showModal);

  // Seed the locked defect into the modal's options so the disabled select can
  // still render this defect's label even before the full list resolves.
  const formDataWithDefect = useMemo(() => {
    const hasDefect = formData.defects.some((d: any) => d.id === defect.id);
    return hasDefect
      ? formData
      : { ...formData, defects: [{ id: defect.id, defect_id: defect.defect_id, title: defect.title }, ...formData.defects] };
  }, [formData, defect.id, defect.defect_id, defect.title]);

  const statusLabel = (status: string) => t(STATUS_LABEL_KEY[status] || status);

  const openCreate = () => {
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (analysis: any) => {
    setEditing(analysis);
    setShowModal(true);
  };

  const handleDelete = async (analysis: any) => {
    if (!window.confirm(t('reports_rcaDeleteConfirm', { title: analysis.analysis_title }))) return;
    try {
      await analyticsAPI.deleteRootCauseAnalysis(analysis.id);
      await listQuery.refetch();
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">
          <Link
            to={`/projects/${projectId}/defects/root-cause-analysis`}
            className="inline-flex items-center gap-2 rounded-sm hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-blue-300"
          >
            <GitBranch className="h-5 w-5 text-blue-600" />
            {t('reportsTabRootCause')}
            {analyses.length > 0 && (
              <Badge variant="secondary" className="ml-1">{analyses.length}</Badge>
            )}
          </Link>
        </CardTitle>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('reports_loadingRCA')}
          </div>
        ) : analyses.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">{t('reports_noRCA')}</p>
        ) : (
          analyses.map((analysis: any) => {
            const data = analysis.analysis_data || {};
            return (
              <div
                key={analysis.id}
                className="rounded-lg border p-3 dark:border-gray-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => openEdit(analysis)}
                        className="block max-w-full truncate rounded-sm text-start text-sm font-medium hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-blue-300"
                      >
                        {analysis.analysis_title || `Analysis #${analysis.id}`}
                      </button>
                    ) : (
                      <p className="truncate text-sm font-medium">
                        {analysis.analysis_title || `Analysis #${analysis.id}`}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge className={cn('capitalize', SEVERITY_BADGE[analysis.severity] || SEVERITY_BADGE.low)}>
                        {analysis.severity || 'unknown'}
                      </Badge>
                      <Badge className={cn('capitalize', STATUS_BADGE[analysis.status] || STATUS_BADGE.open)}>
                        {statusLabel(analysis.status || 'open')}
                      </Badge>
                      {data.category && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                          {t(`rca_cat_${data.category}`)}
                        </span>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 items-center">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(analysis)} aria-label={t('reports_rcaEditAria')}>
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
                  )}
                </div>
                {analysis.root_cause && (
                  <p className="mt-2 line-clamp-3 text-sm text-gray-600 dark:text-gray-400">{analysis.root_cause}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  {analysis.assignee_name && (
                    <span className="inline-flex items-center gap-1">
                      <UserCircle className="h-3.5 w-3.5" />
                      {analysis.assignee_name}
                    </span>
                  )}
                  {analysis.resolution_time_hours != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {analysis.resolution_time_hours}h
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <RootCauseAnalysisModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => listQuery.refetch()}
        editing={editing}
        projectId={projectId}
        formData={formDataWithDefect}
        formDataLoading={formDataLoading}
        lockedDefectId={defect.id}
      />
    </Card>
  );
}
