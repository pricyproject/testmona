import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Bug,
  ClipboardList,
  FileText,
  Link2,
  ListChecks,
  Loader2,
  Play,
  Plus,
  Unlink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { docsAPI, getApiErrorMessage, requirementsAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { entityKey, entitySeq } from '@/lib/utils';
import type {
  DocListItem,
  RequirementLinkedTestCase,
  RequirementLinkedTestPlan,
  RequirementRelationshipSummary,
} from '@/types';

interface Requirement360PanelProps {
  projectId: number;
  requirementId: number;
  relationships: RequirementRelationshipSummary | null;
  linkedTestCases: RequirementLinkedTestCase[];
  linkedTestCasesTotal: number;
  canWrite: boolean;
  loading?: boolean;
  error?: string | null;
  onChanged: () => void;
  onViewLinkedTestCases: () => void;
}

type RelationItem = Record<string, any>;

const RELATION_ITEM_LIMIT = 8;

const humanize = (value?: string | null): string =>
  (value || '').replace(/[_-]+/g, ' ').trim();

const formatCoverage = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : undefined;
};

function statusTone(status?: string | null): string {
  const key = (status || '').toLowerCase();
  if (['passed', 'pass', 'approved', 'completed', 'done'].includes(key)) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  }
  if (['failed', 'fail', 'critical', 'rejected'].includes(key)) {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300';
  }
  if (['blocked', 'high', 'at_risk'].includes(key)) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function RelationCard({
  title,
  icon,
  count,
  children,
  action,
  emptyLabel,
  before,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
  action?: ReactNode;
  emptyLabel: string;
  before?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <span className="text-slate-400">{icon}</span>
          <span className="truncate">{title}</span>
          <Badge variant="secondary">{count}</Badge>
        </h3>
        {action}
      </div>
      {before}
      {count === 0 ? (
        <p className="rounded border border-dashed border-slate-300 px-2 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

function RelationLink({
  to,
  label,
  meta,
  status,
  onUnlink,
  unlinking,
  unlinkTitle,
  extra,
}: {
  to: string;
  label: ReactNode;
  meta?: ReactNode;
  status?: string | null;
  onUnlink?: () => void;
  unlinking?: boolean;
  unlinkTitle?: string;
  extra?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 rounded border border-transparent px-1 py-1 hover:border-slate-200 hover:bg-white dark:hover:border-slate-700 dark:hover:bg-slate-900">
      <Link to={to} className="flex min-w-0 flex-1 flex-col gap-0.5" dir="auto">
        <span className="truncate text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">{label}</span>
        {meta && <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{meta}</span>}
      </Link>
      {status && <Badge className={`shrink-0 capitalize ${statusTone(status)}`}>{humanize(status)}</Badge>}
      {extra}
      {onUnlink && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-slate-400 hover:text-rose-600"
          onClick={onUnlink}
          disabled={unlinking}
          title={unlinkTitle}
          aria-label={unlinkTitle}
        >
          {unlinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
        </Button>
      )}
    </li>
  );
}

export function Requirement360Panel({
  projectId,
  requirementId,
  relationships,
  linkedTestCases,
  linkedTestCasesTotal,
  canWrite,
  loading = false,
  error = null,
  onChanged,
  onViewLinkedTestCases,
}: Requirement360PanelProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planSearch, setPlanSearch] = useState('');
  const [availablePlans, setAvailablePlans] = useState<RequirementLinkedTestPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [selectedPlanIds, setSelectedPlanIds] = useState<number[]>([]);
  const [linkingPlans, setLinkingPlans] = useState(false);
  const [unlinkingPlanId, setUnlinkingPlanId] = useState<number | null>(null);

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [projectDocs, setProjectDocs] = useState<DocListItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [linkingDocs, setLinkingDocs] = useState(false);
  const [unlinkingDocId, setUnlinkingDocId] = useState<number | null>(null);

  const defects = relationships?.defects.items ?? [];
  const plans = relationships?.test_plans.items ?? [];
  const runs = relationships?.test_runs.items ?? [];
  const coverage = relationships?.coverage_reports.items ?? [];
  const docs = relationships?.docs?.items ?? [];

  const linkedDocIds = useMemo(() => new Set(docs.map((doc) => Number(doc.id))), [docs]);

  useEffect(() => {
    if (!planDialogOpen) return;
    let active = true;
    setPlansLoading(true);
    setPlansError('');
    const timer = window.setTimeout(() => {
      requirementsAPI
        .searchTestPlans(requirementId, {
          linked: false,
          search: planSearch.trim() || undefined,
          limit: 100,
        })
        .then((data) => {
          if (!active) return;
          setAvailablePlans(Array.isArray(data?.items) ? data.items : []);
          setPlansLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setAvailablePlans([]);
          setPlansError(getApiErrorMessage(err, t('failedToLoadRequirementTestPlans')));
          setPlansLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [planDialogOpen, planSearch, requirementId, t]);

  useEffect(() => {
    if (!docDialogOpen) return;
    let active = true;
    setDocsLoading(true);
    setDocsError('');
    docsAPI
      .list({ projectId, limit: 200, includeGlobal: false, sort: 'latest_edited' })
      .then((items) => {
        if (!active) return;
        setProjectDocs(Array.isArray(items) ? items : []);
        setDocsLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setProjectDocs([]);
        setDocsError(getApiErrorMessage(err, t('failedToLoadRequirementDocs')));
        setDocsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [docDialogOpen, projectId, t]);

  const availableDocs = useMemo(() => {
    const term = docSearch.trim().toLowerCase();
    return projectDocs.filter((doc) => {
      if (linkedDocIds.has(doc.id)) return false;
      return !term || doc.title.toLowerCase().includes(term);
    });
  }, [projectDocs, linkedDocIds, docSearch]);

  const togglePlan = (id: number, checked: boolean) => {
    setSelectedPlanIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  };

  const toggleDoc = (id: number, checked: boolean) => {
    setSelectedDocIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  };

  const handleLinkPlans = async () => {
    if (!selectedPlanIds.length) return;
    setLinkingPlans(true);
    try {
      const result = await requirementsAPI.bulkUpdateTestPlans(requirementId, {
        test_plan_ids: selectedPlanIds,
        action: 'link',
      });
      const linkedCount = Number(result?.linked_count ?? selectedPlanIds.length);
      toast({
        title: t('success'),
        description: t('testPlansLinkedToRequirement', { count: linkedCount }),
      });
      setPlanDialogOpen(false);
      setSelectedPlanIds([]);
      setPlanSearch('');
      onChanged();
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateRequirementScope')),
        variant: 'destructive',
      });
    } finally {
      setLinkingPlans(false);
    }
  };

  const handleUnlinkPlan = async (plan: RelationItem) => {
    const planId = Number(plan.id);
    setUnlinkingPlanId(planId);
    try {
      const result = await requirementsAPI.bulkUpdateTestPlans(requirementId, {
        test_plan_ids: [planId],
        action: 'unlink',
      });
      const unlinkedCount = Number(result?.unlinked_count ?? 1);
      if (unlinkedCount > 0) {
        toast({ title: t('success'), description: t('testPlansUnlinkedFromRequirement', { count: unlinkedCount }) });
      }
      onChanged();
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateRequirementScope')),
        variant: 'destructive',
      });
    } finally {
      setUnlinkingPlanId(null);
    }
  };

  const handleLinkDocs = async () => {
    if (!selectedDocIds.length) return;
    setLinkingDocs(true);
    try {
      const results = await Promise.allSettled(
        selectedDocIds.map((docId) => docsAPI.addRequirementLink(docId, requirementId)),
      );
      const linkedCount = results.filter((result) => result.status === 'fulfilled').length;
      const firstFailure = results.find((result) => result.status === 'rejected');
      if (linkedCount > 0) {
        toast({
          title: t('success'),
          description: t('docsLinkedToRequirement', { count: linkedCount }),
        });
        onChanged();
      }
      if (firstFailure && firstFailure.status === 'rejected') {
        toast({
          title: t('error'),
          description: getApiErrorMessage(firstFailure.reason, t('failedToLinkRequirement')),
          variant: 'destructive',
        });
      }
      if (linkedCount > 0) {
        setDocDialogOpen(false);
        setSelectedDocIds([]);
        setDocSearch('');
      }
    } finally {
      setLinkingDocs(false);
    }
  };

  const handleUnlinkDoc = async (doc: RelationItem) => {
    const docId = Number(doc.id);
    setUnlinkingDocId(docId);
    try {
      await docsAPI.removeRequirementLink(docId, requirementId);
      toast({ title: t('success'), description: t('docRequirementUnlinked') });
      onChanged();
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUnlinkRequirement')),
        variant: 'destructive',
      });
    } finally {
      setUnlinkingDocId(null);
    }
  };

  const showAllLinkedTestCases = () => {
    onViewLinkedTestCases();
    window.setTimeout(() => {
      document.getElementById('linked-test-cases')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const linkButton = (label: string, onClick: () => void) => (
    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      <Plus className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
      {label}
    </Button>
  );

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
            <Link2 className="h-4 w-4 text-slate-400" />
            {t('requirement360')}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('requirement360Desc')}</p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <RelationCard
          title={t('linkedTestCases')}
          icon={<ListChecks className="h-4 w-4" />}
          count={linkedTestCasesTotal}
          emptyLabel={t('noLinkedTestCasesForRequirement')}
          before={
            <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {t('activeCount')}: {relationships?.test_cases.active_count ?? 0}
              </span>
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {t('failedResults')}: {relationships?.test_cases.failed_related_runs ?? 0}
              </span>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {t('blockedResults')}: {relationships?.test_cases.blocked_related_runs ?? 0}
              </span>
            </div>
          }
          action={
            <button
              type="button"
              onClick={showAllLinkedTestCases}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
            >
              {t('viewAll')}
            </button>
          }
        >
          {linkedTestCases.slice(0, RELATION_ITEM_LIMIT).map((testCase) => (
            <RelationLink
              key={testCase.id}
              to={`/projects/${projectId}/test-cases/${entitySeq(testCase)}`}
              label={`${entityKey('TC', testCase)} · ${testCase.title}`}
              status={testCase.latest_run_status || testCase.status}
            />
          ))}
        </RelationCard>

        <RelationCard
          title={t('relatedTestPlans')}
          icon={<ClipboardList className="h-4 w-4" />}
          count={relationships?.test_plans.total ?? 0}
          emptyLabel={t('noRelatedTestPlans')}
          action={canWrite ? linkButton(t('linkTestPlan'), () => setPlanDialogOpen(true)) : undefined}
        >
          {plans.slice(0, RELATION_ITEM_LIMIT).map((plan) => (
            <RelationLink
              key={plan.id}
              to={`/projects/${projectId}/test-plans/${plan.project_seq ?? plan.id}`}
              label={plan.title}
              meta={plan.milestone_title ? humanize(plan.milestone_title) : undefined}
              status={plan.status}
              onUnlink={canWrite ? () => handleUnlinkPlan(plan) : undefined}
              unlinking={unlinkingPlanId === Number(plan.id)}
              unlinkTitle={t('unlink')}
            />
          ))}
        </RelationCard>

        <RelationCard
          title={t('relatedTestRuns')}
          icon={<Play className="h-4 w-4" />}
          count={relationships?.test_runs.total ?? 0}
          emptyLabel={t('noRelatedTestRuns')}
        >
          {runs.slice(0, RELATION_ITEM_LIMIT).map((run) => (
            <RelationLink
              key={run.id}
              to={`/projects/${projectId}/test-runs/${run.project_seq ?? run.id}`}
              label={run.name || `#${run.id}`}
              status={run.status}
            />
          ))}
        </RelationCard>

        <RelationCard
          title={t('relatedDefects')}
          icon={<Bug className="h-4 w-4" />}
          count={relationships?.defects.total ?? 0}
          emptyLabel={t('noRelatedDefects')}
        >
          {defects.slice(0, RELATION_ITEM_LIMIT).map((defect) => (
            <RelationLink
              key={defect.id}
              to={`/projects/${projectId}/defects/${defect.project_seq ?? defect.id}`}
              label={defect.defect_id ? `${defect.defect_id} · ${defect.title}` : defect.title}
              meta={defect.severity ? humanize(defect.severity) : undefined}
              status={defect.status}
            />
          ))}
        </RelationCard>

        <RelationCard
          title={t('relatedDocs')}
          icon={<FileText className="h-4 w-4" />}
          count={relationships?.docs?.total ?? 0}
          emptyLabel={t('noRelatedDocs')}
          action={canWrite ? linkButton(t('linkDoc'), () => setDocDialogOpen(true)) : undefined}
        >
          {docs.slice(0, RELATION_ITEM_LIMIT).map((doc) => (
            <RelationLink
              key={doc.id}
              to={`/projects/${projectId}/docs/${doc.project_seq ?? doc.id}`}
              label={doc.title}
              meta={doc.classification ? humanize(doc.classification) : undefined}
              status={doc.status}
              onUnlink={canWrite ? () => handleUnlinkDoc(doc) : undefined}
              unlinking={unlinkingDocId === Number(doc.id)}
              unlinkTitle={t('docUnlinkRequirement')}
            />
          ))}
        </RelationCard>

        <RelationCard
          title={t('coverageReports')}
          icon={<BarChart3 className="h-4 w-4" />}
          count={relationships?.coverage_reports.total ?? 0}
          emptyLabel={t('noRelatedCoverageReports')}
          action={
            <Link
              to={`/projects/${projectId}/reports/coverage-risk`}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
            >
              {t('viewAll')}
            </Link>
          }
        >
          {coverage.slice(0, RELATION_ITEM_LIMIT).map((report) => (
            <RelationLink
              key={report.id}
              to={`/projects/${projectId}/reports/coverage-risk`}
              label={humanize(report.report_type) || `#${report.id}`}
              meta={formatCoverage(report.coverage_percentage)}
            />
          ))}
        </RelationCard>
      </div>

      <Dialog
        open={planDialogOpen}
        onOpenChange={(open) => {
          setPlanDialogOpen(open);
          if (!open) {
            setSelectedPlanIds([]);
            setPlanSearch('');
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('linkTestPlan')}</DialogTitle>
            <DialogDescription>{t('requirementScopeDesc')}</DialogDescription>
          </DialogHeader>
          <Input
            value={planSearch}
            onChange={(event) => setPlanSearch(event.target.value)}
            placeholder={t('searchTestPlansToScope')}
          />
          <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
            {plansLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : plansError ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                {plansError}
              </p>
            ) : availablePlans.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('noTestPlansMatchSearch')}
              </p>
            ) : (
              availablePlans.map((plan) => (
                <label
                  key={plan.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950/50"
                >
                  <Checkbox
                    checked={selectedPlanIds.includes(plan.id)}
                    onCheckedChange={(checked) => togglePlan(plan.id, checked === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" dir="auto">{plan.title}</span>
                    {plan.milestone_title && (
                      <span className="block truncate text-xs text-slate-500">{plan.milestone_title}</span>
                    )}
                  </span>
                  {plan.status && <Badge className={`capitalize ${statusTone(plan.status)}`}>{humanize(plan.status)}</Badge>}
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPlanDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={handleLinkPlans} disabled={linkingPlans || selectedPlanIds.length === 0}>
              {linkingPlans && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('linkSelectedTestPlans', { count: selectedPlanIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={docDialogOpen}
        onOpenChange={(open) => {
          setDocDialogOpen(open);
          if (!open) {
            setSelectedDocIds([]);
            setDocSearch('');
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('linkDoc')}</DialogTitle>
            <DialogDescription>{t('docLinkedRequirementsHint')}</DialogDescription>
          </DialogHeader>
          <Input
            value={docSearch}
            onChange={(event) => setDocSearch(event.target.value)}
            placeholder={t('docSearchPlaceholder')}
          />
          <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
            {docsLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : docsError ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                {docsError}
              </p>
            ) : availableDocs.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('noDocsAvailableToLink')}
              </p>
            ) : (
              availableDocs.map((doc) => (
                <label
                  key={doc.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950/50"
                >
                  <Checkbox
                    checked={selectedDocIds.includes(doc.id)}
                    onCheckedChange={(checked) => toggleDoc(doc.id, checked === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" dir="auto">{doc.title}</span>
                    {doc.excerpt && (
                      <span className="block truncate text-xs text-slate-500">{doc.excerpt}</span>
                    )}
                  </span>
                  <Badge className={`capitalize ${statusTone(doc.status)}`}>{humanize(doc.status)}</Badge>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDocDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={handleLinkDocs} disabled={linkingDocs || selectedDocIds.length === 0}>
              {linkingDocs && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('linkSelectedDocs', { count: selectedDocIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
