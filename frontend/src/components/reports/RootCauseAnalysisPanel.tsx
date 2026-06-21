import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getApiErrorMessage } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useToast } from '@/hooks/use-toast';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertOctagon,
  Bug,
  CheckCircle2,
  Clock,
  Edit,
  FileCheck,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { analyticsAPI } from '@/lib/api';
import { RootCauseAnalysisModal } from './RootCauseAnalysisModal';
import { useRcaFormData } from './useRcaFormData';

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

export function RootCauseAnalysisPanel({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const { toast } = useToast();
  // Deleting an RCA is a manager+ action (testers can author/edit but not delete).
  const { canManageProject } = useProjectPermissions(projectId);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const listQuery = useQuery<any[]>({
    queryKey: ['rca', 'list', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const data = await analyticsAPI.getRootCauseAnalyses(projectId);
      return Array.isArray(data) ? data : [];
    },
  });
  const rootCauseAnalyses = listQuery.data ?? [];
  const isLoading = listQuery.isLoading;
  const error = listQuery.isError
    ? getApiErrorMessage(listQuery.error, t('reports_noRCA'))
    : null;
  const reload = () => listQuery.refetch();

  // Linked-entity + member lookups for the modal's searchable selects.
  const { formData, isLoading: formDataLoading } = useRcaFormData(projectId, showModal);

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
      await reload();
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

  const stats = useMemo(() => {
    const total = rootCauseAnalyses.length;
    const open = rootCauseAnalyses.filter((a: any) => a.status === 'open' || a.status === 'in_progress').length;
    const resolved = rootCauseAnalyses.filter((a: any) => a.status === 'resolved' || a.status === 'closed').length;
    const critical = rootCauseAnalyses.filter((a: any) => a.severity === 'critical' || a.severity === 'high').length;
    return { total, open, resolved, critical };
  }, [rootCauseAnalyses]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rootCauseAnalyses.filter((a: any) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
      if (term) {
        const haystack = [a.analysis_title, a.root_cause, a.impact_assessment, a.assignee_name, a.discoverer_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rootCauseAnalyses, statusFilter, severityFilter, search]);

  const statusLabel = (status: string) => t(STATUS_LABEL_KEY[status] || status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('reportsTabRootCause')}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('reports_rcaSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addRootCauseAnalysis')}
          </Button>
          <Button variant="outline" onClick={() => reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('reports_refresh')}
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {!isLoading && rootCauseAnalyses.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={<GitBranch className="h-4 w-4" />} label={t('rca_summaryTotal')} value={stats.total} tone="blue" />
          <StatTile icon={<Clock className="h-4 w-4" />} label={t('rca_summaryOpen')} value={stats.open} tone="rose" />
          <StatTile icon={<CheckCircle2 className="h-4 w-4" />} label={t('rca_summaryResolved')} value={stats.resolved} tone="emerald" />
          <StatTile icon={<AlertOctagon className="h-4 w-4" />} label={t('rca_summaryCritical')} value={stats.critical} tone="orange" />
        </div>
      )}

      {/* Filters */}
      {!isLoading && rootCauseAnalyses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('rca_searchPlaceholder')}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('rca_filterAllStatuses')}</SelectItem>
              <SelectItem value="open">{t('open')}</SelectItem>
              <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
              <SelectItem value="resolved">{t('resolved')}</SelectItem>
              <SelectItem value="closed">{t('closed')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('rca_filterAllSeverities')}</SelectItem>
              <SelectItem value="critical">{t('critical')}</SelectItem>
              <SelectItem value="high">{t('high')}</SelectItem>
              <SelectItem value="medium">{t('medium')}</SelectItem>
              <SelectItem value="low">{t('low')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="mr-2 h-8 w-8 animate-spin text-blue-600" />
          <span className="text-gray-600">{t('reports_loadingRCA')}</span>
        </div>
      )}

      {!isLoading && rootCauseAnalyses.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GitBranch className="mb-4 h-12 w-12 text-gray-400" />
            <p className="text-center text-gray-600">{error || t('reports_noRCA')}</p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addRootCauseAnalysis')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && rootCauseAnalyses.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">{t('rca_noMatch')}</CardContent>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((analysis: any) => {
            const data = analysis.analysis_data || {};
            return (
              <Card key={analysis.id} className="overflow-hidden">
                <div
                  className={cn(
                    'h-1 w-full',
                    analysis.severity === 'critical'
                      ? 'bg-red-500'
                      : analysis.severity === 'high'
                        ? 'bg-orange-500'
                        : analysis.severity === 'medium'
                          ? 'bg-amber-400'
                          : 'bg-slate-300',
                  )}
                />
                <CardContent className="space-y-4 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileCheck className="h-5 w-5 shrink-0 text-blue-600" />
                      <h3 className="truncate text-base font-semibold">
                        {analysis.analysis_title || `Analysis #${analysis.id}`}
                      </h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={cn('capitalize', SEVERITY_BADGE[analysis.severity] || SEVERITY_BADGE.low)}>
                        {analysis.severity || 'unknown'}
                      </Badge>
                      <Badge className={cn('capitalize', STATUS_BADGE[analysis.status] || STATUS_BADGE.open)}>
                        {statusLabel(analysis.status || 'open')}
                      </Badge>
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
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    {data.category && (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                          {t(`rca_cat_${data.category}`)}
                        </span>
                      </span>
                    )}
                    {analysis.assignee_name && (
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="h-3.5 w-3.5" />
                        {t('rca_assignedTo')}: <span className="font-medium text-gray-700 dark:text-gray-300">{analysis.assignee_name}</span>
                      </span>
                    )}
                    {analysis.discoverer_name && (
                      <span className="inline-flex items-center gap-1">
                        {t('rca_discoveredBy')}: {analysis.discoverer_name}
                      </span>
                    )}
                    {analysis.resolution_time_hours != null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {analysis.resolution_time_hours}h
                      </span>
                    )}
                    <span>
                      {t('reports_rcaRecorded')}:{' '}
                      {analysis.created_at ? formatDate(analysis.created_at) : 'N/A'}
                    </span>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('reports_rcaRootCauseLabel')}</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.root_cause || t('reports_rcaNotDocumented')}</p>
                  </div>

                  {analysis.impact_assessment && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('reports_rcaImpactLabel')}</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.impact_assessment}</p>
                    </div>
                  )}

                  {(data.corrective_action || data.preventive_action) && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {data.corrective_action && (
                        <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/20">
                          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            <Wrench className="h-3.5 w-3.5" />
                            {t('rca_correctiveLabel')}
                          </p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{data.corrective_action}</p>
                        </div>
                      )}
                      {data.preventive_action && (
                        <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-900/20">
                          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {t('rca_preventiveLabel')}
                          </p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{data.preventive_action}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Linked items */}
                  {(analysis.defect_id || analysis.requirement_id || analysis.test_case_id || analysis.fix_commit_hash) && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      {analysis.defect_id && (
                        <Link
                          to={`/projects/${projectId}/defects/${analysis.defect_id}`}
                          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                        >
                          <Bug className="h-3.5 w-3.5" />
                          {analysis.defect_key || `#${analysis.defect_id}`}
                          {analysis.defect_title ? ` · ${analysis.defect_title}` : ''}
                        </Link>
                      )}
                      {analysis.requirement_id && (
                        <Link
                          to={`/projects/${projectId}/requirements/${analysis.requirement_id}`}
                          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                        >
                          REQ-{analysis.requirement_seq ?? analysis.requirement_id}
                          {analysis.requirement_title ? ` · ${analysis.requirement_title}` : ''}
                        </Link>
                      )}
                      {analysis.test_case_id && (
                        <Link
                          to={`/projects/${projectId}/test-cases/${analysis.test_case_id}`}
                          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                        >
                          TC-{analysis.test_case_seq ?? analysis.test_case_id}
                          {analysis.test_case_title ? ` · ${analysis.test_case_title}` : ''}
                        </Link>
                      )}
                      {analysis.fix_commit_hash && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 font-mono text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          {analysis.fix_commit_hash}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RootCauseAnalysisModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => reload()}
        editing={editing}
        projectId={projectId}
        formData={formData}
        formDataLoading={formDataLoading}
      />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'blue' | 'rose' | 'emerald' | 'orange';
}) {
  const tones: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-300',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300',
    orange: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300',
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>
        <div>
          <p className="text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-1 text-xs text-gray-500">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
