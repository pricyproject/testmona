import { Button } from '@/components/ui/button';
import { Clock, PlayCircle, Pause, RotateCcw } from 'lucide-react';
import { formatDurationSeconds } from '@/utils/timeFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useExecution } from './ExecutionContext';

const PHASE_DOT: Record<string, string> = {
  running: 'animate-pulse bg-emerald-500',
  paused: 'bg-amber-500',
  completed: 'bg-indigo-500',
  idle: 'bg-slate-300 dark:bg-slate-600',
};

export function ExecutionTimer() {
  const {
    t, elapsedSeconds, executionStartedAt, executionState, canWrite,
    handleStartTimer, handlePauseExecution, handleResetTimer, setShowManualTimeDialog,
  } = useExecution();
  const { formatDateTime } = useDateFormat();

  const phaseLabelKey: Record<string, string> = {
    running: 'running', paused: 'paused', completed: 'phaseCompleted', idle: 'notStarted',
  };

  const elapsedText = formatDurationSeconds(elapsedSeconds, t);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400" id="elapsed-time-label">
            {t('elapsedTimeLabel')}
          </p>
          {/* role="timer" announces on demand; aria-live="off" avoids per-second
              chatter while keeping the value queryable by screen readers. */}
          <p
            className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50"
            role="timer"
            aria-live="off"
            aria-labelledby="elapsed-time-label"
            aria-label={`${t('elapsedTimeLabel')}: ${elapsedText}`}
          >
            {elapsedText}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {t('executionStartedLabel')}: {executionStartedAt ? formatDateTime(executionStartedAt) : t('nA')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${PHASE_DOT[executionState]}`} />
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(phaseLabelKey[executionState])}</span>
        </div>
      </div>

      {canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {executionState === 'idle' ? (
            <Button size="sm" onClick={handleStartTimer} className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700">
              <PlayCircle className="mr-1 h-3.5 w-3.5" /> {t('start')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handlePauseExecution} disabled={executionState === 'completed'} className="h-8 text-xs">
              {executionState === 'paused'
                ? (<><PlayCircle className="mr-1 h-3.5 w-3.5" /> {t('resume')}</>)
                : (<><Pause className="mr-1 h-3.5 w-3.5" /> {t('pause')}</>)}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowManualTimeDialog(true)} disabled={executionState === 'idle'} className="h-8 text-xs">
            <Clock className="mr-1 h-3.5 w-3.5" /> {t('addTime')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleResetTimer} disabled={executionState === 'idle'} className="h-8 text-xs">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t('reset')}
          </Button>
        </div>
      )}
    </div>
  );
}
