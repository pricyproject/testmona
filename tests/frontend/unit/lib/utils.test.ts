import { describe, it, expect } from 'vitest';
import { cn, entitySeq, entityKey } from '@/lib/utils';

describe('cn (class name merger)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('deduplicates conflicting tailwind classes (last wins)', () => {
    // tailwind-merge keeps the last conflicting class
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  it('removes falsy values', () => {
    expect(cn('foo', false && 'bar', null, undefined, 'baz')).toBe('foo baz');
  });

  it('handles conditional objects', () => {
    expect(cn({ foo: true, bar: false })).toBe('foo');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });
});

describe('entitySeq', () => {
  it('returns project_seq when present', () => {
    expect(entitySeq({ project_seq: 5, id: 99 })).toBe(5);
  });

  it('falls back to id when project_seq is null', () => {
    expect(entitySeq({ project_seq: null, id: 99 })).toBe(99);
  });

  it('falls back to id when project_seq is undefined', () => {
    expect(entitySeq({ project_seq: undefined, id: 42 })).toBe(42);
  });

  it('returns 0 project_seq as-is (nullish coalescing, not falsy)', () => {
    // ?? only falls back for null/undefined, so 0 is returned as-is.
    expect(entitySeq({ project_seq: 0, id: 99 })).toBe(0);
  });

  it('returns undefined for null item', () => {
    expect(entitySeq(null)).toBeUndefined();
  });

  it('returns undefined for undefined item', () => {
    expect(entitySeq(undefined)).toBeUndefined();
  });
});

describe('entityKey', () => {
  it('builds a zero-padded display key', () => {
    expect(entityKey('TC', { project_seq: 7, id: 100 })).toBe('TC-007');
    expect(entityKey('REQ', { project_seq: 1, id: 1 })).toBe('REQ-001');
  });

  it('uses id when project_seq is absent', () => {
    expect(entityKey('DEF', { project_seq: null, id: 42 })).toBe('DEF-042');
  });

  it('respects custom pad length', () => {
    expect(entityKey('TC', { project_seq: 5, id: 5 }, 5)).toBe('TC-00005');
  });

  it('returns prefix-only for null item', () => {
    expect(entityKey('TC', null)).toBe('TC');
  });

  it('returns prefix-only for undefined item', () => {
    expect(entityKey('TC', undefined)).toBe('TC');
  });

  it('does not truncate keys longer than pad width', () => {
    expect(entityKey('TC', { project_seq: 10000, id: 1 }, 3)).toBe('TC-10000');
  });
});
