import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  Calendar,
  Edit,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  TestTube2,
  User,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CustomFieldsPanel } from '@/components/CustomFieldsPanel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { defectsAPI, getApiErrorMessage, testResultsAPI } from '@/lib/api';

type DefectDetailResponse = {
  defect: any;
  reporter?: any | null;
  assignee?: any | null;
  test_case?: any | null;
  test_run?: any | null;
  requirement?: any | null;
  result_links: any[];
};

type DefectEditForm = {
  defect_id: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  priority: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  environment: string;
  browser_info: string;
  tags: string;
  external_issue_url: string;
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const splitTags = (value?: string | null): string[] =>
  String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const isSafeExternalUrl = (value?: string | null): boolean => /^https?:\/\/\S+$/i.test(String(value || ''));

const buildEditForm = (defect: any): DefectEditForm => ({
  defect_id: defect?.defect_id || '',
  title: defect?.title || '',
  description: defect?.description || '',
  status: defect?.status || 'open',
  severity: defect?.severity || 'medium',
  priority: defect?.priority || 'medium',
  steps_to_reproduce: defect?.steps_to_reproduce || '',
  expected_result: defect?.expected_result || '',
  actual_result: defect?.actual_result || '',
  environment: defect?.environment || '',
  browser_info: defect?.browser_info || '',
  tags: defect?.tags || '',
  external_issue_url: defect?.external_issue_url || '',
});

const statusClass = (status?: string | null): string => {
  const normalized = String(status || '').toLowerCase();
  if (['closed', 'fixed', 'resolved'].includes(normalized)) {
    return 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300';
  }
  if (['in_progress', 'reopened'].includes(normalized)) {
    return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
};

const severityClass = (severity?: string | null): string => {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'critical') return 'bg-red-600 text-white';
  if (normalized === 'high') return 'bg-orange-500 text-white';
  if (normalized === 'medium') return 'bg-blue-600 text-white';
  return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
};

export function DefectDetail() {
  const { projectId, defectId } = useParams<{ projectId: string; defectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  const [detail, setDetail] = useState<DefectDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingLinkId, setUpdatingLinkId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<DefectEditForm>(() => buildEditForm(null));

  const numericDefectId = Number(defectId);

  const loadDetail = async (signal?: AbortSignal, showSpinner = true) => {
    if (!Number.isInteger(numericDefectId) || numericDefectId <= 0) {
      setError(t('defectNotFound'));
      setLoading(false);
      return;
    }

    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const response = await defectsAPI.getDetail(numericDefectId, signal);
      if (String(response?.defect?.project_id) !== String(projectId)) {
        setError(t('defectNotFound'));
        setDetail(null);
        return;
      }
      setDetail(response);
      if (!isEditing) setEditForm(buildEditForm(response.defect));
    } catch (err) {
      if (signal?.aborted) return;
      console.error('Failed to load defect detail:', err);
      setError(getApiErrorMessage(err, t('failedToLoadDefectDetail')));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(controller.signal);
    return () => controller.abort();
  }, [defectId, projectId]);

  const defect = detail?.defect;
  const tags = useMemo(() => splitTags(defect?.tags), [defect?.tags]);

  const startEditing = () => {
    setEditForm(buildEditForm(defect));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditForm(buildEditForm(defect));
    setIsEditing(false);
  };

  const updateEditField = (field: keyof DefectEditForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveDefect = async () => {
    const trimmedId = editForm.defect_id.trim();
    const trimmedTitle = editForm.title.trim();
    const externalUrl = editForm.external_issue_url.trim();

    if (!trimmedId || !trimmedTitle) {
      toast({
        title: t('validationError'),
        description: t('defectIdAndTitleRequired'),
        variant: 'destructive',
      });
      return;
    }

    if (externalUrl && !isSafeExternalUrl(externalUrl)) {
      toast({
        title: t('validationError'),
        description: t('externalIssueUrlInvalid'),
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const updatedDefect = await defectsAPI.update(numericDefectId, {
        defect_id: trimmedId,
        title: trimmedTitle,
        description: editForm.description.trim(),
        status: editForm.status,
        severity: editForm.severity,
        priority: editForm.priority,
        steps_to_reproduce: editForm.steps_to_reproduce.trim(),
        expected_result: editForm.expected_result.trim(),
        actual_result: editForm.actual_result.trim(),
        environment: editForm.environment.trim(),
        browser_info: editForm.browser_info.trim(),
        tags: editForm.tags.trim(),
        external_issue_url: externalUrl || null,
      });
      setDetail((prev) => prev ? { ...prev, defect: updatedDefect } : prev);
      setEditForm(buildEditForm(updatedDefect));
      setIsEditing(false);
      await loadDetail(undefined, false);
      toast({ title: t('success'), description: t('defectUpdatedSuccessfully') });
    } catch (err) {
      console.error('Failed to save defect:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateDefect')),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const updateSnapshot = async (link: any, clearFailingStep = false) => {
    if (!link?.id || !link?.test_result_id) return;

    setUpdatingLinkId(link.id);
    try {
      await testResultsAPI.updateDefectLinkSnapshot(link.test_result_id, link.id, {
        clear_failing_step: clearFailingStep,
      });
      await loadDetail();
      toast({ title: t('success'), description: t('snapshotCorrectedSuccessfully') });
    } catch (err) {
      console.error('Failed to update defect snapshot:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToCorrectSnapshot')),
        variant: 'destructive',
      });
    } finally {
      setUpdatingLinkId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !detail || !defect) {
    return (
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}/defects`)}>
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
          {t('backToDefects')}
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
            <h2 className="mt-4 text-lg font-semibold">{t('defectNotFound')}</h2>
            <p className="mt-1 text-sm text-slate-500">{error || t('defectNotFoundDesc')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" className="mb-2 px-0" onClick={() => navigate(`/projects/${projectId}/defects`)}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
            {t('backToDefects')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">{defect.defect_id || `#${defect.id}`}</Badge>
            <Badge className={severityClass(defect.severity)}>{t(defect.severity || 'medium')}</Badge>
            <Badge variant="outline" className={statusClass(defect.status)}>{t(defect.status || 'open')}</Badge>
          </div>
          <h1 className="mt-3 max-w-5xl text-2xl font-bold text-slate-950 dark:text-slate-50">{defect.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSafeExternalUrl(defect.external_issue_url) && (
            <Button asChild variant="outline">
              <a href={defect.external_issue_url} target="_blank" rel="noreferrer">
                <ExternalLink className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('openInTracker')}
              </a>
            </Button>
          )}
          <Button variant={isEditing ? 'secondary' : 'default'} onClick={isEditing ? cancelEditing : startEditing} disabled={isSaving}>
            {isEditing ? (
              <X className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            ) : (
              <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            )}
            {isEditing ? t('cancel') : t('edit')}
          </Button>
        </div>
      </div>

      {isEditing && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Edit className="h-4 w-4" />
              {t('updateDefect')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
              <Field label={t('defectId')}>
                <Input
                  value={editForm.defect_id}
                  onChange={(event) => updateEditField('defect_id', event.target.value)}
                  maxLength={50}
                />
              </Field>
              <Field label={t('title')}>
                <Input
                  value={editForm.title}
                  onChange={(event) => updateEditField('title', event.target.value)}
                  maxLength={200}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('status')}>
                <Select value={editForm.status} onValueChange={(value) => updateEditField('status', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t('open')}</SelectItem>
                    <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
                    <SelectItem value="fixed">{t('fixed')}</SelectItem>
                    <SelectItem value="reopened">{t('reopened')}</SelectItem>
                    <SelectItem value="closed">{t('closed')}</SelectItem>
                    <SelectItem value="rejected">{t('rejected')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('severity')}>
                <Select value={editForm.severity} onValueChange={(value) => updateEditField('severity', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('low')}</SelectItem>
                    <SelectItem value="medium">{t('medium')}</SelectItem>
                    <SelectItem value="high">{t('high')}</SelectItem>
                    <SelectItem value="critical">{t('critical')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('priority')}>
                <Select value={editForm.priority} onValueChange={(value) => updateEditField('priority', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('low')}</SelectItem>
                    <SelectItem value="medium">{t('medium')}</SelectItem>
                    <SelectItem value="high">{t('high')}</SelectItem>
                    <SelectItem value="urgent">{t('urgent')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label={t('description')}>
              <Textarea
                value={editForm.description}
                onChange={(event) => updateEditField('description', event.target.value)}
                rows={4}
                maxLength={1000}
              />
            </Field>

            <Field label={t('stepsToReproduce')}>
              <Textarea
                value={editForm.steps_to_reproduce}
                onChange={(event) => updateEditField('steps_to_reproduce', event.target.value)}
                rows={5}
                maxLength={2000}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('expectedResult')}>
                <Textarea
                  value={editForm.expected_result}
                  onChange={(event) => updateEditField('expected_result', event.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </Field>
              <Field label={t('actualResultLabel')}>
                <Textarea
                  value={editForm.actual_result}
                  onChange={(event) => updateEditField('actual_result', event.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('environment')}>
                <Input
                  value={editForm.environment}
                  onChange={(event) => updateEditField('environment', event.target.value)}
                  maxLength={255}
                />
              </Field>
              <Field label={t('browserInfo')}>
                <Input
                  value={editForm.browser_info}
                  onChange={(event) => updateEditField('browser_info', event.target.value)}
                  maxLength={255}
                />
              </Field>
              <Field label={t('tags')}>
                <Input
                  value={editForm.tags}
                  onChange={(event) => updateEditField('tags', event.target.value)}
                  maxLength={500}
                />
              </Field>
              <Field label={t('externalIssue')}>
                <Input
                  value={editForm.external_issue_url}
                  onChange={(event) => updateEditField('external_issue_url', event.target.value)}
                  maxLength={500}
                  className={editForm.external_issue_url.trim() && !isSafeExternalUrl(editForm.external_issue_url) ? 'border-red-400' : ''}
                />
              </Field>
            </div>

            <div className={`flex flex-wrap gap-2 ${isRTL ? 'justify-start' : 'justify-end'}`}>
              <Button variant="outline" onClick={cancelEditing} disabled={isSaving}>
                {t('cancel')}
              </Button>
              <Button onClick={saveDefect} disabled={isSaving || !editForm.defect_id.trim() || !editForm.title.trim()}>
                {isSaving ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Save className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('saveChanges')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label={t('status')} value={t(defect.status || 'open')} icon={<ShieldAlert className="h-4 w-4" />} />
        <Metric label={t('severity')} value={t(defect.severity || 'medium')} icon={<Bug className="h-4 w-4" />} />
        <Metric label={t('priority')} value={t(defect.priority || 'medium')} icon={<AlertTriangle className="h-4 w-4" />} />
        <Metric label={t('linkedExecutions')} value={String(detail.result_links.length)} icon={<TestTube2 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                {t('defectOverview')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <TextBlock label={t('description')} value={defect.description} empty={t('noDescriptionProvided')} />
              <TextBlock label={t('stepsToReproduce')} value={defect.steps_to_reproduce} empty={t('noStepsProvided')} />
              <div className="grid gap-4 md:grid-cols-2">
                <TextBlock label={t('expectedResult')} value={defect.expected_result} empty="-" />
                <TextBlock label={t('actualResultLabel')} value={defect.actual_result} empty="-" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TestTube2 className="h-4 w-4" />
                {t('linkedExecutions')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {detail.result_links.length === 0 ? (
                <p className="text-sm text-slate-500">{t('noResultSnapshotsLinked')}</p>
              ) : (
                <div className="space-y-3">
                  {detail.result_links.map((link) => (
                    <ResultLinkCard
                      key={link.id}
                      link={link}
                      projectId={projectId || ''}
                      isUpdating={updatingLinkId === link.id}
                      onRefresh={() => updateSnapshot(link)}
                      onClearFailingStep={() => updateSnapshot(link, true)}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch className="h-4 w-4" />
                {t('relationships')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Relationship
                label={t('requirement')}
                value={detail.requirement?.title}
                code={detail.requirement?.key}
                to={detail.requirement ? `/projects/${projectId}/requirements/${detail.requirement.id}` : undefined}
              />
              <Relationship
                label={t('testCase')}
                value={detail.test_case?.title}
                code={detail.test_case?.key}
                to={detail.test_case ? `/projects/${projectId}/test-cases/${detail.test_case.id}` : undefined}
              />
              <Relationship
                label={t('testRun')}
                value={detail.test_run?.name}
                to={detail.test_run ? `/projects/${projectId}/test-runs/${detail.test_run.id}` : undefined}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                {t('ownership')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Person label={t('reportedBy')} person={detail.reporter} />
              <Person label={t('assignedTo')} person={detail.assignee} />
              <Meta label={t('environment')} value={defect.environment} />
              <Meta label={t('browserInfo')} value={defect.browser_info} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                {t('timeline')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Meta label={t('created')} value={formatDateTime(defect.created_at)} />
              <Meta label={t('updated')} value={formatDateTime(defect.updated_at)} />
              <Meta label={t('externalLastSync')} value={formatDateTime(defect.external_last_sync)} />
              {tags.length > 0 && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('tags')}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {detail.defect?.project_id && detail.defect?.id && (
            <CustomFieldsPanel
              projectId={detail.defect.project_id}
              entityType="defect"
              entityId={detail.defect.id}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold capitalize text-slate-950 dark:text-slate-50">{value}</div>
    </div>
  );
}

function TextBlock({ label, value, empty }: { label: string; value?: string | null; empty: string }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h3>
      <p className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
        {value?.trim() || empty}
      </p>
    </section>
  );
}

function Relationship({ label, value, code, to }: { label: string; value?: string | null; code?: string | null; to?: string }) {
  const body = (
    <>
      {code && <Badge variant="outline" className="font-mono">{code}</Badge>}
      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{value || '-'}</span>
    </>
  );
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {to ? (
        <Link to={to} className="mt-1 flex flex-wrap items-center gap-2 hover:underline">{body}</Link>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">{body}</div>
      )}
    </div>
  );
}

function Person({ label, person }: { label: string; person?: any | null }) {
  const displayName = person?.full_name || person?.username || '-';
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{displayName}</div>
      {person?.email && <div className="text-xs text-slate-500">{person.email}</div>}
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-800 dark:text-slate-200">{value || '-'}</div>
    </div>
  );
}

function ResultLinkCard({
  link,
  projectId,
  isUpdating,
  onRefresh,
  onClearFailingStep,
  t,
}: {
  link: any;
  projectId: string;
  isUpdating: boolean;
  onRefresh: () => void;
  onClearFailingStep: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const result = link.result_snapshot?.test_result || {};
  const testCase = link.result_snapshot?.test_case || {};
  const testRun = link.result_snapshot?.test_run || {};
  const failingStep = link.failing_step_snapshot;
  const testCaseId = testCase.id || result.test_case_id;
  const testRunId = testRun.id || result.test_run_id;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{result.status || '-'}</Badge>
            <span className="text-xs text-slate-500">
              {t('resultSnapshotCaptured', {
                status: result.status || '-',
                date: formatDateTime(link.snapshot_created_at || link.result_snapshot?.captured_at),
              })}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {testCaseId ? (
              <Link
                to={`/projects/${projectId}/test-cases/${testCaseId}`}
                className="block text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
              >
                {testCase.title || `${t('testCase')} #${testCaseId}`}
              </Link>
            ) : (
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {testCase.title || `${t('testCase')} -`}
              </div>
            )}
            {testRun.name && testRunId && (
              <Link
                to={`/projects/${projectId}/test-runs/${testRunId}`}
                className="block text-xs text-slate-500 hover:underline"
              >
                {t('testRunLabel')}: {testRun.name}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isUpdating} className="h-8 gap-1 text-xs">
            {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('correctSnapshot')}
          </Button>
          {failingStep && (
            <Button variant="ghost" size="sm" onClick={onClearFailingStep} disabled={isUpdating} className="h-8 gap-1 text-xs">
              <X className="h-3 w-3" />
              {t('clearFailingStepSnapshot')}
            </Button>
          )}
        </div>
      </div>
      {failingStep && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
          <p className="font-semibold">{t('failingStepSnapshot', { number: failingStep.step_number || '-' })}</p>
          {failingStep.action && <p className="mt-1">{failingStep.action}</p>}
          {failingStep.expected_result && <p className="mt-1">{t('expectedResult')}: {failingStep.expected_result}</p>}
          {failingStep.actual_result && <p className="mt-1">{t('actualResultLabel')}: {failingStep.actual_result}</p>}
        </div>
      )}
    </div>
  );
}
