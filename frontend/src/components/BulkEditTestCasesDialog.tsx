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
import { Input } from '@/components/ui/input';
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

interface PriorityOption {
  value: string;
  label: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: number[];
  priorityOptions: PriorityOption[];
  testTypeOptions?: PriorityOption[];
  onApplied: (result: { updated: number; skipped_ids: number[] }) => void;
}

export function BulkEditTestCasesDialog({
  open,
  onOpenChange,
  ids,
  priorityOptions,
  testTypeOptions,
  onApplied,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [priority, setPriority] = useState(UNCHANGED);
  const [status, setStatus] = useState(UNCHANGED);
  const [testType, setTestType] = useState(UNCHANGED);
  const [addTags, setAddTags] = useState('');
  const [removeTags, setRemoveTags] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset fields when the dialog closes so the next open starts clean.
      setPriority(UNCHANGED);
      setStatus(UNCHANGED);
      setTestType(UNCHANGED);
      setAddTags('');
      setRemoveTags('');
    }
  }, [open]);

  const types = testTypeOptions ?? [
    { value: 'manual', label: t('manual') },
    { value: 'automated', label: t('automated') },
  ];

  const statusOptions = [
    { value: 'active', label: t('active') },
    { value: 'inactive', label: t('inactive') },
    { value: 'archived', label: t('archived') },
    { value: 'draft', label: t('draft') },
  ];

  const handleApply = async () => {
    const payload: Parameters<typeof bulkAPI.testCases>[0] = { ids };
    if (priority !== UNCHANGED) payload.priority = priority;
    if (status !== UNCHANGED) payload.status = status;
    if (testType !== UNCHANGED) payload.test_type = testType;
    if (addTags.trim()) payload.add_tags = addTags.trim();
    if (removeTags.trim()) payload.remove_tags = removeTags.trim();

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
      const result = await bulkAPI.testCases(payload);
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
            <Label>{t('testType')}</Label>
            <Select value={testType} onValueChange={setTestType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED}>{t('bulkUnchanged')}</SelectItem>
                {types.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('bulkAddTags')}</Label>
            <Input value={addTags} onChange={(e) => setAddTags(e.target.value)} placeholder={t('bulkTagsPlaceholder')} />
          </div>

          <div className="space-y-2">
            <Label>{t('bulkRemoveTags')}</Label>
            <Input value={removeTags} onChange={(e) => setRemoveTags(e.target.value)} placeholder={t('bulkTagsPlaceholder')} />
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
