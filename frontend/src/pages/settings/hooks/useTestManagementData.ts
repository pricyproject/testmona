// All data + mutations for the Test Management tab, extracted from the old
// SettingsPage monolith. This hook owns loading, the entity catalogs (test
// types / priorities / shared-step templates) and the execution / notification
// / automation settings, and exposes typed handlers to the section components.
//
// Bug fixes vs. the original inline implementation:
//  - Optimistic state updates use functional updaters (no stale-closure drops).
//  - `created_by` no longer falls back to the bogus user id 1.
//  - Priority `value` is validated/clamped before submit (no NaN -> 422).
//  - Backend 409 (duplicate name) is surfaced with the server's message.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, testManagementAPI, notificationCategoryPrefsAPI, NotificationCategoryInfo } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import {
  TestType,
  Priority,
  SharedStepTemplate,
  SharedStepTemplateForm,
  SharedStepTemplateFormErrors,
  TestTypeForm,
  PriorityForm,
  TestExecutionSettings,
  NotificationSettings,
  UserNotificationPreferences,
  AutomationSettings,
  SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH,
  SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH,
  SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS,
  SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH,
  SHARED_STEP_TEMPLATE_MIN_TIME,
  SHARED_STEP_TEMPLATE_MAX_TIME,
} from '../types';

const PRIORITY_MIN = 1;
const PRIORITY_MAX = 10;

export function useTestManagementData(projectId?: number) {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [testTypes, setTestTypes] = useState<TestType[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [sharedStepTemplates, setSharedStepTemplates] = useState<SharedStepTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [testExecutionSettings, setTestExecutionSettings] = useState<TestExecutionSettings>({
    auto_save_interval: 30,
    screenshot_on_failure: true,
    video_recording: false,
    step_timeout: 300,
    retry_attempts: 2,
    parallel_execution: true,
    max_parallel_threads: 4,
    cleanup_on_failure: true,
  });
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    email_notifications: true,
    slack_notifications: false,
    test_failure_alerts: true,
    test_completion_reports: true,
    weekly_summary: true,
    real_time_updates: false,
  });
  const [userNotificationPrefs, setUserNotificationPrefs] = useState<UserNotificationPreferences>({
    do_not_disturb: false,
    notification_sound_enabled: true,
    notifications_muted_until: null,
  });
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>({
    ai_suggestions: false,
    smart_step_recommendations: true,
    auto_categorization: false,
    duplicate_detection: true,
    performance_optimization: true,
  });
  const [categoryPrefs, setCategoryPrefs] = useState<NotificationCategoryInfo[]>([]);
  const [savingCategoryPrefs, setSavingCategoryPrefs] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // ---- toast helpers ------------------------------------------------------
  const showSuccess = useCallback(
    (description: string) => toast({ title: t('success'), description }),
    [toast, t],
  );
  const showError = useCallback(
    (description: string) => toast({ title: t('error'), description, variant: 'destructive' }),
    [toast, t],
  );
  const errorDetail = useCallback(
    (err: unknown, fallback: string): string => {
      const detail = (err as any)?.response?.data?.detail;
      if (typeof detail === 'string' && detail) return detail;
      if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
      return fallback;
    },
    [],
  );

  // ---- mapping helpers ----------------------------------------------------
  const mapSharedStepTemplate = useCallback((template: any): SharedStepTemplate => ({
    id: template.id.toString(),
    name: template.name,
    description: template.description || '',
    category: template.category,
    tags: template.tags || [],
    complexity: template.complexity,
    estimated_time: template.estimated_time,
    prerequisites: template.prerequisites || [],
    related_steps: template.related_steps || [],
    usage_count: template.usage_count || 0,
    is_active: template.is_active,
    created_at: template.created_at,
  }), []);

  // ---- load ---------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = projectId ? `?project_id=${projectId}` : '';
      const [typesRes, prioritiesRes] = await Promise.all([
        api.get('/test-type-definitions/' + scope),
        api.get('/priority-definitions/' + scope),
      ]);
      setTestTypes(
        (typesRes.data as any[]).map((type) => ({
          id: type.id.toString(),
          name: type.name,
          description: type.description || `${type.name}`,
          color: type.color,
          icon: type.icon,
          is_active: type.is_active,
          usage_count: type.usage_count || 0,
          created_at: type.created_at,
          is_custom: true,
        })),
      );
      setPriorities(
        (prioritiesRes.data as any[]).map((priority) => ({
          id: priority.id.toString(),
          name: priority.name,
          value: priority.value,
          color: priority.color,
          description: priority.description || '',
          is_default: priority.is_default,
          is_active: priority.is_active,
          created_at: priority.created_at,
          is_custom: true,
        })),
      );

      try {
        const templates = await testManagementAPI.getSharedStepTemplates(0, 100, projectId);
        setSharedStepTemplates((templates as any[]).map(mapSharedStepTemplate));
      } catch {
        // Shared-step templates unavailable — fall back to empty.
      }

      try {
        const [exec, notif, autom, userPrefs, catPrefs] = await Promise.all([
          testManagementAPI.getTestExecutionSettings(),
          testManagementAPI.getNotificationSettings(),
          testManagementAPI.getAutomationSettings(),
          testManagementAPI.getUserNotificationPreferences(),
          notificationCategoryPrefsAPI.get().catch(() => []),
        ]);
        if (exec) setTestExecutionSettings(exec);
        if (notif) setNotificationSettings(notif);
        if (autom) setAutomationSettings(autom);
        if (userPrefs) setUserNotificationPrefs(userPrefs);
        if (catPrefs) setCategoryPrefs(catPrefs);
      } catch {
        // Settings not yet created — keep defaults.
      }
    } catch (err) {
      console.error('Failed to load test management settings:', err);
      setError(t('failedToLoadTestManagementSettings'));
    } finally {
      setLoading(false);
    }
  }, [projectId, mapSharedStepTemplate, t]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- test types ---------------------------------------------------------
  const createTestType = useCallback(async (form: TestTypeForm): Promise<boolean> => {
    try {
      const { data } = await api.post('/test-type-definitions/', {
        project_id: projectId,
        name: form.name,
        description: form.description,
        color: form.color,
        icon: form.icon,
        created_by: user?.id,
      });
      setTestTypes((current) => [
        ...current,
        {
          id: data.id.toString(),
          name: data.name,
          description: data.description,
          color: data.color,
          icon: data.icon,
          is_active: data.is_active,
          usage_count: data.usage_count || 0,
          created_at: data.created_at,
          is_custom: true,
        },
      ]);
      showSuccess(t('testTypeCreatedSuccessfully', { name: data.name }));
      return true;
    } catch (err) {
      showError(errorDetail(err, t('failedToCreateTestType')));
      return false;
    }
  }, [projectId, user?.id, showSuccess, showError, errorDetail, t]);

  const updateTestType = useCallback(async (id: string, form: TestTypeForm): Promise<boolean> => {
    try {
      const { data } = await api.put(`/test-type-definitions/${id}`, {
        name: form.name,
        description: form.description,
        color: form.color,
        icon: form.icon,
      });
      setTestTypes((current) =>
        current.map((type) =>
          type.id === id
            ? { ...type, name: data.name, description: data.description, color: data.color, icon: data.icon }
            : type,
        ),
      );
      showSuccess(t('testTypeUpdatedSuccessfully'));
      return true;
    } catch (err) {
      showError(errorDetail(err, t('failedToUpdateTestType')));
      return false;
    }
  }, [showSuccess, showError, errorDetail, t]);

  const deleteTestType = useCallback(async (id: string): Promise<void> => {
    try {
      await api.delete(`/test-type-definitions/${id}`);
      setTestTypes((current) => current.map((type) => (type.id === id ? { ...type, is_active: false } : type)));
    } catch (err) {
      showError(errorDetail(err, t('failedToDeleteTestType')));
    }
  }, [showError, errorDetail, t]);

  // ---- priorities ---------------------------------------------------------
  const createPriority = useCallback(async (form: PriorityForm): Promise<boolean> => {
    const value = clampPriorityValue(form.value);
    if (value === null) {
      showError(t('priorityValueRange'));
      return false;
    }
    try {
      const { data } = await api.post('/priority-definitions/', {
        project_id: projectId,
        name: form.name,
        value,
        color: form.color,
        description: form.description,
        is_default: form.is_default,
        created_by: user?.id,
      });
      setPriorities((current) => {
        // If the new one is default, the server cleared the others — mirror it.
        const next = form.is_default ? current.map((p) => ({ ...p, is_default: false })) : current;
        return [
          ...next,
          {
            id: data.id.toString(),
            name: data.name,
            value: data.value,
            color: data.color,
            description: data.description || '',
            is_default: data.is_default,
            is_active: data.is_active,
            created_at: data.created_at,
            is_custom: true,
          },
        ];
      });
      showSuccess(t('priorityCreatedSuccessfully', { name: data.name }));
      return true;
    } catch (err) {
      showError(errorDetail(err, t('failedToCreatePriority')));
      return false;
    }
  }, [projectId, user?.id, showSuccess, showError, errorDetail, t]);

  const updatePriority = useCallback(async (id: string, form: PriorityForm): Promise<boolean> => {
    const value = clampPriorityValue(form.value);
    if (value === null) {
      showError(t('priorityValueRange'));
      return false;
    }
    try {
      const { data } = await api.put(`/priority-definitions/${id}`, {
        name: form.name,
        value,
        color: form.color,
        description: form.description,
        is_default: form.is_default,
      });
      setPriorities((current) =>
        current.map((priority) => {
          if (priority.id === id) {
            return {
              ...priority,
              name: data.name,
              value: data.value,
              color: data.color,
              description: data.description || '',
              is_default: data.is_default,
            };
          }
          // The server clears other defaults when this becomes default.
          return data.is_default ? { ...priority, is_default: false } : priority;
        }),
      );
      showSuccess(t('priorityUpdatedSuccessfully'));
      return true;
    } catch (err) {
      showError(errorDetail(err, t('failedToUpdatePriority')));
      return false;
    }
  }, [showSuccess, showError, errorDetail, t]);

  const deletePriority = useCallback(async (id: string): Promise<void> => {
    try {
      await api.delete(`/priority-definitions/${id}`);
      setPriorities((current) => current.map((p) => (p.id === id ? { ...p, is_active: false } : p)));
    } catch (err) {
      showError(errorDetail(err, t('failedToDeletePriority')));
    }
  }, [showError, errorDetail, t]);

  // ---- shared step templates ---------------------------------------------
  const validateSharedStepForm = useCallback((form: SharedStepTemplateForm): SharedStepTemplateFormErrors => {
    const errors: SharedStepTemplateFormErrors = {};
    const name = form.name.trim();
    const description = form.description.trim();
    const estimatedTime = Number(form.estimated_time);

    if (!name) {
      errors.name = t('fieldRequired', { field: t('name') });
    } else if (name.length > SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH) {
      errors.name = t('sharedStepTemplateFieldTooLong', { field: t('name'), max: SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH });
    }
    if (description.length > SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH) {
      errors.description = t('sharedStepTemplateFieldTooLong', { field: t('description'), max: SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH });
    }
    if (!Number.isInteger(estimatedTime) || estimatedTime < SHARED_STEP_TEMPLATE_MIN_TIME || estimatedTime > SHARED_STEP_TEMPLATE_MAX_TIME) {
      errors.estimated_time = t('sharedStepTemplateEstimatedTimeRange', { min: SHARED_STEP_TEMPLATE_MIN_TIME, max: SHARED_STEP_TEMPLATE_MAX_TIME });
    }
    (['tags', 'prerequisites', 'related_steps'] as const).forEach((field) => {
      const items = parseTemplateList(form[field]);
      const label = field === 'tags' ? t('tags') : field === 'prerequisites' ? t('prerequisites') : t('relatedSteps');
      if (items.length > SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS) {
        errors[field] = t('sharedStepTemplateListTooLong', { field: label, max: SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS });
      } else if (items.some((item) => item.length > SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH)) {
        errors[field] = t('sharedStepTemplateListItemTooLong', { field: label, max: SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH });
      }
    });
    return errors;
  }, [t]);

  const buildSharedStepPayload = useCallback((form: SharedStepTemplateForm) => ({
    project_id: projectId,
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category,
    tags: parseTemplateList(form.tags),
    complexity: form.complexity,
    estimated_time: Number(form.estimated_time),
    prerequisites: parseTemplateList(form.prerequisites),
    related_steps: parseTemplateList(form.related_steps),
  }), [projectId]);

  const createSharedStep = useCallback(async (form: SharedStepTemplateForm): Promise<boolean> => {
    try {
      const created = await testManagementAPI.createSharedStepTemplate(buildSharedStepPayload(form));
      setSharedStepTemplates((current) => [...current, mapSharedStepTemplate(created)]);
      showSuccess(t('sharedStepTemplateCreatedSuccessfully'));
      return true;
    } catch (err) {
      showError(errorDetail(err, t('failedToCreateSharedStepTemplate')));
      return false;
    }
  }, [buildSharedStepPayload, mapSharedStepTemplate, showSuccess, showError, errorDetail, t]);

  const updateSharedStep = useCallback(async (id: string, form: SharedStepTemplateForm): Promise<boolean> => {
    try {
      const updated = await testManagementAPI.updateSharedStepTemplate(parseInt(id, 10), buildSharedStepPayload(form));
      setSharedStepTemplates((current) =>
        current.map((step) => (step.id === id ? mapSharedStepTemplate(updated) : step)),
      );
      showSuccess(t('sharedStepTemplateUpdatedSuccessfully'));
      return true;
    } catch (err) {
      showError(errorDetail(err, t('failedToUpdateSharedStepTemplate')));
      return false;
    }
  }, [buildSharedStepPayload, mapSharedStepTemplate, showSuccess, showError, errorDetail, t]);

  const deleteSharedStep = useCallback(async (id: string): Promise<void> => {
    try {
      await testManagementAPI.deleteSharedStepTemplate(parseInt(id, 10));
      setSharedStepTemplates((current) => current.map((step) => (step.id === id ? { ...step, is_active: false } : step)));
    } catch (err) {
      showError(errorDetail(err, t('failedToDeleteSharedStepTemplate')));
    }
  }, [showError, errorDetail, t]);

  // ---- notification category prefs (saved immediately on toggle) ----------
  const toggleCategoryChannel = useCallback((key: string, channel: 'in_app' | 'email', value: boolean) => {
    setCategoryPrefs((previous) => {
      const next = previous.map((c) => (c.key === key ? { ...c, [channel]: value } : c));
      setSavingCategoryPrefs(true);
      notificationCategoryPrefsAPI
        .update(next.map((c) => ({ category: c.key, in_app: c.in_app, email: c.email })))
        .then((saved) => setCategoryPrefs(saved))
        .catch((err) => {
          setCategoryPrefs(previous); // roll back
          showError(errorDetail(err, t('failedToSave')));
        })
        .finally(() => setSavingCategoryPrefs(false));
      return next;
    });
  }, [showError, errorDetail, t]);

  // ---- batch save of execution / notification / automation settings -------
  const saveSettings = useCallback(async () => {
    setSavingSettings(true);
    try {
      const promises: Promise<unknown>[] = [];
      if (testExecutionSettings.id != null) {
        promises.push(testManagementAPI.updateTestExecutionSettings(testExecutionSettings.id, testExecutionSettings));
      }
      if (notificationSettings.id != null) {
        promises.push(testManagementAPI.updateNotificationSettings(notificationSettings.id, notificationSettings));
      }
      promises.push(testManagementAPI.updateUserNotificationPreferences(userNotificationPrefs));
      if (automationSettings.id != null) {
        promises.push(testManagementAPI.updateAutomationSettings(automationSettings.id, automationSettings));
      }
      await Promise.all(promises);
      showSuccess(t('testManagementSettingsSaved'));
    } catch (err) {
      showError(errorDetail(err, t('testManagementSettingsSaveFailed')));
    } finally {
      setSavingSettings(false);
    }
  }, [testExecutionSettings, notificationSettings, userNotificationPrefs, automationSettings, showSuccess, showError, errorDetail, t]);

  return {
    // state
    testTypes,
    priorities,
    sharedStepTemplates,
    loading,
    error,
    testExecutionSettings,
    setTestExecutionSettings,
    notificationSettings,
    setNotificationSettings,
    userNotificationPrefs,
    setUserNotificationPrefs,
    automationSettings,
    setAutomationSettings,
    categoryPrefs,
    savingCategoryPrefs,
    savingSettings,
    // actions
    reload: load,
    createTestType,
    updateTestType,
    deleteTestType,
    createPriority,
    updatePriority,
    deletePriority,
    validateSharedStepForm,
    createSharedStep,
    updateSharedStep,
    deleteSharedStep,
    toggleCategoryChannel,
    saveSettings,
  };
}

export type TestManagementData = ReturnType<typeof useTestManagementData>;

// Parse a comma-separated list into a de-duplicated, trimmed array.
export function parseTemplateList(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Returns a valid 1..10 integer, or null when the field is empty/out of range.
export function clampPriorityValue(value: number | ''): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < PRIORITY_MIN || n > PRIORITY_MAX) return null;
  return n;
}

// Find the next free priority value when duplicating (prefer a lower slot).
export function nextFreePriorityValue(taken: number[], from: number): number | null {
  let v = from;
  while (taken.includes(v) && v > PRIORITY_MIN) v--;
  if (taken.includes(v)) {
    v = from + 1;
    while (taken.includes(v) && v < PRIORITY_MAX) v++;
  }
  return taken.includes(v) ? null : v;
}
