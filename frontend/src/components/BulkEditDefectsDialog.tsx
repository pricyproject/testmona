import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { bulkAPI, getApiErrorMessage } from '@/lib/api';

const UNCHANGED = '__unchanged__';
const CLEAR_ASSIGNEE = '__clear__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: number[];
  statusOptions: Array<{ value: string; label: string }>;
  severityOptions: Array<{ value: string; label: string }>;
  priorityOptions: Array<{ value: string; label: string }>;
  userOptions: Array<{ value: string; label: string }>;
  onApplied: (result: { updated: number; skipped_ids: number[] }) => void;
}

export function BulkEditDefectsDialog({
  open,
  onOpenChange,
  ids,
  statusOptions,
  severityOptions,
  priorityOptions,
  userOptions,
  onApplied,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [status, setStatus] = useState(UNCHANGED);
  const [severity, setSeverity] = useState(UNCHANGED);
  const [priority, setPriority] = useState(UNCHANGED);
  const [assignee, setAssignee] = useState(UNCHANGED);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setStatus(UNCHANGED);
      setSeverity(UNCHANGED);
      setPriority(UNCHANGED);
      setAssignee(UNCHANGED);
    }
  }, [open]);

  const handleApply = async () => {
    const payload: Parameters<typeof bulkAPI.defects>[0] = { ids };
    if (status !== UNCHANGED) payload.status = status;
    if (severity !== UNCHANGED) payload.severity = severity;
    if (priority !== UNCHANGED) payload.priority = priority;
    if (assignee === CLEAR_ASSIGNEE) {
      payload.clear_assignee = true;
    } else if (assignee !== UNCHANGED) {
      const id = Number(assignee);
      if (Number.isFinite(id) && id > 0) payload.assigned_to = id;
    }

    if (Object.keys(payload).length <= 1) {
      toast({
        title: t('error'),
        description: t('bulkNoFieldsSelected'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await bulkAPI.defects(payload);
      onApplied(result);
      toast({
        title: t('success'),
        description: t('bulkEditApplied', { count: String(result.updated) })
          + (result.skipped_ids.length > 0 ? ` · ${t('bulkSkippedCount', { count: String(result.skipped_ids.length) })}` : ''),
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('bulkEditFailed')),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('bulkEditTitle', { count: String(ids.length) })}</DialogTitle>
          <DialogDescription>{t('bulkEditDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t('status')}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED}>{t('bulkUnchanged')}</SelectItem>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('severity')}</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED}>{t('bulkUnchanged')}</SelectItem>
                {severityOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('priority')}</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED}>{t('bulkUnchanged')}</SelectItem>
                {priorityOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('assignedTo')}</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED}>{t('bulkUnchanged')}</SelectItem>
                <SelectItem value={CLEAR_ASSIGNEE}>{t('bulkClearAssignee')}</SelectItem>
                {userOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t('cancel')}</Button>
          <Button onClick={handleApply} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('applyToSelected', { count: String(ids.length) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
