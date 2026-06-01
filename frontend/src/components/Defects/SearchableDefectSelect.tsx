import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export type DefectOption = {
  id: number;
  defect_id?: string | null;
  title?: string | null;
  status?: string | null;
  severity?: string | null;
  priority?: string | null;
};

type SearchableDefectSelectProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  defects: DefectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** When provided, the parent owns search (e.g. server-side filtering). */
  onSearchChange?: (query: string) => void;
};

const NONE_VALUE = '';
const MAX_VISIBLE_OPTIONS = 50;

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function SearchableDefectSelect({
  id,
  value,
  onChange,
  defects,
  disabled = false,
  className = '',
  placeholder,
  onSearchChange,
}: SearchableDefectSelectProps) {
  const { t, isRTL } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedDefect = useMemo(
    () => defects.find((defect) => String(defect.id) === value) || null,
    [defects, value]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredDefects = useMemo(() => {
    // When the parent owns search (onSearchChange), `defects` is already
    // filtered server-side — don't filter again on the client.
    const filtered = normalizedQuery && !onSearchChange
      ? defects.filter((defect) => {
          const searchableText = [
            defect.id,
            defect.defect_id,
            defect.title,
            defect.status,
            defect.severity,
            defect.priority,
          ].filter(Boolean).join(' ').toLowerCase();
          return searchableText.includes(normalizedQuery);
        })
      : defects;

    return filtered.slice(0, MAX_VISIBLE_OPTIONS);
  }, [normalizedQuery, defects, onSearchChange]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    onSearchChange?.(nextQuery);
  };

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    updateQuery('');
    setIsOpen(false);
  };

  const selectedDefectCode = selectedDefect
    ? selectedDefect.defect_id || `#${selectedDefect.id}`
    : '';

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)} dir={isRTL ? 'rtl' : 'ltr'}>
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((open) => !open)}
        className={cn('flex w-full min-w-0 items-center justify-between gap-2 font-normal', !selectedDefect && 'text-muted-foreground')}
      >
        {selectedDefect ? (
          // Keep the defect code fully visible and only truncate the title, so a
          // long title can never push the trigger (and its modal) past its width.
          <span className="flex min-w-0 items-center gap-1.5 text-start">
            <span className="shrink-0 font-medium">{selectedDefectCode}</span>
            {selectedDefect.title ? (
              <span className="min-w-0 truncate text-muted-foreground">{`— ${selectedDefect.title}`}</span>
            ) : null}
          </span>
        ) : (
          <span className="min-w-0 truncate text-start">{placeholder || t('linkExistingDefect')}</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-0 rounded-md border bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="border-b p-2 dark:border-gray-700">
            <div className="relative">
              <Search className={cn('absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400', isRTL ? 'right-3' : 'left-3')} />
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                placeholder={t('searchDefects')}
                className={cn('h-9', isRTL ? 'pr-9 pl-8' : 'pl-9 pr-8')}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setIsOpen(false);
                  }
                }}
              />
              {query && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateQuery('')}
                  className={cn('absolute top-1/2 h-6 w-6 -translate-y-1/2 p-0', isRTL ? 'left-1' : 'right-1')}
                  aria-label={t('clearSelection')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div role="listbox" className="max-h-64 overflow-y-auto py-1">
            <button
              type="button"
              role="option"
              aria-selected={value === NONE_VALUE}
              onClick={() => selectValue(NONE_VALUE)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <span>{t('noDefect')}</span>
              {value === NONE_VALUE && <Check className="h-4 w-4 text-blue-600" />}
            </button>

            {filteredDefects.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                {normalizedQuery ? t('noDefectsMatchSearch') : t('noOpenDefects')}
              </div>
            ) : (
              filteredDefects.map((defect) => {
                const optionValue = String(defect.id);
                const isSelected = value === optionValue;
                const severityKey = String(defect.severity || '').toLowerCase();

                return (
                  <button
                    key={defect.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectValue(optionValue)}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-gray-100 rtl:text-right dark:hover:bg-gray-800"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-sm font-medium">
                        {defect.title || `#${defect.id}`}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="text-[11px]">
                          {defect.defect_id || `#${defect.id}`}
                        </Badge>
                        {defect.severity && (
                          <Badge className={cn('text-[11px]', SEVERITY_STYLES[severityKey] || SEVERITY_STYLES.low)}>
                            {defect.severity}
                          </Badge>
                        )}
                        {defect.status && <Badge variant="secondary" className="text-[11px]">{defect.status}</Badge>}
                      </span>
                    </span>
                    {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />}
                  </button>
                );
              })
            )}
          </div>

          {defects.length > MAX_VISIBLE_OPTIONS && (
            <div className="border-t px-3 py-2 text-xs text-gray-500 dark:border-gray-700">
              {t('showingDefectsSummary', { shown: filteredDefects.length, total: defects.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
