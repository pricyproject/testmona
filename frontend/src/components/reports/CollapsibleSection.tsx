import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Collapsible report panel. Collapsed by default so a reports section stays
 * scannable; the caller may control `open` (e.g. to force a panel open before
 * scrolling to it). Falls back to its own state when used uncontrolled.
 */
export function CollapsibleSection({
  title,
  subtitle,
  actions,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: CollapsibleSectionProps) {
  const { t, isRTL } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={isOpen ? t('collapseAll') : t('expandAll')}
          className="flex min-w-0 items-start gap-2 text-start"
        >
          {isOpen
            ? <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-gray-500" aria-hidden />
            : <ChevronRight className={`mt-1 h-5 w-5 shrink-0 text-gray-500 ${isRTL ? 'rotate-180' : ''}`} aria-hidden />}
          <span className="min-w-0">
            <span className="block text-xl font-semibold">{title}</span>
            {subtitle && <span className="block text-sm text-gray-600 dark:text-gray-400">{subtitle}</span>}
          </span>
        </button>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {isOpen && <div className="px-4 pb-4 sm:px-6 sm:pb-6">{children}</div>}
    </section>
  );
}
