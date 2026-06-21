/**
 * Date/time formatting helpers.
 *
 * All display formatting flows through here so that the app's *language*
 * (not the browser locale) drives the calendar and digits. In particular,
 * Persian (`fa`) renders the **Jalali/Shamsi** calendar with Persian-Indic
 * digits — `Intl.DateTimeFormat('fa-IR', …)` does this natively, so no extra
 * library is needed for display.
 *
 * Components should prefer the `useDateFormat()` hook (which binds the current
 * language for you) over calling these directly.
 */

import type { Language } from '@/locales/translations';

/**
 * Map the app language to a BCP-47 locale for `Intl`.
 * - `fa` → `fa-IR` (Jalali calendar + Persian digits, both default for fa-IR)
 * - `ar` → `ar` (Gregorian + Arabic digits)
 * - `en`/unknown → `undefined` (use the host default; effectively Gregorian)
 */
export function localeForLanguage(lang?: Language | string | null): string | undefined {
  switch (lang) {
    case 'fa':
      return 'fa-IR';
    case 'ar':
      return 'ar';
    case 'en':
      return 'en-US';
    default:
      return undefined;
  }
}

/**
 * Parse a timestamp coming from the backend.
 *
 * The API serializes naive UTC timestamps without a timezone designator
 * (e.g. `2026-06-03T05:51:58`). `new Date(...)` would interpret those as the
 * browser's *local* time, throwing relative/absolute displays off by the user's
 * UTC offset (and even showing future times). We treat tz-less strings as UTC.
 */
export function parseServerDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const normalized = hasTimezone ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Localized absolute date+time, or '' when unparseable. */
export function formatServerDateTime(
  value: string | number | Date | null | undefined,
  lang?: Language | string | null,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const date = parseServerDate(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(localeForLanguage(lang), options).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Localized absolute date only (no time), or '' when unparseable. */
export function formatServerDate(
  value: string | number | Date | null | undefined,
  lang?: Language | string | null,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return formatServerDateTime(value, lang, options);
}

/** Localized relative time (e.g. "3 hours ago" / "۳ ساعت پیش"), or '' when unparseable. */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  lang?: Language | string | null,
): string {
  const date = parseServerDate(value);
  if (!date) return '';
  const divisors: Record<string, number> = {
    second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600,
  };
  const thresholds: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'],
    [2629800, 'week'], [31557600, 'month'], [Number.POSITIVE_INFINITY, 'year'],
  ];
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [limit, candidate] of thresholds) {
    if (Math.abs(seconds) < limit) { unit = candidate; break; }
  }
  try {
    return new Intl.RelativeTimeFormat(localeForLanguage(lang), { numeric: 'auto' }).format(
      -Math.round(seconds / divisors[unit]),
      unit,
    );
  } catch {
    return date.toLocaleString();
  }
}
