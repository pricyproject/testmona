import { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUp, Edit, GripVertical, History, MoreHorizontal, Play, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { TagBadge } from '@/components/TestCases/TagBadge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/hooks/useTranslation';
import { useDateFormat } from '@/hooks/useDateFormat';
import { entityKey } from '@/lib/utils';
import { TestCase } from '@/types';

type BadgeStyle = string | Record<string, any>;

interface SortableTestCaseRowProps {
  testCase: TestCase;
  onEdit: (testCase: TestCase) => void;
  onMove: (testCase: TestCase) => void;
  onExecute: (testCase: TestCase) => void;
  onViewHistory: (testCase: TestCase) => void;
  onDelete: (id: number) => void;
  getTestCaseDetailUrl: (id: number) => string;
  selectedTestCases: number[];
  handleSelectTestCase: (id: number, checked: boolean) => void;
  getTypeBadge: (type: string) => BadgeStyle;
  getPriorityBadge: (priority: string) => BadgeStyle;
  onTagClick?: (tagName: string) => void;
  isRTL: boolean;
}

const resolveBadgeClass = (badge: BadgeStyle): string => (typeof badge === 'string' ? badge : '');
const resolveBadgeStyle = (badge: BadgeStyle): CSSProperties | undefined => (
  typeof badge === 'object' ? badge as CSSProperties : undefined
);

export function SortableTestCaseRow({
  testCase,
  onEdit,
  onMove,
  onExecute,
  onViewHistory,
  onDelete,
  getTestCaseDetailUrl,
  selectedTestCases,
  handleSelectTestCase,
  getTypeBadge,
  getPriorityBadge,
  onTagClick,
  isRTL,
}: SortableTestCaseRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: testCase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const isSelected = selectedTestCases.includes(testCase.id);
  const testCaseTags = testCase.tags || [];
  const typeBadge = getTypeBadge(testCase.test_type);
  const priorityBadge = getPriorityBadge(testCase.priority);

  if (isDragging) {
    return (
      <TableRow ref={setNodeRef} style={style}>
        <TableCell colSpan={8} className="h-16 bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
          <div className="flex items-center justify-center">
            <GripVertical className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            <span className="text-sm text-gray-500">Dragging {testCase.title}...</span>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow ref={setNodeRef} style={style} className={`group border-b border-gray-100 transition-colors hover:bg-gray-50/80 dark:border-gray-800 dark:hover:bg-gray-800/50 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
      <TableCell className="w-12 py-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => handleSelectTestCase(testCase.id, checked as boolean)}
          />
          <div {...attributes} {...listeners} className="cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-gray-400 hover:text-gray-600" />
          </div>
        </div>
      </TableCell>
      <TableCell className="font-medium w-24 py-2 text-xs">
        <Button
          variant="link"
          className="p-0 h-auto font-medium text-xs text-blue-600 hover:text-blue-800"
          onClick={() => navigate(getTestCaseDetailUrl(testCase.project_seq ?? testCase.id))}
        >
          {entityKey('TC', testCase)}
        </Button>
      </TableCell>
      <TableCell className="font-medium py-2 text-sm">
        <Button
          variant="link"
          className="p-0 h-auto font-medium text-sm text-left hover:text-blue-800"
          onClick={() => navigate(getTestCaseDetailUrl(testCase.project_seq ?? testCase.id))}
        >
          {testCase.title}
        </Button>
      </TableCell>
      <TableCell className="py-2">
        <Badge className={`rounded-full text-xs font-medium capitalize ${resolveBadgeClass(typeBadge)}`} style={resolveBadgeStyle(typeBadge)}>
          {testCase.test_type}
        </Badge>
      </TableCell>
      <TableCell className="py-2">
        <Badge className={`rounded-full text-xs font-medium capitalize ${resolveBadgeClass(priorityBadge)}`} style={resolveBadgeStyle(priorityBadge)}>
          {testCase.priority}
        </Badge>
      </TableCell>
      <TableCell className="py-2 max-w-[180px]">
        <div className="flex flex-wrap gap-1">
          {testCaseTags.slice(0, 3).map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              onClick={onTagClick ? () => onTagClick(tag.name) : undefined}
              title={onTagClick ? t('filterByTag', { name: tag.name }) : undefined}
            />
          ))}
          {testCaseTags.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{testCaseTags.length - 3}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-gray-500 py-2">{formatDate(testCase.created_at)}</TableCell>
      <TableCell className="py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(testCase)}><Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('edit')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(testCase)}><ArrowUp className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('move')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExecute(testCase)}><Play className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('execute')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onViewHistory(testCase)}><History className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('viewHistory')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(testCase.id)} className="text-red-600"><Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('delete')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
