// Issue-tracker Integrations tab, extracted from the SettingsPage monolith and
// rebuilt on the shared settings primitives.
import { useState } from 'react';
import { Link as LinkIcon, Plus, FolderTree, Loader2, RefreshCw, Edit, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { IssueTrackerIntegration } from '@/lib/defectManagementAPI';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useAppName } from '@/hooks/useAppName';
import { cn } from '@/lib/utils';
import { SettingsSection, SettingsEmptyState } from '../components/SettingsPrimitives';
import {
  useIntegrations, IntegrationForm, emptyIntegrationForm,
  syncStatusBadgeClass, validateIntegrationForm, trackerPlaceholders,
} from '../hooks/useIntegrations';

const TRACKER_TYPES: Array<{ value: string; label: string }> = [
  { value: 'jira', label: 'Jira' },
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'azure-devops', label: 'Azure DevOps' },
  { value: 'linear', label: 'Linear' },
  { value: 'asana', label: 'Asana' },
];

export function IntegrationsTab({ projectId }: { projectId?: number }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { appName } = useAppName();
  const data = useIntegrations(projectId);
  const { canManageProject } = useProjectPermissions(data.selectedProjectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IssueTrackerIntegration | null>(null);
  const [form, setForm] = useState<IntegrationForm>(emptyIntegrationForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<IssueTrackerIntegration | null>(null);

  const ph = trackerPlaceholders(form.tracker_type, t);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyIntegrationForm());
    setErrors({});
    setTouched({});
    setFormOpen(true);
  };
  const openEdit = (integration: IssueTrackerIntegration) => {
    setEditing(integration);
    setForm({
      name: integration.name,
      tracker_type: integration.tracker_type,
      api_url: integration.api_url,
      api_token: '',
      username: integration.username || '',
      project_key: integration.project_key || '',
      sync_direction: integration.sync_direction,
      is_active: integration.is_active,
    });
    setErrors({});
    setTouched({});
    setFormOpen(true);
  };

  const submit = async () => {
    setTouched({ name: true, api_url: true, api_token: true, project_key: true });
    const validation = validateIntegrationForm(form, editing !== null, t);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setSaving(true);
    const ok = await data.saveIntegration(form, editing);
    setSaving(false);
    if (ok) setFormOpen(false);
  };

  const fieldError = (field: string) => (touched[field] && errors[field] ? errors[field] : '');

  return (
    <div className="space-y-6">
      <SettingsSection
        icon={LinkIcon}
        tone="blue"
        title={t('issueTrackerIntegrationsTitle')}
        action={
          <Button onClick={openAdd} disabled={!data.selectedProjectId}>
            <Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addIntegration')}
          </Button>
        }
        contentClassName="space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="integration-project">{t('selectProject')}</Label>
          <Select
            value={data.selectedProjectId?.toString()}
            onValueChange={(value) => data.setSelectedProjectId(parseInt(value, 10))}
            disabled={data.loadingProjects}
          >
            <SelectTrigger id="integration-project">
              {data.loadingProjects ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t('loadingProjects')}</span>
              ) : data.projects.length === 0 ? (
                <span>{t('noProjectsAvailable')}</span>
              ) : (
                <SelectValue placeholder={t('selectProject')} />
              )}
            </SelectTrigger>
            <SelectContent>
              {data.projects.map((project) => (
                <SelectItem key={project.id} value={project.id.toString()}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!data.selectedProjectId ? (
          <SettingsEmptyState icon={FolderTree} title={t('selectProjectToViewIntegrations')} />
        ) : data.loadingIntegrations ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : data.integrations.length === 0 ? (
          <SettingsEmptyState icon={LinkIcon} title={t('noIntegrationsTitle')} description={t('noIntegrationsDesc')} />
        ) : (
          <div className="space-y-3">
            {data.integrations.map((integration) => (
              <div key={integration.id} className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-foreground">{integration.name}</h4>
                    {!integration.is_active && <Badge variant="outline" className="text-xs">{t('inactive')}</Badge>}
                    <Badge variant="outline" className="capitalize">{integration.tracker_type}</Badge>
                    {integration.project_key && <Badge variant="outline">{integration.project_key}</Badge>}
                    <Badge className={cn('border-transparent', syncStatusBadgeClass(integration.sync_status))}>{integration.sync_status}</Badge>
                  </div>
                  {integration.last_sync && (
                    <p className="text-xs text-muted-foreground">{t('lastSync')}: {formatDateTime(integration.last_sync)}</p>
                  )}
                  {integration.sync_error && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />{integration.sync_error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => data.testConnection(integration.id)} disabled={data.testingId === integration.id}>
                    {data.testingId === integration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(integration)}><Edit className="h-4 w-4" /></Button>
                  {canManageProject && (
                    <Button size="sm" variant="outline" onClick={() => setToDelete(integration)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteIntegration')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDeleteIntegrationDesc', { name: toDelete?.name || '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { const target = toDelete; setToDelete(null); if (target) await data.deleteIntegration(target); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>{editing ? t('editIntegration') : t('addIntegrationTitle')}</DialogTitle>
            <DialogDescription>{editing ? t('updateIntegrationConfiguration') : t('configureNewIntegration')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="i-name">{t('integrationNameLabel')} *</Label>
                <Input
                  id="i-name" placeholder={ph.name} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={() => setTouched({ ...touched, name: true })}
                  aria-invalid={Boolean(fieldError('name'))}
                />
                {fieldError('name') && <p className="text-xs text-destructive">{fieldError('name')}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="i-tracker">{t('trackerType')} *</Label>
                <Select value={form.tracker_type} onValueChange={(value) => { setForm({ ...form, tracker_type: value }); setErrors({ ...errors, project_key: '' }); }}>
                  <SelectTrigger id="i-tracker"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRACKER_TYPES.map((tr) => <SelectItem key={tr.value} value={tr.value}>{tr.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="i-url">{t('apiUrlLabel')} *</Label>
              <Input
                id="i-url" placeholder={ph.apiUrl} value={form.api_url}
                onChange={(e) => setForm({ ...form, api_url: e.target.value })}
                onBlur={() => setTouched({ ...touched, api_url: true })}
                aria-invalid={Boolean(fieldError('api_url'))}
              />
              {fieldError('api_url') && <p className="text-xs text-destructive">{fieldError('api_url')}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="i-username">{t('usernameEmail')}</Label>
                <Input id="i-username" placeholder={t('usernameEmailPlaceholder')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="i-token">{t('apiTokenLabel')} {!editing ? '*' : ''}</Label>
                <Input
                  id="i-token" type="password"
                  placeholder={editing ? t('apiTokenLeaveBlank') : t('apiTokenPlaceholder')}
                  value={form.api_token}
                  onChange={(e) => setForm({ ...form, api_token: e.target.value })}
                  onBlur={() => setTouched({ ...touched, api_token: true })}
                  aria-invalid={Boolean(fieldError('api_token'))}
                />
                {fieldError('api_token') && <p className="text-xs text-destructive">{fieldError('api_token')}</p>}
                <p className="text-xs text-muted-foreground">{t('tokenEncryptedSecurely')}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="i-key">{ph.projectKeyLabel} *</Label>
              <Input
                id="i-key" placeholder={ph.projectKey} value={form.project_key}
                onChange={(e) => setForm({ ...form, project_key: e.target.value })}
                onBlur={() => setTouched({ ...touched, project_key: true })}
                aria-invalid={Boolean(fieldError('project_key'))}
              />
              {fieldError('project_key') && <p className="text-xs text-destructive">{fieldError('project_key')}</p>}
              <p className="text-xs text-muted-foreground">{ph.projectKeyDesc}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="i-direction">{t('syncDirection')}</Label>
              <Select value={form.sync_direction} onValueChange={(value) => setForm({ ...form, sync_direction: value })}>
                <SelectTrigger id="i-direction"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="import">{t('importOnly', { appName })}</SelectItem>
                  <SelectItem value="export">{t('exportOnly', { appName })}</SelectItem>
                  <SelectItem value="bidirectional">{t('bidirectional')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Switch id="i-active" checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c })} />
              <Label htmlFor="i-active" className="cursor-pointer">{t('enableThisIntegration')}</Label>
            </div>

            {editing && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle className="mr-2 inline h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('leaveApiTokenBlank')}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin rtl:ml-2 rtl:mr-0" />}
              {editing ? t('updateIntegration') : t('createIntegration')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default IntegrationsTab;
