import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { diffWords } from 'diff';
import { History, RotateCcw, GitCompare, ChevronDown, Plus, Pencil, Clock, Loader2 } from 'lucide-react';
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
import { requirementsAPI } from '@/lib/api';
import type { RequirementVersion } from '@/types';

interface Props {
  requirementId: number;
  canEdit: boolean;
  onRestored?: () => void;
}

// Bidi-isolate + auto-direct user content so it never renders reversed under
// an RTL interface.
const PLAINTEXT_DIR: CSSProperties = { unicodeBidi: 'plaintext', textAlign: 'start' };

const stripHtml = (value?: string | null): string => {
  if (!value) return '';
  if (typeof window === 'undefined') return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

const timeAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const thresholds: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Number.POSITIVE_INFINITY, 'year'],
  ];
  const divisors: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
  const seconds = Math.round((Date.now() - then) / 1000);
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [limit, candidate] of thresholds) {
    if (Math.abs(seconds) < limit) { unit = candidate; break; }
  }
  try {
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(seconds / divisors[unit]), unit);
  } catch {
    return new Date(iso).toLocaleString();
  }
};

const actionMeta: Record<string, { icon: typeof Plus; tone: string }> = {
  created: { icon: Plus, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  updated: { icon: Pencil, tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  restored: { icon: RotateCcw, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
};

export function RequirementVersionHistory({ requirementId, canEdit, onRestored }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RequirementVersion | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await requirementsAPI.listVersions(requirementId);
      setVersions(data);
    } catch {
      toast({ title: t('error'), description: t('versionsLoadFailed'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [requirementId, t, toast]);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      setRestoring(true);
      await requirementsAPI.restoreVersion(requirementId, restoreTarget.id);
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

  // In compare mode, diff each version's description against the chronologically
  // previous version so the timeline reads like a changelog.
  const previousByIndex = useMemo(() => {
    const map = new Map<number, RequirementVersion>();
    versions.forEach((v, i) => {
      const prev = versions[i + 1]; // list is newest-first
      if (prev) map.set(v.id, prev);
    });
    return map;
  }, [versions]);

  const renderDiff = (from: string, to: string) => {
    const parts = diffWords(stripHtml(from), stripHtml(to));
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
                      {timeAgo(version.created_at)}
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
                      {renderDiff(prev.description || '', version.description || '')}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">{t('status')}: {version.status || '—'}</Badge>
                        <Badge variant="outline">{t('priority')}: {version.priority || '—'}</Badge>
                        {version.estimated_effort != null && <Badge variant="outline">{t('estEffort')}: {version.estimated_effort}</Badge>}
                        {version.tags && <Badge variant="outline">{version.tags}</Badge>}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">{t('title')}</p>
                        <p dir="auto" style={PLAINTEXT_DIR}>{version.title}</p>
                      </div>
                      {version.description && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">{t('description')}</p>
                          <p className="whitespace-pre-wrap text-muted-foreground" dir="auto" style={PLAINTEXT_DIR}>{stripHtml(version.description).slice(0, 1200)}</p>
                        </div>
                      )}
                      {version.acceptance_criteria && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">{t('acceptanceCriteria')}</p>
                          <p className="whitespace-pre-wrap text-muted-foreground" dir="auto" style={PLAINTEXT_DIR}>{stripHtml(version.acceptance_criteria).slice(0, 1200)}</p>
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
    </section>
  );
}
