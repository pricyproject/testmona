import { en } from './en';

export type TranslationKey = keyof typeof en;
export type Language = 'en' | 'fa' | 'ar';
export { en };

export async function loadLocale(lang: Language): Promise<Record<string, string>> {
  if (lang === 'en') return en as unknown as Record<string, string>;
  if (lang === 'fa') return (await import('./fa.ts')).fa as unknown as Record<string, string>;
  if (lang === 'ar') return (await import('./ar.ts')).ar as unknown as Record<string, string>;
  return en as unknown as Record<string, string>;
}
