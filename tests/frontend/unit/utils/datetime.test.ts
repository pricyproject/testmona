import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseServerDate, formatServerDateTime, formatRelativeTime } from '@/utils/datetime';

describe('parseServerDate', () => {
  it('returns null for null/undefined', () => {
    expect(parseServerDate(null)).toBeNull();
    expect(parseServerDate(undefined)).toBeNull();
  });

  it('returns null for empty/whitespace string', () => {
    expect(parseServerDate('')).toBeNull();
    expect(parseServerDate('   ')).toBeNull();
  });

  it('treats tz-less strings as UTC', () => {
    const d = parseServerDate('2026-06-03T05:51:58');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(5); // 0-indexed
    expect(d!.getUTCDate()).toBe(3);
    expect(d!.getUTCHours()).toBe(5);
  });

  it('respects explicit Z suffix', () => {
    const d = parseServerDate('2026-01-15T12:00:00Z');
    expect(d!.getUTCHours()).toBe(12);
  });

  it('respects explicit offset (+05:30)', () => {
    const d = parseServerDate('2026-01-15T17:30:00+05:30');
    expect(d!.getUTCHours()).toBe(12);
  });

  it('accepts space as date/time separator', () => {
    const d = parseServerDate('2026-06-03 10:00:00');
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(10);
  });

  it('returns null for an invalid string', () => {
    expect(parseServerDate('not-a-date')).toBeNull();
  });

  it('passes through a valid Date object', () => {
    const input = new Date('2026-06-03T00:00:00Z');
    expect(parseServerDate(input)).toBe(input);
  });

  it('returns null for an invalid Date object', () => {
    expect(parseServerDate(new Date('invalid'))).toBeNull();
  });

  it('accepts a numeric timestamp', () => {
    const ts = Date.UTC(2026, 5, 3);
    const d = parseServerDate(ts);
    expect(d!.getUTCFullYear()).toBe(2026);
  });
});

describe('formatServerDateTime', () => {
  it('returns empty string for null', () => {
    expect(formatServerDateTime(null)).toBe('');
  });

  it('returns a non-empty string for a valid date', () => {
    const result = formatServerDateTime('2026-06-03T12:00:00Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatServerDateTime('garbage')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for null', () => {
    expect(formatRelativeTime(null)).toBe('');
  });

  it('returns a relative string for a recent past date', () => {
    const twoHoursAgo = '2026-06-03T10:00:00Z';
    const result = formatRelativeTime(twoHoursAgo);
    expect(result).toBeTruthy();
    expect(result).toMatch(/2 hours ago|2 hr\. ago/);
  });

  it('returns a relative string for a recent future date', () => {
    const inOneHour = '2026-06-03T13:00:00Z';
    const result = formatRelativeTime(inOneHour);
    expect(result).toBeTruthy();
    expect(result).toMatch(/in 1 hour|in 60 min/);
  });

  it('returns a year-relative string for an old date', () => {
    const twoYearsAgo = '2024-06-03T12:00:00Z';
    const result = formatRelativeTime(twoYearsAgo);
    expect(result).toBeTruthy();
    expect(result).toMatch(/2 years ago|2 yr\. ago/);
  });

  it('handles "just now" (seconds ago)', () => {
    const justNow = '2026-06-03T11:59:50Z';
    const result = formatRelativeTime(justNow);
    expect(result).toBeTruthy();
  });
});
