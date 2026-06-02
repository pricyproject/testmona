import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTestCaseExecution } from '@/hooks/useTestCaseExecution';
import { ExecutionProvider } from '@/components/TestCases/execution/ExecutionContext';
import { ExecutionHeader } from '@/components/TestCases/execution/ExecutionHeader';
import { TestCaseDetailsCard } from '@/components/TestCases/execution/TestCaseDetailsCard';
import { IterationsPanel } from '@/components/TestCases/execution/IterationsPanel';
import { ExecutionForm } from '@/components/TestCases/execution/ExecutionForm';
import { LinkedDefectsCard } from '@/components/TestCases/execution/LinkedDefectsCard';
import { ResultSummaryCard } from '@/components/TestCases/execution/ResultSummaryCard';
import { ExecutionHistoryCard } from '@/components/TestCases/execution/ExecutionHistoryCard';
import { ExecutionActionBar } from '@/components/TestCases/execution/ExecutionActionBar';
import { ExecutionDialogs } from '@/components/TestCases/execution/ExecutionDialogs';

export function TestCaseExecution() {
  const controller = useTestCaseExecution();
  const { t, isRTL, isLoading, loadError, testCase, hasIterations, backToTestRuns } = controller;

  if (loadError) {
    return (
      <div className="space-y-4 py-12 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
        <h2 className="text-2xl font-bold">{loadError}</h2>
        <Button variant="outline" onClick={backToTestRuns}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('backToTestRuns')}
        </Button>
      </div>
    );
  }

  if (isLoading && !testCase) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">{t('loading')}</p>
      </div>
    );
  }

  return (
    <ExecutionProvider value={controller}>
      <div className="space-y-5">
        <ExecutionHeader />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <TestCaseDetailsCard />
            {hasIterations && <IterationsPanel />}
            <ExecutionForm />
            <LinkedDefectsCard />
          </div>

          <div className="space-y-4 lg:sticky lg:top-4">
            <ResultSummaryCard />
            <ExecutionHistoryCard />
          </div>
        </div>

        <ExecutionActionBar />
      </div>

      <ExecutionDialogs />
    </ExecutionProvider>
  );
}
