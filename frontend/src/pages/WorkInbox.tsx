import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  AtSign,
  UserPlus,
  ClipboardCheck,
  MessageSquareReply,
  MessageSquareWarning,
  CheckCheck,
  Archive,
  ArchiveRestore,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronRight,
  Search,
  X,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { inboxAPI, type InboxStatus } from '@/lib/api/inbox';
import { openNotification } from '@/lib/notificationNavigation';
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

const visualFor = (key?: string | null): CategoryVisual => (key && CATEGORY_VISUALS[key]) || fallbackVisual;

const PAGE_SIZE = 50;

const initials = (name?: string | null): string => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export function WorkInbox() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();

  const [status, setStatus] = useState<InboxStatus>('open');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

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
      const data = await inboxAPI.list({ status, category: activeCategory, unreadOnly, skip: 0, limit: PAGE_SIZE });
      setItems(data);
      setHasMore(data.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load inbox:', error);
    } finally {
      setLoading(false);
    }
  }, [status, activeCategory, unreadOnly]);

  // Offset paging keyed off the loaded count. Archiving/restoring removes an item
  // from both the local list and the server-side set, so skip=items.length stays
  // aligned; the id de-dup absorbs any boundary drift.
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await inboxAPI.list({ status, category: activeCategory, unreadOnly, skip: items.length, limit: PAGE_SIZE });
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
    fetchSummary();
  }, [user, fetchSummary]);

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

  const markUnread = async (id: number) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)));
    try {
      await inboxAPI.markUnread(id);
      await afterMutation();
    } catch (error) {
      console.error('Failed to mark unread:', error);
      fetchItems();
    }
  };

  const archive = async (id: number) => {
    if (status === 'open') setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await inboxAPI.archive(id);
      await afterMutation();
    } catch (error) {
      console.error('Failed to archive:', error);
      fetchItems();
    }
  };

  const unarchive = async (id: number) => {
    if (status === 'done') setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await inboxAPI.unarchive(id);
      await afterMutation();
    } catch (error) {
      console.error('Failed to restore:', error);
      fetchItems();
    }
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      const { marked_count } = await inboxAPI.markAllRead(activeCategory);
      await fetchItems();
      await afterMutation();
      if (marked_count > 0) toast({ title: t('inboxMarkedReadToast', { count: marked_count }) });
    } finally {
      setBusy(false);
    }
  };

  const archiveAll = async () => {
    setBusy(true);
    try {
      const { archived_count } = await inboxAPI.archiveAll(activeCategory);
      await fetchItems();
      await afterMutation();
      if (archived_count > 0) toast({ title: t('inboxArchivedToast', { count: archived_count }) });
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

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (n) =>
        decodeHtmlEntities(n.title).toLowerCase().includes(q) ||
        decodeHtmlEntities(n.message).toLowerCase().includes(q) ||
        (n.actor_name ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const grouped = useMemo(() => groupByDate(visibleItems), [visibleItems]);

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

  const totalOpen = summary?.total_open ?? 0;
  const totalUnread = summary?.total_unread ?? 0;
  const totalDone = summary?.categories.reduce((sum, c) => sum + c.done, 0) ?? 0;
  // A category's count reflects the active view. Empty categories are hidden so
  // unused/phantom types never show as dead filters — except the actively
  // selected one, which stays visible so you can navigate back out of it.
  const railCategories = (summary?.categories ?? []).filter(
    (cat) => (status === 'open' ? cat.open : cat.done) > 0 || activeCategory === cat.key
  );

  const emptyKind = search.trim() ? 'search' : unreadOnly ? 'unread' : status;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-600/25">
            <Inbox className="h-6 w-6" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-950">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
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
          {status === 'open' && items.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={markAllRead} disabled={busy} className="h-9 gap-1.5 rounded-xl px-3 text-sm">
                <CheckCheck className="h-4 w-4" />
                <span className="hidden sm:inline">{t('markAllRead')}</span>
              </Button>
              <Button size="sm" onClick={archiveAll} disabled={busy} className="h-9 gap-1.5 rounded-xl px-3 text-sm">
                <Archive className="h-4 w-4" />
                <span className="hidden sm:inline">{t('inboxArchiveAll')}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Left rail */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
            {(['open', 'done'] as InboxStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  status === s
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {s === 'open' ? t('inboxStatusOpen') : t('inboxStatusDone')}
                <span className={`text-xs ${status === s ? 'text-slate-400' : 'text-slate-400/80'}`}>
                  {s === 'open' ? totalOpen : totalDone}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
              unreadOnly
                ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${unreadOnly ? 'border-blue-600 bg-blue-600' : 'border-slate-300 dark:border-slate-600'}`}>
              {unreadOnly && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span className="flex-1 text-start">{t('inboxUnreadOnly')}</span>
            {totalUnread > 0 && (
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-300">{totalUnread}</span>
            )}
          </button>

          <nav className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {t('inboxCategories')}
            </p>
            <CategoryButton
              active={activeCategory === null}
              label={t('inboxAll')}
              icon={<Inbox className="h-4 w-4" />}
              count={status === 'open' ? totalOpen : totalDone}
              unread={status === 'open' ? totalUnread : 0}
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
                  count={status === 'open' ? cat.open : cat.done}
                  unread={status === 'open' ? cat.unread : 0}
                  onClick={() => setActiveCategory(cat.key)}
                />
              );
            })}
          </nav>
        </aside>

        {/* Main */}
        <section className="space-y-3">
          <div className="relative">
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

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            {loading ? (
              <InboxSkeleton />
            ) : visibleItems.length === 0 ? (
              <EmptyState kind={emptyKind} t={t} />
            ) : (
              Object.entries(grouped).map(([groupName, groupItems]) => (
                <div key={groupName}>
                  <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/90 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur dark:border-slate-900 dark:bg-slate-900/80 dark:text-slate-500">
                    {t(groupName)}
                  </div>
                  {groupItems.map((notification) => (
                    <InboxRow
                      key={notification.id}
                      notification={notification}
                      status={status}
                      t={t}
                      decode={decodeHtmlEntities}
                      categoryLabel={categoryLabel}
                      formatDate={formatDate}
                      onOpen={() => handleOpen(notification)}
                      onMarkRead={() => markRead(notification.id)}
                      onMarkUnread={() => markUnread(notification.id)}
                      onArchive={() => archive(notification.id)}
                      onUnarchive={() => unarchive(notification.id)}
                    />
                  ))}
                </div>
              ))
            )}

            {!loading && hasMore && !search.trim() && (
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
    </div>
  );
}

function InboxRow({
  notification,
  status,
  t,
  decode,
  categoryLabel,
  formatDate,
  onOpen,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onUnarchive,
}: {
  notification: Notification;
  status: InboxStatus;
  t: (k: string, p?: Record<string, string | number>) => string;
  decode: (v: string) => string;
  categoryLabel: (key: string, fallback: string) => string;
  formatDate: (d: string) => string;
  onOpen: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const visual = visualFor(notification.category);
  const isUnread = !notification.is_read;
  const actorInitials = initials(notification.actor_name);
  const catLabel = notification.category ? categoryLabel(notification.category, notification.category) : '';

  return (
    <div
      className={`group relative flex gap-3.5 border-b border-slate-100 px-5 py-4 transition-colors last:border-b-0 dark:border-slate-900 ${
        isUnread ? 'bg-blue-50/40 dark:bg-blue-950/15' : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
      }`}
    >
      {isUnread && <span className="absolute inset-y-0 start-0 w-1 bg-blue-500" aria-hidden />}

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
            <h3 className={`truncate text-sm ${isUnread ? 'font-semibold text-slate-950 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-200'}`}>
              {decode(notification.title)}
            </h3>
          </button>
          <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
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

        <div className="mt-2 flex items-center justify-between gap-2">
          {notification.related_entity_type ? (
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
            >
              {t('inboxOpenItem')}
              <ChevronRight className="h-3 w-3 rtl:rotate-180" />
            </button>
          ) : <span />}

          <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {notification.is_read ? (
              <IconAction icon={<EyeOff className="h-4 w-4" />} title={t('markAsUnread')} onClick={onMarkUnread} />
            ) : (
              <IconAction icon={<Eye className="h-4 w-4" />} title={t('markAsRead')} onClick={onMarkRead} tone="blue" />
            )}
            {status === 'open' ? (
              <IconAction icon={<Archive className="h-4 w-4" />} title={t('inboxMarkDone')} onClick={onArchive} />
            ) : (
              <IconAction icon={<ArchiveRestore className="h-4 w-4" />} title={t('inboxRestore')} onClick={onUnarchive} />
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
    unread: { Icon: CheckCheck, tint: 'bg-blue-50 text-blue-500 dark:bg-blue-950/40 dark:text-blue-300', title: 'inboxNoUnread', desc: 'inboxNoUnreadDesc' },
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
