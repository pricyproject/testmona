import { htmlToMarkdown } from '@/components/ui/content-editor';

export const decodeHtmlEntities = (value?: string | null): string => {
  if (!value) return '';
  if (typeof window === 'undefined') return value;
  const parsed = new DOMParser().parseFromString(value, 'text/html');
  return parsed.documentElement.textContent ?? '';
};

export const decodeEntitiesDeep = (value?: string | null): string => {
  if (!value) return '';
  let decoded = decodeHtmlEntities(value);
  if (/&(lt|gt|amp|quot|#\d+);/i.test(decoded)) {
    decoded = decodeHtmlEntities(decoded);
  }
  return decoded;
};

export const isHtmlMarkup = (value: string): boolean => /<[a-z][\s\S]*>/i.test(value);

export const htmlToReadableText = (value?: string | null): string => {
  const decoded = decodeEntitiesDeep(value);
  if (!decoded.trim()) return '';
  if (typeof window === 'undefined' || !isHtmlMarkup(decoded)) return decoded;
  const parsed = new DOMParser().parseFromString(decoded, 'text/html');
  return parsed.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() || decoded;
};

export const richTextToMarkdownForEdit = (value?: string | null): string => {
  const decoded = decodeEntitiesDeep(value);
  return isHtmlMarkup(decoded) ? htmlToMarkdown(decoded) : decoded;
};
