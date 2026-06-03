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
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const date = parseServerDate(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Localized relative time (e.g. "3 hours ago"), or '' when unparseable. */
export function formatRelativeTime(value: string | number | Date | null | undefined): string {
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
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
      -Math.round(seconds / divisors[unit]),
      unit,
    );
  } catch {
    return date.toLocaleString();
  }
}
