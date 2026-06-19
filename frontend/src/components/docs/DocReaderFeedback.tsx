import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Flag,
  Loader2,
  MessageCircleQuestion,
  MessagesSquare,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { formatRelativeTime } from '@/utils/datetime';
import {
  useDocFeedback,
  useSubmitDocFeedback,
  useClearDocFeedback,
  useResolveDocFeedback,
} from '@/hooks/queries/docDetail';
import type { DocFeedback, DocFeedbackType } from '@/types';

type IssueType = 'clarification' | 'outdated';

interface DocReaderFeedbackProps {
  docId: number;
  canEdit: boolean;
}

// Per-type accent used for badges/dots in the editor triage list.
const typeTone: Record<DocFeedbackType, string> = {
  helpful: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  not_helpful: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  clarification: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  outdated: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Reader feedback panel on the doc page. Readers cast a quick helpful / not-helpful
 * vote or file an issue (needs-clarity / outdated, comment required); the doc's
 * editors triage the resulting actionable items. A reader holds one feedback row, so
 * switching between a vote and an issue replaces it — the UI always reflects the
 * current verdict and lets the reader edit or clear it.
 */
export function DocReaderFeedback({ docId, canEdit }: DocReaderFeedbackProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [includeResolved, setIncludeResolved] = useState(false);
  const [dialogType, setDialogType] = useState<IssueType | null>(null);
  const [comment, setComment] = useState('');
  const [section, setSection] = useState('');

  const query = useDocFeedback(docId, canEdit, includeResolved, true);
  const summary = query.data?.summary ?? null;
  const items: DocFeedback[] = query.data?.items ?? [];
  const listLoading = query.isLoading;

  const submitMutation = useSubmitDocFeedback(docId);
  const clearMutation = useClearDocFeedback(docId);
  const resolveMutation = useResolveDocFeedback(docId);
  const saving = submitMutation.isPending || clearMutation.isPending;
  const resolving = resolveMutation.isPending;

  const mine = summary?.my_feedback ?? null;
  const myType = mine?.feedback_type;

  const totalVotes = (summary?.helpful ?? 0) + (summary?.not_helpful ?? 0);
  const helpfulPct = totalVotes ? Math.round(((summary?.helpful ?? 0) / totalVotes) * 100) : 0;
  const label = (type: DocFeedbackType) => t(`docFeedback_${type}` as any);

  // Quick vote: clicking the active vote clears it; otherwise it replaces whatever
  // feedback the reader had (rating or issue).
  const vote = async (type: 'helpful' | 'not_helpful') => {
    if (saving) return;
    try {
      if (myType === type) await clearMutation.mutateAsync();
      else await submitMutation.mutateAsync({ feedback_type: type, comment: null, section_text: null });
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docFeedbackFailed'), variant: 'destructive' });
    }
  };

  const openIssue = (type: IssueType) => {
    setDialogType(type);
    // Editing the reader's existing issue of this type pre-fills their text.
    if (myType === type && mine) {
      setComment(mine.comment ?? '');
      setSection(mine.section_text ?? '');
    } else {
      setComment('');
      setSection('');
    }
  };

  const submitIssue = async () => {
    if (!dialogType || !comment.trim() || saving) return;
    try {
      await submitMutation.mutateAsync({
        feedback_type: dialogType,
        comment: comment.trim(),
        section_text: section.trim() || null,
      });
      toast({ title: t('success'), description: t('docFeedbackSaved') });
      setDialogType(null);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docFeedbackFailed'), variant: 'destructive' });
    }
  };

  const clearMine = async () => {
    if (saving) return;
    try {
      await clearMutation.mutateAsync();
    } catch {
      toast({ title: t('error'), description: t('docFeedbackFailed'), variant: 'destructive' });
    }
  };

  const resolve = async (item: DocFeedback, resolved: boolean) => {
    if (resolving) return;
    try {
      await resolveMutation.mutateAsync({ feedbackId: item.id, resolved });
    } catch {
      toast({ title: t('error'), description: t('docFeedbackResolveFailed'), variant: 'destructive' });
    }
  };

  const dialogTitle = dialogType ? label(dialogType) : '';
  const editingExisting = !!dialogType && myType === dialogType;

  const issueButton = (type: IssueType, Icon: typeof Flag) => {
    const active = myType === type;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => openIssue(type)}
        disabled={saving}
        className={active ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : ''}
      >
        <Icon className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
        {label(type)}
        {active && <CheckCircle2 className={`h-3.5 w-3.5 ${isRTL ? 'mr-1.5' : 'ml-1.5'}`} />}
      </Button>
    );
  };

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-violet-600" />
          <h2 className="text-sm font-semibold">{t('docFeedbackTitle')}</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('docFeedbackDesc')}</p>
      </div>

      <div className="px-5 py-4">
        {/* Helpfulness vote */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium">{t('docFeedbackHelpfulPrompt')}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={myType === 'helpful' ? 'default' : 'outline'}
              onClick={() => vote('helpful')}
              disabled={saving}
              className={myType === 'helpful' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              <ThumbsUp className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('docFeedbackYes')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={myType === 'not_helpful' ? 'default' : 'outline'}
              onClick={() => vote('not_helpful')}
              disabled={saving}
              className={myType === 'not_helpful' ? 'bg-rose-600 hover:bg-rose-700' : ''}
            >
              <ThumbsDown className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('docFeedbackNo')}
            </Button>
          </div>
        </div>

        {/* Aggregate helpfulness */}
        {totalVotes > 0 && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${helpfulPct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('docFeedbackHelpfulRatio', { pct: helpfulPct, n: totalVotes })}
            </p>
          </div>
        )}

        {/* Issue reporting */}
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">{t('docFeedbackIssuePrompt')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {issueButton('clarification', MessageCircleQuestion)}
            {issueButton('outdated', Flag)}
          </div>
        </div>

        {/* Current reader verdict */}
        {mine && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/40">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-muted-foreground">{t('docFeedbackYouMarked')}</span>
            <Badge className={`border-0 ${typeTone[mine.feedback_type]}`}>{label(mine.feedback_type)}</Badge>
            {mine.comment && <span className="w-full truncate text-muted-foreground sm:w-auto" dir="auto">“{mine.comment}”</span>}
            <button
              type="button"
              onClick={clearMine}
              disabled={saving}
              className={`text-muted-foreground hover:text-foreground ${isRTL ? 'mr-auto' : 'ml-auto'}`}
            >
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3.5 w-3.5" />
                {t('docFeedbackClear')}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Editor triage list */}
      {canEdit && (
        <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('docFeedbackOpenItems', { n: summary?.unresolved ?? 0 })}
            </h3>
            <Button type="button" variant="ghost" size="sm" disabled={listLoading} onClick={() => setIncludeResolved((v) => !v)}>
              {includeResolved ? t('docFeedbackHideResolved') : t('docFeedbackShowResolved')}
            </Button>
          </div>

          {listLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 py-8 text-center dark:border-slate-700">
              <MessagesSquare className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{t('docFeedbackNoItems')}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const name = item.user?.full_name || item.user?.username || item.user?.email || `#${item.user_id}`;
                return (
                  <li
                    key={item.id}
                    className={`rounded-lg border p-3 text-sm transition-colors ${
                      item.resolved
                        ? 'border-slate-200 bg-slate-50/50 opacity-75 dark:border-slate-800 dark:bg-slate-800/20'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {initials(name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium" dir="auto">{name}</span>
                        <span className="block text-[11px] text-muted-foreground">{formatRelativeTime(item.created_at)}</span>
                      </div>
                      <Badge className={`border-0 ${typeTone[item.feedback_type]}`}>{label(item.feedback_type)}</Badge>
                      <Button type="button" variant="ghost" size="sm" disabled={resolving} onClick={() => resolve(item, !item.resolved)}>
                        <CheckCircle2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                        {item.resolved ? t('docFeedbackReopen') : t('docFeedbackResolve')}
                      </Button>
                    </div>
                    {item.comment && (
                      <p className="mt-2 whitespace-pre-wrap text-slate-700 dark:text-slate-200" dir="auto">{item.comment}</p>
                    )}
                    {item.section_text && (
                      <blockquote className="mt-2 border-s-2 border-primary/40 ps-3 text-xs text-muted-foreground" dir="auto">
                        {item.section_text}
                      </blockquote>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <Dialog open={!!dialogType} onOpenChange={(o) => { if (!o) setDialogType(null); }}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{editingExisting ? t('docFeedbackEditIssue', { type: dialogTitle }) : dialogTitle}</DialogTitle>
            <DialogDescription>{t('docFeedbackDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('docFeedbackComment')}</label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
                rows={4}
                autoFocus
                placeholder={t('docFeedbackCommentPlaceholder')}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('docFeedbackSection')}</label>
              <Textarea
                value={section}
                onChange={(e) => setSection(e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder={t('docFeedbackSectionPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogType(null)} disabled={saving}>{t('cancel')}</Button>
            <Button type="button" onClick={submitIssue} disabled={saving || !comment.trim()}>
              {saving && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
