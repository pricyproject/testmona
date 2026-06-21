import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { diffWords } from 'diff';
import { History, RotateCcw, GitCompare, ChevronDown, Plus, Pencil, Clock, Loader2, CheckCircle2, Trash2, Bookmark, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { docsAPI } from '@/lib/api';
import { formatRelativeTime, formatServerDateTime } from '@/utils/datetime';
import type { DocVersion } from '@/types';

interface Props {
  docId: number;
  canEdit: boolean;
  canClear?: boolean;
  onRestored?: () => void;
  /** Open in compare/diff mode (used when arriving from a watch notification). */
  defaultCompare?: boolean;
}

const PLAINTEXT_DIR: CSSProperties = { unicodeBidi: 'plaintext', textAlign: 'start' };

// Flatten Markdown/HTML to readable plain text so version diffs and previews
// don't show raw `<table>` markup or `| --- |` table scaffolding.
const toPlainText = (value?: string | null): string =>
  (value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/[#*_`>~[\]()!]|https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const actionMeta: Record<string, { icon: typeof Plus; tone: string }> = {
  created: { icon: Plus, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  updated: { icon: Pencil, tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  restored: { icon: RotateCcw, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  published: { icon: CheckCircle2, tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  snapshot: { icon: Bookmark, tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
};

export function DocVersionHistory({ docId, canEdit, canClear = false, onRestored, defaultCompare = false }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(defaultCompare);
  // Selected endpoints (version ids) for the compare panel: `from` is the older
  // baseline, `to` the newer target.
  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DocVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await docsAPI.listVersions(docId);
      setVersions(data);
    } catch {
      toast({ title: t('error'), description: t('versionsLoadFailed'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [docId, t, toast]);

  useEffect(() => { load(); }, [load]);

  // Default the compare endpoints to "previous → latest" whenever compare opens
  // or the chosen versions disappear (e.g. after a restore reloads the list).
  useEffect(() => {
    if (!compareMode || versions.length < 2) return;
    const ids = new Set(versions.map((v) => v.id));
    if (compareTo === null || !ids.has(compareTo)) setCompareTo(versions[0].id);
    if (compareFrom === null || !ids.has(compareFrom)) setCompareFrom(versions[1].id);
  }, [compareMode, versions, compareFrom, compareTo]);

  const handleCreate = async () => {
    try {
      setCreating(true);
      await docsAPI.createVersion(docId, { name: newName.trim() || null, change_note: newNote.trim() || null });
      toast({ title: t('success'), description: t('docRevisionCreated') });
      setCreateOpen(false);
      setNewName('');
      setNewNote('');
      await load();
      onRestored?.();
    } catch {
      toast({ title: t('error'), description: t('docRevisionCreateFailed'), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleClear = async () => {
    try {
      setClearing(true);
      await docsAPI.clearVersions(docId);
      toast({ title: t('success'), description: t('docRevisionsCleared') });
      setClearOpen(false);
      await load();
      onRestored?.();
    } catch {
      toast({ title: t('error'), description: t('docRevisionsClearFailed'), variant: 'destructive' });
    } finally {
      setClearing(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      setRestoring(true);
      await docsAPI.restoreVersion(docId, restoreTarget.id);
      toast({ title: t('success'), description: t('versionRestored', { n: restoreTarget.version_number }) });
      setRestoreTarget(null);
      await load();
      onRestored?.();
    } catch {
      toast({ title: t('error'), description: t('versionRestoreFailed'), variant: 'destructive' });
    } finally {
      setRestoring(false);
    }
  };

  const fromVersion = useMemo(() => versions.find((v) => v.id === compareFrom) ?? null, [versions, compareFrom]);
  const toVersion = useMemo(() => versions.find((v) => v.id === compareTo) ?? null, [versions, compareTo]);

  const renderDiff = (from: string, to: string) => {
    const parts = diffWords(toPlainText(from), toPlainText(to));
    if (parts.every((p) => !p.added && !p.removed)) {
      return <p className="text-xs italic text-muted-foreground">{t('noTextChanges')}</p>;
    }
    return (
      <p className="text-sm leading-relaxed" dir="auto" style={PLAINTEXT_DIR}>
        {parts.map((part, i) => (
          <span
            key={i}
            className={
              part.added
                ? 'rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                : part.removed
                  ? 'rounded bg-rose-100 text-rose-800 line-through dark:bg-rose-900/40 dark:text-rose-200'
                  : ''
            }
          >
            {part.value}
          </span>
        ))}
      </p>
    );
  };

  // A single-line field diff (title/status/classification/tags): unchanged shows
  // one value, changed shows old → new.
  const renderFieldDiff = (label: string, from?: string | null, to?: string | null) => {
    const a = (from || '').trim();
    const b = (to || '').trim();
    if (a === b) {
      if (!b) return null;
      return (
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          <span dir="auto" style={PLAINTEXT_DIR}>{b}</span>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="rounded bg-rose-100 px-1 text-rose-800 line-through dark:bg-rose-900/40 dark:text-rose-200" dir="auto" style={PLAINTEXT_DIR}>{a || '—'}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" dir="auto" style={PLAINTEXT_DIR}>{b || '—'}</span>
      </div>
    );
  };

  const versionLabel = (v: DocVersion) =>
    `v${v.version_number} · ${t(`versionAction_${v.action}` as any)}${v.name ? ` · ${v.name}` : ''}`;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold">{t('versionHistory')}</h2>
          {!loading && <Badge variant="secondary">{versions.length}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Bookmark className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('docCreateRevision')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={compareMode ? 'default' : 'outline'}
            onClick={() => setCompareMode((v) => !v)}
            disabled={versions.length < 2}
          >
            <GitCompare className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('compareChanges')}
          </Button>
          {canClear && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-rose-600 hover:text-rose-700"
              onClick={() => setClearOpen(true)}
              disabled={versions.length <= 1}
              title={t('docClearRevisions')}
            >
              <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('docClearRevisions')}
            </Button>
          )}
        </div>
      </div>

      {compareMode && versions.length >= 2 && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">{t('compareBase')}</Label>
              <select
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={compareFrom ?? ''}
                onChange={(e) => setCompareFrom(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>{versionLabel(v)}</option>
                ))}
              </select>
            </div>
            <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">{t('compareTarget')}</Label>
              <select
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={compareTo ?? ''}
                onChange={(e) => setCompareTo(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>{versionLabel(v)}</option>
                ))}
              </select>
            </div>
          </div>

          {fromVersion && toVersion && (
            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              {renderFieldDiff(t('title'), fromVersion.title, toVersion.title)}
              {renderFieldDiff(t('status'), fromVersion.status, toVersion.status)}
              {renderFieldDiff(t('docClassification'), fromVersion.classification, toVersion.classification)}
              {renderFieldDiff(t('tags'), fromVersion.tags, toVersion.tags)}
              <div className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/60">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('docContent')}</p>
                {renderDiff(fromVersion.content_markdown || '', toVersion.content_markdown || '')}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      ) : versions.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('noVersionsYet')}</p>
      ) : (
        <ol className="relative space-y-3">
          <span className="absolute bottom-2 top-2 hidden w-px bg-slate-200 dark:bg-slate-700 sm:block" style={{ insetInlineStart: '11px' }} aria-hidden />
          {versions.map((version, index) => {
            const meta = actionMeta[version.action] || actionMeta.updated;
            const Icon = meta.icon;
            const isExpanded = expandedId === version.id;
            const isLatest = index === 0;
            return (
              <li key={version.id} className="relative sm:ps-8">
                <span className={`absolute top-1.5 hidden h-6 w-6 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-900 sm:flex ${meta.tone}`} style={{ insetInlineStart: 0 }}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : version.id)}
                      className="flex items-center gap-1.5 text-sm font-semibold"
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      v{version.version_number}
                    </button>
                    <Badge className={`${meta.tone} border-0`}>{t(`versionAction_${version.action}` as any)}</Badge>
                    {version.name && (
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 dark:text-indigo-300">
                        <Bookmark className="h-3.5 w-3.5" />
                        <span dir="auto" style={PLAINTEXT_DIR}>{version.name}</span>
                      </span>
                    )}
                    {isLatest && <Badge variant="outline">{t('current')}</Badge>}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <time dateTime={version.created_at} title={formatServerDateTime(version.created_at)}>
                        {formatServerDateTime(version.created_at)} · {formatRelativeTime(version.created_at)}
                      </time>
                    </span>
                    {version.author && (
                      <span className="text-xs text-muted-foreground">· {version.author.full_name || version.author.username}</span>
                    )}
                    <span className="flex-1" />
                    {canEdit && !isLatest && (
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setRestoreTarget(version)}>
                        <RotateCcw className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                        {t('restore')}
                      </Button>
                    )}
                  </div>

                  {version.change_note && (
                    <p className="mt-1 text-xs italic text-muted-foreground">{version.change_note}</p>
                  )}

                  {isExpanded && (
                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">{t('status')}: {version.status || '—'}</Badge>
                        {version.classification && <Badge variant="outline">{version.classification}</Badge>}
                        {version.tags && <Badge variant="outline">{version.tags}</Badge>}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">{t('title')}</p>
                        <p dir="auto" style={PLAINTEXT_DIR}>{version.title}</p>
                      </div>
                      {version.content_markdown && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">{t('docContent')}</p>
                          <p className="whitespace-pre-wrap text-muted-foreground" dir="auto" style={PLAINTEXT_DIR}>{toPlainText(version.content_markdown).slice(0, 1500)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('docCreateRevision')}</DialogTitle>
            <DialogDescription>{t('docCreateRevisionDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="revision-name">{t('docRevisionName')}</Label>
              <Input
                id="revision-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('docRevisionNamePlaceholder')}
                maxLength={200}
                dir="auto"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="revision-note">{t('docChangeNote')}</Label>
              <Textarea
                id="revision-note"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={t('docChangeNotePlaceholder')}
                maxLength={500}
                rows={3}
                dir="auto"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>{t('cancel')}</Button>
            <Button type="button" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Bookmark className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('docCreateRevision')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={restoreTarget !== null} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('restoreVersionTitle', { n: restoreTarget?.version_number ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('restoreVersionDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleRestore(); }} disabled={restoring}>
              {restoring ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <RotateCcw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('restore')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={(open) => !open && setClearOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('docClearRevisionsTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('docClearRevisionsDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleClear(); }} disabled={clearing} className="bg-rose-600 hover:bg-rose-700">
              {clearing ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('docClearRevisions')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
