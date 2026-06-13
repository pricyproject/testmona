// Lightweight, fully client-side query language for the defects list.
// Supports free text plus `key:value` tokens (quotes and `-` negation), e.g.
//   crash status:open severity:critical -priority:low tag:flaky env:staging
// Mirrors the test-case search language so the shared `/` palette stays
// consistent across modules while keeping filtering fast against the
// already in-memory, paginated result set.

export interface DefectQueryFilter {
  key: string;
  value: string;
  negate: boolean;
}

export interface ParsedDefectQuery {
  terms: string[];
  filters: DefectQueryFilter[];
}

// Map user-typed keys (and short aliases) onto canonical filter keys.
const KEY_ALIASES: Record<string, string> = {
  status: 'status',
  s: 'status',
  state: 'status',
  severity: 'severity',
  sev: 'severity',
  priority: 'priority',
  p: 'priority',
  pri: 'priority',
  tag: 'tag',
  tags: 'tag',
  env: 'env',
  environment: 'env',
};

export const DEFECT_FILTER_KEYS = ['status', 'severity', 'priority', 'tag', 'env'] as const;

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

export function parseDefectQuery(query: string): ParsedDefectQuery {
  const terms: string[] = [];
  const filters: DefectQueryFilter[] = [];

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

export function hasActiveDefectQuery(parsed: ParsedDefectQuery): boolean {
  return parsed.terms.length > 0 || parsed.filters.length > 0;
}

const getDefectTags = (defect: any): string[] =>
  norm(defect?.tags)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

export function defectMatchesQuery(defect: any, parsed: ParsedDefectQuery): boolean {
  if (parsed.terms.length > 0) {
    const haystack = [
      defect?.title,
      defect?.description,
      defect?.defect_id,
      defect?.tags,
      defect?.environment,
      defect?.steps_to_reproduce,
      defect?.requirement_id,
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
        ok = norm(defect?.status) === filter.value;
        break;
      case 'severity':
        ok = norm(defect?.severity) === filter.value;
        break;
      case 'priority':
        ok = norm(defect?.priority) === filter.value;
        break;
      case 'tag':
        ok = getDefectTags(defect).some(
          (tag) => tag === filter.value || tag.includes(filter.value),
        );
        break;
      case 'env':
        ok = norm(defect?.environment).includes(filter.value);
        break;
      default:
        break;
    }
    if (filter.negate) ok = !ok;
    if (!ok) return false;
  }

  return true;
}
