import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TagLike {
  name: string;
  color?: string | null;
}

const DEFAULT_COLOR = '#6366F1';

/**
 * Colored pill for a normalized tag. Mirrors the tinted-background + colored-text
 * treatment used for priorities/types elsewhere, derived from the tag's own color.
 * Pass `onRemove` to render a removable chip (used by the chip input).
 */
export function TagBadge({
  tag,
  onRemove,
  onClick,
  className,
  title,
}: {
  tag: TagLike;
  onRemove?: () => void;
  /** When provided, the pill becomes a button that filters by this tag. */
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const color = tag.color || DEFAULT_COLOR;
  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title ?? tag.name}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'tm-badge inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        onClick && 'cursor-pointer transition-shadow hover:shadow-sm hover:brightness-95',
        className,
      )}
      style={{ backgroundColor: `${color}1f`, borderColor: `${color}55`, color }}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${tag.name}`}
          className="-mr-0.5 ml-0.5 rounded-full p-0.5 hover:bg-black/10 rtl:-ml-0.5 rtl:mr-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export default TagBadge;
