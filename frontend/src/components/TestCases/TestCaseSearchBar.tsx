import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, CornerDownLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export interface SearchSuggestionGroup {
  key: string;
  label: string;
  values: Array<{ value: string; label: string }>;
}

interface Suggestion {
  /** What replaces the in-progress word. */
  insert: string;
  /** Whether selecting keeps the popover open to continue (e.g. picking a key). */
  continues: boolean;
  primary: string;
  secondary?: string;
}

interface TestCaseSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  groups: SearchSuggestionGroup[];
  isRTL?: boolean;
  resultCount?: number;
  resultLabel?: string;
}

const isTypingTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable === true
  );
};

export function TestCaseSearchBar({
  value,
  onChange,
  placeholder,
  groups,
  isRTL = false,
  resultCount,
  resultLabel,
}: TestCaseSearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  // Global "/" shortcut to jump straight into search (skips when already typing).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // The word currently being edited (everything after the last space).
  const lastSpace = value.lastIndexOf(' ');
  const prefix = value.slice(0, lastSpace + 1);
  const word = value.slice(lastSpace + 1);
  const colonIndex = word.indexOf(':');

  const suggestions = useMemo<Suggestion[]>(() => {
    if (colonIndex >= 0) {
      // Completing a value for `key:`
      const rawKey = word.slice(0, colonIndex).replace(/^-/, '').toLowerCase();
      const partial = word.slice(colonIndex + 1).toLowerCase();
      const negate = word.startsWith('-');
      const group = groups.find((g) => g.key === rawKey || g.key.startsWith(rawKey));
      if (!group) return [];
      return group.values
        .filter((v) => !partial || v.value.includes(partial) || v.label.toLowerCase().includes(partial))
        .slice(0, 8)
        .map((v) => ({
          insert: `${negate ? '-' : ''}${group.key}:${v.value.includes(' ') ? `"${v.value}"` : v.value} `,
          continues: false,
          primary: v.label,
          secondary: `${group.key}:`,
        }));
    }

    // Suggesting filter keys (and free-text hint).
    const partial = word.replace(/^-/, '').toLowerCase();
    const keySuggestions = groups
      .filter((g) => !partial || g.key.startsWith(partial) || g.label.toLowerCase().startsWith(partial))
      .slice(0, 8)
      .map((g) => ({
        insert: `${word.startsWith('-') ? '-' : ''}${g.key}:`,
        continues: true,
        primary: `${g.key}:`,
        secondary: g.label,
      }));
    return keySuggestions;
  }, [groups, word, colonIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value, open]);

  const applySuggestion = (suggestion: Suggestion) => {
    const next = prefix + suggestion.insert;
    onChange(next);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const showPopover = open && focused && suggestions.length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        setOpen(false);
        event.stopPropagation();
      } else if (value) {
        onChange('');
      }
      return;
    }
    if (!showPopover) {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
      const suggestion = suggestions[activeIndex];
      if (suggestion) {
        event.preventDefault();
        applySuggestion(suggestion);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search
          className={cn(
            'pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400',
            isRTL ? 'right-3' : 'left-3',
          )}
        />
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={showPopover}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={cn(
            'h-10 rounded-lg border-gray-200 bg-gray-50/60 transition-colors focus-visible:bg-white dark:border-gray-700 dark:bg-gray-800/50',
            isRTL ? 'pr-10 pl-16' : 'pl-10 pr-16',
          )}
        />
        <div
          className={cn(
            'absolute top-1/2 flex -translate-y-1/2 items-center gap-1',
            isRTL ? 'left-2' : 'right-2',
          )}
        >
          {value ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700"
              aria-label={t('clearSearch')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none hidden select-none items-center rounded border border-gray-300 bg-white px-1.5 font-mono text-[11px] font-medium text-gray-400 dark:border-gray-600 dark:bg-gray-900 sm:inline-flex">
              /
            </kbd>
          )}
        </div>
      </div>

      {showPopover && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.insert}-${index}`} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => applySuggestion(suggestion)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                    index === activeIndex
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800',
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="font-medium">{suggestion.primary}</span>
                    {suggestion.secondary && (
                      <span className="truncate text-xs text-gray-400">{suggestion.secondary}</span>
                    )}
                  </span>
                  {index === activeIndex && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-800 dark:bg-gray-900/60">
            <span>
              <kbd className="font-mono">↑↓</kbd> {t('searchPaletteNavigate')} · <kbd className="font-mono">↵</kbd> {t('searchPaletteSelect')} · <kbd className="font-mono">esc</kbd> {t('searchPaletteClose')}
            </span>
            {typeof resultCount === 'number' && (
              <span className="font-medium text-gray-500 dark:text-gray-400">
                {resultCount} {resultLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
