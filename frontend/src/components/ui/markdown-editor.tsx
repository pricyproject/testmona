import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Eye,
  Edit3,
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Quote,
  Link,
  Heading2,
  Heading3,
  AlignLeft,
  AlignRight,
  Strikethrough,
  Table,
  CheckSquare,
  ChevronDown,
  Image,
  Maximize2,
  Minimize2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

type ToolbarAction =
  | {
      type: 'insertText';
      before: string;
      after?: string;
      placeholder?: string;
      cursorOffset?: number;
    }
  | { type: 'taskList' }
  | { type: 'image' };

type ToolbarButton = {
  key: string;
  icon: LucideIcon;
  title: string;
  action: ToolbarAction;
};

const FORMAT_BUTTONS: ToolbarButton[] = [
  {
    key: 'bold',
    icon: Bold,
    title: 'Bold',
    action: { type: 'insertText', before: '**', after: '**', placeholder: 'bold text' },
  },
  {
    key: 'italic',
    icon: Italic,
    title: 'Italic',
    action: { type: 'insertText', before: '*', after: '*', placeholder: 'italic text' },
  },
  {
    key: 'strikethrough',
    icon: Strikethrough,
    title: 'Strikethrough',
    action: { type: 'insertText', before: '~~', after: '~~', placeholder: 'strikethrough' },
  },
  {
    key: 'inline-code',
    icon: Code,
    title: 'Inline Code',
    action: { type: 'insertText', before: '`', after: '`', placeholder: 'code' },
  },
];

const BLOCK_BUTTONS: ToolbarButton[] = [
  {
    key: 'heading-2',
    icon: Heading2,
    title: 'Heading 2',
    action: { type: 'insertText', before: '## ', placeholder: 'Heading' },
  },
  {
    key: 'heading-3',
    icon: Heading3,
    title: 'Heading 3',
    action: { type: 'insertText', before: '### ', placeholder: 'Heading' },
  },
  {
    key: 'bullet-list',
    icon: List,
    title: 'Bullet List',
    action: { type: 'insertText', before: '- ', placeholder: 'List item' },
  },
  {
    key: 'numbered-list',
    icon: ListOrdered,
    title: 'Numbered List',
    action: { type: 'insertText', before: '1. ', placeholder: 'List item' },
  },
  {
    key: 'quote',
    icon: Quote,
    title: 'Quote',
    action: { type: 'insertText', before: '> ', placeholder: 'Quote' },
  },
  {
    key: 'task-list',
    icon: CheckSquare,
    title: 'Task List',
    action: { type: 'taskList' },
  },
];

const INSERT_BUTTONS: ToolbarButton[] = [
  {
    key: 'link',
    icon: Link,
    title: 'Link',
    action: { type: 'insertText', before: '[', after: '](url)', placeholder: 'link text' },
  },
  {
    key: 'image',
    icon: Image,
    title: 'Image',
    action: { type: 'image' },
  },
];

const CODE_LANGUAGES = [
  { value: 'plaintext', label: 'Plain' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Bash' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
];

const RTL_CHARS =
  /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function detectTextDirection(text: string, isRTL: boolean): 'ltr' | 'rtl' {
  if (!text.trim()) return isRTL ? 'rtl' : 'ltr';

  // If the language is set to RTL, check if there are any RTL characters
  // If yes, keep it RTL regardless of the ratio
  if (isRTL) {
    const hasRTLChars = RTL_CHARS.test(text);
    if (hasRTLChars) return 'rtl';
  }

  const chars = text.replace(/\s/g, '');
  const rtlCount = (chars.match(RTL_CHARS) || []).length;
  return rtlCount / chars.length > 0.3 ? 'rtl' : 'ltr';
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  minHeight?: string;
  disabled?: boolean;
  showFullscreen?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Enter markdown content...',
  className,
  rows = 4,
  minHeight,
  disabled = false,
  showFullscreen = true,
}: MarkdownEditorProps) {
  const [isPreview, setIsPreview] = useState(false);
  const [textDirection, setTextDirection] = useState<'ltr' | 'rtl' | 'auto'>('auto');
  const [codeBlockLang, setCodeBlockLang] = useState('plaintext');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isRTL } = useTranslation();

  const resolvedDir: 'ltr' | 'rtl' =
    textDirection === 'auto' ? detectTextDirection(value, isRTL) : textDirection;

  useEffect(() => {
    if (!textareaRef.current) return;
    const dir = textDirection === 'auto' ? resolvedDir : textDirection;
    textareaRef.current.style.direction = dir;
    textareaRef.current.setAttribute('dir', dir);
  }, [value, textDirection, resolvedDir]);

  const insertText = (
    before: string,
    after = '',
    placeholderText = '',
    cursorOffset = 0
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    const replacement = selectedText || placeholderText;

    const newText =
      value.substring(0, start) + before + replacement + after + value.substring(end);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + before.length + replacement.length + cursorOffset;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const insertCodeBlock = (lang: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const prefix = lang && lang !== 'plaintext' ? '```' + lang + '\n' : '```\n';
    const suffix = '\n```';
    const newText = value.substring(0, start) + prefix + value.substring(start, end) + suffix + value.substring(end);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  };

  const insertTable = (rowsCount: number, colsCount: number) => {
    const header = '| ' + Array(colsCount).fill('Header').join(' | ') + ' |';
    const separator = '|' + Array(colsCount).fill('---').join('|') + '|';
    const body = Array(rowsCount - 1)
      .fill(null)
      .map(() => '| ' + Array(colsCount).fill('').join(' | ') + ' |')
      .join('\n');
    const block = header + '\n' + separator + '\n' + body;
    insertText(block + '\n\n', '', '', 0);
  };

  const insertTaskList = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);

    if (selectedText.trim()) {
      const taskLines = selectedText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `- [ ] ${line}`)
        .join('\n');

      const newText = value.substring(0, start) + taskLines + value.substring(end);
      onChange(newText);
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = start + taskLines.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
      return;
    }

    const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const suffix = end < value.length && value[end] !== '\n' ? '\n' : '';
    const taskBlock = `${prefix}- [ ] Task item\n- [ ] Task item\n- [ ] Task item${suffix}`;
    const newText = value.substring(0, start) + taskBlock + value.substring(end);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      const firstItemTextOffset = prefix.length + '- [ ] '.length;
      const cursorPos = start + firstItemTextOffset;
      textarea.setSelectionRange(cursorPos, cursorPos + 'Task item'.length);
    }, 0);
  };

  const insertImage = () => {
    insertText('![', '](image-url)', 'alt text', 0);
  };

  const handleToolbarAction = (action: ToolbarAction) => {
    if (action.type === 'insertText') {
      insertText(
        action.before,
        action.after ?? '',
        action.placeholder ?? '',
        action.cursorOffset ?? 0
      );
      return;
    }

    if (action.type === 'taskList') {
      insertTaskList();
      return;
    }

    insertImage();
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const getContinuationPrefix = (): string | null => {
    const textarea = textareaRef.current;
    if (!textarea) return null;
    const start = textarea.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', start);
    const currentLine = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
    const trimmed = currentLine.trim();
    if (trimmed === '') return null;

    const onlyMarker =
      /^(\s*)(-\s*\[[ x]\])\s*$/i.test(trimmed) ||
      /^(\s*)([-*+])\s*$/.test(trimmed) ||
      /^(\s*)(\d+)\.\s*$/.test(trimmed) ||
      /^(\s*)(>)\s*$/.test(trimmed);
    if (onlyMarker) return null;

    const hasContentAfter = (fullMatch: string) =>
      currentLine.slice(fullMatch.length).trim().length > 0;

    const taskMatch = currentLine.match(/^(\s*)(-\s*\[[ x]\])\s*/i);
    if (taskMatch && hasContentAfter(taskMatch[0])) {
      return `\n${(currentLine.match(/^\s*/)?.[0] ?? '')}- [ ] `;
    }

    const bulletMatch = currentLine.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch && hasContentAfter(bulletMatch[0])) {
      return `\n${bulletMatch[1]}${bulletMatch[2]} `;
    }

    const numberedMatch = currentLine.match(/^(\s*)(\d+)\.\s+/);
    if (numberedMatch && hasContentAfter(numberedMatch[0])) {
      return `\n${numberedMatch[1]}${parseInt(numberedMatch[2], 10) + 1}. `;
    }

    const quoteMatch = currentLine.match(/^(\s*)(>)\s*/);
    if (quoteMatch && hasContentAfter(quoteMatch[0])) {
      return `\n${quoteMatch[1]}> `;
    }

    return null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const prefix = getContinuationPrefix();
    if (!prefix) return;

    e.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = value.substring(0, start) + prefix + value.substring(end);
    onChange(newText);

    const newCursor = start + prefix.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
    });
  };

  const toggleDirection = () => {
    const directions: ('ltr' | 'rtl' | 'auto')[] = ['ltr', 'rtl', 'auto'];
    const next =
      directions[(directions.indexOf(textDirection) + 1) % directions.length];
    setTextDirection(next);
  };

  const getDirectionIcon = () => (textDirection === 'rtl' ? AlignRight : AlignLeft);
  const getDirectionTitle = () =>
    textDirection === 'ltr' ? 'Left-to-Right' : textDirection === 'rtl' ? 'Right-to-Left' : 'Auto Detect';

  return (
    <div
      className={cn(
        'rounded-lg border border-input bg-background overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50 m-0 rounded-none',
        className
      )}
      dir={resolvedDir}
      data-markdown-editor
    >
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <span className="text-sm font-medium text-muted-foreground">
          {isPreview ? 'Preview' : 'Edit'}
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant={isPreview ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => setIsPreview(false)}
            className="h-7 px-2"
            disabled={disabled}
          >
            <Edit3 className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            type="button"
            variant={isPreview ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setIsPreview(true)}
            className="h-7 px-2"
            disabled={disabled}
          >
            <Eye className="h-3 w-3 mr-1" />
            Preview
          </Button>
          {showFullscreen && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className="h-7 px-2"
              disabled={disabled}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>

      {!isPreview && (
        <div
          className="flex flex-wrap items-center gap-1 px-3 py-2 border-b bg-muted/30 editor-toolbar"
          dir="ltr"
        >
          {FORMAT_BUTTONS.map((btn) => {
            const Icon = btn.icon;
            return (
              <Button
                key={btn.key}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleToolbarAction(btn.action)}
                title={btn.title}
                className="h-7 w-7 p-0"
                disabled={disabled}
              >
                <Icon className="h-3.5 w-3" />
              </Button>
            );
          })}
          <div className="w-px h-5 bg-border mx-1" />
          {BLOCK_BUTTONS.map((btn) => {
            const Icon = btn.icon;
            return (
              <Button
                key={btn.key}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleToolbarAction(btn.action)}
                title={btn.title}
                className="h-7 w-7 p-0"
                disabled={disabled}
              >
                <Icon className="h-3.5 w-3" />
              </Button>
            );
          })}
          <div className="w-px h-5 bg-border mx-1" />
          {INSERT_BUTTONS.map((btn) => {
            const Icon = btn.icon;
            return (
              <Button
                key={btn.key}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleToolbarAction(btn.action)}
                title={btn.title}
                className="h-7 w-7 p-0"
                disabled={disabled}
              >
                <Icon className="h-3.5 w-3" />
              </Button>
            );
          })}
          <Select value={codeBlockLang} onValueChange={setCodeBlockLang}>
            <SelectTrigger className="h-7 w-[100px] border-0 bg-transparent shadow-none focus:ring-0 px-2 gap-0">
              <Code className="h-3.5 w-3 shrink-0" />
              <SelectValue />
              <ChevronDown className="h-3 w-3 opacity-50" />
            </SelectTrigger>
            <SelectContent>
              {CODE_LANGUAGES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertCodeBlock(codeBlockLang)}
            title="Insert code block"
            className="h-7 px-2 text-xs"
            disabled={disabled}
          >
            Code
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertTable(3, 3)}
            title="Insert table"
            className="h-7 w-7 p-0"
            disabled={disabled}
          >
            <Table className="h-3.5 w-3" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleDirection}
            title={getDirectionTitle()}
            className="h-7 w-7 p-0"
            disabled={disabled}
          >
            {(() => {
              const Icon = getDirectionIcon();
              return <Icon className="h-3.5 w-3" />;
            })()}
          </Button>
        </div>
      )}

      <div 
        className={cn(
          "p-3 overflow-auto",
          isFullscreen && "h-[calc(100vh-120px)]"
        )} 
        style={minHeight && !isFullscreen ? { minHeight } : undefined}
      >
        {isPreview ? (
          <div
            className="markdown-preview prose prose-sm max-w-none dark:prose-invert"
            dir={resolvedDir}
            style={{
              textAlign: resolvedDir === 'rtl' ? 'right' : 'left',
              unicodeBidi: 'isolate',
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                code({ className: codeClassName, children }: React.ComponentProps<any>) {
                  const match = /language-(\w+)/.exec(codeClassName || '');
                  if (match) {
                    return (
                      <pre
                        className="rounded-md my-2 overflow-x-auto bg-gray-950 p-3 text-sm text-gray-100 markdown-code-block"
                        dir="ltr"
                      >
                        <code className={`language-${match[1]}`}>
                          {String(children).replace(/\n$/, '')}
                        </code>
                      </pre>
                    );
                  }
                  return (
                    <code
                      className="bg-muted px-1 py-0.5 rounded text-sm markdown-inline-code"
                      dir="ltr"
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
              }}
            >
              {value || '*No content*'}
            </ReactMarkdown>
          </div>
        ) : (
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={isFullscreen ? 30 : rows}
            disabled={disabled}
            dir={resolvedDir}
            className={cn(
              'min-h-0 border-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 bg-transparent',
              isFullscreen && 'h-full'
            )}
            style={{
              direction: resolvedDir,
              textAlign: resolvedDir === 'rtl' ? 'right' : 'left',
              unicodeBidi: 'plaintext',
            }}
          />
        )}
      </div>
    </div>
  );
}
