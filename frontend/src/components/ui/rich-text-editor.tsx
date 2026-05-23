import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Table2,
  Minus,
  AtSign,
  ImagePlus,
  CheckSquare,
  Calendar,
  Smile,
  Columns2,
  BadgeCheck,
  SplitSquareHorizontal,
  Merge,
  Undo2,
  Redo2,
  Eye,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface MentionItem {
  id: string;
  label: string;
}

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  mentions?: MentionItem[];
  dir?: 'rtl' | 'ltr';
}

type SlashCommand = {
  key: string;
  label: string;
  action: () => void;
};

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

// Inline style properties the editor schema understands as real formatting.
// Everything else (margins, font-family, line-height, font-size, …) is layout
// noise from Google Docs / Word and gets dropped on paste.
const SEMANTIC_STYLE_PROPS = new Set([
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'color',
]);

const unwrapElement = (element: Element) => {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
};

// Normalises clipboard HTML from Google Docs and Word into the small, clean
// subset the editor schema supports, so pasted documents keep their structure
// (headings, lists, tables, bold/italic) without dragging in inline-style junk.
const sanitizePastedHtml = (rawHtml: string): string => {
  if (typeof window === 'undefined' || !rawHtml) return rawHtml;

  let documentValue: Document;
  try {
    documentValue = new DOMParser().parseFromString(rawHtml.replace(/<!--[\s\S]*?-->/g, ''), 'text/html');
  } catch {
    return rawHtml;
  }

  documentValue.querySelectorAll('style, meta, link, title, script').forEach((element) => element.remove());

  // Google Docs wraps a paste in <b style="font-weight:normal" id="docs-internal-guid-…">
  // and Word emits non-bold <b>; unwrap them so they are not treated as bold.
  documentValue.querySelectorAll('b, strong').forEach((element) => {
    const inlineStyle = (element.getAttribute('style') || '').toLowerCase();
    const id = (element.getAttribute('id') || '').toLowerCase();
    if (id.startsWith('docs-internal-guid') || /font-weight\s*:\s*(normal|400)\b/.test(inlineStyle)) {
      unwrapElement(element);
    }
  });

  documentValue.querySelectorAll<HTMLElement>('*').forEach((element) => {
    ['id', 'class', 'lang', 'dir', 'align', 'width', 'height', 'face'].forEach((attr) => element.removeAttribute(attr));

    const inlineStyle = element.getAttribute('style');
    if (!inlineStyle) return;

    const kept = inlineStyle
      .split(';')
      .map((rule) => rule.trim())
      .filter((rule) => {
        const separator = rule.indexOf(':');
        if (separator === -1) return false;
        const name = rule.slice(0, separator).trim().toLowerCase();
        const ruleValue = rule.slice(separator + 1).trim().toLowerCase();
        if (!SEMANTIC_STYLE_PROPS.has(name)) return false;
        if (name === 'font-weight' && (ruleValue === 'normal' || ruleValue === '400')) return false;
        if (name === 'font-style' && ruleValue === 'normal') return false;
        if (name.startsWith('text-decoration') && (!ruleValue || ruleValue === 'none')) return false;
        if (name === 'color' && (ruleValue === 'inherit' || ruleValue === 'initial')) return false;
        return true;
      });

    if (kept.length) element.setAttribute('style', kept.join('; '));
    else element.removeAttribute('style');
  });

  return documentValue.body.innerHTML;
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  mentions = [],
  dir = 'ltr',
}: RichTextEditorProps) {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const { t } = useTranslation();

  const insertTemplate = (templateType: string) => {
    if (!editor) return;
    const templates: Record<string, string> = {
      requirement: '<h2>Requirement Overview</h2><p>Context and purpose...</p><h3>Scope</h3><ul><li>In scope</li><li>Out of scope</li></ul>',
      decision: '<h2>Decision</h2><p><strong>Date:</strong> ' + new Date().toISOString().slice(0, 10) + '</p><p><strong>Decision:</strong> </p><p><strong>Rationale:</strong> </p>',
      jira: '<p><strong>Jira:</strong> [JIRA-123] Summary and link</p>',
    };
    editor.chain().focus().insertContent(templates[templateType] || templates.requirement).run();
  };

  const insertTodoTemplate = () => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Define scope</p></li><li data-type="taskItem" data-checked="false"><p>Implement</p></li><li data-type="taskItem" data-checked="false"><p>Validate and review</p></li></ul>'
      )
      .run();
  };

  const clearCompletedTodos = () => {
    if (!editor) return;
    const cleaned = editor
      .getHTML()
      .replace(/<li data-type="taskItem" data-checked="true">[\s\S]*?<\/li>/g, '');
    editor.commands.setContent(cleaned || '<p></p>', { emitUpdate: true });
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(file);
    });

  const handleImageInsert = async (file: File) => {
    if (!editor) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE_BYTES) {
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https', 'mailto'],
      }),
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: true, inline: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Mention.configure({
        HTMLAttributes: {
          class: 'rounded bg-blue-100 px-1 py-0.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        },
        suggestion: {
          items: ({ query }) =>
            mentions.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 5),
          render: () => ({ onStart: () => {}, onUpdate: () => {}, onKeyDown: () => false, onExit: () => {} }),
        },
      }),
    ],
    content: value || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      const html = currentEditor.getHTML();
      onChange(html);
      setShowSlashMenu(currentEditor.getText().endsWith('/'));
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        dir,
      },
      transformPastedHTML: (html) => sanitizePastedHtml(html),
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const images = Array.from(files).filter((file) => ACCEPTED_IMAGE_TYPES.includes(file.type));
        if (!images.length) return false;
        void Promise.all(images.map((file) => handleImageInsert(file)));
        return true;
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        const images = Array.from(files).filter((file) => ACCEPTED_IMAGE_TYPES.includes(file.type));
        if (!images.length) return false;
        void Promise.all(images.map((file) => handleImageInsert(file)));
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
    }
  }, [editor, value]);

  const commands = useMemo<SlashCommand[]>(
    () => [
      { key: 'h2', label: t('rteHeading'), action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
      { key: 'bullet', label: t('rteBulletList'), action: () => editor?.chain().focus().toggleBulletList().run() },
      { key: 'number', label: t('rteNumberedList'), action: () => editor?.chain().focus().toggleOrderedList().run() },
      { key: 'task', label: t('rteTaskList'), action: () => editor?.chain().focus().toggleTaskList().run() },
      { key: 'task-template', label: t('rteTaskTemplate'), action: insertTodoTemplate },
      { key: 'quote', label: t('rteQuote'), action: () => editor?.chain().focus().toggleBlockquote().run() },
      { key: 'table', label: t('rteTable'), action: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      {
        key: 'layout',
        label: t('rteTwoColumnLayout'),
        action: () => editor?.chain().focus().insertTable({ rows: 1, cols: 2, withHeaderRow: false }).run(),
      },
      { key: 'divider', label: t('rteDivider'), action: () => editor?.chain().focus().setHorizontalRule().run() },
      {
        key: 'status',
        label: t('rteStatusBadge'),
        action: () => editor?.chain().focus().insertContent('<p><mark data-color="#fff3cd">In Progress</mark></p>').run(),
      },
      {
        key: 'decision',
        label: t('rteDecisionMacro'),
        action: () => insertTemplate('decision'),
      },
      {
        key: 'jira',
        label: t('rteJiraMacro'),
        action: () => insertTemplate('jira'),
      },
      {
        key: 'expand',
        label: t('rteExpandSection'),
        action: () =>
          editor
            ?.chain()
            .focus()
            .insertContent('<blockquote><p>▼ Expandable Section Title</p><p>Hidden content body placeholder.</p></blockquote>')
            .run(),
      },
      {
        key: 'media',
        label: t('rteMediaPlaceholder'),
        action: () => editor?.chain().focus().insertContent(`<p>${t('rteMediaPlaceholderContent')}</p>`).run(),
      },
    ],
    [editor, t]
  );

  const setLink = (mode: 'inline' | 'card' | 'embed' = 'inline') => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt(t('rteUrlPrompt'), previousUrl || 'https://');
    if (url === null) return;
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (mode === 'inline') {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      return;
    }
    if (mode === 'card') {
      editor
        .chain()
        .focus()
        .insertContent(`<p><strong>🔗 Link Card:</strong> <a href="${url}">${url}</a></p>`)
        .run();
      return;
    }
    editor.chain().focus().insertContent(`<p><strong>🔗 Embed:</strong> ${url}</p>`).run();
  };

  const insertMention = () => {
    if (!editor) return;
    const first = mentions[0];
    editor.chain().focus().insertContent(first ? `@${first.label} ` : '@').run();
  };

  const insertEmoji = () => {
    if (!editor) return;
    editor.chain().focus().insertContent('😀').run();
  };

  const insertDate = () => {
    if (!editor) return;
    const date = new Date().toISOString().slice(0, 10);
    editor.chain().focus().insertContent(`<p>📅 ${date}</p>`).run();
  };

  const uploadImageFromPicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_IMAGE_TYPES.join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await handleImageInsert(file);
    };
    input.click();
  };

  if (!editor) return null;
  const toolBtnClass = 'h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8';
  const textBtnClass = 'h-7 shrink-0 px-1.5 text-[11px] sm:h-8 sm:px-2 sm:text-xs';
  const activeBtnClass = 'bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300';
  const runCommand = (command: () => void) => {
    if (isPreviewMode) {
      setIsPreviewMode(false);
    }
    command();
  };

  return (
    <div className={cn('space-y-2', className)} dir={dir} data-rich-text-editor>
      <div className="flex flex-wrap items-start gap-1.5 rounded-lg border border-input bg-muted/30 p-1.5 sm:gap-2 sm:p-2">
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background/70 px-1 py-1">
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={isPreviewMode ? t('rteEditMode') : t('rtePreviewMode')} onClick={() => setIsPreviewMode((previous) => !previous)}>
          {isPreviewMode ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('undo')} onClick={() => runCommand(() => editor.chain().focus().undo().run())}><Undo2 className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('redo')} onClick={() => runCommand(() => editor.chain().focus().redo().run())}><Redo2 className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background/70 px-1 py-1">
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('bold') && activeBtnClass)} title={t('rteBold')} onClick={() => runCommand(() => editor.chain().focus().toggleBold().run())}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('italic') && activeBtnClass)} title={t('rteItalic')} onClick={() => runCommand(() => editor.chain().focus().toggleItalic().run())}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('underline') && activeBtnClass)} title={t('rteUnderline')} onClick={() => runCommand(() => editor.chain().focus().toggleUnderline().run())}><u>U</u></Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background/70 px-1 py-1">
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('bulletList') && activeBtnClass)} title={t('rteBulletList')} onClick={() => runCommand(() => editor.chain().focus().toggleBulletList().run())}><List className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('orderedList') && activeBtnClass)} title={t('rteNumberedList')} onClick={() => runCommand(() => editor.chain().focus().toggleOrderedList().run())}><ListOrdered className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('taskList') && activeBtnClass)} title={t('rteTaskList')} onClick={() => runCommand(() => editor.chain().focus().toggleTaskList().run())}><CheckSquare className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={textBtnClass} title={t('rteClearCompleted')} onClick={() => runCommand(clearCompletedTodos)}>{t('rteClear')}</Button>
        <Button type="button" variant="outline" size="sm" className={cn(toolBtnClass, editor.isActive('blockquote') && activeBtnClass)} title={t('rteQuote')} onClick={() => runCommand(() => editor.chain().focus().toggleBlockquote().run())}><Quote className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background/70 px-1 py-1">
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteInlineLink')} onClick={() => runCommand(() => setLink('inline'))}><LinkIcon className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={textBtnClass} title={t('rteCardLink')} onClick={() => runCommand(() => setLink('card'))}>Card</Button>
        <Button type="button" variant="outline" size="sm" className={textBtnClass} title={t('rteEmbedLink')} onClick={() => runCommand(() => setLink('embed'))}>Embed</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background/70 px-1 py-1">
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteTable')} onClick={() => runCommand(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}><Table2 className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteMergeCells')} onClick={() => runCommand(() => editor.chain().focus().mergeCells().run())}><Merge className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteSplitCell')} onClick={() => runCommand(() => editor.chain().focus().splitCell().run())}><SplitSquareHorizontal className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteTwoColumnLayout')} onClick={() => runCommand(() => editor.chain().focus().insertTable({ rows: 1, cols: 2, withHeaderRow: false }).run())}><Columns2 className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background/70 px-1 py-1">
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteDivider')} onClick={() => runCommand(() => editor.chain().focus().setHorizontalRule().run())}><Minus className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteMention')} onClick={() => runCommand(insertMention)}><AtSign className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteEmoji')} onClick={() => runCommand(insertEmoji)}><Smile className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteDate')} onClick={() => runCommand(insertDate)}><Calendar className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteStatusBadge')} onClick={() => runCommand(() => editor.chain().focus().setHighlight({ color: '#fff3cd' }).run())}><BadgeCheck className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={toolBtnClass} title={t('rteImageUpload')} onClick={() => runCommand(uploadImageFromPicker)}><ImagePlus className="h-4 w-4" /></Button>
        <Button type="button" variant="outline" size="sm" className={textBtnClass} title={t('rteTemplate')} onClick={() => runCommand(() => insertTemplate('requirement'))}>Template</Button>
        </div>
      </div>
      {showSlashMenu && (
        <div className="rounded-md border border-input bg-background p-2 shadow-md">
          <div className="mb-2 text-xs text-muted-foreground">{t('rteSlashCommands')}</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {commands.map((command) => (
              <Button
                key={command.key}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => {
                  command.action();
                  setShowSlashMenu(false);
                }}
              >
                {command.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {isPreviewMode ? (
        <div
          className="min-h-[180px] rounded-md border border-input bg-background p-3 text-sm rich-text-preview"
          dir={dir}
          dangerouslySetInnerHTML={{ __html: value || '<p></p>' }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
