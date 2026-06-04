import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  Flag,
  Globe,
  History,
  Link2,
  Loader2,
  Lock,
  MessageCircleQuestion,
  Pencil,
  RotateCcw,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { markdownToHtml } from '@/components/ui/content-editor';
import { sanitizeHtml } from '@/lib/sanitize';
import { DocVersionHistory } from '@/components/docs/DocVersionHistory';
import { DocRelatedSection } from '@/components/docs/DocRelatedSection';
import { DocRequirementLinksSection } from '@/components/docs/DocRequirementLinksSection';
import { ConvertDocDialog } from '@/components/docs/ConvertDocDialog';
import { DocImpactDialog } from '@/components/docs/DocImpactDialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI } from '@/lib/api';
import { parsePositiveIntegerParam } from '@/utils/validation';
import { formatServerDateTime } from '@/utils/datetime';
import type { Doc, DocFeedback, DocFeedbackSummary, DocFeedbackType, DocRequirementLink, DocShareInfo, DocSpace, DocStats } from '@/types';

const statusTone: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  archived: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

type DocTab = 'document' | 'revisions' | 'links' | 'stats';
const DOC_TABS: DocTab[] = ['document', 'revisions', 'links', 'stats'];

export function DocDetail({ initialTab = 'document' }: { initialTab?: DocTab }) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { docId, projectId } = useParams<{ docId: string; projectId?: string }>();
  const parsedDocId = parsePositiveIntegerParam(docId);
  const parsedProjectId = parsePositiveIntegerParam(projectId);
  const basePath = parsedProjectId ? `/projects/${parsedProjectId}/docs` : '/docs';

  const [doc, setDoc] = useState<Doc | null>(null);
  const [space, setSpace] = useState<DocSpace | null>(null);
  const [links, setLinks] = useState<DocRequirementLink[]>([]);
  const [stats, setStats] = useState<DocStats | null>(null);
  const [feedback, setFeedback] = useState<DocFeedbackSummary | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<DocFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  // `/…/revisions` deep-links the revisions tab; other tabs ride a `?tab=` param
  // so navigating between them (which remounts this route) keeps the selection.
  const queryTab = searchParams.get('tab');
  const [tab, setTab] = useState<DocTab>(
    DOC_TABS.includes(queryTab as DocTab) ? (queryTab as DocTab) : initialTab,
  );
  const [convertOpen, setConvertOpen] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInfo, setShareInfo] = useState<DocShareInfo | null>(null);
  const [shareSaving, setShareSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackDialogType, setFeedbackDialogType] = useState<DocFeedbackType | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSection, setFeedbackSection] = useState('');
  const [feedbackIncludeResolved, setFeedbackIncludeResolved] = useState(false);
  const [feedbackListLoading, setFeedbackListLoading] = useState(false);

  const load = useCallback(async () => {
    if (!parsedDocId) {
      setDoc(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await docsAPI.get(parsedDocId);
      setDoc(data);
      setFeedbackIncludeResolved(false);
      const [sp, lk, st, fb, fbItems] = await Promise.all([
        docsAPI.getSpace(data.space_id).catch(() => null),
        docsAPI.listRequirementLinks(data.id).catch(() => []),
        data.can_view_stats ? docsAPI.getStats(data.id).catch(() => null) : Promise.resolve(null),
        docsAPI.getFeedback(data.id).catch(() => null),
        data.can_edit ? docsAPI.listFeedback(data.id, false).catch(() => []) : Promise.resolve([]),
      ]);
      setSpace(sp);
      setLinks(lk);
      setStats(st);
      setFeedback(fb);
      setFeedbackItems(fbItems as DocFeedback[]);
    } catch {
      toast({ title: t('error'), description: t('docLoadFailed'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [parsedDocId, t, toast]);

  useEffect(() => { load(); }, [load]);

  const html = useMemo(
    () => (doc ? sanitizeHtml(markdownToHtml(doc.content_markdown || '')) : ''),
    [doc],
  );

  const tagList = useMemo(
    () => (doc?.tags ? doc.tags.split(',').map((s) => s.trim()).filter(Boolean) : []),
    [doc],
  );
  const hasDocContent = Boolean(doc?.content_markdown?.trim());

  const handleExport = async () => {
    if (!doc) return;
    try {
      await docsAPI.exportDoc(doc.id, `${doc.slug || 'doc'}.md`);
    } catch {
      toast({ title: t('error'), description: t('docExportFailed'), variant: 'destructive' });
    }
  };

  const openShare = async () => {
    if (!doc) return;
    try {
      const info = await docsAPI.getShare(doc.id);
      setShareInfo(info);
      setShareOpen(true);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docShareFailed'), variant: 'destructive' });
    }
  };

  const updateShare = async (scope: 'private' | 'public') => {
    if (!doc) return;
    try {
      setShareSaving(true);
      const info = await docsAPI.updateShare(doc.id, { share_scope: scope });
      setShareInfo(info);
      toast({ title: t('success'), description: scope === 'public' ? t('docShareEnabled') : t('docShareDisabled') });
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docShareFailed'), variant: 'destructive' });
    } finally {
      setShareSaving(false);
    }
  };

  const startTitleEdit = () => {
    if (!doc?.can_edit) return;
    setTitleDraft(doc.title);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    if (!doc) return;
    const next = titleDraft.trim();
    if (!next || next === doc.title) { setEditingTitle(false); return; }
    try {
      setSavingTitle(true);
      const updated = await docsAPI.update(doc.id, { title: next });
      setDoc(updated);
      setEditingTitle(false);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docSaveFailed'), variant: 'destructive' });
    } finally {
      setSavingTitle(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareInfo?.share_url) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${shareInfo.share_url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: t('error'), description: t('docCopyFailed'), variant: 'destructive' });
    }
  };

  const handleTabChange = (value: string) => {
    const next = value as DocTab;
    setTab(next);
    if (!doc) return;
    // Canonical URL per tab: revisions has its own path; everything else lives on
    // the doc URL (document = bare, others via ?tab=) so deep-links and refreshes
    // land on the right tab.
    if (next === 'revisions') navigate(`${basePath}/${doc.id}/revisions`, { replace: true });
    else if (next === 'document') navigate(`${basePath}/${doc.id}`, { replace: true });
    else navigate(`${basePath}/${doc.id}?tab=${next}`, { replace: true });
  };

  const handleDelete = async () => {
    if (!doc) return;
    try {
      setDeleting(true);
      await docsAPI.remove(doc.id);
      toast({ title: t('success'), description: t('docDeleted') });
      navigate(basePath);
    } catch {
      toast({ title: t('error'), description: t('docDeleteFailed'), variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const refreshFeedback = async (includeResolved = feedbackIncludeResolved): Promise<boolean> => {
    if (!doc) return false;
    try {
      setFeedbackListLoading(true);
      const [summary, items] = await Promise.all([
        docsAPI.getFeedback(doc.id),
        doc.can_edit ? docsAPI.listFeedback(doc.id, includeResolved) : Promise.resolve([]),
      ]);
      setFeedback(summary);
      setFeedbackItems(items as DocFeedback[]);
      return true;
    } catch {
      toast({ title: t('error'), description: t('docFeedbackLoadFailed'), variant: 'destructive' });
      return false;
    } finally {
      setFeedbackListLoading(false);
    }
  };

  const toggleResolvedFeedback = async () => {
    if (feedbackListLoading) return;
    const next = !feedbackIncludeResolved;
    setFeedbackIncludeResolved(next);
    const ok = await refreshFeedback(next);
    if (!ok) setFeedbackIncludeResolved(!next);
  };

  const submitFeedback = async (feedbackType: DocFeedbackType, comment?: string, sectionText?: string): Promise<boolean> => {
    if (!doc || feedbackSaving) return false;
    try {
      setFeedbackSaving(true);
      const summary = await docsAPI.submitFeedback(doc.id, {
        feedback_type: feedbackType,
        comment: comment?.trim() || null,
        section_text: sectionText?.trim() || null,
      });
      setFeedback(summary);
      if (doc.can_edit) await refreshFeedback();
      toast({ title: t('success'), description: t('docFeedbackSaved') });
      return true;
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docFeedbackFailed'), variant: 'destructive' });
      return false;
    } finally {
      setFeedbackSaving(false);
    }
  };

  const clearMyFeedback = async () => {
    if (!doc || feedbackSaving) return;
    try {
      setFeedbackSaving(true);
      const summary = await docsAPI.deleteFeedback(doc.id);
      setFeedback(summary);
      if (doc.can_edit) await refreshFeedback();
    } catch {
      toast({ title: t('error'), description: t('docFeedbackFailed'), variant: 'destructive' });
    } finally {
      setFeedbackSaving(false);
    }
  };

  const openFeedbackDialog = (feedbackType: DocFeedbackType) => {
    setFeedbackDialogType(feedbackType);
    setFeedbackComment('');
    setFeedbackSection('');
  };

  const submitFeedbackDialog = async () => {
    if (!feedbackDialogType || !feedbackComment.trim()) return;
    const ok = await submitFeedback(feedbackDialogType, feedbackComment, feedbackSection);
    if (ok) setFeedbackDialogType(null);
  };

  const resolveFeedback = async (item: DocFeedback, resolved: boolean) => {
    if (!doc || feedbackListLoading) return;
    try {
      setFeedbackListLoading(true);
      await docsAPI.resolveFeedback(doc.id, item.id, resolved);
      await refreshFeedback();
    } catch {
      toast({ title: t('error'), description: t('docFeedbackResolveFailed'), variant: 'destructive' });
    } finally {
      setFeedbackListLoading(false);
    }
  };

  const feedbackLabel = (type: DocFeedbackType) => t(`docFeedback_${type}` as any);
  const activeFeedback = feedback?.my_feedback?.feedback_type;
  const feedbackDialogTitle = feedbackDialogType ? feedbackLabel(feedbackDialogType) : '';

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!doc) {
    return <div className="p-8 text-center text-muted-foreground">{t('docNotFound')}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(basePath)}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('docHub')}
        </Button>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('export')}
        </Button>
        {doc.can_share && (
          <Button variant="outline" size="sm" onClick={openShare}>
            <Share2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('share')}
          </Button>
        )}
        {links.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setImpactOpen(true)}>
            <Sparkles className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('docImpactAnalyze')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setConvertOpen(true)}>
          <ArrowRightLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('docConvertToRequirements')}
        </Button>
        {doc.can_edit && (
          <Button size="sm" onClick={() => navigate(`${basePath}/${doc.id}/edit`)}>
            <Pencil className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('edit')}
          </Button>
        )}
        {doc.can_delete && (
          <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Header */}
      <div className="mb-5">
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={titleDraft}
              disabled={savingTitle}
              dir="auto"
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void saveTitle(); }
                else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); }
              }}
              className="h-auto border-0 px-0 text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/50"
              onClick={() => void saveTitle()}
              disabled={savingTitle || !titleDraft.trim()}
              title={t('save')}
            >
              {savingTitle ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setEditingTitle(false)}
              disabled={savingTitle}
              title={t('cancel')}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <h1
            className={`text-3xl font-bold tracking-tight ${doc.can_edit ? 'cursor-text rounded hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}`}
            dir="auto"
            onDoubleClick={startTitleEdit}
            title={doc.can_edit ? t('docTitleEditHint') : undefined}
          >
            {doc.title}
          </h1>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className={`border-0 ${statusTone[doc.status] || statusTone.draft}`}>{t(`docStatus_${doc.status}` as any)}</Badge>
          {doc.classification && <Badge variant="outline">{doc.classification}</Badge>}
          {space && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{space.name}</span>}
          <span>· v{doc.current_version}</span>
          {tagList.map((tag) => (
            <button key={tag} type="button" onClick={() => navigate(`${basePath}?tag=${encodeURIComponent(tag)}`)}>
              <Badge variant="secondary">{tag}</Badge>
            </button>
          ))}
          {doc.can_view_stats && <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{doc.view_count ?? 0}</span>}
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="document"><FileText className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />{t('docTabDocument')}</TabsTrigger>
          <TabsTrigger value="revisions"><History className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />{t('versionHistory')}</TabsTrigger>
          <TabsTrigger value="links"><Link2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />{t('docLinkedRequirements')} {links.length > 0 && `(${links.length})`}</TabsTrigger>
          {doc.can_view_stats && <TabsTrigger value="stats"><BarChart3 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />{t('statistics')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="document" className="mt-4">
          {hasDocContent ? (
            <div data-rich-text-editor className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <article
                className="rich-text-preview max-w-none"
                dir="auto"
                style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-muted-foreground dark:border-slate-700">
              {t('docEmpty')}
            </div>
          )}

          {hasDocContent && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">{t('docFeedbackTitle')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('docFeedbackDesc')}</p>
              </div>
              {feedback?.my_feedback && (
                <Button type="button" variant="ghost" size="sm" onClick={clearMyFeedback} disabled={feedbackSaving}>
                  <RotateCcw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docFeedbackClear')}
                </Button>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <Button
                type="button"
                variant={activeFeedback === 'helpful' ? 'default' : 'outline'}
                onClick={() => submitFeedback('helpful')}
                disabled={feedbackSaving}
                className="justify-start"
              >
                <ThumbsUp className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('docFeedbackHelpful')}
                <Badge variant="secondary" className="ms-auto">{feedback?.helpful ?? 0}</Badge>
              </Button>
              <Button
                type="button"
                variant={activeFeedback === 'not_helpful' ? 'default' : 'outline'}
                onClick={() => submitFeedback('not_helpful')}
                disabled={feedbackSaving}
                className="justify-start"
              >
                <ThumbsDown className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('docFeedbackNotHelpful')}
                <Badge variant="secondary" className="ms-auto">{feedback?.not_helpful ?? 0}</Badge>
              </Button>
              <Button
                type="button"
                variant={activeFeedback === 'clarification' ? 'default' : 'outline'}
                onClick={() => openFeedbackDialog('clarification')}
                disabled={feedbackSaving}
                className="justify-start"
              >
                <MessageCircleQuestion className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('docFeedbackClarification')}
                <Badge variant="secondary" className="ms-auto">{feedback?.clarification ?? 0}</Badge>
              </Button>
              <Button
                type="button"
                variant={activeFeedback === 'outdated' ? 'default' : 'outline'}
                onClick={() => openFeedbackDialog('outdated')}
                disabled={feedbackSaving}
                className="justify-start"
              >
                <Flag className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('docFeedbackOutdated')}
                <Badge variant="secondary" className="ms-auto">{feedback?.outdated ?? 0}</Badge>
              </Button>
            </div>
            {doc.can_edit && (
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t('docFeedbackUnresolved', { n: feedback?.unresolved ?? 0 })}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={feedbackListLoading}
                    onClick={toggleResolvedFeedback}
                  >
                    {feedbackIncludeResolved ? t('docFeedbackHideResolved') : t('docFeedbackShowResolved')}
                  </Button>
                </div>
                {feedbackItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('docFeedbackNoItems')}</p>
                ) : (
                  <div className="space-y-2">
                    {feedbackItems.map((item) => (
                      <div key={item.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={item.resolved ? 'secondary' : 'outline'}>{feedbackLabel(item.feedback_type)}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {item.user?.full_name || item.user?.username || item.user?.email || `#${item.user_id}`}
                          </span>
                          <span className="ms-auto" />
                          <Button type="button" variant="ghost" size="sm" disabled={feedbackListLoading} onClick={() => resolveFeedback(item, !item.resolved)}>
                            <CheckCircle2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {item.resolved ? t('docFeedbackReopen') : t('docFeedbackResolve')}
                          </Button>
                        </div>
                        {item.comment && <p className="mt-2 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{item.comment}</p>}
                        {item.section_text && (
                          <blockquote className="mt-2 border-s-2 border-primary/40 ps-3 text-xs text-muted-foreground">
                            {item.section_text}
                          </blockquote>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </TabsContent>

        <TabsContent value="revisions" className="mt-4">
          <DocVersionHistory docId={doc.id} canEdit={doc.can_edit} canClear={doc.can_delete} onRestored={load} />
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          <DocRequirementLinksSection
            docId={doc.id}
            projectId={doc.project_id}
            canEdit={doc.can_edit}
            links={links}
            onChanged={load}
          />
        </TabsContent>

        {doc.can_view_stats && (
          <TabsContent value="stats" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-4"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" />{t('views')}</p><p className="text-2xl font-semibold">{stats?.view_count ?? 0}</p></div>
              <div className="rounded-lg border p-4"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{t('uniqueVisitors')}</p><p className="text-2xl font-semibold">{stats?.unique_visitors ?? 0}</p></div>
              <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{t('lastViewed')}</p><p className="text-sm">{stats?.last_viewed_at ? formatServerDateTime(stats.last_viewed_at) : '-'}</p></div>
            </div>
            <div className="rounded-lg border">
              <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
                <Users className="h-4 w-4 text-muted-foreground" />{t('docTopViewers')}
              </div>
              {stats && stats.latest_visits.length > 0 ? (
                <ul className="divide-y">
                  {stats.latest_visits.map((v) => (
                    <li key={v.user_id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {(v.name || '?').trim().slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{v.name}</span>
                      <Badge variant="secondary" className="shrink-0">{t('docVisitCount', { n: v.visit_count })}</Badge>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {v.last_visited_at ? formatServerDateTime(v.last_visited_at) : '-'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('docNoViewsYet')}</p>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>

      <DocRelatedSection docId={doc.id} canEdit={doc.can_edit} onMerged={load} />

      {convertOpen && (
        <ConvertDocDialog
          doc={doc}
          open={convertOpen}
          onOpenChange={setConvertOpen}
          onConverted={() => { setTab('links'); load(); }}
        />
      )}

      {impactOpen && (
        <DocImpactDialog doc={doc} open={impactOpen} onOpenChange={setImpactOpen} />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('docDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('docDeleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDelete(); }} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Share2 className="h-5 w-5 text-primary" />{t('share')}</DialogTitle>
            <DialogDescription>{t('docShareDesc')}</DialogDescription>
          </DialogHeader>

          {shareInfo?.share_url ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Globe className="h-4 w-4 shrink-0" /> {t('docSharePublicState')}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}${shareInfo.share_url}`}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                  dir="ltr"
                />
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copyShareLink} title={t('copy')}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              {shareInfo.share_expires_at && (
                <p className="text-xs text-muted-foreground">{t('docShareExpiresAt', { date: formatServerDateTime(shareInfo.share_expires_at) })}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-muted-foreground dark:border-slate-800">
              <Lock className="h-4 w-4 shrink-0" /> {t('docSharePrivate')}
            </div>
          )}

          <DialogFooter>
            {shareInfo?.share_url ? (
              <Button variant="outline" onClick={() => updateShare('private')} disabled={shareSaving}>
                {shareSaving ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Lock className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('docShareDisable')}
              </Button>
            ) : (
              <Button onClick={() => updateShare('public')} disabled={shareSaving}>
                {shareSaving ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Globe className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('docShareEnable')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!feedbackDialogType} onOpenChange={(open) => { if (!open) setFeedbackDialogType(null); }}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{feedbackDialogTitle}</DialogTitle>
            <DialogDescription>{t('docFeedbackDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('docFeedbackComment')}</label>
              <Textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder={t('docFeedbackCommentPlaceholder')}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('docFeedbackSection')}</label>
              <Textarea
                value={feedbackSection}
                onChange={(e) => setFeedbackSection(e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder={t('docFeedbackSectionPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFeedbackDialogType(null)} disabled={feedbackSaving}>{t('cancel')}</Button>
            <Button type="button" onClick={submitFeedbackDialog} disabled={feedbackSaving || !feedbackComment.trim()}>
              {feedbackSaving && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
