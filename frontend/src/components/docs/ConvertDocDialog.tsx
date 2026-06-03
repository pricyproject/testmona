import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, FileText, Layers, Loader2, Sparkles } from 'lucide-react';
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
import type { Doc, DocConvertPreviewItem, Project } from '@/types';

interface Props {
  doc: Doc;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (createdCount: number, projectId: number) => void;
}

type Mode = 'single' | 'split';
type ReqStatus = 'draft' | 'reviewed' | 'approved' | 'implemented' | 'verified' | 'deprecated';
type ReqPriority = 'low' | 'medium' | 'high' | 'critical';

const STATUSES: ReqStatus[] = ['draft', 'reviewed', 'approved', 'implemented', 'verified', 'deprecated'];
const PRIORITIES: ReqPriority[] = ['low', 'medium', 'high', 'critical'];

export function ConvertDocDialog({ doc, open, onOpenChange, onConverted }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();

  const isGlobal = doc.project_id == null;
  const [mode, setMode] = useState<Mode>('single');
  const [headingLevel, setHeadingLevel] = useState(2);
  const [status, setStatus] = useState<ReqStatus>('draft');
  const [priority, setPriority] = useState<ReqPriority>('medium');
  const [targetProjectId, setTargetProjectId] = useState<number | null>(doc.project_id ?? null);
  const [projects, setProjects] = useState<Project[]>([]);

  const [items, setItems] = useState<DocConvertPreviewItem[]>([]);
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load projects for the target picker when converting a global doc.
  useEffect(() => {
    if (!open || !isGlobal) return;
    projectsAPI.getAll().then((data: any) => {
      const list: Project[] = Array.isArray(data) ? data : data?.items ?? [];
      setProjects(list);
    }).catch(() => undefined);
  }, [open, isGlobal]);

  const loadPreview = useCallback(async () => {
    if (!open) return;
    try {
      setPreviewing(true);
      const preview = await docsAPI.previewConvert(doc.id, { mode, heading_level: headingLevel });
      setItems(preview.items);
      setTitles(Object.fromEntries(preview.items.map((i) => [i.index, i.title])));
      setExcluded(new Set());
    } catch {
      toast({ title: t('error'), description: t('docConvertPreviewFailed'), variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  }, [open, doc.id, mode, headingLevel, t, toast]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

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

  // In single mode the acceptance-criteria item becomes a field on the one
  // requirement, not a separate requirement — so it must not inflate the count.
  const includedCount = mode === 'single'
    ? Math.min(1, items.filter((i) => !i.is_acceptance_criteria).length)
    : items.filter((i) => !excluded.has(i.index)).length;
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
      const result = await docsAPI.convert(doc.id, {
        mode,
        heading_level: headingLevel,
        target_project_id: targetProjectId,
        default_status: status,
        default_priority: priority,
        items: items.map((i) => ({ index: i.index, title: (titles[i.index] ?? i.title).trim(), include: !excluded.has(i.index) })),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            {t('docConvertTitle')}
          </DialogTitle>
          <DialogDescription>{t('docConvertDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`flex items-start gap-3 rounded-lg border p-3 text-start transition-colors ${mode === 'single' ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/40 dark:border-slate-700'}`}
            >
              <FileText className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm font-semibold">{t('docConvertSingle')}</span>
                <span className="block text-xs text-muted-foreground">{t('docConvertSingleHint')}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('split')}
              className={`flex items-start gap-3 rounded-lg border p-3 text-start transition-colors ${mode === 'split' ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/40 dark:border-slate-700'}`}
            >
              <Layers className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm font-semibold">{t('docConvertSplit')}</span>
                <span className="block text-xs text-muted-foreground">{t('docConvertSplitHint')}</span>
              </span>
            </button>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {mode === 'split' && (
              <div className="space-y-1">
                <Label className="text-xs">{t('docConvertHeadingLevel')}</Label>
                <Select value={String(headingLevel)} onValueChange={(v) => setHeadingLevel(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
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
                <Badge variant="secondary">{t('docConvertWillCreate', { n: includedCount })}</Badge>
              </div>
            </div>
            <div className={`max-h-72 space-y-2 overflow-y-auto p-3 transition-opacity ${previewing && items.length > 0 ? 'opacity-60' : ''}`}>
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
                {items.map((item) => {
                  const isExcluded = excluded.has(item.index);
                  return (
                    <div key={item.index} className={`rounded-md border p-2 transition-opacity ${isExcluded ? 'opacity-50' : ''} border-slate-200 dark:border-slate-700`}>
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
                        {item.is_acceptance_criteria && <Badge variant="outline" className="shrink-0">{t('acceptanceCriteria')}</Badge>}
                      </div>
                      <div
                        className="prose prose-sm mt-1 max-h-24 max-w-none overflow-hidden px-1 text-xs text-muted-foreground dark:prose-invert"
                        dir="auto"
                        style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description_html) }}
                      />
                    </div>
                  );
                })}
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{t('cancel')}</Button>
          <Button type="button" onClick={handleConvert} disabled={submitting || previewing || includedCount === 0 || hasBlankIncludedTitle}>
            {submitting ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <ArrowRightLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
            {t('docConvertAction', { n: includedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
