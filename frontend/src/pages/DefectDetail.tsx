import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  Calendar,
  Check,
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
import { WatchButton } from '@/components/WatchButton';
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
import { getApiErrorMessage } from '@/lib/api';
import {
  useDefectDetail,
  useDefectEditRequirements,
  useDefectProjectMembers,
  useUpdateDefect,
  useUpdateDefectSnapshot,
} from '@/hooks/queries/defectDetail';
import { useResolvedEntityId } from '@/hooks/useResolvedEntityId';
import { SearchableRequirementSelect } from '@/components/Defects/SearchableRequirementSelect';

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
  requirement_id: string;
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
  requirement_id: defect?.requirement_id ? String(defect.requirement_id) : 'none',
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
  const [updatingLinkId, setUpdatingLinkId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<DefectEditForm>(() => buildEditForm(null));

  // The URL carries the per-project sequence; resolve it to the global defect id.
  const { id: numericDefectId, loading: defectIdLoading } = useResolvedEntityId(projectId, 'defects', defectId);
  const numericProjectId = Number(projectId);
  const projectIdValid = Number.isInteger(numericProjectId) && numericProjectId > 0;
  const defectIdValid = Number.isInteger(numericDefectId) && numericDefectId > 0;

  const detailQuery = useDefectDetail(numericDefectId, !defectIdLoading && defectIdValid);
  const updateDefect = useUpdateDefect(numericDefectId);
  const updateSnapshotMutation = useUpdateDefectSnapshot(numericDefectId);
  const isSaving = updateDefect.isPending;

  const requirementsQuery = useDefectEditRequirements(numericProjectId, projectIdValid);
  const membersQuery = useDefectProjectMembers(numericProjectId, projectIdValid);
  const requirements: any[] = requirementsQuery.data ?? [];
  const members: { id: number; name: string }[] = membersQuery.data ?? [];

  // A defect whose project doesn't match the URL must read as "not found".
  const detail: DefectDetailResponse | null =
    detailQuery.data && String(detailQuery.data.defect?.project_id) === String(projectId)
      ? detailQuery.data
      : null;
  const projectMismatch = Boolean(detailQuery.data && !detail);
  const loading = defectIdLoading || (defectIdValid && detailQuery.isLoading);
  const error: string | null =
    !defectIdLoading && !defectIdValid
      ? t('defectNotFound')
      : projectMismatch
        ? t('defectNotFound')
        : detailQuery.isError
          ? getApiErrorMessage(detailQuery.error, t('failedToLoadDefectDetail'))
          : null;

  const defect = detail?.defect;

  // Sync the edit form from the loaded defect, but never clobber in-progress edits.
  useEffect(() => {
    if (defect && !isEditing) {
      setEditForm(buildEditForm(defect));
    }
  }, [defect, isEditing]);

  // Surface a requirements-load failure (the others fail silently as before).
  useEffect(() => {
    if (requirementsQuery.isError) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(requirementsQuery.error, t('failedToLoadRequirements')),
        variant: 'destructive',
      });
    }
  }, [requirementsQuery.isError, requirementsQuery.error, t, toast]);
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
    const selectedRequirementId = editForm.requirement_id && editForm.requirement_id !== 'none'
      ? Number(editForm.requirement_id)
      : null;

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

    if (selectedRequirementId !== null && !Number.isFinite(selectedRequirementId)) {
      toast({
        title: t('validationError'),
        description: t('invalidRequirementId'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const updatedDefect = await updateDefect.mutateAsync({
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
        requirement_id: selectedRequirementId,
      });
      setEditForm(buildEditForm(updatedDefect));
      setIsEditing(false);
      toast({ title: t('success'), description: t('defectUpdatedSuccessfully') });
    } catch (err) {
      console.error('Failed to save defect:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateDefect')),
        variant: 'destructive',
      });
    }
  };

  // Quick inline edit: patch a single field (or few) without the full edit form.
  const patchDefect = async (partial: Record<string, unknown>): Promise<boolean> => {
    try {
      await updateDefect.mutateAsync(partial);
      toast({ title: t('success'), description: t('defectUpdatedSuccessfully') });
      return true;
    } catch (err) {
      console.error('Failed to quick-edit defect:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateDefect')),
        variant: 'destructive',
      });
      return false;
    }
  };

  const updateSnapshot = async (link: any, clearFailingStep = false) => {
    if (!link?.id || !link?.test_result_id) return;

    setUpdatingLinkId(link.id);
    try {
      await updateSnapshotMutation.mutateAsync({
        testResultId: link.test_result_id,
        linkId: link.id,
        clearFailingStep,
      });
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
          <div className="mt-3 max-w-5xl">
            <InlineEditable
              value={defect.title}
              onSave={(v) => (v.trim() ? patchDefect({ title: v.trim() }) : Promise.resolve(false))}
              placeholder={t('title')}
              maxLength={200}
              editLabel={t('edit')}
              displayClass="text-2xl font-bold text-slate-950 dark:text-slate-50"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <WatchButton entityType="defect" entityId={defect.id} />
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

            <Field label={t('requirement')}>
              <SearchableRequirementSelect
                id="defectDetailRequirement"
                value={editForm.requirement_id}
                onChange={(value) => updateEditField('requirement_id', value)}
                requirements={requirements}
              />
            </Field>

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
        <MetricSelect
          label={t('status')} value={defect.status || 'open'} icon={<ShieldAlert className="h-4 w-4" />}
          options={statusOptions(t)} onSave={(v) => patchDefect({ status: v })}
        />
        <MetricSelect
          label={t('severity')} value={defect.severity || 'medium'} icon={<Bug className="h-4 w-4" />}
          options={severityOptions(t)} onSave={(v) => patchDefect({ severity: v })}
        />
        <MetricSelect
          label={t('priority')} value={defect.priority || 'medium'} icon={<AlertTriangle className="h-4 w-4" />}
          options={priorityOptions(t)} onSave={(v) => patchDefect({ priority: v })}
        />
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
              <EditableTextBlock
                label={t('description')} value={defect.description} empty={t('noDescriptionProvided')}
                onSave={(v) => patchDefect({ description: v })} rows={4} maxLength={1000} editLabel={t('edit')}
              />
              <EditableTextBlock
                label={t('stepsToReproduce')} value={defect.steps_to_reproduce} empty={t('noStepsProvided')}
                onSave={(v) => patchDefect({ steps_to_reproduce: v })} rows={5} maxLength={2000} editLabel={t('edit')}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <EditableTextBlock
                  label={t('expectedResult')} value={defect.expected_result} empty="-"
                  onSave={(v) => patchDefect({ expected_result: v })} rows={3} maxLength={1000} editLabel={t('edit')}
                />
                <EditableTextBlock
                  label={t('actualResultLabel')} value={defect.actual_result} empty="-"
                  onSave={(v) => patchDefect({ actual_result: v })} rows={3} maxLength={1000} editLabel={t('edit')}
                />
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
              <EditableAssignee
                label={t('assignedTo')}
                value={defect.assigned_to ?? null}
                members={members}
                unassignedLabel={t('unassigned')}
                onSave={(v) => patchDefect({ assigned_to: v })}
              />
              <EditableMeta
                label={t('environment')} value={defect.environment} maxLength={255}
                onSave={(v) => patchDefect({ environment: v })} editLabel={t('edit')}
              />
              <EditableMeta
                label={t('browserInfo')} value={defect.browser_info} maxLength={255}
                onSave={(v) => patchDefect({ browser_info: v })} editLabel={t('edit')}
              />
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

type Option = { value: string; label: string };
type SaveFn = (value: string) => Promise<boolean>;

const statusOptions = (t: (k: string) => string): Option[] => [
  { value: 'open', label: t('open') },
  { value: 'in_progress', label: t('inProgress') },
  { value: 'fixed', label: t('fixed') },
  { value: 'reopened', label: t('reopened') },
  { value: 'closed', label: t('closed') },
  { value: 'rejected', label: t('rejected') },
];
const severityOptions = (t: (k: string) => string): Option[] => [
  { value: 'low', label: t('low') },
  { value: 'medium', label: t('medium') },
  { value: 'high', label: t('high') },
  { value: 'critical', label: t('critical') },
];
const priorityOptions = (t: (k: string) => string): Option[] => [
  { value: 'low', label: t('low') },
  { value: 'medium', label: t('medium') },
  { value: 'high', label: t('high') },
  { value: 'urgent', label: t('urgent') },
];

// Editable metric card: label + icon with an inline select that saves on change.
function MetricSelect({
  label, value, icon, options, onSave,
}: { label: string; value: string; icon: React.ReactNode; options: Option[]; onSave: SaveFn }) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <Select
        value={value}
        disabled={saving}
        onValueChange={async (next) => {
          if (next === value) return;
          setSaving(true);
          await onSave(next);
          setSaving(false);
        }}
      >
        <SelectTrigger className="mt-2 h-9 capitalize">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SelectValue />}
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// Click-to-edit text / textarea field with save (Enter) + cancel (Esc).
function InlineEditable({
  value, onSave, placeholder, multiline = false, rows = 4, maxLength, displayClass = '', editLabel,
}: {
  value?: string | null;
  onSave: SaveFn;
  placeholder: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  displayClass?: string;
  editLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  const begin = () => { setDraft(value || ''); setEditing(true); };
  const commit = async () => {
    setSaving(true);
    const ok = await onSave(draft.trim());
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        {multiline ? (
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={rows} maxLength={maxLength} autoFocus />
        ) : (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={maxLength}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commit(); }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={commit} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            {/* reuse a generic save label via icon; text kept minimal */}
            <span className="text-xs">{editLabel}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      className="group flex w-full items-start gap-2 rounded-md text-start hover:bg-slate-50 dark:hover:bg-slate-800/40"
      title={editLabel}
    >
      <span className={`min-w-0 flex-1 ${displayClass} ${!value?.trim() ? 'text-slate-400' : ''}`}>
        {value?.trim() || placeholder}
      </span>
      <Edit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

// Read-only-styled block (description / steps / …) made click-to-edit.
function EditableTextBlock({
  label, value, empty, onSave, rows = 4, maxLength, editLabel,
}: { label: string; value?: string | null; empty: string; onSave: SaveFn; rows?: number; maxLength?: number; editLabel: string }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h3>
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <InlineEditable
          value={value}
          onSave={onSave}
          placeholder={empty}
          multiline
          rows={rows}
          maxLength={maxLength}
          editLabel={editLabel}
          displayClass="block whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300"
        />
      </div>
    </section>
  );
}

// Sidebar assignee picker that saves on change (project members + unassigned).
function EditableAssignee({
  label, value, members, unassignedLabel, onSave,
}: {
  label: string;
  value: number | null;
  members: { id: number; name: string }[];
  unassignedLabel: string;
  onSave: (value: number | null) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  // Keep the current assignee visible even if they're no longer in the member list.
  const options = value != null && !members.some((m) => m.id === value)
    ? [{ id: value, name: `User ${value}` }, ...members]
    : members;
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <Select
        value={value != null ? String(value) : 'none'}
        disabled={saving}
        onValueChange={async (next) => {
          const id = next === 'none' ? null : Number(next);
          if (id === value) return;
          setSaving(true);
          await onSave(id);
          setSaving(false);
        }}
      >
        <SelectTrigger className="mt-1 h-9">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SelectValue />}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{unassignedLabel}</SelectItem>
          {options.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// Sidebar meta value that is click-to-edit.
function EditableMeta({
  label, value, onSave, maxLength, editLabel,
}: { label: string; value?: string | null; onSave: SaveFn; maxLength?: number; editLabel: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1">
        <InlineEditable
          value={value}
          onSave={onSave}
          placeholder="-"
          maxLength={maxLength}
          editLabel={editLabel}
          displayClass="text-sm text-slate-800 dark:text-slate-200"
        />
      </div>
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
