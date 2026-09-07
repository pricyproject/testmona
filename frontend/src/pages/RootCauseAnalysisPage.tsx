import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { RootCauseAnalysisPanel } from '@/components/reports/RootCauseAnalysisPanel';

export function RootCauseAnalysisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, isRTL } = useTranslation();
  // `parseInt('12abc')` is 12, which would then request a project the URL never
  // named, so only an all-digits segment counts.
  const numericProjectId = projectId && /^\d+$/.test(projectId) ? parseInt(projectId, 10) : NaN;
  const projectIdValid = Number.isInteger(numericProjectId) && numericProjectId > 0;

  if (!projectIdValid) {
    // Previously this rendered nothing at all, leaving a blank page.
    return (
      <div className="space-y-6 px-4 py-6 lg:px-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="mb-4 h-10 w-10 text-amber-500" />
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">{t('projectNotFound')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 py-6 lg:px-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link
        to={`/projects/${numericProjectId}/defects`}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-gray-300"
      >
        <ChevronLeft className={isRTL ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} />
        {t('defects')}
      </Link>
      <RootCauseAnalysisPanel projectId={numericProjectId} />
    </div>
  );
}
