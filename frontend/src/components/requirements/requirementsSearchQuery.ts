import { Requirement } from '@/types';

// Lightweight, fully client-side query language for the requirements list.
// Supports free text plus `key:value` tokens (quotes and `-` negation), e.g.
//   login status:approved priority:high -tag:legacy id:REQ-12
// Mirrors the test-case / defect search languages so the shared "/" palette
// behaves consistently and filtering stays fast against the in-memory list.

export interface RequirementQueryFilter {
  key: string;
  value: string;
  negate: boolean;
}

export interface ParsedRequirementQuery {
  terms: string[];
  filters: RequirementQueryFilter[];
}

// Map user-typed keys (and short aliases) onto canonical filter keys.
const KEY_ALIASES: Record<string, string> = {
  status: 'status',
  s: 'status',
  state: 'status',
  priority: 'priority',
  p: 'priority',
  pri: 'priority',
  tag: 'tag',
  tags: 'tag',
  id: 'id',
  key: 'id',
};

export const REQUIREMENT_FILTER_KEYS = ['status', 'priority', 'tag', 'id'] as const;

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

export function parseRequirementQuery(query: string): ParsedRequirementQuery {
  const terms: string[] = [];
  const filters: RequirementQueryFilter[] = [];

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

export function hasActiveRequirementQuery(parsed: ParsedRequirementQuery): boolean {
  return parsed.terms.length > 0 || parsed.filters.length > 0;
}

const getRequirementTags = (requirement: Requirement): string[] =>
  norm(requirement?.tags)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

export function requirementMatchesQuery(
  requirement: Requirement,
  parsed: ParsedRequirementQuery,
): boolean {
  if (parsed.terms.length > 0) {
    const haystack = [
      requirement?.title,
      requirement?.description,
      requirement?.requirement_id,
      requirement?.tags,
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
      case 'status':
        ok = norm(requirement?.status) === filter.value;
        break;
      case 'priority':
        ok = norm(requirement?.priority) === filter.value;
        break;
      case 'tag':
        ok = getRequirementTags(requirement).some(
          (tag) => tag === filter.value || tag.includes(filter.value),
        );
        break;
      case 'id':
        ok = norm(requirement?.requirement_id).includes(filter.value);
        break;
      default:
        break;
    }
    if (filter.negate) ok = !ok;
    if (!ok) return false;
  }

  return true;
}
