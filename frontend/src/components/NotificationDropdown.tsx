import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  Settings,
  RefreshCw,
  Volume2,
  VolumeX,
  Moon,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  EyeOff,
  MoreVertical,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { openNotification } from '@/lib/notificationNavigation';
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState({
    do_not_disturb: false,
    notification_sound_enabled: true,
    notifications_muted_until: null as string | null
  });
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
      doc: t('entityDoc'),
      doc_change: t('entityDoc'),
      requirement_change: t('entityRequirement'),
    };

    return labels[entityType] || entityType.replace(/_/g, ' ');
  };

  const viewRelatedEntity = async (notification: Notification) => {
    const opened = await openNotification(notification, navigate);
    if (opened) setIsOpen(false);
  };

  const fetchNotifications = async (
    pageNum: number = 0,
    append: boolean = false
  ) => {
    if (!user) return;

    setLoading(true);
    try {
      const limit = 50;
      const skip = pageNum * limit;
      let url = `/notifications/?skip=${skip}&limit=${limit}`;

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
      setPage(0);
      await fetchNotifications(0, false);
      window.dispatchEvent(new CustomEvent('notifications:refresh'));
      setShowClearConfirm(false);
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
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
  }, [autoRefresh, isOpen]);

  // Fetch the first page whenever the dropdown opens. Pagination manages its own fetches, so `page`
  // is intentionally NOT a dependency here — otherwise appending a page would
  // immediately clobber the list with a fresh non-append fetch.
  useEffect(() => {
    if (!isOpen) return;
    setPage(0);
    setHasMore(true);
    setNotifications([]);
    fetchNotifications(0, false);
  }, [isOpen, user]);

  // Per-type visual language: a single source of truth for the icon + tint used
  // by the avatar, so each row reads at a glance without a separate text badge.
  const getNotificationVisuals = (type: string) => {
    switch (type) {
      case 'success':
        return { Icon: CheckCircle2, wrap: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300', dot: 'bg-emerald-500' };
      case 'warning':
        return { Icon: AlertTriangle, wrap: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300', dot: 'bg-amber-500' };
      case 'error':
        return { Icon: XCircle, wrap: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300', dot: 'bg-red-500' };
      default:
        return { Icon: Info, wrap: 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300', dot: 'bg-blue-500' };
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

  const visibleNotifications = notifications;

  // Open-only side effects. The list fetch lives in the [isOpen] effect above;
  // here we just reset transient UI state and load prefs.
  useEffect(() => {
    if (isOpen) {
      setShowMenu(false);
      fetchNotificationPrefs();
    }
  }, [isOpen]);

  const menuItemClass =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    // `dir` must be passed explicitly: Radix stamps this onto the portaled
    // content (defaulting to "ltr"), which otherwise overrides the document's
    // RTL direction and breaks every logical utility used inside the panel.
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen} dir={isRTL ? 'rtl' : 'ltr'}>
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
          <span className="pointer-events-none absolute -top-0.5 -end-0.5 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-xs ring-2 ring-white dark:ring-slate-950">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>

      <DropdownMenuContent
        className="relative flex max-h-[min(80vh,640px)] w-[min(94vw,420px)] flex-col overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 text-start shadow-2xl shadow-slate-900/12 dark:border-slate-800 dark:bg-slate-950"
        align="end"
        sideOffset={10}
        forceMount
      >
        {/* Header — title, live unread count, and the two primary actions. Every
            secondary control lives in the overflow menu to keep this row calm. */}
        <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-[15px] font-bold tracking-tight text-slate-950 dark:text-white">
              {t('notificationsTitle')}
            </h3>
            {unreadCount > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          <div className="ms-auto flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllAsRead}
                className="h-8 gap-1.5 rounded-full px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('markBellRead')}</span>
              </Button>
            )}

            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMenu((v) => !v)}
                className={`h-8 w-8 rounded-full p-0 ${showMenu ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
                aria-label={t('options')}
                aria-expanded={showMenu}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute end-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => { navigate('/inbox'); setShowMenu(false); setIsOpen(false); }}
                      className={menuItemClass}
                    >
                      <Inbox className="h-4 w-4 text-slate-400" />
                      <span className="flex-1">{t('openWorkInbox')}</span>
                      <ChevronRight className="h-4 w-4 text-slate-300 rtl:rotate-180" />
                    </button>

                    <div className="my-1.5 h-px bg-slate-100 dark:bg-slate-800" />

                    <button
                      type="button"
                      onClick={() => setAutoRefresh((v) => !v)}
                      className={menuItemClass}
                    >
                      <RefreshCw className={`h-4 w-4 text-slate-400 ${autoRefresh ? 'animate-spin' : ''}`} />
                      <span className="flex-1">{t('autoRefresh')}</span>
                      {autoRefresh && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                    </button>

                    <div className="my-1.5 h-px bg-slate-100 dark:bg-slate-800" />

                    <button
                      type="button"
                      onClick={() => updateNotificationPrefs({ notification_sound_enabled: !notificationPrefs.notification_sound_enabled })}
                      className={menuItemClass}
                    >
                      {notificationPrefs.notification_sound_enabled
                        ? <Volume2 className="h-4 w-4 text-slate-400" />
                        : <VolumeX className="h-4 w-4 text-slate-400" />}
                      <span className="flex-1">
                        {notificationPrefs.notification_sound_enabled ? t('notificationSoundOn') : t('notificationSoundOff')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateNotificationPrefs({ do_not_disturb: !notificationPrefs.do_not_disturb })}
                      className={menuItemClass}
                    >
                      <Moon className="h-4 w-4 text-slate-400" />
                      <span className="flex-1">{t('doNotDisturbShort')}</span>
                      {notificationPrefs.do_not_disturb && <span className="h-2 w-2 rounded-full bg-slate-500" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => { updateNotificationPrefs({ mute_duration_hours: 1 }); setShowMenu(false); }}
                      className={menuItemClass}
                    >
                      <BellOff className="h-4 w-4 text-slate-400" />
                      <span className="flex-1">{t('muteOneHour')}</span>
                    </button>

                    <div className="my-1.5 h-px bg-slate-100 dark:bg-slate-800" />

                    <button
                      type="button"
                      onClick={() => { setShowClearConfirm(true); setShowMenu(false); }}
                      disabled={notifications.length === 0}
                      className={`${menuItemClass} text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/30`}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="flex-1">{t('clearAll')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        navigate('/settings?tab=test-management#notification-settings');
                        setShowMenu(false);
                        setIsOpen(false);
                      }}
                      className={menuItemClass}
                    >
                      <Settings className="h-4 w-4 text-slate-400" />
                      <span className="flex-1">{t('notificationSettingsTitle')}</span>
                      <ChevronRight className="h-4 w-4 text-slate-300 rtl:rotate-180" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 dark:border-slate-900">
          {loading && notifications.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-300" />
              <span className="sr-only">{t('loading')}</span>
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-900">
                <Bell className="h-7 w-7 text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-950 dark:text-white">
                {t('noNotificationsYet')}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t('noNotificationsDesc')}
              </p>
            </div>
          ) : (
            Object.entries(groupNotificationsByDate(visibleNotifications)).map(([groupName, groupNotifs]) => (
              <div key={groupName}>
                <div className="sticky top-0 z-1 bg-white/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur-sm dark:bg-slate-950/90 dark:text-slate-500">
                  {t(groupName)}
                </div>

                {groupNotifs.map((notification) => {
                  const isUnread = !notification.is_read;
                  const { Icon, wrap, dot } = getNotificationVisuals(notification.type);

                  return (
                    <div
                      key={notification.id}
                      className={`group relative flex gap-3 px-4 py-3 transition-colors ${isUnread ? 'bg-blue-50/40 hover:bg-blue-50/70 dark:bg-blue-950/15 dark:hover:bg-blue-950/25' : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${wrap}`}>
                        <Icon className="h-[18px] w-[18px]" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <h4 className={`min-w-0 flex-1 truncate text-sm ${isUnread ? 'font-semibold text-slate-950 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-200'}`}>
                            {decodeHtmlEntities(notification.title)}
                          </h4>
                          <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                            {formatDate(notification.created_at)}
                          </span>
                          {isUnread && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-label={getTypeLabel(notification.type)} />}
                        </div>

                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {decodeHtmlEntities(notification.message)}
                        </p>

                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          {notification.related_entity_type ? (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); viewRelatedEntity(notification); }}
                              className="inline-flex items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
                            >
                              <span className="truncate">
                                {t('relatedEntityLabel', {
                                  type: formatRelatedEntityType(notification.related_entity_type),
                                  id: notification.related_entity_id || '-',
                                })}
                              </span>
                              <ChevronRight className="h-3 w-3 shrink-0 rtl:rotate-180" />
                            </button>
                          ) : <span />}

                          <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                            {notification.is_read ? (
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); markAsUnread(notification.id); }}
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
                                title={t('markAsUnread')}
                                aria-label={t('markAsUnread')}
                              >
                                <EyeOff className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); markAsRead(notification.id); }}
                                className="rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/40"
                                title={t('markAsRead')}
                                aria-label={t('markAsRead')}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Load more */}
        {notifications.length > 0 && hasMore && (
          <div className="border-t border-slate-100 dark:border-slate-900">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="w-full py-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
            >
              {loading ? t('loading') : t('loadMore')}
            </button>
          </div>
        )}

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
