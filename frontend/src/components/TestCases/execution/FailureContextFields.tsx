import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ShieldAlert, Ban, Link2 } from 'lucide-react';
import { useExecution } from './ExecutionContext';

const urlInputProps = {
  type: 'url' as const,
  inputMode: 'url' as const,
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
};

// Stable machine values persisted on the result (test_results.blocker_reason),
// paired with their display label key. Keep the values in sync with the backend
// analytics buckets in _analytics_shared.py.
const BLOCKER_REASONS: { value: string; labelKey: string }[] = [
  { value: 'environment', labelKey: 'blockerReasonEnvironment' },
  { value: 'test_data', labelKey: 'blockerReasonTestData' },
  { value: 'dependency', labelKey: 'blockerReasonDependency' },
  { value: 'access', labelKey: 'blockerReasonAccess' },
  { value: 'awaiting_fix', labelKey: 'blockerReasonAwaitingFix' },
  { value: 'other', labelKey: 'blockerReasonOther' },
];

/**
 * Blocked is an impediment, not a failure: the software didn't misbehave, the
 * test just couldn't be run to completion. So we give it its own amber surface
 * and blocker-oriented copy instead of the red failure panel — different mental
 * model, different follow-up (unblock vs. file a bug).
 */
function BlockerContext() {
  const {
    t, testSteps,
    selectedFailureStepNumber, setSelectedFailureStepNumber,
    defectLink, setDefectLink, customLink, setCustomLink,
    executionNotes, setExecutionNotes,
    blockerReason, setBlockerReason, canWrite,
  } = useExecution();
  const readOnlyInput = { readOnly: !canWrite, tabIndex: canWrite ? undefined : -1 };

  const fieldClass = 'mt-1 h-9 border-amber-200 bg-white text-sm dark:border-amber-900/60 dark:bg-slate-950/40';

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <Ban className="h-4 w-4" />
        {t('blockerDetails')}
      </div>
      <p className="mb-3 text-xs text-amber-700/90 dark:text-amber-200/80">{t('blockerIntro')}</p>

      <div className="mb-3">
        <Label className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('blockerReason')}</Label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {BLOCKER_REASONS.map(({ value, labelKey }) => {
            const active = blockerReason === value;
            return (
              <button
                key={value}
                type="button"
                disabled={!canWrite}
                aria-pressed={active}
                onClick={() => setBlockerReason(active ? '' : value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
                    : 'border-amber-200 bg-white text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-slate-950/40 dark:text-amber-300 dark:hover:bg-amber-950/40'
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-3">
        <Label htmlFor="blockerDescription" className="text-xs font-medium text-amber-800 dark:text-amber-300">
          {t('blockerDescriptionLabel')}
        </Label>
        <Textarea
          id="blockerDescription"
          value={executionNotes}
          onChange={(e) => setExecutionNotes(e.target.value)}
          placeholder={t('blockerDescriptionPlaceholder')}
          rows={3}
          readOnly={!canWrite}
          className="mt-1 resize-none border-amber-200 text-sm dark:border-amber-900/60 dark:bg-slate-950/40"
        />
      </div>

      {testSteps.length > 0 && (
        <div className="mb-3">
          <Label htmlFor="blockedStep" className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('blockedAtStep')}</Label>
          <Select value={selectedFailureStepNumber} onValueChange={setSelectedFailureStepNumber} disabled={!canWrite}>
            <SelectTrigger id="blockedStep" className={fieldClass}>
              <SelectValue placeholder={t('selectBlockedStep')} />
            </SelectTrigger>
            <SelectContent>
              {testSteps.map((step) => (
                <SelectItem key={step.id || step.step_number} value={String(step.step_number)}>
                  {t('stepNumberLabel', { number: step.step_number })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="blockingIssue" className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
            <Link2 className="h-3.5 w-3.5" />
            {t('blockingIssueLabel')}
          </Label>
          <Input
            id="blockingIssue" name="blocking-url" {...urlInputProps} {...readOnlyInput}
            value={defectLink}
            onChange={(e) => setDefectLink(e.target.value)}
            placeholder={t('blockingIssuePlaceholder')}
            className={fieldClass}
          />
        </div>
        <div>
          <Label htmlFor="blockerReference" className="text-xs font-medium text-amber-800 dark:text-amber-300">{t('blockerReferenceLabel')}</Label>
          <Input
            id="blockerReference" name="blocker-reference-url" {...urlInputProps} {...readOnlyInput}
            value={customLink}
            onChange={(e) => setCustomLink(e.target.value)}
            placeholder={t('blockerReferencePlaceholder')}
            className={fieldClass}
          />
        </div>
      </div>
    </div>
  );
}

function FailureContext() {
  const {
    t, testCase, testSteps, testStepsLoadError, requireDefectOnFailure,
    selectedFailureStepNumber, setSelectedFailureStepNumber,
    failureStepActual, setFailureStepActual,
    defectLink, setDefectLink, customLink, setCustomLink, canWrite,
  } = useExecution();

  const fieldClass = 'mt-1 h-9 border-red-200 bg-white text-sm dark:border-red-900/60 dark:bg-slate-950/40';
  const readOnlyInput = { readOnly: !canWrite, tabIndex: canWrite ? undefined : -1 };

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-4 dark:border-red-900/50 dark:bg-red-950/20">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
        <AlertTriangle className="h-4 w-4" />
        {t('failureContext')}
      </div>

      {requireDefectOnFailure && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-xs text-red-700 dark:bg-slate-950/40 dark:text-red-300">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          {t('defectRequiredHint')}
        </div>
      )}

      {testCase?.is_multistep && testStepsLoadError && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-xs text-red-700 dark:bg-slate-950/40 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t('testStepsLoadRequiredForDefect')}
        </div>
      )}

      {testSteps.length > 0 && (
        <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <Label htmlFor="failingStep" className="text-xs font-medium text-red-700 dark:text-red-300">{t('failingStep')}</Label>
            <Select value={selectedFailureStepNumber} onValueChange={setSelectedFailureStepNumber} disabled={!canWrite}>
              <SelectTrigger id="failingStep" className={fieldClass}>
                <SelectValue placeholder={t('selectFailingStep')} />
              </SelectTrigger>
              <SelectContent>
                {testSteps.map((step) => (
                  <SelectItem key={step.id || step.step_number} value={String(step.step_number)}>
                    {t('stepNumberLabel', { number: step.step_number })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="failureStepActual" className="text-xs font-medium text-red-700 dark:text-red-300">{t('failureStepActual')}</Label>
            <Input
              id="failureStepActual" {...readOnlyInput}
              value={failureStepActual}
              onChange={(e) => setFailureStepActual(e.target.value)}
              placeholder={t('failureStepActualPlaceholder')}
              maxLength={5000}
              className={fieldClass}
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="defectLink" className="text-xs font-medium text-red-700 dark:text-red-300">{t('defectLinkLabel')}</Label>
          <Input
            id="defectLink" name="defect-url" {...urlInputProps} {...readOnlyInput}
            value={defectLink}
            onChange={(e) => setDefectLink(e.target.value)}
            placeholder={t('defectLinkPlaceholder')}
            className={fieldClass}
          />
        </div>
        <div>
          <Label htmlFor="customLink" className="text-xs font-medium text-red-700 dark:text-red-300">{t('customLinkLabel')}</Label>
          <Input
            id="customLink" name="custom-url" {...urlInputProps} {...readOnlyInput}
            value={customLink}
            onChange={(e) => setCustomLink(e.target.value)}
            placeholder={t('customLinkPlaceholder')}
            className={fieldClass}
          />
        </div>
      </div>
    </div>
  );
}

export function FailureContextFields() {
  const { executionStatus } = useExecution();
  return executionStatus === 'blocked' ? <BlockerContext /> : <FailureContext />;
}
