// Issue-tracker integrations data + mutations for the Integrations tab,
// extracted from the SettingsPage monolith.
//
// Improvements vs. the original inline implementation:
//  - Per-integration "testing" state (the old single boolean disabled every
//    test button at once).
//  - Functional state updates; server is the source of truth after each write.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { defectManagementAPI, IssueTrackerIntegration } from '@/lib/defectManagementAPI';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';

export interface IntegrationForm {
  name: string;
  tracker_type: string;
  api_url: string;
  api_token: string;
  username: string;
  project_key: string;
  sync_direction: string;
  is_active: boolean;
}

export const emptyIntegrationForm = (): IntegrationForm => ({
  name: '',
  tracker_type: 'jira',
  api_url: '',
  api_token: '',
  username: '',
  project_key: '',
  sync_direction: 'bidirectional',
  is_active: true,
});

export function useIntegrations(preferredProjectId?: number) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [projects, setProjects] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(preferredProjectId ?? null);
  const [integrations, setIntegrations] = useState<IssueTrackerIntegration[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [testingId, setTestingId] = useState<number | null>(null);

  const success = useCallback((description: string) => toast({ title: t('success'), description }), [toast, t]);
  const error = useCallback(
    (err: unknown, fallback: string) => {
      const detail = (err as any)?.response?.data?.detail;
      const message = typeof detail === 'string' && detail
        ? detail
        : Array.isArray(detail) && detail[0]?.msg ? detail[0].msg : fallback;
      toast({ title: t('error'), description: message, variant: 'destructive' });
    },
    [toast, t],
  );

  // Load projects once; auto-select the preferred (or first) project.
  useEffect(() => {
    let cancelled = false;
    setLoadingProjects(true);
    api.get('/projects')
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        setSelectedProjectId((current) => {
          if (current && list.some((p: any) => p.id === current)) return current;
          if (preferredProjectId && list.some((p: any) => p.id === preferredProjectId)) return preferredProjectId;
          return list.length > 0 ? list[0].id : null;
        });
      })
      .catch(() => { if (!cancelled) { setProjects([]); setSelectedProjectId(null); } })
      .finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [preferredProjectId]);

  const loadIntegrations = useCallback(async () => {
    if (!selectedProjectId) { setLoadingIntegrations(false); return; }
    setLoadingIntegrations(true);
    try {
      setIntegrations(await defectManagementAPI.getIssueTrackerIntegrations(selectedProjectId));
    } catch (err) {
      error(err, t('failedToLoadIntegrations'));
    } finally {
      setLoadingIntegrations(false);
    }
  }, [selectedProjectId, error, t]);

  useEffect(() => {
    if (selectedProjectId) loadIntegrations();
    else setLoadingIntegrations(false);
  }, [selectedProjectId, loadIntegrations]);

  const saveIntegration = useCallback(async (
    form: IntegrationForm,
    editing: IssueTrackerIntegration | null,
  ): Promise<boolean> => {
    if (!selectedProjectId) return false;
    try {
      if (editing) {
        await defectManagementAPI.updateIssueTrackerIntegration(selectedProjectId, editing.id, form);
        success(t('integrationUpdatedSuccessfully'));
      } else {
        await defectManagementAPI.createIssueTrackerIntegration(selectedProjectId, form);
        success(t('integrationCreatedSuccessfully'));
      }
      await loadIntegrations();
      return true;
    } catch (err) {
      error(err, t('integrationSaveFailed'));
      return false;
    }
  }, [selectedProjectId, success, error, t, loadIntegrations]);

  const deleteIntegration = useCallback(async (integration: IssueTrackerIntegration): Promise<void> => {
    if (!selectedProjectId) return;
    try {
      await defectManagementAPI.deleteIssueTrackerIntegration(selectedProjectId, integration.id);
      success(t('integrationDeletedSuccessfully'));
      await loadIntegrations();
    } catch (err) {
      error(err, t('integrationDeleteFailed'));
    }
  }, [selectedProjectId, success, error, t, loadIntegrations]);

  const testConnection = useCallback(async (integrationId: number): Promise<void> => {
    if (!selectedProjectId) return;
    setTestingId(integrationId);
    try {
      const result = await defectManagementAPI.testIssueTrackerConnection(selectedProjectId, integrationId);
      if (result.success) {
        success(t('connectionTestPassed'));
      } else {
        toast({ title: t('connectionFailed'), description: result.message || t('connectionTestFailed'), variant: 'destructive' });
      }
    } catch (err) {
      error(err, t('connectionTestFailed'));
    } finally {
      setTestingId(null);
    }
  }, [selectedProjectId, success, error, toast, t]);

  return {
    projects,
    loadingProjects,
    selectedProjectId,
    setSelectedProjectId,
    integrations,
    loadingIntegrations,
    testingId,
    reload: loadIntegrations,
    saveIntegration,
    deleteIntegration,
    testConnection,
  };
}

export type IntegrationsData = ReturnType<typeof useIntegrations>;

// Sync-status → token-based badge classes (replaces hardcoded gray/blue/green/red).
export function syncStatusBadgeClass(status: string): string {
  switch (status) {
    case 'syncing': return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
    case 'synced': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'error': return 'bg-destructive/15 text-destructive';
    default: return 'bg-muted text-muted-foreground';
  }
}

// Client-side form validation (mirrors the backend's expectations).
export function validateIntegrationForm(
  form: IntegrationForm,
  editing: boolean,
  t: (k: string, p?: Record<string, string | number>) => string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = t('integrationNameRequired');
  else if (form.name.length < 3) errors.name = t('integrationNameMinLength');
  else if (form.name.length > 100) errors.name = t('integrationNameMaxLength');

  if (!form.api_url.trim()) {
    errors.api_url = t('apiUrlRequired');
  } else {
    try {
      const url = new URL(form.api_url);
      if (!['http:', 'https:'].includes(url.protocol)) errors.api_url = t('apiUrlProtocol');
    } catch {
      errors.api_url = t('apiUrlValidUrl');
    }
  }

  if (!editing && !form.api_token.trim()) errors.api_token = t('apiTokenRequired');
  else if (form.api_token && form.api_token.length < 8) errors.api_token = t('apiTokenMinLength');

  if (['jira', 'github', 'gitlab'].includes(form.tracker_type)) {
    if (!form.project_key.trim()) errors.project_key = t('projectKeyRequired');
    else if (form.project_key.length < 2) errors.project_key = t('projectKeyMinLength');
  }
  return errors;
}

// `projectKeyLiteral` is shown verbatim; `projectKeyI18n` is a translation key.
// Every other label/desc/name field is an i18n key resolved via `t`.
const TRACKER_PLACEHOLDERS: Record<string, {
  apiUrl: string; projectKeyLiteral?: string; projectKeyI18n?: string;
  projectKeyLabel: string; projectKeyDesc: string; nameKey: string;
}> = {
  jira: { apiUrl: 'https://your-domain.atlassian.net', projectKeyLiteral: 'TEST', projectKeyLabel: 'projectKeyLabel', projectKeyDesc: 'projectKeyDesc', nameKey: 'integrationNamePlaceholder' },
  github: { apiUrl: 'https://api.github.com', projectKeyLiteral: 'owner/repo', projectKeyLabel: 'repositoryLabel', projectKeyDesc: 'repositoryDesc', nameKey: 'githubIntegrationNamePlaceholder' },
  gitlab: { apiUrl: 'https://gitlab.com/api/v4', projectKeyLiteral: 'namespace/project', projectKeyLabel: 'projectPathLabel', projectKeyDesc: 'projectPathDesc', nameKey: 'gitlabIntegrationNamePlaceholder' },
  'azure-devops': { apiUrl: 'https://dev.azure.com/your-org', projectKeyI18n: 'projectNamePlaceholder', projectKeyLabel: 'projectNameLabel', projectKeyDesc: 'projectNameDesc', nameKey: 'azureDevopsIntegrationNamePlaceholder' },
  linear: { apiUrl: 'https://api.linear.app', projectKeyI18n: 'teamKeyPlaceholder', projectKeyLabel: 'teamKeyLabel', projectKeyDesc: 'teamKeyDesc', nameKey: 'linearIntegrationNamePlaceholder' },
  asana: { apiUrl: 'https://app.asana.com/api/1.0', projectKeyI18n: 'projectGidPlaceholder', projectKeyLabel: 'projectGidLabel', projectKeyDesc: 'projectGidDesc', nameKey: 'asanaIntegrationNamePlaceholder' },
};

export function trackerPlaceholders(trackerType: string, t: (k: string) => string) {
  const p = TRACKER_PLACEHOLDERS[trackerType] || TRACKER_PLACEHOLDERS.jira;
  return {
    name: t(p.nameKey),
    apiUrl: p.apiUrl,
    projectKey: p.projectKeyLiteral ?? (p.projectKeyI18n ? t(p.projectKeyI18n) : ''),
    projectKeyLabel: t(p.projectKeyLabel),
    projectKeyDesc: t(p.projectKeyDesc),
  };
}
