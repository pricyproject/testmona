import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Inbox,
  AtSign,
  UserPlus,
  ClipboardCheck,
  MessageSquareReply,
  MessageSquareWarning,
  Archive,
  ArchiveRestore,
  RefreshCw,
  ChevronRight,
  Search,
  X,
  Sparkles,
  Clock,
  AlarmClock,
  AlarmClockOff,
  Layers,
  ArrowDownUp,
  User as UserIcon,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { inboxAPI, type InboxStatus, type InboxSort, type InboxBulkActionType, type InboxActorOption, type InboxProjectOption } from '@/lib/api/inbox';
import { useInboxViewStore, type InboxGroupBy } from '@/stores/inboxViewStore';
import { openNotification } from '@/lib/notificationNavigation';
import { requirementsAPI } from '@/lib/api/requirements_docs';
import { Notification, InboxSummary } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/hooks/use-toast';

// Per-category visual language: icon + tint + a solid avatar color, so a row
// reads at a glance. Keys match the backend notification-engine category keys.
type CategoryVisual = { Icon: typeof Inbox; wrap: string; avatar: string };
const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  mention: { Icon: AtSign, wrap: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300', avatar: 'bg-violet-500' },
  comment_reply: { Icon: MessageSquareReply, wrap: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300', avatar: 'bg-sky-500' },
  assignment: { Icon: UserPlus, wrap: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300', avatar: 'bg-emerald-500' },
  review: { Icon: ClipboardCheck, wrap: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300', avatar: 'bg-amber-500' },
  feedback: { Icon: MessageSquareWarning, wrap: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300', avatar: 'bg-rose-500' },
};

const fallbackVisual: CategoryVisual = {
  Icon: Inbox,
  wrap: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  avatar: 'bg-slate-500',
};

// i18n key for each group-by mode's trigger label.
const GROUP_BY_LABELS: Record<InboxGroupBy, string> = {
  date: 'inboxGroupByDate',
  category: 'inboxGroupByCategory',
  entity: 'inboxGroupByEntity',
  project: 'inboxGroupByProject',
};

const visualFor = (key?: string | null): CategoryVisual => (key && CATEGORY_VISUALS[key]) || fallbackVisual;

const PAGE_SIZE = 50;

const initials = (name?: string | null): string => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Snooze presets. Times land on tidy local boundaries so "Tomorrow" / "Next
// week" mean what a human expects rather than "+24h".
type SnoozePreset = { key: string; labelKey: string; date: () => Date };
const SNOOZE_PRESETS: SnoozePreset[] = [
  { key: 'later', labelKey: 'inboxSnoozeLaterToday', date: () => new Date(Date.now() + 3 * 3_600_000) },
  {
    key: 'tomorrow',
    labelKey: 'inboxSnoozeTomorrow',
    date: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    key: 'nextweek',
    labelKey: 'inboxSnoozeNextWeek',
    date: () => {
      const d = new Date();
      const daysUntilMonday = ((8 - d.getDay()) % 7) || 7; // next Monday
      d.setDate(d.getDate() + daysUntilMonday);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

// Format a Date for an <input type="datetime-local"> (local time, no offset).
const toLocalInputValue = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// --- W4: aging / SLA signals (pure presentation over created_at) ----------
const DAY_MS = 86_400_000;
// How many days an OPEN item of a given category may sit before it's "overdue".
// e.g. a review pending more than 2 days is past its soft SLA. No backend state.
const CATEGORY_SLA_DAYS: Record<string, number> = {
  review: 2,
  mention: 2,
  feedback: 2,
  assignment: 3,
  comment_reply: 3,
};
// Any open item this old (without an earlier category SLA breach) reads as stale.
const STALE_DAYS = 7;

type AgingLevel = 'none' | 'stale' | 'overdue';

// Aging only applies to *open* pending work: snoozed items are intentionally
// deferred and done items are finished, so neither ages.
function agingFor(createdAt: string, category: string | null | undefined, status: InboxStatus): { level: AgingLevel; ageMs: number } {
  const created = new Date(createdAt).getTime();
  const ageMs = Number.isNaN(created) ? 0 : Math.max(0, Date.now() - created);
  if (status !== 'open') return { level: 'none', ageMs };
  const ageDays = ageMs / DAY_MS;
  const sla = category ? CATEGORY_SLA_DAYS[category] : undefined;
  if (sla !== undefined && ageDays >= sla) return { level: 'overdue', ageMs };
  if (ageDays >= STALE_DAYS) return { level: 'stale', ageMs };
  return { level: 'none', ageMs };
}

// W6 — items that support an inline "resolve" action whose mutation belongs to
// the entity's own API (the inbox only orchestrates the click, then marks the
// item done — it never emits a notification itself). Today: approving a
// requirement review. New inline actions slot in here as `category`+entity pairs.
function canResolveReview(n: Notification): boolean {
  return n.category === 'review' && n.related_entity_type === 'requirement' && n.related_entity_id != null;
}

// Compact age label, e.g. "3h", "5d", "2w".
function ageLabel(ageMs: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 1) return t('inboxAgeNew');
  if (hours < 24) return t('inboxAgeHour', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('inboxAgeDay', { count: days });
  return t('inboxAgeWeek', { count: Math.floor(days / 7) });
}

export function WorkInbox() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();

  // Persisted view shape (last-used view) — distinct from notification delivery
  // preferences. Reading individual fields keeps re-renders tight.
  const status = useInboxViewStore((s) => s.status);
  const activeCategory = useInboxViewStore((s) => s.activeCategory);
  const persistedUnreadOnly = useInboxViewStore((s) => s.unreadOnly);
  const unreadOnly = false;
  const groupBy = useInboxViewStore((s) => s.groupBy);
  const sort = useInboxViewStore((s) => s.sort);
  const setView = useInboxViewStore((s) => s.setView);

  // Snoozed is a read-only view; bail back to open if a stale persisted "all"
  // ever sneaks in (the rail only exposes open/snoozed/done).
  const setStatus = (s: InboxStatus) => setView({ status: s });
  const setActiveCategory = (c: string | null) => setView({ activeCategory: c });
  const setGroupBy = (g: InboxGroupBy) => setView({ groupBy: g });
  const setSort = (s: InboxSort) => setView({ sort: s });

  const [items, setItems] = useState<Notification[]>([]);
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [actorFilter, setActorFilter] = useState<number | null>(null);
  const [actorOptions, setActorOptions] = useState<InboxActorOption[]>([]);
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [projectOptions, setProjectOptions] = useState<InboxProjectOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [confirmArchiveAll, setConfirmArchiveAll] = useState(false);
  const [confirmUnsnoozeAll, setConfirmUnsnoozeAll] = useState(false);
  // When set, the custom-snooze dialog is open and will apply to these ids.
  const [customSnooze, setCustomSnooze] = useState<{ ids: number[] } | null>(null);

  const localeTag = language === 'fa' ? 'fa-IR' : language === 'ar' ? 'ar' : 'en-US';

  const decodeHtmlEntities = (value: string) => {
    if (!value || typeof document === 'undefined') return value;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  };

  const fetchSummary = useCallback(async () => {
    try {
      setSummary(await inboxAPI.summary());
    } catch (error) {
      console.error('Failed to load inbox summary:', error);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inboxAPI.list({
        status,
        category: activeCategory,
        unreadOnly,
        search: deferredSearch,
        actorId: actorFilter,
        projectId: projectFilter,
        sort,
        skip: 0,
        limit: PAGE_SIZE,
      });
      setItems(data);
      setHasMore(data.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load inbox:', error);
    } finally {
      setLoading(false);
    }
  }, [status, activeCategory, unreadOnly, deferredSearch, actorFilter, projectFilter, sort]);

  const fetchActors = useCallback(async () => {
    try {
      const data = await inboxAPI.actors({ status, category: activeCategory, unreadOnly, search: deferredSearch, projectId: projectFilter });
      setActorOptions(data);
      setActorFilter((current) => (current && !data.some((actor) => actor.id === current) ? null : current));
    } catch (error) {
      console.error('Failed to load inbox actors:', error);
    }
  }, [status, activeCategory, unreadOnly, deferredSearch, projectFilter]);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await inboxAPI.projects({ status, category: activeCategory, unreadOnly, search: deferredSearch, actorId: actorFilter });
      setProjectOptions(data);
      setProjectFilter((current) => (current && !data.some((project) => project.id === current) ? null : current));
    } catch (error) {
      console.error('Failed to load inbox projects:', error);
    }
  }, [status, activeCategory, unreadOnly, deferredSearch, actorFilter]);

  // Offset paging keyed off the loaded count. Archiving/restoring removes an item
  // from both the local list and the server-side set, so skip=items.length stays
  // aligned; the id de-dup absorbs any boundary drift.
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await inboxAPI.list({
        status,
        category: activeCategory,
        unreadOnly,
        search: deferredSearch,
        actorId: actorFilter,
        projectId: projectFilter,
        sort,
        skip: items.length,
        limit: PAGE_SIZE,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...data.filter((n) => !seen.has(n.id))];
      });
      setHasMore(data.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load more inbox items:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchItems();
  }, [user, fetchItems]);

  useEffect(() => {
    if (!user) return;
    fetchActors();
  }, [user, fetchActors]);

  useEffect(() => {
    if (!user) return;
    fetchProjects();
  }, [user, fetchProjects]);

  useEffect(() => {
    if (!user) return;
    fetchSummary();
  }, [user, fetchSummary]);

  // Changing the view invalidates any selection/focus from the previous list.
  useEffect(() => {
    setSelected(new Set());
    setFocusIndex(-1);
  }, [status, activeCategory, unreadOnly, sort, deferredSearch, actorFilter, projectFilter]);

  useEffect(() => {
    if (persistedUnreadOnly) setView({ unreadOnly: false });
  }, [setView, persistedUnreadOnly]);

  useEffect(() => {
    const state = location.state as { notificationRedirectError?: string } | null;
    if (!state?.notificationRedirectError) return;
    toast({ title: t(state.notificationRedirectError), variant: 'destructive' });
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, t, toast]);

  // Let the navbar bell + inbox badge re-read counts after any mutation here.
  const broadcast = () => window.dispatchEvent(new CustomEvent('notifications:refresh'));

  const afterMutation = async () => {
    await fetchSummary();
    broadcast();
  };

  const handleOpen = async (notification: Notification) => {
    if (!notification.is_read) void markRead(notification.id, false);
    const opened = await openNotification(notification, navigate);
    if (!opened && notification.related_entity_type) {
      // The linked entity is gone (deleted) — tell the user instead of doing nothing.
      toast({ title: t('inboxItemUnavailable'), variant: 'destructive' });
    }
  };

  const markRead = async (id: number, refresh = true) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await inboxAPI.markRead(id);
      if (refresh) await afterMutation();
      else broadcast();
    } catch (error) {
      console.error('Failed to mark read:', error);
      fetchItems();
    }
  };

  // An item leaves the current list when its triage state no longer matches the
  // active view (archive in open/snoozed, snooze in open, restore in done, …).
  const dropFromList = (id: number) => setItems((prev) => prev.filter((n) => n.id !== id));

  const archive = async (id: number) => {
    if (status !== 'done') dropFromList(id);
    try {
      await inboxAPI.archive(id);
      await afterMutation();
    } catch (error) {
      console.error('Failed to archive:', error);
      fetchItems();
    }
  };

  const unarchive = async (id: number) => {
    if (status === 'done') dropFromList(id);
    try {
      await inboxAPI.unarchive(id);
      await afterMutation();
    } catch (error) {
      console.error('Failed to restore:', error);
      fetchItems();
    }
  };

  const unsnooze = async (id: number) => {
    if (status === 'snoozed') dropFromList(id);
    try {
      await inboxAPI.unsnooze(id);
      await afterMutation();
    } catch (error) {
      console.error('Failed to unsnooze:', error);
      fetchItems();
    }
  };

  // W6 inline resolution: the mutation goes through the entity's *own* API
  // (requirement update); the inbox merely marks the item done afterwards and
  // never emits a notification itself.
  const resolveReview = async (notification: Notification) => {
    if (notification.related_entity_id == null) return;
    try {
      await requirementsAPI.update(notification.related_entity_id, { status: 'reviewed' });
      await archive(notification.id);
      toast({ title: t('inboxReviewApprovedToast') });
    } catch (error) {
      console.error('Failed to mark requirement reviewed:', error);
      toast({ title: t('inboxActionFailed'), variant: 'destructive' });
    }
  };

  // Snooze one item or a selection to a concrete time. Single uses the dedicated
  // endpoint; multiple goes through /inbox/bulk.
  const applySnooze = async (ids: number[], until: Date) => {
    if (ids.length === 0) return;
    const iso = until.toISOString();
    if (status !== 'snoozed') ids.forEach((id) => dropFromList(id));
    try {
      if (ids.length === 1) await inboxAPI.snooze(ids[0], iso);
      else await inboxAPI.bulk(ids, 'snooze', iso);
      clearSelection();
      await afterMutation();
      toast({ title: t('inboxSnoozedToast', { count: ids.length }) });
    } catch (error) {
      console.error('Failed to snooze:', error);
      fetchItems();
    }
  };

  const archiveAll = async () => {
    setBusy(true);
    try {
      const { archived_count } = await inboxAPI.archiveAll(activeCategory);
      setConfirmArchiveAll(false);
      await fetchItems();
      await afterMutation();
      if (archived_count > 0) toast({ title: t('inboxArchivedToast', { count: archived_count }) });
    } finally {
      setBusy(false);
    }
  };

  const unsnoozeAll = async () => {
    setBusy(true);
    try {
      const { unsnoozed_count } = await inboxAPI.unsnoozeAll(activeCategory);
      setConfirmUnsnoozeAll(false);
      await fetchItems();
      await afterMutation();
      if (unsnoozed_count > 0) toast({ title: t('inboxUnsnoozedToast', { count: unsnoozed_count }) });
    } finally {
      setBusy(false);
    }
  };

  // --- Multi-select bulk triage (W2) ---------------------------------------
  const clearSelection = () => setSelected(new Set());

  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: Exclude<InboxBulkActionType, 'snooze' | 'read' | 'unread'>) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const { affected_count } = await inboxAPI.bulk(ids, action);
      clearSelection();
      await fetchItems();
      await afterMutation();
      const key = action === 'unarchive' ? 'inboxRestoredToast' : 'inboxArchivedToast';
      if (affected_count > 0) toast({ title: t(key, { count: affected_count }) });
    } finally {
      setBusy(false);
    }
  };

  const categoryLabel = useCallback(
    (key: string, fallback: string) => {
      const translated = t(`inboxCat_${key}`);
      return translated === `inboxCat_${key}` ? fallback : translated;
    },
    [t]
  );

  const actorFilterLabel = actorOptions.find((actor) => actor.id === actorFilter)?.name;
  const projectFilterLabel = projectOptions.find((project) => project.id === projectFilter)?.name;
  const visibleItems = items;

  // Grouped sections (W3). Date is the default; category / entity regroup the
  // same loaded page client-side.
  const groups = useMemo(
    () => groupItems(visibleItems, groupBy, sort, t, categoryLabel),
    [visibleItems, groupBy, sort, t, categoryLabel]
  );
  // Flat order matching the on-screen order — keyboard nav walks this.
  const orderedItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the keyboard-focused row scrolled into view (a11y: j/k stays visible).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-inbox-index="${focusIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const diffHours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
    if (diffHours < 1) return t('justNow');
    if (diffHours < 24) return t('hoursAgoShort', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t('daysAgoShort', { count: diffDays });
    return date.toLocaleDateString(localeTag);
  };

  const formatSnoozeUntil = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(localeTag, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // --- Keyboard shortcuts (W2) ---------------------------------------------
  // A ref mirror keeps a single bound listener while always seeing the latest
  // state and action callbacks — without it, the empty-deps effect would close
  // over first-render handlers (stale status/items).
  const kbd = useRef({
    orderedItems, focusIndex, status,
    archive, unarchive, applySnooze, toggleSelected, handleOpen,
  });
  kbd.current = {
    orderedItems, focusIndex, status,
    archive, unarchive, applySnooze, toggleSelected, handleOpen,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = kbd.current;
      const list = k.orderedItems;
      if (list.length === 0) return;
      const idx = k.focusIndex;
      const current = idx >= 0 && idx < list.length ? list[idx] : null;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusIndex((i) => Math.min((i < 0 ? -1 : i) + 1, list.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusIndex((i) => Math.max((i <= 0 ? list.length : i) - 1, 0));
          break;
        case 'x':
          if (current) { e.preventDefault(); k.toggleSelected(current.id); }
          break;
        case 'Enter':
          if (current) { e.preventDefault(); k.handleOpen(current); }
          break;
        case 'e':
          if (current) {
            e.preventDefault();
            if (k.status === 'done') k.unarchive(current.id);
            else k.archive(current.id);
          }
          break;
        case 's':
          // Quick-snooze the focused item to tomorrow; the menu offers the rest.
          if (current && k.status !== 'done') {
            e.preventDefault();
            k.applySnooze([current.id], SNOOZE_PRESETS[1].date());
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const totalOpen = summary?.total_open ?? 0;
  const totalSnoozed = summary?.total_snoozed ?? 0;
  const totalDone = summary?.categories.reduce((sum, c) => sum + c.done, 0) ?? 0;
  const countFor = (s: InboxStatus) => (s === 'open' ? totalOpen : s === 'snoozed' ? totalSnoozed : totalDone);
  const hasTransientFilter = Boolean(deferredSearch || actorFilter || projectFilter);
  const archiveAllCount = activeCategory
    ? summary?.categories.find((c) => c.key === activeCategory)?.open ?? 0
    : totalOpen;
  const unsnoozeAllCount = activeCategory
    ? summary?.categories.find((c) => c.key === activeCategory)?.snoozed ?? 0
    : totalSnoozed;

  const catCount = (c: InboxSummary['categories'][number]) =>
    status === 'open' ? c.open : status === 'snoozed' ? c.snoozed : c.done;
  // A category's count reflects the active view. Empty categories are hidden so
  // unused/phantom types never show as dead filters — except the actively
  // selected one, which stays visible so you can navigate back out of it.
  const railCategories = (summary?.categories ?? []).filter(
    (cat) => catCount(cat) > 0 || activeCategory === cat.key
  );

  // Smart views map to (status, category, unreadOnly) presets (W3).
  const SMART_VIEWS: { key: string; labelKey: string; status: InboxStatus; category: string | null; Icon: typeof Inbox }[] = [
    { key: 'all_open', labelKey: 'inboxViewAllOpen', status: 'open', category: null, Icon: Inbox },
    { key: 'assigned', labelKey: 'inboxViewAssigned', status: 'open', category: 'assignment', Icon: UserPlus },
    { key: 'mentions', labelKey: 'inboxViewMentions', status: 'open', category: 'mention', Icon: AtSign },
    { key: 'replies', labelKey: 'inboxViewReplies', status: 'open', category: 'comment_reply', Icon: MessageSquareReply },
    { key: 'reviews', labelKey: 'inboxViewReviews', status: 'open', category: 'review', Icon: ClipboardCheck },
    { key: 'feedback', labelKey: 'inboxViewFeedback', status: 'open', category: 'feedback', Icon: MessageSquareWarning },
    { key: 'snoozed', labelKey: 'inboxViewSnoozed', status: 'snoozed', category: null, Icon: Clock },
    { key: 'done', labelKey: 'inboxViewDone', status: 'done', category: null, Icon: Archive },
  ];
  const activeSmartView = SMART_VIEWS.find((v) => v.status === status && v.category === activeCategory)?.key;

  const emptyKind = search.trim() || actorFilter || projectFilter ? 'search' : status;
  const selectionCount = selected.size;
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((n) => selected.has(n.id));

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-600/25">
            <Inbox className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-[28px]">
              {t('workInboxTitle')}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {totalOpen > 0 ? t('workInboxPending', { count: totalOpen }) : t('workInboxSubtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { fetchItems(); fetchSummary(); }}
            className="h-9 w-9 rounded-xl p-0 sm:w-auto sm:px-3"
            aria-label={t('refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:ms-1.5 sm:inline">{t('refresh')}</span>
          </Button>
          {status === 'open' && items.length > 0 && !hasTransientFilter && (
            <>
              <Button size="sm" onClick={() => setConfirmArchiveAll(true)} disabled={busy} className="h-9 gap-1.5 rounded-xl px-3 text-sm">
                <Archive className="h-4 w-4" />
                <span className="hidden sm:inline">{t('inboxArchiveAll')}</span>
              </Button>
            </>
          )}
          {status === 'snoozed' && items.length > 0 && !hasTransientFilter && (
            <Button variant="outline" size="sm" onClick={() => setConfirmUnsnoozeAll(true)} disabled={busy} className="h-9 gap-1.5 rounded-xl px-3 text-sm">
              <AlarmClockOff className="h-4 w-4" />
              <span className="hidden sm:inline">{t('inboxUnsnoozeAll')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Smart views (W3) */}
      <div className="flex flex-wrap items-center gap-2">
        {SMART_VIEWS.map((v) => {
          const isActive = activeSmartView === v.key;
          const count = v.category
            ? (summary?.categories.find((c) => c.key === v.category)?.[v.status === 'open' ? 'open' : v.status === 'snoozed' ? 'snoozed' : 'done'] ?? 0)
            : countFor(v.status);
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView({ status: v.status, activeCategory: v.category, unreadOnly: false })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <v.Icon className="h-3.5 w-3.5" />
              {t(v.labelKey)}
              {count > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${isActive ? 'bg-white/25' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Left rail */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
            {(['open', 'snoozed', 'done'] as InboxStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                  status === s
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {s === 'open' ? t('inboxStatusOpen') : s === 'snoozed' ? t('inboxStatusSnoozed') : t('inboxStatusDone')}
                <span className={`text-[11px] ${status === s ? 'text-slate-400' : 'text-slate-400/80'}`}>
                  {countFor(s)}
                </span>
              </button>
            ))}
          </div>

          <nav className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {t('inboxCategories')}
            </p>
            <CategoryButton
              active={activeCategory === null}
              label={t('inboxAll')}
              icon={<Inbox className="h-4 w-4" />}
              count={countFor(status)}
              unread={0}
              onClick={() => setActiveCategory(null)}
            />
            {railCategories.map((cat) => {
              const visual = visualFor(cat.key);
              return (
                <CategoryButton
                  key={cat.key}
                  active={activeCategory === cat.key}
                  label={categoryLabel(cat.key, cat.label)}
                  icon={<visual.Icon className="h-4 w-4" />}
                  count={catCount(cat)}
                  unread={0}
                  onClick={() => setActiveCategory(cat.key)}
                />
              );
            })}
          </nav>

          <p className="hidden px-3 text-[11px] leading-5 text-slate-400 dark:text-slate-600 lg:block">
            {t('inboxKeyboardHint')}
          </p>
        </aside>

        {/* Main */}
        <section className="space-y-3">
          {/* Search + controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('inboxSearchPlaceholder')}
                className="h-10 rounded-xl border-slate-200 bg-white ps-9 pe-8 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  aria-label={t('clearSearch')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Actor filter (W3) */}
            {actorOptions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                    <UserIcon className="h-4 w-4 text-slate-400" />
                    <span className="max-w-[120px] truncate">{actorFilterLabel ?? t('inboxFilterActorAll')}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto">
                  <DropdownMenuLabel>{t('inboxFilterFrom')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={actorFilter ? String(actorFilter) : '__all__'} onValueChange={(v) => setActorFilter(v === '__all__' ? null : Number(v))}>
                    <DropdownMenuRadioItem value="__all__">{t('inboxFilterActorAll')}</DropdownMenuRadioItem>
                    {actorOptions.map((actor) => (
                      <DropdownMenuRadioItem key={actor.id} value={String(actor.id)}>{actor.name}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Project filter (server-side, covers all pages, not just loaded rows) */}
            {projectOptions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                    <Layers className="h-4 w-4 text-slate-400" />
                    <span className="max-w-[140px] truncate">{projectFilterLabel ?? t('inboxFilterProjectAll')}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  <DropdownMenuLabel>{t('inboxFilterProject')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={projectFilter ? String(projectFilter) : '__all__'} onValueChange={(v) => setProjectFilter(v === '__all__' ? null : Number(v))}>
                    <DropdownMenuRadioItem value="__all__">{t('inboxFilterProjectAll')}</DropdownMenuRadioItem>
                    {projectOptions.map((project) => (
                      <DropdownMenuRadioItem key={project.id} value={String(project.id)}>{project.name}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Sort by age (W4) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                  <ArrowDownUp className="h-4 w-4 text-slate-400" />
                  <span>{t(sort === 'oldest' ? 'inboxSortOldest' : 'inboxSortNewest')}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as InboxSort)}>
                  <DropdownMenuRadioItem value="newest">{t('inboxSortNewest')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="oldest">{t('inboxSortOldest')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Group by (W3) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                  <Layers className="h-4 w-4 text-slate-400" />
                  <span className="hidden sm:inline">{t('inboxGroupBy')}:</span>
                  <span>{t(GROUP_BY_LABELS[groupBy])}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as InboxGroupBy)}>
                  <DropdownMenuRadioItem value="date">{t('inboxGroupByDate')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="category">{t('inboxGroupByCategory')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="entity">{t('inboxGroupByEntity')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="project">{t('inboxGroupByProject')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Selection toolbar (W2) */}
          {selectionCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/30">
              <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                {t('inboxSelected', { count: selectionCount })}
              </span>
              <div className="ms-auto flex flex-wrap items-center gap-1.5">
                {status !== 'done' && (
                  <SnoozeMenu
                    t={t}
                    formatSnoozeUntil={formatSnoozeUntil}
                    onPick={(date) => applySnooze([...selected], date)}
                    onCustom={() => setCustomSnooze({ ids: [...selected] })}
                    trigger={
                      <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                        <Clock className="h-3.5 w-3.5" /> {t('inboxBulkSnooze')}
                      </button>
                    }
                  />
                )}
                {status === 'done' ? (
                  <Button size="sm" disabled={busy} onClick={() => runBulk('unarchive')} className="h-8 gap-1.5 rounded-lg px-2.5 text-xs">
                    <ArchiveRestore className="h-3.5 w-3.5" /> {t('inboxRestore')}
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => runBulk('archive')} className="h-8 gap-1.5 rounded-lg px-2.5 text-xs">
                    <Archive className="h-3.5 w-3.5" /> {t('inboxBulkArchive')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8 gap-1.5 rounded-lg px-2.5 text-xs">
                  <X className="h-3.5 w-3.5" /> {t('inboxClearSelection')}
                </Button>
              </div>
            </div>
          )}

          <div ref={listRef} role="list" aria-label={t('workInboxTitle')} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            {/* Select-all bar */}
            {!loading && visibleItems.length > 0 && (
              <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-2 dark:border-slate-900">
                <Checkbox
                  checked={allVisibleSelected ? true : selectionCount > 0 ? 'indeterminate' : false}
                  onCheckedChange={(c) => {
                    if (c) setSelected(new Set(visibleItems.map((n) => n.id)));
                    else clearSelection();
                  }}
                  aria-label={t('inboxSelectAll')}
                />
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t('inboxSelectAll')}</span>
              </div>
            )}

            {loading ? (
              <InboxSkeleton />
            ) : visibleItems.length === 0 ? (
              <EmptyState kind={emptyKind} t={t} />
            ) : (
              groups.map((group) => {
                const startIndex = orderedItems.indexOf(group.items[0]);
                return (
                  <div key={group.key}>
                    <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/90 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur dark:border-slate-900 dark:bg-slate-900/80 dark:text-slate-500">
                      {group.label}
                    </div>
                    {group.items.map((notification, i) => {
                      const globalIndex = startIndex + i;
                      return (
                        <InboxRow
                          key={notification.id}
                          index={globalIndex}
                          notification={notification}
                          status={status}
                          t={t}
                          decode={decodeHtmlEntities}
                          categoryLabel={categoryLabel}
                          formatDate={formatDate}
                          formatSnoozeUntil={formatSnoozeUntil}
                          selected={selected.has(notification.id)}
                          focused={globalIndex === focusIndex}
                          onToggleSelect={() => toggleSelected(notification.id)}
                          onOpen={() => handleOpen(notification)}
                          onArchive={() => archive(notification.id)}
                          onUnarchive={() => unarchive(notification.id)}
                          onUnsnooze={() => unsnooze(notification.id)}
                          onSnoozePick={(date) => applySnooze([notification.id], date)}
                          onSnoozeCustom={() => setCustomSnooze({ ids: [notification.id] })}
                          onResolveReview={() => resolveReview(notification)}
                          canResolveReview={canResolveReview(notification)}
                        />
                      );
                    })}
                  </div>
                );
              })
            )}

            {!loading && hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="flex w-full items-center justify-center gap-2 border-t border-slate-100 py-3 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/30"
              >
                {loadingMore && <RefreshCw className="h-4 w-4 animate-spin" />}
                {loadingMore ? t('loading') : t('loadMore')}
              </button>
            )}
          </div>
        </section>
      </div>

      <CustomSnoozeDialog
        open={customSnooze !== null}
        t={t}
        onClose={() => setCustomSnooze(null)}
        onConfirm={(date) => {
          const ids = customSnooze?.ids ?? [];
          setCustomSnooze(null);
          applySnooze(ids, date);
        }}
        invalidToast={() => toast({ title: t('inboxSnoozeInvalid'), variant: 'destructive' })}
      />
      <Dialog open={confirmArchiveAll} onOpenChange={setConfirmArchiveAll}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('inboxArchiveAllConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('inboxArchiveAllConfirmDesc', { count: archiveAllCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setConfirmArchiveAll(false)}>{t('inboxCancel')}</Button>
            <Button onClick={archiveAll} disabled={busy}>{t('inboxArchiveAllConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmUnsnoozeAll} onOpenChange={setConfirmUnsnoozeAll}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('inboxUnsnoozeAllConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('inboxUnsnoozeAllConfirmDesc', { count: unsnoozeAllCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setConfirmUnsnoozeAll(false)}>{t('inboxCancel')}</Button>
            <Button onClick={unsnoozeAll} disabled={busy}>{t('inboxUnsnoozeAllConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Group the loaded page for display. Returns ordered sections with resolved
// labels so the renderer stays dumb. Date keeps the today/yesterday buckets;
// category/entity collapse onto the item's own fields.
function groupItems(
  items: Notification[],
  groupBy: InboxGroupBy,
  sort: InboxSort,
  t: (k: string, p?: Record<string, string | number>) => string,
  categoryLabel: (key: string, fallback: string) => string
): { key: string; label: string; items: Notification[] }[] {
  if (groupBy === 'date') {
    const buckets = groupByDate(items);
    // Oldest-first flips the section order too, so the most-aged bucket leads.
    const order = sort === 'oldest'
      ? ['dateOlder', 'thisWeek', 'yesterday', 'today']
      : ['today', 'yesterday', 'thisWeek', 'dateOlder'];
    return order
      .filter((k) => buckets[k]?.length)
      .map((k) => ({ key: k, label: t(k), items: buckets[k] }));
  }

  const keyOf = (n: Notification): string => {
    if (groupBy === 'category') return n.category ?? '__none__';
    if (groupBy === 'project') return n.project_id != null ? `p:${n.project_id}` : '__none__';
    return n.related_entity_type ?? '__none__';
  };

  const map = new Map<string, Notification[]>();
  for (const n of items) {
    const key = keyOf(n);
    (map.get(key) ?? map.set(key, []).get(key)!).push(n);
  }
  return [...map.entries()].map(([key, groupItems]) => {
    let label: string;
    if (key === '__none__') {
      label =
        groupBy === 'category' ? t('inboxAll')
        : groupBy === 'project' ? t('inboxGroupNoProject')
        : t('inboxGroupNoEntity');
    } else if (groupBy === 'category') {
      label = categoryLabel(key, key);
    } else if (groupBy === 'project') {
      // Name comes off the items (resolved server-side); key is just the id.
      label = groupItems[0].project_name ?? t('inboxGroupNoProject');
    } else {
      label = humanizeEntity(key);
    }
    return { key, label, items: groupItems };
  });
}

const humanizeEntity = (type: string): string =>
  type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function SnoozeMenu({
  t,
  formatSnoozeUntil,
  onPick,
  onCustom,
  trigger,
}: {
  t: (k: string, p?: Record<string, string | number>) => string;
  formatSnoozeUntil: (d?: string | null) => string;
  onPick: (date: Date) => void;
  onCustom: () => void;
  trigger: React.ReactNode;
}) {
  const now = new Date();
  const presets = SNOOZE_PRESETS.map((preset) => ({ ...preset, value: preset.date() })).filter(
    (preset) => preset.key !== 'later' || preset.value.toDateString() === now.toDateString()
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t('inboxSnooze')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {presets.map((p) => (
          <DropdownMenuItem key={p.key} onSelect={() => onPick(p.value)}>
            <Clock className="me-2 h-4 w-4 text-slate-400" />
            <span className="flex flex-col">
              <span>{t(p.labelKey)}</span>
              <span className="text-[11px] text-slate-400">{formatSnoozeUntil(p.value.toISOString())}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCustom}>
          <Sparkles className="me-2 h-4 w-4 text-slate-400" />
          {t('inboxSnoozeCustom')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CustomSnoozeDialog({
  open,
  t,
  onClose,
  onConfirm,
  invalidToast,
}: {
  open: boolean;
  t: (k: string) => string;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  invalidToast: () => void;
}) {
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      setValue(toLocalInputValue(d));
    }
  }, [open]);

  const confirm = () => {
    const date = new Date(value);
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      invalidToast();
      return;
    }
    onConfirm(date);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('inboxSnoozeCustomTitle')}</DialogTitle>
          <DialogDescription>{t('inboxSnoozeCustomDesc')}</DialogDescription>
        </DialogHeader>
        <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1" />
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>{t('inboxCancel')}</Button>
          <Button onClick={confirm}>{t('inboxSnoozeConfirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InboxRow({
  index,
  notification,
  status,
  t,
  decode,
  categoryLabel,
  formatDate,
  formatSnoozeUntil,
  selected,
  focused,
  onToggleSelect,
  onOpen,
  onArchive,
  onUnarchive,
  onUnsnooze,
  onSnoozePick,
  onSnoozeCustom,
  onResolveReview,
  canResolveReview,
}: {
  index: number;
  notification: Notification;
  status: InboxStatus;
  t: (k: string, p?: Record<string, string | number>) => string;
  decode: (v: string) => string;
  categoryLabel: (key: string, fallback: string) => string;
  formatDate: (d: string) => string;
  formatSnoozeUntil: (d?: string | null) => string;
  selected: boolean;
  focused: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onUnsnooze: () => void;
  onSnoozePick: (date: Date) => void;
  onSnoozeCustom: () => void;
  onResolveReview: () => void;
  canResolveReview: boolean;
}) {
  const visual = visualFor(notification.category);
  const actorInitials = initials(notification.actor_name);
  const catLabel = notification.category ? categoryLabel(notification.category, notification.category) : '';
  const aging = agingFor(notification.created_at, notification.category, status);

  return (
    <div
      role="listitem"
      data-inbox-index={index}
      aria-current={focused ? 'true' : undefined}
      className={`group relative flex gap-3 border-b border-slate-100 px-5 py-4 transition-colors last:border-b-0 dark:border-slate-900 ${
        selected ? 'bg-blue-50/70 dark:bg-blue-950/25' : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
      } ${focused ? 'ring-2 ring-inset ring-blue-500' : ''}`}
    >
      {/* Left accent: Work Inbox uses task aging, not bell read state. */}
      {aging.level === 'overdue' ? (
        <span className="absolute inset-y-0 start-0 w-1 bg-amber-500" aria-hidden />
      ) : aging.level === 'stale' ? (
        <span className="absolute inset-y-0 start-0 w-1 bg-amber-300 dark:bg-amber-700" aria-hidden />
      ) : null}

      {/* Selection checkbox — always present, emphasised on hover/selection. */}
      <div className={`flex shrink-0 items-start pt-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`}>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={t('inboxSelectAll')} />
      </div>

      {/* Avatar: actor initials, or the category icon when there's no actor. */}
      <div className="relative shrink-0">
        {actorInitials ? (
          <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white ${visual.avatar}`}>
            {actorInitials}
          </div>
        ) : (
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${visual.wrap}`}>
            <visual.Icon className="h-5 w-5" />
          </div>
        )}
        <span className={`absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white dark:ring-slate-950 ${visual.wrap}`}>
          <visual.Icon className="h-3 w-3" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-start">
            <h3 className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
              {decode(notification.title)}
            </h3>
          </button>
          <span
            title={t('inboxOpenFor', { age: ageLabel(aging.ageMs, t) })}
            className={`shrink-0 text-[11px] font-medium ${aging.level === 'overdue' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}
          >
            {formatDate(notification.created_at)}
          </span>
        </div>

        {(notification.actor_name || catLabel) && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            {notification.actor_name && <span className="font-medium text-slate-500 dark:text-slate-400">{notification.actor_name}</span>}
            {notification.actor_name && catLabel && <span aria-hidden>·</span>}
            {catLabel && <span>{catLabel}</span>}
          </div>
        )}

        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {decode(notification.message)}
        </p>

        {/* Aging / SLA signal (W4) — open items only; category-aware overdue. */}
        {aging.level !== 'none' && (
          <div
            title={t('inboxOpenFor', { age: ageLabel(aging.ageMs, t) })}
            className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              aging.level === 'overdue'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            <AlarmClock className="h-3 w-3" />
            {t(aging.level === 'overdue' ? 'inboxOverdue' : 'inboxStale')} · {ageLabel(aging.ageMs, t)}
          </div>
        )}

        {/* Snoozed-until chip (snoozed view) */}
        {notification.snoozed_until && status === 'snoozed' && (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
            <Clock className="h-3 w-3" />
            {t('inboxSnoozedUntil', { date: formatSnoozeUntil(notification.snoozed_until) })}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {notification.related_entity_type && (
              <button
                type="button"
                onClick={onOpen}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
              >
                {t('inboxOpenItem')}
                <ChevronRight className="h-3 w-3 rtl:rotate-180" />
              </button>
            )}
            {/* W6 inline resolution — mutation hits the requirement's own API. */}
            {canResolveReview && status !== 'done' && (
              <button
                type="button"
                onClick={onResolveReview}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <Check className="h-3 w-3" />
                {t('inboxReviewApprove')}
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {status === 'snoozed' ? (
              <IconAction icon={<AlarmClockOff className="h-4 w-4" />} title={t('inboxUnsnooze')} onClick={onUnsnooze} />
            ) : status === 'open' ? (
              <SnoozeMenu
                t={t}
                formatSnoozeUntil={formatSnoozeUntil}
                onPick={onSnoozePick}
                onCustom={onSnoozeCustom}
                trigger={
                  <button type="button" title={t('inboxSnooze')} aria-label={t('inboxSnooze')} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                    <Clock className="h-4 w-4" />
                  </button>
                }
              />
            ) : null}

            {status === 'done' ? (
              <IconAction icon={<ArchiveRestore className="h-4 w-4" />} title={t('inboxRestore')} onClick={onUnarchive} />
            ) : (
              <IconAction icon={<Archive className="h-4 w-4" />} title={t('inboxMarkDone')} onClick={onArchive} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryButton({
  active,
  label,
  icon,
  count,
  unread,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  count: number;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
      <span className="flex-1 truncate text-start">{label}</span>
      {/* Always show the view count; colour it when there are unread items so the
          number's meaning is consistent across every category. */}
      {count > 0 && (
        <span
          className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
            active
              ? 'bg-white/25 text-white'
              : unread > 0
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

function IconAction({
  icon,
  title,
  onClick,
  tone = 'slate',
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  tone?: 'slate' | 'blue';
}) {
  const toneClass =
    tone === 'blue'
      ? 'text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/40'
      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200';
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={`rounded-lg p-2 transition-colors ${toneClass}`}>
      {icon}
    </button>
  );
}

function InboxSkeleton() {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-900">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3.5 px-5 py-4">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ kind, t }: { kind: string; t: (k: string) => string }) {
  const config: Record<string, { Icon: typeof Inbox; tint: string; title: string; desc: string }> = {
    search: { Icon: Search, tint: 'bg-slate-100 text-slate-400 dark:bg-slate-800', title: 'inboxNoMatches', desc: 'inboxNoMatchesDesc' },
    snoozed: { Icon: Clock, tint: 'bg-indigo-50 text-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300', title: 'inboxNoSnoozed', desc: 'inboxNoSnoozedDesc' },
    done: { Icon: Archive, tint: 'bg-slate-100 text-slate-400 dark:bg-slate-800', title: 'inboxNoDone', desc: 'inboxNoDoneDesc' },
    open: { Icon: Sparkles, tint: 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300', title: 'inboxZeroTitle', desc: 'inboxZeroDesc' },
  };
  const c = config[kind] ?? config.open;
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${c.tint}`}>
        <c.Icon className="h-7 w-7" />
      </div>
      <h3 className="text-base font-semibold text-slate-950 dark:text-white">{t(c.title)}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">{t(c.desc)}</p>
    </div>
  );
}

function groupByDate(items: Notification[]): Record<string, Notification[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);

  const groups: Record<string, Notification[]> = {};
  for (const item of items) {
    const date = new Date(item.created_at);
    let key = 'dateOlder';
    if (!isNaN(date.getTime())) {
      if (date >= today) key = 'today';
      else if (date >= yesterday) key = 'yesterday';
      else if (date >= thisWeek) key = 'thisWeek';
    }
    (groups[key] ||= []).push(item);
  }
  return groups;
}
