import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Cloud,
  Eye,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { parsePositiveIntegerParam } from '@/utils/validation';
import type { Doc, DocDir, DocFolder, DocListItem, DocSpace, DocStatus } from '@/types';

const STATUSES: DocStatus[] = ['draft', 'published', 'archived'];
const DIRECTIONS: DocDir[] = ['auto', 'ltr', 'rtl'];
// Periodic autosave cadence: flush unsaved changes every 4 minutes (manual Save,
// unmount-flush and a beforeunload guard cover the gaps between ticks).
const AUTOSAVE_MS = 4 * 60 * 1000;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function DocEditor() {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { docId, projectId } = useParams<{ docId: string; projectId?: string }>();
  const parsedDocId = parsePositiveIntegerParam(docId);
  const parsedProjectId = parsePositiveIntegerParam(projectId);
  const basePath = parsedProjectId ? `/projects/${parsedProjectId}/docs` : '/docs';

  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [space, setSpace] = useState<DocSpace | null>(null);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [spaceDocs, setSpaceDocs] = useState<DocListItem[]>([]);
  const [members, setMembers] = useState<Array<{ user_id: number; username: string; full_name?: string | null }>>([]);
  const [showMeta, setShowMeta] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
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

  const currentSnapshot = useMemo(
    () => JSON.stringify({ title, content, status, classification, tags, dir, folderId }),
    [title, content, status, classification, tags, dir, folderId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
          navigate(`${basePath}/${data.id}`, { replace: true });
          return;
        }
        setDoc(data);
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
  }, [parsedDocId, basePath, navigate, t, toast]);

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
    if (!title.trim()) { setSaveState('error'); return; }
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

  const saveIndicator = () => {
    switch (saveState) {
      case 'saving': return <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('docSaving')}</span>;
      case 'saved': return <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{t('docSaved')}</span>;
      case 'dirty': return <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Cloud className="h-3.5 w-3.5" />{t('docUnsaved')}</span>;
      case 'error': return <span className="text-rose-600 dark:text-rose-400">{t('docSaveFailed')}</span>;
      default: return null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`${basePath}/${doc.id}`)}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('back')}
        </Button>
        <div className="text-xs">{saveIndicator()}</div>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => navigate(`${basePath}/${doc.id}`)}>
          <Eye className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
          {t('docReadingView')}
        </Button>
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
          {showMeta ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </div>

      <div className={`grid gap-6 ${showMeta ? 'lg:grid-cols-[1fr_300px]' : 'grid-cols-1'}`}>
        {/* Writing column */}
        <div className="min-w-0">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('docTitlePlaceholder')}
            dir="auto"
            className="mb-4 border-0 px-0 text-3xl font-bold shadow-none focus-visible:ring-0"
            style={{ height: 'auto' }}
          />
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
              ...spaceDocs.map((item) => ({ id: `doc:${item.id}`, label: item.title, href: `${basePath}/${item.id}`, group: 'links' as const })),
              ...folders.map((folder) => ({ id: `folder:${folder.id}`, label: folder.name, href: `${basePath}?folder=${folder.id}`, group: 'links' as const })),
            ]}
          />
        </div>

        {/* Metadata panel */}
        {showMeta && (
          <aside className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                {t('docMetadata')}
              </h3>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('status')}</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as DocStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`docStatus_${s}` as any)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {space && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t('docFolder')}</Label>
                    <Select value={folderId ? String(folderId) : 'none'} onValueChange={(v) => setFolderId(v === 'none' ? null : Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('docNoFolder')}</SelectItem>
                        {folders.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">{t('docClassification')}</Label>
                  <Input value={classification} onChange={(e) => setClassification(e.target.value)} placeholder={t('docClassificationPlaceholder')} />
                  <p className="text-[11px] text-muted-foreground">{t('docClassificationHelp')}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('tags')}</Label>
                  <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('docTagsPlaceholder')} dir="auto" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('docDirection')}</Label>
                  <Select value={dir} onValueChange={(v) => setDir(v as DocDir)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{t(`docDir_${d}` as any)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {space && (
              <div className="rounded-lg border border-slate-200 p-4 text-xs text-muted-foreground dark:border-slate-800">
                <p>{t('docSpace')}: <span className="font-medium text-foreground">{space.name}</span></p>
                <p className="mt-1">{t('docVersion')}: v{doc.current_version}</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {impactOpen && (
        <DocImpactDialog doc={doc} open={impactOpen} onOpenChange={setImpactOpen} candidateMarkdown={content} />
      )}
    </div>
  );
}
