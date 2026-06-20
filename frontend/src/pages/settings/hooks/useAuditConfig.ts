// Audit-trail configuration data + actions for the Audit tab, extracted from
// the SettingsPage monolith.
import { useCallback, useEffect, useState } from 'react';
import { api, auditAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';

export function useAuditConfig() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [projects, setProjects] = useState<any[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [entitySettings, setEntitySettings] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectAuditCounts, setProjectAuditCounts] = useState<Record<string, number>>({});
  const [deletingProjectAudit, setDeletingProjectAudit] = useState(false);

  const ok = useCallback((description: string) => toast({ title: t('success'), description }), [toast, t]);
  const fail = useCallback((description: string) => toast({ title: t('error'), description, variant: 'destructive' }), [toast, t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, projectsRes] = await Promise.all([
        api.get('/system/settings/audit-trail-config'),
        api.get('/projects').catch(() => ({ data: [] })),
      ]);
      if (data) {
        setEnabled(data.enabled ?? true);
        setEntitySettings(data.entity_settings || {});
      }
      setProjects(Array.isArray(projectsRes.data) ? projectsRes.data : []);
      try {
        setProjectAuditCounts(await auditAPI.getProjectAuditCounts());
      } catch {
        setProjectAuditCounts({});
      }
    } catch {
      setEnabled(true);
      setEntitySettings({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleEntity = useCallback((entityType: string, value: boolean) => {
    setEnabled((globalEnabled) => {
      if (globalEnabled) setEntitySettings((prev) => ({ ...prev, [entityType]: value }));
      return globalEnabled;
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.put('/system/settings/audit-trail-config', { enabled, entity_settings: entitySettings });
      ok(t('auditConfigSaved'));
    } catch {
      fail(t('auditConfigSaveFailed'));
    } finally {
      setSaving(false);
    }
  }, [enabled, entitySettings, ok, fail, t]);

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/system/settings/audit-trail-config/reset');
      if (data) {
        setEnabled(data.enabled ?? true);
        setEntitySettings(data.entity_settings || {});
      }
      ok(t('auditConfigReset'));
    } catch {
      fail(t('auditConfigResetFailed'));
    } finally {
      setSaving(false);
    }
  }, [ok, fail, t]);

  const deleteAll = useCallback(async () => {
    setSaving(true);
    try {
      const { data } = await api.delete('/system/settings/audit-trails/all');
      setProjectAuditCounts({});
      ok(data?.message || t('deleteAllAuditTrailsSuccess'));
    } catch {
      fail(t('deleteAllAuditTrailsError'));
    } finally {
      setSaving(false);
    }
  }, [ok, fail, t]);

  const deleteProject = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setDeletingProjectAudit(true);
    try {
      const data = await auditAPI.deleteProjectAuditTrails(Number(projectId));
      setProjectAuditCounts((prev) => { const next = { ...prev }; delete next[projectId]; return next; });
      ok(data?.message || t('deleteAllAuditTrailsSuccess'));
    } catch {
      fail(t('deleteAllAuditTrailsError'));
    } finally {
      setDeletingProjectAudit(false);
    }
  }, [ok, fail, t]);

  return {
    projects,
    enabled,
    setEnabled,
    entitySettings,
    loading,
    saving,
    projectAuditCounts,
    deletingProjectAudit,
    toggleEntity,
    save,
    reset,
    deleteAll,
    deleteProject,
  };
}

export type AuditConfigData = ReturnType<typeof useAuditConfig>;

export const AUDIT_ENTITY_KEYS = [
  'user', 'project', 'test_case', 'test_suite', 'test_run', 'test_result',
  'test_plan', 'requirement', 'defect', 'milestone', 'custom_field', 'system_setting',
] as const;
