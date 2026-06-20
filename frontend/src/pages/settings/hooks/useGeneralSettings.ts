// General settings (user prefs + admin system configuration) for the General
// tab, extracted from the SettingsPage monolith.
import { useCallback, useEffect, useState } from 'react';
import { systemSettingsAPI } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import {
  APP_LOGO_URL_MAX_LENGTH, APP_LOGO_URL_SETTING_KEY, APP_NAME_MAX_LENGTH, APP_NAME_SETTING_KEY,
  DEFAULT_APP_NAME, DEFAULT_TIMEZONE_SETTING_KEY, ORGANIZATION_NAME_MAX_LENGTH, ORGANIZATION_NAME_SETTING_KEY,
  SUPPORT_EMAIL_MAX_LENGTH, SUPPORT_EMAIL_SETTING_KEY, normalizeOptionalSetting, useAppName,
} from '@/hooks/useAppName';

type Lang = 'en' | 'fa' | 'ar';

export function sanitizeLogoUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    /* invalid */
  }
  return '';
}

export function useGeneralSettings(isAdmin: boolean) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { appName, appLogoUrl, setAppName: setStoredAppName, setAppLogoUrl: setStoredAppLogoUrl } = useAppName(false);

  const [appNameInput, setAppNameInput] = useState(appName);
  const [appLogoUrlInput, setAppLogoUrlInput] = useState(appLogoUrl);
  const [organizationName, setOrganizationName] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [defaultTimezone, setDefaultTimezone] = useState('UTC');
  const [defaultLanguage, setDefaultLanguage] = useState<Lang>('en');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [newUserRegistration, setNewUserRegistration] = useState(true);
  const [debugLogging, setDebugLogging] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(60);
  const [passwordComplexity, setPasswordComplexity] = useState('high');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setAppNameInput(appName); }, [appName]);
  useEffect(() => { setAppLogoUrlInput(appLogoUrl); }, [appLogoUrl]);

  const error = useCallback((description: string) => toast({ title: t('error'), description, variant: 'destructive' }), [toast, t]);
  const success = useCallback((description: string) => toast({ title: t('success'), description }), [toast, t]);
  const errorDetail = useCallback((err: unknown, fallback: string) => {
    const detail = (err as any)?.response?.data?.detail;
    return typeof detail === 'string' && detail ? detail : fallback;
  }, []);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const settings = await systemSettingsAPI.getAllSettings();
      const get = (key: string) => settings.find((s: any) => s.key === key);
      const ensure = (key: string, value: string, description: string) => systemSettingsAPI.createSetting(key, value, description);

      const appNameSetting = get(APP_NAME_SETTING_KEY);
      if (appNameSetting) {
        const name = appNameSetting.value?.trim() || DEFAULT_APP_NAME;
        setAppNameInput(name); setStoredAppName(name);
      } else { await ensure(APP_NAME_SETTING_KEY, DEFAULT_APP_NAME, 'Application display name'); setAppNameInput(DEFAULT_APP_NAME); setStoredAppName(DEFAULT_APP_NAME); }

      const logoSetting = get(APP_LOGO_URL_SETTING_KEY);
      if (logoSetting) { const url = normalizeOptionalSetting(logoSetting.value); setAppLogoUrlInput(url); setStoredAppLogoUrl(url); }
      else await ensure(APP_LOGO_URL_SETTING_KEY, '', 'Application logo URL');

      const org = get(ORGANIZATION_NAME_SETTING_KEY);
      if (org) setOrganizationName(normalizeOptionalSetting(org.value));
      else await ensure(ORGANIZATION_NAME_SETTING_KEY, '', 'Organization display name');

      const email = get(SUPPORT_EMAIL_SETTING_KEY);
      if (email) setSupportEmail(normalizeOptionalSetting(email.value));
      else await ensure(SUPPORT_EMAIL_SETTING_KEY, '', 'Public support email address');

      const tz = get(DEFAULT_TIMEZONE_SETTING_KEY);
      if (tz) setDefaultTimezone(tz.value || 'UTC');
      else await ensure(DEFAULT_TIMEZONE_SETTING_KEY, 'UTC', 'Default timezone');

      const lang = get('default_language');
      if (lang && ['en', 'fa', 'ar'].includes(lang.value)) setDefaultLanguage(lang.value as Lang);
      else if (!lang) await ensure('default_language', 'en', 'Default application language (en, fa, ar)');

      const maint = get('maintenance_mode');
      if (maint) setMaintenanceMode(maint.value === 'true');
      else await ensure('maintenance_mode', 'false', 'Enable/disable maintenance mode');

      const signup = get('signup_enabled');
      if (signup) setNewUserRegistration(signup.value === 'true');
      else await ensure('signup_enabled', 'true', 'Enable/disable public user registration');

      const debug = get('debug_logging');
      if (debug) setDebugLogging(debug.value === 'true');
      else await ensure('debug_logging', 'false', 'Enable detailed logging for troubleshooting');

      const timeout = get('session_timeout');
      if (timeout) setSessionTimeout(parseInt(timeout.value, 10) || 60);
      else await ensure('session_timeout', '60', 'Session timeout in minutes');

      const complexity = get('password_complexity');
      if (complexity) setPasswordComplexity(complexity.value || 'high');
      else await ensure('password_complexity', 'high', 'Password complexity requirement (low, medium, high)');
    } catch (err) {
      console.error('Failed to load system settings:', err);
    }
  }, [isAdmin, setStoredAppName, setStoredAppLogoUrl]);

  useEffect(() => { load(); }, [load]);

  const validateBranding = useCallback(() => {
    const name = appNameInput.trim();
    const logo = appLogoUrlInput.trim();
    const org = organizationName.trim();
    const email = supportEmail.trim();
    const tz = defaultTimezone.trim() || 'UTC';

    if (!name) { error(t('appNameValidationRequired')); return null; }
    if (name.length > APP_NAME_MAX_LENGTH) { error(t('appNameValidationLength', { max: APP_NAME_MAX_LENGTH })); return null; }
    if (logo) {
      if (logo.length > APP_LOGO_URL_MAX_LENGTH) { error(t('appLogoUrlValidationLength', { max: APP_LOGO_URL_MAX_LENGTH })); return null; }
      try {
        const parsed = new URL(logo);
        if (!['http:', 'https:'].includes(parsed.protocol)) { error(t('appLogoUrlValidationProtocol')); return null; }
      } catch { error(t('appLogoUrlValidationInvalid')); return null; }
    }
    if (org.length > ORGANIZATION_NAME_MAX_LENGTH) { error(t('organizationNameValidationLength', { max: ORGANIZATION_NAME_MAX_LENGTH })); return null; }
    if (email) {
      if (email.length > SUPPORT_EMAIL_MAX_LENGTH) { error(t('supportEmailValidationLength', { max: SUPPORT_EMAIL_MAX_LENGTH })); return null; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error(t('supportEmailValidationInvalid')); return null; }
    }
    if (!tz || tz.length > 80) { error(t('defaultTimezoneValidationInvalid')); return null; }
    return { appName: name, appLogoUrl: logo, organizationName: org, supportEmail: email, defaultTimezone: tz };
  }, [appNameInput, appLogoUrlInput, organizationName, supportEmail, defaultTimezone, error, t]);

  const saveSystemSetting = useCallback(async (key: string, value: string, description: string) => {
    try {
      await systemSettingsAPI.updateSetting(key, value, description);
    } catch (err) {
      if ((err as any)?.response?.status === 404) { await systemSettingsAPI.createSetting(key, value, description); return; }
      throw err;
    }
  }, []);

  const saveSystemConfiguration = useCallback(async () => {
    const branding = validateBranding();
    if (!branding) return;
    if (sessionTimeout < 1 || sessionTimeout > 1440) { error(t('sessionTimeoutValidation')); return; }
    if (!['low', 'medium', 'high'].includes(passwordComplexity)) { error(t('passwordComplexityValidation')); return; }

    setSaving(true);
    try {
      await Promise.all([
        saveSystemSetting(APP_NAME_SETTING_KEY, branding.appName, 'Application display name'),
        saveSystemSetting(APP_LOGO_URL_SETTING_KEY, branding.appLogoUrl, 'Application logo URL'),
        saveSystemSetting(ORGANIZATION_NAME_SETTING_KEY, branding.organizationName, 'Organization display name'),
        saveSystemSetting(SUPPORT_EMAIL_SETTING_KEY, branding.supportEmail, 'Public support email address'),
        saveSystemSetting(DEFAULT_TIMEZONE_SETTING_KEY, branding.defaultTimezone, 'Default timezone'),
      ]);
      setStoredAppName(branding.appName);
      setStoredAppLogoUrl(branding.appLogoUrl);

      const results = await Promise.allSettled([
        systemSettingsAPI.updateSetting('maintenance_mode', maintenanceMode.toString(), 'Enable/disable maintenance mode'),
        systemSettingsAPI.updateSetting('signup_enabled', newUserRegistration.toString(), 'Enable/disable public user registration'),
        systemSettingsAPI.updateSetting('debug_logging', debugLogging.toString(), 'Enable detailed logging for troubleshooting'),
        systemSettingsAPI.updateSetting('session_timeout', sessionTimeout.toString(), 'Session timeout in minutes'),
        systemSettingsAPI.updateSetting('password_complexity', passwordComplexity, 'Password complexity requirement (low, medium, high)'),
        systemSettingsAPI.updateSetting('default_language', defaultLanguage, 'Default application language (en, fa, ar)'),
      ]);
      useAuthStore.getState().setLanguage(defaultLanguage);

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        toast({ title: t('partialSuccess'), description: t('settingsPartialSaveFailed', { count: failed.length }), variant: 'destructive' });
      } else {
        success(t('systemConfigurationSaved'));
      }
    } catch (err) {
      error(errorDetail(err, t('systemConfigurationSaveFailed')));
    } finally {
      setSaving(false);
    }
  }, [validateBranding, sessionTimeout, passwordComplexity, saveSystemSetting, setStoredAppName, setStoredAppLogoUrl,
      maintenanceMode, newUserRegistration, debugLogging, defaultLanguage, toast, success, error, errorDetail, t]);

  return {
    appName,
    appNameInput, setAppNameInput,
    appLogoUrlInput, setAppLogoUrlInput,
    organizationName, setOrganizationName,
    supportEmail, setSupportEmail,
    defaultTimezone, setDefaultTimezone,
    defaultLanguage, setDefaultLanguage,
    maintenanceMode, setMaintenanceMode,
    newUserRegistration, setNewUserRegistration,
    debugLogging, setDebugLogging,
    sessionTimeout, setSessionTimeout,
    passwordComplexity, setPasswordComplexity,
    saving,
    saveSystemConfiguration,
  };
}

export type GeneralSettingsData = ReturnType<typeof useGeneralSettings>;
