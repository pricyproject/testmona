import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { toast } from '@/hooks/use-toast';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Link as LinkIcon,
  Unlink,
  Table2,
  Code2,
  Image as ImageIcon,
  Minus,
  Eraser,
  Pilcrow,
  Eye,
  Pencil,
  FileCode,
  ALargeSmall,
  AtSign,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Combine,
  Heading,
  Maximize2,
  Minimize2,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitize';
import { useTranslation } from '@/hooks/useTranslation';

type ContentFormat = 'markdown' | 'html';
type ViewMode = 'write' | 'source' | 'preview';
type DirOption = 'ltr' | 'rtl' | 'auto';

interface MentionItem {
  id: string;
  label: string;
  href?: string;
  /** 'people' inserts a plain @username (for mention notifications); 'links'
   *  inserts a navigable link. Items without a group fall back to href/plain. */
  group?: 'people' | 'links';
}

export interface ContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  format?: ContentFormat;
  placeholder?: string;
  className?: string;
  dir?: 'ltr' | 'rtl';
  minHeight?: string;
  disabled?: boolean;
  showFullscreen?: boolean;
  mentions?: MentionItem[];
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const HTML_TAG_PROBE = /<\/?[a-z][^>]*>/i;

const lowlight = createLowlight(common);

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});

turndown.addRule('taskListItems', {
  filter: (node) =>
    node.nodeName === 'LI' && (node.parentNode as HTMLElement | null)?.getAttribute?.('data-type') === 'taskList',
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.replace(/^\s+|\s+$/g, '')}\n`;
  },
});

turndown.addRule('taskLists', {
  filter: (node) => node.nodeName === 'UL' && (node as HTMLElement).getAttribute('data-type') === 'taskList',
  replacement: (content) => `\n${content}\n`,
});

turndown.addRule('fencedCodeBlockWithLang', {
  filter: (node) => node.nodeName === 'PRE' && !!(node.firstChild && node.firstChild.nodeName === 'CODE'),
  replacement: (_content, node) => {
    const code = (node as HTMLElement).querySelector('code');
    const text = code?.textContent || '';
    const className = code?.getAttribute('class') || '';
    const langMatch = className.match(/language-([\w-]+)/);
    const lang = langMatch ? langMatch[1] : '';
    return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
  },
});

const escapeHtmlText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Read a column's persisted pixel width from a cell's TipTap `data-colwidth`
// attribute (a comma list for merged cells; the first entry is this column).
const cellWidth = (cell: Element): number | null => {
  const raw = cell.getAttribute('data-colwidth');
  if (!raw) return null;
  const n = parseInt(raw.split(',')[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Serialize HTML tables into canonical Markdown (default turndown drops tables).
// Plain tables become portable GFM; tables with resized columns or merged cells
// are emitted as raw HTML so the column widths / spans survive the round-trip —
// the editor restores them from `data-colwidth` and the reader honors <colgroup>.
turndown.addRule('gfmTable', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const rowCells = rows.map((row) => Array.from(row.querySelectorAll('th,td')));
    const colCount = Math.max(...rowCells.map((cells) => cells.length));

    // Column widths from cell data-colwidth, falling back to a <colgroup>.
    const colEls = Array.from(table.querySelectorAll('colgroup > col'));
    const widths: (number | null)[] = [];
    for (let c = 0; c < colCount; c++) {
      let w: number | null = null;
      for (const cells of rowCells) {
        if (cells[c]) { w = cellWidth(cells[c]); if (w) break; }
      }
      if (!w && colEls[c]) {
        const m = (colEls[c].getAttribute('style') || '').match(/width:\s*([\d.]+)px/);
        if (m) w = Math.round(parseFloat(m[1]));
      }
      widths.push(w);
    }
    const hasWidths = widths.some(Boolean);
    const hasMerges = rowCells.some((cells) =>
      cells.some((cell) => Number(cell.getAttribute('colspan') || 1) > 1 || Number(cell.getAttribute('rowspan') || 1) > 1),
    );

    if (hasWidths || hasMerges) {
      const colgroup = hasWidths
        ? `<colgroup>${widths.map((w) => (w ? `<col style="width: ${w}px">` : '<col>')).join('')}</colgroup>`
        : '';
      const rowsHtml = rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('th,td'));
        const cellsHtml = cells.map((cell) => {
          const tag = cell.nodeName.toLowerCase();
          const attrs: string[] = [];
          const dc = cell.getAttribute('data-colwidth');
          if (dc) attrs.push(`data-colwidth="${dc}"`);
          const w = cellWidth(cell);
          if (w) attrs.push(`style="width: ${w}px"`);
          const cs = cell.getAttribute('colspan');
          if (cs && cs !== '1') attrs.push(`colspan="${cs}"`);
          const rs = cell.getAttribute('rowspan');
          if (rs && rs !== '1') attrs.push(`rowspan="${rs}"`);
          const text = escapeHtmlText((cell.textContent || '').replace(/\r?\n+/g, ' ').trim());
          return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${text}</${tag}>`;
        }).join('');
        return `<tr>${cellsHtml}</tr>`;
      }).join('');
      return `\n\n<table>${colgroup}<tbody>${rowsHtml}</tbody></table>\n\n`;
    }

    const cellText = (cell: Element) =>
      (cell.textContent || '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
    const matrix = rowCells.map((cells) => cells.map(cellText));
    const padded = matrix.map((row) => {
      const copy = row.slice();
      while (copy.length < colCount) copy.push('');
      return copy;
    });
    const toLine = (cells: string[]) => `| ${cells.join(' | ')} |`;
    const header = padded[0];
    const separator = header.map(() => '---');
    const body = padded.slice(1);
    return `\n\n${[toLine(header), toLine(separator), ...body.map(toLine)].join('\n')}\n\n`;
  },
});

marked.setOptions({ gfm: true, breaks: false });

export function markdownToHtml(md: string): string {
  if (!md) return '';
  try {
    return marked.parse(md, { async: false }) as string;
  } catch {
    return md;
  }
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  try {
    return turndown.turndown(html);
  } catch {
    return html;
  }
}

function looksLikeHtml(value: string): boolean {
  return HTML_TAG_PROBE.test(value);
}

function valueToHtml(value: string, format: ContentFormat): string {
  if (!value) return '';
  if (format === 'html') return value;
  // Markdown content always goes through the Markdown renderer. `marked` passes
  // embedded raw HTML (e.g. resized/merged tables) through untouched, so we must
  // not short-circuit when a tag is present — otherwise the surrounding Markdown
  // (headings, lists, …) would render as literal text.
  if (looksLikeHtml(value) && !/(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>|\|)/.test(value)) {
    // Legacy: the value is pure HTML with no Markdown block syntax — pass through.
    return value;
  }
  return markdownToHtml(value);
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^(https?:|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(trimmed)) return `mailto:${trimmed}`;
  return `https://${trimmed}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Unified table controls. A single trigger that inserts a table when the cursor
 * is outside one, and otherwise exposes grouped row / column / cell actions —
 * replacing the row of cramped, duplicated icon buttons.
 */
function TableMenu({ editor, t, disabled }: { editor: Editor; t: TFn; disabled?: boolean }) {
  const inTable = editor.isActive('table');
  const action = (run: () => void) => () => run();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={t('rteTable')}
          disabled={disabled}
          className={cn('h-8 w-8 p-0 text-slate-600 dark:text-slate-300', inTable && 'bg-primary/10 text-primary')}
        >
          <Table2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {!inTable ? (
          <DropdownMenuItem onClick={action(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
            <Table2 className="me-2 h-4 w-4" /> {t('docTableInsert')}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('docTableRows')}</DropdownMenuLabel>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().addRowBefore().run())}>
              <ArrowUp className="me-2 h-4 w-4" /> {t('docTableInsertRowAbove')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().addRowAfter().run())}>
              <ArrowDown className="me-2 h-4 w-4" /> {t('docTableInsertRowBelow')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().deleteRow().run())}>
              <Trash2 className="me-2 h-4 w-4" /> {t('docTableDeleteRow')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('docTableColumns')}</DropdownMenuLabel>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().addColumnBefore().run())}>
              <ArrowLeft className="me-2 h-4 w-4" /> {t('docTableInsertColLeft')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().addColumnAfter().run())}>
              <ArrowRight className="me-2 h-4 w-4" /> {t('docTableInsertColRight')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().deleteColumn().run())}>
              <Trash2 className="me-2 h-4 w-4" /> {t('docTableDeleteColumn')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={action(() => editor.chain().focus().toggleHeaderRow().run())}>
              <Heading className="me-2 h-4 w-4" /> {t('docTableToggleHeader')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().mergeOrSplit().run())}>
              <Combine className="me-2 h-4 w-4" /> {t('docTableMergeSplit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={action(() => editor.chain().focus().deleteSelection().run())}>
              <Eraser className="me-2 h-4 w-4" /> {t('docTableClearCell')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={action(() => editor.chain().focus().deleteTable().run())}>
              <Trash2 className="me-2 h-4 w-4" /> {t('docTableDelete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ContentEditor({
  value,
  onChange,
  format = 'markdown',
  placeholder,
  className,
  dir,
  minHeight,
  disabled = false,
  showFullscreen = true,
  mentions = [],
}: ContentEditorProps) {
  const { t, isRTL } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('write');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dirMode, setDirMode] = useState<DirOption>(dir ?? 'auto');
  const lastEmittedRef = useRef<string>(value || '');

  const resolvedDir = useMemo<'ltr' | 'rtl' | 'auto'>(() => {
    if (dirMode === 'ltr' || dirMode === 'rtl') return dirMode;
    // Auto mode: let the browser pick the direction natively from the first strong
    // character (same `dir="auto"` the reading view uses), instead of a brittle
    // RTL-ratio heuristic that wrongly rendered mixed RTL/Latin docs as LTR. Fall
    // back to the UI direction only when there is no content to judge from.
    const stripped = (value || '').replace(/<[^>]+>/g, '').replace(/\s/g, '');
    return stripped ? 'auto' : (isRTL ? 'rtl' : 'ltr');
  }, [value, dirMode, isRTL]);

  const initialHtml = useMemo(() => valueToHtml(value || '', format), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      Table.configure({
        resizable: true,
        handleWidth: 5,
        cellMinWidth: 48,
        lastColumnResizable: true,
        allowTableNodeSelection: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: true, inline: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null, HTMLAttributes: { class: 'hljs' } }),
    ],
    content: initialHtml || '<p></p>',
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      const emitted = format === 'markdown' ? htmlToMarkdown(html) : html;
      lastEmittedRef.current = emitted;
      onChange(emitted);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-hidden px-4 py-3 min-h-[140px]',
        dir: resolvedDir,
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const images = Array.from(files).filter((file) => ACCEPTED_IMAGE_TYPES.includes(file.type));
        if (!images.length) return false;
        void Promise.all(images.map((file) => insertImageFile(file)));
        return true;
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        const images = Array.from(files).filter((file) => ACCEPTED_IMAGE_TYPES.includes(file.type));
        if (!images.length) return false;
        void Promise.all(images.map((file) => insertImageFile(file)));
        return true;
      },
    },
  });

  const prevViewModeRef = useRef<ViewMode>(viewMode);

  useEffect(() => {
    if (!editor) return;
    const switchedBackToWrite = prevViewModeRef.current !== 'write' && viewMode === 'write';
    prevViewModeRef.current = viewMode;
    if (!switchedBackToWrite && value === lastEmittedRef.current) return;
    const html = valueToHtml(value || '', format);
    const wasFocused = editor.isFocused;
    editor.commands.setContent(html || '<p></p>', { emitUpdate: false });
    lastEmittedRef.current = value || '';
    if (wasFocused) editor.commands.focus('end');
  }, [editor, value, format, viewMode]);

  // Keep the internal direction mode in sync with the controlled `dir` prop so a
  // saved direction loaded after mount — or changed by the parent at runtime —
  // is reflected in the editor (not just at first render).
  useEffect(() => {
    setDirMode(dir ?? 'auto');
  }, [dir]);

  // Reflect direction changes onto the ProseMirror element.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    dom.setAttribute('dir', resolvedDir);
  }, [editor, resolvedDir]);

  // Reflect disabled changes.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const insertImageFile = async (file: File) => {
    if (!editor) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast({ title: t('contentEditorImageRejectedTitle'), description: t('contentEditorImageRejectedType'), variant: 'destructive' });
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast({ title: t('contentEditorImageRejectedTitle'), description: t('contentEditorImageRejectedSize'), variant: 'destructive' });
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
    } catch {
      toast({ title: t('contentEditorImageRejectedTitle'), description: t('contentEditorImageReadFailed'), variant: 'destructive' });
    }
  };

  const pickImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_IMAGE_TYPES.join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) await insertImageFile(file);
    };
    input.click();
  };

  const promptLink = (current?: Editor | null) => {
    const ed = current || editor;
    if (!ed) return;
    const previous = ed.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('rteUrlPrompt'), previous || 'https://');
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      ed.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    ed.chain().focus().extendMarkRange('link').setLink({ href: normalizeUrl(trimmed) }).run();
  };

  const handleSourceChange = (raw: string) => {
    lastEmittedRef.current = raw;
    onChange(raw);
  };

  const cycleDirection = () => {
    setDirMode((prev) => (prev === 'auto' ? 'ltr' : prev === 'ltr' ? 'rtl' : 'auto'));
  };

  const insertMention = (mention: MentionItem) => {
    if (!editor) return;
    const label = mention.label.replace(/[<>&]/g, '');
    if (mention.href) {
      // Insert a real link so the mention is navigable in the rendered view and
      // survives the round-trip to Markdown as [@label](href).
      const safeHref = normalizeUrl(mention.href);
      editor.chain().focus()
        .insertContent(`<a href="${safeHref}">@${label}</a>&nbsp;`)
        .unsetMark('link')
        .run();
    } else {
      editor.chain().focus().insertContent(`@${label} `).run();
    }
  };

  const dirLabel =
    dirMode === 'auto' ? t('contentEditorDirAuto') : dirMode === 'rtl' ? t('contentEditorDirRtl') : t('contentEditorDirLtr');

  const previewHtml = sanitizeHtml(format === 'markdown' ? markdownToHtml(value || '') : value || '');

  if (!editor) {
    return (
      <div
        className={cn('rounded-lg border border-input bg-background', className)}
        style={minHeight ? { minHeight } : undefined}
      />
    );
  }

  const ToolbarBtn = ({
    icon: Icon,
    label,
    active,
    onClick,
    disabled: btnDisabled,
  }: {
    icon: typeof Bold;
    label: string;
    active?: boolean;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={btnDisabled || disabled}
      title={label}
      aria-label={label}
      className={cn(
        'h-8 w-8 shrink-0 p-0 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
        active && 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-white'
      )}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  const Divider = () => <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />;

  const shellClass = cn(
    'rounded-xl border border-slate-200 bg-white shadow-xs transition-all dark:border-slate-800 dark:bg-slate-950',
    'focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30',
    className
  );

  return (
    <div
      className={shellClass}
      dir={resolvedDir}
      data-content-editor
      data-rich-text-editor
      data-markdown-editor
    >
      {/* Top bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800"
        dir="ltr"
      >
        <div className="flex items-center gap-1">
          {/* View mode segmented control */}
          <div className="inline-flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode('write')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'write'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              )}
            >
              <Pencil className="h-3 w-3" /> {t('contentEditorWrite')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('source')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'source'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              )}
            >
              <FileCode className="h-3 w-3" /> {format === 'markdown' ? t('contentEditorMarkdown') : t('contentEditorHtml')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'preview'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              )}
            >
              <Eye className="h-3 w-3" /> {t('contentEditorPreview')}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cycleDirection}
            title={dirLabel}
            className="h-8 gap-1 px-2 text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            <ALargeSmall className="h-3.5 w-3.5" />
            {dirLabel}
          </Button>
          {showFullscreen && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsFullscreen((v) => !v)}
              title={isFullscreen ? t('contentEditorExitFullscreen') : t('contentEditorFullscreen')}
              className="h-8 w-8 p-0 text-slate-600 dark:text-slate-300"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Formatting toolbar — only in write mode */}
      {viewMode === 'write' && (
        <div
          className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-2 py-1 dark:border-slate-800"
          dir="ltr"
        >
          <ToolbarBtn icon={Undo2} label={t('undo')} onClick={() => editor.chain().focus().undo().run()} />
          <ToolbarBtn icon={Redo2} label={t('redo')} onClick={() => editor.chain().focus().redo().run()} />
          <Divider />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                disabled={disabled}
              >
                <Pilcrow className="h-3.5 w-3.5" />
                {editor.isActive('heading', { level: 1 })
                  ? 'H1'
                  : editor.isActive('heading', { level: 2 })
                    ? 'H2'
                    : editor.isActive('heading', { level: 3 })
                      ? 'H3'
                      : t('contentEditorParagraph')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
                <Pilcrow className="mr-2 h-4 w-4" /> {t('contentEditorParagraph')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
                <Heading1 className="mr-2 h-4 w-4" /> {t('contentEditorHeading1')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                <Heading2 className="mr-2 h-4 w-4" /> {t('contentEditorHeading2')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
                <Heading3 className="mr-2 h-4 w-4" /> {t('contentEditorHeading3')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Divider />
          <ToolbarBtn
            icon={Bold}
            label={t('rteBold')}
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarBtn
            icon={Italic}
            label={t('rteItalic')}
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarBtn
            icon={UnderlineIcon}
            label={t('rteUnderline')}
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolbarBtn
            icon={Strikethrough}
            label={t('contentEditorStrike')}
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <ToolbarBtn
            icon={Code}
            label={t('contentEditorInlineCode')}
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
          />
          <Divider />
          <ToolbarBtn
            icon={List}
            label={t('rteBulletList')}
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarBtn
            icon={ListOrdered}
            label={t('rteNumberedList')}
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarBtn
            icon={CheckSquare}
            label={t('rteTaskList')}
            active={editor.isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          />
          <ToolbarBtn
            icon={Quote}
            label={t('rteQuote')}
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
          <Divider />
          <ToolbarBtn
            icon={LinkIcon}
            label={t('rteInlineLink')}
            active={editor.isActive('link')}
            onClick={() => promptLink()}
          />
          <ToolbarBtn icon={ImageIcon} label={t('rteImageUpload')} onClick={pickImage} />
          <TableMenu editor={editor} t={t} disabled={disabled} />
          {mentions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-600 dark:text-slate-300" disabled={disabled} title={t('mentions')}>
                  <AtSign className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-auto">
                {(() => {
                  const people = mentions.filter((m) => m.group === 'people');
                  const links = mentions.filter((m) => m.group !== 'people');
                  return (
                    <>
                      {people.length > 0 && <DropdownMenuLabel>{t('mentionPeople')}</DropdownMenuLabel>}
                      {people.map((mention) => (
                        <DropdownMenuItem key={mention.id} onClick={() => insertMention(mention)}>
                          @{mention.label}
                        </DropdownMenuItem>
                      ))}
                      {people.length > 0 && links.length > 0 && <DropdownMenuSeparator />}
                      {links.length > 0 && people.length > 0 && <DropdownMenuLabel>{t('mentionLinks')}</DropdownMenuLabel>}
                      {links.map((mention) => (
                        <DropdownMenuItem key={mention.id} onClick={() => insertMention(mention)}>
                          @{mention.label}
                        </DropdownMenuItem>
                      ))}
                    </>
                  );
                })()}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ToolbarBtn
            icon={Code2}
            label={t('contentEditorCodeBlock')}
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
          <ToolbarBtn
            icon={Minus}
            label={t('rteDivider')}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          />
        </div>
      )}

      {/* Body */}
      <div
        className="relative overflow-auto"
        style={{ minHeight: isFullscreen ? '70vh' : minHeight }}
      >
        {viewMode === 'write' && (
          <>
            <BubbleMenu
              editor={editor}
              options={{ placement: 'top' }}
              className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <ToolbarBtn
                icon={Bold}
                label={t('rteBold')}
                active={editor.isActive('bold')}
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <ToolbarBtn
                icon={Italic}
                label={t('rteItalic')}
                active={editor.isActive('italic')}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <ToolbarBtn
                icon={UnderlineIcon}
                label={t('rteUnderline')}
                active={editor.isActive('underline')}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              />
              <ToolbarBtn
                icon={Strikethrough}
                label={t('contentEditorStrike')}
                active={editor.isActive('strike')}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
              <ToolbarBtn
                icon={Code}
                label={t('contentEditorInlineCode')}
                active={editor.isActive('code')}
                onClick={() => editor.chain().focus().toggleCode().run()}
              />
              <Divider />
              <ToolbarBtn
                icon={LinkIcon}
                label={t('rteInlineLink')}
                active={editor.isActive('link')}
                onClick={() => promptLink()}
              />
              {editor.isActive('link') && (
                <ToolbarBtn
                  icon={Unlink}
                  label={t('contentEditorRemoveLink')}
                  onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
                />
              )}
            </BubbleMenu>
            <EditorContent editor={editor} />
          </>
        )}

        {viewMode === 'source' && (
          <Textarea
            value={value}
            onChange={(e) => handleSourceChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            dir={resolvedDir}
            className="resize-none rounded-none border-0 bg-transparent px-4 py-3 font-mono text-sm leading-6 focus-visible:ring-0"
            style={{ minHeight: isFullscreen ? '70vh' : minHeight || '180px' }}
          />
        )}

        {viewMode === 'preview' && (
          <div
            className="rich-text-preview max-w-none px-4 py-3"
            dir={resolvedDir}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(
                previewHtml || `<p class="text-slate-400">${(placeholder || '').replace(/[&<>"']/g, (ch) => (
                  ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
                ))}</p>`
              ),
            }}
          />
        )}
      </div>
    </div>
  );
}
