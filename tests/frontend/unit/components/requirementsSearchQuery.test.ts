import { describe, it, expect } from 'vitest';
import {
  parseRequirementQuery,
  requirementMatchesQuery,
  hasActiveRequirementQuery,
} from '@/components/requirements/requirementsSearchQuery';
import { Requirement } from '@/types';

const req = (overrides: Partial<Requirement> = {}): Requirement =>
  ({
    id: 1,
    requirement_id: 'REQ-1',
    title: 'Login works',
    description: '',
    status: 'draft',
    priority: 'medium',
    project_id: 1,
    created_by: 1,
    tags: '',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Requirement);

describe('parseRequirementQuery', () => {
  it('splits free text terms from key:value filters', () => {
    const parsed = parseRequirementQuery('login status:approved priority:high');
    expect(parsed.terms).toEqual(['login']);
    expect(parsed.filters).toEqual([
      { key: 'status', value: 'approved', negate: false },
      { key: 'priority', value: 'high', negate: false },
    ]);
  });

  it('supports aliases, quotes and negation', () => {
    const parsed = parseRequirementQuery('-tag:legacy s:verified id:"REQ 12" p:low');
    expect(parsed.filters).toEqual([
      { key: 'tag', value: 'legacy', negate: true },
      { key: 'status', value: 'verified', negate: false },
      { key: 'id', value: 'req 12', negate: false },
      { key: 'priority', value: 'low', negate: false },
    ]);
  });

  it('treats unknown keys as free text', () => {
    const parsed = parseRequirementQuery('foo:bar');
    expect(parsed.terms).toEqual(['foo:bar']);
    expect(parsed.filters).toHaveLength(0);
  });

  it('reports whether a query is active', () => {
    expect(hasActiveRequirementQuery(parseRequirementQuery('   '))).toBe(false);
    expect(hasActiveRequirementQuery(parseRequirementQuery('status:draft'))).toBe(true);
  });
});

describe('requirementMatchesQuery', () => {
  it('matches free text across multiple fields (AND)', () => {
    const parsed = parseRequirementQuery('login flow');
    expect(requirementMatchesQuery(req({ title: 'User login flow' }), parsed)).toBe(true);
    expect(requirementMatchesQuery(req({ title: 'Signup flow' }), parsed)).toBe(false);
  });

  it('applies status and priority filters (exact, case-insensitive)', () => {
    const parsed = parseRequirementQuery('status:approved priority:high');
    expect(requirementMatchesQuery(req({ status: 'approved', priority: 'high' }), parsed)).toBe(true);
    expect(requirementMatchesQuery(req({ status: 'draft', priority: 'high' }), parsed)).toBe(false);
  });

  it('matches the requirement id as a substring', () => {
    expect(requirementMatchesQuery(req({ requirement_id: 'REQ-128' }), parseRequirementQuery('id:req-12'))).toBe(true);
    expect(requirementMatchesQuery(req({ requirement_id: 'REQ-9' }), parseRequirementQuery('id:req-12'))).toBe(false);
  });

  it('matches tags and honours negation', () => {
    expect(requirementMatchesQuery(req({ tags: 'auth, ui' }), parseRequirementQuery('tag:ui'))).toBe(true);
    expect(requirementMatchesQuery(req({ tags: 'auth, ui' }), parseRequirementQuery('-tag:ui'))).toBe(false);
  });

  it('tolerates null/undefined fields without throwing', () => {
    const sparse = { id: 2 } as Requirement;
    expect(requirementMatchesQuery(sparse, parseRequirementQuery('anything'))).toBe(false);
    expect(requirementMatchesQuery(sparse, parseRequirementQuery('status:draft'))).toBe(false);
    expect(requirementMatchesQuery(sparse, parseRequirementQuery('-tag:legacy'))).toBe(true);
  });

  it('empty query matches everything', () => {
    expect(requirementMatchesQuery(req(), parseRequirementQuery('   '))).toBe(true);
  });
});
