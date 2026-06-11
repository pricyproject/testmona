import { en } from './en';

export type TranslationKey = keyof typeof en;
export type Language = 'en' | 'fa' | 'ar';
export { en };

export async function loadLocale(lang: Language): Promise<Record<string, string>> {
  if (lang === 'en') return en as unknown as Record<string, string>;
  const mod = await import(`./${lang}`);
  return mod[lang] as Record<string, string>;
}
