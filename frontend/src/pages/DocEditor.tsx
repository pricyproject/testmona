import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Cloud,
  FolderTree,
  Hash,
  Languages,
  Layers,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ContentEditor } from '@/components/ui/content-editor';
import { DocImpactDialog } from '@/components/docs/DocImpactDialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI, projectAssignmentsAPI } from '@/lib/api';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { parsePositiveIntegerParam } from '@/utils/validation';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/utils/datetime';
import type { Doc, DocDir, DocFolder, DocListItem, DocSpace, DocStatus } from '@/types';

const STATUSES: DocStatus[] = ['draft', 'published', 'archived'];
const DIRECTIONS: DocDir[] = ['auto', 'ltr', 'rtl'];
// Mirrors the doc status tones used in DocHub/DocDetail so the editor's status pill
// reads the same everywhere.
const statusTone: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  archived: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};
// Periodic autosave cadence: flush unsaved changes every 4 minutes (manual Save,
// unmount-flush and a beforeunload guard cover the gaps between ticks).
const AUTOSAVE_MS = 4 * 60 * 1000;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function DocEditor() {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { docId, projectId } = useParams<{ docId: string; projectId?: string }>();
  const rawDocId = parsePositiveIntegerParam(docId);
  // Project docs carry the per-project sequence in the URL; the global /docs route uses the raw id.
  const { id: resolvedDocId, loading: docIdLoading } = useResolvedEntityId(projectId, 'docs', docId);
  const parsedDocId = projectId ? resolvedDocId : rawDocId;
  const parsedProjectId = parsePositiveIntegerParam(projectId);
  const basePath = parsedProjectId ? `/projects/${parsedProjectId}/docs` : '/docs';
  // Project docs are addressed by their per-project sequence in the URL; the global
  // /docs route (and rows not yet numbered) fall back to the raw id. Using the global
  // id inside a project URL leaks the PK and can resolve to the wrong doc when that id
  // collides with another doc's project_seq.
  const docHref = useCallback(
    (d: { id: number; project_seq?: number | null }) =>
      `${basePath}/${parsedProjectId ? d.project_seq ?? d.id : d.id}`,
    [basePath, parsedProjectId],
  );

  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [space, setSpace] = useState<DocSpace | null>(null);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [spaceDocs, setSpaceDocs] = useState<DocListItem[]>([]);
  const [members, setMembers] = useState<Array<{ user_id: number; username: string; full_name?: string | null }>>([]);
  // Metadata is a side panel on desktop and a slide-over drawer below `lg`; start it
  // closed on small screens so the drawer doesn't cover the doc on first paint.
  const [showMeta, setShowMeta] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // Last persisted write — a server timestamp on load, `Date.now()` after a save —
  // drives the "Saved <time> ago" hint.
  const [lastSavedAt, setLastSavedAt] = useState<string | number | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);
  // Impact analysis is only meaningful once the doc has linked requirements to
  // trace through; hide the entry point otherwise.
  const [hasLinkedRequirements, setHasLinkedRequirements] = useState(false);

  // Editable fields
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<DocStatus>('draft');
  const [classification, setClassification] = useState('');
  const [tags, setTags] = useState('');
  const [dir, setDir] = useState<DocDir>('auto');
  const [folderId, setFolderId] = useState<number | null>(null);

  // Snapshot of the last successfully-saved values to detect real changes.
  const savedRef = useRef<string>('');
  // Title is an auto-growing textarea (multi-line titles read better than a
  // horizontally-scrolling single-line input).
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const currentSnapshot = useMemo(
    () => JSON.stringify({ title, content, status, classification, tags, dir, folderId }),
    [title, content, status, classification, tags, dir, folderId],
  );

  // Rough word count for the writing footer: collapse Markdown punctuation to spaces
  // and count the remaining tokens. Good enough to give a sense of length.
  const wordCount = useMemo(() => {
    const words = content.replace(/[#>*_`~[\]()-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    return words.length;
  }, [content]);

  // Preview chips for the tags field: split on commas, trim, drop empties.
  const tagList = useMemo(
    () => tags.split(',').map((s) => s.trim()).filter(Boolean),
    [tags],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (projectId && docIdLoading) return;  // wait for the seq -> id resolution
      if (!parsedDocId) {
        setDoc(null);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await docsAPI.get(parsedDocId);
        if (cancelled) return;
        if (!data.can_edit) {
          toast({ title: t('readOnlyMode'), description: t('readOnlyNotice') });
          navigate(docHref(data), { replace: true });
          return;
        }
        setDoc(data);
        setLastSavedAt(data.updated_at || data.created_at || null);
        setTitle(data.title);
        setContent(data.content_markdown || '');
        setStatus(data.status);
        setClassification(data.classification || '');
        setTags(data.tags || '');
        setDir((data.dir as DocDir) || 'auto');
        setFolderId(data.folder_id ?? null);
        savedRef.current = JSON.stringify({
          title: data.title,
          content: data.content_markdown || '',
          status: data.status,
          classification: data.classification || '',
          tags: data.tags || '',
          dir: (data.dir as DocDir) || 'auto',
          folderId: data.folder_id ?? null,
        });
        const [sp, fl, docs, reqLinks] = await Promise.all([
          docsAPI.getSpace(data.space_id).catch(() => null),
          docsAPI.listFolders(data.space_id).catch(() => []),
          docsAPI.list({ spaceId: data.space_id, sort: 'title', limit: 100 }).catch(() => []),
          docsAPI.listRequirementLinks(data.id).catch(() => []),
        ]);
        if (cancelled) return;
        setSpace(sp);
        setFolders(fl);
        setSpaceDocs(docs.filter((item) => item.id !== data.id));
        setHasLinkedRequirements(reqLinks.length > 0);
      } catch {
        toast({ title: t('error'), description: t('docLoadFailed'), variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [parsedDocId, docIdLoading, projectId, docHref, navigate, t, toast]);

  // Project members power @mention autocomplete (project docs only; global docs
  // have no member audience, matching the backend which never notifies on them).
  const docProjectId = doc?.project_id ?? null;
  useEffect(() => {
    if (docProjectId == null) { setMembers([]); return; }
    let active = true;
    projectAssignmentsAPI
      .listMembers(docProjectId)
      .then((rows: any[]) => {
        if (!active) return;
        const seen = new Set<number>();
        const projectMembers = rows.reduce<Array<{ user_id: number; username: string; full_name?: string | null }>>((acc, r) => {
          if (Number(r.project_id) !== docProjectId || !r.user_id || !r.username || seen.has(r.user_id)) return acc;
          seen.add(r.user_id);
          acc.push({ user_id: r.user_id, username: r.username, full_name: r.full_name });
          return acc;
        }, []);
        setMembers(projectMembers);
      })
      .catch(() => setMembers([]));
    return () => { active = false; };
  }, [docProjectId]);

  const save = useCallback(async () => {
    if (!doc) return;
    const snapshot = currentSnapshot;
    if (snapshot === savedRef.current) return;
    // An empty title is a validation gap, not a save failure. Manual Save is already
    // disabled in this state; autosave/unmount-flush silently skip so we don't surprise
    // the user with a red "Save failed" while they're mid-edit.
    if (!title.trim()) return;
    try {
      setSaveState('saving');
      const updated = await docsAPI.update(doc.id, {
        title: title.trim(),
        content_markdown: content,
        status,
        classification: classification.trim() || null,
        tags: tags.trim() || null,
        dir,
        folder_id: folderId,
      });
      setDoc(updated);
      savedRef.current = snapshot;
      setLastSavedAt(Date.now());
      setSaveState('saved');
    } catch {
      setSaveState('error');
      toast({ title: t('error'), description: t('docSaveFailed'), variant: 'destructive' });
    }
  }, [doc, currentSnapshot, title, content, status, classification, tags, dir, folderId, t, toast]);

  // Keep a ref to the latest save so the unmount-flush effect can call it
  // without depending on `save` (whose identity changes on every keystroke).
  const saveFnRef = useRef(save);
  useEffect(() => { saveFnRef.current = save; }, [save]);

  // Mark the document dirty as the editable snapshot changes (no per-keystroke
  // save — saving is on the periodic timer below).
  const isDirty = !loading && !!doc && currentSnapshot !== savedRef.current;
  useEffect(() => {
    if (!isDirty) return;
    setSaveState((prev) => (prev === 'saving' ? prev : 'dirty'));
  }, [currentSnapshot, isDirty]);

  // Grow the title textarea to fit its content so long titles wrap instead of
  // scrolling horizontally.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title, loading]);

  // Re-render every 30s so the "Saved <time> ago" label stays current without a save.
  const [, forceRelTick] = useState(0);
  useEffect(() => {
    if (lastSavedAt == null) return;
    const id = setInterval(() => forceRelTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  // Periodic autosave: every 4 minutes flush any unsaved changes. `save()` is a
  // no-op when nothing changed, so an idle tick costs nothing.
  useEffect(() => {
    if (loading || !doc) return;
    const id = setInterval(() => { void saveFnRef.current(); }, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [loading, doc]);

  // Best-effort flush on unmount only (not on every keystroke).
  useEffect(() => () => { void saveFnRef.current(); }, []);

  // Because saves are infrequent now, warn before leaving with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

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

  const savedAgo = lastSavedAt == null ? '' : formatRelativeTime(lastSavedAt);
  const saveIndicator = () => {
    switch (saveState) {
      case 'saving': return <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('docSaving')}</span>;
      case 'saved': return <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{savedAgo ? t('docSavedAgo', { time: savedAgo }) : t('docSaved')}</span>;
      case 'dirty': return <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Cloud className="h-3.5 w-3.5" />{t('docUnsaved')}</span>;
      case 'error': return <span className="text-rose-600 dark:text-rose-400">{t('docSaveFailed')}</span>;
      // Idle: no in-flight state, but surface when the doc was last persisted so the
      // infrequent autosave cadence stays legible.
      default: return savedAgo ? <span className="text-muted-foreground">{t('docSavedAgo', { time: savedAgo })}</span> : null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(docHref(doc))}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('back')}
        </Button>
        <Badge className={`border-0 ${statusTone[status] || statusTone.draft}`}>{t(`docStatus_${status}` as any)}</Badge>
        <div className="text-xs">{saveIndicator()}</div>
        <span className="flex-1" />
        {hasLinkedRequirements && (
          <Button variant="outline" size="sm" onClick={() => setImpactOpen(true)} title={t('docImpactBeforePublish')}>
            <Sparkles className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('docImpactAnalyze')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => void save()} disabled={saveState === 'saving' || currentSnapshot === savedRef.current || !title.trim()}>
          <Save className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('save')}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setShowMeta((v) => !v)} title={t('docMetadata')}>
          {showMeta
            ? (isRTL ? <PanelLeftClose className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />)
            : (isRTL ? <PanelLeftOpen className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />)}
        </Button>
      </div>

      <div className={`grid gap-6 ${showMeta ? 'lg:grid-cols-[1fr_300px]' : 'grid-cols-1'}`}>
        {/* Writing column */}
        <div className="min-w-0">
          <Textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('docTitlePlaceholder')}
            dir="auto"
            rows={1}
            className="mb-1 min-h-0 resize-none overflow-hidden border-0 px-0 py-0 text-3xl font-bold leading-tight shadow-none focus-visible:ring-0"
          />
          {!title.trim() && (
            <p className="mb-3 text-xs text-rose-600 dark:text-rose-400">{t('titleRequired')}</p>
          )}
          <ContentEditor
            value={content}
            onChange={setContent}
            format="markdown"
            dir={dir === 'auto' ? undefined : dir}
            placeholder={t('docContentPlaceholder')}
            minHeight="60vh"
            mentions={[
              // People: no href → inserts a plain "@username" the backend parses
              // for mention notifications (project docs only).
              ...members.map((m) => ({ id: `user:${m.user_id}`, label: m.username, group: 'people' as const })),
              // Links: navigable references to other docs/folders.
              ...spaceDocs.map((item) => ({ id: `doc:${item.id}`, label: item.title, href: docHref(item), group: 'links' as const })),
              ...folders.map((folder) => ({ id: `folder:${folder.id}`, label: folder.name, href: `${basePath}?folder=${folder.id}`, group: 'links' as const })),
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">{t('docWordCount', { count: wordCount })}</p>
        </div>

        {/* Metadata: an inline side column on lg+, a slide-over drawer below lg. */}
        {showMeta && (
          <>
            <div
              className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
              onClick={() => setShowMeta(false)}
              aria-hidden
            />
            <aside
              className={cn(
                'fixed inset-y-0 z-50 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-background shadow-2xl',
                'lg:static lg:z-auto lg:w-auto lg:max-w-none lg:self-start lg:overflow-visible lg:bg-transparent lg:shadow-none',
                'lg:sticky lg:top-6',
                isRTL ? 'left-0' : 'right-0',
              )}
            >
              {/* Mobile drawer header — desktop uses the panel header below. */}
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 lg:hidden">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  {t('docMetadata')}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setShowMeta(false)} aria-label={t('close')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Seamless properties panel: one cohesive card, hairline-divided sections. */}
              <div className="flex-1 p-4 lg:p-0">
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-card shadow-sm ring-1 ring-black/[0.02] dark:border-slate-800 dark:ring-white/[0.02]">
                  {/* Panel header (desktop only — mobile has its own above). */}
                  <div className="hidden items-center gap-2 border-b border-slate-200/80 bg-gradient-to-br from-slate-50 to-transparent px-4 py-3 dark:border-slate-800 dark:from-slate-800/40 lg:flex">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Settings2 className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold tracking-tight">{t('docMetadata')}</span>
                  </div>

                  <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                    {/* Status — segmented control */}
                    <section className="px-4 py-3.5">
                      <Label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span className={cn('h-2 w-2 rounded-full', status === 'published' ? 'bg-emerald-500' : status === 'archived' ? 'bg-amber-500' : 'bg-slate-400')} />
                        {t('status')}
                      </Label>
                      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
                        {STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatus(s)}
                            className={cn(
                              'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                              status === s
                                ? cn('shadow-sm', statusTone[s] || statusTone.draft)
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {t(`docStatus_${s}` as any)}
                          </button>
                        ))}
                      </div>
                    </section>

                    {/* Folder */}
                    {space && (
                      <section className="px-4 py-3.5">
                        <Label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          <FolderTree className="h-3.5 w-3.5" />
                          {t('docFolder')}
                        </Label>
                        <Select value={folderId ? String(folderId) : 'none'} onValueChange={(v) => setFolderId(v === 'none' ? null : Number(v))}>
                          <SelectTrigger className="h-9 rounded-lg"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('docNoFolder')}</SelectItem>
                            {folders.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </section>
                    )}

                    {/* Classification */}
                    <section className="px-4 py-3.5">
                      <Label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {t('docClassification')}
                      </Label>
                      <Input
                        value={classification}
                        onChange={(e) => setClassification(e.target.value)}
                        placeholder={t('docClassificationPlaceholder')}
                        className="h-9 rounded-lg"
                      />
                      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{t('docClassificationHelp')}</p>
                    </section>

                    {/* Tags */}
                    <section className="px-4 py-3.5">
                      <Label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Tag className="h-3.5 w-3.5" />
                        {t('tags')}
                      </Label>
                      <Input
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder={t('docTagsPlaceholder')}
                        dir="auto"
                        className="h-9 rounded-lg"
                      />
                      {tagList.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {tagList.map((tag, i) => (
                            <span
                              key={`${tag}-${i}`}
                              dir="auto"
                              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                            >
                              <Hash className="h-3 w-3 opacity-60" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Direction — segmented control */}
                    <section className="px-4 py-3.5">
                      <Label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Languages className="h-3.5 w-3.5" />
                        {t('docDirection')}
                      </Label>
                      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
                        {DIRECTIONS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDir(d)}
                            className={cn(
                              'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all',
                              dir === d
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {t(`docDir_${d}` as any)}
                          </button>
                        ))}
                      </div>
                    </section>

                    {/* Space + version footer */}
                    {space && (
                      <section className="flex items-center gap-2 bg-slate-50/60 px-4 py-3 dark:bg-slate-800/30">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200/70 text-muted-foreground dark:bg-slate-700/50">
                          <Layers className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{space.name}</p>
                          <p className="text-[11px] text-muted-foreground">{t('docSpace')} · {t('docVersion')} v{doc.current_version}</p>
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {impactOpen && (
        <DocImpactDialog doc={doc} open={impactOpen} onOpenChange={setImpactOpen} candidateMarkdown={content} />
      )}
    </div>
  );
}
