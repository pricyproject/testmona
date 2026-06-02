import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ClipboardCheck, User, Eye } from 'lucide-react';
import { useExecution } from './ExecutionContext';
import { ExecutionTimer } from './ExecutionTimer';
import { FailureContextFields } from './FailureContextFields';
import { StatusSelector } from './StatusSelector';

export function ExecutionForm() {
  const {
    t, currentUser, users, canWrite,
    assignee, setAssignee,
    isFailedOrBlockedStatus,
    executionNotes, setExecutionNotes,
    executionLogs, setExecutionLogs,
  } = useExecution();

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-slate-400" />
          {t('executionDetails')}
        </CardTitle>
        <p className="mt-0.5 text-xs text-slate-400">{t('executionDetailsDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        {!canWrite && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
            <Eye className="h-3.5 w-3.5 shrink-0" />
            {t('readOnlyNotice')}
          </div>
        )}
        <div>
          <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {t('executionStatusLabel')}
          </Label>
          <div className="mt-2">
            <StatusSelector />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="assignee" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t('assigneeLabel')}
            </Label>
            <Select value={assignee} onValueChange={setAssignee} disabled={!canWrite}>
              <SelectTrigger id="assignee" className="mt-1 h-9 text-sm">
                <SelectValue placeholder={t('selectAssignee')} />
              </SelectTrigger>
              <SelectContent>
                {currentUser && (
                  <SelectItem value={currentUser.id.toString()}>
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5" />
                      <span className="text-sm font-medium">Me ({currentUser.username || currentUser.email || t('unknown')})</span>
                    </div>
                  </SelectItem>
                )}
                {users.filter((u) => u.id !== currentUser?.id).map((user) => (
                  <SelectItem key={user.id} value={user.id.toString()}>
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5" />
                      <span className="text-sm">{user.full_name || user.username || user.email || `User ${user.id}`}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ExecutionTimer />

        {isFailedOrBlockedStatus && <FailureContextFields />}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t('executionNotesLabel')}
            </Label>
            <Textarea
              id="notes"
              value={executionNotes}
              onChange={(e) => setExecutionNotes(e.target.value)}
              placeholder={t('executionNotesPlaceholder')}
              rows={5}
              readOnly={!canWrite}
              className="h-32 min-h-32 resize-none text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logs" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t('executionLogsLabel')}
            </Label>
            <Textarea
              id="logs"
              value={executionLogs}
              onChange={(e) => setExecutionLogs(e.target.value)}
              placeholder={t('executionLogsPlaceholder')}
              rows={5}
              readOnly={!canWrite}
              className="h-32 min-h-32 resize-none font-mono text-xs"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
