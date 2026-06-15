import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { watchAPI } from '@/lib/api';
import type { WatchEntityType } from '@/types';

interface Props {
  entityType: WatchEntityType;
  entityId: number;
  /** Compact icon-only rendering for tight toolbars. */
  size?: 'sm' | 'icon';
}

/**
 * Watch / unwatch toggle for any watchable entity (doc, requirement, defect, test
 * case, test plan). Watchers are notified when the entity changes; for versioned
 * entities the alert deep-links to the version-history diff, otherwise to the
 * entity itself.
 */
export function WatchButton({ entityType, entityId, size = 'sm' }: Props) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const [watching, setWatching] = useState(false);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await watchAPI.get(entityType, entityId);
      setWatching(status.watching);
      setCount(status.watcher_count);
    } catch {
      // Non-fatal: leave the control in its default (not-watching) state.
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    const next = !watching;
    try {
      const status = next
        ? await watchAPI.watch(entityType, entityId)
        : await watchAPI.unwatch(entityType, entityId);
      setWatching(status.watching);
      setCount(status.watcher_count);
      toast({
        title: status.watching ? t('watchEnabledTitle') : t('watchDisabledTitle'),
        description: status.watching ? t('watchEnabledDesc') : t('watchDisabledDesc'),
      });
    } catch {
      toast({ title: t('error'), description: t('watchUpdateFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const Icon = saving ? Loader2 : watching ? BellRing : Bell;
  const iconCls = `h-4 w-4 ${saving ? 'animate-spin' : ''} ${size === 'sm' ? (isRTL ? 'ml-2' : 'mr-2') : ''}`;

  if (size === 'icon') {
    return (
      <Button
        type="button"
        variant={watching ? 'default' : 'outline'}
        size="icon"
        onClick={toggle}
        disabled={loading || saving}
        title={watching ? t('watching') : t('watch')}
        aria-pressed={watching}
      >
        {watching && !saving ? <BellRing className="h-4 w-4" /> : saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={watching ? 'default' : 'outline'}
      size="sm"
      onClick={toggle}
      disabled={loading || saving}
      title={watching ? t('watchDisabledDesc') : t('watchEnabledDesc')}
      aria-pressed={watching}
    >
      <Icon className={iconCls} />
      {watching ? t('watching') : t('watch')}
      {count > 0 && (
        <span className="ms-2 rounded-full bg-black/10 px-1.5 text-xs dark:bg-white/15">{count}</span>
      )}
    </Button>
  );
}
