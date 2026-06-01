import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { Requirement } from '@/types';

type SearchableRequirementSelectProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  requirements: Requirement[];
  disabled?: boolean;
  className?: string;
};

const NONE_VALUE = 'none';
const MAX_VISIBLE_OPTIONS = 50;

export function SearchableRequirementSelect({
  id,
  value,
  onChange,
  requirements,
  disabled = false,
  className = '',
}: SearchableRequirementSelectProps) {
  const { t, isRTL } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedRequirement = useMemo(
    () => requirements.find((requirement) => String(requirement.id) === value) || null,
    [requirements, value],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRequirements = useMemo(() => {
    const filtered = normalizedQuery
      ? requirements.filter((requirement) => {
          const searchableText = [
            requirement.id,
            requirement.requirement_id,
            requirement.title,
            requirement.status,
            requirement.priority,
            requirement.tags,
          ].filter(Boolean).join(' ').toLowerCase();
          return searchableText.includes(normalizedQuery);
        })
      : requirements;

    return filtered.slice(0, MAX_VISIBLE_OPTIONS);
  }, [normalizedQuery, requirements]);

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

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setIsOpen(false);
  };

  const displayValue = selectedRequirement
    ? selectedRequirement.title || selectedRequirement.requirement_id
    : t('noRequirement');

  return (
    <div ref={rootRef} className={cn('relative', className)} dir={isRTL ? 'rtl' : 'ltr'}>
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((open) => !open)}
        className={cn('w-full justify-between font-normal', !selectedRequirement && 'text-muted-foreground')}
      >
        <span className="min-w-0 truncate text-left rtl:text-right">{displayValue}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="border-b p-2 dark:border-gray-700">
            <div className="relative">
              <Search className={cn('absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400', isRTL ? 'right-3' : 'left-3')} />
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchRequirements')}
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
                  onClick={() => setQuery('')}
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
              <span>{t('noRequirement')}</span>
              {value === NONE_VALUE && <Check className="h-4 w-4 text-blue-600" />}
            </button>

            {filteredRequirements.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                {normalizedQuery ? t('noRequirementsFound') : t('noRequirements')}
              </div>
            ) : (
              filteredRequirements.map((requirement) => {
                const optionValue = String(requirement.id);
                const isSelected = value === optionValue;

                return (
                  <button
                    key={requirement.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectValue(optionValue)}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-gray-100 rtl:text-right dark:hover:bg-gray-800"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-sm font-medium">
                        {requirement.title || requirement.requirement_id}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="max-w-32 truncate text-[11px]">{requirement.requirement_id}</Badge>
                        {requirement.status && <Badge variant="secondary" className="text-[11px]">{t(requirement.status)}</Badge>}
                        {requirement.priority && <Badge variant="outline" className="text-[11px]">{t(requirement.priority)}</Badge>}
                      </span>
                    </span>
                    {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />}
                  </button>
                );
              })
            )}
          </div>

          {requirements.length > MAX_VISIBLE_OPTIONS && (
            <div className="border-t px-3 py-2 text-xs text-gray-500 dark:border-gray-700">
              {t('showingRequirementsSummary', { shown: filteredRequirements.length, total: requirements.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
