import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useProjectTags } from '@/hooks/queries/tags';
import type { Tag } from '@/types';
import { TagBadge } from './TagBadge';

const slugify = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Token/chip input for normalized tags. The value is a list of tag *names*; new
 * names are allowed (the backend get-or-creates them per project). Suggestions and
 * chip colors come from the project's tag catalog.
 */
export function TagChipInput({
  projectId,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  id,
}: {
  projectId: number | null;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { t } = useTranslation();
  const { data: catalog = [] } = useProjectTags(projectId);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve a selected name to its catalog tag (for color), falling back to a
  // plain chip for names typed but not yet persisted.
  const colorFor = useMemo(() => {
    const bySlug = new Map(catalog.map((tag: Tag) => [tag.slug ?? slugify(tag.name), tag.color]));
    return (name: string) => bySlug.get(slugify(name));
  }, [catalog]);

  const selectedSlugs = useMemo(() => new Set(value.map(slugify)), [value]);

  const suggestions = useMemo(() => {
    const q = slugify(text);
    return catalog
      .filter((tag: Tag) => !selectedSlugs.has(tag.slug ?? slugify(tag.name)))
      .filter((tag: Tag) => (q ? slugify(tag.name).includes(q) : true))
      .slice(0, 8);
  }, [catalog, selectedSlugs, text]);

  const exactExists =
    catalog.some((tag: Tag) => (tag.slug ?? slugify(tag.name)) === slugify(text)) ||
    selectedSlugs.has(slugify(text));

  const addTag = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    if (selectedSlugs.has(slugify(clean))) {
      setText('');
      return;
    }
    onChange([...value, clean]);
    setText('');
  };

  const removeTag = (name: string) => onChange(value.filter((n) => n !== name));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Stop bubbling so a wrapping form/dialog doesn't submit on Enter.
      e.preventDefault();
      e.stopPropagation();
      if (text.trim()) addTag(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      removeTag(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close the suggestion dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const showCreate = text.trim().length > 0 && !exactExists;
  const showDropdown = open && (suggestions.length > 0 || showCreate);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0',
          disabled && 'cursor-not-allowed opacity-60',
        )}
        onClick={() => !disabled && setOpen(true)}
      >
        {value.map((name) => (
          <TagBadge
            key={name}
            tag={{ name, color: colorFor(name) }}
            onRemove={disabled ? undefined : () => removeTag(name)}
          />
        ))}
        <input
          id={id}
          type="text"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder ?? t('tagsPlaceholder') : ''}
          className="min-w-[6rem] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {suggestions.map((tag: Tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => addTag(tag.name)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="truncate">{tag.name}</span>
              {typeof tag.usage_count === 'number' && (
                <span className="ms-auto text-xs text-muted-foreground tabular-nums">{tag.usage_count}</span>
              )}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onClick={() => addTag(text)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{t('createTag', { name: text.trim() })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default TagChipInput;
