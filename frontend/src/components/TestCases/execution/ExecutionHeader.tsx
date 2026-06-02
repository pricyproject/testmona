import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Edit, Link as LinkIcon, FileText,
} from 'lucide-react';
import { useExecution } from './ExecutionContext';
import { getStatusBadgeClass, getStatusOption } from './statusConfig';

export function ExecutionHeader() {
  const {
    t, isRTL, testCase, testRun, testCaseId,
    executionStatus, allTestCases, currentIndex,
    hasNext, hasPrevious,
    handleNextTestCase, handlePreviousTestCase, handleEditTestCase,
    openTestCase, backToTestRun,
  } = useExecution();

  const statusOption = getStatusOption(executionStatus);
  const testRunName = testRun?.name || t('loading');
  const testCaseTitle = testCase?.title || t('loading');
  const progressLabel = allTestCases.length > 0 && currentIndex >= 0
    ? t('testCaseProgress', { current: currentIndex + 1, total: allTestCases.length })
    : t('loadingTestCases');

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-linear-to-br from-white via-cyan-50 to-slate-100 p-5 text-slate-950 shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 dark:text-white dark:shadow-black/30 sm:p-6">
      <div className="pointer-events-none absolute -top-24 h-56 w-56 rounded-full bg-cyan-300/40 blur-3xl dark:bg-cyan-400/20 ltr:right-10 rtl:left-10" />
      <div className="pointer-events-none absolute -bottom-24 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-300/10 ltr:left-10 rtl:right-10" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={backToTestRun}
            className="-ml-2 h-8 w-fit px-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
            {t('backToTestRun')}
          </Button>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <FileText className="h-3 w-3" />
                {t('testCaseExecution')}
              </Badge>
              <Badge className={`border text-xs font-medium ${getStatusBadgeClass(executionStatus)}`}>
                {statusOption ? t(statusOption.labelKey) : executionStatus}
              </Badge>
              <Badge variant="secondary" className="text-xs font-medium">{progressLabel}</Badge>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={openTestCase}
                className="group inline-flex max-w-full items-center gap-2 text-left text-2xl font-bold leading-tight tracking-tight text-slate-900 hover:text-indigo-600 dark:text-slate-50 dark:hover:text-indigo-400 sm:text-3xl"
                title={testCaseTitle}
              >
                <span className="truncate">{testCaseTitle}</span>
                <LinkIcon className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-600 dark:text-slate-300">{t('testRunLabel')}:</span>
                <button
                  type="button"
                  onClick={backToTestRun}
                  className="inline-flex max-w-full items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  title={testRunName}
                >
                  <span className="truncate">{testRunName}</span>
                </button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">TC-{testCaseId}</span>
              </div>
            </div>

            {allTestCases.length > 0 && (
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {allTestCases.map((_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      index === currentIndex
                        ? 'w-6 bg-indigo-500'
                        : index < currentIndex
                        ? 'w-1.5 bg-emerald-500'
                        : 'w-1.5 bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid w-full shrink-0 gap-2 sm:grid-cols-3 xl:w-auto">
          <Button variant="outline" size="sm" onClick={handlePreviousTestCase} disabled={!hasPrevious} className="h-9 justify-center" title="Alt + ←">
            <ChevronLeft className={`h-4 w-4 ${isRTL ? 'ml-1.5 rotate-180' : 'mr-1.5'}`} />
            {t('previous')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleNextTestCase} disabled={!hasNext} className="h-9 justify-center" title="Alt + →">
            {t('next')}
            <ChevronRight className={`h-4 w-4 ${isRTL ? 'mr-1.5 rotate-180' : 'ml-1.5'}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={handleEditTestCase} className="h-9 justify-center">
            <Edit className={`h-4 w-4 ${isRTL ? 'ml-1.5' : 'mr-1.5'}`} />
            {t('edit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
