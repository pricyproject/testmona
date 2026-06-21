import { useCallback, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  formatServerDateTime,
  formatServerDate,
  formatRelativeTime,
} from '@/utils/datetime';

/**
 * Language-aware date formatting bound to the app's current language.
 *
 * Persian (`fa`) renders the Jalali calendar with Persian digits; `en`/`ar`
 * stay Gregorian. Use this in components instead of `new Date(x).toLocale*()`
 * or the raw `@/utils/datetime` functions, so dates follow the app language
 * rather than the browser locale.
 */
export const useDateFormat = () => {
  const { language } = useTranslation();

  const formatDateTime = useCallback(
    (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) =>
      formatServerDateTime(value, language, options),
    [language],
  );

  const formatDate = useCallback(
    (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) =>
      formatServerDate(value, language, options),
    [language],
  );

  const formatRelative = useCallback(
    (value: string | number | Date | null | undefined) => formatRelativeTime(value, language),
    [language],
  );

  return useMemo(
    () => ({ formatDateTime, formatDate, formatRelative, language }),
    [formatDateTime, formatDate, formatRelative, language],
  );
};
