import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ScanSearch,
  Play,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Download,
  Share2,
  Loader2,
  SearchX,
  Bookmark,
  BookmarkPlus,
  X,
  Check,
  ShieldAlert,
  Flag,
  HelpCircle,
  Lightbulb,
  Users,
  Eraser,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  advancedSearchAPI,
  getApiErrorMessage,
  type AdvancedSearchEntity,
  type AdvancedSearchField,
  type AdvancedSearchResult,
  type SavedSearch,
} from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';

// Per-entity detail routes so result rows link back to the real record.
const DETAIL_PATH: Record<string, (projectId: string, row: Record<string, any>) => string | null> = {
  defects: (p, r) => `/projects/${p}/defects/${r.project_seq ?? r.id}`,
  requirements: (p, r) => `/projects/${p}/requirements/${r.project_seq ?? r.id}`,
  test_cases: (p, r) => `/projects/${p}/test-cases/${r.project_seq ?? r.id}`,
  test_plans: (p, r) => `/projects/${p}/test-plans/${r.project_seq ?? r.id}`,
  // Executions have no detail page of their own — open their test run.
  test_executions: (p, r) => (r.test_run_id ? `/projects/${p}/test-runs/${r.test_run_id}` : null),
  docs: (p, r) => `/projects/${p}/docs/${r.project_seq ?? r.id}`,
};

// Columns rendered per entity (keys map to the serialized result dict).
const COLUMNS: Record<string, string[]> = {
  defects: ['key', 'title', 'status', 'severity', 'priority', 'created_at'],
  requirements: ['key', 'title', 'status', 'priority', 'created_at'],
  test_cases: ['key', 'title', 'status', 'priority', 'type', 'created_at'],
  test_plans: ['key', 'title', 'status', 'created_at'],
  test_executions: ['key', 'title', 'status', 'created_at'],
  docs: ['key', 'title', 'status', 'created_at'],
};

// Meta fields shown as colored pills on each result card (key/title/date are
// rendered specially), derived from COLUMNS.
const metaColumnsFor = (entity: string) =>
  (COLUMNS[entity] ?? []).filter((c) => !['key', 'title', 'created_at'].includes(c));

// Soft, ring-bordered badge palette (works in light + dark).
const TONE: Record<string, string> = {
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/20',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-400/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20',
  green: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-400/20',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-400/20',
  teal: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-400/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-400/20',
};

// Maps a (lowercased) field value to a tone. Covers defect/requirement/test-case
// statuses, severities, priorities, and types; unknowns fall back to slate.
const VALUE_TONE: Record<string, keyof typeof TONE> = {
  // statuses
  open: 'blue', in_progress: 'amber', fixed: 'green', reopened: 'orange', closed: 'slate', rejected: 'red',
  draft: 'slate', reviewed: 'blue', approved: 'green', implemented: 'violet', verified: 'emerald', deprecated: 'slate',
  active: 'green', inactive: 'slate', archived: 'slate', published: 'green',
  // test plan / execution statuses
  pending: 'slate', running: 'blue', passed: 'green', failed: 'red',
  skipped: 'amber', blocked: 'orange', completed: 'emerald',
  // canonical ResultStatus values (TestResult.status)
  pass: 'green', fail: 'red', skip: 'amber', block: 'orange', not_started: 'slate',
  // severity / priority
  critical: 'red', urgent: 'red', high: 'orange', medium: 'blue', low: 'slate',
  // type
  manual: 'slate', automated: 'violet', exploratory: 'teal',
};

// Solid colors for the left accent stripe of each result card.
const STRIPE_TONE: Record<string, string> = {
  red: 'bg-red-500', orange: 'bg-orange-400', amber: 'bg-amber-400', blue: 'bg-blue-400',
  green: 'bg-green-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500', teal: 'bg-teal-500',
  slate: 'bg-slate-300 dark:bg-slate-600',
};

const toneFor = (value: unknown): keyof typeof TONE =>
  VALUE_TONE[String(value).toLowerCase()] ?? 'slate';

// Display-label overrides for status tokens whose stored form differs from how
// we want to show them (others fall back to a de-underscored, CSS-capitalized
// form). "not executed yet" is canonically not_started but shown as "Not Started".
const VALUE_LABEL: Record<string, string> = {
  not_started: 'Not Started',
};
const valueLabel = (value: unknown): string => {
  const v = String(value);
  return VALUE_LABEL[v.toLowerCase()] ?? v.replace(/_/g, ' ');
};

// Operator internal name (from the field catalog) -> the symbol users type.
const OP_SYMBOL: Record<string, string> = {
  eq: '=',
  ne: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  contains: '~',
  ncontains: '!~',
};
const ALL_OP_SYMBOLS = Object.values(OP_SYMBOL);
// Word operators offered alongside the symbols in the operator position.
// EMPTY is offered separately, after IS / IS NOT (see computeSuggestions).
const WORD_OPS = ['IN', 'NOT IN', 'IS', 'IS NOT'];
const CONNECTORS = ['AND', 'OR', 'NOT', 'ORDER BY'];

// Starter queries per entity, shown as one-click chips to flatten the TQL
// learning curve. Each entry lists the fields it references so an example is
// hidden whenever a field isn't available for this project's entity variant
// (keeps every shown example runnable, never a guaranteed parse error).
const EXAMPLE_QUERIES: Record<string, { tql: string; fields: string[] }[]> = {
  defects: [
    { tql: 'status = OPEN AND priority IN (HIGH, URGENT)', fields: ['status', 'priority'] },
    { tql: 'assignee = currentUser() AND status != CLOSED', fields: ['assignee', 'status'] },
    { tql: 'created >= -7d ORDER BY priority DESC', fields: ['created', 'priority'] },
  ],
  requirements: [
    { tql: 'status = APPROVED AND priority = HIGH', fields: ['status', 'priority'] },
    { tql: 'assignee = currentUser()', fields: ['assignee'] },
    { tql: 'tags ~ "security" ORDER BY created DESC', fields: ['tags', 'created'] },
  ],
  test_cases: [
    { tql: 'status = active AND priority = high', fields: ['status', 'priority'] },
    { tql: 'type = automated', fields: ['type'] },
    { tql: 'tags IS NOT EMPTY ORDER BY created DESC', fields: ['tags', 'created'] },
  ],
  test_plans: [
    { tql: 'status = running', fields: ['status'] },
    { tql: 'creator = currentUser() ORDER BY created DESC', fields: ['creator', 'created'] },
  ],
  test_executions: [
    { tql: 'status ~ "fail"', fields: ['status'] },
    { tql: 'executor = currentUser()', fields: ['executor'] },
  ],
  docs: [
    { tql: 'status = published', fields: ['status'] },
    { tql: 'tags ~ "api"', fields: ['tags'] },
    { tql: 'classification IS NOT EMPTY', fields: ['classification'] },
  ],
};

// Operator reference rows for the syntax-help panel. The symbol is literal; the
// description is translated (key resolved at render).
const OP_HELP: { token: string; descKey: string }[] = [
  { token: '=', descKey: 'advancedSearchOpEq' },
  { token: '!=', descKey: 'advancedSearchOpNe' },
  { token: '> < >= <=', descKey: 'advancedSearchOpRange' },
  { token: '~', descKey: 'advancedSearchOpContains' },
  { token: '!~', descKey: 'advancedSearchOpNContains' },
  { token: 'IN (…)', descKey: 'advancedSearchOpIn' },
  { token: 'NOT IN (…)', descKey: 'advancedSearchOpNotIn' },
  { token: 'IS EMPTY', descKey: 'advancedSearchOpEmpty' },
  { token: 'IS NOT EMPTY', descKey: 'advancedSearchOpNotEmpty' },
];

const FN_HELP: { token: string; descKey: string }[] = [
  { token: 'currentUser()', descKey: 'advancedSearchFnCurrentUser' },
  { token: 'now()', descKey: 'advancedSearchFnNow' },
  { token: '-7d', descKey: 'advancedSearchFnReldate' },
];

const PAGE_SIZE = 50;
// Mirrors the server-side export cap in app/services/tql/entities.py (export_search).
// Used only to warn when a CSV export will be truncated; the server enforces it.
const EXPORT_CAP = 5000;
const SUGGEST_LISTBOX_ID = 'tql-suggestions';
const suggestOptionId = (i: number) => `${SUGGEST_LISTBOX_ID}-opt-${i}`;

type Suggestion = { value: string; kind: string; hint?: string };
// When the caret sits in a value position, which field + partial value is it for.
type SuggestionResult = {
  word: string;
  items: Suggestion[];
  valueField: AdvancedSearchField | null;
  partial: string;
};

// Suggest the next token given the text before the caret. Whitespace-tokenized
// (the placeholder/examples are space-separated), which keeps this simple and
// predictable without a full parser.
function computeSuggestions(
  beforeCaret: string,
  fields: AdvancedSearchField[],
): SuggestionResult {
  const endsWithSpace = /\s$/.test(beforeCaret) || beforeCaret.length === 0;
  const trimmed = beforeCaret.trim();
  const parts = trimmed ? trimmed.split(/\s+/) : [];
  const word = endsWithSpace ? '' : parts[parts.length - 1] ?? '';
  const context = endsWithSpace ? parts : parts.slice(0, -1);
  const prev = context[context.length - 1];
  const prev2 = context[context.length - 2];
  const prev3 = context[context.length - 3];
  const byName = (n?: string) => fields.find((f) => f.name === n);
  const up = (s?: string) => (s ?? '').toUpperCase();

  // --- value position inside an IN (...) list -------------------------------
  // The whitespace tokenizer can't see through "(" and ",", so match this shape
  // directly: FIELD IN ( a, b, <caret>  (also "NOT IN"). We then offer the
  // field's choices — and, for suggest fields, live values fetched by the caller.
  const inListMatch = beforeCaret.match(/([a-zA-Z_]\w*)\s+(?:not\s+)?in\s*\(([^)]*)$/i);
  if (inListMatch) {
    const field = byName(inListMatch[1]) ?? null;
    // Token under the caret: trailing run of value chars (no space, comma, paren).
    const listWord = beforeCaret.match(/[^\s,(]*$/)?.[0] ?? '';
    const listPartial = listWord.replace(/^"/, '').replace(/"$/, '');
    const listPool: Suggestion[] = [];
    if (field) {
      if (field.choices.length) {
        listPool.push(...field.choices.map((c) => ({ value: c, kind: 'value' })));
      } else if (field.kind === 'user') {
        listPool.push({ value: 'currentUser()', kind: 'function' });
      }
    }
    const listItems = listPool
      .filter((s) => s.value.toLowerCase().startsWith(listPartial.toLowerCase()))
      .slice(0, 8);
    return { word: listWord, items: listItems, valueField: field, partial: listPartial };
  }

  let pool: Suggestion[];
  let valueField: AdvancedSearchField | null = null;
  // In value position the typed token may be wrapped in quotes; strip them.
  const partial = word.replace(/^"/, '').replace(/"$/, '');
  let filterText = word;

  // We're in a value position after a comparison operator, OR after IS / IS NOT
  // (which read as = / !=). Resolve which field, and any extra keywords to offer.
  let valueFieldName: string | undefined;
  let extraKeywords: Suggestion[] = [];
  if (prev && ALL_OP_SYMBOLS.includes(prev)) {
    valueFieldName = prev2;
  } else if (up(prev) === 'IS') {
    valueFieldName = prev2;
    extraKeywords = [{ value: 'EMPTY', kind: 'operator' }, { value: 'NOT', kind: 'operator' }];
  } else if (up(prev) === 'NOT' && up(prev2) === 'IS') {
    valueFieldName = prev3;
    extraKeywords = [{ value: 'EMPTY', kind: 'operator' }];
  }

  if (valueFieldName !== undefined) {
    // Value position: field choices / functions (live values fetched by caller),
    // plus EMPTY/NOT when reached via IS / IS NOT.
    const field = byName(valueFieldName) ?? null;
    valueField = field;
    filterText = partial;
    pool = [...extraKeywords];
    if (field) {
      if (field.choices.length) {
        pool.push(...field.choices.map((c) => ({ value: c, kind: 'value' })));
      } else if (field.kind === 'user') {
        pool.push({ value: 'currentUser()', kind: 'function' });
      } else if (field.kind === 'date') {
        pool.push(
          { value: 'now()', kind: 'function' },
          { value: '-7d', kind: 'value' },
          { value: '-30d', kind: 'value' },
        );
      }
    }
  } else if (byName(prev)) {
    // Operator position: the field's symbol operators + word operators.
    const field = byName(prev)!;
    const symbols = Array.from(new Set(field.operators.map((o) => OP_SYMBOL[o]).filter(Boolean)));
    pool = [
      ...symbols.map((s) => ({ value: s, kind: 'operator' })),
      ...WORD_OPS.map((s) => ({ value: s, kind: 'operator' })),
    ];
  } else {
    // Field position (start, or after a connector): field names + connectors.
    pool = [
      ...fields.map((f) => ({ value: f.name, kind: 'field', hint: f.kind })),
      ...CONNECTORS.map((c) => ({ value: c, kind: 'connector' })),
    ];
  }

  const items = pool
    .filter((s) => s.value.toLowerCase().startsWith(filterText.toLowerCase()))
    .slice(0, 8);
  return { word, items, valueField, partial };
}

// Normalize a suggestion value for de-duplication (drop wrapping quotes, fold case).
const normSuggestion = (v: string) => v.replace(/^"/, '').replace(/"$/, '').toLowerCase();

// Merge static (canonical) suggestions with live data values, keeping static
// first and dropping case-insensitive duplicates. Capped to keep the list short.
function mergeSuggestions(staticItems: Suggestion[], liveItems: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of [...staticItems, ...liveItems]) {
    const key = normSuggestion(s.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 12);
}

// --- resume last query (per project) ---------------------------------------
// We remember the entity + TQL of the last search a user ran in each project so
// returning to the page restores it (prefilled, not auto-run — a shared ?tql=
// link still wins). Best-effort: storage may be unavailable (private mode).
const lastQueryKey = (projectId?: string) => `advancedSearch:last:${projectId ?? ''}`;

const loadLastQuery = (projectId?: string): { entity?: string; tql?: string } | null => {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(lastQueryKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveLastQuery = (projectId: string | undefined, entity: string, tql: string) => {
  if (!projectId) return;
  try {
    localStorage.setItem(lastQueryKey(projectId), JSON.stringify({ entity, tql }));
  } catch {
    /* storage unavailable — resume is best-effort */
  }
};

export function AdvancedSearch() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const { toast } = useToast();

  // A shared ?entity=/?tql= link wins; otherwise fall back to the last query the
  // user ran in this project (prefill only — see the auto-run effect below).
  const resumed = useRef(loadLastQuery(projectId)).current;
  const [entities, setEntities] = useState<AdvancedSearchEntity[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);
  const [entityKey, setEntityKey] = useState<string>(
    searchParams.get('entity') || resumed?.entity || 'defects',
  );
  const [query, setQuery] = useState(searchParams.get('tql') ?? resumed?.tql ?? '');
  const [result, setResult] = useState<AdvancedSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The entity/query that produced the current results — what pagination,
  // export, and share act on (may differ from the edited inputs).
  const [active, setActive] = useState<{ entity: string; tql: string } | null>(null);

  // Syntax help panel.
  const [showHelp, setShowHelp] = useState(false);

  // Saved searches.
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [shareSaved, setShareSaved] = useState(false);
  const [savingBusy, setSavingBusy] = useState(false);

  // Autocomplete state.
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const wordRef = useRef(''); // the partial token the suggestions are replacing
  const valueFetchTimer = useRef<number | undefined>(undefined);
  const valueFetchSeq = useRef(0); // guards against out-of-order async responses

  // Press "/" anywhere on the page to jump to the query box (unless already
  // typing in a field). A power-user affordance; mirrors common search UIs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const role = el?.getAttribute('role');
      // Don't steal "/" from text fields or interactive widgets with their own
      // typeahead (e.g. the entity Select trigger / an open listbox).
      if (
        el?.isContentEditable ||
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        role === 'combobox' || role === 'listbox' || role === 'option'
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    advancedSearchAPI
      .getEntities(parseInt(projectId))
      .then((data) => {
        setEntities(data.entities);
        // If the selected entity (e.g. from a deep-link) is disabled/hidden for
        // this project, fall back to the first enabled one.
        if (data.entities.length && !data.entities.some((e) => e.key === entityKey)) {
          setEntityKey(data.entities[0].key);
        }
      })
      .catch((err) => {
        toast({
          title: t('error'),
          description: getApiErrorMessage(err, t('advancedSearchLoadEntitiesError')),
          variant: 'destructive',
        });
      })
      .finally(() => setEntitiesLoaded(true));

  }, [projectId]);

  const currentEntity = useMemo(
    () => entities.find((e) => e.key === entityKey),
    [entities, entityKey],
  );

  // Examples valid for the current entity (every referenced field is available).
  const examples = useMemo(() => {
    const names = new Set((currentEntity?.fields ?? []).map((f) => f.name));
    return (EXAMPLE_QUERIES[entityKey] ?? []).filter((e) => e.fields.every((f) => names.has(f)));
  }, [currentEntity, entityKey]);

  // Keep the keyboard-highlighted suggestion scrolled into view (the dropdown
  // is height-capped + scrollable, so arrowing past the fold would hide it).
  useEffect(() => {
    if (!suggestOpen) return;
    document
      .getElementById(suggestOptionId(activeSuggestion))
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestion, suggestOpen]);

  const refreshSuggestions = (value: string, caret: number) => {
    if (!currentEntity) {
      setSuggestOpen(false);
      return;
    }
    const { word, items, valueField, partial } = computeSuggestions(
      value.slice(0, caret),
      currentEntity.fields,
    );
    wordRef.current = word;
    setActiveSuggestion(0);

    // Suggest-enabled fields pull live values from the data (e.g. existing tags,
    // or the statuses actually recorded for executions), inserted wrapped in
    // double quotes. When the field also carries canonical choices (e.g. the
    // standard execution statuses) we merge those static choices with the live
    // values so the user always sees the standard set plus any real variants.
    if (projectId && valueField && valueField.suggest) {
      setSuggestions(items);
      setSuggestOpen(items.length > 0);
      const seq = ++valueFetchSeq.current;
      window.clearTimeout(valueFetchTimer.current);
      valueFetchTimer.current = window.setTimeout(async () => {
        try {
          const values = await advancedSearchAPI.fieldValues(
            parseInt(projectId),
            entityKey,
            valueField.name,
            partial,
          );
          if (seq !== valueFetchSeq.current) return; // a newer keystroke superseded us
          const quoted = values.map((v) => ({ value: `"${v}"`, kind: 'value' }));
          const merged = mergeSuggestions(items, quoted);
          setSuggestions(merged);
          setActiveSuggestion(0);
          setSuggestOpen(merged.length > 0);
        } catch {
          /* suggestions are best-effort; ignore fetch errors */
        }
      }, 200);
      return;
    }

    setSuggestions(items);
    setSuggestOpen(items.length > 0);
  };

  const acceptSuggestion = (s: Suggestion) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? query.length;
    const before = query.slice(0, caret);
    const after = query.slice(caret);
    const head = before.slice(0, before.length - wordRef.current.length);
    // Operators/values read better followed by a space; fields wait for an operator.
    const next = `${head}${s.value} ${after}`;
    setQuery(next);
    setSuggestOpen(false);
    const newCaret = head.length + s.value.length + 1;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(newCaret, newCaret);
      refreshSuggestions(next, newCaret);
    });
  };

  const doSearch = async (ent: string, tqlText: string, offset: number) => {
    if (!projectId) return;
    setSuggestOpen(false);
    try {
      setRunning(true);
      setError(null);
      const data = await advancedSearchAPI.search(parseInt(projectId), ent, tqlText, PAGE_SIZE, offset);
      setResult(data);
      setActive({ entity: ent, tql: tqlText });
      // Reflect the query in the URL so the page is shareable / back-navigable.
      const next: Record<string, string> = { entity: ent };
      if (tqlText.trim()) next.tql = tqlText.trim();
      setSearchParams(next, { replace: true });
      // Remember it so returning to this project's search resumes where we left off.
      saveLastQuery(projectId, ent, tqlText);
    } catch (err) {
      setError(getApiErrorMessage(err, t('advancedSearchInvalidQuery')));
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const runSearch = () => doSearch(entityKey, query, 0);

  // One-click example: load it into the box and run it immediately.
  const runExample = (tql: string) => {
    setQuery(tql);
    setSuggestOpen(false);
    void doSearch(entityKey, tql, 0);
  };

  // Auto-run once if the URL carried a shared query — but only after the
  // (feature-filtered) entity list has loaded, and only if the requested entity
  // is enabled for this project. A deep-link to a disabled entity is ignored.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current || !entities.length) return;
    const urlEntity = searchParams.get('entity');
    const urlTql = searchParams.get('tql');
    if (!urlEntity && !urlTql) return;
    autoRanRef.current = true;
    const ent = urlEntity && entities.some((e) => e.key === urlEntity) ? urlEntity : null;
    if (ent) void doSearch(ent, urlTql || '', 0);

  }, [entities]);

  const goToPage = (offset: number) => {
    if (active) void doSearch(active.entity, active.tql, Math.max(0, offset));
  };

  const exportCsv = async () => {
    if (!projectId) return;
    const target = active ?? { entity: entityKey, tql: query };
    try {
      setExporting(true);
      await advancedSearchAPI.exportCsv(parseInt(projectId), target.entity, target.tql);
      // result.total is the authoritative match count for the active query; the
      // server caps the file at EXPORT_CAP rows, so warn when some were left out.
      const total = result?.total ?? 0;
      if (total > EXPORT_CAP) {
        toast({
          title: t('advancedSearchExportTruncatedTitle'),
          description: t('advancedSearchExportTruncatedDesc', {
            cap: EXPORT_CAP.toLocaleString(),
            total: total.toLocaleString(),
          }),
        });
      } else {
        toast({
          title: t('advancedSearchExportDone'),
          description: t('advancedSearchExportDoneDesc', { count: total.toLocaleString() }),
        });
      }
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('advancedSearchExportError')),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  // Saved searches: load on mount, apply, save, delete.
  useEffect(() => {
    if (!projectId) return;
    advancedSearchAPI
      .listSaved(parseInt(projectId))
      .then(setSavedSearches)
      .catch(() => {
        /* non-critical */
      });
  }, [projectId]);

  const applySaved = (s: SavedSearch) => {
    setEntityKey(s.entity);
    setQuery(s.tql);
    setSuggestOpen(false);
    void doSearch(s.entity, s.tql, 0);
  };

  const saveCurrent = async () => {
    if (!projectId || !saveName.trim()) return;
    try {
      setSavingBusy(true);
      await advancedSearchAPI.saveSearch(parseInt(projectId), saveName.trim(), entityKey, query, shareSaved);
      setSavedSearches(await advancedSearchAPI.listSaved(parseInt(projectId)));
      setSaveMode(false);
      setSaveName('');
      setShareSaved(false);
      toast({ title: t('advancedSearchSaved') });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('advancedSearchSaveError')),
        variant: 'destructive',
      });
    } finally {
      setSavingBusy(false);
    }
  };

  const removeSaved = async (id: number) => {
    if (!projectId) return;
    try {
      await advancedSearchAPI.deleteSaved(id);
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('advancedSearchDeleteError')),
        variant: 'destructive',
      });
    }
  };

  // Insert a field name into the query at the caret (chip click).
  const insertField = (name: string) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? query.length;
    const before = query.slice(0, caret);
    const after = query.slice(caret);
    const sep = before && !before.endsWith(' ') ? ' ' : '';
    const next = `${before}${sep}${name} ${after}`;
    setQuery(next);
    const newCaret = before.length + sep.length + name.length + 1;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(newCaret, newCaret);
      refreshSuggestions(next, newCaret);
    });
  };

  const clearQuery = () => {
    setQuery('');
    setSuggestOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Reset the whole search: query text, results, error, and the URL — back to a
  // blank slate for this entity.
  const clearAll = () => {
    setQuery('');
    setResult(null);
    setError(null);
    setActive(null);
    setSuggestOpen(false);
    setSearchParams({ entity: entityKey }, { replace: true });
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const hasSomethingToClear = query.trim().length > 0 || result !== null;

  const shareLink = async () => {
    const target = active ?? { entity: entityKey, tql: query };
    const params = new URLSearchParams({ entity: target.entity });
    if (target.tql.trim()) params.append('tql', target.tql.trim());
    const url = `${window.location.origin}/projects/${projectId}/advanced-search?${params}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('advancedSearchLinkCopied') });
    } catch {
      // Clipboard can be blocked (insecure context); show the link to copy manually.
      toast({ title: t('advancedSearchLinkCopied'), description: url });
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestOpen && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestOpen)) {
        e.preventDefault();
        acceptSuggestion(suggestions[activeSuggestion]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestOpen(false);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch();
    }
  };

  // Switching entity invalidates a query written against the old fields.
  const onEntityChange = (key: string) => {
    setEntityKey(key);
    setResult(null);
    setError(null);
    setSuggestOpen(false);
  };

  const metaColumns = metaColumnsFor(entityKey);

  const formatDate = (value?: string) =>
    value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

  // The accent stripe reflects the strongest available signal on the row.
  const accentTone = (row: Record<string, any>): keyof typeof TONE =>
    toneFor(row.severity ?? row.priority ?? row.status ?? row.type);

  // Advanced Search is enabled but every searchable entity is disabled for this
  // project — there's nothing to query, so show guidance instead of an empty,
  // 403-on-submit form.
  if (entitiesLoaded && entities.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <ScanSearch className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t('advancedSearch')}</h1>
            <p className="text-sm text-muted-foreground">{t('advancedSearchSubtitle')}</p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ScanSearch className="h-10 w-10 text-muted-foreground/40" />
            <h2 className="text-lg font-medium">{t('advancedSearchNoEntitiesTitle')}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t('advancedSearchNoEntitiesDesc')}
            </p>
            {projectId && (
              <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/settings`)}>
                {t('projectSettings')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ScanSearch className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t('advancedSearch')}</h1>
          <p className="text-sm text-muted-foreground">{t('advancedSearchSubtitle')}</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Select value={entityKey} onValueChange={onEntityChange}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={t('advancedSearchEntity')} />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.key} value={e.key}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  refreshSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyDown={onInputKeyDown}
                onFocus={(e) => {
                  setInputFocused(true);
                  refreshSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onBlur={() => {
                  setInputFocused(false);
                  setTimeout(() => setSuggestOpen(false), 120);
                }}
                placeholder={t('advancedSearchPlaceholder')}
                className={`w-full font-mono text-sm ${query ? 'pr-8' : ''}`}
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-expanded={suggestOpen && suggestions.length > 0}
                aria-controls={SUGGEST_LISTBOX_ID}
                aria-autocomplete="list"
                aria-activedescendant={
                  suggestOpen && suggestions.length > 0 ? suggestOptionId(activeSuggestion) : undefined
                }
              />
              {query && (
                <button
                  type="button"
                  onClick={clearQuery}
                  aria-label={t('advancedSearchClear')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {!query && !inputFocused && (
                <kbd
                  aria-hidden="true"
                  className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 select-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 sm:inline-block"
                >
                  /
                </kbd>
              )}
              {suggestOpen && suggestions.length > 0 && (
                <ul
                  id={SUGGEST_LISTBOX_ID}
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover py-1 shadow-md"
                >
                  {suggestions.map((s, i) => (
                    <li key={`${s.kind}-${s.value}`} role="option" aria-selected={i === activeSuggestion}>
                      <button
                        type="button"
                        id={suggestOptionId(i)}
                        tabIndex={-1}
                        // onMouseDown (not onClick) so it fires before the input's onBlur.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          acceptSuggestion(s);
                        }}
                        onMouseEnter={() => setActiveSuggestion(i)}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                          i === activeSuggestion ? 'bg-accent text-accent-foreground' : ''
                        }`}
                      >
                        <span className="font-mono">{s.value}</span>
                        <span className="ml-3 text-[11px] text-muted-foreground">{s.hint ?? s.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button onClick={() => void runSearch()} disabled={running}>
              <Play className="mr-2 h-4 w-4" />
              {running ? t('advancedSearchRunning') : t('advancedSearchRun')}
            </Button>
            {saveMode ? (
              <div className="flex flex-wrap items-center gap-1">
                <Input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveCurrent();
                    if (e.key === 'Escape') setSaveMode(false);
                  }}
                  placeholder={t('advancedSearchSaveNamePlaceholder')}
                  className="w-40 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant={shareSaved ? 'default' : 'outline'}
                  onClick={() => setShareSaved((v) => !v)}
                  aria-pressed={shareSaved}
                  title={t('advancedSearchShareWithTeamHint')}
                >
                  <Users className="me-1.5 h-3.5 w-3.5" />
                  {t('advancedSearchShareWithTeam')}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void saveCurrent()} disabled={savingBusy || !saveName.trim()}>
                  {savingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setSaveMode(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setSaveName('');
                  setShareSaved(false);
                  setSaveMode(true);
                }}
                disabled={!query.trim()}
                title={t('advancedSearchSave')}
              >
                <BookmarkPlus className="me-2 h-4 w-4" />
                {t('advancedSearchSave')}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={clearAll}
              disabled={!hasSomethingToClear}
              title={t('advancedSearchClear')}
            >
              <Eraser className="me-2 h-4 w-4" />
              {t('advancedSearchClear')}
            </Button>
          </div>

          <div className="flex items-start justify-between gap-2">
            {error ? (
              <div className="flex flex-1 items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : (
              <p className="flex-1 text-xs text-muted-foreground">{t('advancedSearchHint')}</p>
            )}
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              aria-expanded={showHelp}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {t('advancedSearchHelpToggle')}
            </button>
          </div>

          {/* Syntax help — operators, connectors, functions. */}
          {showHelp && (
            <div className="grid gap-4 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-3">
              <div>
                <p className="mb-1.5 font-semibold text-foreground">{t('advancedSearchHelpOperators')}</p>
                <dl className="space-y-1">
                  {OP_HELP.map((o) => (
                    <div key={o.token} className="flex items-baseline gap-2">
                      <dt className="shrink-0 font-mono text-[11px] text-foreground">{o.token}</dt>
                      <dd className="text-muted-foreground">{t(o.descKey)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="mb-1.5 font-semibold text-foreground">{t('advancedSearchHelpFunctions')}</p>
                <dl className="space-y-1">
                  {FN_HELP.map((o) => (
                    <div key={o.token} className="flex items-baseline gap-2">
                      <dt className="shrink-0 font-mono text-[11px] text-foreground">{o.token}</dt>
                      <dd className="text-muted-foreground">{t(o.descKey)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="mb-1.5 font-semibold text-foreground">{t('advancedSearchHelpConnectors')}</p>
                <p className="text-muted-foreground">{t('advancedSearchConnHint')}</p>
              </div>
            </div>
          )}

          {/* One-click example queries (entity-aware). */}
          {examples.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('advancedSearchExamples')}:</span>
              {examples.map((ex) => (
                <button
                  key={ex.tql}
                  type="button"
                  onClick={() => runExample(ex.tql)}
                  className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {ex.tql}
                </button>
              ))}
            </div>
          )}

          {/* Saved searches */}
          {savedSearches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
              {savedSearches.map((s) => (
                <span
                  key={s.id}
                  className="group inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs hover:bg-accent"
                >
                  {s.is_shared && (
                    <span title={t('advancedSearchSharedBadge')} className="inline-flex shrink-0">
                      <Users className="h-3 w-3 text-muted-foreground" aria-label={t('advancedSearchSharedBadge')} />
                    </span>
                  )}
                  <button type="button" onClick={() => applySaved(s)} className="font-medium" title={`${s.entity}: ${s.tql || '(all)'}`}>
                    {s.name}
                  </button>
                  {s.is_owner && (
                    <button
                      type="button"
                      onClick={() => void removeSaved(s.id)}
                      aria-label={t('advancedSearchDelete')}
                      className="rounded-full p-0.5 text-muted-foreground/50 hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Field reference — click a field to insert it into the query. */}
          {currentEntity && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">{t('advancedSearchFields')}:</span>
              {currentEntity.fields.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => insertField(f.name)}
                  title={`${f.operators.map((o) => OP_SYMBOL[o] ?? o).join(' ')}${
                    f.choices.length ? ` · ${f.choices.join(', ')}` : ''
                  }`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results panel — one seamless surface: toolbar, rows, pagination. */}
      {(result || running) && (
        <Card className="overflow-hidden p-0">
          {/* Toolbar */}
          {result && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{result.label}</h2>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
                  {t('advancedSearchResultCount', { count: result.total })}
                </span>
                {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => void shareLink()} disabled={result.total === 0}>
                  <Share2 className="mr-2 h-4 w-4" />
                  {t('advancedSearchShare')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void exportCsv()}
                  disabled={exporting || result.total === 0}
                >
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  {exporting ? t('advancedSearchExporting') : t('advancedSearchExport')}
                </Button>
              </div>
            </div>
          )}

          {/* Skeleton rows (initial run only — pagination keeps prior rows visible). */}
          {running && !result && (
            <div className="divide-y">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-muted" />
                  <span className="h-3.5 w-14 shrink-0 animate-pulse rounded bg-muted" />
                  <span className="h-3.5 flex-1 animate-pulse rounded bg-muted/70" />
                  <span className="hidden h-3.5 w-20 shrink-0 animate-pulse rounded bg-muted/50 sm:block" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {result && result.total === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <SearchX className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">{t('advancedSearchNoResults')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('advancedSearchNoResultsHint')}</p>
            </div>
          )}

          {/* Rows */}
          {result && result.total > 0 && (
            <>
              <div className={`divide-y transition-opacity ${running ? 'pointer-events-none opacity-60' : ''}`}>
                {result.results.map((row) => {
                  const href = projectId ? DETAIL_PATH[entityKey]?.(projectId, row) : null;
                  const tone = accentTone(row);
                  const inner = (
                    <>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STRIPE_TONE[tone]}`} aria-hidden="true" />
                      {row.key && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                          {row.key}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{row.title || '—'}</span>
                      <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                        {metaColumns.map((col) => {
                          if (!row[col]) return null;
                          const Icon = col === 'severity' ? ShieldAlert : col === 'priority' ? Flag : null;
                          return (
                            <span
                              key={col}
                              title={col}
                              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${TONE[toneFor(row[col])]}`}
                            >
                              {Icon && <Icon className="h-3 w-3" />}
                              {valueLabel(row[col])}
                            </span>
                          );
                        })}
                      </div>
                      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                        {formatDate(row.created_at)}
                      </span>
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition-colors rtl:rotate-180 ${href ? 'text-muted-foreground/30 group-hover:text-foreground' : 'invisible'}`}
                      />
                    </>
                  );
                  const cls =
                    'group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50';
                  return href ? (
                    <Link key={row.id} to={href} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={row.id} className={`${cls} cursor-default`}>
                      {inner}
                    </div>
                  );
                })}
              </div>

              {/* Pagination footer */}
              <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                <span className="text-xs">
                  {t('advancedSearchRange', {
                    from: result.offset + 1,
                    to: result.offset + result.count,
                    total: result.total,
                  })}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => goToPage(result.offset - PAGE_SIZE)}
                    disabled={running || result.offset === 0}
                  >
                    <ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" />
                    {t('advancedSearchPrev')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => goToPage(result.offset + PAGE_SIZE)}
                    disabled={running || result.offset + result.count >= result.total}
                  >
                    {t('advancedSearchNext')}
                    <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Initial state — before any search has run. */}
      {!result && !running && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <ScanSearch className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium">{t('advancedSearchEmptyTitle')}</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('advancedSearchHint')}</p>
        </div>
      )}
    </div>
  );
}

export default AdvancedSearch;
