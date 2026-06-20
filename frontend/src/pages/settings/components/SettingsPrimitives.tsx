// Reusable, theme-token-based building blocks for the redesigned Settings
// surface. These replace the ad-hoc, hardcoded gray-*/blue-* cards scattered
// through the old monolith so every section shares one visual language and
// works in light/dark/RTL out of the box.
import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type AccentTone = 'primary' | 'blue' | 'amber' | 'violet' | 'emerald' | 'rose' | 'indigo';

const ACCENT_CLASSES: Record<AccentTone, string> = {
  primary: 'bg-primary/10 text-primary',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
};

export function SectionIcon({ icon: Icon, tone = 'primary' }: { icon: LucideIcon; tone?: AccentTone }) {
  return (
    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', ACCENT_CLASSES[tone])}>
      <Icon className="h-5 w-5" />
    </div>
  );
}

/**
 * A consistent settings section: a bordered card with an icon-chip header,
 * title, optional description, and a right-aligned action slot.
 */
export function SettingsSection({
  icon,
  tone,
  title,
  description,
  action,
  children,
  id,
  className,
  contentClassName,
}: {
  icon: LucideIcon;
  tone?: AccentTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card id={id} className={cn('border-border/60 shadow-sm scroll-mt-24', className)}>
      <div className="flex flex-col gap-4 border-b border-border/60 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 rtl:flex-row-reverse rtl:text-right">
          <SectionIcon icon={icon} tone={tone} />
          <div className="space-y-0.5">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <CardContent className={cn('p-6', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Centered empty-state used by every list section. */
export function SettingsEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Error state with a retry affordance. */
export function SettingsErrorState({
  icon: Icon,
  message,
  retryLabel,
  onRetry,
}: {
  icon: LucideIcon;
  message: ReactNode;
  retryLabel: ReactNode;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <Icon className="h-10 w-10 text-destructive" />
      <p className="max-w-md text-sm text-destructive">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/** Skeleton grid used while a section is loading. */
export function SettingsCardsSkeleton({ count = 6, columns = 3 }: { count?: number; columns?: number }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        columns === 3 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2',
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/60 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/** A labeled boolean row (used by the settings switch grids). */
export function SettingToggleRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
