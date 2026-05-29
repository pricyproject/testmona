import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { AlertCircle, BarChart3, Share2 } from 'lucide-react';
import { useReportsData } from '@/hooks/useReportsData';
import { SectionNav } from '@/components/reports/SectionNav';
import { OverviewSection } from '@/components/reports/OverviewSection';
import { CoverageRiskSection } from '@/components/reports/CoverageRiskSection';
import { ActivitySection } from '@/components/reports/ActivitySection';
import { ShareExportFlow } from '@/components/reports/ShareExportFlow';

export function Reports() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const ctx = useReportsData(projectId);
  const [shareOpen, setShareOpen] = useState(false);

  const { activeSection, error, sectionLoading, handleGenerateAnalytics } = ctx;
  const isLoading = sectionLoading(activeSection);

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

      {/* Product-level sections instead of exposing every backing report as a tab. */}
      <SectionNav ctx={ctx} />

      {/* Surface load failures instead of leaving the page silently empty */}
      {error && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {activeSection === 'overview' && <OverviewSection ctx={ctx} />}
      {activeSection === 'coverage-risk' && <CoverageRiskSection ctx={ctx} />}
      {activeSection === 'activity' && <ActivitySection ctx={ctx} />}

      <ShareExportFlow ctx={ctx} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}
