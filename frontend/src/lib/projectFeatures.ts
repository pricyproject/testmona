import {
  FileCheck,
  BookOpen,
  History,
  FileText,
  TestTube,
  PlayCircle,
  Flag,
  ClipboardList,
  Bug,
  ScanSearch,
  BarChart3,
  HeartPulse,
  Sparkles,
  Database,
  Layers,
  Wrench,
  Table2,
  Webhook,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * Per-project feature toggles. Mirror of the backend catalog in
 * `backend/app/features.py` — keep the two key lists in sync.
 *
 * A feature is *enabled by default*: a key missing from a project's stored
 * `features` map is treated as on, so existing projects keep everything until an
 * admin/owner/manager turns something off.
 */
export type ProjectFeatureKey =
  | 'requirements'
  | 'doc_hub'
  | 'doc_revisions'
  | 'test_cases'
  | 'test_suites'
  | 'test_runs'
  | 'milestones'
  | 'test_plans'
  | 'defects'
  | 'advanced_search'
  | 'reports'
  | 'test_asset_health'
  | 'ask_ai'
  | 'custom_fields'
  | 'shared_steps'
  | 'global_parameters'
  | 'test_data'
  | 'webhooks'
  | 'environments';

export interface ProjectFeatureMeta {
  key: ProjectFeatureKey;
  /** Translation key for the feature's display name (reuses existing nav labels). */
  labelKey: string;
  /** Translation key for a one-line description on the settings page. */
  descriptionKey: string;
  icon: LucideIcon;
  /** Translation key for the group heading on the settings page. */
  groupKey: string;
}

export const PROJECT_FEATURES: ProjectFeatureMeta[] = [
  { key: 'ask_ai', labelKey: 'navAskAi', descriptionKey: 'featureDescAskAi', icon: Sparkles, groupKey: 'main' },
  { key: 'requirements', labelKey: 'requirements', descriptionKey: 'featureDescRequirements', icon: FileCheck, groupKey: 'testing' },
  { key: 'doc_hub', labelKey: 'docHub', descriptionKey: 'featureDescDocHub', icon: BookOpen, groupKey: 'testing' },
  { key: 'doc_revisions', labelKey: 'featureDocRevisions', descriptionKey: 'featureDescDocRevisions', icon: History, groupKey: 'testing' },
  { key: 'test_cases', labelKey: 'testCases', descriptionKey: 'featureDescTestCases', icon: FileText, groupKey: 'testing' },
  { key: 'test_suites', labelKey: 'testSuites', descriptionKey: 'featureDescTestSuites', icon: TestTube, groupKey: 'testing' },
  { key: 'test_runs', labelKey: 'testRuns', descriptionKey: 'featureDescTestRuns', icon: PlayCircle, groupKey: 'testing' },
  { key: 'milestones', labelKey: 'milestones', descriptionKey: 'featureDescMilestones', icon: Flag, groupKey: 'planning' },
  { key: 'test_plans', labelKey: 'testPlans', descriptionKey: 'featureDescTestPlans', icon: ClipboardList, groupKey: 'planning' },
  { key: 'defects', labelKey: 'defects', descriptionKey: 'featureDescDefects', icon: Bug, groupKey: 'management' },
  { key: 'advanced_search', labelKey: 'advancedSearch', descriptionKey: 'featureDescAdvancedSearch', icon: ScanSearch, groupKey: 'management' },
  { key: 'reports', labelKey: 'reports', descriptionKey: 'featureDescReports', icon: BarChart3, groupKey: 'management' },
  { key: 'test_asset_health', labelKey: 'testAssetHealth', descriptionKey: 'featureDescTestAssetHealth', icon: HeartPulse, groupKey: 'management' },
  { key: 'custom_fields', labelKey: 'customFields', descriptionKey: 'featureDescCustomFields', icon: Database, groupKey: 'configuration' },
  { key: 'shared_steps', labelKey: 'sharedSteps', descriptionKey: 'featureDescSharedSteps', icon: Layers, groupKey: 'configuration' },
  { key: 'global_parameters', labelKey: 'globalParameters', descriptionKey: 'featureDescGlobalParameters', icon: Wrench, groupKey: 'configuration' },
  { key: 'test_data', labelKey: 'testData', descriptionKey: 'featureDescTestData', icon: Table2, groupKey: 'configuration' },
  { key: 'webhooks', labelKey: 'webhooks', descriptionKey: 'featureDescWebhooks', icon: Webhook, groupKey: 'configuration' },
  { key: 'environments', labelKey: 'environments', descriptionKey: 'featureDescEnvironments', icon: Settings, groupKey: 'global' },
];

export const PROJECT_FEATURE_KEYS: ProjectFeatureKey[] = PROJECT_FEATURES.map((f) => f.key);

export type ProjectFeatureMap = Partial<Record<string, boolean>>;

/**
 * Whether a feature is enabled for a project. Defaults to enabled when the map
 * is absent or the key is missing, matching backend `is_feature_enabled`.
 */
export function isFeatureEnabled(
  features: ProjectFeatureMap | null | undefined,
  key: string,
): boolean {
  if (!features) return true;
  const value = features[key];
  return value === undefined ? true : value !== false;
}

/** Build a complete, defaulted map from a (possibly partial) stored value. */
export function normalizeFeatures(features: ProjectFeatureMap | null | undefined): Record<ProjectFeatureKey, boolean> {
  const out = {} as Record<ProjectFeatureKey, boolean>;
  for (const key of PROJECT_FEATURE_KEYS) {
    out[key] = isFeatureEnabled(features, key);
  }
  return out;
}
