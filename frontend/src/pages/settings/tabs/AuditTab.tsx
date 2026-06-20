// Audit-trail configuration tab, extracted from the SettingsPage monolith.
// The reset action now uses an AlertDialog instead of window.confirm for a
// consistent, theme-aware UX.
import { useState } from 'react';
import { History, RefreshCw, CheckCircle, Loader2, AlertCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { SettingsSection } from '../components/SettingsPrimitives';
import { useAuditConfig, AUDIT_ENTITY_KEYS } from '../hooks/useAuditConfig';

const ENTITY_LABEL_KEY: Record<string, string> = {
  user: 'auditEntityUser', project: 'auditEntityProject', test_case: 'auditEntityTestCase',
  test_suite: 'auditEntityTestSuite', test_run: 'auditEntityTestRun', test_result: 'auditEntityTestResult',
  test_plan: 'auditEntityTestPlan', requirement: 'auditEntityRequirement', defect: 'auditEntityDefect',
  milestone: 'auditEntityMilestone', custom_field: 'auditEntityCustomField', system_setting: 'auditEntitySystemSetting',
};

export function AuditTab() {
  const { t } = useTranslation();
  const data = useAuditConfig();
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const eligibleProjects = data.projects.filter((p) => (data.projectAuditCounts[String(p.id)] ?? 0) >= 10);
  const hasDeletableLogs = eligibleProjects.length > 0;

  return (
    <div className="space-y-6">
      <SettingsSection
        icon={History}
        tone="primary"
        title={t('auditTrailConfig')}
        action={
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={data.saving || data.loading}>
                  <RefreshCw className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('resetToDefaults')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('resetToDefaults')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('confirmResetAuditTrailConfig')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={data.reset}>{t('resetToDefaults')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={data.save} disabled={data.saving || data.loading}>
              {data.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />}
              {t('saveConfiguration')}
            </Button>
          </div>
        }
        contentClassName="space-y-6"
      >
        {data.loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold">{t('enableAuditTrailsGlobally')}</Label>
                <p className="text-sm text-muted-foreground">{t('enableAuditTrailsGloballyDesc')}</p>
              </div>
              <Switch checked={data.enabled} onCheckedChange={data.setEnabled} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">{t('entitySpecificSettings')}</Label>
                <Badge variant={data.enabled ? 'default' : 'secondary'}>
                  {data.enabled ? t('auditStatusActive') : t('auditStatusDisabled')}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t('entitySpecificSettingsDesc')}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {AUDIT_ENTITY_KEYS.map((key) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
                    <Label className="cursor-pointer text-sm font-medium">{t(ENTITY_LABEL_KEY[key])}</Label>
                    <Switch
                      checked={data.entitySettings[key] !== false}
                      onCheckedChange={(checked) => data.toggleEntity(key, checked)}
                      disabled={!data.enabled}
                    />
                  </div>
                ))}
              </div>
            </div>

            {!data.enabled && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('auditTrailsDisabled')}</p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">{t('auditTrailsDisabledDesc')}</p>
                </div>
              </div>
            )}

            {hasDeletableLogs && (
              <>
                {/* Delete entire audit log */}
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-medium text-destructive">{t('deleteAllAuditTrails')}</p>
                      <p className="text-sm text-destructive/80">{t('deleteAllAuditTrailsDesc')}</p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" disabled={data.saving}>
                          {data.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />}
                          {t('deleteAllAuditTrails')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('confirmDeleteAllAuditTrails')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={data.deleteAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {t('delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {/* Per-project deletion */}
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="flex-1 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-destructive">{t('deleteProjectAuditTrails')}</p>
                      <p className="text-sm text-destructive/80">{t('deleteProjectAuditTrailsDesc')}</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                        <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder={t('selectProject')} /></SelectTrigger>
                        <SelectContent>
                          {eligibleProjects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {selectedProjectId && (
                        <span className="text-sm text-destructive/80">
                          {t('projectAuditTrailsCount', { count: data.projectAuditCounts[selectedProjectId] ?? 0 })}
                        </span>
                      )}
                    </div>
                    {selectedProjectId && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" disabled={data.deletingProjectAudit}>
                            {data.deletingProjectAudit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />}
                            {t('deleteProjectAuditTrailsButton')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('confirmDeleteProjectAuditTrails')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={async () => { await data.deleteProject(selectedProjectId); setSelectedProjectId(''); }}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {t('delete')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </SettingsSection>
    </div>
  );
}

export default AuditTab;
