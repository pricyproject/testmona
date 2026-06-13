import { TestCase } from '@/types';

// Lightweight, fully client-side query language for the test-case list.
// Supports free text plus `key:value` tokens (quotes and `-` negation), e.g.
//   login priority:high type:smoke -tag:flaky is:automated ref:"REQ-12"
// Keeping it client-side means it stays fast and scalable against the already
// paginated, in-memory result set without extra round-trips.

export interface QueryFilter {
  key: string;
  value: string;
  negate: boolean;
}

export interface ParsedQuery {
  terms: string[];
  filters: QueryFilter[];
}

// Map user-typed keys (and short aliases) onto canonical filter keys.
const KEY_ALIASES: Record<string, string> = {
  priority: 'priority',
  p: 'priority',
  type: 'type',
  t: 'type',
  tag: 'tag',
  tags: 'tag',
  ref: 'reference',
  reference: 'reference',
  is: 'is',
};

export const SEARCH_FILTER_KEYS = ['priority', 'type', 'tag', 'reference', 'is'] as const;

const norm = (value: unknown) => String(value ?? '').toLowerCase().trim();

const stripQuotes = (value: string) => {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

// Split on whitespace while keeping quoted spans (and quoted values after a colon) intact.
const tokenize = (input: string): string[] =>
  input.match(/[^\s:]+:(?:"[^"]*"|'[^']*'|\S*)|"[^"]*"|'[^']*'|\S+/g) ?? [];

export function parseSearchQuery(query: string): ParsedQuery {
  const terms: string[] = [];
  const filters: QueryFilter[] = [];

  for (const rawToken of tokenize(query)) {
    let token = rawToken;
    let negate = false;
    if (token.startsWith('-') && token.length > 1) {
      negate = true;
      token = token.slice(1);
    }

    const match = token.match(/^([a-zA-Z]+):(.*)$/);
    if (match) {
      const key = KEY_ALIASES[match[1].toLowerCase()];
      const value = norm(stripQuotes(match[2]));
      if (key && value) {
        filters.push({ key, value, negate });
        continue;
      }
    }

    const term = norm(stripQuotes(token));
    if (term) terms.push(term);
  }

  return { terms, filters };
}

export function hasActiveQuery(parsed: ParsedQuery): boolean {
  return parsed.terms.length > 0 || parsed.filters.length > 0;
}

const getTestCaseTags = (testCase: TestCase): string[] =>
  norm(testCase.tags)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

export function testCaseMatchesQuery(testCase: TestCase, parsed: ParsedQuery): boolean {
  if (parsed.terms.length > 0) {
    const haystack = [
      testCase.title,
      testCase.description,
      testCase.reference,
      testCase.tags,
      testCase.preconditions,
      testCase.steps,
      testCase.expected_result,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!parsed.terms.every((term) => haystack.includes(term))) {
      return false;
    }
  }

  for (const filter of parsed.filters) {
    let ok = true;
    switch (filter.key) {
      case 'priority':
        ok = norm(testCase.priority) === filter.value;
        break;
      case 'type':
        ok = norm(testCase.test_type).includes(filter.value);
        break;
      case 'tag':
        ok = getTestCaseTags(testCase).some(
          (tag) => tag === filter.value || tag.includes(filter.value),
        );
        break;
      case 'reference':
        ok = norm(testCase.reference).includes(filter.value);
        break;
      case 'is':
        if (filter.value === 'automated') ok = norm(testCase.test_type).includes('autom');
        else if (filter.value === 'manual') ok = norm(testCase.test_type).includes('manual');
        break;
      default:
        break;
    }
    if (filter.negate) ok = !ok;
    if (!ok) return false;
  }

  return true;
}
