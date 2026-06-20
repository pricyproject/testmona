// General settings tab (interface density / language user prefs + admin system
// configuration), extracted from the SettingsPage monolith.
import { Maximize2, Rows3, CheckCircle, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { isAdminUser } from '@/utils/roles';
import { APP_NAME_MAX_LENGTH, APP_LOGO_URL_MAX_LENGTH } from '@/hooks/useAppName';
import { SettingsSection, SettingToggleRow } from '../components/SettingsPrimitives';
import { useGeneralSettings, sanitizeLogoUrl } from '../hooks/useGeneralSettings';

export function GeneralTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, language, setLanguage, compactMode, setCompactMode } = useAuthStore();
  const isAdmin = isAdminUser(user);
  const g = useGeneralSettings(isAdmin);

  const success = (description: string) => toast({ title: t('success'), description });
  const onCompactChange = (enabled: boolean) => { setCompactMode(enabled); success(enabled ? t('compactModeEnabled') : t('compactModeDisabled')); };
  const onResetPreferences = () => { setCompactMode(false); setLanguage('en'); success(t('preferencesReset')); };

  const compactModeEffects = [
    t('compactAppliesNavigation'), t('compactAppliesCards'), t('compactAppliesTables'), t('compactAppliesForms'), t('compactAppliesDialogs'),
  ];
  const logoPreview = sanitizeLogoUrl(g.appLogoUrlInput);

  return (
    <div className="space-y-6">
      {/* Interface density */}
      <Card className="settings-density-card overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/30">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{compactMode ? t('compactModeOn') : t('compactModeOff')}</Badge>
                <CardTitle className="text-xl">{t('interfaceDensity')}</CardTitle>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">{t('compactModeDesc')}</p>
            </div>
            <div className="inline-flex rounded-2xl border border-border bg-card p-1 shadow-sm">
              <Button type="button" variant={!compactMode ? 'default' : 'ghost'} size="sm" onClick={() => onCompactChange(false)} className="gap-2 rounded-xl" aria-pressed={!compactMode}>
                <Maximize2 className="h-4 w-4" />{t('comfortableMode')}
              </Button>
              <Button type="button" variant={compactMode ? 'default' : 'ghost'} size="sm" onClick={() => onCompactChange(true)} className="gap-2 rounded-xl" aria-pressed={compactMode}>
                <Rows3 className="h-4 w-4" />{t('compactMode')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className={`settings-density-preview ${compactMode ? 'is-compact' : ''}`}>
            <div className="preview-panel">
              <div className="preview-topline">
                <span>{t('densityPreview')}</span>
                <span>{compactMode ? t('moreRowsVisible') : t('comfortableSpacing')}</span>
              </div>
              <div className="preview-row"><span className="preview-dot bg-emerald-500" /><span>{t('sampleTestRun')}</span><strong>{compactMode ? '86%' : '72%'}</strong></div>
              <div className="preview-row"><span className="preview-dot bg-blue-500" /><span>{t('sampleRequirement')}</span><strong>{compactMode ? '12' : '8'}</strong></div>
              <div className="preview-row"><span className="preview-dot bg-amber-500" /><span>{t('sampleDefect')}</span><strong>{compactMode ? '4' : '3'}</strong></div>
            </div>
            <div className="preview-copy">
              <h3>{compactMode ? t('compactModePreviewTitle') : t('comfortableModePreviewTitle')}</h3>
              <p>{compactMode ? t('compactModePreviewDesc') : t('comfortableModePreviewDesc')}</p>
            </div>
          </div>

          <div className="grid gap-2 rounded-2xl border border-border/60 bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-5">
            {compactModeEffects.map((effect) => (
              <div key={effect} className="flex items-start gap-2 text-sm text-foreground">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /><span>{effect}</span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border/60 p-4">
            <SettingToggleRow label={t('language')} description={t('languageDesc')}>
              <Select value={language} onValueChange={(value) => { setLanguage(value as 'en' | 'fa' | 'ar'); success(t('languageUpdated')); }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fa">فارسی</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </SettingToggleRow>
          </div>

          <p className="text-sm text-muted-foreground">{t('generalSettingsApplyImmediately')}</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button className="px-8" variant="outline" onClick={onResetPreferences}>{t('resetPreferences')}</Button>
      </div>

      {/* Admin system configuration */}
      {isAdmin && (
        <SettingsSection icon={SettingsIcon} tone="primary" title={t('systemConfiguration')} contentClassName="space-y-6">
          <div className="space-y-4 rounded-lg border border-border/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label className="text-base">{t('branding')}</Label>
                <p className="text-sm text-muted-foreground">{t('brandingDescription', { appName: g.appName })}</p>
              </div>
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white ${logoPreview ? 'bg-transparent' : 'bg-primary'}`}>
                {logoPreview ? (
                  <img src={logoPreview} alt={g.appNameInput || g.appName} className="h-full w-full rounded-2xl object-cover" />
                ) : (
                  (g.appNameInput || g.appName).slice(0, 2).toUpperCase()
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="app-name">{t('appName')}</Label>
                <Input id="app-name" value={g.appNameInput} onChange={(e) => g.setAppNameInput(e.target.value)} maxLength={APP_NAME_MAX_LENGTH} placeholder={t('appNamePlaceholder')} disabled={g.saving} />
                <p className="text-xs text-muted-foreground">{t('appNameCharacterLimit', { max: APP_NAME_MAX_LENGTH })}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-logo-url">{t('appLogoUrl')}</Label>
                <Input id="app-logo-url" value={g.appLogoUrlInput} onChange={(e) => g.setAppLogoUrlInput(e.target.value)} maxLength={APP_LOGO_URL_MAX_LENGTH} placeholder={t('appLogoUrlPlaceholder')} disabled={g.saving} />
                <p className="text-xs text-muted-foreground">{t('appLogoUrlDescription')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="organization-name">{t('organizationName')}</Label>
                <Input id="organization-name" value={g.organizationName} onChange={(e) => g.setOrganizationName(e.target.value)} placeholder={t('organizationNamePlaceholder')} disabled={g.saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-email">{t('supportEmail')}</Label>
                <Input id="support-email" type="email" value={g.supportEmail} onChange={(e) => g.setSupportEmail(e.target.value)} placeholder={t('supportEmailPlaceholder')} disabled={g.saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-timezone">{t('timezone')}</Label>
                <Input id="default-timezone" value={g.defaultTimezone} onChange={(e) => g.setDefaultTimezone(e.target.value)} placeholder={t('defaultTimezonePlaceholder')} disabled={g.saving} />
                <p className="text-xs text-muted-foreground">{t('defaultTimezoneDescription')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-language">{t('defaultLanguageLabel')}</Label>
                <Select value={g.defaultLanguage} onValueChange={(value) => g.setDefaultLanguage(value as 'en' | 'fa' | 'ar')} disabled={g.saving}>
                  <SelectTrigger id="default-language"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">🇬🇧&nbsp;&nbsp;English</SelectItem>
                    <SelectItem value="fa">🇮🇷&nbsp;&nbsp;فارسی</SelectItem>
                    <SelectItem value="ar">🇸🇦&nbsp;&nbsp;العربية</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('defaultLanguageDescription')}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <SettingToggleRow label={t('maintenanceMode')} description={t('maintenanceModeDesc')}>
              <Switch checked={g.maintenanceMode} onCheckedChange={g.setMaintenanceMode} disabled={g.saving} />
            </SettingToggleRow>
            {g.maintenanceMode && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                {t('maintenanceModePreview', { appName: g.appNameInput || g.appName })}
              </div>
            )}
            <SettingToggleRow label={t('newUserRegistration')} description={t('newUserRegistrationDesc')}>
              <Switch checked={g.newUserRegistration} onCheckedChange={g.setNewUserRegistration} disabled={g.saving} />
            </SettingToggleRow>
            <SettingToggleRow label={t('debugLogging')} description={t('debugLoggingDesc')}>
              <Switch checked={g.debugLogging} onCheckedChange={g.setDebugLogging} disabled={g.saving} />
            </SettingToggleRow>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="session-timeout">{t('sessionTimeout')}</Label>
                <Input id="session-timeout" type="number" min={1} max={1440} value={g.sessionTimeout} onChange={(e) => g.setSessionTimeout(Number(e.target.value))} disabled={g.saving} />
                <p className="text-xs text-muted-foreground">{t('sessionTimeoutDesc')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password-complexity">{t('passwordComplexity')}</Label>
                <Select value={g.passwordComplexity} onValueChange={g.setPasswordComplexity} disabled={g.saving}>
                  <SelectTrigger id="password-complexity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('passwordComplexityLow')}</SelectItem>
                    <SelectItem value="medium">{t('passwordComplexityMedium')}</SelectItem>
                    <SelectItem value="high">{t('passwordComplexityHigh')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('passwordComplexityDesc')}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={g.saveSystemConfiguration} disabled={g.saving}>{g.saving ? t('saving') : t('saveChanges')}</Button>
            </div>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

export default GeneralTab;
