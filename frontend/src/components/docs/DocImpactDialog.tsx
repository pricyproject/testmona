import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  FileText,
  FlaskConical,
  Link2,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI } from '@/lib/api';
import type { Doc, DocImpactAnalysis, DocImpactItem, DocImpactRisk } from '@/types';

type TFn = ReturnType<typeof useTranslation>['t'];

interface Props {
  doc: Doc;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unsaved editor markdown — when provided, the live draft is analyzed. */
  candidateMarkdown?: string;
}

const severityTone: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  critical: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

const recommendationBanner: Record<string, string> = {
  publish: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
  review: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200',
  hold: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200',
};

function recommendationIcon(rec: string) {
  if (rec === 'publish') return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (rec === 'hold') return <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />;
  return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />;
}

export function DocImpactDialog({ doc, open, onOpenChange, candidateMarkdown }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<DocImpactAnalysis | null>(null);
  // Bumping this re-triggers the analysis effect (the "Re-analyze" button).
  const [reloadKey, setReloadKey] = useState(0);

  // Analyze whenever the dialog opens (or the user re-analyzes). Closing the
  // dialog aborts an in-flight request so a long AI call doesn't keep running
  // (and spending tokens) after the user has moved on; the `active` guard keeps
  // a cancelled request from flashing an error toast or stale state.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      setLoading(true);
      setAnalysis(null);
      try {
        const result = await docsAPI.analyzeImpact(
          doc.id, { candidate_markdown: candidateMarkdown, include_ai: true }, controller.signal,
        );
        if (active) setAnalysis(result);
      } catch {
        if (active) {
          toast({ title: t('docImpactError'), variant: 'destructive' });
          onOpenChange(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [open, reloadKey, doc.id, candidateMarkdown, t, toast, onOpenChange]);

  const linkFor = (item: DocImpactItem): string | null => {
    const pid = analysis?.project_id;
    if (!pid) return null;
    if (item.type === 'requirement') return `/projects/${pid}/requirements/${item.id}`;
    if (item.type === 'test_case') return `/projects/${pid}/test-cases/${item.id}`;
    if (item.type === 'defect') return `/projects/${pid}/defects/${item.id}`;
    return null;
  };

  const goTo = (item: DocImpactItem) => {
    const href = linkFor(item);
    if (href) {
      onOpenChange(false);
      navigate(href);
    }
  };

  const renderItems = (
    title: string,
    Icon: typeof FileText,
    items: DocImpactItem[],
    withSeverity = false,
    showScore = false,
  ) => (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800 sm:px-4">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="secondary" className="ms-auto">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">{t('docImpactNone')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item) => {
            const clickable = !!linkFor(item);
            return (
              <li key={`${item.type}-${item.id}`}>
                <button
                  type="button"
                  onClick={() => goTo(item)}
                  disabled={!clickable}
                  className="group flex w-full flex-col gap-1.5 px-3 py-2.5 text-start hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800/50 sm:flex-row sm:items-center sm:gap-3 sm:px-4"
                >
                  {/* Identity line: key + title (always full width on mobile) */}
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm group-disabled:opacity-100" dir="auto">
                      {item.title || t('docImpactUntitled')}
                    </span>
                  </div>
                  {/* Meta line: chips wrap below on mobile, sit inline on sm+ */}
                  <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
                    {item.via && item.via.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {t('docImpactVia')} <span className="font-mono">{item.via.join(', ')}</span>
                      </span>
                    )}
                    {showScore && item.score > 0 && <MatchStrength score={item.score} />}
                    {withSeverity && item.severity && (
                      <Badge className={`border-0 ${severityTone[item.severity] || severityTone.low}`}>
                        {item.severity}
                      </Badge>
                    )}
                    {withSeverity && item.is_open && (
                      <Badge variant="outline" className="text-rose-600">{t('docImpactOpen')}</Badge>
                    )}
                    <ReasonBadge reason={item.reason} t={t} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const renderRisk = (risk: DocImpactRisk, index: number) => (
    <div key={index} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`border-0 ${severityTone[risk.severity] || severityTone.medium}`}>{risk.severity}</Badge>
        <span className="min-w-0 flex-1 text-sm font-medium" dir="auto">{risk.title}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">{t(`docImpactArea_${risk.area}` as any)}</Badge>
      </div>
      {risk.detail && <p className="mt-1.5 text-xs text-muted-foreground" dir="auto">{risk.detail}</p>}
      {risk.mitigation && (
        <p className="mt-1 text-xs" dir="auto">
          <span className="font-medium">{t('docImpactMitigation')}: </span>
          {risk.mitigation}
        </p>
      )}
    </div>
  );

  const signals = analysis?.risk_signals;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh]" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader className="border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0 text-violet-500" />
            {t('docImpactTitle')}
          </DialogTitle>
          <DialogDescription className="text-start">{t('docImpactSubtitle')}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">{t('docImpactLoading')}</p>
          </div>
        )}

        {!loading && analysis && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            {/* Change summary */}
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/50">
              <p className="text-muted-foreground" dir="auto">{analysis.change_summary.note}</p>
              {analysis.change_summary.changed && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {analysis.change_summary.headings_added.map((h) => (
                    <Badge key={`a-${h}`} className="max-w-full truncate border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">+ {h}</Badge>
                  ))}
                  {analysis.change_summary.headings_removed.map((h) => (
                    <Badge key={`r-${h}`} className="max-w-full truncate border-0 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">− {h}</Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Recommendation banner — the headline takeaway, made prominent */}
            {analysis.ai_available && analysis.recommendation && (
              <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${recommendationBanner[analysis.recommendation] || ''}`}>
                {recommendationIcon(analysis.recommendation)}
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{t(`docImpactRec_${analysis.recommendation}` as any)}</div>
                  {analysis.ai_summary && <p className="mt-0.5 text-xs opacity-90" dir="auto">{analysis.ai_summary}</p>}
                </div>
              </div>
            )}

            {/* Risk signals strip */}
            {signals && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SignalStat label={t('docImpactRequirements')} value={signals.impacted_requirements} />
                <SignalStat label={t('docImpactTests')} value={signals.impacted_test_cases} />
                <SignalStat label={t('docImpactDefects')} value={signals.impacted_defects} />
                <SignalStat label={t('docImpactOpenDefects')} value={signals.open_defects} alert={signals.open_defects > 0} />
              </div>
            )}

            {/* AI risk detail (summary shown in the banner above) */}
            {analysis.ai_available ? (
              analysis.risks.length > 0 && (
                <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900/50 dark:bg-violet-950/20 sm:p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-violet-500" />
                    <h3 className="text-sm font-semibold">{t('docImpactRisks')}</h3>
                  </div>
                  <div className="space-y-2">{analysis.risks.map(renderRisk)}</div>
                </div>
              )
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-xs text-muted-foreground dark:border-slate-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{analysis.ai_skipped_reason === 'no_changes' ? t('docImpactNoChanges') : t('docImpactNoAI')}</span>
              </div>
            )}

            {/* Impacted items */}
            {renderItems(t('docImpactRequirements'), FileText, analysis.requirements, false, true)}
            {renderItems(t('docImpactTests'), FlaskConical, analysis.test_cases)}
            {renderItems(t('docImpactDefects'), Bug, analysis.defects, true)}

            {/* Legend explaining match confidence */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />{t('docImpactLegendLinked')}</span>
              <span className="inline-flex items-center gap-1"><Search className="h-3 w-3" />{t('docImpactLegendSimilar')}</span>
            </div>
          </div>
        )}

        {!loading && analysis && (
          <DialogFooter className="border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-6">
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
              {t('docImpactReanalyze')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReasonBadge({ reason, t }: { reason: string; t: TFn }) {
  const linked = reason === 'linked';
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] ${
        linked
          ? 'border-sky-200 text-sky-700 dark:border-sky-900/60 dark:text-sky-300'
          : 'border-slate-200 text-muted-foreground dark:border-slate-700'
      }`}
    >
      {linked ? <Link2 className="h-3 w-3" /> : <Search className="h-3 w-3" />}
      {linked ? t('docImpactReasonLinked') : t('docImpactReasonSimilar')}
    </Badge>
  );
}

function MatchStrength({ score }: { score: number }) {
  // Cosine similarity (0–1) → a compact confidence chip + bar, so the reader can
  // gauge how strong a "similar" match is at a glance.
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const tone = pct >= 50 ? 'bg-sky-500' : pct >= 25 ? 'bg-sky-400' : 'bg-slate-300 dark:bg-slate-600';
  return (
    <span className="inline-flex items-center gap-1" title={`${pct}%`}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
    </span>
  );
}

function SignalStat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${alert ? 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className={`text-lg font-semibold ${alert ? 'text-rose-600 dark:text-rose-400' : ''}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
