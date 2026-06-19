import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Loader2, Search, Send, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Reviewer-picker dialog for the doc review flow. Lists the doc's project members
 * (searchable, with avatars + select-all), lets the author choose reviewers + an
 * optional note, and calls ``POST /docs/{id}/request-review`` — which moves the doc
 * to ``in_review`` and notifies each reviewer (Work Inbox "Reviews").
 */
export function DocReviewDialog({ docId, projectId, open, onOpenChange, onSuccess }: DocReviewDialogProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [members, setMembers] = useState<ReviewerOption[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
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
      setQuery('');
    }
  }, [open]);

  const toggle = (userId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const reviewerLabel = (m: ReviewerOption) => m.full_name || m.username;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => reviewerLabel(m).toLowerCase().includes(q) || m.username.toLowerCase().includes(q),
    );
  }, [members, query]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.user_id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((m) => next.delete(m.user_id));
      else filtered.forEach((m) => next.add(m.user_id));
      return next;
    });
  };

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
      <DialogContent className="sm:max-w-lg" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{t('docRequestReview')}</DialogTitle>
              <DialogDescription className="mt-0.5">{t('docRequestReviewDesc')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {t('docReviewReviewers')}
                {selected.size > 0 && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    {selected.size}
                  </span>
                )}
              </Label>
              {filtered.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-300"
                  onClick={toggleAll}
                >
                  {allFilteredSelected ? t('clearAll') : t('selectAll')}
                </button>
              )}
            </div>

            {members.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-muted-foreground dark:border-slate-700">
                {t('docReviewNoMembers')}
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isRTL ? 'right-3' : 'left-3'}`} />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('docReviewSearchPlaceholder')}
                    className={isRTL ? 'pr-9' : 'pl-9'}
                  />
                </div>
                <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
                  {filtered.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('docReviewNoMatches')}</p>
                  ) : (
                    filtered.map((m) => {
                      const isSelected = selected.has(m.user_id);
                      const label = reviewerLabel(m);
                      return (
                        <button
                          type="button"
                          key={m.user_id}
                          onClick={() => toggle(m.user_id)}
                          className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-start transition-colors ${
                            isSelected
                              ? 'bg-violet-50 dark:bg-violet-900/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                              isSelected
                                ? 'bg-violet-600 text-white'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {initials(label)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium" dir="auto">{label}</span>
                            <span className="block truncate text-xs text-muted-foreground">@{m.username}</span>
                          </span>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-violet-600 bg-violet-600 text-white'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
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
            <p className="text-end text-xs text-muted-foreground">{note.length}/500</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
            ) : (
              <Send className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            )}
            {selected.size > 0 ? t('docReviewSendCount', { n: selected.size }) : t('docReviewSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
