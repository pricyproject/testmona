import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, Download, Eye, Loader2, Lock, Share2 } from 'lucide-react';
import { analyticsAPI } from '@/lib/api';
import { ReportsData } from '@/hooks/useReportsData';

interface Props {
  ctx: ReportsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyReport = {
  title: '',
  report_type: 'executive',
  shared_with: '',
  access_level: 'read-only',
  expires_in_days: 30,
};

export function ShareExportFlow({ ctx, open, onOpenChange }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const { selectedProject, shareableReports, loadShareableReports, handleExportReport } = ctx;
  const isLoading = !!ctx.loadingByTab.shareable;

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newReport, setNewReport] = useState({ ...emptyReport });
  const [previewReport, setPreviewReport] = useState<any>(null);
  const [previewContent, setPreviewContent] = useState<any>(null);

  // Load the shareable reports list whenever the flow opens.
  useEffect(() => {
    if (open) loadShareableReports();
  }, [open]);

  const handleCreateReport = async () => {
    const title = newReport.title.trim();
    if (!selectedProject || !title) return;
    setCreating(true);
    try {
      const sharedWith = newReport.shared_with.split(',').map((entry) => entry.trim()).filter(Boolean);
      await analyticsAPI.createShareableReport({
        project_id: selectedProject,
        title,
        report_type: newReport.report_type,
        shared_with: sharedWith,
        access_level: newReport.access_level,
        expires_in_days: newReport.expires_in_days,
      });
      setShowCreateDialog(false);
      setNewReport({ ...emptyReport });
      await loadShareableReports();
      toast({ title: t('reports_toast_reportCreated'), description: t('reports_toast_reportCreatedDesc', { title }) });
    } catch (err) {
      console.error('Failed to create shareable report:', err);
      toast({
        title: t('reports_toast_couldNotCreateReport'),
        description: t('reports_toast_couldNotCreateReportDesc'),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async (report: any) => {
    if (!report.share_token) return;
    const url = `${window.location.origin}/shared-reports/${report.share_token}`;
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
    } catch (err) {
      console.error('Copy link failed:', err);
      toast({ title: t('reports_toast_couldNotCopyLink'), description: url, variant: 'destructive' });
    }
  };

  const handlePreview = async (report: any) => {
    setPreviewReport(report);
    setPreviewContent(null);
    try {
      const data = await analyticsAPI.downloadShareableReport(report.id);
      setPreviewContent(data?.report_content ?? {});
    } catch (err) {
      console.error('Failed to load report preview:', err);
      setPreviewContent({ error: 'Preview could not be loaded. The report may have expired.' });
    }
  };

  const handleDownload = async (report: any) => {
    try {
      const data = await analyticsAPI.downloadShareableReport(report.id);
      const safeName = String(report.title || `report-${report.id}`).replace(/[^\w.-]+/g, '_');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: t('reports_toast_downloadReady'), description: t('reports_toast_downloadReadyDesc', { filename: `${safeName}.json` }) });
    } catch (err) {
      console.error('Failed to download report:', err);
      toast({ title: t('reports_toast_downloadFailed'), description: t('reports_toast_downloadFailedDesc'), variant: 'destructive' });
    }
  };

  return (
    <>
      {/* Share / Export hub */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent isRTL={isRTL} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('reports_shareExportTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
            {/* Export the current view */}
            <div className="rounded-lg border dark:border-gray-700 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{t('reports_exportCurrentViewTitle')}</p>
                  <p className="text-sm text-gray-500">{t('reports_exportCurrentViewDesc')}</p>
                </div>
                <Button variant="outline" onClick={handleExportReport}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('reportsExportReport')}
                </Button>
              </div>
            </div>

            {/* Shareable reports */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('reportsTabShareable')}</p>
                  <p className="text-sm text-gray-500">{t('reports_shareableSubtitle')}</p>
                </div>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Share2 className="h-4 w-4 mr-2" />
                  {t('reports_createNewReport')}
                </Button>
              </div>

              {isLoading && (
                <div className="flex items-center justify-center py-6">
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
                  {shareableReports.map((report) => (
                    <Card key={report.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{report.title}</CardTitle>
                            <p className="text-sm text-gray-600">
                              {t('reports_sharedByUser', { id: report.created_by ?? 'N/A', views: report.view_count || 0 })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={report.report_type === 'executive' ? 'secondary' : 'outline-solid'} className="capitalize">
                              {report.report_type}
                            </Badge>
                            <div className="flex items-center gap-1 text-sm text-gray-600">
                              <Lock className="h-3 w-3" />
                              {report.access_level}
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-gray-600">
                            <p>
                              {t('reports_sharedWithLabel')}{' '}
                              {Array.isArray(report.shared_with) && report.shared_with.length
                                ? report.shared_with.join(', ')
                                : t('reports_noOneYet')}
                            </p>
                            <p>{t('reports_expiresLabel')} {report.expires_at ? new Date(report.expires_at).toLocaleDateString() : t('reports_never')}</p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handlePreview(report)}>
                              <Eye className="h-4 w-4 mr-2" />
                              {t('reports_preview')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCopyLink(report)}
                              disabled={!report.share_token}
                              title={report.share_token ? t('reports_copyLink') : ''}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              {t('reports_copyLink')}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleDownload(report)}>
                              <Download className="h-4 w-4 mr-2" />
                              {t('reports_download')}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Report Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent isRTL={isRTL} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('createNewShareableReport')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
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
              <Select value={newReport.report_type} onValueChange={(value) => setNewReport({ ...newReport, report_type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="executive">{t('executive')}</SelectItem>
                  <SelectItem value="technical">{t('technical')}</SelectItem>
                  <SelectItem value="summary">{t('summary')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('accessLevel')}</Label>
              <Select value={newReport.access_level} onValueChange={(value) => setNewReport({ ...newReport, access_level: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read-only">{t('readOnly')}</SelectItem>
                  <SelectItem value="edit">{t('edit')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('sharedWith')}</Label>
              <Input
                value={newReport.shared_with}
                onChange={(e) => setNewReport({ ...newReport, shared_with: e.target.value })}
                placeholder={t('sharedWithPlaceholder')}
              />
            </div>
            <div>
              <Label>{t('expiresInDays')}</Label>
              <Input
                type="number"
                value={newReport.expires_in_days}
                onChange={(e) => setNewReport({ ...newReport, expires_in_days: parseInt(String(e.target.value)) || 30 })}
                min="1"
                max="365"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreateReport} disabled={!newReport.title.trim() || creating}>
              {creating ? t('creating') : t('createReport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog
        open={!!previewReport}
        onOpenChange={(o) => {
          if (!o) {
            setPreviewReport(null);
            setPreviewContent(null);
          }
        }}
      >
        <DialogContent isRTL={isRTL} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewReport?.title || 'Report preview'}</DialogTitle>
          </DialogHeader>
          {previewReport && (
            <div className="space-y-4 text-sm max-h-[65vh] overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="capitalize">{previewReport.report_type}</Badge>
                <Badge variant="outline" className="capitalize">{previewReport.access_level}</Badge>
                <Badge variant="outline">{previewReport.view_count || 0} views</Badge>
              </div>

              {previewContent === null ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : previewContent?.error ? (
                <p className="text-gray-500">{previewContent.error}</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    Generated by {previewContent.generated_by || 'N/A'}
                    {previewContent.generated_at ? ` • ${new Date(previewContent.generated_at).toLocaleString()}` : ''}
                  </p>

                  {previewContent.kpis && (
                    <div>
                      <p className="font-medium text-gray-700 mb-2">{t('reports_previewKeyMetrics')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ['coverage_percent', 'Execution Coverage', '%'],
                          ['pass_rate_percent', 'Pass Rate', '%'],
                          ['failure_rate_percent', 'Failure Rate', '%'],
                          ['flakiness_percent', 'Flakiness', '%'],
                          ['cycle_time_hours', 'Cycle Time', 'h'],
                          ['defect_density', 'Defect Density', ''],
                        ] as [string, string, string][]).map(([key, label, unit]) => (
                          <div key={key} className="rounded-lg border dark:border-gray-700 px-3 py-2">
                            <div className="text-xs text-gray-500">{label}</div>
                            <div className="text-lg font-semibold">{previewContent.kpis[key] ?? 0}{unit}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {previewContent.summary && (
                    <div>
                      <p className="font-medium text-gray-700 mb-2">{t('reports_previewProjectSummary')}</p>
                      <div className="grid grid-cols-2 gap-x-4">
                        {([
                          ['total_test_cases', 'Test Cases'],
                          ['total_test_suites', 'Test Suites'],
                          ['total_test_runs', 'Test Runs'],
                          ['total_requirements', 'Requirements'],
                          ['total_defects', 'Defects'],
                        ] as [string, string][]).map(([key, label]) => (
                          <div key={key} className="flex justify-between border-b border-gray-100 dark:border-gray-800 py-1">
                            <span className="text-gray-600">{label}</span>
                            <span className="font-medium">{previewContent.summary[key] ?? 0}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {previewContent.recent_activity && (
                    <div>
                      <p className="font-medium text-gray-700 mb-2">{t('reports_previewRecentActivity')}</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {([
                          ['test_runs_today', 'Runs today'],
                          ['tests_executed', 'Tests executed'],
                          ['defects_found', 'Defects found'],
                        ] as [string, string][]).map(([key, label]) => (
                          <div key={key} className="rounded-lg border dark:border-gray-700 px-2 py-2">
                            <div className="text-lg font-semibold">{previewContent.recent_activity[key] ?? 0}</div>
                            <div className="text-xs text-gray-500">{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {previewContent.data_available === false && (
                    <p className="text-xs text-gray-500">{t('reports_previewDataUnavailable')}</p>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPreviewReport(null);
                setPreviewContent(null);
              }}
            >
              {t('reports_previewClose')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
