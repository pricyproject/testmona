import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { resolveNotificationTarget } from '@/lib/notificationNavigation';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Landing route for notification deep-links sent in emails / Slack (``/n/:id``).
 *
 * Email channels can't run the client-side route resolution the bell uses, so
 * they link here: we fetch the notification, mark it read, resolve its in-app
 * target with the same shared logic, and redirect — falling back to the Work
 * Inbox so a link is never a dead end.
 */
export function NotificationRedirect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    const fallback = (messageKey: string) => {
      navigate('/inbox', { replace: true, state: { notificationRedirectError: messageKey } });
    };
    const go = async () => {
      const notificationId = Number(id);
      if (!Number.isFinite(notificationId) || notificationId < 1) {
        fallback('notificationRedirectInvalid');
        return;
      }
      try {
        const { data } = await api.get(`/notifications/${notificationId}`);
        // Best-effort mark-as-read so the badge reflects the opened item.
        api.put(`/notifications/${notificationId}`, { is_read: true }).catch(() => {});
        const target = await resolveNotificationTarget(data);
        if (cancelled) return;
        if (target) navigate(target, { replace: true });
        else fallback('notificationRedirectUnavailable');
      } catch {
        if (!cancelled) fallback('notificationRedirectUnavailable');
      }
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{t('loading')}</span>
    </div>
  );
}
