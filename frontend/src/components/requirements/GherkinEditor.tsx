import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Columns2,
  Eye,
  Pencil,
  Plus,
  Table2,
  Tag,
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { GherkinViewer } from '@/components/requirements/GherkinViewer';
import {
  formatGherkin,
  lintGherkin,
  summarizeGherkin,
  type GherkinIssue,
} from '@/components/requirements/gherkin';

type ViewMode = 'edit' | 'split' | 'preview';
// 'auto' lets each line pick its own direction from its first strong character
// (unicode-bidi: plaintext). Gherkin itself is keyword-led (LTR), while each
// step's prose may still contain Arabic/Persian text.
type DirMode = 'auto' | 'ltr' | 'rtl';

interface GherkinEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  disabled?: boolean;
  emptyPreviewLabel: string;
  className?: string;
  /** Forwarded to the editable textarea so an external <Label htmlFor> resolves. */
  id?: string;
  /** Accessible name for the editable surface (the colored layer is aria-hidden). */
  ariaLabel?: string;
}

const STEP_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But'] as const;

const FEATURE_TEMPLATE = [
  'Feature: ',
  '',
  '  Scenario: ',
  '    Given ',
  '    When ',
  '    Then ',
].join('\n');

const SNIPPETS = {
  scenario: ['  Scenario: ', '    Given ', '    When ', '    Then '].join('\n'),
  outline: [
    '  Scenario Outline: ',
    '    Given ',
    '    When ',
    '    Then ',
    '',
    '    Examples:',
    '      | input | result |',
    '      | value | expected |',
  ].join('\n'),
  background: ['  Background:', '    Given '].join('\n'),
  examples: ['    Examples:', '      | input | result |', '      | value | expected |'].join('\n'),
  tag: '@tag',
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap `<placeholder>` tokens (already HTML-escaped to &lt;…&gt;) so Scenario
// Outline parameters stand out in the highlighted layer.
const markPlaceholders = (escaped: string): string =>
  escaped.replace(
    /&lt;([^&]+?)&gt;/g,
    '<span class="rounded bg-amber-100 px-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">&lt;$1&gt;</span>'
  );

const STEP_TONE: Record<string, string> = {
  given: 'text-blue-600 dark:text-blue-300',
  when: 'text-amber-600 dark:text-amber-300',
  then: 'text-emerald-600 dark:text-emerald-300',
  and: 'text-slate-500 dark:text-slate-400',
  but: 'text-slate-500 dark:text-slate-400',
};

const highlightLine = (line: string): string => {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  const rest = line.slice(indent.length);
  if (!rest) return indent;

  if (rest.startsWith('#')) {
    return `${indent}<span class="italic text-slate-400 dark:text-slate-500">${escapeHtml(rest)}</span>`;
  }
  if (rest.startsWith('@')) {
    return `${indent}<span class="text-fuchsia-600 dark:text-fuchsia-400">${escapeHtml(rest)}</span>`;
  }
  if (rest.startsWith('|')) {
    return `${indent}${markPlaceholders(escapeHtml(rest)).replace(/\|/g, '<span class="text-slate-400">|</span>')}`;
  }

  const structural = rest.match(/^(Feature|Rule|Background|Scenario Outline|Scenario|Example|Examples):/i);
  if (structural) {
    const head = rest.slice(0, structural[1].length + 1);
    const tail = rest.slice(head.length);
    return `${indent}<span class="font-semibold text-indigo-600 dark:text-indigo-300">${escapeHtml(head)}</span>${markPlaceholders(escapeHtml(tail))}`;
  }

  const step = rest.match(/^(Given|When|Then|And|But|\*)\b/i);
  if (step) {
    const head = rest.slice(0, step[1].length);
    const tail = rest.slice(head.length);
    const tone = STEP_TONE[step[1].toLowerCase()] ?? 'text-slate-500 dark:text-slate-400';
    return `${indent}<span class="font-semibold ${tone}">${escapeHtml(head)}</span>${markPlaceholders(escapeHtml(tail))}`;
  }

  return `${indent}${markPlaceholders(escapeHtml(rest))}`;
};

// Build the highlighted layer. Content is HTML-escaped before any markup is
// added, so this never injects unsanitized user input.
const highlightGherkin = (value: string): string => {
  const html = value.split('\n').map(highlightLine).join('\n');
  // Trailing newline keeps the highlight layer's height in lockstep with the
  // textarea when the document ends on a blank line.
  return `${html}\n`;
};

const EDITOR_TYPOGRAPHY = 'font-mono text-[13px] leading-6 px-3 py-2.5 whitespace-pre-wrap break-words';

export function GherkinEditor({
  value,
  onChange,
  placeholder,
  minHeight = '200px',
  disabled = false,
  emptyPreviewLabel,
  className,
  id,
  ariaLabel,
}: GherkinEditorProps) {
  const { t, isRTL } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>(readStoredView);
  const [dirMode, setDirMode] = useState<DirMode>(readStoredDir);

  // Remember the chosen layout so re-opening the editor keeps the reviewer's
  // preferred split / edit / preview view.
  const setViewMode = useCallback((next: ViewMode | ((mode: ViewMode) => ViewMode)) => {
    setViewModeState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try {
        window.localStorage.setItem('requirements.gherkinView', resolved);
      } catch {
        // ignore storage failures (private mode / quota)
      }
      return resolved;
    });
  }, []);

  const cycleDir = useCallback(() => {
    setDirMode((prev) => {
      const next: DirMode = prev === 'auto' ? 'ltr' : prev === 'ltr' ? 'rtl' : 'auto';
      try {
        window.localStorage.setItem('requirements.gherkinDir', next);
      } catch {
        // ignore storage failures (private mode / quota)
      }
      return next;
    });
  }, []);

  // Resolved base direction + bidi mode shared by BOTH the textarea and the
  // highlight layer so colored tokens stay glued to the caret. Auto stays LTR
  // because Gherkin keywords and indentation are LTR even inside an RTL app.
  const editorDir: 'ltr' | 'rtl' = dirMode === 'auto' ? 'ltr' : dirMode;
  // 'auto' → per-line direction (plaintext); explicit modes just lean on the
  // dir attribute. Identical on the textarea and highlight layer so the colored
  // tokens never drift from the caret when typing mixed LTR/RTL text.
  const bidiStyle: React.CSSProperties = dirMode === 'auto' ? { unicodeBidi: 'plaintext' } : {};
  const dirLabel = dirMode === 'auto' ? t('contentEditorDirAuto') : dirMode === 'rtl' ? t('contentEditorDirRtl') : t('contentEditorDirLtr');

  const issues = useMemo(() => lintGherkin(value), [value]);
  const summary = useMemo(() => summarizeGherkin(value), [value]);
  const highlighted = useMemo(() => highlightGherkin(value), [value]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (!textarea || !highlight) return;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }, []);

  // Apply a programmatic edit (Tab, Enter, snippet, format) while preserving
  // native undo/redo and avoiding a caret-restore race. We prefer
  // execCommand('insertText') so the browser records the change in the
  // textarea's own history (Ctrl+Z works) and fires a real input event that
  // React's onChange picks up; we fall back to a controlled update only when
  // that path is unavailable (no live textarea / empty-text deletions / very
  // old engines).
  const surgicalEdit = useCallback(
    (from: number, to: number, text: string, selStart?: number, selEnd?: number) => {
      if (disabled) return;
      const caretStart = selStart ?? from + text.length;
      const caretEnd = selEnd ?? caretStart;
      const textarea = textareaRef.current;

      if (textarea && document.activeElement !== textarea) textarea.focus({ preventScroll: true });
      if (textarea) {
        textarea.setSelectionRange(from, to);
        const inserted = (() => {
          try {
            return text.length > 0 && document.execCommand('insertText', false, text);
          } catch {
            return false;
          }
        })();
        if (inserted) {
          textarea.setSelectionRange(caretStart, caretEnd);
          syncScroll();
          return;
        }
      }

      const source = textarea?.value ?? value;
      onChange(source.slice(0, from) + text + source.slice(to));
      requestAnimationFrame(() => {
        const next = textareaRef.current;
        if (!next) return;
        next.focus({ preventScroll: true });
        next.setSelectionRange(caretStart, caretEnd);
        syncScroll();
      });
    },
    [disabled, onChange, syncScroll, value]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = textarea.value;

    if (event.key === 'Tab') {
      event.preventDefault();
      const lineStart = current.lastIndexOf('\n', start - 1) + 1;
      const multiline = start !== end && current.slice(start, end).includes('\n');

      if (multiline) {
        const region = current.slice(lineStart, end);
        if (event.shiftKey) {
          const dedented = region.replace(/^ {1,2}/gm, '');
          const removedFirst = region.length - region.replace(/^ {1,2}/, '').length;
          surgicalEdit(lineStart, end, dedented, Math.max(lineStart, start - removedFirst), lineStart + dedented.length);
        } else {
          const indented = region.replace(/^/gm, '  ');
          surgicalEdit(lineStart, end, indented, start + 2, lineStart + indented.length);
        }
        return;
      }

      if (event.shiftKey) {
        const leading = current.slice(lineStart).match(/^ */)?.[0].length ?? 0;
        const remove = Math.min(2, leading);
        // Replace the whole leading run so the edit stays a single undoable
        // step (a non-empty replacement, which execCommand can record).
        if (remove > 0) {
          surgicalEdit(lineStart, lineStart + leading, ' '.repeat(leading - remove), Math.max(lineStart, start - remove), Math.max(lineStart, end - remove));
        }
        return;
      }

      surgicalEdit(start, end, '  ', start + 2);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const lineStart = current.lastIndexOf('\n', start - 1) + 1;
      const lineSoFar = current.slice(lineStart, start);
      const indent = lineSoFar.match(/^ */)?.[0] ?? '';
      const opensBlock = /^(Feature|Rule|Background|Scenario Outline|Scenario|Example|Examples):/i.test(lineSoFar.trim());
      const insert = `\n${indent}${opensBlock ? '  ' : ''}`;
      surgicalEdit(start, end, insert, start + insert.length);
    }
  };

  const insertStep = (keyword: string) => {
    const textarea = textareaRef.current;
    const start = textarea ? textarea.selectionStart : value.length;
    const end = textarea ? textarea.selectionEnd : value.length;
    const source = textarea?.value ?? value;
    const atLineStart = start === 0 || source[start - 1] === '\n';
    surgicalEdit(start, end, `${atLineStart ? '' : '\n'}    ${keyword} `);
  };

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    const start = textarea ? textarea.selectionStart : value.length;
    const end = textarea ? textarea.selectionEnd : value.length;
    const before = (textarea?.value ?? value).slice(0, start);
    let lead = '';
    if (before.length) {
      if (!before.endsWith('\n')) lead = '\n\n';
      else if (!before.endsWith('\n\n')) lead = '\n';
    }
    surgicalEdit(start, end, lead + snippet);
  };

  const handleFormat = () => {
    const formatted = formatGherkin(value);
    if (formatted !== value) surgicalEdit(0, value.length, formatted, formatted.length);
  };

  const goToLine = (lineNumber: number) => {
    // Make sure the editable surface is visible (problems can be clicked from
    // preview mode too), then select the offending line on the next frame.
    setViewMode((mode) => (mode === 'preview' ? 'split' : mode));
    const lines = value.split('\n');
    let start = 0;
    for (let i = 0; i < lineNumber - 1 && i < lines.length; i += 1) start += lines[i].length + 1;
    const end = start + (lines[lineNumber - 1]?.length ?? 0);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      syncScroll();
    });
  };

  const issueMessage = (issue: GherkinIssue): string =>
    t(`gherkin_lint_${issue.code}`, (issue.params ?? {}) as Record<string, string | number>);

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;

  const editor = (
    <div
      className="relative overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
      style={{ minHeight }}
      dir={editorDir}
    >
      <pre
        ref={highlightRef}
        aria-hidden="true"
        dir={editorDir}
        className={cn(EDITOR_TYPOGRAPHY, 'pointer-events-none m-0 h-full w-full text-start text-slate-800 dark:text-slate-100')}
        style={{ minHeight, ...bidiStyle }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
      {!value && placeholder && (
        <pre
          aria-hidden="true"
          dir="ltr"
          className={cn(
            EDITOR_TYPOGRAPHY,
            'pointer-events-none absolute inset-0 m-0 h-full w-full overflow-hidden text-left text-slate-400 dark:text-slate-500'
          )}
          style={{ minHeight, unicodeBidi: 'plaintext' }}
        >
          {placeholder}
        </pre>
      )}
      <textarea
        ref={textareaRef}
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        placeholder=""
        disabled={disabled}
        dir={editorDir}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          EDITOR_TYPOGRAPHY,
          'absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent text-start text-transparent caret-slate-900 outline-none placeholder:text-slate-400 dark:caret-white'
        )}
        style={bidiStyle}
      />
    </div>
  );

  const preview = (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
      <GherkinViewer value={value} emptyLabel={emptyPreviewLabel} />
    </div>
  );

  return (
    <div className={cn('space-y-2', className)}>
      {/* Toolbar — follows the page direction so it sits naturally in RTL UIs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-1.5 dark:border-slate-800 dark:bg-slate-900/60" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="inline-flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-950">
          {([
            ['edit', Pencil, t('gherkin_viewEdit')],
            ['split', Columns2, t('gherkin_viewSplit')],
            ['preview', Eye, t('gherkin_viewPreview')],
          ] as [ViewMode, typeof Pencil, string][]).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === mode
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              )}
              aria-pressed={viewMode === mode}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        {STEP_KEYWORDS.map((keyword) => (
          <Button
            key={keyword}
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => insertStep(keyword)}
            className={cn('h-7 px-2 text-xs font-semibold', STEP_TONE[keyword.toLowerCase()])}
          >
            {keyword}
          </Button>
        ))}

        <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => insertSnippet(SNIPPETS.scenario)} className="h-7 gap-1 px-2 text-xs">
          <Plus className="h-3.5 w-3.5" /> {t('gherkin_insertScenario')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => insertSnippet(SNIPPETS.outline)} className="h-7 gap-1 px-2 text-xs">
          <Plus className="h-3.5 w-3.5" /> {t('gherkin_insertOutline')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => insertSnippet(SNIPPETS.background)} className="h-7 gap-1 px-2 text-xs">
          <Plus className="h-3.5 w-3.5" /> {t('gherkin_insertBackground')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => insertSnippet(SNIPPETS.examples)} className="h-7 gap-1 px-2 text-xs">
          <Table2 className="h-3.5 w-3.5" /> {t('gherkin_insertExamples')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => insertSnippet(SNIPPETS.tag)} className="h-7 gap-1 px-2 text-xs">
          <Tag className="h-3.5 w-3.5" /> {t('gherkin_insertTag')}
        </Button>

        <div className="ms-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={cycleDir}
            title={dirLabel}
            aria-label={dirLabel}
            className="h-7 gap-1 px-2 text-xs"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" /> {dirLabel}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || !value.trim()} onClick={handleFormat} className="h-7 gap-1 px-2 text-xs">
            <Wand2 className="h-3.5 w-3.5" /> {t('gherkin_format')}
          </Button>
        </div>
      </div>

      {/* Empty-state quick start */}
      {!value.trim() && !disabled && (
        <button
          type="button"
          onClick={() => {
            setViewMode((mode) => (mode === 'preview' ? 'split' : mode));
            surgicalEdit(0, value.length, FEATURE_TEMPLATE, FEATURE_TEMPLATE.indexOf('Feature: ') + 'Feature: '.length);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:text-indigo-300"
        >
          <Plus className="h-3.5 w-3.5" /> {t('insertGherkinTemplate')}
        </button>
      )}

      {/* Editor / preview surface */}
      {viewMode === 'edit' && editor}
      {viewMode === 'preview' && preview}
      {viewMode === 'split' && (
        <div className="grid gap-2 md:grid-cols-2">
          {editor}
          {preview}
        </div>
      )}

      {/* Problems panel */}
      {issues.length > 0 ? (
        <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">
            {errorCount > 0 ? (
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            )}
            {t('gherkin_problems')}
            <Badge variant="secondary" className="ms-1">{issues.length}</Badge>
          </div>
          <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto text-xs dark:divide-slate-800">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.line}-${index}`}>
                <button
                  type="button"
                  onClick={() => goToLine(issue.line)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                  title={t('gherkin_jumpToLine', { line: issue.line })}
                >
                  {issue.severity === 'error' ? (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span dir="auto" className="min-w-0 flex-1 text-start text-slate-700 dark:text-slate-300">{issueMessage(issue)}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">L{issue.line}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        value.trim() && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('gherkin_noProblems')}
          </div>
        )
      )}

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{t('gherkin_statScenarios', { count: summary.scenarios })}</span>
        <span aria-hidden>·</span>
        <span>{t('gherkin_statSteps', { count: summary.steps })}</span>
      </div>
    </div>
  );
}

function readStoredView(): ViewMode {
  try {
    const stored = window.localStorage.getItem('requirements.gherkinView');
    if (stored === 'edit' || stored === 'split' || stored === 'preview') return stored;
  } catch {
    // ignore
  }
  return 'split';
}

function readStoredDir(): DirMode {
  try {
    const stored = window.localStorage.getItem('requirements.gherkinDir');
    if (stored === 'auto' || stored === 'ltr' || stored === 'rtl') return stored;
  } catch {
    // ignore
  }
  return 'auto';
}
