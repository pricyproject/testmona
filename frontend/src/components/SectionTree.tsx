import { useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  Edit,
  Folder,
  FolderOpen,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface SectionTreeNode {
  id: number;
  name: string;
  description?: string | null;
  test_case_count: number;
  test_suite_id: number;
  parent_section_id: number | null;
  subsections: SectionTreeNode[];
}

interface SectionTreeProps {
  suiteId: number;
  sections: SectionTreeNode[];
  selectedId: number | null;
  expanded: Set<number>;
  emptyLabel?: string;
  rootDropHint?: string;
  invalidMoveMessage?: string;
  cycleMoveMessage?: string;
  /** section_id → recursive (own + descendants) test case count, for non-leaf badges */
  totalCounts?: Record<number, number>;
  /** rendered after the recursive tree (e.g. virtual "Unsectioned" node) */
  extraNodes?: React.ReactNode;
  onToggle: (id: number) => void;
  onSelect: (id: number | null) => void;
  onEdit: (section: SectionTreeNode) => void;
  onDelete: (section: SectionTreeNode) => void;
  onAddChild: (section: SectionTreeNode) => void;
  onMove: (sectionId: number, newParentId: number | null) => void | Promise<void>;
  onInvalidMove?: (message: string) => void;
}

const collectDescendantIds = (node: SectionTreeNode): Set<number> => {
  const ids = new Set<number>();
  const walk = (n: SectionTreeNode) => {
    ids.add(n.id);
    (n.subsections || []).forEach(walk);
  };
  walk(node);
  return ids;
};

const findNode = (
  nodes: SectionTreeNode[],
  id: number,
): SectionTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.subsections || [], id);
    if (found) return found;
  }
  return null;
};

export function SectionTree({
  suiteId,
  sections,
  selectedId,
  expanded,
  emptyLabel,
  rootDropHint,
  invalidMoveMessage,
  cycleMoveMessage,
  totalCounts,
  extraNodes,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  onAddChild,
  onMove,
  onInvalidMove,
}: SectionTreeProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
    useSensor(TouchSensor),
  );
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [draggedNode, setDraggedNode] = useState<SectionTreeNode | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const id = Number(event.active.id);
    setActiveDragId(id);
    setDraggedNode(findNode(sections, id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setDraggedNode(null);
    if (!over || !active) return;

    const draggedId = Number(active.id);
    const dropTargetId = String(over.id);
    if (String(draggedId) === dropTargetId) return;

    const dragged = findNode(sections, draggedId);
    if (!dragged) return;

    let newParentId: number | null = null;
    if (dropTargetId === `root-of-suite-${suiteId}`) {
      // Keep the default null parent for root moves.
    } else if (dropTargetId.startsWith('section-')) {
      const targetSectionId = Number(dropTargetId.replace('section-', ''));
      const target = findNode(sections, targetSectionId);
      if (!target) return;
      if (target.test_suite_id !== dragged.test_suite_id) {
        onInvalidMove?.(invalidMoveMessage || 'Cannot move between test suites.');
        return;
      }
      const blocked = collectDescendantIds(dragged);
      if (blocked.has(targetSectionId)) {
        onInvalidMove?.(cycleMoveMessage || 'Cannot move into a descendant.');
        return;
      }
      newParentId = targetSectionId;
    } else {
      return;
    }

    if ((dragged.parent_section_id ?? null) === newParentId) return;
    await onMove(draggedId, newParentId);
  };

  const isDragging = activeDragId !== null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SuiteRootDropZone
        suiteId={suiteId}
        isDragging={isDragging}
        hint={rootDropHint}
        isEmpty={sections.length === 0 && !extraNodes}
        emptyLabel={emptyLabel}
      >
        {sections.map((section) => (
          <SectionTreeNodeView
            key={section.id}
            section={section}
            level={0}
            expanded={expanded}
            selectedId={selectedId}
            isDragging={isDragging}
            totalCounts={totalCounts}
            onToggle={onToggle}
            onSelect={onSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddChild={onAddChild}
          />
        ))}
        {extraNodes}
      </SuiteRootDropZone>

      <DragOverlay>
        {draggedNode ? (
          <div className="flex items-center gap-2 rounded-lg border-2 border-blue-500 bg-background p-3 shadow-lg">
            <GripVertical className="h-4 w-4 text-blue-500" />
            <Folder className="h-4 w-4 text-blue-600" />
            <span className="font-medium">{draggedNode.name}</span>
            <Badge variant="secondary" className="text-xs">
              {draggedNode.test_case_count} TCs
            </Badge>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SuiteRootDropZone({
  suiteId,
  isDragging,
  hint,
  isEmpty,
  emptyLabel,
  children,
}: {
  suiteId: number;
  isDragging: boolean;
  hint?: string;
  isEmpty: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `root-of-suite-${suiteId}`,
    data: { type: 'suite-root', suiteId },
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-12 rounded-lg border p-2 transition-colors ${
        isOver && isDragging
          ? 'bg-blue-50/60 ring-2 ring-blue-400/60 dark:bg-blue-900/20'
          : 'border-dashed border-border/60'
      }`}
    >
      {isOver && isDragging && hint && (
        <p className="px-3 py-1.5 text-center text-xs font-medium text-blue-600 dark:text-blue-400">
          {hint}
        </p>
      )}
      {isEmpty && !isDragging ? (
        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
          {emptyLabel || 'No sections yet.'}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

function SectionTreeNodeView({
  section,
  level,
  expanded,
  selectedId,
  isDragging,
  totalCounts,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  onAddChild,
}: {
  section: SectionTreeNode;
  level: number;
  expanded: Set<number>;
  selectedId: number | null;
  isDragging: boolean;
  totalCounts?: Record<number, number>;
  onToggle: (id: number) => void;
  onSelect: (id: number | null) => void;
  onEdit: (section: SectionTreeNode) => void;
  onDelete: (section: SectionTreeNode) => void;
  onAddChild: (section: SectionTreeNode) => void;
}) {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `section-${section.id}`,
    data: { type: 'section', sectionId: section.id },
  });
  const {
    setNodeRef: setDraggableRef,
    attributes,
    listeners,
    transform,
    isDragging: isThisDragging,
  } = useDraggable({
    id: section.id,
    data: { type: 'section', sectionId: section.id, testSuiteId: section.test_suite_id },
  });

  const transformStyle = useMemo(
    () =>
      ({
        transform: CSS.Translate.toString(transform),
        opacity: isThisDragging ? 0.4 : 1,
      }) as React.CSSProperties,
    [transform, isThisDragging],
  );

  const hasSubsections = !!section.subsections?.length;
  const isExpanded = expanded.has(section.id);
  const isSelected = selectedId === section.id;

  return (
    <div ref={setDroppableRef} className="select-none">
      <div
        ref={setDraggableRef}
        style={{ ...transformStyle, paddingInlineStart: `${level * 20 + 8}px` }}
        className={`group flex items-center gap-2 rounded-md py-1.5 pe-2 transition-colors ${
          isSelected ? 'bg-accent border-l-4 border-blue-500' : 'hover:bg-accent/60'
        } ${isOver && isDragging ? 'bg-blue-50/70 ring-1 ring-blue-400 dark:bg-blue-900/30' : ''}`}
      >
        <button
          type="button"
          aria-label="Drag handle"
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(section.id);
          }}
        >
          {hasSubsections ? (
            isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="h-4 w-4" />
          )}
        </Button>

        {hasSubsections ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 text-blue-600" />
          ) : (
            <Folder className="h-4 w-4 text-blue-600" />
          )
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground" />
        )}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelect(isSelected ? null : section.id)}
        >
          <span className="truncate font-medium">{section.name}</span>
          <Badge variant="secondary" className="text-xs">
            {section.test_case_count} TCs
          </Badge>
          {totalCounts && totalCounts[section.id] > section.test_case_count && (
            <span
              className="text-xs text-muted-foreground tabular-nums"
              title={`${totalCounts[section.id]} test cases including subsections`}
            >
              ({totalCounts[section.id]} total)
            </span>
          )}
          {section.description && (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              · {section.description}
            </span>
          )}
        </button>

        {/* Actions: always visible on touch (no hover available); fade in on hover on md+. */}
        <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-40 md:group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild(section);
            }}
            aria-label="Add subsection"
            title="Add subsection"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(section);
            }}
            aria-label="Edit section"
            title="Edit section"
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(section);
            }}
            aria-label="Delete section"
            title="Delete section"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {hasSubsections && isExpanded && (
        <div className="ms-6 border-l-2 border-border/60">
          {section.subsections.map((child) => (
            <SectionTreeNodeView
              key={child.id}
              section={child}
              level={level + 1}
              expanded={expanded}
              selectedId={selectedId}
              isDragging={isDragging}
              totalCounts={totalCounts}
              onToggle={onToggle}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}
