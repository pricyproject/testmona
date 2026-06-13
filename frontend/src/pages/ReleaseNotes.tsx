import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bug,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { markdownToHtml } from '@/components/ui/content-editor';
import { sanitizeHtml } from '@/lib/sanitize';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { parsePositiveIntegerParam } from '@/utils/validation';
import { docsAPI } from '@/lib/api';
import type {
  ReleaseNote,
  ReleaseNoteListItem,
  ReleaseNotesSource,
} from '@/types';

type Mode = 'list' | 'edit' | 'view';

interface Draft {
  id: number | null;            // null = unsaved generated draft
  title: string;
  version: string;
  content_markdown: string;
  summary: string | null;
  range_start?: string | null;
  range_end?: string | null;
  source: ReleaseNotesSource | null;
  status: 'draft' | 'published';
  published_at?: string | null;
  publisher?: string | null;
}

interface GenerateOptions {
  mode: 'since_last' | 'custom';
  since: string;   // yyyy-mm-dd (custom only)
  until: string;   // yyyy-mm-dd (custom only)
  includeAi: boolean;
}

export function ReleaseNotes() {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { projectId: projectIdParam } = useParams<{ projectId?: string }>();
  const projectId = parsePositiveIntegerParam(projectIdParam);
  const docsPath = projectId ? `/projects/${projectId}/docs` : '/docs';

  const [notes, setNotes] = useState<ReleaseNoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('list');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  // Abort an in-flight (paid AI) generation when the component unmounts or the
  // user kicks off another one, and never set state after unmount.
  const genControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    // Reset on (re)mount — React 18 StrictMode mounts, unmounts (running the
    // cleanup below), then remounts in dev, so without restoring this here the
    // ref would stay false and every post-await guard would no-op.
    mountedRef.current = true;
    return () => { mountedRef.current = false; genControllerRef.current?.abort(); };
  }, []);

  const loadNotes = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await docsAPI.listReleaseNotes(projectId);
      setNotes(data);
    } catch {
      toast({ title: t('error'), description: t('releaseNotesLoadError'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [projectId, t, toast]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const previewHtml = useMemo(
    () => (draft ? sanitizeHtml(markdownToHtml(draft.content_markdown || '')) : ''),
    [draft],
  );

  const handleGenerate = async (opts: GenerateOptions) => {
    if (!projectId || generating) return;
    // Custom range: validate the dates before spending an AI call.
    let since: string | undefined;
    let until: string | undefined;
    if (opts.mode === 'custom') {
      if (!opts.since || !opts.until) {
        toast({ title: t('error'), description: t('releaseNotesRangeRequired'), variant: 'destructive' });
        return;
      }
      if (opts.since > opts.until) {
        toast({ title: t('error'), description: t('releaseNotesRangeInvalid'), variant: 'destructive' });
        return;
      }
      since = `${opts.since}T00:00:00`;
      until = `${opts.until}T23:59:59`;
    }
    genControllerRef.current?.abort();
    const controller = new AbortController();
    genControllerRef.current = controller;
    setGenerating(true);
    try {
      const preview = await docsAPI.generateReleaseNotes(
        { project_id: projectId, since, until, include_ai: opts.includeAi },
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      setGenOpen(false);
      setDraft({
        id: null,
        title: preview.title,
        version: '',
        content_markdown: preview.content_markdown,
        summary: preview.summary ?? null,
        range_start: preview.source.range_start,
        range_end: preview.source.range_end,
        source: preview.source,
        status: 'draft',
      });
      setMode('edit');
      if (opts.includeAi && !preview.ai_available && preview.ai_skipped_reason && preview.ai_skipped_reason !== 'no_changes') {
        toast({ title: t('releaseNotesGenerated'), description: t('releaseNotesAiSkipped') });
      }
    } catch (e: unknown) {
      if (controller.signal.aborted || (e as { code?: string })?.code === 'ERR_CANCELED') return;
      if (mountedRef.current) toast({ title: t('error'), description: t('releaseNotesGenerateError'), variant: 'destructive' });
    } finally {
      if (mountedRef.current && genControllerRef.current === controller) setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.content_markdown);
      toast({ title: t('releaseNotesCopied') });
    } catch {
      toast({ title: t('error'), description: t('releaseNotesCopyFailed'), variant: 'destructive' });
    }
  };

  const handleDownload = () => {
    if (!draft) return;
    const base = [draft.title, draft.version].filter(Boolean).join(' ').trim() || 'release-notes';
    const filename = `${base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'release-notes'}.md`;
    const blob = new Blob([draft.content_markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openNote = async (id: number, forEdit: boolean) => {
    try {
      const note = await docsAPI.getReleaseNote(id);
      setDraft(noteToDraft(note));
      setMode(forEdit && note.status === 'draft' ? 'edit' : 'view');
    } catch {
      toast({ title: t('error'), description: t('releaseNotesLoadError'), variant: 'destructive' });
    }
  };

  const handleSave = async (publish = false): Promise<ReleaseNote | null> => {
    if (!draft || !projectId) return null;
    if (!draft.title.trim()) {
      toast({ title: t('error'), description: t('releaseNotesTitleRequired'), variant: 'destructive' });
      return null;
    }
    setSaving(true);
    try {
      let saved: ReleaseNote;
      if (draft.id == null) {
        saved = await docsAPI.createReleaseNote({
          project_id: projectId,
          title: draft.title.trim(),
          version: draft.version.trim() || null,
          content_markdown: draft.content_markdown,
          summary: draft.summary,
          range_start: draft.range_start ?? null,
          range_end: draft.range_end ?? null,
          source_data: draft.source,
        });
        // Persist the new id immediately so that if a follow-up publish fails,
        // a retry updates this draft instead of creating a duplicate.
        setDraft(noteToDraft(saved));
      } else {
        saved = await docsAPI.updateReleaseNote(draft.id, {
          title: draft.title.trim(),
          version: draft.version.trim() || null,
          content_markdown: draft.content_markdown,
          summary: draft.summary,
        });
      }
      if (publish) {
        saved = await docsAPI.publishReleaseNote(saved.id);
      }
      setDraft(noteToDraft(saved));
      setMode(saved.status === 'published' ? 'view' : 'edit');
      await loadNotes();
      toast({ title: t('success'), description: publish ? t('releaseNotesPublished') : t('releaseNotesSaved') });
      return saved;
    } catch {
      toast({ title: t('error'), description: t('releaseNotesSaveError'), variant: 'destructive' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleUnpublish = async () => {
    if (!draft?.id) return;
    setSaving(true);
    try {
      const saved = await docsAPI.unpublishReleaseNote(draft.id);
      setDraft(noteToDraft(saved));
      setMode('edit');
      await loadNotes();
      toast({ title: t('success'), description: t('releaseNotesUnpublished') });
    } catch {
      toast({ title: t('error'), description: t('releaseNotesSaveError'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    try {
      await docsAPI.deleteReleaseNote(deleteId);
      if (draft?.id === deleteId) { setDraft(null); setMode('list'); }
      await loadNotes();
      toast({ title: t('success'), description: t('releaseNotesDeleted') });
    } catch {
      toast({ title: t('error'), description: t('releaseNotesDeleteError'), variant: 'destructive' });
    } finally {
      setDeleteId(null);
    }
  };

  const backToList = () => { setMode('list'); setDraft(null); };

  return (
    <div className="px-4 py-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(docsPath)} title={t('back')}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
        </Button>
        <Rocket className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('releaseNotes')}</h1>
          <p className="text-sm text-muted-foreground">{t('releaseNotesSubtitle')}</p>
        </div>
        <Button onClick={() => setGenOpen(true)} disabled={generating}>
          {generating
            ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
            : <Sparkles className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
          {t('releaseNotesGenerate')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Notes list */}
        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('releaseNotesAll')}</h2>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-muted-foreground dark:border-slate-700">
              {t('releaseNotesEmpty')}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => openNote(note.id, note.status === 'draft')}
                    className={`w-full rounded-lg border px-3 py-2 text-start transition-colors ${
                      draft?.id === note.id
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-slate-200 hover:border-primary/30 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium" dir="auto">{note.title}</span>
                      <StatusBadge status={note.status} t={t} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      {note.version && <span className="font-mono">{note.version}</span>}
                      <span>{formatRange(note.range_start, note.range_end)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Main panel */}
        <section>
          {mode === 'list' && (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
              <Rocket className="mb-3 h-10 w-10 text-muted-foreground" />
              <h3 className="text-lg font-semibold">{t('releaseNotesStartTitle')}</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('releaseNotesStartHint')}</p>
              <Button className="mt-4" onClick={() => setGenOpen(true)} disabled={generating}>
                {generating
                  ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  : <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('releaseNotesGenerate')}
              </Button>
            </div>
          )}

          {mode !== 'list' && draft && (
            <div className="space-y-4">
              {/* Meta + actions */}
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={draft.status} t={t} />
                <span className="text-xs text-muted-foreground">{formatRange(draft.range_start, draft.range_end)}</span>
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={handleCopy} title={t('releaseNotesCopy')}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDownload} title={t('releaseNotesDownload')}>
                  <Download className="h-4 w-4" />
                </Button>
                {mode === 'view' ? (
                  <>
                    <Button variant="outline" size="sm" onClick={handleUnpublish} disabled={saving}>
                      <Undo2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('releaseNotesUnpublish')}
                    </Button>
                    {draft.id != null && (
                      <Button variant="outline" size="sm" className="text-rose-600" onClick={() => setDeleteId(draft.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={backToList}>{t('cancel')}</Button>
                    {draft.id != null && (
                      <Button variant="outline" size="sm" className="text-rose-600" onClick={() => setDeleteId(draft.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}>
                      {saving ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : null}
                      {t('releaseNotesSaveDraft')}
                    </Button>
                    <Button size="sm" onClick={() => handleSave(true)} disabled={saving}>
                      <Rocket className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('releaseNotesPublish')}
                    </Button>
                  </>
                )}
              </div>

              {mode === 'edit' ? (
                <EditView draft={draft} setDraft={setDraft} previewHtml={previewHtml} t={t} />
              ) : (
                <ReadView draft={draft} previewHtml={previewHtml} t={t} />
              )}

              {draft.source && <SourcePanel source={draft.source} t={t} />}
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('releaseNotesDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('releaseNotesDeleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={confirmDelete}>
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GenerateDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        generating={generating}
        onGenerate={handleGenerate}
        isRTL={isRTL}
        t={t}
      />
    </div>
  );
}

function GenerateDialog({
  open, onOpenChange, generating, onGenerate, isRTL, t,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  generating: boolean;
  onGenerate: (opts: GenerateOptions) => void;
  isRTL: boolean;
  t: (k: string) => string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [rangeMode, setRangeMode] = useState<'since_last' | 'custom'>('since_last');
  const [since, setSince] = useState(monthAgo);
  const [until, setUntil] = useState(today);
  const [includeAi, setIncludeAi] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={isRTL ? 'rtl' : 'ltr'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && !generating) {
            e.preventDefault();
            onGenerate({ mode: rangeMode, since, until, includeAi });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            {t('releaseNotesGenerateTitle')}
          </DialogTitle>
          <DialogDescription>{t('releaseNotesGenerateDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">{t('releaseNotesPeriod')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRangeMode('since_last')}
                className={`rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
                  rangeMode === 'since_last'
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-slate-200 hover:border-primary/30 dark:border-slate-800'
                }`}
              >
                {t('releaseNotesPeriodSinceLast')}
              </button>
              <button
                type="button"
                onClick={() => setRangeMode('custom')}
                className={`rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
                  rangeMode === 'custom'
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-slate-200 hover:border-primary/30 dark:border-slate-800'
                }`}
              >
                {t('releaseNotesPeriodCustom')}
              </button>
            </div>
            {rangeMode === 'since_last' ? (
              <p className="text-[11px] text-muted-foreground">{t('releaseNotesPeriodSinceLastHint')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <Label className="mb-1 block text-[11px] text-muted-foreground">{t('releaseNotesFrom')}</Label>
                  <Input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1 block text-[11px] text-muted-foreground">{t('releaseNotesTo')}</Label>
                  <Input type="date" value={until} min={since} onChange={(e) => setUntil(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div>
              <Label className="text-sm font-medium">{t('releaseNotesAiSummary')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('releaseNotesAiSummaryHint')}</p>
            </div>
            <Switch checked={includeAi} onCheckedChange={setIncludeAi} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>{t('cancel')}</Button>
          <Button onClick={() => onGenerate({ mode: rangeMode, since, until, includeAi })} disabled={generating}>
            {generating
              ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />
              : <Sparkles className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
            {t('releaseNotesGenerate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditView({
  draft, setDraft, previewHtml, t,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  previewHtml: string;
  t: (k: string) => string;
}) {
  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('releaseNotesTitleLabel')}</label>
          <Input value={draft.title} onChange={(e) => update({ title: e.target.value })} dir="auto" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('releaseNotesVersionLabel')}</label>
          <Input value={draft.version} onChange={(e) => update({ version: e.target.value })} placeholder="v1.0.0" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('releaseNotesMarkdown')}</label>
          <Textarea
            value={draft.content_markdown}
            onChange={(e) => update({ content_markdown: e.target.value })}
            className="min-h-[420px] font-mono text-xs"
            dir="auto"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('releaseNotesPreview')}</label>
          <div data-rich-text-editor className="min-h-[420px] overflow-y-auto rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <article
              className="rich-text-preview max-w-none"
              dir="auto"
              style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function ReadView({ draft, previewHtml, t }: { draft: Draft; previewHtml: string; t: (k: string) => string }) {
  // The Markdown body already carries the title as its H1, so we don't repeat it
  // here — just a publish byline above the rendered content.
  const byline = draft.published_at
    ? `${t('releaseNotesPublishedOn')} ${new Date(draft.published_at).toLocaleDateString()}${draft.publisher ? ` · ${draft.publisher}` : ''}`
    : null;
  return (
    <div data-rich-text-editor className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      {byline && <p className="mb-3 text-xs text-muted-foreground">{byline}</p>}
      <article
        className="rich-text-preview max-w-none"
        dir="auto"
        style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    </div>
  );
}

function SourcePanel({ source, t }: { source: ReleaseNotesSource; t: (k: string) => string }) {
  const cov = source.coverage;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="text-sm font-semibold">{t('releaseNotesSources')}</h3>
      </div>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4 dark:bg-slate-800">
        <SourceStat icon={FileText} label={t('releaseNotesChangedDocs')} value={source.changed_docs.length} />
        <SourceStat icon={FileText} label={t('releaseNotesRequirements')} value={source.requirements.length} />
        <SourceStat icon={CheckCircle2} label={t('releaseNotesFixedDefects')} value={source.resolved_defects.length} />
        <SourceStat icon={Bug} label={t('releaseNotesKnownIssues')} value={source.open_defects.length} alert={source.open_defects.length > 0} />
      </div>
      {cov.requirements_total > 0 && (
        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-xs text-muted-foreground dark:border-slate-800">
          <FlaskConical className="h-4 w-4" />
          <span>
            {t('releaseNotesCoverage')}: {cov.requirements_covered}/{cov.requirements_total} ({cov.coverage_pct}%) · {cov.test_cases} {t('releaseNotesTestCases')}
          </span>
          {cov.requirements_uncovered > 0 && (
            <Badge variant="outline" className="text-rose-600">{cov.requirements_uncovered} {t('releaseNotesUncovered')}</Badge>
          )}
        </div>
      )}
    </div>
  );
}

function SourceStat({
  icon: Icon, label, value, alert = false,
}: {
  icon: typeof FileText;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />{label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold ${alert ? 'text-rose-600 dark:text-rose-400' : ''}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: 'draft' | 'published'; t: (k: string) => string }) {
  if (status === 'published') {
    return (
      <Badge className="gap-1 border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <Rocket className="h-3 w-3" />{t('releaseNotesStatusPublished')}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <Pencil className="h-3 w-3" />{t('releaseNotesStatusDraft')}
    </Badge>
  );
}

function noteToDraft(note: ReleaseNote): Draft {
  return {
    id: note.id,
    title: note.title,
    version: note.version ?? '',
    content_markdown: note.content_markdown ?? '',
    summary: note.summary ?? null,
    range_start: note.range_start,
    range_end: note.range_end,
    source: note.source_data ?? null,
    status: note.status,
    published_at: note.published_at ?? null,
    publisher: note.publisher?.full_name || note.publisher?.username || null,
  };
}

function formatRange(start?: string | null, end?: string | null): string {
  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '—');
  return `${fmt(start)} → ${fmt(end)}`;
}

export default ReleaseNotes;
