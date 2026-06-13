import { describe, it, expect } from 'vitest';
import {
  parseDefectQuery,
  defectMatchesQuery,
  hasActiveDefectQuery,
} from '@/components/Defects/defectsSearchQuery';

const defect = (overrides: Record<string, any> = {}): any => ({
  id: 1,
  defect_id: 'DEF-1',
  title: 'Login crashes',
  description: '',
  status: 'open',
  severity: 'high',
  priority: 'medium',
  tags: '',
  environment: '',
  steps_to_reproduce: '',
  requirement_id: null,
  ...overrides,
});

describe('parseDefectQuery', () => {
  it('splits free text terms from key:value filters', () => {
    const parsed = parseDefectQuery('crash status:open severity:critical');
    expect(parsed.terms).toEqual(['crash']);
    expect(parsed.filters).toEqual([
      { key: 'status', value: 'open', negate: false },
      { key: 'severity', value: 'critical', negate: false },
    ]);
  });

  it('supports aliases, quotes and negation', () => {
    const parsed = parseDefectQuery('-priority:low s:in_progress env:"prod east" sev:high');
    expect(parsed.filters).toEqual([
      { key: 'priority', value: 'low', negate: true },
      { key: 'status', value: 'in_progress', negate: false },
      { key: 'env', value: 'prod east', negate: false },
      { key: 'severity', value: 'high', negate: false },
    ]);
  });

  it('treats unknown keys as free text', () => {
    const parsed = parseDefectQuery('foo:bar');
    expect(parsed.terms).toEqual(['foo:bar']);
    expect(parsed.filters).toHaveLength(0);
  });

  it('keeps a URL with a scheme colon as a free-text term', () => {
    const parsed = parseDefectQuery('http://example.com/issue');
    expect(parsed.filters).toHaveLength(0);
    expect(parsed.terms).toEqual(['http://example.com/issue']);
  });

  it('ignores an empty value after a known key', () => {
    const parsed = parseDefectQuery('status:');
    expect(parsed.filters).toHaveLength(0);
    expect(parsed.terms).toEqual(['status:']);
  });

  it('reports whether a query is active', () => {
    expect(hasActiveDefectQuery(parseDefectQuery('   '))).toBe(false);
    expect(hasActiveDefectQuery(parseDefectQuery('status:open'))).toBe(true);
    expect(hasActiveDefectQuery(parseDefectQuery('crash'))).toBe(true);
  });
});

describe('defectMatchesQuery', () => {
  it('matches free text across multiple fields (AND)', () => {
    const parsed = parseDefectQuery('login timeout');
    expect(defectMatchesQuery(defect({ title: 'Login timeout on slow network' }), parsed)).toBe(true);
    expect(defectMatchesQuery(defect({ title: 'Login crashes' }), parsed)).toBe(false);
  });

  it('searches the defect id and numeric requirement id', () => {
    expect(defectMatchesQuery(defect({ defect_id: 'DEF-42' }), parseDefectQuery('def-42'))).toBe(true);
    expect(defectMatchesQuery(defect({ requirement_id: 17 }), parseDefectQuery('17'))).toBe(true);
  });

  it('applies status, severity and priority filters (exact, case-insensitive)', () => {
    const parsed = parseDefectQuery('status:open severity:critical');
    expect(defectMatchesQuery(defect({ status: 'Open', severity: 'Critical' }), parsed)).toBe(true);
    expect(defectMatchesQuery(defect({ status: 'closed', severity: 'critical' }), parsed)).toBe(false);
  });

  it('matches multi-word statuses like in_progress', () => {
    expect(defectMatchesQuery(defect({ status: 'in_progress' }), parseDefectQuery('status:in_progress'))).toBe(true);
    expect(defectMatchesQuery(defect({ status: 'open' }), parseDefectQuery('status:in_progress'))).toBe(false);
  });

  it('matches tags and honours negation', () => {
    expect(defectMatchesQuery(defect({ tags: 'flaky, ui' }), parseDefectQuery('tag:ui'))).toBe(true);
    expect(defectMatchesQuery(defect({ tags: 'flaky, ui' }), parseDefectQuery('-tag:ui'))).toBe(false);
  });

  it('matches environment as a substring', () => {
    expect(defectMatchesQuery(defect({ environment: 'Staging EU' }), parseDefectQuery('env:staging'))).toBe(true);
    expect(defectMatchesQuery(defect({ environment: 'Production' }), parseDefectQuery('env:staging'))).toBe(false);
  });

  it('tolerates null/undefined fields without throwing', () => {
    const sparse = { id: 2 };
    expect(defectMatchesQuery(sparse, parseDefectQuery('anything'))).toBe(false);
    expect(defectMatchesQuery(sparse, parseDefectQuery('status:open'))).toBe(false);
    expect(defectMatchesQuery(sparse, parseDefectQuery('-tag:flaky'))).toBe(true);
  });

  it('empty query matches everything', () => {
    const parsed = parseDefectQuery('   ');
    expect(defectMatchesQuery(defect(), parsed)).toBe(true);
  });
});
