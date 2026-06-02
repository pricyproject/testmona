import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, AlertTriangle, Layers } from 'lucide-react';
import { useExecution } from './ExecutionContext';
import type { ExecutionStatus } from './statusConfig';

const ITERATION_PILL: Record<string, string> = {
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50',
  failed: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50',
  blocked: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50',
  pending: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
};

export function IterationsPanel() {
  const {
    t, dataset, activeIteration, setActiveIteration, iterationStatuses, setIterationStatuses,
    activeRow, testCase, testSteps, substitute, canWrite,
  } = useExecution();

  if (!dataset) return null;
  const passedCount = dataset.rows.filter((_, i) => iterationStatuses[i] === 'passed').length;
  const current = iterationStatuses[activeIteration] || 'pending';

  const setOutcome = (status: ExecutionStatus) =>
    setIterationStatuses((prev) => ({ ...prev, [activeIteration]: status }));

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-slate-400" />
          {t('dataDrivenIterations')}
          <Badge variant="outline" className="text-[10px]">{dataset.name}</Badge>
          <span className="ml-auto text-xs font-normal text-slate-400">
            {t('iterationsPassedSummary', { passed: String(passedCount), total: String(dataset.rows.length) })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap gap-1.5">
          {dataset.rows.map((_, i) => {
            const st = iterationStatuses[i] || 'pending';
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveIteration(i)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-shadow ${ITERATION_PILL[st]} ${
                  activeIteration === i ? 'ring-2 ring-indigo-400 ring-offset-1 dark:ring-offset-slate-900' : ''
                }`}
              >
                {t('iterationLabel', { n: String(i + 1) })}
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/60">
                {dataset.parameters.map((p) => (
                  <th key={p} className="px-2.5 py-1.5 text-left font-mono font-medium text-slate-500 dark:text-slate-400">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {dataset.parameters.map((p) => (
                  <td key={p} className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300">{activeRow?.[p] ?? ''}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-slate-400">{t('iterationPreviewHint')}</p>

        {testCase?.preconditions && (
          <div>
            <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('preconditions')}</Label>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
              {substitute(testCase.preconditions)}
            </p>
          </div>
        )}

        {testSteps.length > 0 ? (
          <div className="space-y-2">
            {testSteps.map((step) => (
              <div key={step.step_number} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {step.step_number}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300"><span className="font-medium">{t('action')}:</span> {substitute(step.action)}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300"><span className="font-medium">{t('expectedResult')}:</span> {substitute(step.expected_result)}</p>
              </div>
            ))}
          </div>
        ) : testCase?.steps ? (
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-sans text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">{substitute(testCase.steps)}</pre>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="text-xs text-slate-400">{t('iterationOutcome')}:</span>
          <Button
            size="sm" variant={current === 'passed' ? 'default' : 'outline'} disabled={!canWrite}
            className={current === 'passed' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            onClick={() => setOutcome('passed')}
          >
            <CheckCircle className="mr-1 h-3 w-3" /> {t('passed')}
          </Button>
          <Button
            size="sm" variant={current === 'failed' ? 'default' : 'outline'} disabled={!canWrite}
            className={current === 'failed' ? 'bg-red-600 hover:bg-red-700' : ''}
            onClick={() => setOutcome('failed')}
          >
            <XCircle className="mr-1 h-3 w-3" /> {t('failed')}
          </Button>
          <Button
            size="sm" variant={current === 'blocked' ? 'default' : 'outline'} disabled={!canWrite}
            className={current === 'blocked' ? 'bg-amber-600 hover:bg-amber-700' : ''}
            onClick={() => setOutcome('blocked')}
          >
            <AlertTriangle className="mr-1 h-3 w-3" /> {t('blocked')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
