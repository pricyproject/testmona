import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { diffWords } from 'diff';
import { History, RotateCcw, GitCompare, ChevronDown, Plus, Pencil, Clock, Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
};

export function DocVersionHistory({ docId, canEdit, canClear = false, onRestored, defaultCompare = false }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(defaultCompare);
  const [restoreTarget, setRestoreTarget] = useState<DocVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

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

  const previousByIndex = useMemo(() => {
    const map = new Map<number, DocVersion>();
    versions.forEach((v, i) => {
      const prev = versions[i + 1]; // newest-first
      if (prev) map.set(v.id, prev);
    });
    return map;
  }, [versions]);

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

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold">{t('versionHistory')}</h2>
          {!loading && <Badge variant="secondary">{versions.length}</Badge>}
        </div>
        <div className="flex items-center gap-2">
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
            const prev = previousByIndex.get(version.id);
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

                  {compareMode && prev && (
                    <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/60">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t('changesFromVersion', { n: prev.version_number })}
                      </p>
                      {renderDiff(prev.content_markdown || '', version.content_markdown || '')}
                    </div>
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
