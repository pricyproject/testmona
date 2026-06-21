import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowUpRight, BarChart3, Share2 } from 'lucide-react';
import { ReportsData, useReportsData } from '@/hooks/useReportsData';
import { SectionNav } from '@/components/reports/SectionNav';
import { ShareExportFlow } from '@/components/reports/ShareExportFlow';
import { sectionFromPath } from '@/components/reports/reportsUtils';
import { milestonesAPI, testPlansAPI } from '@/lib/api';

type ScopedReportEntity = {
  type: 'test-plan' | 'milestone';
  id: number;
  name: string;
  href: string;
};

const parsePositiveId = (value: string | null): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Shared shell for the reports area. Owns the single `useReportsData` instance and
 * the chrome common to every section (header actions, scope banner, section nav,
 * error surface, share/export dialog), then renders the active section page through
 * an <Outlet>. Each section is its own route/page and reads the shared data context
 * via `useReportsContext()`, so the shell — and its in-flight data and open dialogs —
 * persists across tab switches while only the section page swaps.
 */
export function ReportsLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();
  const ctx = useReportsData(projectId);
  const [shareOpen, setShareOpen] = useState(false);
  const [scopedEntity, setScopedEntity] = useState<ScopedReportEntity | null>(null);

  const { activeSection, setActiveSection, error, sectionLoading, handleGenerateAnalytics } = ctx;

  // The URL is the source of truth for the active section. Each section has its
  // own route, so derive the active section from the current path and sync it into
  // the data hook (which drives section-scoped loading).
  useEffect(() => {
    const next = sectionFromPath(location.pathname);
    if (next !== activeSection) setActiveSection(next);
  }, [location.pathname, activeSection, setActiveSection]);

  const isLoading = sectionLoading(activeSection);
  const numericProjectId = parsePositiveId(projectId || null);
  const testPlanId = parsePositiveId(searchParams.get('test_plan_id'));
  const milestoneId = parsePositiveId(searchParams.get('milestone_id'));
  const scope = useMemo(() => {
    if (testPlanId) return { type: 'test-plan' as const, id: testPlanId };
    if (milestoneId) return { type: 'milestone' as const, id: milestoneId };
    return null;
  }, [testPlanId, milestoneId]);

  useEffect(() => {
    let cancelled = false;
    setScopedEntity(null);
    if (!scope || !numericProjectId) return;

    const loadScope = async () => {
      try {
        const entity = scope.type === 'test-plan'
          ? await testPlansAPI.getById(scope.id)
          : await milestonesAPI.getById(scope.id);
        if (cancelled || entity?.project_id !== numericProjectId) return;
        setScopedEntity({
          type: scope.type,
          id: scope.id,
          name: entity.title || entity.name || `#${scope.id}`,
          href: scope.type === 'test-plan'
            ? `/projects/${numericProjectId}/test-plans/${scope.id}`
            : `/projects/${numericProjectId}/milestones/${scope.id}`,
        });
      } catch {
        if (!cancelled) setScopedEntity(null);
      }
    };

    void loadScope();
    return () => {
      cancelled = true;
    };
  }, [numericProjectId, scope]);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('reportsPageTitle')}</h1>
          <p className="text-gray-600">{t('reportsPageSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4 mr-2" />
            {t('reports_shareExportTitle')}
          </Button>
          <Button onClick={handleGenerateAnalytics}>
            <BarChart3 className="h-4 w-4 mr-2" />
            {t('reportsGenerateAnalytics')}
          </Button>
        </div>
      </div>

      {scopedEntity && (
        <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('reportsScopedToEntity', { name: scopedEntity.name })}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate(scopedEntity.href)} className="shrink-0 gap-1">
            {t('viewScopedReport')}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Product-level sections instead of exposing every backing report as a tab. */}
      <SectionNav ctx={ctx} />

      {/* Surface load failures instead of leaving the page silently empty */}
      {error && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Active section page renders here and reads `ctx` via useReportsContext(). */}
      <Outlet context={ctx} />

      <ShareExportFlow ctx={ctx} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}

// Section pages read the shared reports data context provided by the layout's <Outlet>.
export const useReportsContext = () => useOutletContext<ReportsData>();
