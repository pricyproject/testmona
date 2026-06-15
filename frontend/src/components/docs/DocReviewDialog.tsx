import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { docsAPI, projectAssignmentsAPI, getApiErrorMessage } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';

interface ReviewerOption {
  user_id: number;
  username: string;
  full_name?: string | null;
}

interface DocReviewDialogProps {
  docId: number;
  projectId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Reviewer-picker dialog for the doc review flow. Lists the doc's project members,
 * lets the author choose reviewers + an optional note, and calls
 * ``POST /docs/{id}/request-review`` — which moves the doc to ``in_review`` and
 * notifies each reviewer (Work Inbox "Reviews").
 */
export function DocReviewDialog({ docId, projectId, open, onOpenChange, onSuccess }: DocReviewDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [members, setMembers] = useState<ReviewerOption[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || projectId == null) {
      setMembers([]);
      return;
    }
    let active = true;
    projectAssignmentsAPI
      .listMembers(projectId)
      .then((rows: any[]) => {
        if (!active) return;
        const seen = new Set<number>();
        const options = rows.reduce<ReviewerOption[]>((acc, r) => {
          if (Number(r.project_id) !== projectId || !r.user_id || seen.has(r.user_id)) return acc;
          if (r.user_id === user?.id) return acc; // can't request your own review
          seen.add(r.user_id);
          acc.push({ user_id: r.user_id, username: r.username, full_name: r.full_name });
          return acc;
        }, []);
        setMembers(options);
      })
      .catch(() => setMembers([]));
    return () => {
      active = false;
    };
  }, [open, projectId, user?.id]);

  // Reset transient state whenever the dialog re-opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setNote('');
    }
  }, [open]);

  const toggle = (userId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const reviewerLabel = (m: ReviewerOption) => m.full_name || m.username;
  const canSubmit = useMemo(() => selected.size > 0 && !submitting, [selected, submitting]);

  const submit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const result = await docsAPI.requestReview(docId, {
        reviewer_ids: Array.from(selected),
        note: note.trim() || null,
      });
      toast({ title: t('docReviewRequested'), description: result.message });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToSave')), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('docRequestReview')}</DialogTitle>
          <DialogDescription>{t('docRequestReviewDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('docReviewReviewers')}</Label>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('docReviewNoMembers')}</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-800">
                {members.map((m) => (
                  <label
                    key={m.user_id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Checkbox checked={selected.has(m.user_id)} onCheckedChange={() => toggle(m.user_id)} />
                    <span className="text-sm">{reviewerLabel(m)}</span>
                    <span className="text-xs text-muted-foreground">@{m.username}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-review-note">{t('docReviewNote')}</Label>
            <Textarea
              id="doc-review-note"
              value={note}
              maxLength={500}
              rows={3}
              placeholder={t('docReviewNotePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {t('docReviewSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
