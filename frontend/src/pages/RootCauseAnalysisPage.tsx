import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { RootCauseAnalysisPanel } from '@/components/reports/RootCauseAnalysisPanel';

export function RootCauseAnalysisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  const numericProjectId = projectId ? parseInt(projectId, 10) : NaN;

  if (!Number.isFinite(numericProjectId)) return null;

  return (
    <div className="space-y-6 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link
        to={`/projects/${numericProjectId}/defects`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ChevronLeft className={isRTL ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} />
        {t('defects')}
      </Link>
      <RootCauseAnalysisPanel projectId={numericProjectId} />
    </div>
  );
}
