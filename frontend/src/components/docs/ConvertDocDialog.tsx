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
import { formatGherkin, isGherkinText, lintGherkin } from '@/components/requirements/gherkin';
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
const KNOWN_HTML_TAGS = 'a|abbr|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|img|ins|kbd|li|ol|p|pre|s|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul';
const KNOWN_HTML_TAG_RE = new RegExp(`</?(?:${KNOWN_HTML_TAGS})(?:\\s[^>]*)?/?>`, 'gi');

const decodeEntities = (value: string): string => {
  if (typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
};

const htmlToText = (value?: string | null): string => {
  if (!value) return '';
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|pre)\s*>/gi, '\n')
    .replace(KNOWN_HTML_TAG_RE, ' ');
  return decodeEntities(withBreaks)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const gherkinToHtml = (value: string): string => `<pre><code class="language-gherkin">${escapeHtml(value)}</code></pre>`;

const stripListMarker = (value: string): string => value.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim();

const stripCodeFence = (value: string): string => value
  .replace(/^```(?:gherkin|feature)?\s*/i, '')
  .replace(/```$/i, '')
  .trim();

const LOCALIZED_GHERKIN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/^\s*(ویژگی|قابلیت)\s*[:：]\s*/i, 'Feature: '],
  [/^\s*(خاصية|ميزة|الميزة)\s*[:：]\s*/i, 'Feature: '],
  [/^\s*(سناریو|سيناريو)\s*[:：]\s*/i, 'Scenario: '],
  [/^\s*(طرح سناریو|مخطط السيناريو)\s*[:：]\s*/i, 'Scenario Outline: '],
  [/^\s*(پیش‌زمینه|پیش زمینه|الخلفية|خلفية)\s*[:：]\s*/i, 'Background: '],
  [/^\s*(با فرض|فرض|بفرض)\s+/i, 'Given '],
  [/^\s*(وقتی|زمانی که|هنگامی که|عندما|متى)\s+/i, 'When '],
  [/^\s*(آنگاه|سپس|إذن|اذاً|عندئذ)\s+/i, 'Then '],
  [/^\s*(اما|ولی|لكن)\s+/i, 'But '],
  [/^\s*(و)\s+/i, 'And '],
];

const normalizeLocalizedGherkinKeywords = (value: string): string => value
  .split('\n')
  .map((line) => {
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);
    for (const [pattern, replacement] of LOCALIZED_GHERKIN_REPLACEMENTS) {
      if (pattern.test(trimmed)) return indent + trimmed.replace(pattern, replacement);
    }
    return line;
  })
  .join('\n');

const isFeatureStyleGherkin = (value?: string | null): boolean => {
  const text = htmlToText(value);
  return hasFeatureStyleGherkinText(text);
};

const hasFeatureStyleGherkinText = (text: string): boolean =>
  Boolean(
    text
    && /^\s*Feature:/im.test(text)
    && /^\s*(Scenario|Scenario Outline|Background):/im.test(text)
    && /^\s*Given\b/im.test(text)
    && /^\s*When\b/im.test(text)
    && /^\s*Then\b/im.test(text),
  );

const extractPlainCriteria = (value: string): string[] => value
  .split('\n')
  .map(stripListMarker)
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter((line) => line && !/^acceptance criteria:?$/i.test(line))
  .slice(0, 12);

const gherkinHasOnlyRepairableIssues = (value: string): boolean => {
  const issues = lintGherkin(value);
  return issues.every((issue) => issue.code !== 'stepOutsideScenario');
};

const repairGherkinText = (rawValue: string, title: string, fallbackHtml?: string | null): string | null => {
  let text = normalizeLocalizedGherkinKeywords(rawValue).trim();
  if (!isGherkinText(text)) return null;

  const safeTitle = title || 'Requirement';
  const lines = text.split('\n');
  const repaired: string[] = [];
  let featureSeen = false;
  let blockOpen = false;
  let blockStart = -1;
  let hasGiven = false;
  let hasWhen = false;
  let hasThen = false;
  let currentBlockIsOutline = false;
  let currentBlockHasExamples = false;

  const finishBlock = () => {
    if (!blockOpen || blockStart < 0) return;
    if (currentBlockIsOutline && !currentBlockHasExamples) {
      repaired[blockStart] = repaired[blockStart].replace(/Scenario Outline:/i, 'Scenario:');
      for (let i = blockStart + 1; i < repaired.length; i += 1) {
        repaired[i] = repaired[i].replace(/<([^<>]+)>/g, '$1');
      }
    }
    if (!hasGiven) repaired.splice(blockStart + 1, 0, `    Given ${safeTitle} is in scope`);
    if (!hasWhen) repaired.push('    When the requirement behavior is exercised');
    if (!hasThen) {
      const criteria = extractPlainCriteria(htmlToText(fallbackHtml));
      repaired.push(`    Then ${criteria[0] || `${safeTitle} is satisfied`}`);
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      repaired.push('');
      continue;
    }
    if (/^Feature:/i.test(trimmed)) {
      if (featureSeen) continue;
      finishBlock();
      featureSeen = true;
      blockOpen = false;
      repaired.push(trimmed || `Feature: ${safeTitle}`);
      continue;
    }
    if (/^Rule:/i.test(trimmed)) {
      finishBlock();
      blockOpen = false;
      repaired.push(trimmed);
      continue;
    }
    if (/^(Background|Scenario Outline|Scenario|Example):/i.test(trimmed)) {
      finishBlock();
      blockOpen = true;
      blockStart = repaired.length;
      hasGiven = false;
      hasWhen = false;
      hasThen = false;
      currentBlockIsOutline = /^Scenario Outline:/i.test(trimmed);
      currentBlockHasExamples = false;
      repaired.push(trimmed);
      continue;
    }
    if (/^Examples:/i.test(trimmed)) {
      currentBlockHasExamples = true;
      repaired.push(trimmed);
      continue;
    }
    if (/^(Given|When|Then|And|But|\*)\b/i.test(trimmed)) {
      if (!blockOpen) {
        blockOpen = true;
        blockStart = repaired.length;
        hasGiven = false;
        hasWhen = false;
        hasThen = false;
        currentBlockIsOutline = false;
        currentBlockHasExamples = false;
        repaired.push(`Scenario: ${safeTitle}`);
      }
      let stepLine = trimmed;
      if (!hasGiven && /^(And|But)\b/i.test(stepLine)) stepLine = stepLine.replace(/^(And|But)\b/i, 'Given');
      hasGiven = hasGiven || /^Given\b/i.test(stepLine);
      hasWhen = hasWhen || /^When\b/i.test(stepLine);
      hasThen = hasThen || /^Then\b/i.test(stepLine);
      repaired.push(stepLine);
      continue;
    }
    repaired.push(trimmed);
  }
  finishBlock();
  if (!featureSeen) repaired.unshift(`Feature: ${safeTitle}`, '');
  text = formatGherkin(repaired.join('\n'));
  return hasFeatureStyleGherkinText(text) && gherkinHasOnlyRepairableIssues(text) ? text : null;
};

const proseCriteriaToFeature = (title: string, sourceText: string, fallbackHtml?: string | null): string => {
  const safeTitle = (title || 'Requirement').trim() || 'Requirement';
  const criteria = extractPlainCriteria(sourceText || htmlToText(fallbackHtml));
  const scenarios = (criteria.length ? criteria : [`${safeTitle} is satisfied`]).map((criterion, index) => [
    `  Scenario: ${criteria.length > 1 ? `${safeTitle} - criterion ${index + 1}` : safeTitle}`,
    `    Given ${safeTitle} is in scope`,
    '    When the requirement behavior is exercised',
    `    Then ${criterion}`,
  ].join('\n'));
  return formatGherkin([`Feature: ${safeTitle}`, '', ...scenarios].join('\n\n'));
};

const normalizeToFeatureGherkin = (title: string, acceptanceHtml?: string | null, fallbackHtml?: string | null): string => {
  const safeTitle = (title || 'Requirement').trim() || 'Requirement';
  const sourceText = stripCodeFence(htmlToText(acceptanceHtml) || htmlToText(fallbackHtml));
  return repairGherkinText(sourceText, safeTitle, fallbackHtml) ?? proseCriteriaToFeature(safeTitle, sourceText, fallbackHtml);
};

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
  const [extraAcceptanceOverrides, setExtraAcceptanceOverrides] = useState<Record<number, string>>({});

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
    setExtraAcceptanceOverrides({});
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
      setItems([]);
      setTitles({});
      setExcluded(new Set());
      resetAi();
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

  const reviewItems = useMemo(() => items.map((item) => ({
    index: item.index,
    title: (titles[item.index] ?? item.title).trim(),
    include: !excluded.has(item.index),
    description_html: overrides[item.index]?.description_html,
    acceptance_html: overrides[item.index]?.acceptance_html,
  })), [excluded, items, overrides, titles]);
  const reviewItemsRef = useRef(reviewItems);
  useEffect(() => { reviewItemsRef.current = reviewItems; }, [reviewItems]);

  // Run the (paid) AI review when the user turns it on, and re-run for structural
  // preview changes. The latest edited draft is read from a ref to avoid re-running
  // on every title edit or accepted suggestion.
  useEffect(() => {
    if (!aiEnabled || !open || items.length === 0) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      setEnhancing(true);
      setAiNotice(null);
      try {
        const result = await docsAPI.enhanceConvert(doc.id, { mode, heading_level: headingLevel, items: reviewItemsRef.current }, controller.signal);
        if (!active) return;
        if (result.ai_available) {
          // A fresh analysis supersedes any prior staged suggestions, whose
          // section indices / gap positions no longer line up with this result.
          setOverrides({});
          setApplied(new Set());
          setExtraSelected(new Set());
          setExtraAcceptanceOverrides({});
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
  }, [aiEnabled, open, items.length, doc.id, mode, headingLevel]);

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
    if (!on) {
      setExtraSelected(new Set());
      setExtraAcceptanceOverrides({});
    }
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

  const normalizeExtraAcceptance = (idx: number) => {
    const sug = enhance?.suggested_requirements[idx];
    if (!sug) return;
    setExtraAcceptanceOverrides((prev) => ({
      ...prev,
      [idx]: gherkinToHtml(normalizeToFeatureGherkin(sug.title, prev[idx] ?? sug.acceptance_html, sug.description_html)),
    }));
  };

  const normalizeAllExtras = () => {
    if (!enhance) return;
    setExtraAcceptanceOverrides((prev) => {
      const next = { ...prev };
      enhance.suggested_requirements.forEach((sug, idx) => {
        if (!sug) return;
        const current = next[idx] ?? sug.acceptance_html;
        if (!isFeatureStyleGherkin(current)) {
          next[idx] = gherkinToHtml(normalizeToFeatureGherkin(sug.title, current, sug.description_html));
        }
      });
      return next;
    });
  };

  const extrasNeedingGherkin = useMemo(() => {
    if (!enhance) return 0;
    return enhance.suggested_requirements.filter((sug, idx) =>
      !isFeatureStyleGherkin(extraAcceptanceOverrides[idx] ?? sug.acceptance_html)
    ).length;
  }, [enhance, extraAcceptanceOverrides]);

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

  const normalizedAcceptanceForItem = (item: DocConvertPreviewItem): string | undefined => {
    if (item.is_acceptance_criteria) return overrides[item.index]?.acceptance_html;
    const title = (titles[item.index] ?? item.title).trim() || item.title;
    const acSection = mode === 'single' ? items.find((candidate) => candidate.is_acceptance_criteria) : undefined;
    const baseAcceptance = overrides[item.index]?.acceptance_html
      ?? item.acceptance_html
      ?? (acSection ? overrides[acSection.index]?.description_html ?? acSection.description_html : undefined);
    const fallback = overrides[item.index]?.description_html ?? item.description_html;
    return gherkinToHtml(normalizeToFeatureGherkin(title, baseAcceptance, fallback));
  };

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
            .map((idx) => ({ suggestion: enhance.suggested_requirements[idx], idx }))
            .filter(({ suggestion }) => !!suggestion && !!suggestion.title.trim())
            .map(({ suggestion, idx }) => {
              const accepted = suggestion!;
              return {
                title: accepted.title,
                description_html: accepted.description_html,
                acceptance_html: gherkinToHtml(normalizeToFeatureGherkin(
                  accepted.title,
                  extraAcceptanceOverrides[idx] ?? accepted.acceptance_html,
                  accepted.description_html,
                )),
              };
            })
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
          acceptance_html: normalizedAcceptanceForItem(i),
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
                {extrasNeedingGherkin > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="ms-auto h-7 text-xs text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-950/30" onClick={normalizeAllExtras}>
                    <FileText className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('docConvertNormalizeAllGherkin', { count: extrasNeedingGherkin })}
                  </Button>
                )}
                <Badge variant="secondary" className={extrasNeedingGherkin > 0 ? '' : 'ms-auto'}>{extraSelected.size}/{enhance.suggested_requirements.length}</Badge>
              </div>
              <div className="space-y-2 p-3">
                <p className="text-xs text-muted-foreground">{t('docConvertAiGapsHint')}</p>
                {enhance.suggested_requirements.map((sug, idx) => {
                  const checked = extraSelected.has(idx);
                  const acceptanceHtml = extraAcceptanceOverrides[idx] ?? sug.acceptance_html;
                  const needsGherkin = !isFeatureStyleGherkin(acceptanceHtml);
                  return (
                    <div key={idx} className={`flex gap-2 rounded-md border p-2 transition-colors ${checked ? 'border-emerald-300 bg-white/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleExtra(idx)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1 text-sm font-medium" dir="auto">{sug.title}</div>
                          <Badge variant={needsGherkin ? 'outline' : 'secondary'} className="shrink-0 text-[10px]">
                            {needsGherkin ? t('docConvertGherkinNeedsNormalization') : t('docConvertGherkinReady')}
                          </Badge>
                          {needsGherkin && (
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-950/30" onClick={(event) => { event.preventDefault(); normalizeExtraAcceptance(idx); }}>
                              <FileText className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                              {t('docConvertNormalizeGherkin')}
                            </Button>
                          )}
                        </div>
                        {sug.rationale && <div className="text-[11px] text-emerald-700 dark:text-emerald-300" dir="auto">{sug.rationale}</div>}
                        {sug.description_html && (
                          <div
                            className="prose prose-sm mt-1 max-h-20 max-w-none overflow-hidden text-xs text-muted-foreground dark:prose-invert"
                            dir="auto"
                            style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(sug.description_html) }}
                          />
                        )}
                        {acceptanceHtml && (
                          <div className="mt-1.5 rounded-md bg-white/60 px-2 py-1 dark:bg-emerald-950/30">
                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('acceptanceCriteria')}</div>
                            <div
                              className="prose prose-sm max-h-24 max-w-none overflow-hidden text-xs text-muted-foreground dark:prose-invert"
                              dir="auto"
                              style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(acceptanceHtml) }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
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
