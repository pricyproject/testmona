import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MessageSquare, Send, Reply, Check, CheckCircle2, Trash2, Loader2, CornerDownRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { getApiErrorMessage, requirementsAPI } from '@/lib/api';
import { useRequirementComments, useRequirementCommentMembers } from '@/hooks/queries/requirementComments';
import type { RequirementComment } from '@/types';

interface MemberOption {
  user_id: number;
  username: string;
  full_name?: string | null;
}

interface Props {
  requirementId: number;
  projectId: number;
  canComment: boolean;
}

// User content is bidi-isolated and auto-directed so a Latin sentence never
// renders reversed/right-aligned under an RTL (Arabic/Farsi) interface.
const PLAINTEXT_DIR: CSSProperties = { unicodeBidi: 'plaintext', textAlign: 'start' };
const MENTION_TOKEN = /@([A-Za-z0-9_.-]+)/g;
const RTL_CHARACTER = /[\u0590-\u08FF]/;
const FIRST_STRONG_CHARACTER = /[A-Za-z0-9\u0590-\u08FF]/;
const TEXTAREA_NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);
const MAX_COMMENT_BODY_LENGTH = 10000;

const textInputDirection = (value: string): 'ltr' | 'rtl' => {
  const firstStrong = value.match(FIRST_STRONG_CHARACTER)?.[0];
  return firstStrong && RTL_CHARACTER.test(firstStrong) ? 'rtl' : 'ltr';
};

const initials = (name?: string | null): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase();
};

const avatarTone = (seed: number): string => {
  const tones = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  ];
  return tones[Math.abs(seed) % tones.length];
};

// A Textarea with @mention autocomplete sourced from project members.
function MentionTextarea({
  value,
  onChange,
  members,
  placeholder,
  autoFocus,
  className,
  disabled,
  id,
  name,
  maxLength,
  ariaLabel,
  ariaDescribedBy,
  onSubmitIntent,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MemberOption[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  maxLength?: number;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  onSubmitIntent?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const direction = textInputDirection(value);

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    return members
      .filter((m) => m.username.toLowerCase().includes(q) || (m.full_name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [open, query, members]);

  // Open the popup only while the caret sits inside an "@token" at a word start.
  const detect = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    const match = /(^|\s)@([A-Za-z0-9_.-]*)$/.exec(before);
    if (match && members.length > 0) {
      setQuery(match[2]);
      setActiveIndex(0);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const insertMention = (username: string) => {
    const el = ref.current;
    const pos = el?.selectionStart ?? value.length;
    const before = value.slice(0, pos).replace(/@([A-Za-z0-9_.-]*)$/, `@${username} `);
    const next = before + value.slice(pos);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (matches.length > 0 && e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (matches.length > 0 && e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (matches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        insertMention(matches[activeIndex].username);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmitIntent?.();
    }
  };

  const mentionedMembers = useMemo(() => {
    const mentioned = new Set((value.match(MENTION_TOKEN) || []).map((token) => token.slice(1).toLowerCase()));
    if (mentioned.size === 0) return [];
    return members.filter((member) => mentioned.has(member.username.toLowerCase()));
  }, [members, value]);

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={ref}
        id={id}
        name={name}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target); }}
        onKeyUp={(e) => {
          if (!TEXTAREA_NAVIGATION_KEYS.has(e.key)) {
            detect(e.currentTarget);
          }
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={maxLength}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        dir={direction}
        style={{
          direction,
          textAlign: direction === 'rtl' ? 'right' : 'left',
          unicodeBidi: 'plaintext',
        }}
      />
      {mentionedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {mentionedMembers.map((member) => (
            <span
              key={member.user_id}
              className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
              dir="ltr"
            >
              @{member.username}
            </span>
          ))}
        </div>
      )}
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-64 overflow-auto rounded-md border bg-popover p-1 shadow-md" role="listbox" style={{ insetInlineStart: 0 }}>
          {matches.map((m, i) => (
            <li key={m.user_id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m.username); }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm ${i === activeIndex ? 'bg-accent' : 'hover:bg-accent'}`}
                role="option"
                aria-selected={i === activeIndex}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarTone(m.user_id)}`}>
                  {initials(m.full_name || m.username)}
                </span>
                <span className="truncate">
                  <span className="font-medium">@{m.username}</span>
                  {m.full_name ? <span className="text-muted-foreground"> · {m.full_name}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RequirementComments({ requirementId, projectId, canComment }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const currentUser = useAuthStore((s) => s.user);

  const commentsQuery = useRequirementComments(requirementId, !!requirementId);
  const membersQuery = useRequirementCommentMembers(projectId, !!projectId);
  const comments: RequirementComment[] = commentsQuery.data ?? [];
  const members: MemberOption[] = membersQuery.data ?? [];
  const loading = commentsQuery.isLoading;
  const [body, setBody] = useState('');
  const [submittingTarget, setSubmittingTarget] = useState<'new' | number | null>(null);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RequirementComment | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    await commentsQuery.refetch();
  }, [commentsQuery]);

  // Surface a comments-load failure (parity with the previous loader).
  useEffect(() => {
    if (commentsQuery.isError) {
      toast({ title: t('error'), description: t('commentsLoadFailed'), variant: 'destructive' });
    }
  }, [commentsQuery.isError, t, toast]);

  const memberUsernames = useMemo(
    () => new Set(members.map((m) => m.username.toLowerCase())),
    [members],
  );

  const { openCount, resolvedCount } = useMemo(() => ({
    openCount: comments.filter((c) => !c.is_resolved).length,
    resolvedCount: comments.filter((c) => c.is_resolved).length,
  }), [comments]);

  // Highlight @mentions that resolve to a known project member.
  const renderBody = (text: string) => {
    const segments = text.split(MENTION_TOKEN);
    // split with one capture group yields [text, name, text, name, ...]
    return segments.map((segment, i) => {
      if (i % 2 === 1 && memberUsernames.has(segment.toLowerCase())) {
        return (
          <span key={i} className="rounded bg-blue-100 px-1 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            @{segment}
          </span>
        );
      }
      return <span key={i}>{i % 2 === 1 ? `@${segment}` : segment}</span>;
    });
  };

  const submitComment = async (text: string, parentId: number | null) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_COMMENT_BODY_LENGTH || submittingTarget !== null) return;
    try {
      setSubmittingTarget(parentId ?? 'new');
      await requirementsAPI.addComment(requirementId, { body: trimmed, parent_id: parentId });
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      if (parentId) { setReplyBody(''); setReplyTo(null); } else { setBody(''); }
      await load();
    } catch (error) {
      toast({ title: t('error'), description: getApiErrorMessage(error, t('commentPostFailed')), variant: 'destructive' });
    } finally {
      setSubmittingTarget(null);
    }
  };

  const handleCommentSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitComment(body, null);
  };

  const handleReplySubmit = (event: FormEvent<HTMLFormElement>, parentId: number) => {
    event.preventDefault();
    submitComment(replyBody, parentId);
  };

  const toggleResolved = async (comment: RequirementComment) => {
    try {
      await requirementsAPI.updateComment(comment.id, { is_resolved: !comment.is_resolved });
      await load();
    } catch {
      toast({ title: t('error'), description: t('commentUpdateFailed'), variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await requirementsAPI.deleteComment(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ title: t('error'), description: t('commentDeleteFailed'), variant: 'destructive' });
    }
  };

  const canModerate = currentUser?.is_superuser || ['admin', 'manager'].includes(String(currentUser?.role ?? ''));
  const ownsComment = (c: RequirementComment) => currentUser?.id === c.author?.id;

  const renderCommentCard = (comment: RequirementComment, depth: number) => {
    const authorName = comment.author?.full_name || comment.author?.username || t('unknownUser');
    const isReplySubmitting = submittingTarget === comment.id;
    const canSubmitReply = replyBody.trim().length > 0 && replyBody.trim().length <= MAX_COMMENT_BODY_LENGTH;
    const replyFieldId = `requirement-${requirementId}-comment-${comment.id}-reply`;
    const replyHelpId = `${replyFieldId}-help`;
    return (
      <div key={comment.id} className={depth > 0 ? 'ms-5 border-s border-slate-200 ps-4 dark:border-slate-700' : ''}>
        <div className={`rounded-lg border p-3 ${comment.is_resolved ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(comment.author?.id ?? 0)}`}>
              {initials(authorName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{authorName}</span>
                <span className="text-xs text-muted-foreground">{new Date(comment.created_at).toLocaleString()}</span>
                {comment.is_resolved && (
                  <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <CheckCircle2 className="me-1 h-3 w-3" /> {t('resolved')}
                  </Badge>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200" dir="auto" style={PLAINTEXT_DIR}>
                {renderBody(comment.body)}
              </p>
              {canComment && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {depth === 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setReplyTo(replyTo === comment.id ? null : comment.id); setReplyBody(''); }}>
                      <Reply className="me-1 h-3.5 w-3.5" /> {t('reply')}
                    </Button>
                  )}
                  {depth === 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => toggleResolved(comment)}>
                      <Check className="me-1 h-3.5 w-3.5" /> {comment.is_resolved ? t('reopen') : t('resolve')}
                    </Button>
                  )}
                  {(ownsComment(comment) || canModerate) && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700" onClick={() => setDeleteTarget(comment)}>
                      <Trash2 className="me-1 h-3.5 w-3.5" /> {t('delete')}
                    </Button>
                  )}
                </div>
              )}

              {replyTo === comment.id && (
                <form
                  className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40"
                  onSubmit={(event) => handleReplySubmit(event, comment.id)}
                >
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <CornerDownRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Label htmlFor={replyFieldId} className="text-xs font-medium">{t('writeReply')}</Label>
                  </div>
                  <div>
                    <MentionTextarea
                      id={replyFieldId}
                      name="reply"
                      value={replyBody}
                      onChange={setReplyBody}
                      members={members}
                      placeholder={t('writeReply')}
                      className="min-h-[88px] resize-y text-sm"
                      autoFocus
                      disabled={isReplySubmitting}
                      maxLength={MAX_COMMENT_BODY_LENGTH}
                      ariaLabel={t('writeReply')}
                      ariaDescribedBy={replyHelpId}
                      onSubmitIntent={() => submitComment(replyBody, comment.id)}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span id={replyHelpId} className="text-xs text-muted-foreground">
                        {t('commentCharacterCount', { count: replyBody.trim().length, max: MAX_COMMENT_BODY_LENGTH })}
                      </span>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setReplyTo(null); setReplyBody(''); }}>{t('cancel')}</Button>
                        <Button type="submit" size="sm" disabled={isReplySubmitting || !canSubmitReply}>
                          {isReplySubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('submitReply')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
        {comment.replies?.length > 0 && (
          <div className="mt-2 space-y-2">
            {comment.replies.map((reply) => renderCommentCard(reply, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const visible = showResolved ? comments : comments.filter((c) => !c.is_resolved);
  const isCommentSubmitting = submittingTarget === 'new';
  const canSubmitComment = body.trim().length > 0 && body.trim().length <= MAX_COMMENT_BODY_LENGTH;
  const commentFieldId = `requirement-${requirementId}-new-comment`;
  const commentHelpId = `${commentFieldId}-help`;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold">{t('commentsReview')}</h2>
          <Badge variant="secondary">{openCount} {t('open')}</Badge>
          {resolvedCount > 0 && (
            <button type="button" onClick={() => setShowResolved((v) => !v)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              {showResolved ? t('hideResolved') : t('showResolvedCount', { n: resolvedCount })}
            </button>
          )}
        </div>
      </div>

      {canComment && (
        <form className="mb-5 flex items-start gap-3" onSubmit={handleCommentSubmit}>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(currentUser?.id ?? 0)}`}>
            {initials(currentUser?.full_name || currentUser?.username)}
          </span>
          <div className="flex-1">
            <Label htmlFor={commentFieldId} className="sr-only">{t('addCommentPlaceholder')}</Label>
            <MentionTextarea
              id={commentFieldId}
              name="comment"
              value={body}
              onChange={setBody}
              members={members}
              placeholder={t('addCommentPlaceholder')}
              className="min-h-[96px] resize-y text-sm"
              disabled={isCommentSubmitting}
              maxLength={MAX_COMMENT_BODY_LENGTH}
              ariaLabel={t('addCommentPlaceholder')}
              ariaDescribedBy={commentHelpId}
              onSubmitIntent={() => submitComment(body, null)}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span id={commentHelpId} className="text-xs text-muted-foreground">
                {t('mentionHint')} · {t('commentCharacterCount', { count: body.trim().length, max: MAX_COMMENT_BODY_LENGTH })}
              </span>
              <Button type="submit" size="sm" disabled={isCommentSubmitting || !canSubmitComment}>
                {isCommentSubmitting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Send className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('comment')}
              </Button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('noCommentsYet')}</p>
      ) : (
        <div className="space-y-3">
          {visible.map((comment) => renderCommentCard(comment, 0))}
        </div>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteCommentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteCommentDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDelete(); }} className="bg-rose-600 hover:bg-rose-700">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
