import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableDefectSelect } from '@/components/Defects/SearchableDefectSelect';
import { Bug, Plus, Link2, Link as LinkIcon, Unlink, RefreshCw, Copy, Check, Loader2 } from 'lucide-react';
import { useExecution } from './ExecutionContext';
import type { DefectLinkType } from './types';

const formatSnapshotDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const DEFECT_STATUSES: { value: string; labelKey: string }[] = [
  { value: 'open', labelKey: 'open' },
  { value: 'in_progress', labelKey: 'inProgress' },
  { value: 'fixed', labelKey: 'fixed' },
  { value: 'reopened', labelKey: 'reopened' },
  { value: 'closed', labelKey: 'closed' },
  { value: 'rejected', labelKey: 'rejected' },
];

export function LinkedDefectsCard() {
  const {
    t, projectId, resultDefectLinks, availableDefects, selectedDefectId, setSelectedDefectId,
    linkType, setLinkType, isLinkingDefect, canWrite,
    openDefectDialog, handleLinkExistingDefect, linkTypeLabel,
    handleUnlinkDefect, handleCorrectLinkSnapshot,
    updatingDefectStatusId, handleUpdateLinkedDefectStatus,
  } = useExecution();

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Bug className="h-4 w-4 text-slate-400" />
            {t('linkedDefects')} ({resultDefectLinks.length})
          </CardTitle>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={openDefectDialog} className="h-8 text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('reportDefect')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {canWrite && (
        <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {t('linkExistingDefect')}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchableDefectSelect
              id="defectLinkSelect"
              value={selectedDefectId}
              onChange={setSelectedDefectId}
              defects={availableDefects}
              className="flex-1"
            />
            <Select value={linkType} onValueChange={(v) => setLinkType(v as DefectLinkType)}>
              <SelectTrigger className="h-9 sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="found">{t('linkTypeFound')}</SelectItem>
                <SelectItem value="blocked_by">{t('linkTypeBlockedBy')}</SelectItem>
                <SelectItem value="related">{t('linkTypeRelated')}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleLinkExistingDefect} disabled={!selectedDefectId || isLinkingDefect} className="h-9">
              <Link2 className="mr-1 h-3.5 w-3.5" />
              {isLinkingDefect ? t('linking') : t('link')}
            </Button>
          </div>
        </div>
        )}

        {resultDefectLinks.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-400">{t('noDefectsLinked')}</p>
        ) : (
          <div className="space-y-2">
            {resultDefectLinks.map((link) => {
              const defect = link.defect || {};
              return (
                <div key={link.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <DefectCodeChip
                          code={defect.defect_id || `#${link.defect_id}`}
                          to={`/projects/${projectId}/defects/${defect.id ?? link.defect_id}`}
                          copyLabel={t('copyDefectId')}
                          copiedLabel={t('copied')}
                        />
                        {defect.severity && <Badge variant="outline" className="text-[10px] capitalize">{defect.severity}</Badge>}
                        {canWrite && (defect.id ?? link.defect_id) ? (
                          <Select
                            value={defect.status || 'open'}
                            onValueChange={(value) => handleUpdateLinkedDefectStatus(defect.id ?? link.defect_id, value)}
                            disabled={updatingDefectStatusId === (defect.id ?? link.defect_id)}
                          >
                            <SelectTrigger className="h-6 w-auto gap-1 px-2 text-[10px] capitalize">
                              {updatingDefectStatusId === (defect.id ?? link.defect_id)
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <SelectValue />}
                            </SelectTrigger>
                            <SelectContent>
                              {DEFECT_STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value} className="text-xs">{t(s.labelKey)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          defect.status && <Badge variant="outline" className="text-[10px] capitalize">{defect.status}</Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">{linkTypeLabel(link.link_type)}</Badge>
                      </div>
                      <h4 className="truncate text-sm font-medium">{defect.title}</h4>
                      {defect.external_issue_url && (
                        <a
                          href={defect.external_issue_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          <LinkIcon className="h-3 w-3" />
                          {t('openInTracker')}
                        </a>
                      )}
                      {link.failing_step_snapshot && (
                        <div className="mt-2 rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                          <div className="font-semibold">
                            {t('failingStepSnapshot', { number: link.failing_step_snapshot.step_number })}
                          </div>
                          <div className="mt-1 line-clamp-2">{link.failing_step_snapshot.action}</div>
                          {link.failing_step_snapshot.actual_result && (
                            <div className="mt-1 text-red-700 dark:text-red-300">
                              {t('actualResultLabel')}: {link.failing_step_snapshot.actual_result}
                            </div>
                          )}
                        </div>
                      )}
                      {link.result_snapshot?.test_result && (
                        <div className="mt-1 text-[11px] text-slate-400">
                          {t('resultSnapshotCaptured', {
                            status: link.result_snapshot.test_result.status || '-',
                            date: formatSnapshotDate(link.snapshot_created_at || link.result_snapshot.captured_at),
                          })}
                        </div>
                      )}
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={() => handleCorrectLinkSnapshot(link.id)} className="mt-2 h-7 px-2 text-xs">
                          <RefreshCw className="mr-1 h-3 w-3" />
                          {t('correctSnapshot')}
                        </Button>
                      )}
                    </div>
                    {canWrite && (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => handleUnlinkDefect(link.id)}
                        className="h-7 w-7 shrink-0 p-0"
                        title={t('unlinkDefect')}
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DefectCodeChip({ code, to, copyLabel, copiedLabel }: {
  code: string;
  to: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const copy = async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => navigate(to)}
        className="px-2 py-0.5 font-mono text-xs font-medium text-indigo-600 hover:bg-slate-50 hover:underline dark:text-indigo-400 dark:hover:bg-slate-800"
        title={code}
      >
        {code}
      </button>
      <button
        type="button"
        onClick={copy}
        className="border-s border-slate-200 px-1.5 py-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        title={copied ? copiedLabel : copyLabel}
        aria-label={copied ? copiedLabel : copyLabel}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}
