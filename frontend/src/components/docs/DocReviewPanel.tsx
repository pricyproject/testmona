import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  History,
  Loader2,
  MessageSquare,
  XCircle,
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
import { docsAPI, getApiErrorMessage } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { formatServerDateTime } from '@/utils/datetime';
import type { DocReviewDecision, DocReviewRound, DocReviewRoundStatus, DocReviewView } from '@/types';

interface DocReviewPanelProps {
  docId: number;
  /** Bump this to force a refetch (e.g. after the request-review dialog succeeds). */
  refreshKey?: number;
  /** Called whenever a review action may have changed the doc's status. */
  onChanged?: () => void;
}

const roundStatusTone: Record<DocReviewRoundStatus, string> = {
  open: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  changes_requested: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function decisionIcon(decision: DocReviewDecision) {
  if (decision === 'approved') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (decision === 'changes_requested') return <XCircle className="h-4 w-4 text-amber-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Review panel on the doc page. Shows the current review round (reviewers + their
 * verdicts), lets an assigned reviewer approve or request changes, lets a manager
 * withdraw the round, and lists resolved rounds as history.
 */
export function DocReviewPanel({ docId, refreshKey, onChanged }: DocReviewPanelProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [review, setReview] = useState<DocReviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docsAPI.getReview(docId);
      setReview(data);
    } catch {
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const decisionLabel = (decision: DocReviewDecision) => t(`docReviewDecision_${decision}` as any);

  const submitDecision = async (decision: 'approved' | 'changes_requested', note?: string) => {
    setSubmitting(true);
    try {
      const data = await docsAPI.submitReviewDecision(docId, { decision, comment: note?.trim() || null });
      setReview(data);
      toast({
        title: decision === 'approved' ? t('docReviewApprovedToast') : t('docReviewChangesToast'),
      });
      setChangesOpen(false);
      setComment('');
      onChanged?.();
    } catch (error) {
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToSave')), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelReview = async () => {
    setSubmitting(true);
    try {
      const data = await docsAPI.cancelReview(docId);
      setReview(data);
      toast({ title: t('docReviewCancelledToast') });
      onChanged?.();
    } catch (error) {
      toast({ title: t('error'), description: getApiErrorMessage(error, t('failedToSave')), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-muted-foreground dark:border-slate-800 dark:bg-slate-900">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  const current = review?.current_round ?? null;
  const history = review?.history ?? [];
  // Nothing to show until a review has ever been requested.
  if (!current && history.length === 0) return null;

  const renderReviewers = (round: DocReviewRound) => (
    <ul className="mt-3 space-y-1.5">
      {round.reviewers.map((r) => (
        <li key={r.id} className="flex items-start gap-2 text-sm">
          {decisionIcon(r.decision)}
          <div className="min-w-0 flex-1">
            <span className="font-medium" dir="auto">{r.full_name || r.username || `#${r.reviewer_id}`}</span>
            <span className="ms-2 text-xs text-muted-foreground">{decisionLabel(r.decision)}</span>
            {r.comment && (
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{r.comment}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold">{t('docReviewPanelTitle')}</h2>
        {current && (
          <Badge className={`border-0 ${roundStatusTone[current.status]}`}>
            {t(`docReviewRoundStatus_${current.status}` as any)}
          </Badge>
        )}
      </div>

      {current ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t('docReviewRequestedBy', { name: current.requested_by_name || `#${current.requested_by}` })}
            </span>
            {current.created_at && <span>· {formatServerDateTime(current.created_at)}</span>}
            <span>
              · {t('docReviewProgress', {
                approved: current.approved_count,
                changes: current.changes_requested_count,
                pending: current.pending_count,
              })}
            </span>
          </div>
          {current.note && (
            <blockquote className="mt-2 border-s-2 border-violet-300 ps-3 text-sm text-slate-700 dark:text-slate-200">
              {current.note}
            </blockquote>
          )}
          {renderReviewers(current)}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {review?.can_decide && review.my_decision === 'pending' && (
              <>
                <Button size="sm" onClick={() => submitDecision('approved')} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                  {t('docReviewApprove')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setChangesOpen(true)} disabled={submitting}>
                  <MessageSquare className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docReviewRequestChanges')}
                </Button>
              </>
            )}
            {review?.can_decide && review.my_decision !== 'pending' && (
              <span className="text-xs text-muted-foreground">
                {t('docReviewYourDecision', { decision: decisionLabel(review.my_decision || 'pending') })}
              </span>
            )}
            {review?.can_manage && (
              <Button size="sm" variant="ghost" className="text-rose-600" onClick={cancelReview} disabled={submitting}>
                <XCircle className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('docReviewCancel')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('docReviewNoOpenRound')}</p>
      )}

      {history.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Button type="button" variant="ghost" size="sm" className="px-0" onClick={() => setShowHistory((v) => !v)}>
            <History className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {showHistory ? t('docReviewHideHistory') : t('docReviewShowHistory', { n: history.length })}
          </Button>
          {showHistory && (
            <div className="mt-2 space-y-3">
              {history.map((round) => (
                <div key={round.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge className={`border-0 ${roundStatusTone[round.status]}`}>
                      {t(`docReviewRoundStatus_${round.status}` as any)}
                    </Badge>
                    <span>{t('docReviewRequestedBy', { name: round.requested_by_name || `#${round.requested_by}` })}</span>
                    {round.resolved_at && <span>· {formatServerDateTime(round.resolved_at)}</span>}
                  </div>
                  {renderReviewers(round)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={changesOpen} onOpenChange={(o) => { if (!o) { setChangesOpen(false); setComment(''); } }}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('docReviewRequestChanges')}</DialogTitle>
            <DialogDescription>{t('docReviewRequestChangesDesc')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder={t('docReviewCommentPlaceholder')}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setChangesOpen(false); setComment(''); }} disabled={submitting}>
              {t('cancel')}
            </Button>
            <Button onClick={() => submitDecision('changes_requested', comment)} disabled={submitting || !comment.trim()}>
              {submitting && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('docReviewSubmitChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
