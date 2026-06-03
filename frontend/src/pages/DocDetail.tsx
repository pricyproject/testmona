import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Globe,
  History,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Share2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { ConvertDocDialog } from '@/components/docs/ConvertDocDialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI } from '@/lib/api';
import { parsePositiveIntegerParam } from '@/utils/validation';
import { formatServerDateTime } from '@/utils/datetime';
import type { Doc, DocRequirementLink, DocShareInfo, DocSpace, DocStats } from '@/types';

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
  const [loading, setLoading] = useState(true);
  // `/…/revisions` deep-links the revisions tab; other tabs ride a `?tab=` param
  // so navigating between them (which remounts this route) keeps the selection.
  const queryTab = searchParams.get('tab');
  const [tab, setTab] = useState<DocTab>(
    DOC_TABS.includes(queryTab as DocTab) ? (queryTab as DocTab) : initialTab,
  );
  const [convertOpen, setConvertOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInfo, setShareInfo] = useState<DocShareInfo | null>(null);
  const [shareSaving, setShareSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [copied, setCopied] = useState(false);

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
      const [sp, lk, st] = await Promise.all([
        docsAPI.getSpace(data.space_id).catch(() => null),
        docsAPI.listRequirementLinks(data.id).catch(() => []),
        data.can_view_stats ? docsAPI.getStats(data.id).catch(() => null) : Promise.resolve(null),
      ]);
      setSpace(sp);
      setLinks(lk);
      setStats(st);
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
          {doc.content_markdown?.trim() ? (
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
        </TabsContent>

        <TabsContent value="revisions" className="mt-4">
          <DocVersionHistory docId={doc.id} canEdit={doc.can_edit} canClear={doc.can_delete} onRestored={load} />
        </TabsContent>

        <TabsContent value="links" className="mt-4">
          {links.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-muted-foreground dark:border-slate-700">
              {t('docNoLinkedRequirements')}
            </div>
          ) : (
            <ul className="space-y-2">
              {links.map((link) => {
                const inner = (
                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:border-primary/40 dark:border-slate-800">
                    <Badge variant="outline" className="shrink-0">{link.requirement_key || `#${link.requirement_id}`}</Badge>
                    <span className="truncate text-sm" dir="auto">{link.requirement_title}</span>
                  </div>
                );
                return (
                  <li key={link.id}>
                    {doc.project_id ? (
                      <Link to={`/projects/${doc.project_id}/requirements/${link.requirement_id}`}>{inner}</Link>
                    ) : inner}
                  </li>
                );
              })}
            </ul>
          )}
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

      <DocRelatedSection docId={doc.id} canEdit={doc.can_edit} />

      {convertOpen && (
        <ConvertDocDialog
          doc={doc}
          open={convertOpen}
          onOpenChange={setConvertOpen}
          onConverted={() => { setTab('links'); load(); }}
        />
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
    </div>
  );
}
