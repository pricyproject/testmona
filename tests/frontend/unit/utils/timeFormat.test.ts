import { describe, it, expect } from 'vitest';
import { formatDurationSeconds } from '@/utils/timeFormat';

const t = (key: string, values?: Record<string, string | number>) => {
  const v = values?.count ?? '';
  if (key === 'hoursShort') return `${v}h`;
  if (key === 'minutesShort') return `${v}m`;
  if (key === 'secondsShort') return `${v}s`;
  return key;
};

describe('formatDurationSeconds', () => {
  it('returns fallback for null', () => {
    expect(formatDurationSeconds(null, t)).toBe('-');
  });

  it('returns fallback for undefined', () => {
    expect(formatDurationSeconds(undefined, t)).toBe('-');
  });

  it('returns fallback for empty string', () => {
    expect(formatDurationSeconds('', t)).toBe('-');
  });

  it('returns fallback for non-numeric string', () => {
    expect(formatDurationSeconds('abc', t)).toBe('-');
  });

  it('uses custom fallback', () => {
    expect(formatDurationSeconds(null, t, 'N/A')).toBe('N/A');
  });

  it('formats pure seconds', () => {
    expect(formatDurationSeconds(45, t)).toBe('45s');
  });

  it('formats zero as 0s', () => {
    expect(formatDurationSeconds(0, t)).toBe('0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDurationSeconds(125, t)).toBe('2m 5s');
  });

  it('formats exact minutes with no trailing seconds', () => {
    expect(formatDurationSeconds(120, t)).toBe('2m');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDurationSeconds(3661, t)).toBe('1h 1m 1s');
  });

  it('formats exact hours with no minutes or seconds', () => {
    expect(formatDurationSeconds(7200, t)).toBe('2h');
  });

  it('formats hours and minutes with no seconds', () => {
    expect(formatDurationSeconds(3720, t)).toBe('1h 2m');
  });

  it('accepts numeric string input', () => {
    expect(formatDurationSeconds('90', t)).toBe('1m 30s');
  });

  it('clamps negative values to 0s', () => {
    expect(formatDurationSeconds(-10, t)).toBe('0s');
  });

  it('rounds fractional seconds', () => {
    // 90.6 rounds to 91s = 1m 31s
    expect(formatDurationSeconds(90.6, t)).toBe('1m 31s');
  });
});
