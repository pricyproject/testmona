import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Textarea } from '@/components/ui/textarea';

// Shared comment-thread primitives, used by both the requirement and defect
// comment panels so @mention autocomplete, bidi/RTL handling, avatars, and
// mention highlighting never drift between the two features.

export interface MemberOption {
  user_id: number;
  username: string;
  full_name?: string | null;
}

export const MAX_COMMENT_BODY_LENGTH = 10000;

// Global (g flag) so split() keeps the captured username between segments.
export const MENTION_TOKEN = /@([A-Za-z0-9_.-]+)/g;
const RTL_CHARACTER = /[\u0590-\u08FF]/;
const FIRST_STRONG_CHARACTER = /[A-Za-z0-9\u0590-\u08FF]/;
const TEXTAREA_NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

// User content is bidi-isolated and auto-directed so a Latin sentence never
// renders reversed/right-aligned under an RTL (Arabic/Farsi) interface.
export const PLAINTEXT_DIR: CSSProperties = { unicodeBidi: 'plaintext', textAlign: 'start' };

export const textInputDirection = (value: string): 'ltr' | 'rtl' => {
  const firstStrong = value.match(FIRST_STRONG_CHARACTER)?.[0];
  return firstStrong && RTL_CHARACTER.test(firstStrong) ? 'rtl' : 'ltr';
};

export const initials = (name?: string | null): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase();
};

export const avatarTone = (seed: number): string => {
  const tones = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  ];
  return tones[Math.abs(seed) % tones.length];
};

// Render a comment body, highlighting @mentions that resolve to a known project
// member. `memberUsernames` must be lowercased.
export const highlightMentions = (text: string, memberUsernames: Set<string>): ReactNode => {
  const segments = text.split(MENTION_TOKEN);
  // split with one capture group yields [text, name, text, name, ...]
  return segments.map((segment, i) => {
    if (i % 2 === 1 && memberUsernames.has(segment.toLowerCase())) {
      return (
        <span key={i} className="rounded bg-blue-100 px-1 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          @{segment}
        </span>
      );
    }
    return <span key={i}>{i % 2 === 1 ? `@${segment}` : segment}</span>;
  });
};

// A Textarea with @mention autocomplete sourced from project members.
export function MentionTextarea({
  value,
  onChange,
  members,
  placeholder,
  autoFocus,
  className,
  disabled,
  id,
  name,
  maxLength,
  ariaLabel,
  ariaDescribedBy,
  onSubmitIntent,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MemberOption[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  maxLength?: number;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  onSubmitIntent?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const direction = textInputDirection(value);

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    return members
      .filter((m) => m.username.toLowerCase().includes(q) || (m.full_name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [open, query, members]);

  // Open the popup only while the caret sits inside an "@token" at a word start.
  const detect = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    const match = /(^|\s)@([A-Za-z0-9_.-]*)$/.exec(before);
    if (match && members.length > 0) {
      setQuery(match[2]);
      setActiveIndex(0);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const insertMention = (username: string) => {
    const el = ref.current;
    const pos = el?.selectionStart ?? value.length;
    const before = value.slice(0, pos).replace(/@([A-Za-z0-9_.-]*)$/, `@${username} `);
    const next = before + value.slice(pos);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (matches.length > 0 && e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (matches.length > 0 && e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (matches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        insertMention(matches[activeIndex].username);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmitIntent?.();
    }
  };

  const mentionedMembers = useMemo(() => {
    const mentioned = new Set((value.match(MENTION_TOKEN) || []).map((token) => token.slice(1).toLowerCase()));
    if (mentioned.size === 0) return [];
    return members.filter((member) => mentioned.has(member.username.toLowerCase()));
  }, [members, value]);

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={ref}
        id={id}
        name={name}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target); }}
        onKeyUp={(e) => {
          if (!TEXTAREA_NAVIGATION_KEYS.has(e.key)) {
            detect(e.currentTarget);
          }
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={maxLength}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        dir={direction}
        style={{
          direction,
          textAlign: direction === 'rtl' ? 'right' : 'left',
          unicodeBidi: 'plaintext',
        }}
      />
      {mentionedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {mentionedMembers.map((member) => (
            <span
              key={member.user_id}
              className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
              dir="ltr"
            >
              @{member.username}
            </span>
          ))}
        </div>
      )}
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-64 overflow-auto rounded-md border bg-popover p-1 shadow-md" role="listbox" style={{ insetInlineStart: 0 }}>
          {matches.map((m, i) => (
            <li key={m.user_id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m.username); }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm ${i === activeIndex ? 'bg-accent' : 'hover:bg-accent'}`}
                role="option"
                aria-selected={i === activeIndex}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarTone(m.user_id)}`}>
                  {initials(m.full_name || m.username)}
                </span>
                <span className="truncate">
                  <span className="font-medium">@{m.username}</span>
                  {m.full_name ? <span className="text-muted-foreground"> · {m.full_name}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
