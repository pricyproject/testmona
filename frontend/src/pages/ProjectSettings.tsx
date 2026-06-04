import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, SlidersHorizontal, Save, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { projectAssignmentsAPI, projectsAPI, getApiErrorMessage } from '@/lib/api';
import { isAdminUser, normalizeRole, USER_ROLES } from '@/utils/roles';
import {
  PROJECT_FEATURES,
  PROJECT_FEATURE_KEYS,
  normalizeFeatures,
  type ProjectFeatureKey,
} from '@/lib/projectFeatures';

type FeatureState = Record<ProjectFeatureKey, boolean>;

const serialize = (features: FeatureState) =>
  PROJECT_FEATURE_KEYS.map((key) => `${key}:${features[key] ? 1 : 0}`).join('|');

export function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser } = useAuthStore();
  const { projects, updateProject } = useProjectStore();

  const numericProjectId = projectId ? Number(projectId) : null;

  const [projectName, setProjectName] = useState<string>('');
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [projectRole, setProjectRole] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureState>(() => normalizeFeatures(null));
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = Boolean(ownerId && currentUser && ownerId === currentUser.id);
  const hasManagerAssignment =
    projectRole === USER_ROLES.ADMIN || projectRole === USER_ROLES.MANAGER;
  const canManage = Boolean(
    isAdminUser(currentUser) ||
      normalizeRole(currentUser?.role) === USER_ROLES.MANAGER ||
      isOwner ||
      hasManagerAssignment,
  );

  const isDirty = useMemo(
    () => serialize(features) !== savedSnapshot,
    [features, savedSnapshot],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!numericProjectId || Number.isNaN(numericProjectId)) {
        setError(t('invalidProjectId'));
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const [project, featureData] = await Promise.all([
          projectsAPI.getById(numericProjectId),
          projectsAPI.getFeatures(numericProjectId),
        ]);
        if (cancelled) return;
        setProjectName(project.name);
        setOwnerId(project.owner_id ?? null);
        const normalized = normalizeFeatures(featureData.features);
        setFeatures(normalized);
        setSavedSnapshot(serialize(normalized));

        // Best-effort: resolve this user's project-level role to decide if the
        // toggles are editable. A 403 (non-manager) just leaves it read-only.
        try {
          const members = await projectAssignmentsAPI.listMembers(numericProjectId);
          if (cancelled) return;
          const mine = (members as Array<{ user_id: number; role: string }>).find(
            (m) => m.user_id === currentUser?.id,
          );
          setProjectRole(mine ? normalizeRole(mine.role) : null);
        } catch {
          /* read-only fallback */
        }
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, t('failedToLoadProjectSettings')));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [numericProjectId, currentUser?.id]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof PROJECT_FEATURES>();
    for (const feature of PROJECT_FEATURES) {
      if (!byGroup.has(feature.groupKey)) {
        byGroup.set(feature.groupKey, []);
        order.push(feature.groupKey);
      }
      byGroup.get(feature.groupKey)!.push(feature);
    }
    return order.map((groupKey) => ({ groupKey, items: byGroup.get(groupKey)! }));
  }, []);

  const enabledCount = PROJECT_FEATURE_KEYS.filter((key) => features[key]).length;

  const handleToggle = (key: ProjectFeatureKey, value: boolean) => {
    setFeatures((prev) => ({ ...prev, [key]: value }));
  };

  // Group-level apply: enable/disable every feature in a group at once.
  const groupSummary = (items: typeof PROJECT_FEATURES) => {
    const enabled = items.filter((f) => features[f.key]).length;
    return { enabled, total: items.length, allOn: enabled === items.length };
  };

  const handleGroupToggle = (items: typeof PROJECT_FEATURES, value: boolean) => {
    setFeatures((prev) => {
      const next = { ...prev };
      for (const f of items) next[f.key] = value;
      return next;
    });
  };

  const handleReset = () => {
    // Restore the last-saved toggles, discarding unsaved edits.
    setFeatures((prev) => {
      const restored = { ...prev };
      for (const part of savedSnapshot.split('|')) {
        const [key, val] = part.split(':');
        restored[key as ProjectFeatureKey] = val === '1';
      }
      return restored;
    });
  };

  const handleSave = async () => {
    if (!numericProjectId || !canManage) return;
    setIsSaving(true);
    try {
      const updated = await projectsAPI.updateFeatures(numericProjectId, features);
      const normalized = normalizeFeatures(updated.features);
      setFeatures(normalized);
      setSavedSnapshot(serialize(normalized));

      // Keep the store (and therefore the sidebar) in sync without dropping the
      // cached counts the list endpoint provides.
      const existing = projects.find((p) => p.id === numericProjectId);
      if (existing) {
        updateProject({ ...existing, features: normalized });
      }
      toast({ title: t('success'), description: t('projectSettingsSaved') });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToSaveProjectSettings')),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!numericProjectId || Number.isNaN(numericProjectId)) {
    return <div className="p-6 text-sm text-muted-foreground">{t('invalidProjectId')}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="gap-1">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('projects')}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('projectSettings')}</h1>
            <p className="text-sm text-muted-foreground">{projectName || t('loading')}</p>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isDirty || isSaving}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              {t('reset')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving} className="gap-2">
              <Save className="h-4 w-4" />
              {isSaving ? t('saving') : t('saveChanges')}
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            {t('features')}
          </CardTitle>
          <CardDescription>{t('projectFeaturesDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          ) : isLoading ? (
            <div className="text-sm text-muted-foreground">{t('loading')}</div>
          ) : (
            <div className="space-y-6">
              {!canManage && (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  {t('projectFeaturesReadOnly')}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {enabledCount} / {PROJECT_FEATURE_KEYS.length} {t('featuresEnabled')}
              </div>
              {groups.map(({ groupKey, items }) => {
                const summary = groupSummary(items);
                return (
                <div key={groupKey} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t(groupKey)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {summary.enabled}/{summary.total}
                      </span>
                    </div>
                    <label className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {summary.allOn ? t('disableAll') : t('enableAll')}
                      </span>
                      <Switch
                        checked={summary.allOn}
                        onCheckedChange={(value) => handleGroupToggle(items, value)}
                        disabled={!canManage || isSaving}
                        aria-label={`${t(groupKey)} — ${summary.allOn ? t('disableAll') : t('enableAll')}`}
                      />
                    </label>
                  </div>
                  <div className="divide-y rounded-lg border">
                    {items.map((feature) => {
                      const Icon = feature.icon;
                      const checked = features[feature.key];
                      return (
                        <div
                          key={feature.key}
                          className="flex items-center justify-between gap-4 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{t(feature.labelKey)}</span>
                                {!checked && (
                                  <Badge variant="outline" className="text-xs">
                                    {t('disabled')}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {t(feature.descriptionKey)}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={checked}
                            onCheckedChange={(value) => handleToggle(feature.key, value)}
                            disabled={!canManage || isSaving}
                            aria-label={t(feature.labelKey)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
