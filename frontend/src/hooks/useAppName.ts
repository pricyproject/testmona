import { useCallback, useEffect } from 'react';
import { systemSettingsAPI } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

export const DEFAULT_APP_NAME = 'TestMona';
export const APP_NAME_SETTING_KEY = 'app_name';
export const APP_LOGO_URL_SETTING_KEY = 'app_logo_url';
export const ORGANIZATION_NAME_SETTING_KEY = 'organization_name';
export const SUPPORT_EMAIL_SETTING_KEY = 'support_email';
export const DEFAULT_TIMEZONE_SETTING_KEY = 'default_timezone';
export const APP_NAME_MAX_LENGTH = 80;
export const APP_LOGO_URL_MAX_LENGTH = 500;
export const ORGANIZATION_NAME_MAX_LENGTH = 120;
export const SUPPORT_EMAIL_MAX_LENGTH = 254;

let appNameRequest: Promise<string> | null = null;

export const normalizeAppName = (value?: string | null): string => {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_APP_NAME;
};

export const normalizeOptionalSetting = (value?: string | null): string => {
  return value?.trim() || '';
};

export const getAppInitials = (name: string): string => {
  const words = normalizeAppName(name)
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
};

export function useAppName(fetchOnMount = true) {
  const appName = useAuthStore((state) => state.appName);
  const appLogoUrl = useAuthStore((state) => state.appLogoUrl);
  const setAppName = useAuthStore((state) => state.setAppName);
  const setAppLogoUrl = useAuthStore((state) => state.setAppLogoUrl);

  const refreshAppName = useCallback(async () => {
    if (!appNameRequest) {
      appNameRequest = Promise.all([
        systemSettingsAPI.getPublicSetting(APP_NAME_SETTING_KEY),
        systemSettingsAPI.getPublicSetting(APP_LOGO_URL_SETTING_KEY),
      ])
        .then(([nameSetting, logoSetting]) => {
          setAppLogoUrl(normalizeOptionalSetting(logoSetting?.value));
          return normalizeAppName(nameSetting?.value);
        })
        .catch((error) => {
          console.error('Failed to load application name:', error);
          return normalizeAppName(useAuthStore.getState().appName);
        })
        .finally(() => {
          appNameRequest = null;
        });
    }

    const nextAppName = await appNameRequest;
    setAppName(nextAppName);
    return nextAppName;
  }, [setAppName, setAppLogoUrl]);

  const updateAppName = useCallback((value: string) => {
    setAppName(normalizeAppName(value));
  }, [setAppName]);

  const updateAppLogoUrl = useCallback((value: string) => {
    setAppLogoUrl(normalizeOptionalSetting(value));
  }, [setAppLogoUrl]);

  useEffect(() => {
    if (fetchOnMount) {
      refreshAppName();
    }
  }, [fetchOnMount, refreshAppName]);

  return {
    appName: normalizeAppName(appName),
    appLogoUrl: normalizeOptionalSetting(appLogoUrl),
    appInitials: getAppInitials(appName),
    refreshAppName,
    setAppName: updateAppName,
    setAppLogoUrl: updateAppLogoUrl,
  };
}
