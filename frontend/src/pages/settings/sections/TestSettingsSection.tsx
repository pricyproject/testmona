import { Target, Zap, Cpu, BellRing } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { SettingsSection, SettingToggleRow } from '../components/SettingsPrimitives';
import { TestManagementData } from '../hooks/useTestManagementData';

const clampInt = (raw: string, min: number, max: number, fallback: number) => {
  if (raw === '') return fallback;
  const n = Math.trunc(Number(raw));
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export function TestSettingsSection({ data }: { data: TestManagementData }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const exec = data.testExecutionSettings;
  const notif = data.notificationSettings;
  const autom = data.automationSettings;
  const prefs = data.userNotificationPrefs;

  return (
    <>
      {/* Test execution */}
      <SettingsSection icon={Target} tone="emerald" title={t('testExecutionSettingsTitle')} contentClassName="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <SettingToggleRow label={t('autoSaveInterval')} description={t('autoSaveIntervalDesc')}>
              <Input
                type="number" min={10} max={300} className="w-24"
                value={exec.auto_save_interval}
                onChange={(e) => data.setTestExecutionSettings({ ...exec, auto_save_interval: clampInt(e.target.value, 10, 300, 30) })}
              />
            </SettingToggleRow>
            <SettingToggleRow label={t('screenshotOnFailure')} description={t('screenshotOnFailureDesc')}>
              <Switch checked={exec.screenshot_on_failure} onCheckedChange={(c) => data.setTestExecutionSettings({ ...exec, screenshot_on_failure: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('videoRecording')} description={t('videoRecordingDesc')}>
              <Switch checked={exec.video_recording} onCheckedChange={(c) => data.setTestExecutionSettings({ ...exec, video_recording: c })} />
            </SettingToggleRow>
          </div>
          <div className="space-y-4">
            <SettingToggleRow label={t('stepTimeout')} description={t('stepTimeoutDesc')}>
              <Input
                type="number" min={30} max={3600} className="w-24"
                value={exec.step_timeout}
                onChange={(e) => data.setTestExecutionSettings({ ...exec, step_timeout: clampInt(e.target.value, 30, 3600, 300) })}
              />
            </SettingToggleRow>
            <SettingToggleRow label={t('retryAttempts')} description={t('retryAttemptsDesc')}>
              <Input
                type="number" min={0} max={5} className="w-24"
                value={exec.retry_attempts}
                onChange={(e) => data.setTestExecutionSettings({ ...exec, retry_attempts: clampInt(e.target.value, 0, 5, 2) })}
              />
            </SettingToggleRow>
            <SettingToggleRow label={t('parallelExecution')} description={t('parallelExecutionDesc')}>
              <Switch checked={exec.parallel_execution} onCheckedChange={(c) => data.setTestExecutionSettings({ ...exec, parallel_execution: c })} />
            </SettingToggleRow>
          </div>
        </div>
        {exec.parallel_execution && (
          <SettingToggleRow label={t('maxParallelThreads')} description={t('maxParallelThreadsDesc')}>
            <Input
              type="number" min={1} max={16} className="w-24"
              value={exec.max_parallel_threads}
              onChange={(e) => data.setTestExecutionSettings({ ...exec, max_parallel_threads: clampInt(e.target.value, 1, 16, 4) })}
            />
          </SettingToggleRow>
        )}
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection id="notification-settings" icon={Zap} tone="amber" title={t('notificationSettingsTitle')} contentClassName="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <SettingToggleRow label={t('emailNotifications')} description={t('emailNotificationsDesc')}>
              <Switch checked={notif.email_notifications} onCheckedChange={(c) => data.setNotificationSettings({ ...notif, email_notifications: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('slackNotifications')} description={t('slackNotificationsDesc')}>
              <Switch checked={notif.slack_notifications} onCheckedChange={(c) => data.setNotificationSettings({ ...notif, slack_notifications: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('testFailureAlerts')} description={t('testFailureAlertsDesc')}>
              <Switch checked={notif.test_failure_alerts} onCheckedChange={(c) => data.setNotificationSettings({ ...notif, test_failure_alerts: c })} />
            </SettingToggleRow>
          </div>
          <div className="space-y-4">
            <SettingToggleRow label={t('testCompletionReports')} description={t('testCompletionReportsDesc')}>
              <Switch checked={notif.test_completion_reports} onCheckedChange={(c) => data.setNotificationSettings({ ...notif, test_completion_reports: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('weeklySummary')} description={t('weeklySummaryDesc')}>
              <Switch checked={notif.weekly_summary} onCheckedChange={(c) => data.setNotificationSettings({ ...notif, weekly_summary: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('realtimeUpdates')} description={t('realtimeUpdatesDesc')}>
              <Switch checked={notif.real_time_updates} onCheckedChange={(c) => data.setNotificationSettings({ ...notif, real_time_updates: c })} />
            </SettingToggleRow>
          </div>
        </div>
        <div className="space-y-4 border-t border-border/60 pt-6">
          <h4 className="text-sm font-semibold text-foreground">{t('personalNotificationPreferences')}</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SettingToggleRow label={t('doNotDisturb')} description={t('doNotDisturbDesc')}>
              <Switch checked={prefs.do_not_disturb} onCheckedChange={(c) => data.setUserNotificationPrefs({ ...prefs, do_not_disturb: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('notificationSound')} description={t('notificationSoundDesc')}>
              <Switch checked={prefs.notification_sound_enabled} onCheckedChange={(c) => data.setUserNotificationPrefs({ ...prefs, notification_sound_enabled: c })} />
            </SettingToggleRow>
          </div>
          {prefs.notifications_muted_until && (
            <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              {t('notificationsMutedUntil', { date: formatDateTime(prefs.notifications_muted_until) })}
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Per-category mute grid (saved on toggle) */}
      <SettingsSection id="notification-categories" icon={BellRing} tone="blue" title={t('notificationCategoriesTitle')} description={t('notificationCategoriesDesc')}>
        {data.categoryPrefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noData')}</p>
        ) : (
          <div className="space-y-1">
            <div className="mb-1 grid grid-cols-[1fr_4rem_4rem] items-center gap-x-6 border-b border-border/60 pb-2 text-xs font-medium uppercase text-muted-foreground">
              <span>{t('category')}</span>
              <span className="text-center">{t('inApp')}</span>
              <span className="text-center">{t('email')}</span>
            </div>
            {data.categoryPrefs.map((cat) => (
              <div key={cat.key} className="grid grid-cols-[1fr_4rem_4rem] items-center gap-x-6 py-2">
                <div className="flex items-center gap-2">
                  <Label className="font-normal">{t(`inboxCat_${cat.key}`) || cat.label}</Label>
                  {cat.actionable && <Badge variant="secondary" className="text-xs">{t('inbox')}</Badge>}
                </div>
                <div className="flex justify-center">
                  <Switch checked={cat.in_app} disabled={data.savingCategoryPrefs} onCheckedChange={(c) => data.toggleCategoryChannel(cat.key, 'in_app', c)} />
                </div>
                <div className="flex justify-center">
                  <Switch checked={cat.email} disabled={data.savingCategoryPrefs} onCheckedChange={(c) => data.toggleCategoryChannel(cat.key, 'email', c)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Automation / AI */}
      <SettingsSection icon={Cpu} tone="indigo" title={t('automationAiSettings')} contentClassName="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <SettingToggleRow label={t('aiSuggestions')} description={t('aiSuggestionsDesc')}>
              <Switch checked={autom.ai_suggestions} onCheckedChange={(c) => data.setAutomationSettings({ ...autom, ai_suggestions: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('smartStepRecommendations')} description={t('smartStepRecommendationsDesc')}>
              <Switch checked={autom.smart_step_recommendations} onCheckedChange={(c) => data.setAutomationSettings({ ...autom, smart_step_recommendations: c })} />
            </SettingToggleRow>
          </div>
          <div className="space-y-4">
            <SettingToggleRow label={t('autoCategorization')} description={t('autoCategorizationDesc')}>
              <Switch checked={autom.auto_categorization} onCheckedChange={(c) => data.setAutomationSettings({ ...autom, auto_categorization: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('duplicateDetection')} description={t('duplicateDetectionDesc')}>
              <Switch checked={autom.duplicate_detection} onCheckedChange={(c) => data.setAutomationSettings({ ...autom, duplicate_detection: c })} />
            </SettingToggleRow>
            <SettingToggleRow label={t('performanceOptimization')} description={t('performanceOptimizationDesc')}>
              <Switch checked={autom.performance_optimization} onCheckedChange={(c) => data.setAutomationSettings({ ...autom, performance_optimization: c })} />
            </SettingToggleRow>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
