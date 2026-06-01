import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Settings, Search, X, RefreshCw, Volume2, VolumeX, Moon, AlertTriangle, Filter, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { Notification } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

interface NotificationDropdownProps {
  unreadCount: number;
  onUnreadCountChange: (count: number) => void;
}

export function NotificationDropdown({ unreadCount, onUnreadCountChange }: NotificationDropdownProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState({
    do_not_disturb: false,
    notification_sound_enabled: true,
    notifications_muted_until: null as string | null
  });
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t, isRTL, language } = useTranslation();

  const decodeHtmlEntities = (value: string) => {
    if (!value || typeof document === 'undefined') return value;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  };

  const formatRelatedEntityType = (entityType?: string | null) => {
    if (!entityType) return '';
    const labels: Record<string, string> = {
      test_run: t('entityTestRun'),
      test_case: t('entityTestCase'),
      defect: t('entityDefect'),
      requirement: t('entityRequirement'),
    };

    return labels[entityType] || entityType.replace(/_/g, ' ');
  };

  const viewRelatedEntity = async (notification: Notification) => {
    if (!notification.related_entity_type || !notification.related_entity_id) return;

    try {
      if (notification.related_entity_type === 'test_run') {
        const response = await api.get(`/test-runs/${notification.related_entity_id}`);
        navigate(`/projects/${response.data.project_id}/test-runs/${notification.related_entity_id}`);
      } else if (notification.related_entity_type === 'defect') {
        navigate(`/defects/${notification.related_entity_id}`);
      } else if (notification.related_entity_type === 'test_case') {
        navigate(`/test-cases/${notification.related_entity_id}`);
      } else if (notification.related_entity_type === 'requirement') {
        const response = await api.get(`/requirements/${notification.related_entity_id}`);
        navigate(`/projects/${response.data.project_id}/requirements/${notification.related_entity_id}`);
      }
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to open related notification entity:', error);
    }
  };

  const fetchNotifications = async (
    pageNum: number = 0,
    append: boolean = false,
    overrides?: { search?: string; filter?: string | null }
  ) => {
    if (!user) return;

    // Use overrides when provided so callers aren't bitten by stale closures
    // (e.g. the debounced search timer captures the value before state updates).
    const effectiveSearch = overrides && 'search' in overrides ? overrides.search : searchQuery;
    const effectiveFilter = overrides && 'filter' in overrides ? overrides.filter : filterType;

    setLoading(true);
    try {
      const limit = 50;
      const skip = pageNum * limit;
      let url = `/notifications/?skip=${skip}&limit=${limit}`;

      if (effectiveSearch && effectiveSearch.trim()) {
        url += `&search=${encodeURIComponent(effectiveSearch.trim())}`;
      }
      if (effectiveFilter) {
        url += `&notification_type=${effectiveFilter}`;
      }

      const response = await api.get(url);
      
      if (append) {
        setNotifications(prev => [...prev, ...response.data]);
      } else {
        setNotifications(response.data);
      }
      
      // Check if there are more notifications
      setHasMore(response.data.length === limit);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(0);
    
    // Clear existing timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    // Set new timer for debounced search. Pass the latest value explicitly so we
    // don't fetch with the previous keystroke's searchQuery from a stale closure.
    const timer = setTimeout(() => {
      fetchNotifications(0, false, { search: value });
    }, 300);

    setSearchDebounceTimer(timer);
  };

  const markAsRead = async (notificationId: number) => {
    // Validate notification ID
    if (!notificationId || notificationId < 1) {
      console.error('Invalid notification ID:', notificationId);
      return;
    }

    // Avoid drifting the unread count when the notification is already read.
    if (notifications.find(n => n.id === notificationId)?.is_read) return;

    try {
      await api.put(`/notifications/${notificationId}`, { is_read: true });
      setNotifications(prev =>
        prev.map(notif =>
          notif.id === notificationId ? { ...notif, is_read: true } : notif
        )
      );
      onUnreadCountChange(Math.max(0, unreadCount - 1));
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      // Revert optimistic update if needed
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.post('/notifications/mark-all-read');
      setNotifications(prev =>
        prev.map(notif => ({ ...notif, is_read: true }))
      );
      onUnreadCountChange(0);
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: number) => {
    // Validate notification ID
    if (!notificationId || notificationId < 1) {
      console.error('Invalid notification ID:', notificationId);
      return;
    }

    try {
      await api.delete(`/notifications/${notificationId}`);
      const wasUnread = notifications.find(n => n.id === notificationId)?.is_read === false;
      setNotifications(prev => prev.filter(notif => notif.id !== notificationId));
      if (wasUnread) {
        onUnreadCountChange(Math.max(0, unreadCount - 1));
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const loadMore = () => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage, true);
  };

  const markAsUnread = async (notificationId: number) => {
    if (!notificationId || notificationId < 1) {
      console.error('Invalid notification ID:', notificationId);
      return;
    }

    // Avoid drifting the unread count when the notification is already unread.
    if (notifications.find(n => n.id === notificationId)?.is_read === false) return;

    try {
      await api.put(`/notifications/${notificationId}/mark-unread`);
      setNotifications(prev =>
        prev.map(notif =>
          notif.id === notificationId ? { ...notif, is_read: false } : notif
        )
      );
      onUnreadCountChange(unreadCount + 1);
    } catch (error) {
      console.error('Failed to mark notification as unread:', error);
    }
  };

  const clearAll = async () => {
    try {
      await api.delete('/notifications/all');
      setNotifications([]);
      onUnreadCountChange(0);
      setShowClearConfirm(false);
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
    }
  };

  const toggleBulkMode = () => {
    setBulkMode(!bulkMode);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    setSelectedIds(new Set(notifications.map(n => n.id)));
  };

  const bulkMarkRead = async () => {
    if (selectedIds.size === 0) return;
    try {
      await api.post('/notifications/bulk-update', {
        notification_ids: Array.from(selectedIds),
        is_read: true
      });
      setNotifications(prev =>
        prev.map(notif =>
          selectedIds.has(notif.id) ? { ...notif, is_read: true } : notif
        )
      );
      const unreadInSelection = notifications.filter(n => selectedIds.has(n.id) && !n.is_read).length;
      onUnreadCountChange(Math.max(0, unreadCount - unreadInSelection));
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to bulk mark as read:', error);
      alert('Failed to mark notifications as read. Please try again.');
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await api.delete('/notifications/bulk-delete', {
        data: { notification_ids: Array.from(selectedIds) }
      });
      const unreadInSelection = notifications.filter(n => selectedIds.has(n.id) && !n.is_read).length;
      setNotifications(prev => prev.filter(notif => !selectedIds.has(notif.id)));
      onUnreadCountChange(Math.max(0, unreadCount - unreadInSelection));
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to bulk delete:', error);
      alert('Failed to delete notifications. Please try again.');
    }
  };

  const loadAll = async () => {
    try {
      const response = await api.get('/notifications/?skip=0&limit=100');
      setNotifications(response.data);
      setHasMore(false);
    } catch (error) {
      console.error('Failed to load all notifications:', error);
    }
  };

  const updateNotificationPrefs = async (prefs: Partial<typeof notificationPrefs> | { mute_duration_hours?: number }) => {
    try {
      const response = await api.put('/users/me/notification-preferences', prefs);
      setNotificationPrefs(response.data);
      // Let the navbar re-read sound/DND state so the chime respects it at once.
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
    } catch (error) {
      console.error('Failed to update notification preferences:', error);
      alert('Failed to update notification preferences. Please try again.');
    }
  };

  const fetchNotificationPrefs = async () => {
    try {
      const response = await api.get('/users/me/notification-preferences');
      setNotificationPrefs(response.data);
    } catch (error) {
      console.error('Failed to fetch notification preferences:', error);
    }
  };

  // Auto-refresh effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoRefresh && isOpen) {
      interval = setInterval(() => {
        // Refresh the first page; reset paging so we don't leave a stale tail.
        setPage(0);
        setHasMore(true);
        fetchNotifications(0, false);
      }, 30000); // Refresh every 30 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
    // Re-arm when the active filter/search changes so the timer closure stays fresh.
  }, [autoRefresh, isOpen, filterType, searchQuery]);

  // Fetch the first page whenever the dropdown opens or the active filter
  // changes. Pagination (loadMore/loadAll) manages its own fetches, so `page`
  // is intentionally NOT a dependency here — otherwise appending a page would
  // immediately clobber the list with a fresh non-append fetch.
  useEffect(() => {
    if (!isOpen) return;
    setPage(0);
    setHasMore(true);
    setSelectedIds(new Set());
    setNotifications([]);
    fetchNotifications(0, false, { filter: filterType });
  }, [isOpen, filterType, user]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  }, [searchDebounceTimer]);

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'success': return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
      case 'warning': return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
      case 'error': return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300';
      default: return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
    }
  };

  const getNotificationAccent = (type: string) => {
    switch (type) {
      case 'success': return 'bg-emerald-500';
      case 'warning': return 'bg-amber-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-blue-500';
    }
  };

  const getTypeLabel = (type: string) => {
    if (type === 'success') return t('success');
    if (type === 'warning') return t('warning');
    if (type === 'error') return t('error');
    return t('info');
  };

  const localeTag = language === 'fa' ? 'fa-IR' : language === 'ar' ? 'ar' : 'en-US';

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    // Clamp future timestamps (clock skew) to "just now" instead of negatives.
    const diffInHours = Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60)));

    if (diffInHours < 1) return t('justNow');
    if (diffInHours < 24) return t('hoursAgoShort', { count: diffInHours });
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return t('daysAgoShort', { count: diffInDays });
    return date.toLocaleDateString(localeTag);
  };

  const getDateGroup = (dateString: string) => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'dateOlder';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);

    if (date >= today) return 'today';
    if (date >= yesterday) return 'yesterday';
    if (date >= thisWeek) return 'thisWeek';
    return 'dateOlder';
  };

  const groupNotificationsByDate = (notifs: Notification[]) => {
    const groups: Record<string, Notification[]> = {};
    notifs.forEach(notif => {
      const group = getDateGroup(notif.created_at);
      if (!groups[group]) groups[group] = [];
      groups[group].push(notif);
    });
    return groups;
  };

  // Build per-type unread chips for the header summary, keeping only the types
  // that actually have unread items so we don't show noisy "0 Error" labels.
  const unreadTypeChips = useMemo(() => {
    const countByType = (type: string) =>
      notifications.filter((n) => !n.is_read && n.type === type).length;
    return [
      { type: 'error', label: t('error'), count: countByType('error'), dot: 'bg-red-500', text: 'text-red-600 dark:text-red-300' },
      { type: 'warning', label: t('warning'), count: countByType('warning'), dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-300' },
      { type: 'success', label: t('success'), count: countByType('success'), dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300' },
      { type: 'info', label: t('info'), count: countByType('info'), dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-300' },
    ].filter((chip) => chip.count > 0);
  }, [notifications, t]);

  const filterOptions = [
    { value: null, label: t('filterAll') },
    { value: 'info', label: t('info') },
    { value: 'success', label: t('success') },
    { value: 'warning', label: t('warning') },
    { value: 'error', label: t('error') },
  ];

  // Open-only side effects. The list fetch lives in the [isOpen, filterType]
  // effect above; here we just reset transient UI state and load prefs. The
  // filter is reset on close (not open) so reopening doesn't trigger a second
  // fetch from a filterType change colliding with the open fetch.
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setBulkMode(false);
      fetchNotificationPrefs();
    } else {
      setFilterType(null);
    }
  }, [isOpen]);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <div className="relative">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 rounded-full p-0 text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-label={t('notificationsTitle')}
          >
            <Bell className="h-[18px] w-[18px]" />
          </Button>
        </DropdownMenuTrigger>
        {unreadCount > 0 && (
          <span className={`pointer-events-none absolute -top-0.5 z-10 h-[18px] min-w-[18px] rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white shadow-xs ring-2 ring-white dark:ring-slate-950 ${isRTL ? '-left-0.5' : '-right-0.5'}`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>

      <DropdownMenuContent
        className="relative w-[min(92vw,440px)] overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 shadow-2xl shadow-slate-900/12 dark:border-slate-800 dark:bg-slate-950"
        align={isRTL ? 'start' : 'end'}
        forceMount
      >
        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">{t('notificationsTitle')}</h3>
                {unreadCount > 0 && (
                  <Badge className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" variant="outline">
                    {t('unreadCount', { count: unreadCount })}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{t('notificationSummary', { count: notifications.length })}</span>
                {unreadTypeChips.length > 0 && (
                  <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                )}
                {unreadTypeChips.map((chip) => (
                  <span
                    key={chip.type}
                    className={`inline-flex items-center gap-1 font-medium ${chip.text}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />
                    {chip.count} {chip.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-8 gap-1.5 rounded-full px-2 text-xs text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  title={t('markAllRead')}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('markAllRead')}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleBulkMode}
                className={`h-8 w-8 rounded-full p-0 ${bulkMode ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
                title={t('bulkSelectMode')}
              >
                <Filter className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                className="h-8 w-8 rounded-full p-0 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                title={t('clearAll')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="relative">
            <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
            <Input
              type="text"
              placeholder={t('searchNotifications')}
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              className={`h-9 rounded-full bg-slate-50 text-sm dark:bg-slate-900 ${isRTL ? 'pr-9 pl-8' : 'pl-9 pr-8'}`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  if (searchDebounceTimer) {
                    clearTimeout(searchDebounceTimer);
                  }
                  setSearchQuery('');
                  setPage(0);
                  fetchNotifications(0, false, { search: '' });
                }}
                className={`absolute top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${isRTL ? 'left-2' : 'right-2'}`}
                aria-label={t('clearSearch')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {filterOptions.map((option) => (
              <Button
                key={option.value ?? 'all'}
                variant={filterType === option.value ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setFilterType(option.value);
                  setPage(0);
                }}
                className={`h-7 rounded-full px-3 text-xs ${filterType === option.value ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="max-h-[480px] overflow-y-auto bg-white dark:bg-slate-950">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-300" />
              <span className="sr-only">{t('loading')}</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900">
                <Bell className="h-7 w-7 text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-950 dark:text-white">{t('noNotificationsYet')}</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500 dark:text-slate-400">{t('noNotificationsDesc')}</p>
            </div>
          ) : (
            <>
              {bulkMode && (
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 dark:border-blue-900 dark:bg-blue-950/40">
                  <span className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                    {t('selectedCount', { count: selectedIds.size })}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 rounded-full px-2 text-xs text-blue-700 dark:text-blue-200">
                      {t('selectAll')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={bulkMarkRead} disabled={selectedIds.size === 0} className="h-7 rounded-full px-2 text-xs text-blue-700 dark:text-blue-200">
                      {t('markRead')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={bulkDelete} disabled={selectedIds.size === 0} className="h-7 rounded-full px-2 text-xs text-red-700 dark:text-red-300">
                      {t('delete')}
                    </Button>
                  </div>
                </div>
              )}

              <div>
                {Object.entries(groupNotificationsByDate(notifications)).map(([groupName, groupNotifs]) => (
                  <div key={groupName}>
                    <div className="sticky top-0 z-1 border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-400">
                      {t(groupName)}
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-900">
                      {groupNotifs.map((notification) => {
                        const isSelected = selectedIds.has(notification.id);
                        const isUnread = !notification.is_read;

                        return (
                          <div
                            key={notification.id}
                            onClick={() => {
                              if (bulkMode) toggleSelect(notification.id);
                            }}
                            className={`group relative px-4 py-3 transition-colors ${bulkMode ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-900/70'} ${isUnread ? 'bg-slate-50/70 dark:bg-slate-900/40' : ''}`}
                          >
                            {isUnread && <span className={`absolute top-0 h-full w-1 ${getNotificationAccent(notification.type)} ${isRTL ? 'right-0' : 'left-0'}`} />}
                            <div className="flex items-start gap-3">
                              {bulkMode && (
                                <div onClick={(event) => event.stopPropagation()} className="pt-1">
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleSelect(notification.id)}
                                    aria-label={t('selectNotification')}
                                  />
                                </div>
                              )}

                              <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${getNotificationAccent(notification.type)} ${isUnread ? 'opacity-100' : 'opacity-35'}`} />

                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <Badge className={`border px-2 py-0 text-[10px] font-bold capitalize ${getNotificationColor(notification.type)}`} variant="outline">
                                    {getTypeLabel(notification.type)}
                                  </Badge>
                                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{formatDate(notification.created_at)}</span>
                                  {notification.type === 'error' && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                                </div>

                                <h4 className="line-clamp-1 text-sm font-semibold text-slate-950 dark:text-white">
                                  {decodeHtmlEntities(notification.title)}
                                </h4>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                                  {decodeHtmlEntities(notification.message)}
                                </p>

                                {notification.related_entity_type && (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                                      {t('relatedEntityLabel', {
                                        type: formatRelatedEntityType(notification.related_entity_type),
                                        id: notification.related_entity_id || '-',
                                      })}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        viewRelatedEntity(notification);
                                      }}
                                      className="h-6 rounded-full px-2 text-xs text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                                    >
                                      {t('view')}
                                    </Button>
                                  </div>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                                {notification.is_read ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      markAsUnread(notification.id);
                                    }}
                                    className="h-8 w-8 rounded-full p-0 text-slate-400 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                    title={t('markAsUnread')}
                                  >
                                    <EyeOff className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      markAsRead(notification.id);
                                    }}
                                    className="h-8 w-8 rounded-full p-0 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/30"
                                    title={t('markAsRead')}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteNotification(notification.id);
                                  }}
                                  className="h-8 w-8 rounded-full p-0 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                                  title={t('deleteNotificationLabel')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer always renders so prefs (DND/sound/mute) and settings stay
            reachable even when the list is empty — otherwise a user who muted
            everything could never toggle it back from here. */}
        <div className="border-t border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60">
            {notifications.length > 0 && hasMore && (
              <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className="py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                >
                  {loading ? t('loading') : t('loadMore')}
                </button>
                <button
                  type="button"
                  onClick={loadAll}
                  disabled={loading}
                  className={`py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 ${isRTL ? 'border-r border-slate-200 dark:border-slate-800' : 'border-l border-slate-200 dark:border-slate-800'}`}
                >
                  {t('loadAll')}
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`h-8 rounded-full px-2 text-xs ${autoRefresh ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}`}
                  title={t('autoRefresh')}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'} ${autoRefresh ? 'animate-spin' : ''}`} />
                  {t('autoRefresh')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateNotificationPrefs({ do_not_disturb: !notificationPrefs.do_not_disturb })}
                  className={`h-8 rounded-full px-2 text-xs ${notificationPrefs.do_not_disturb ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}
                  title={t('doNotDisturbShort')}
                >
                  <Moon className={`h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('doNotDisturbShort')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateNotificationPrefs({ notification_sound_enabled: !notificationPrefs.notification_sound_enabled })}
                  className="h-8 rounded-full px-2 text-xs text-slate-600 dark:text-slate-300"
                  title={notificationPrefs.notification_sound_enabled ? t('notificationSoundOn') : t('notificationSoundOff')}
                >
                  {notificationPrefs.notification_sound_enabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </Button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateNotificationPrefs({ mute_duration_hours: 1 })}
                className="h-8 rounded-full px-2 text-xs text-slate-600 dark:text-slate-300"
                title={t('muteOneHour')}
              >
                {t('muteOneHour')}
              </Button>
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                navigate('/settings?tab=test-management#notification-settings');
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-center gap-2 border-t border-slate-200 px-4 py-3 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:border-slate-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              <Settings className="h-4 w-4" />
              {t('notificationSettingsTitle')}
            </button>
          </div>

        {showClearConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <h3 className="text-sm font-bold text-slate-950 dark:text-white">{t('clearAllNotificationsTitle')}</h3>
              <p className="mt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">{t('clearAllNotificationsDesc')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(false)} className="h-8 px-3">
                  {t('cancel')}
                </Button>
                <Button variant="destructive" size="sm" onClick={clearAll} className="h-8 px-3">
                  {t('clearAll')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
