import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  FileText,
  Layers,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sanitizeHtml } from '@/lib/sanitize';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI, projectsAPI } from '@/lib/api';
import type {
  Doc,
  DocConvertEnhanceItem,
  DocConvertEnhanceResult,
  DocConvertPreviewItem,
  Project,
} from '@/types';

interface Props {
  doc: Doc;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (createdCount: number, projectId: number) => void;
}

type Mode = 'single' | 'split';
type ReqStatus = 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
type ReqPriority = 'low' | 'medium' | 'high' | 'critical';
type Override = { description_html?: string; acceptance_html?: string };

const STATUSES: ReqStatus[] = ['draft', 'reviewed', 'approved', 'implemented', 'verified', 'deprecated'];
const PRIORITIES: ReqPriority[] = ['low', 'medium', 'high', 'critical'];

export function ConvertDocDialog({ doc, open, onOpenChange, onConverted }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();

  const isGlobal = doc.project_id == null;
  const [mode, setMode] = useState<Mode>('single');
  // 0 = auto-detect the split level from the document structure.
  const [headingLevel, setHeadingLevel] = useState(0);
  const [status, setStatus] = useState<ReqStatus>('draft');
  const [priority, setPriority] = useState<ReqPriority>('medium');
  const [targetProjectId, setTargetProjectId] = useState<number | null>(doc.project_id ?? null);
  const [projects, setProjects] = useState<Project[]>([]);

  const [items, setItems] = useState<DocConvertPreviewItem[]>([]);
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // --- AI enhancement state ---
  const [aiEnabled, setAiEnabled] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhance, setEnhance] = useState<DocConvertEnhanceResult | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [extraSelected, setExtraSelected] = useState<Set<number>>(new Set());

  // Load projects for the target picker when converting a global doc.
  useEffect(() => {
    if (!open || !isGlobal) return;
    projectsAPI.getAll().then((data: any) => {
      const list: Project[] = Array.isArray(data) ? data : data?.items ?? [];
      setProjects(list);
    }).catch(() => undefined);
  }, [open, isGlobal]);

  const resetAi = useCallback(() => {
    setEnhance(null);
    setAiNotice(null);
    setOverrides({});
    setApplied(new Set());
    setExtraSelected(new Set());
  }, []);

  const loadPreview = useCallback(async () => {
    if (!open) return;
    try {
      setPreviewing(true);
      const preview = await docsAPI.previewConvert(doc.id, { mode, heading_level: headingLevel });
      setItems(preview.items);
      setTitles(Object.fromEntries(preview.items.map((i) => [i.index, i.title])));
      setExcluded(new Set());
      // Section indices change with mode/level, so any prior AI mapping is stale.
      resetAi();
    } catch {
      toast({ title: t('error'), description: t('docConvertPreviewFailed'), variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  }, [open, doc.id, mode, headingLevel, t, toast, resetAi]);

  // Load the preview when the dialog opens or its parameters change. The ref
  // keyed on the request params dedupes React 18 StrictMode's double-invoked
  // mount effect (dev), which would otherwise fire two identical preview calls;
  // real parameter changes always differ from the previous key, so they still
  // reload. Reset on close so reopening with the same params re-fetches.
  const previewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { previewKeyRef.current = null; return; }
    const key = `${doc.id}|${mode}|${headingLevel}`;
    if (previewKeyRef.current === key) return;
    previewKeyRef.current = key;
    loadPreview();
  }, [open, doc.id, mode, headingLevel, loadPreview]);

  // Run the (paid) AI review when the user turns it on, and re-run whenever the
  // preview (and thus the draft requirements) changes while it stays on.
  useEffect(() => {
    if (!aiEnabled || !open || items.length === 0) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      setEnhancing(true);
      setAiNotice(null);
      try {
        const result = await docsAPI.enhanceConvert(doc.id, { mode, heading_level: headingLevel }, controller.signal);
        if (!active) return;
        if (result.ai_available) {
          // A fresh analysis supersedes any prior staged suggestions, whose
          // section indices / gap positions no longer line up with this result.
          setOverrides({});
          setApplied(new Set());
          setExtraSelected(new Set());
          setEnhance(result);
        } else {
          setEnhance(null);
          setAiNotice(result.ai_skipped_reason || 'ai_unavailable');
        }
      } catch {
        if (active) { setEnhance(null); setAiNotice('ai_error'); }
      } finally {
        if (active) setEnhancing(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [aiEnabled, open, items, doc.id, mode, headingLevel]);

  const toggleExcluded = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const allIncluded = items.length > 0 && excluded.size === 0;
  const noneIncluded = items.length > 0 && excluded.size === items.length;
  const selectAll = () => setExcluded(new Set());
  const clearAll = () => setExcluded(new Set(items.map((i) => i.index)));

  const aiByIndex = useMemo(() => {
    const m = new Map<number, DocConvertEnhanceItem>();
    enhance?.items.forEach((i) => m.set(i.index, i));
    return m;
  }, [enhance]);

  // A suggestion is only actionable when it actually proposes a change.
  const hasSuggestion = (it: DocConvertEnhanceItem) =>
    !!(it.suggested_title || it.suggested_description_html || it.suggested_acceptance_html);

  const applySuggestion = (it: DocConvertEnhanceItem) => {
    if (!hasSuggestion(it)) return;
    if (it.suggested_title) setTitles((prev) => ({ ...prev, [it.index]: it.suggested_title }));
    setOverrides((prev) => ({
      ...prev,
      [it.index]: {
        description_html: it.suggested_description_html || prev[it.index]?.description_html,
        acceptance_html: it.suggested_acceptance_html || prev[it.index]?.acceptance_html,
      },
    }));
    setApplied((prev) => new Set(prev).add(it.index));
  };

  // Turning AI off hides its UI, so drop the staged gap additions that would
  // otherwise be created invisibly; applied per-draft edits are kept.
  const handleAiToggle = (on: boolean) => {
    setAiEnabled(on);
    if (!on) setExtraSelected(new Set());
  };

  const revertSuggestion = (index: number, originalTitle: string) => {
    setOverrides((prev) => { const n = { ...prev }; delete n[index]; return n; });
    setTitles((prev) => ({ ...prev, [index]: originalTitle }));
    setApplied((prev) => { const n = new Set(prev); n.delete(index); return n; });
  };

  const toggleExtra = (idx: number) => {
    setExtraSelected((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  };

  // In single mode the acceptance-criteria item becomes a field on the one
  // requirement, not a separate requirement — so it must not inflate the count.
  const includedPreviewCount = mode === 'single'
    ? Math.min(1, items.filter((i) => !i.is_acceptance_criteria).length)
    : items.filter((i) => !excluded.has(i.index)).length;
  const totalCount = includedPreviewCount + extraSelected.size;

  const hasBlankIncludedTitle = useMemo(() => {
    const includedItems = mode === 'single'
      ? items.filter((i) => !i.is_acceptance_criteria).slice(0, 1)
      : items.filter((i) => !excluded.has(i.index));
    return includedItems.some((item) => !(titles[item.index] ?? item.title).trim());
  }, [excluded, items, mode, titles]);

  const handleConvert = async () => {
    if (isGlobal && targetProjectId == null) {
      toast({ title: t('error'), description: t('docConvertPickProject'), variant: 'destructive' });
      return;
    }
    try {
      setSubmitting(true);
      // Only include AI-suggested extras while the AI panel is visible, and skip
      // any stale index whose suggestion is no longer present.
      const extras = (aiEnabled && enhance)
        ? [...extraSelected]
            .map((idx) => enhance.suggested_requirements[idx])
            .filter((s): s is NonNullable<typeof s> => !!s && !!s.title.trim())
            .map((s) => ({ title: s.title, description_html: s.description_html, acceptance_html: s.acceptance_html }))
        : [];
      const extra_items = extras.length > 0 ? extras : undefined;
      const result = await docsAPI.convert(doc.id, {
        mode,
        heading_level: headingLevel,
        target_project_id: targetProjectId,
        default_status: status,
        default_priority: priority,
        items: items.map((i) => ({
          index: i.index,
          title: (titles[i.index] ?? i.title).trim(),
          include: !excluded.has(i.index),
          description_html: overrides[i.index]?.description_html,
          acceptance_html: overrides[i.index]?.acceptance_html,
        })),
        extra_items,
      });
      toast({ title: t('success'), description: t('docConvertedCount', { n: result.created.length }) });
      onConverted?.(result.created.length, (targetProjectId ?? doc.project_id) as number);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docConvertFailed'), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConvert();
    }
  };

  // Map only known skip reasons to a message; anything else falls back to the
  // generic notice (avoids surfacing a raw reason code, since `t` echoes
  // unknown keys verbatim).
  const KNOWN_AI_REASONS = new Set(['ask_ai_disabled', 'ai_unavailable', 'ai_error', 'rate_limited', 'nothing_to_enhance']);
  const aiNoticeText = aiNotice
    ? (KNOWN_AI_REASONS.has(aiNotice) ? t(`docConvertAiReason_${aiNotice}` as any) : t('docConvertAiUnavailable'))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[88vh]"
        dir={isRTL ? 'rtl' : 'ltr'}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 shrink-0 text-primary" />
            {t('docConvertTitle')}
          </DialogTitle>
          <DialogDescription className="text-start">{t('docConvertDesc')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-3">
            <ModeCard
              active={mode === 'single'}
              onClick={() => setMode('single')}
              icon={<FileText className="mt-0.5 h-5 w-5 text-primary" />}
              title={t('docConvertSingle')}
              hint={t('docConvertSingleHint')}
            />
            <ModeCard
              active={mode === 'split'}
              onClick={() => setMode('split')}
              icon={<Layers className="mt-0.5 h-5 w-5 text-primary" />}
              title={t('docConvertSplit')}
              hint={t('docConvertSplitHint')}
            />
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {mode === 'split' && (
              <div className="space-y-1">
                <Label className="text-xs">{t('docConvertHeadingLevel')}</Label>
                <Select value={String(headingLevel)} onValueChange={(v) => setHeadingLevel(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('docConvertAuto')}</SelectItem>
                    <SelectItem value="1">H1</SelectItem>
                    <SelectItem value="2">H2</SelectItem>
                    <SelectItem value="3">H3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {isGlobal && (
              <div className="space-y-1">
                <Label className="text-xs">{t('docConvertTargetProject')}</Label>
                <Select value={targetProjectId ? String(targetProjectId) : ''} onValueChange={(v) => setTargetProjectId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder={t('selectProject')} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{t('status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ReqStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('priority')}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as ReqPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{t(p as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* AI review toggle */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2.5 dark:border-violet-900/50 dark:bg-violet-950/20">
            <div className="flex items-center gap-3">
              <Wand2 className="h-5 w-5 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t('docConvertAiTitle')}
                  {enhancing && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />}
                </div>
                <p className="text-xs text-muted-foreground">{t('docConvertAiSubtitle')}</p>
              </div>
              <Switch checked={aiEnabled} onCheckedChange={handleAiToggle} disabled={previewing || items.length === 0} aria-label={t('docConvertAiTitle')} />
            </div>
            {aiEnabled && enhance?.summary && (
              <p className="mt-2 rounded-md bg-white/60 px-2.5 py-1.5 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200" dir="auto">
                {enhance.summary}
              </p>
            )}
            {aiEnabled && aiNoticeText && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {aiNoticeText}
              </p>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                {t('docConvertPreview')}
                {previewing && items.length > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </span>
              <div className="flex items-center gap-2">
                {mode === 'split' && items.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <button type="button" onClick={selectAll} disabled={allIncluded} className="text-primary hover:underline disabled:opacity-40 disabled:no-underline">{t('docConvertSelectAll')}</button>
                    <span className="text-muted-foreground">·</span>
                    <button type="button" onClick={clearAll} disabled={noneIncluded} className="text-primary hover:underline disabled:opacity-40 disabled:no-underline">{t('docConvertClearAll')}</button>
                  </div>
                )}
                <Badge variant="secondary">{t('docConvertWillCreate', { n: totalCount })}</Badge>
              </div>
            </div>
            <div className={`space-y-2 p-3 transition-opacity ${previewing && items.length > 0 ? 'opacity-60' : ''}`}>
              {previewing && items.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
                </div>
              ) : items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('docConvertNothing')}</p>
              ) : (
                <>
                  {mode === 'single' && items.some((i) => i.is_acceptance_criteria) && (
                    <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-xs text-muted-foreground">{t('docConvertAcNote')}</p>
                  )}
                  {/* In single mode the acceptance preview row (index 1) mirrors any
                      suggestion applied to the main requirement (index 0). */}
                  {items.map((item) => {
                    const isExcluded = excluded.has(item.index);
                    const ai = aiEnabled ? aiByIndex.get(item.index) : undefined;
                    const isApplied = applied.has(item.index);
                    const ov = overrides[item.index];
                    const mainOverride = mode === 'single'
                      ? overrides[items.find((i) => !i.is_acceptance_criteria)?.index ?? 0]
                      : undefined;
                    const descHtml = item.is_acceptance_criteria
                      ? (mainOverride?.acceptance_html ?? item.description_html)
                      : (ov?.description_html ?? item.description_html);
                    const accHtml = ov?.acceptance_html ?? item.acceptance_html;
                    return (
                      <div key={item.index} className={`rounded-md border p-2 transition-opacity ${isExcluded ? 'opacity-50' : ''} ${isApplied ? 'border-violet-300 dark:border-violet-800' : 'border-slate-200 dark:border-slate-700'}`}>
                        <div className="flex items-center gap-2">
                          {mode === 'split' && (
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleExcluded(item.index)}
                              className="h-4 w-4 accent-primary"
                              aria-label={t('include')}
                            />
                          )}
                          <Input
                            value={titles[item.index] ?? item.title}
                            onChange={(e) => setTitles((prev) => ({ ...prev, [item.index]: e.target.value }))}
                            className="h-8 text-sm font-medium"
                            dir="auto"
                          />
                          {ai && !item.is_acceptance_criteria && <QualityBadge score={ai.quality_score} t={t} />}
                          {item.is_acceptance_criteria && <Badge variant="outline" className="shrink-0">{t('acceptanceCriteria')}</Badge>}
                        </div>
                        <div
                          className="prose prose-sm mt-1 max-h-28 max-w-none overflow-hidden px-1 text-xs text-muted-foreground dark:prose-invert"
                          dir="auto"
                          style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(descHtml) }}
                        />
                        {accHtml && !item.is_acceptance_criteria && (
                          <div className="mt-1.5 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-800/50">
                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('acceptanceCriteria')}</div>
                            <div
                              className="prose prose-sm max-h-24 max-w-none overflow-hidden text-xs text-muted-foreground dark:prose-invert"
                              dir="auto"
                              style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(accHtml) }}
                            />
                          </div>
                        )}

                        {/* AI annotations for this draft */}
                        {ai && !item.is_acceptance_criteria && (ai.issues.length > 0 || ai.edge_cases.length > 0 || hasSuggestion(ai)) && (
                          <div className="mt-2 space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2 dark:border-violet-900/50 dark:bg-violet-950/20">
                            {ai.issues.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">{t('docConvertAiIssues')}</span>
                                {ai.issues.map((iss, k) => (
                                  <Badge key={k} className="border-0 bg-amber-100 text-[10px] font-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" dir="auto">{iss}</Badge>
                                ))}
                              </div>
                            )}
                            {ai.edge_cases.length > 0 && (
                              <div>
                                <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                                  <Lightbulb className="h-3 w-3" /> {t('docConvertAiEdgeCases')}
                                </div>
                                <ul className="ms-3 list-disc space-y-0.5 text-[11px] text-muted-foreground" dir="auto">
                                  {ai.edge_cases.map((ec, k) => <li key={k}>{ec}</li>)}
                                </ul>
                              </div>
                            )}
                            {(hasSuggestion(ai) || isApplied) && (
                              <div className="flex items-center justify-end gap-2">
                                {isApplied ? (
                                  <>
                                    <span className="me-auto inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-300">
                                      <Check className="h-3.5 w-3.5" /> {t('docConvertAiApplied')}
                                    </span>
                                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => revertSuggestion(item.index, item.title)}>
                                      <RotateCcw className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {t('docConvertAiRevert')}
                                    </Button>
                                  </>
                                ) : (
                                  <Button type="button" variant="outline" size="sm" className="h-7 border-violet-300 text-xs text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300" onClick={() => applySuggestion(ai)}>
                                    <Wand2 className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {t('docConvertAiApply')}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Suggested additional requirements (gap analysis) */}
          {aiEnabled && enhance && enhance.suggested_requirements.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="flex items-center gap-2 border-b border-emerald-200 px-3 py-2 dark:border-emerald-900/50">
                <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium">{t('docConvertAiGaps')}</span>
                <Badge variant="secondary" className="ms-auto">{extraSelected.size}/{enhance.suggested_requirements.length}</Badge>
              </div>
              <div className="space-y-2 p-3">
                <p className="text-xs text-muted-foreground">{t('docConvertAiGapsHint')}</p>
                {enhance.suggested_requirements.map((sug, idx) => {
                  const checked = extraSelected.has(idx);
                  return (
                    <label key={idx} className={`flex cursor-pointer gap-2 rounded-md border p-2 transition-colors ${checked ? 'border-emerald-300 bg-white/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleExtra(idx)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium" dir="auto">{sug.title}</div>
                        {sug.rationale && <div className="text-[11px] text-emerald-700 dark:text-emerald-300" dir="auto">{sug.rationale}</div>}
                        {sug.description_html && (
                          <div
                            className="prose prose-sm mt-1 max-h-20 max-w-none overflow-hidden text-xs text-muted-foreground dark:prose-invert"
                            dir="auto"
                            style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(sug.description_html) }}
                          />
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{t('cancel')}</Button>
          <Button type="button" onClick={handleConvert} disabled={submitting || previewing || totalCount === 0 || hasBlankIncludedTitle}>
            {submitting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <ArrowRightLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
            {t('docConvertAction', { n: totalCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeCard({ active, onClick, icon, title, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-lg border p-3 text-start transition-colors ${active ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/40 dark:border-slate-700'}`}
    >
      {icon}
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function QualityBadge({ score, t }: { score: number; t: (k: any, o?: any) => string }) {
  const tone = score >= 75
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : score >= 50
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  return (
    <Badge className={`shrink-0 gap-1 border-0 tabular-nums ${tone}`} title={t('docConvertAiQuality')}>
      <Sparkles className="h-3 w-3" />{score}
    </Badge>
  );
}
