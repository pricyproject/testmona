// Shared domain types for the Settings feature module. Extracted from the
// former 5000-line SettingsPage.tsx so each tab module can import them without
// pulling in the whole page.

export interface TestType {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  is_active: boolean;
  usage_count: number;
  created_at: string;
  is_custom?: boolean;
}

export interface Priority {
  id: string;
  name: string;
  value: number;
  color: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  created_at?: string;
  is_custom?: boolean;
}

export type SharedStepCategory =
  | 'authentication'
  | 'database'
  | 'api'
  | 'ui'
  | 'setup'
  | 'cleanup'
  | 'validation'
  | 'reporting';

export type SharedStepComplexity = 'simple' | 'medium' | 'complex';

export interface SharedStepTemplate {
  id: string;
  name: string;
  description: string;
  category: SharedStepCategory;
  tags: string[];
  complexity: SharedStepComplexity;
  estimated_time: number;
  prerequisites: string[];
  related_steps: string[];
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

export interface SharedStepTemplateForm {
  name: string;
  description: string;
  category: SharedStepCategory;
  tags: string;
  complexity: SharedStepComplexity;
  estimated_time: number | '';
  prerequisites: string;
  related_steps: string;
}

export type SharedStepTemplateFormErrors = Partial<Record<keyof SharedStepTemplateForm, string>>;

export interface TestTypeForm {
  name: string;
  description: string;
  color: string;
  icon: string;
}

export interface PriorityForm {
  name: string;
  value: number | '';
  color: string;
  description: string;
  is_default: boolean;
}

export interface TestExecutionSettings {
  id?: number;
  project_id?: number;
  auto_save_interval: number;
  screenshot_on_failure: boolean;
  video_recording: boolean;
  step_timeout: number;
  retry_attempts: number;
  parallel_execution: boolean;
  max_parallel_threads: number;
  cleanup_on_failure: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface NotificationSettings {
  id?: number;
  project_id?: number;
  email_notifications: boolean;
  slack_notifications: boolean;
  test_failure_alerts: boolean;
  test_completion_reports: boolean;
  weekly_summary: boolean;
  real_time_updates: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface UserNotificationPreferences {
  do_not_disturb: boolean;
  notification_sound_enabled: boolean;
  notifications_muted_until: string | null;
}

export interface AutomationSettings {
  id?: number;
  project_id?: number;
  ai_suggestions: boolean;
  smart_step_recommendations: boolean;
  auto_categorization: boolean;
  duplicate_detection: boolean;
  performance_optimization: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

// Shared-step template validation limits (kept here so the hook and the
// section components agree on the same bounds).
export const SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH = 200;
export const SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH = 500;
export const SHARED_STEP_TEMPLATE_LIST_MAX_ITEMS = 50;
export const SHARED_STEP_TEMPLATE_LIST_ITEM_MAX_LENGTH = 100;
export const SHARED_STEP_TEMPLATE_MIN_TIME = 1;
export const SHARED_STEP_TEMPLATE_MAX_TIME = 1440;

export const emptySharedStepTemplateForm = (): SharedStepTemplateForm => ({
  name: '',
  description: '',
  category: 'setup',
  tags: '',
  complexity: 'simple',
  estimated_time: 5,
  prerequisites: '',
  related_steps: '',
});

export const emptyTestTypeForm = (): TestTypeForm => ({
  name: '',
  description: '',
  color: '#3B82F6',
  icon: '🖱️',
});

export const emptyPriorityForm = (): PriorityForm => ({
  name: '',
  value: 2,
  color: '#F59E0B',
  description: '',
  is_default: false,
});
