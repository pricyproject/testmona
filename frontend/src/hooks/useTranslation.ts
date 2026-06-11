import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { TranslationKey, Language, en, loadLocale } from '@/locales/translations';

type TranslationDict = Record<string, string>;

const localeCache: Record<string, TranslationDict> = {
  en: en as unknown as TranslationDict,
};

export const useTranslation = () => {
  const { language } = useAuthStore();
  const [locale, setLocale] = useState<TranslationDict>(
    localeCache[language] ?? (en as unknown as TranslationDict)
  );

  useEffect(() => {
    if (localeCache[language]) {
      setLocale(localeCache[language]);
      return;
    }
    loadLocale(language as Language).then((dict) => {
      localeCache[language] = dict;
      setLocale(dict);
    });
  }, [language]);

  const t = useCallback(
    (key: TranslationKey | string, params?: Record<string, string | number>) => {
      const enDict = en as unknown as TranslationDict;
      const translation = locale[key] || enDict[key] || key;
      if (params) {
        return Object.keys(params).reduce((str, paramKey) => {
          return str.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(params[paramKey]));
        }, translation);
      }
      return translation;
    },
    [locale]
  );

  const isRTL = language === 'fa' || language === 'ar';

  return { t, isRTL, language };
};
