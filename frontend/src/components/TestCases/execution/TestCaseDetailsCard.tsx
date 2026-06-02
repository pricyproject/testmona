import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { FileText, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useExecution } from './ExecutionContext';
import { getPriorityBadgeClass } from './statusConfig';
import type { TestStep } from './types';
import type { ExecutionStatus } from './statusConfig';

const STEP_OUTCOMES: { value: Exclude<ExecutionStatus, 'pending'>; icon: typeof CheckCircle; on: string; off: string; title: string }[] = [
  { value: 'passed', icon: CheckCircle, on: 'bg-emerald-500 text-white border-emerald-500', off: 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30', title: 'passed' },
  { value: 'failed', icon: XCircle, on: 'bg-red-500 text-white border-red-500', off: 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30', title: 'failed' },
  { value: 'blocked', icon: AlertTriangle, on: 'bg-amber-500 text-white border-amber-500', off: 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30', title: 'blocked' },
];

function StepRow({ step, controllable }: { step: TestStep; controllable: boolean }) {
  const { t, resolveGlobals, stepStatuses, setStepStatus, canWrite } = useExecution();
  const current = stepStatuses[step.step_number] || 'pending';

  const accent = current === 'passed' ? 'border-emerald-300 dark:border-emerald-900/60'
    : current === 'failed' ? 'border-red-300 dark:border-red-900/60'
    : current === 'blocked' ? 'border-amber-300 dark:border-amber-900/60'
    : 'border-slate-200 dark:border-slate-800';

  return (
    <div className={`rounded-lg border bg-slate-50 p-3 dark:bg-slate-900/50 ${accent}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {step.step_number}
          </span>
          {step.step_type && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">{step.step_type}</Badge>
          )}
        </div>
        {controllable && (
          <div className="flex items-center gap-1">
            {STEP_OUTCOMES.map((o) => {
              const Icon = o.icon;
              const active = current === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => setStepStatus(step.step_number, o.value)}
                  aria-pressed={active}
                  title={t(o.title)}
                  className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:opacity-40 ${
                    active ? o.on : `border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${o.off}`
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <dl className="space-y-1.5 text-xs">
        <div>
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('action')}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{resolveGlobals(step.action)}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500 dark:text-slate-400">{t('expectedResult')}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{resolveGlobals(step.expected_result)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function TestCaseDetailsCard() {
  const { t, testCase, testSteps, globalParams, resolveGlobals, hasIterations, stepStatuses } = useExecution();

  // Per-step outcomes only apply to multistep cases that aren't data-driven
  // (iterations record their own per-row outcomes instead).
  const stepControls = !!testCase?.is_multistep && testSteps.length > 0 && !hasIterations;
  const passedSteps = testSteps.filter((s) => stepStatuses[s.step_number] === 'passed').length;

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-slate-400" />
          {t('testCaseDetails')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!testCase ? (
          <div className="py-8 text-center text-sm text-slate-400">{t('loading')}</div>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{testCase.title}</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {testCase.description || t('noDescriptionProvided')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('priority')}</Label>
                <div className="mt-1">
                  <Badge className={`text-xs ${getPriorityBadgeClass(testCase.priority)}`}>
                    {(testCase.priority || 'medium').toUpperCase()}
                  </Badge>
                </div>
              </div>
              <div>
                <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('status')}</Label>
                <div className="mt-1">
                  <Badge variant="outline" className="text-xs capitalize">{testCase.status || 'active'}</Badge>
                </div>
              </div>
            </div>

            {globalParams.length > 0 && (
              <p className="text-[11px] text-slate-400">{t('globalParamsResolvedHint')}</p>
            )}

            {testCase.preconditions && (
              <div>
                <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('preconditions')}</Label>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                  {resolveGlobals(testCase.preconditions)}
                </p>
              </div>
            )}

            {testCase.is_multistep ? (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('testSteps')}</Label>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t('multistep')}</Badge>
                  {stepControls && (
                    <span className="ml-auto text-[11px] font-normal text-slate-400">
                      {t('stepsPassedSummary', { passed: String(passedSteps), total: String(testSteps.length) })}
                    </span>
                  )}
                </div>
                {testSteps.length > 0 ? (
                  <div className="space-y-2">
                    {testSteps.map((step) => (
                      <StepRow key={step.step_number} step={step} controllable={stepControls} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-400 dark:bg-slate-900/50">{t('noMultistepData')}</p>
                )}
              </div>
            ) : testCase.steps ? (
              <div>
                <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('testSteps')}</Label>
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-sans text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                  {resolveGlobals(testCase.steps)}
                </pre>
              </div>
            ) : null}

            {!testCase.is_multistep && testCase.expected_result && (
              <div>
                <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('expectedResult')}</Label>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5 text-xs text-slate-600 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-slate-300">
                  {resolveGlobals(testCase.expected_result)}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
