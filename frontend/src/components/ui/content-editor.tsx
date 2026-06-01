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
  Pilcrow,
  Eye,
  Pencil,
  FileCode,
  ALargeSmall,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

const RTL_CHARS =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function detectDirection(text: string, hint: 'ltr' | 'rtl' | 'auto'): 'ltr' | 'rtl' {
  if (hint !== 'auto') return hint;
  let withoutTags = text;
  let previous: string;
  do {
    previous = withoutTags;
    withoutTags = withoutTags.replace(/<[^>]+>/g, '');
  } while (withoutTags !== previous);
  const stripped = withoutTags.replace(/\s/g, '');
  if (!stripped) return 'ltr';
  const rtl = (stripped.match(RTL_CHARS) || []).length;
  return rtl / stripped.length > 0.3 ? 'rtl' : 'ltr';
}

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
  return looksLikeHtml(value) ? value : markdownToHtml(value);
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
  void mentions;
  const { t, isRTL } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('write');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dirMode, setDirMode] = useState<DirOption>(dir ?? 'auto');
  const lastEmittedRef = useRef<string>(value || '');

  const resolvedDir = useMemo(
    () => detectDirection(value || '', dirMode === 'auto' ? (isRTL ? 'rtl' : 'ltr') : dirMode),
    [value, dirMode, isRTL]
  );

  const initialHtml = useMemo(() => valueToHtml(value || '', format), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      Table.configure({ resizable: true }),
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
          <ToolbarBtn
            icon={Table2}
            label={t('rteTable')}
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          />
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
            className="rich-text-preview prose prose-sm max-w-none px-4 py-3 dark:prose-invert"
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
