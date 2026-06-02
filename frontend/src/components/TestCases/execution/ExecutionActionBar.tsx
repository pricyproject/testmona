import { Button } from '@/components/ui/button';
import { Save, ChevronRight, Clock, RefreshCw, Loader2, Eye } from 'lucide-react';
import { formatDurationSeconds } from '@/utils/timeFormat';
import { useExecution } from './ExecutionContext';

const PHASE_DOT: Record<string, string> = {
  running: 'animate-pulse bg-emerald-500',
  paused: 'bg-amber-500',
  completed: 'bg-indigo-500',
  idle: 'bg-slate-300 dark:bg-slate-600',
};

/** Sticky bar pinned to the bottom of the viewport with the core record actions. */
export function ExecutionActionBar() {
  const {
    t, isRTL, executionStatus, executionState, elapsedSeconds, retestNeeded,
    isDirty, isSaving, canWrite, hasNext, handleSaveExecution, handleSaveAndNext,
  } = useExecution();

  const canSave = executionStatus !== 'pending' && !isSaving;

  return (
    <div className="sticky bottom-4 z-30 mt-2 flex justify-center">
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-full border border-slate-200 bg-white/90 px-3 py-2 shadow-lg shadow-slate-300/40 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90 dark:shadow-black/40">
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 dark:bg-slate-900">
          <span className={`h-2 w-2 rounded-full ${PHASE_DOT[executionState]}`} />
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-mono text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {formatDurationSeconds(elapsedSeconds, t)}
          </span>
        </div>

        {retestNeeded && (
          <span className="hidden items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 sm:flex">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('retestNeededTitle')}
          </span>
        )}

        {isDirty && canWrite && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400" title={t('unsavedChangesTitle')}>
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="hidden sm:inline">{t('unsavedChanges')}</span>
          </span>
        )}

        {canWrite ? (
          <>
            <Button
              variant="outline"
              onClick={() => handleSaveExecution()}
              disabled={!canSave}
              className="h-9 rounded-full"
              title="Ctrl/⌘ + S"
            >
              {isSaving
                ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
                : <Save className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('save')}
            </Button>
            <Button
              onClick={handleSaveAndNext}
              disabled={!canSave || !hasNext}
              className="h-9 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
            >
              {t('saveAndNext')}
              <ChevronRight className={`h-4 w-4 ${isRTL ? 'mr-2 rotate-180' : 'ml-2'}`} />
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Eye className="h-3.5 w-3.5" />
            {t('readOnlyMode')}
          </span>
        )}
      </div>
    </div>
  );
}
