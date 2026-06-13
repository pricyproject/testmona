import { describe, it, expect } from 'vitest';
import {
  parseSearchQuery,
  testCaseMatchesQuery,
  hasActiveQuery,
} from '@/components/TestCases/searchQuery';
import { TestCase } from '@/types';

const tc = (overrides: Partial<TestCase>): TestCase =>
  ({
    id: 1,
    title: 'Login works',
    description: '',
    reference: '',
    tags: '',
    test_type: 'manual',
    priority: 'medium',
    ...overrides,
  } as TestCase);

describe('parseSearchQuery', () => {
  it('splits free text terms from key:value filters', () => {
    const parsed = parseSearchQuery('login priority:high type:smoke');
    expect(parsed.terms).toEqual(['login']);
    expect(parsed.filters).toEqual([
      { key: 'priority', value: 'high', negate: false },
      { key: 'type', value: 'smoke', negate: false },
    ]);
  });

  it('supports aliases, quotes and negation', () => {
    const parsed = parseSearchQuery('-tag:flaky ref:"REQ 12" p:low');
    expect(parsed.filters).toEqual([
      { key: 'tag', value: 'flaky', negate: true },
      { key: 'reference', value: 'req 12', negate: false },
      { key: 'priority', value: 'low', negate: false },
    ]);
  });

  it('treats unknown keys as free text', () => {
    const parsed = parseSearchQuery('foo:bar');
    expect(parsed.terms).toEqual(['foo:bar']);
    expect(parsed.filters).toHaveLength(0);
  });
});

describe('testCaseMatchesQuery', () => {
  it('matches free text against multiple fields (AND)', () => {
    const parsed = parseSearchQuery('login');
    expect(testCaseMatchesQuery(tc({ title: 'User login flow' }), parsed)).toBe(true);
    expect(testCaseMatchesQuery(tc({ title: 'Signup flow' }), parsed)).toBe(false);
  });

  it('applies priority and type filters', () => {
    const parsed = parseSearchQuery('priority:high type:smoke');
    expect(testCaseMatchesQuery(tc({ priority: 'high', test_type: 'smoke' }), parsed)).toBe(true);
    expect(testCaseMatchesQuery(tc({ priority: 'low', test_type: 'smoke' }), parsed)).toBe(false);
  });

  it('matches tags and honours negation', () => {
    expect(testCaseMatchesQuery(tc({ tags: 'smoke, ui' }), parseSearchQuery('tag:ui'))).toBe(true);
    expect(testCaseMatchesQuery(tc({ tags: 'smoke, ui' }), parseSearchQuery('-tag:ui'))).toBe(false);
  });

  it('supports is:automated / is:manual', () => {
    expect(testCaseMatchesQuery(tc({ test_type: 'automated' }), parseSearchQuery('is:automated'))).toBe(true);
    expect(testCaseMatchesQuery(tc({ test_type: 'manual' }), parseSearchQuery('is:automated'))).toBe(false);
  });

  it('empty query matches everything', () => {
    const parsed = parseSearchQuery('   ');
    expect(hasActiveQuery(parsed)).toBe(false);
    expect(testCaseMatchesQuery(tc({}), parsed)).toBe(true);
  });
});
