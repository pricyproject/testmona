import { useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { translations, TranslationKey } from '@/locales/translations';

export const useTranslation = () => {
  const { language } = useAuthStore();
  
  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>) => {
    const translation = translations[language][key] || translations.en[key] || key;
    
    if (params) {
      return Object.keys(params).reduce((str, paramKey) => {
        return str.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(params[paramKey]));
      }, translation);
    }
    
    return translation;
  }, [language]);
  
  const isRTL = language === 'fa' || language === 'ar';
  
  return { t, isRTL, language };
};
