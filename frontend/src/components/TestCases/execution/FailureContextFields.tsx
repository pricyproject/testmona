import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
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

export function FailureContextFields() {
  const {
    t, testCase, testSteps, testStepsLoadError, requireDefectOnFailure,
    selectedFailureStepNumber, setSelectedFailureStepNumber,
    failureStepActual, setFailureStepActual,
    defectLink, setDefectLink, customLink, setCustomLink,
  } = useExecution();

  const fieldClass = 'mt-1 h-9 border-red-200 bg-white text-sm dark:border-red-900/60 dark:bg-slate-950/40';

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
            <Select value={selectedFailureStepNumber} onValueChange={setSelectedFailureStepNumber}>
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
              id="failureStepActual"
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
            id="defectLink" name="defect-url" {...urlInputProps}
            value={defectLink}
            onChange={(e) => setDefectLink(e.target.value)}
            placeholder={t('defectLinkPlaceholder')}
            className={fieldClass}
          />
        </div>
        <div>
          <Label htmlFor="customLink" className="text-xs font-medium text-red-700 dark:text-red-300">{t('customLinkLabel')}</Label>
          <Input
            id="customLink" name="custom-url" {...urlInputProps}
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
