import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { DateField } from '@/components/ui/DateField';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileJson,
  Loader2,
  Printer,
  RefreshCcw,
  Share2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { analyticsAPI } from '@/lib/api';
import { ReportsData } from '@/hooks/useReportsData';

interface Props {
  ctx: ReportsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ReportFormat = 'json' | 'csv';

const reportTypeOptions = [
  'release-readiness',
  'execution-summary',
  'defect-quality',
  'coverage-traceability',
  'team-activity',
  'audit-compliance',
  'customer-quality',
  'summary',
  'technical',
];

const sectionOptions = ['kpis', 'summary', 'recent_activity', 'trends', 'team_performance', 'upcoming'];

const reportTypeSections: Record<string, string[]> = {
  'release-readiness': ['kpis', 'summary', 'recent_activity', 'trends', 'upcoming'],
  'execution-summary': ['kpis', 'summary', 'recent_activity', 'trends'],
  'defect-quality': ['kpis', 'summary', 'recent_activity', 'trends'],
  'coverage-traceability': ['kpis', 'summary', 'trends'],
  'team-activity': ['summary', 'recent_activity', 'team_performance'],
  'audit-compliance': ['summary', 'recent_activity'],
  'customer-quality': ['kpis', 'summary', 'recent_activity'],
  summary: ['kpis', 'summary'],
  technical: sectionOptions,
};

const defaultReport = {
  title: '',
  report_type: 'release-readiness',
  shared_with: '',
  access_level: 'public',
  expires_in_days: 30,
  time_range: '30d',
  period_start: '',
  period_end: '',
  snapshot_mode: 'snapshot',
  include_sections: ['kpis', 'summary', 'recent_activity', 'trends'],
  export_formats: ['json', 'csv'] as ReportFormat[],
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeAccess = (value?: string) => (value === 'edit' ? 'read-only' : value || 'public');

const extractMetadata = (report: any) => report?.report_content || {};

const toDateTime = (value: string, endOfDay = false) => {
  if (!value) return undefined;
  return `${value}T${endOfDay ? '23:59:59' : '00:00:00'}`;
};

const activityValue = (activity: any, key: string, legacyKey?: string) =>
  activity?.[key] ?? (legacyKey ? activity?.[legacyKey] : undefined) ?? 0;

const upcomingCount = (upcoming: any, countKey: string, listKey: string) =>
  upcoming?.[countKey] ?? (Array.isArray(upcoming?.[listKey]) ? upcoming[listKey].length : 0);

export function ShareExportFlow({ ctx, open, onOpenChange }: Props) {
  const { t, isRTL } = useTranslation();
  const { formatDate, formatDateTime } = useDateFormat();
  const { toast } = useToast();
  const { selectedProject, shareableReports, loadShareableReports, handleExportReport } = ctx;
  const isLoading = !!ctx.loadingByTab.shareable;

  const [activeTab, setActiveTab] = useState('manage');
  const [creating, setCreating] = useState(false);
  const [busyReportId, setBusyReportId] = useState<number | null>(null);
  const [newReport, setNewReport] = useState({ ...defaultReport });
  const [previewReport, setPreviewReport] = useState<any>(null);
  const [previewContent, setPreviewContent] = useState<any>(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (open) loadShareableReports();
  }, [open]);

  const recipients = useMemo(
    () => newReport.shared_with.split(',').map((entry) => entry.trim()).filter(Boolean),
    [newReport.shared_with],
  );

  const validateForm = () => {
    const title = newReport.title.trim();
    if (!title) return t('reports_shareErrorTitleRequired');
    if (title.length > 200) return t('reports_shareErrorTitleLength');
    if (newReport.access_level === 'restricted' && recipients.length === 0) {
      return t('reports_shareErrorRecipientsRequired');
    }
    const invalidRecipient = recipients.find((entry) => !isValidEmail(entry));
    if (invalidRecipient) return t('reports_shareErrorInvalidEmail', { email: invalidRecipient });
    if (newReport.time_range === 'custom') {
      if (!newReport.period_start || !newReport.period_end) return t('reports_shareErrorCustomPeriodRequired');
      if (new Date(newReport.period_start) >= new Date(newReport.period_end)) return t('reports_shareErrorPeriodOrder');
    }
    if (newReport.include_sections.length === 0) return t('reports_shareErrorSectionsRequired');
    if (newReport.expires_in_days < 1 || newReport.expires_in_days > 365) return t('reports_shareErrorExpiryRange');
    return '';
  };

  const handleCreateReport = async () => {
    const validation = validateForm();
    setFormError(validation);
    if (validation || !selectedProject) return;
    setCreating(true);
    try {
      const payload = {
        project_id: selectedProject,
        title: newReport.title.trim(),
        report_type: newReport.report_type,
        shared_with: recipients,
        access_level: newReport.access_level,
        expires_in_days: newReport.expires_in_days,
        time_range: newReport.time_range,
        period_start: newReport.time_range === 'custom' ? toDateTime(newReport.period_start) : undefined,
        period_end: newReport.time_range === 'custom' ? toDateTime(newReport.period_end, true) : undefined,
        snapshot_mode: newReport.snapshot_mode,
        include_sections: newReport.include_sections,
        export_formats: newReport.export_formats,
      };
      const created = await analyticsAPI.createShareableReport(payload);
      setNewReport({ ...defaultReport });
      setActiveTab('manage');
      setPreviewReport(created);
      setPreviewContent(created?.report_content || null);
      await loadShareableReports();
      toast({ title: t('reports_toast_reportCreated'), description: t('reports_toast_reportCreatedDesc', { title: payload.title }) });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const description = Array.isArray(detail)
        ? detail.map((item: any) => item?.msg || String(item)).join(' ')
        : detail || t('reports_toast_couldNotCreateReportDesc');
      toast({ title: t('reports_toast_couldNotCreateReport'), description, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const reportUrl = (report: any) => `${window.location.origin}/shared-reports/${report.share_token}`;

  const handleCopyLink = async (report: any) => {
    if (!report.share_token) return;
    const url = reportUrl(report);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast({ title: t('reports_toast_linkCopied'), description: t('reports_toast_linkCopiedDesc') });
    } catch {
      toast({ title: t('reports_toast_couldNotCopyLink'), description: url, variant: 'destructive' });
    }
  };

  const handlePreview = async (report: any) => {
    setPreviewReport(report);
    setPreviewContent(null);
    setBusyReportId(report.id);
    try {
      const data = await analyticsAPI.previewShareableReport(report.id);
      setPreviewReport(data);
      setPreviewContent(data?.report_content ?? {});
    } catch (err: any) {
      const status = err?.response?.status;
      setPreviewContent({ error: status === 410 ? t('reports_shareExpired') : t('reports_previewLoadFailed') });
    } finally {
      setBusyReportId(null);
    }
  };

  const handleDownload = async (report: any, format: ReportFormat) => {
    setBusyReportId(report.id);
    try {
      const data = await analyticsAPI.downloadShareableReport(report.id, format);
      const safeName = String(report.title || `report-${report.id}`).replace(/[^\w.-]+/g, '_');
      const blob = format === 'csv'
        ? data
        : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      await loadShareableReports();
      toast({ title: t('reports_toast_downloadReady'), description: t('reports_toast_downloadReadyDesc', { filename: `${safeName}.${format}` }) });
    } catch {
      toast({ title: t('reports_toast_downloadFailed'), description: t('reports_toast_downloadFailedDesc'), variant: 'destructive' });
    } finally {
      setBusyReportId(null);
    }
  };

  const handleRegenerate = async (report: any) => {
    setBusyReportId(report.id);
    try {
      const updated = await analyticsAPI.regenerateShareableReport(report.id);
      await loadShareableReports();
      setPreviewReport(updated);
      setPreviewContent(updated?.report_content || {});
      toast({ title: t('reports_shareRegenerated'), description: t('reports_shareRegeneratedDesc') });
    } catch {
      toast({ title: t('reports_shareRegenerateFailed'), description: t('reports_shareRegenerateFailedDesc'), variant: 'destructive' });
    } finally {
      setBusyReportId(null);
    }
  };

  const handleRevoke = async (report: any) => {
    if (!window.confirm(t('reports_shareRevokeConfirm', { title: report.title }))) return;
    setBusyReportId(report.id);
    try {
      await analyticsAPI.revokeShareableReport(report.id);
      if (previewReport?.id === report.id) {
        setPreviewReport(null);
        setPreviewContent(null);
      }
      await loadShareableReports();
      toast({ title: t('reports_shareRevoked'), description: t('reports_shareRevokedDesc') });
    } catch {
      toast({ title: t('reports_shareRevokeFailed'), description: t('reports_shareRevokeFailedDesc'), variant: 'destructive' });
    } finally {
      setBusyReportId(null);
    }
  };

  const toggleSection = (section: string, checked: boolean) => {
    setNewReport((prev) => ({
      ...prev,
      include_sections: checked
        ? Array.from(new Set([...prev.include_sections, section]))
        : prev.include_sections.filter((item) => item !== section),
    }));
  };

  const previewMeta = extractMetadata(previewReport);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent isRTL={isRTL} className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t('reports_shareExportTitle')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
          <div className="min-w-0 space-y-4">
            <div className="rounded-lg border dark:border-gray-700 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{t('reports_exportCurrentViewTitle')}</p>
                  <p className="text-sm text-gray-500">{t('reports_exportCurrentViewDesc')}</p>
                </div>
                <Button variant="outline" onClick={handleExportReport}>
                  <FileJson className="h-4 w-4 mr-2" />
                  {t('reportsExportReport')}
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="manage">{t('reports_shareManageTab')}</TabsTrigger>
                <TabsTrigger value="create">{t('reports_shareCreateTab')}</TabsTrigger>
              </TabsList>

              <TabsContent value="manage" className="max-h-[62vh] overflow-y-auto pr-1">
                {isLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600 mr-2" />
                    <span className="text-gray-600">{t('reports_loadingShareable')}</span>
                  </div>
                )}

                {!isLoading && shareableReports.length === 0 && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <Share2 className="h-10 w-10 text-gray-400 mb-3" />
                      <p className="text-gray-600 text-center">{t('reports_noShareableReports')}</p>
                    </CardContent>
                  </Card>
                )}

                {!isLoading && shareableReports.length > 0 && (
                  <div className="grid gap-3">
                    {shareableReports.map((report) => {
                      const metadata = extractMetadata(report);
                      const access = normalizeAccess(report.access_level);
                      const busy = busyReportId === report.id;
                      return (
                        <Card key={report.id}>
                          <CardHeader className="pb-2">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <CardTitle className="truncate text-base">{report.title}</CardTitle>
                                <p className="text-sm text-gray-600">
                                  {t('reports_sharedByUser', { user: report.created_by_display || `#${report.created_by ?? 'N/A'}`, views: report.view_count || 0 })}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {metadata.period?.label || t('reports_periodLast30d')} • {t(`reports_snapshotMode_${metadata.snapshot_mode || 'snapshot'}`)}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">{t(`reports_reportType_${report.report_type}`)}</Badge>
                                <Badge variant={access === 'restricted' ? 'outline-solid' : 'outline'}>
                                  <ShieldCheck className="h-3 w-3 mr-1" />
                                  {t(`reports_access_${access}`)}
                                </Badge>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex flex-col gap-3">
                              <div className="grid gap-1 text-sm text-gray-600 sm:grid-cols-2">
                                <p>
                                  {t('reports_sharedWithLabel')}{' '}
                                  {Array.isArray(report.shared_with) && report.shared_with.length
                                    ? report.shared_with.join(', ')
                                    : t('reports_publicLinkAudience')}
                                </p>
                                <p>{t('reports_expiresLabel')} {report.expires_at ? formatDate(report.expires_at) : t('reports_never')}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={() => handlePreview(report)} disabled={busy}>
                                  {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                                  {t('reports_preview')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleCopyLink(report)} disabled={!report.share_token}>
                                  <Copy className="h-4 w-4 mr-2" />
                                  {t('reports_copyLink')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => window.open(reportUrl(report), '_blank', 'noopener,noreferrer')} disabled={!report.share_token}>
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  {t('reports_openSharedReport')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDownload(report, 'json')} disabled={busy}>
                                  <Download className="h-4 w-4 mr-2" />
                                  JSON
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDownload(report, 'csv')} disabled={busy}>
                                  <Download className="h-4 w-4 mr-2" />
                                  CSV
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleRegenerate(report)} disabled={busy}>
                                  <RefreshCcw className="h-4 w-4 mr-2" />
                                  {t('reports_regenerate')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleRevoke(report)} disabled={busy} className="text-red-600 hover:text-red-700">
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {t('reports_revoke')}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="create" className="max-h-[62vh] overflow-y-auto pr-1">
                <div className="grid gap-4">
                  {formError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label>{t('reportTitle')}</Label>
                      <Input
                        value={newReport.title}
                        onChange={(e) => setNewReport({ ...newReport, title: e.target.value })}
                        placeholder={t('enterReportTitle')}
                        maxLength={200}
                      />
                    </div>

                    <div>
                      <Label>{t('reportType')}</Label>
                      <Select
                        value={newReport.report_type}
                        onValueChange={(value) => setNewReport({
                          ...newReport,
                          report_type: value,
                          include_sections: reportTypeSections[value] || defaultReport.include_sections,
                        })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {reportTypeOptions.map((option) => (
                            <SelectItem key={option} value={option}>{t(`reports_reportType_${option}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t('reports_periodLabel')}</Label>
                      <Select value={newReport.time_range} onValueChange={(value) => setNewReport({ ...newReport, time_range: value })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24h">{t('reports_timeLast24h')}</SelectItem>
                          <SelectItem value="7d">{t('reports_timeLast7d')}</SelectItem>
                          <SelectItem value="30d">{t('reports_timeLast30d')}</SelectItem>
                          <SelectItem value="90d">{t('reports_timeLast90d')}</SelectItem>
                          <SelectItem value="custom">{t('reports_periodCustom')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {newReport.time_range === 'custom' && (
                      <>
                        <div>
                          <Label>{t('reports_periodStart')}</Label>
                          <DateField value={newReport.period_start} onChange={(v) => setNewReport({ ...newReport, period_start: v })} />
                        </div>
                        <div>
                          <Label>{t('reports_periodEnd')}</Label>
                          <DateField value={newReport.period_end} onChange={(v) => setNewReport({ ...newReport, period_end: v })} />
                        </div>
                      </>
                    )}

                    <div>
                      <Label>{t('accessLevel')}</Label>
                      <Select value={newReport.access_level} onValueChange={(value) => setNewReport({ ...newReport, access_level: value })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">{t('reports_access_public')}</SelectItem>
                          <SelectItem value="restricted">{t('reports_access_restricted')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t('expiresInDays')}</Label>
                      <Input
                        type="number"
                        value={newReport.expires_in_days}
                        onChange={(e) => setNewReport({ ...newReport, expires_in_days: parseInt(String(e.target.value), 10) || 30 })}
                        min="1"
                        max="365"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <Label>{t('sharedWith')}</Label>
                      <Input
                        value={newReport.shared_with}
                        onChange={(e) => setNewReport({ ...newReport, shared_with: e.target.value })}
                        placeholder={t('sharedWithPlaceholder')}
                      />
                      <p className="mt-1 text-xs text-gray-500">{t('reports_sharedWithHelp')}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border dark:border-gray-700 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{t('reports_snapshotModeTitle')}</p>
                        <p className="text-sm text-gray-500">{t('reports_snapshotModeDesc')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{t(`reports_snapshotMode_${newReport.snapshot_mode}`)}</span>
                        <Switch
                          checked={newReport.snapshot_mode === 'live'}
                          onCheckedChange={(checked) => setNewReport({ ...newReport, snapshot_mode: checked ? 'live' : 'snapshot' })}
                        />
                      </div>
                    </div>

                    <p className="mb-2 text-sm font-medium">{t('reports_sectionsLabel')}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {sectionOptions.map((section) => (
                        <label key={section} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={newReport.include_sections.includes(section)}
                            onCheckedChange={(checked) => toggleSection(section, checked === true)}
                          />
                          <span>{t(`reports_section_${section}`)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setNewReport({ ...defaultReport })}>{t('reports_reset')}</Button>
                    <Button onClick={handleCreateReport} disabled={creating}>
                      {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Share2 className="h-4 w-4 mr-2" />}
                      {creating ? t('creating') : t('createReport')}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="min-w-0 rounded-lg border dark:border-gray-700 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{t('reports_inlinePreviewTitle')}</p>
                <p className="text-sm text-gray-500">{t('reports_inlinePreviewDesc')}</p>
              </div>
              {previewReport?.share_token && (
                <Button variant="outline" size="sm" onClick={() => window.open(reportUrl(previewReport), '_blank', 'noopener,noreferrer')}>
                  <Printer className="h-4 w-4 mr-2" />
                  {t('reports_printPdf')}
                </Button>
              )}
            </div>

            {!previewReport ? (
              <div className="flex min-h-[320px] items-center justify-center text-center text-sm text-gray-500">
                {t('reports_selectReportPreview')}
              </div>
            ) : previewContent === null ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : previewContent?.error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewContent.error}</AlertDescription>
              </Alert>
            ) : (
              <div className="max-h-[66vh] space-y-4 overflow-y-auto pr-1 text-sm">
                <div>
                  <h3 className="text-lg font-semibold">{previewReport.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">{t(`reports_reportType_${previewReport.report_type}`)}</Badge>
                    <Badge variant="outline">{previewMeta.period?.label || t('reports_periodLast30d')}</Badge>
                    <Badge variant="outline">{t(`reports_snapshotMode_${previewMeta.snapshot_mode || 'snapshot'}`)}</Badge>
                  </div>
                </div>

                <p className="text-xs text-gray-500">
                  {t('reports_previewGeneratedBy', { user: previewContent.generated_by || 'N/A' })}
                  {previewContent.generated_at ? t('reports_previewGeneratedAt', { time: formatDateTime(previewContent.generated_at) }) : ''}
                </p>

                {previewContent.kpis && (
                  <div>
                    <p className="mb-2 font-medium">{t('reports_previewKeyMetrics')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ['coverage_percent', 'reports_metricCoverage', '%'],
                        ['pass_rate_percent', 'reports_metricPassRate', '%'],
                        ['failure_rate_percent', 'reports_metricFailureRate', '%'],
                        ['flakiness_percent', 'reports_metricFlakiness', '%'],
                        ['cycle_time_hours', 'reports_metricCycleTime', 'h'],
                        ['defect_density', 'reports_metricDefectDensity', ''],
                      ] as [string, string, string][]).map(([key, label, unit]) => (
                        <div key={key} className="rounded-lg border dark:border-gray-700 px-3 py-2">
                          <div className="text-xs text-gray-500">{t(label)}</div>
                          <div className="text-lg font-semibold">{previewContent.kpis[key] ?? 0}{unit}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewContent.summary && (
                  <div>
                    <p className="mb-2 font-medium">{t('reports_previewProjectInventory')}</p>
                    <div className="grid grid-cols-2 gap-x-4">
                      {([
                        ['total_test_cases', 'reports_summaryTestCases'],
                        ['total_test_suites', 'reports_summaryTestSuites'],
                        ['total_test_runs', 'reports_summaryTestRuns'],
                        ['total_requirements', 'reports_summaryRequirements'],
                        ['total_defects', 'reports_summaryDefects'],
                      ] as [string, string][]).map(([key, label]) => (
                        <div key={key} className="flex justify-between border-b border-gray-100 dark:border-gray-800 py-1">
                          <span className="text-gray-600">{t(label)}</span>
                          <span className="font-medium">{previewContent.summary[key] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewContent.recent_activity && (
                  <div>
                    <p className="mb-2 font-medium">{t('reports_previewPeriodActivity')}</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {([
                        ['test_runs_started', 'test_runs_today', 'reports_activityRunsStarted'],
                        ['tests_executed', '', 'reports_activityTestsExecuted'],
                        ['defects_found', '', 'reports_activityDefectsFound'],
                      ] as [string, string, string][]).map(([key, legacyKey, label]) => (
                        <div key={key} className="rounded-lg border dark:border-gray-700 px-2 py-2">
                          <div className="text-lg font-semibold">{activityValue(previewContent.recent_activity, key, legacyKey)}</div>
                          <div className="text-xs text-gray-500">{t(label)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewContent.kpi_trends && (
                  <div>
                    <p className="mb-2 font-medium">{t('reports_previewTrends')}</p>
                    <div className="grid gap-2">
                      {([
                        ['coverage', 'reports_metricCoverage', '%'],
                        ['passRate', 'reports_metricPassRate', '%'],
                        ['failureTrends', 'reports_metricFailureRate', '%'],
                        ['flakiness', 'reports_metricFlakiness', '%'],
                        ['cycleTime', 'reports_metricCycleTime', 'h'],
                        ['defectDensity', 'reports_metricDefectDensity', ''],
                      ] as [string, string, string][]).map(([key, label, unit]) => {
                        const trend = previewContent.kpi_trends[key] || {};
                        return (
                          <div key={key} className="flex items-center justify-between rounded-lg border dark:border-gray-700 px-3 py-2">
                            <span className="text-gray-600">{t(label)}</span>
                            <span className="font-medium">
                              {trend.current ?? 0}{unit} · {t(`reports_trend_${trend.trend || 'stable'}`)} {trend.change ?? 0}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {previewContent.team_performance && (
                  <div>
                    <p className="mb-2 font-medium">{t('reports_previewTeamPerformance')}</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {([
                        ['active_testers', 'reports_teamActiveTesters'],
                        ['avg_execution_time', 'reports_teamAvgExecutionTime'],
                        ['productivity_score', 'reports_teamProductivityScore'],
                      ] as [string, string][]).map(([key, label]) => (
                        <div key={key} className="rounded-lg border dark:border-gray-700 px-2 py-2">
                          <div className="text-lg font-semibold">{previewContent.team_performance[key] ?? 0}</div>
                          <div className="text-xs text-gray-500">{t(label)}</div>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(previewContent.team_performance.members) && previewContent.team_performance.members.length > 0 && (
                      <div className="mt-2 divide-y rounded-lg border dark:border-gray-700">
                        {previewContent.team_performance.members.map((member: any) => (
                          <div key={member.user_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2">
                            <span className="truncate font-medium">{member.name}</span>
                            <span className="text-gray-600">{t('reports_teamMemberStats', {
                              executed: member.executed,
                              passed: member.passed,
                              failed: member.failed,
                            })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {previewContent.upcoming && (
                  <div>
                    <p className="mb-2 font-medium">{t('reports_previewUpcoming')}</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {([
                        { key: 'scheduled_runs_count', listKey: 'scheduled_runs', label: 'reports_upcomingScheduledRuns' },
                        { key: 'pending_reviews_count', listKey: 'pending_reviews', label: 'reports_upcomingPendingReviews' },
                        { key: 'release_deadline', label: 'reports_upcomingReleaseDeadline' },
                      ]).map((item) => (
                        <div key={item.key} className="rounded-lg border dark:border-gray-700 px-2 py-2">
                          <div className="text-lg font-semibold">
                            {item.key === 'release_deadline'
                              ? (previewContent.upcoming[item.key] ?? 'N/A')
                              : upcomingCount(previewContent.upcoming, item.key, item.listKey || '')}
                          </div>
                          <div className="text-xs text-gray-500">{t(item.label)}</div>
                        </div>
                      ))}
                    </div>
                    {previewContent.upcoming.milestone && (
                      <p className="mt-2 text-xs text-gray-600">
                        {t('reports_upcomingMilestone', { title: previewContent.upcoming.milestone.title, date: previewContent.upcoming.milestone.target_date ? formatDate(previewContent.upcoming.milestone.target_date) : 'N/A' })}
                      </p>
                    )}
                    {Array.isArray(previewContent.upcoming.scheduled_runs) && previewContent.upcoming.scheduled_runs.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {previewContent.upcoming.scheduled_runs.slice(0, 5).map((run: any) => (
                          <div key={run.id} className="flex justify-between rounded border dark:border-gray-700 px-2 py-1">
                            <span className="truncate">{run.name}</span>
                            <span className="text-gray-500">{run.assigned_to || run.priority || ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(previewContent.upcoming.pending_reviews) && previewContent.upcoming.pending_reviews.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {previewContent.upcoming.pending_reviews.slice(0, 5).map((testCase: any) => (
                          <div key={testCase.id} className="flex justify-between rounded border dark:border-gray-700 px-2 py-1">
                            <span className="truncate">{testCase.title}</span>
                            <span className="text-gray-500">{testCase.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {previewContent.data_available === false && (
                  <p className="text-xs text-gray-500">{t('reports_previewDataUnavailable')}</p>
                )}
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
