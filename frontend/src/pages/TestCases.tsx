import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, testCasesAPI, testSuitesAPI, sectionsAPI, importExportAPI, userPreferencesAPI, requirementsAPI, testRunsAPI, testResultsAPI } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { IntelligentReferenceField } from '@/components/ui/intelligent-reference-field';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDraggable } from '@dnd-kit/core';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus,
  Search,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Edit,
  Play,
  History,
  Trash2,
  FileText,
  FolderPlus,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Clock,
  User,
  Folder,
  Download,
  Upload,
  RefreshCw,
  Check,
  X,
  Layers,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { MarkdownEditor } from '@/components/ui/markdown-editor';
import { ReferenceField } from '@/components/ui/reference-field';
import { customFieldsAPI } from '@/lib/api';
import { CustomFieldDefinition, TestCase } from '@/types';
import { ImportPreview } from '@/components/ImportPreview';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
const CUSTOM_FIELD_FILTER_ALL = 'all';
const CUSTOM_FIELD_FILTER_ANY_VALUE = '__any__';

// Sortable Row Component
const SortableRow = ({ 
  testCase, 
  onEdit, 
  onMove, 
  onExecute, 
  onViewHistory, 
  onDelete,
  getTestCaseDetailUrl,
  navigate,
  selectedTestCases,
  handleSelectTestCase,
  sections,
  getTypeBadge,
  getPriorityBadge,
  isRTL
}: {
  testCase: TestCase;
  onEdit: (testCase: TestCase) => void;
  onMove: (testCase: TestCase) => void;
  onExecute: (testCase: TestCase) => void;
  onViewHistory: (testCase: TestCase) => void;
  onDelete: (id: number) => void;
  getTestCaseDetailUrl: (id: number) => string;
  navigate: (to: string) => void;
  selectedTestCases: number[];
  handleSelectTestCase: (id: number, checked: boolean) => void;
  sections: Section[];
  getTypeBadge: (type: string) => string | Record<string, any>;
  getPriorityBadge: (priority: string) => string | Record<string, any>;
  isRTL: boolean;
}) => {
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

  const { t } = useTranslation();
  const isSelected = selectedTestCases.includes(testCase.id);

  if (isDragging) {
    return (
      <TableRow ref={setNodeRef} style={style}>
        <TableCell colSpan={9} className="h-16 bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
          <div className="flex items-center justify-center">
            <GripVertical className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            <span className="text-sm text-gray-500">Dragging {testCase.title}...</span>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow ref={setNodeRef} style={style} className={`hover:bg-gray-50 dark:hover:bg-gray-800 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
      <TableCell className="w-12 py-2">
        <div className="flex items-center gap-2">
          <Checkbox 
            checked={isSelected}
            onCheckedChange={(checked) => handleSelectTestCase(testCase.id, checked as boolean)}
            className="mr-2 rtl:mr-0 rtl:ml-2"
          />
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-gray-400 hover:text-gray-600" />
          </div>
        </div>
      </TableCell>
      <TableCell className="font-medium w-24 py-2 text-xs">
        <Button 
          variant="link" 
          className="p-0 h-auto font-medium text-xs text-blue-600 hover:text-blue-800"
          onClick={() => navigate(getTestCaseDetailUrl(testCase.id))}
        >
          TC-{testCase.id.toString().padStart(3, '0')}
        </Button>
      </TableCell>
      <TableCell className="font-medium py-2 text-sm">
        <Button 
          variant="link" 
          className="p-0 h-auto font-medium text-sm text-left hover:text-blue-800"
          onClick={() => navigate(getTestCaseDetailUrl(testCase.id))}
        >
          {testCase.title}
        </Button>
      </TableCell>
      <TableCell className="text-xs py-2">
        <div className="max-w-32">
          <Badge 
            variant="outline" 
            className="text-xs truncate block"
            title={testCase.test_suite?.project?.name || 'N/A'}
          >
            {testCase.test_suite?.project?.name || 'N/A'}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-xs text-gray-500 py-2 max-w-[150px]">
        <div className="truncate" title={testCase.section_id ? (() => {
            const findSectionName = (sectionList: Section[], sectionId: number): string | null => {
              for (const section of sectionList) {
                if (parseInt(section.id) === sectionId) return section.name;
                if (section.children) {
                  const found = findSectionName(section.children, sectionId);
                  if (found) return found;
                }
              }
              return null;
            };
            return findSectionName(sections, testCase.section_id) || `Section ${testCase.section_id}`;
          })() : t('noSection')}>
          {testCase.section_id ? (
            (() => {
              const findSectionName = (sectionList: Section[], sectionId: number): string | null => {
                for (const section of sectionList) {
                  if (parseInt(section.id) === sectionId) return section.name;
                  if (section.children) {
                    const found = findSectionName(section.children, sectionId);
                    if (found) return found;
                  }
                }
                return null;
              };
              return findSectionName(sections, testCase.section_id) || `Section ${testCase.section_id}`;
            })()
          ) : t('noSection')}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <Badge 
          className={`text-xs ${typeof getTypeBadge(testCase.test_type) === 'string' ? getTypeBadge(testCase.test_type) : ''}`}
          style={typeof getTypeBadge(testCase.test_type) === 'object' ? getTypeBadge(testCase.test_type) as any : undefined}
        >
          {testCase.test_type}
        </Badge>
      </TableCell>
      <TableCell className="py-2">
        <Badge 
          className={`text-xs ${typeof getPriorityBadge(testCase.priority) === 'string' ? getPriorityBadge(testCase.priority) : ''}`}
          style={typeof getPriorityBadge(testCase.priority) === 'object' ? getPriorityBadge(testCase.priority) as any : undefined}
        >
          {testCase.priority}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-gray-500 py-2">{new Date(testCase.created_at).toLocaleDateString()}</TableCell>
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
};

interface Section {
  id: string;
  name: string;
  parentId?: string;
  children?: Section[];
  testCaseCount: number;
  cumulativeCount?: number;
  expanded?: boolean;
  test_suite_id?: number;
  test_suite_name?: string;
}

export function TestCases() {
  const { t, isRTL } = useTranslation();
  const navigate = useNavigate();
  const { projectId, sectionId: urlSectionId } = useParams<{ projectId?: string; sectionId?: string }>();
  const { toast } = useToast();
  const currentProjectId = useMemo(() => {
    const parsedProjectId = Number(projectId);
    return projectId && Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  }, [projectId]);

  // Helper function to generate correct test case detail URL
  const getTestCaseDetailUrl = (testCaseId: number) => {
    if (projectId) {
      return `/projects/${projectId}/test-cases/${testCaseId}`;
    }
    return `/test-cases/${testCaseId}`;
  };

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // Consolidated form state
  const [testCaseForm, setTestCaseForm] = useState<{
    title: string;
    description: string;
    reference: string;
    test_type: string;
    execution_type: string;
    priority: string; // Will be constrained by API options
    preconditions: string;
    steps: string;
    expected_result: string;
    environment: string;
    is_multistep: boolean;
  }>({
    title: '',
    description: '',
    reference: '',
    test_type: '',
    execution_type: '',
    priority: '', // Will be set from database default
    preconditions: '',
    steps: '',
    expected_result: '',
    environment: '',
    is_multistep: false
  });
  
  // Multistep test case steps state
  const [testSteps, setTestSteps] = useState<Array<{
    step_number: number;
    action: string;
    expected_result: string;
    step_type: string;
  }>>([]);
  
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const testTypeRef = useRef<HTMLButtonElement>(null);
  const priorityRef = useRef<HTMLButtonElement>(null);
  const environmentRef = useRef<HTMLButtonElement>(null);
  const customFieldRefs = useRef<Record<number, HTMLInputElement | null>>({});
  
  // Requirements linking state
  const [linkedRequirements, setLinkedRequirements] = useState<Array<{id: string, title: string, reference: string}>>([]);
  const [availableRequirements, setAvailableRequirements] = useState<Array<{id: string, title: string, reference: string}>>([]);
  const [isRequirementDialogOpen, setIsRequirementDialogOpen] = useState(false);
  const [requirementSearchQuery, setRequirementSearchQuery] = useState('');
  
  // Shared steps state
  const [availableSharedSteps, setAvailableSharedSteps] = useState<Array<{
    id: number;
    name: string;
    description: string;
    action: string;
    expected_result: string;
    usage_count: number;
  }>>([]);
  const [isSharedStepsDialogOpen, setIsSharedStepsDialogOpen] = useState(false);
  const [sharedStepSearchQuery, setSharedStepSearchQuery] = useState('');
  const [loadingSharedSteps, setLoadingSharedSteps] = useState(false);
  
  // Environment options - fetched from API
  const [environments, setEnvironments] = useState<Array<{id: string, name: string, description: string}>>([]);
  const [isEnvironmentsLoading, setIsEnvironmentsLoading] = useState(false);
  const [isCreatingEnvironment, setIsCreatingEnvironment] = useState(false);
  const [newEnvironmentName, setNewEnvironmentName] = useState('');
  const [newEnvironmentDescription, setNewEnvironmentDescription] = useState('');
  
  // Enum options - fetched from API
  const [priorityOptions, setPriorityOptions] = useState<Array<{value: string, label: string}>>([]);
  const [testTypeOptions, setTestTypeOptions] = useState<Array<{value: string, label: string}>>([]);
  const [isEnumsLoading, setIsEnumsLoading] = useState(false);
  const [isCreatingTestType, setIsCreatingTestType] = useState(false);
  const [isCreatingPriority, setIsCreatingPriority] = useState(false);
  const [newTestTypeName, setNewTestTypeName] = useState('');
  const [newPriorityName, setNewPriorityName] = useState('');
  const [newPriorityValue, setNewPriorityValue] = useState(2);
  
  // Store raw database data for badges with colors
  const [dbPriorities, setDbPriorities] = useState<Array<{name: string, color: string, value: number}>>([]);
  const [dbTestTypes, setDbTestTypes] = useState<Array<{name: string, color: string}>>([]);
  
  // Performance optimization: Preload custom fields on component mount
  const [isCustomFieldsLoading, setIsCustomFieldsLoading] = useState(false);
  const [isModalOpening, setIsModalOpening] = useState(false);
  
  // Validation state for real-time validation
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  
  // Test suite state
  const [currentTestSuiteId, setCurrentTestSuiteId] = useState<number | null>(null);
  const [isTestSuiteLoading, setIsTestSuiteLoading] = useState(true);
  const [isSuiteDialogOpen, setIsSuiteDialogOpen] = useState(false);
  const [isCreatingSuite, setIsCreatingSuite] = useState(false);
  const [suiteName, setSuiteName] = useState('');
  const [suiteDescription, setSuiteDescription] = useState('');
  
  // Import dialog state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSectionId, setImportSectionId] = useState<string>('none');
  const [sectionSearchQuery, setSectionSearchQuery] = useState<string>('');

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Search and pagination state
  const [searchQuery, setSearchQuery] = useState('');
  const [customFieldFilterId, setCustomFieldFilterId] = useState<string>(CUSTOM_FIELD_FILTER_ALL);
  const [customFieldFilterValue, setCustomFieldFilterValue] = useState<string>(CUSTOM_FIELD_FILTER_ANY_VALUE);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Bulk actions state
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTestCase, setEditingTestCase] = useState<TestCase | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedTestCaseForHistory, setSelectedTestCaseForHistory] = useState<TestCase | null>(null);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [isLoadingRevisions, setIsLoadingRevisions] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionParentId, setNewSectionParentId] = useState<string>('none');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['all', '29', '30', '31', '32', '33', '34', '35']));
  
  // Move test case dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [selectedTestCaseToMove, setSelectedTestCaseToMove] = useState<TestCase | null>(null);
  const [destinationSection, setDestinationSection] = useState<string>('');
  
  // Drag and drop state
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  // Sorting and filtering state
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Memoized badge functions that use database data
  const getTypeBadge = useCallback((type: string) => {
    // Try to find the test type in database data first
    const dbTestType = dbTestTypes.find(t => t.name.toLowerCase() === type.toLowerCase());
    if (dbTestType) {
      // Return style object for inline styling
      return {
        backgroundColor: `${dbTestType.color}20`,
        borderColor: dbTestType.color,
        color: dbTestType.color,
        borderLeftWidth: '4px',
        borderLeftStyle: 'solid',
        paddingLeft: '8px'
      };
    }
    
    // Fallback to static Tailwind classes if not found in database
    const variants: Record<string, string> = {
      manual: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      automated: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      smoke: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
      regression: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      integration: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      security: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      performance: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      usability: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
    };
    return variants[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  }, [dbTestTypes]);

  const getPriorityBadge = useCallback((priority: string) => {
    // Try to find the priority in database data first
    const dbPriority = dbPriorities.find(p => p.name.toLowerCase() === priority.toLowerCase());
    if (dbPriority) {
      // Return style object for inline styling
      return {
        backgroundColor: `${dbPriority.color}20`,
        borderColor: dbPriority.color,
        color: dbPriority.color,
        borderLeftWidth: '4px',
        borderLeftStyle: 'solid',
        paddingLeft: '8px'
      };
    }
    
    // Fallback to static Tailwind classes if not found in database
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
      medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  }, [dbPriorities]);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [selectedTestSuite, setSelectedTestSuite] = useState<string>('all');
  const [testTypes, setTestTypes] = useState<string[]>([]);

  // API data state
  const [apiTestCases, setApiTestCases] = useState<TestCase[]>([]);
  const mockSectionsRef = useRef<Section[]>([]);

  // Performance optimization: Preload custom fields on component mount
  useEffect(() => {
    const startTime = performance.now();
    setIsCustomFieldsLoading(true);
    
    const loadCustomFieldsOptimized = async () => {
      if (!currentProjectId) {
        setCustomFields([]);
        setIsCustomFieldsLoading(false);
        return;
      }

      try {
        const fields = await customFieldsAPI.getDefinitions(currentProjectId);
        setCustomFields(fields);
        
        const loadTime = performance.now() - startTime;
        console.log(`Custom fields loaded in ${loadTime.toFixed(2)}ms`);
      } catch (error) {
        console.log('Using mock custom fields - API not available:', error);
        // Mock custom fields for demonstration
        const mockCustomFields: CustomFieldDefinition[] = [
          {
            id: 1,
            name: 'Test Environment',
            field_type: 'select',
            description: 'Select the test environment',
            project_id: currentProjectId,
            is_required: true,
            options: ['Development', 'Staging', 'Production'],
            created_at: new Date().toISOString()
          },
          {
            id: 2,
            name: 'Estimated Duration',
            field_type: 'number',
            description: 'Estimated test duration in minutes',
            project_id: currentProjectId,
            is_required: false,
            created_at: new Date().toISOString()
          }
        ];
        setCustomFields(mockCustomFields);
      } finally {
        setIsCustomFieldsLoading(false);
      }
    };
    
    loadCustomFieldsOptimized();
  }, [currentProjectId]);

  // Load user preferences
  useEffect(() => {
    const loadUserPreferences = async () => {
      try {
        const prefs = await userPreferencesAPI.getItemsPerPage();
        setItemsPerPage(prefs.items_per_page);
      } catch (error) {
        console.error('Failed to load user preferences:', error);
        // Keep default value
      }
    };

    loadUserPreferences();
  }, []);

  // Load enum options from API
  useEffect(() => {
    const loadEnums = async () => {
      try {
        setIsEnumsLoading(true);
        const startTime = performance.now();
        
        // Get token from localStorage
        const token = localStorage.getItem('token');
        if (!token) {
          console.log('No authentication token, using fallback enums');
          throw new Error('No authentication token');
        }

        // Load from new database endpoints
        const [prioritiesResponse, testTypesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/priority-definitions/`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`${API_BASE_URL}/test-type-definitions/`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);

        if (!prioritiesResponse.ok || !testTypesResponse.ok) {
          throw new Error('Failed to fetch from database');
        }

        const prioritiesData = await prioritiesResponse.json();
        const testTypesData = await testTypesResponse.json();

        // Store raw database data for badges
        setDbPriorities(prioritiesData.filter((p: any) => p.is_active));
        setDbTestTypes(testTypesData.filter((t: any) => t.is_active));

        // Transform database data to match the expected format
        const priorityOptions = prioritiesData
          .filter((p: any) => p.is_active)
          .sort((a: any, b: any) => b.value - a.value)
          .map((priority: any) => ({
            value: priority.name.toLowerCase(),
            label: priority.name
          }));

        const testTypeOptions = testTypesData
          .filter((t: any) => t.is_active)
          .map((testType: any) => ({
            value: testType.name.toLowerCase(),
            label: testType.name
          }));
        
        setPriorityOptions(priorityOptions);
        setTestTypeOptions(testTypeOptions);
        setTestTypes(testTypeOptions.map((option) => option.value));
        
        // Set default priority from database
        const defaultPriority = prioritiesData.find((p: any) => p.is_default && p.is_active);
        if (defaultPriority) {
          setTestCaseForm(prev => ({ ...prev, priority: defaultPriority.name.toLowerCase() }));
        } else if (priorityOptions.length > 0) {
          // Fallback to first priority if no default is set
          setTestCaseForm(prev => ({ ...prev, priority: priorityOptions[0].value }));
        }
        
        const loadTime = performance.now() - startTime;
        console.log(`Enums loaded from database in ${loadTime.toFixed(2)}ms`);
      } catch (error) {
        console.log('Using fallback enums - API not available:', error);
        // Fallback to basic options if API fails
        const fallbackPriorities = [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' }
        ];
        const fallbackTestTypes = [
          { value: 'manual', label: 'Manual' },
          { value: 'automated', label: 'Automated' },
          { value: 'smoke', label: 'Smoke' },
          { value: 'regression', label: 'Regression' },
          { value: 'integration', label: 'Integration' },
          { value: 'security', label: 'Security' },
          { value: 'performance', label: 'Performance' },
          { value: 'usability', label: 'Usability' }
        ];
        setPriorityOptions(fallbackPriorities);
        setTestTypeOptions(fallbackTestTypes);
        setTestTypes(fallbackTestTypes.map((option) => option.value));
      } finally {
        setIsEnumsLoading(false);
      }
    };
    
    loadEnums();
  }, []);

  // Function to create a new test type inline
  const handleCreateTestType = async () => {
    try {
      setIsCreatingTestType(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast({
          title: t('error'),
          description: t('authenticationRequired'),
          variant: "destructive",
        });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/test-type-definitions/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newTestTypeName,
          description: `Custom test type: ${newTestTypeName}`,
          color: '#3B82F6',
          icon: '📝',
          created_by: 1 // Will be set by backend based on auth token
        })
      });

      if (response.ok) {
        // Refresh test types
        const testTypesResponse = await fetch(`${API_BASE_URL}/test-type-definitions/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const testTypesData = await testTypesResponse.json();

        setDbTestTypes(testTypesData.filter((t: any) => t.is_active));
        const testTypeOptions = testTypesData
          .filter((t: any) => t.is_active)
          .map((testType: any) => ({
            value: testType.name.toLowerCase(),
            label: testType.name
          }));
        setTestTypeOptions(testTypeOptions);
        setTestTypes(testTypeOptions.map((option) => option.value));

        // Select the newly created test type
        handleTestTypeChange(newTestTypeName.toLowerCase());
        setNewTestTypeName('');

        toast({
          title: t('success'),
          description: t('testTypeCreatedSuccessfully', {name: newTestTypeName}),
        });
      } else {
        throw new Error('Failed to create test type');
      }
    } catch (error) {
      console.error('Failed to create test type:', error);
      toast({
        title: t('error'),
        description: t('failedToCreateTestType'),
        variant: "destructive",
      });
    } finally {
      setIsCreatingTestType(false);
    }
  };

  // Function to create a new priority inline
  const handleCreatePriority = async () => {
    try {
      setIsCreatingPriority(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast({
          title: t('error'),
          description: t('authenticationRequired'),
          variant: "destructive",
        });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/priority-definitions/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newPriorityName,
          value: newPriorityValue,
          color: '#F59E0B',
          description: `Custom priority: ${newPriorityName}`,
          created_by: 1 // Will be set by backend based on auth token
        })
      });

      if (response.ok) {
        // Refresh priorities
        const prioritiesResponse = await fetch(`${API_BASE_URL}/priority-definitions/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const prioritiesData = await prioritiesResponse.json();

        setDbPriorities(prioritiesData.filter((p: any) => p.is_active));
        const priorityOptions = prioritiesData
          .filter((p: any) => p.is_active)
          .sort((a: any, b: any) => b.value - a.value)
          .map((priority: any) => ({
            value: priority.name.toLowerCase(),
            label: priority.name
          }));
        setPriorityOptions(priorityOptions);

        // Select the newly created priority
        handlePriorityChange(newPriorityName.toLowerCase());
        setNewPriorityName('');
        setNewPriorityValue(2);

        toast({
          title: t('success'),
          description: t('priorityCreatedSuccessfully', {name: newPriorityName}),
        });
      } else {
        throw new Error('Failed to create priority');
      }
    } catch (error) {
      console.error('Failed to create priority:', error);
      toast({
        title: t('error'),
        description: t('failedToCreatePriority'),
        variant: "destructive",
      });
    } finally {
      setIsCreatingPriority(false);
    }
  };

  // Function to create a new environment inline
  const handleCreateEnvironment = async () => {
    if (!currentProjectId) {
      toast({
        title: t('error'),
        description: t('noProjectSelected'),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreatingEnvironment(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast({
          title: t('error'),
          description: t('authenticationRequired'),
          variant: "destructive",
        });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/environments/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newEnvironmentName,
          description: newEnvironmentDescription || `${newEnvironmentName} environment`,
          environment_type: 'testing',
          project_id: currentProjectId
        })
      });

      if (response.ok) {
        // Refresh environments
        const { environmentsAPI } = await import('@/lib/api');
        const data = await environmentsAPI.getAll(currentProjectId);
        
        const transformedEnvironments = data.map((env: any) => ({
          id: env.id.toString(),
          name: env.name,
          description: env.description || `${env.name} environment`
        }));
        
        setEnvironments(transformedEnvironments);

        // Select the newly created environment
        const newEnv = transformedEnvironments.find((e: any) => e.name === newEnvironmentName);
        if (newEnv) {
          handleFieldChange('environment', newEnv.id);
        }
        setNewEnvironmentName('');
        setNewEnvironmentDescription('');

        toast({
          title: t('success'),
          description: t('environmentCreatedSuccessfully', {name: newEnvironmentName}),
        });
      } else {
        throw new Error('Failed to create environment');
      }
    } catch (error) {
      console.error('Failed to create environment:', error);
      toast({
        title: t('error'),
        description: t('failedToCreateEnvironment'),
        variant: "destructive",
      });
    } finally {
      setIsCreatingEnvironment(false);
    }
  };

  // Load environments from API
  useEffect(() => {
    const loadEnvironments = async () => {
      if (!currentProjectId) {
        setEnvironments([]);
        setIsEnvironmentsLoading(false);
        return;
      }

      try {
        setIsEnvironmentsLoading(true);
        const startTime = performance.now();
        
        // Import environmentsAPI dynamically to avoid circular dependencies
        const { environmentsAPI } = await import('@/lib/api');
        const data = await environmentsAPI.getAll(currentProjectId);
        
        // Transform environment data to match the expected format
        const transformedEnvironments = data.map((env: any) => ({
          id: env.id.toString(),
          name: env.name,
          description: env.description || `${env.name} environment`
        }));
        
        setEnvironments(transformedEnvironments);
        
        const loadTime = performance.now() - startTime;
        console.log(`Environments loaded in ${loadTime.toFixed(2)}ms`);
      } catch (error) {
        console.log('Using fallback environments - API not available:', error);
        // Fallback to basic environments if API fails
        const fallbackEnvironments = [
          { id: 'development', name: 'Development', description: 'Development environment for testing' },
          { id: 'staging', name: 'Staging', description: 'Staging environment for pre-production testing' },
          { id: 'production', name: 'Production', description: 'Production environment for live testing' },
          { id: 'qa', name: 'QA', description: 'Quality assurance environment' }
        ];
        setEnvironments(fallbackEnvironments);
      } finally {
        setIsEnvironmentsLoading(false);
      }
    };
    
    loadEnvironments();
  }, [currentProjectId]);

  // Optimized modal opening with performance tracking
  const handleOpenModal = () => {
    const startTime = performance.now();
    setIsModalOpening(true);
    
    // Use requestAnimationFrame for smoother rendering
    requestAnimationFrame(() => {
      setIsDialogOpen(true);
      setIsModalOpening(false);
      
      const openTime = performance.now() - startTime;
      console.log(`Modal opened in ${openTime.toFixed(2)}ms`);
    });
  };

  // Focus management with optimization
  useEffect(() => {
    if (isDialogOpen && titleInputRef.current && !isModalOpening) {
      const focusStartTime = performance.now();
      
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        titleInputRef.current?.focus();
        const focusTime = performance.now() - focusStartTime;
        console.log(`Focus set in ${focusTime.toFixed(2)}ms`);
      }, 50); // Reduced from 100ms for faster focus
    }
  }, [isDialogOpen, isModalOpening]);

  // Load test cases from API and when section selection changes
  useEffect(() => {
    // Load all test cases for the project
    // Client-side filtering handles section selection, so no need to reload on selection change
    loadTestCases();
  }, [currentProjectId, sortField, sortDirection]);

  // Add console logging for debugging
  useEffect(() => {
    console.log('TestCases component mounted with projectId:', projectId);
    console.log('Current apiTestCases:', apiTestCases);
    console.log('Current selectedTestSuite:', selectedTestSuite);
  }, [projectId, apiTestCases, selectedTestSuite]);

  // Helper function to get all section IDs including children (recursive)
  const getAllSectionIds = (sectionId: string, sections: Section[]): number[] => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return [parseInt(sectionId)];
    
    const ids = [parseInt(sectionId)];
    
    // Add all child section IDs recursively
    const addChildIds = (children: Section[]) => {
      children.forEach(child => {
        ids.push(parseInt(child.id));
        if (child.children && child.children.length > 0) {
          addChildIds(child.children);
        }
      });
    };
    
    if (section.children && section.children.length > 0) {
      addChildIds(section.children);
    }
    
    return ids;
  };

  const loadTestCases = async () => {
    if (!currentProjectId) {
      setApiTestCases([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Load ALL test cases for the project to ensure accurate counts for all sections
      // Client-side filtering will handle display filtering based on selectedTestSuite
      console.log('Loading test cases for project:', currentProjectId);
      
      const [testCases, count] = await Promise.all([
        testCasesAPI.getAll(
          currentProjectId,
          undefined, // Don't filter by test suite
          undefined, // Don't filter by section
          sortField,
          sortDirection
        ),
        testCasesAPI.getCount(currentProjectId),
      ]);
      
      console.log('Loaded test cases:', testCases.length);
      setApiTestCases(testCases);
      setTotalCount(count.count);
      
      // Extract test types from loaded data
      const types = Array.from(new Set([
        ...testTypeOptions.map((option) => option.value),
        ...extractTestTypes(testCases),
      ])).sort();
      setTestTypes(types);
    } catch (error) {
      console.log('Failed to load test cases from API:', error);
      setApiTestCases([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  // Extract unique test types from loaded test cases
  const extractTestTypes = (testCases: TestCase[]) => {
    const types = new Set<string>();
    testCases.forEach(testCase => {
      if (testCase.test_type) {
        types.add(testCase.test_type);
      }
    });
    return Array.from(types).sort();
  };

  // Mock sections with tree structure (updated with real section IDs)
  const [mockSections, setMockSectionsState] = useState<Section[]>([
    {
      id: '1',
      name: 'Authentication',
      testCaseCount: 2,
      expanded: true,
      children: [
        {
          id: '2',
          name: 'Login',
          parentId: '1',
          testCaseCount: 2,
          expanded: false,
        },
        {
          id: '3',
          name: 'Register',
          parentId: '1',
          testCaseCount: 2,
          expanded: false,
        },
      ],
    },
    {
      id: '6',
      name: 'User Management',
      testCaseCount: 1,
      expanded: true,
      children: [
        {
          id: '9',
          name: 'user management basics',
          parentId: '6',
          testCaseCount: 0,
          expanded: false,
        },
      ],
    },
    {
      id: '10',
      name: 'Reporting',
      testCaseCount: 0,
      expanded: false,
      children: [],
    },
  ]);

  // Custom setter to update both state and ref
  const setMockSections = (sections: Section[] | ((prev: Section[]) => Section[])) => {
    if (typeof sections === 'function') {
      setMockSectionsState(prev => {
        const newSections = sections(prev);
        mockSectionsRef.current = newSections;
        return newSections;
      });
    } else {
      mockSectionsRef.current = sections;
      setMockSectionsState(sections);
    }
  };

  // Load sections from API
  const loadSections = async () => {
    if (!currentProjectId) {
      console.log('No project ID available, skipping sections load');
      return;
    }
    
    try {
      // Use the project hierarchy API to get sections from all test suites
      const hierarchyData = await sectionsAPI.getProjectSectionHierarchy(currentProjectId);
      
      console.log('Hierarchy data received:', hierarchyData);
      
      if (hierarchyData && hierarchyData.hierarchy && hierarchyData.hierarchy.length > 0) {
        // Transform API data directly to our Section interface without flattening
        const allSections: Section[] = [];
        
        const transformSection = (section: any, level: number = 0, parentId?: string): Section => {
          const sectionData: Section = {
            id: section.id.toString(),
            name: section.name,
            testCaseCount: section.test_case_count || 0,
            expanded: level === 0, // Expand root sections by default
            parentId: parentId,
            children: [],
            test_suite_id: null, // Will be set at the suite level
            test_suite_name: ''  // Will be set at the suite level
          };
          
          // Transform subsections recursively
          if (section.subsections && section.subsections.length > 0) {
            sectionData.children = section.subsections.map((subsection: any) => 
              transformSection(subsection, level + 1, sectionData.id)
            );
          }
          
          return sectionData;
        };
        
        // Process each test suite
        hierarchyData.hierarchy.forEach((suiteData: any) => {
          console.log(`Processing test suite: ${suiteData.test_suite.name} (ID: ${suiteData.test_suite.id})`);
          console.log(`  Sections count: ${suiteData.sections?.length || 0}`);
          
          if (suiteData.sections && suiteData.sections.length > 0) {
            suiteData.sections.forEach((section: any) => {
              const transformedSection = transformSection(section, 0);
              // Add suite info to all sections in this suite
              const addSuiteInfo = (sec: Section) => {
                sec.test_suite_id = suiteData.test_suite.id;
                sec.test_suite_name = suiteData.test_suite.name;
                if (sec.children) {
                  sec.children.forEach(addSuiteInfo);
                }
              };
              addSuiteInfo(transformedSection);
              allSections.push(transformedSection);
            });
          }
        });
        
        console.log('Transformed sections:', allSections);
        setMockSections(allSections);
      } else {
        // No test suites or hierarchy data
        setMockSections([]);
      }
    } catch (error) {
      console.log('Using mock sections - API not available:', error);
      // Keep using mock sections if API fails
    }
  };

  // Calculate cumulative test case count for a section (including all subsections)
  const calculateCumulativeCount = (section: Section): number => {
    let count = apiTestCases.filter(testCase => testCase.section_id === parseInt(section.id)).length;
    
    if (section.children && section.children.length > 0) {
      section.children.forEach(child => {
        count += calculateCumulativeCount(child);
      });
    }
    
    return count;
  };

  // Recalculate section test case counts when test cases change
  // DISABLED: Counts are already calculated in loadSections and this was causing sections to disappear
  // useEffect(() => {
  //   if (mockSections.length > 0) {
  //     const updatedSections = mockSections.map(section => {
  //       const directCount = apiTestCases.filter(testCase => testCase.section_id === parseInt(section.id)).length;
  //       const cumulativeCount = calculateCumulativeCount(section);
  //       
  //       return {
  //         ...section,
  //         testCaseCount: directCount,
  //         cumulativeCount: cumulativeCount,
  //         children: section.children?.map(child => {
  //           const childDirectCount = apiTestCases.filter(testCase => testCase.section_id === parseInt(child.id)).length;
  //           const childCumulativeCount = calculateCumulativeCount(child);
  //           
  //           return {
  //             ...child,
  //             testCaseCount: childDirectCount,
  //             cumulativeCount: childCumulativeCount,
  //           };
  //         })
  //       };
  //     });
  //     setMockSections(updatedSections);
  //   }
  // }, [apiTestCases, mockSections.length]); // Only depend on apiTestCases and mockSections.length, not mockSections itself
  useEffect(() => {
    const initializeData = async () => {
      // Clear sections when project changes
      setMockSections([]);
      setCurrentTestSuiteId(null);
      
      await loadTestSuite();
      await loadTestCases();
      // loadCustomFields();
    };
    
    initializeData();
  }, [currentProjectId]);

  // Reload sections when project ID changes
  useEffect(() => {
    if (currentProjectId) {
      loadSections();
    } else {
      // Clear sections if no project is available
      setMockSections([]);
    }
  }, [currentProjectId]); // Only reload when project changes, not when test cases change

  // Load test suite for the current project
  const loadTestSuite = async () => {
    if (!currentProjectId) {
      setIsTestSuiteLoading(false);
      return;
    }
    
    try {
      setIsTestSuiteLoading(true);
      const { testSuitesAPI } = await import('@/lib/api');
      const testSuites = await testSuitesAPI.getAll(currentProjectId);
      
      if (testSuites && testSuites.length > 0) {
        // Use the first test suite for this project
        setCurrentTestSuiteId(testSuites[0].id);
        console.log('Loaded test suite for project:', testSuites[0].id);
      } else {
        console.warn('No test suites found for project:', currentProjectId);
        setCurrentTestSuiteId(null);
      }
    } catch (error) {
      console.error('Failed to load test suite:', error);
      setCurrentTestSuiteId(null);
    } finally {
      setIsTestSuiteLoading(false);
    }
  };

  // Load custom fields for the current project
  const loadCustomFields = async () => {
    if (!currentProjectId) {
      setCustomFields([]);
      return;
    }

    try {
      const fields = await customFieldsAPI.getDefinitions(currentProjectId);
      setCustomFields(fields);
    } catch (error) {
      console.error('Failed to load custom fields:', error);
      setCustomFields([]);
    }
  };

  // Generate section options for move dialog
  const generateSectionOptions = (sections: Section[], level: number = 0): React.ReactElement[] => {
    const options: React.ReactElement[] = [];
    
    sections.forEach((section) => {
      const indent = '　'.repeat(level); // Use full-width spaces for indentation
      options.push(
        <SelectItem key={section.id} value={section.name}>
          {indent}{section.name}
        </SelectItem>
      );
      
      // Add child sections recursively
      if (section.children && section.children.length > 0) {
        options.push(...generateSectionOptions(section.children, level + 1));
      }
    });
    
    return options;
  };

  // Droppable Section Component
  const DroppableSection = ({ section, children }: { section: Section; children: React.ReactNode }) => {
    const { setNodeRef, isOver } = useDroppable({
      id: `section-${section.id}`,
      data: {
        type: 'section',
        sectionId: section.id,
        sectionName: section.name
      }
    });

    const isDraggingTestCases = activeDragId !== null;
    const showDropIndicator = isDraggingTestCases && isOver;

    return (
      <div 
        ref={setNodeRef}
        className={`relative transition-all ${
          showDropIndicator 
            ? 'bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-400 ring-offset-1 rounded shadow-lg scale-[1.02]' 
            : isDraggingTestCases 
              ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded' 
              : ''
        }`}
        style={{ 
          // Ensure the droppable area covers the entire section
          minHeight: '32px',
          cursor: isDraggingTestCases ? 'copy' : 'default'
        }}
      >
        {/* Make the entire area droppable by adding a transparent overlay when dragging */}
        {isDraggingTestCases && (
          <div 
            className="absolute inset-0 z-[5]" 
            style={{ pointerEvents: 'auto' }}
          />
        )}
        
        {/* Content with lower z-index so overlay is on top when dragging */}
        <div className="relative z-[1]">
          {children}
        </div>
        
        {showDropIndicator && (
          <div className="absolute top-1 right-1 pointer-events-none z-10 bg-blue-500 text-white text-xs px-2 py-0.5 rounded shadow-lg animate-pulse">
            📥 Drop to move
          </div>
        )}
      </div>
    );
  };

  // Render section tree function
  const renderSectionTree = (sections: Section[], level: number = 0): React.ReactElement[] => {
    return sections.map((section) => {
      const isExpanded = expandedSections.has(section.id);
      const hasChildren = section.children && section.children.length > 0;
      const isRoot = level === 0;
      
      // Calculate counts correctly
      const directCount = apiTestCases.filter(tc => tc.section_id === parseInt(section.id)).length;
      const calculateCumulativeCount = (sec: Section): number => {
        let count = apiTestCases.filter(tc => tc.section_id === parseInt(sec.id)).length;
        if (sec.children && sec.children.length > 0) {
          sec.children.forEach(child => {
            count += calculateCumulativeCount(child);
          });
        }
        return count;
      };
      const cumulativeCount = calculateCumulativeCount(section);
      const hasSubsections = hasChildren && cumulativeCount > directCount;
      
      return (
        <div key={section.id} className={level > 0 ? 'ml-3 rtl:ml-0 rtl:mr-3' : ''}>
          <DroppableSection section={section}>
            <Button
              variant={selectedTestSuite === section.id ? 'default' : 'ghost'}
              className={`w-full justify-start text-xs font-normal py-1 h-auto ${level === 0 ? 'font-semibold' : 'font-normal'} ${level > 0 ? 'text-gray-600' : ''} ${
                selectedTestSuite === section.id 
                  ? 'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' 
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              onClick={() => {
                console.log('Section clicked:', section.name, 'ID:', section.id);
                setSelectedTestSuite(section.id);
                if (hasChildren) {
                  toggleSectionExpansion(section.id);
                }
              }}
            >
            <div className="flex items-center mr-1.5 rtl:mr-0 rtl:ml-1.5">
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0 rtl:rotate-180" />
                )
              ) : (
                <div className="w-3 h-3 flex-shrink-0" />
              )}
              <Folder className={`h-3.5 w-3.5 ml-0.5 rtl:ml-0 rtl:mr-0.5 flex-shrink-0 ${isRoot ? 'text-blue-500' : level === 1 ? 'text-gray-500' : 'text-gray-400'}`} />
            </div>
            <span className="flex-1 text-left rtl:text-right min-w-0 truncate" title={`${section.name}${section.test_suite_name ? ` (${section.test_suite_name})` : ''}`}>
              {level > 0 && <span className="text-gray-400 mr-1 rtl:mr-0 rtl:ml-1">└─</span>}
              {section.name}
              {level === 0 && section.test_suite_name && (
                <span className="text-xs text-gray-500 ml-1 rtl:ml-0 rtl:mr-1">({section.test_suite_name})</span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-1 flex-shrink-0">
              {hasSubsections && (
                <span 
                  className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded cursor-help" 
                  title={`Total including subsections: ${cumulativeCount}`}
                >
                  {cumulativeCount}
                </span>
              )}
              <span 
                className={`text-xs px-1.5 py-0.5 rounded cursor-help ${
                  selectedTestSuite === section.id 
                    ? 'bg-blue-100 text-blue-600 font-medium dark:bg-blue-900 dark:text-blue-300' 
                    : 'text-gray-400 bg-gray-50 dark:bg-gray-800'
                }`}
                title={`Direct test cases in this section: ${directCount}`}
              >
                {directCount}
              </span>
            </div>
          </Button>
          </DroppableSection>
          {hasChildren && isExpanded && (
            <div className="ml-1 rtl:ml-0 rtl:mr-1 border-l rtl:border-l-0 rtl:border-r border-gray-200 dark:border-gray-700 pl-1 rtl:pl-0 rtl:pr-1">
              {renderSectionTree(section.children || [], level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  const handleDeleteSection = (sectionId: string, sectionName: string) => {
    if (sectionId === 'all') {
      alert('Cannot delete the "All Test Cases" section');
      return;
    }

    if (window.confirm(`Are you sure you want to delete the section "${sectionName}" and all its subsections?`)) {
      // Find and remove the section
      const deleteSectionRecursive = (sections: Section[]): Section[] => {
        return sections.filter(section => {
          if (section.id === sectionId) {
            return false; // Remove this section
          }
          if (section.children) {
            section.children = deleteSectionRecursive(section.children);
          }
          return true;
        });
      };

      const updatedSections = deleteSectionRecursive(mockSections);
      setMockSections(updatedSections);

      // Log the activity
      const activity = {
        id: Date.now(),
        type: 'sectionDeleted',
        sectionName: sectionName,
        sectionId: sectionId,
        timestamp: new Date().toISOString(),
        user: 'Current User'
      };

      const existingActivities = JSON.parse(localStorage.getItem('recentActivities') || '[]');
      existingActivities.unshift(activity);
      localStorage.setItem('recentActivities', JSON.stringify(existingActivities.slice(0, 10)));

      // Reset selection if the deleted section was selected
      if (selectedTestSuite === sectionId) {
        setSelectedTestSuite('all');
      }

      console.log(`Section "${sectionName}" deleted successfully`);
    }
  };
  // Mock test cases (not currently used - using API data instead)
  // const mockTestCases: TestCase[] = [];

  const customFieldById = useMemo(() => {
    return customFields.reduce<Record<number, CustomFieldDefinition>>((fieldsById, field) => {
      fieldsById[field.id] = field;
      return fieldsById;
    }, {});
  }, [customFields]);

  const normalizeSearchValue = (value: unknown) => String(value ?? '').toLowerCase().trim();

  const selectedCustomFieldFilter = useMemo(() => {
    if (customFieldFilterId === CUSTOM_FIELD_FILTER_ALL) {
      return undefined;
    }

    return customFieldById[Number(customFieldFilterId)];
  }, [customFieldById, customFieldFilterId]);

  useEffect(() => {
    if (
      customFieldFilterId !== CUSTOM_FIELD_FILTER_ALL &&
      !customFields.some((field) => String(field.id) === customFieldFilterId)
    ) {
      setCustomFieldFilterId(CUSTOM_FIELD_FILTER_ALL);
      setCustomFieldFilterValue(CUSTOM_FIELD_FILTER_ANY_VALUE);
    }
  }, [customFieldFilterId, customFields]);

  const getCustomFieldOptions = (field?: CustomFieldDefinition): string[] => {
    const options = field?.options;
    if (!options) {
      return [];
    }

    if (Array.isArray(options)) {
      return options.map(String);
    }

    const optionValues = Array.isArray(options.values)
      ? options.values
      : Array.isArray(options.options)
        ? options.options
        : [];

    return optionValues.map(String);
  };

  const getTestCaseCustomFieldValue = (testCase: TestCase, fieldId: number): unknown => {
    return (testCase.custom_field_values || []).find(
      (fieldValue) => fieldValue.field_definition_id === fieldId
    )?.value;
  };

  const parseMultiSelectCustomFieldValue = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeSearchValue(item));
    }

    if (typeof value !== 'string') {
      return normalizeSearchValue(value) ? [normalizeSearchValue(value)] : [];
    }

    try {
      const parsedValue = JSON.parse(value);
      if (Array.isArray(parsedValue)) {
        return parsedValue.map((item) => normalizeSearchValue(item));
      }
    } catch {
      // Fall back to comma-separated values for legacy serialized data.
    }

    return value.split(',').map((item) => normalizeSearchValue(item)).filter(Boolean);
  };

  const isTruthyCustomFieldValue = (value: unknown): boolean => {
    return ['true', '1', 'yes', 'on'].includes(normalizeSearchValue(value));
  };

  const matchesCustomFieldFilter = (testCase: TestCase): boolean => {
    if (!selectedCustomFieldFilter) {
      return true;
    }

    const rawValue = getTestCaseCustomFieldValue(testCase, selectedCustomFieldFilter.id);
    const normalizedValue = normalizeSearchValue(rawValue);
    const normalizedFilterValue = normalizeSearchValue(customFieldFilterValue);

    if (!normalizedValue) {
      return false;
    }

    if (
      !normalizedFilterValue ||
      customFieldFilterValue === CUSTOM_FIELD_FILTER_ANY_VALUE
    ) {
      return true;
    }

    if (selectedCustomFieldFilter.field_type === 'boolean') {
      return isTruthyCustomFieldValue(rawValue) === (customFieldFilterValue === 'true');
    }

    if (selectedCustomFieldFilter.field_type === 'multiselect') {
      return parseMultiSelectCustomFieldValue(rawValue).includes(normalizedFilterValue);
    }

    if (selectedCustomFieldFilter.field_type === 'select') {
      return normalizedValue === normalizedFilterValue;
    }

    return normalizedValue.includes(normalizedFilterValue);
  };

  // Filtered and sorted test cases (client-side filtering only for search and filters)
  const filteredAndSortedTestCases = useMemo(() => {
    console.log('Filtering test cases. selectedTestSuite:', selectedTestSuite);
    // Use API data instead of mock data
    const normalizedSearchQuery = normalizeSearchValue(searchQuery);

    let filtered = apiTestCases.filter(testCase => {
      const standardSearchText = [
        testCase.title,
        testCase.description,
        testCase.reference,
        testCase.preconditions,
        testCase.steps,
        testCase.expected_result,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !normalizedSearchQuery || standardSearchText.includes(normalizedSearchQuery);
      const matchesCustomField = matchesCustomFieldFilter(testCase);
      
      const matchesType = filterType === 'all' || normalizeSearchValue(testCase.test_type) === normalizeSearchValue(filterType);
      const matchesPriority = filterPriority === 'all' || testCase.priority === filterPriority;
      const matchesSuite = selectedTestSuite === 'all' || 
                           testCase.test_suite_id === parseInt(selectedTestSuite) ||
                           testCase.section_id === parseInt(selectedTestSuite);
      
      console.log('TestCase:', testCase.title, 'suite_id:', testCase.test_suite_id, 'section_id:', testCase.section_id, 'matchesSuite:', matchesSuite);
      
      return matchesSearch && matchesCustomField && matchesType && matchesPriority && matchesSuite;
    });

    console.log('Filtered test cases count:', filtered.length);
    return filtered;
  }, [apiTestCases, searchQuery, customFieldFilterId, customFieldFilterValue, filterType, filterPriority, selectedTestSuite, selectedCustomFieldFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, customFieldFilterId, customFieldFilterValue, filterType, filterPriority, selectedTestSuite]);

  // Pagination logic using filtered data
  const totalPages = Math.ceil(filteredAndSortedTestCases.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filteredAndSortedTestCases.length);
  const paginatedTestCases = filteredAndSortedTestCases.slice(startIndex, startIndex + itemsPerPage);

  // Validation functions
  const validateField = (field: string, value: any): string => {
    switch (field) {
      case 'title':
        if (!value || !value.trim()) {
          return 'Test case title is required';
        }
        if (value.trim().length < 3) {
          return 'Title must be at least 3 characters long';
        }
        return '';
      case 'test_type':
        if (!value) {
          return 'Test type is required';
        }
        return '';
      case 'priority':
        if (!value) {
          return 'Priority is required';
        }
        return '';
      default:
        return '';
    }
  };

  const validateCustomField = (field: CustomFieldDefinition, value: any): string => {
    if (field.is_required && (!value || (typeof value === 'string' && !value.trim()))) {
      return `${field.name} is required`;
    }
    
    if (field.field_type === 'number' && value && isNaN(Number(value))) {
      return `${field.name} must be a valid number`;
    }
    
    if (field.field_type === 'select' && value && field.options) {
      const options = field.options as string[];
      if (!options.includes(value)) {
        return `${field.name} must be one of: ${options.join(', ')}`;
      }
    }
    
    return '';
  };

  const validateAllFields = (): boolean => {
    const errors: Record<string, string> = {};
    
    // Validate standard fields
    const titleError = validateField('title', testCaseForm.title);
    if (titleError) errors.title = titleError;
    
    const typeError = validateField('test_type', testCaseForm.test_type);
    if (typeError) errors.test_type = typeError;
    
    const priorityError = validateField('priority', testCaseForm.priority);
    if (priorityError) errors.priority = priorityError;
    
    // Validate custom fields
    customFields.forEach(field => {
      const error = validateCustomField(field, customFieldValues[field.id]);
      if (error) errors[`custom_${field.id}`] = error;
    });
    
    setValidationErrors(errors);
    
    // Focus on first field with error if validation fails
    if (Object.keys(errors).length > 0) {
      const firstErrorField = Object.keys(errors)[0];
      
      setTimeout(() => {
        if (firstErrorField === 'title' && titleInputRef.current) {
          titleInputRef.current.focus();
        } else if (firstErrorField === 'test_type' && testTypeRef.current) {
          testTypeRef.current.focus();
        } else if (firstErrorField === 'priority' && priorityRef.current) {
          priorityRef.current.focus();
        } else if (firstErrorField.startsWith('custom_')) {
          const fieldId = parseInt(firstErrorField.replace('custom_', ''));
          const customFieldRef = customFieldRefs.current[fieldId];
          if (customFieldRef) {
            customFieldRef.focus();
          }
        }
      }, 100);
    }
    
    return Object.keys(errors).length === 0;
  };

  // Real-time validation handlers
  const handleTitleChange = (value: string) => {
    setTestCaseForm(prev => ({ ...prev, title: value }));
    const error = validateField('title', value);
    setValidationErrors(prev => ({
      ...prev,
      title: error
    }));
  };

  const handleTestTypeChange = (value: string) => {
    setTestCaseForm(prev => ({ ...prev, test_type: value }));
    const error = validateField('test_type', value);
    setValidationErrors(prev => ({
      ...prev,
      test_type: error
    }));
  };

  const handlePriorityChange = (value: string) => {
    setTestCaseForm(prev => ({ ...prev, priority: value }));
    const error = validateField('priority', value);
    setValidationErrors(prev => ({
      ...prev,
      priority: error
    }));
  };

  const handleFieldChange = (field: keyof typeof testCaseForm, value: string) => {
    setTestCaseForm(prev => ({ ...prev, [field]: value }));
  };

  const handleCustomFieldChange = (fieldId: number, value: any) => {
    setCustomFieldValues(prev => ({
      ...prev,
      [fieldId]: value
    }));
    
    const field = customFields.find(f => f.id === fieldId);
    if (field) {
      const error = validateCustomField(field, value);
      setValidationErrors(prev => ({
        ...prev,
        [`custom_${fieldId}`]: error
      }));
    }
  };

  // Multistep handlers
  const handleMultistepToggle = (isMultistep: boolean) => {
    setTestCaseForm(prev => ({ ...prev, is_multistep: isMultistep }));
    if (isMultistep && testSteps.length === 0) {
      // Initialize with one empty step
      setTestSteps([{
        step_number: 1,
        action: '',
        expected_result: '',
        step_type: 'manual'
      }]);
    }
  };

  const handleAddStep = () => {
    const newStepNumber = testSteps.length + 1;
    setTestSteps(prev => [...prev, {
      step_number: newStepNumber,
      action: '',
      expected_result: '',
      step_type: 'manual'
    }]);
  };

  const handleRemoveStep = (stepNumber: number) => {
    setTestSteps(prev => {
      const filtered = prev.filter(step => step.step_number !== stepNumber);
      // Renumber remaining steps
      return filtered.map((step, index) => ({
        ...step,
        step_number: index + 1
      }));
    });
  };

  const handleStepChange = (stepNumber: number, field: 'action' | 'expected_result' | 'step_type', value: string) => {
    setTestSteps(prev => prev.map(step => 
      step.step_number === stepNumber 
        ? { ...step, [field]: value }
        : step
    ));
  };

  // Requirements linking functions
  const loadAvailableRequirements = async () => {
    try {
      const requirements = await requirementsAPI.getAll(currentProjectId ?? undefined);
      setAvailableRequirements(requirements.map((req: any) => ({
        id: req.id.toString(),
        title: req.title,
        reference: req.requirement_id || req.id.toString()
      })));
    } catch (error) {
      console.error('Failed to load requirements:', error);
      // Fallback to empty array if API fails
      setAvailableRequirements([]);
    }
  };

  // Shared steps functions
  const loadAvailableSharedSteps = async () => {
    try {
      setLoadingSharedSteps(true);
      const token = localStorage.getItem('token');
      if (!token) {
        console.log('No authentication token');
        return;
      }

      const url = projectId 
        ? `${API_BASE_URL}/shared-steps/?project_id=${projectId}`
        : `${API_BASE_URL}/shared-steps/`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load shared steps');
      }

      const data = await response.json();
      setAvailableSharedSteps(data);
    } catch (error) {
      console.error('Failed to load shared steps:', error);
      setAvailableSharedSteps([]);
    } finally {
      setLoadingSharedSteps(false);
    }
  };

  const handleInsertSharedStep = async (sharedStep: any) => {
    // Add the shared step to test steps
    const newStepNumber = testSteps.length + 1;
    setTestSteps(prev => [...prev, {
      step_number: newStepNumber,
      action: sharedStep.action,
      expected_result: sharedStep.expected_result,
      step_type: 'manual'
    }]);

    // Increment usage count
    try {
      const token = localStorage.getItem('token');
      if (token) {
        await fetch(`${API_BASE_URL}/shared-steps/${sharedStep.id}/increment-usage`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (error) {
      console.error('Failed to increment usage count:', error);
    }

    toast({
      title: t('sharedStepAdded'),
      description: t('sharedStepAddedDescription', {name: sharedStep.name}),
    });
  };

  const filteredSharedSteps = availableSharedSteps.filter(step =>
    step.name.toLowerCase().includes(sharedStepSearchQuery.toLowerCase()) ||
    step.description?.toLowerCase().includes(sharedStepSearchQuery.toLowerCase())
  );

  const handleLinkRequirement = (requirement: {id: string, title: string, reference: string}) => {
    if (!linkedRequirements.find(req => req.id === requirement.id)) {
      setLinkedRequirements(prev => [...prev, requirement]);
    }
  };

  const handleUnlinkRequirement = (requirementId: string) => {
    setLinkedRequirements(prev => prev.filter(req => req.id !== requirementId));
  };

  const filteredRequirements = availableRequirements.filter(req =>
    req.title.toLowerCase().includes(requirementSearchQuery.toLowerCase()) ||
    req.reference.toLowerCase().includes(requirementSearchQuery.toLowerCase())
  );

  // Proper state cleanup when modal closes
  const handleCloseModal = () => {
    // Check for unsaved changes
    const hasChanges = 
      testCaseForm.title.trim() !== '' ||
      testCaseForm.description.trim() !== '' ||
      testCaseForm.reference.trim() !== '' ||
      testCaseForm.test_type !== '' ||
      testCaseForm.execution_type !== '' ||
      testCaseForm.preconditions.trim() !== '' ||
      testCaseForm.steps.trim() !== '' ||
      testCaseForm.expected_result.trim() !== '' ||
      testCaseForm.environment.trim() !== '' ||
      testSteps.length > 0 ||
      linkedRequirements.length > 0 ||
      Object.keys(customFieldValues).length > 0;
    
    if (hasChanges) {
      setShowUnsavedDialog(true);
      return;
    }
    
    // Reset all form state with default priority from database
    const defaultPriority = dbPriorities.find((p: any) => p.is_default);
    const defaultPriorityValue = defaultPriority 
      ? defaultPriority.name.toLowerCase() 
      : (priorityOptions.length > 0 ? priorityOptions[0].value : 'medium');
    
    setTestCaseForm({
      title: '',
      description: '',
      reference: '',
      test_type: '',
      execution_type: '',
      priority: defaultPriorityValue,
      preconditions: '',
      steps: '',
      expected_result: '',
      environment: '',
      is_multistep: false
    });
    setCustomFieldValues({});
    setLinkedRequirements([]);
    setValidationErrors({});
    setIsDialogOpen(false);
    setHasUnsavedChanges(false);
    
    // Clear any pending timeouts or async operations
    setIsModalOpening(false);
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      // Reset all form state with default priority from database
      const defaultPriority = dbPriorities.find((p: any) => p.is_default);
      const defaultPriorityValue = defaultPriority 
        ? defaultPriority.name.toLowerCase() 
        : (priorityOptions.length > 0 ? priorityOptions[0].value : 'medium');
      
      setTestCaseForm({
        title: '',
        description: '',
        reference: '',
        test_type: '',
        execution_type: '',
        priority: defaultPriorityValue,
        preconditions: '',
        steps: '',
        expected_result: '',
        environment: '',
        is_multistep: false
      });
      setCustomFieldValues({});
      setLinkedRequirements([]);
      setValidationErrors({});
      setIsDialogOpen(false);
      setHasUnsavedChanges(false);
      setIsModalOpening(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateTestCase();
    }
  };

  const handleCreateTestCase = async () => {
    if (!currentProjectId) {
      toast({
        title: t('error'),
        description: t('noProjectSelected'),
        variant: "destructive",
      });
      return;
    }

    if (!currentTestSuiteId) {
      toast({
        title: t('error'),
        description: t('noTestSuiteFound'),
        variant: "destructive",
      });
      return;
    }

    // Validate all fields before submission
    if (!validateAllFields()) {
      toast({
        title: t('validationError'),
        description: t('fixValidationErrorsBeforeCreating'),
        variant: "destructive",
      });
      return;
    }

    // Get the selected section ID
    let sectionId: number | undefined = undefined;
    if (selectedTestSuite !== 'all') {
      sectionId = parseInt(selectedTestSuite);
    }

    const newTestCase = {
      title: testCaseForm.title,
      description: testCaseForm.description,
      reference: testCaseForm.reference,
      preconditions: testCaseForm.preconditions,
      steps: testCaseForm.steps,
      expected_result: testCaseForm.expected_result,
      test_type: testCaseForm.test_type,
      priority: testCaseForm.priority as 'low' | 'medium' | 'high' | 'critical',
      environment: testCaseForm.environment, // Add environment field
      status: 'active' as const,
      test_suite_id: currentTestSuiteId,
      section_id: sectionId, // Add the selected section
      requirements: linkedRequirements, // Add linked requirements
      is_multistep: testCaseForm.is_multistep, // Add multistep flag
      test_steps: testCaseForm.is_multistep ? testSteps : undefined // Add steps if multistep
    };

    try {
      setIsCreating(true);

      console.log('Creating test case:', newTestCase);

      // Call the real API (test_steps are included in the request)
      const createdTestCase = await testCasesAPI.create(newTestCase);
      const customFieldValueRequests = Object.entries(customFieldValues)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([fieldDefinitionId, value]) => customFieldsAPI.createValue({
          field_definition_id: Number(fieldDefinitionId),
          test_case_id: createdTestCase.id,
          value: String(value),
        }));

      if (customFieldValueRequests.length > 0) {
        await Promise.all(customFieldValueRequests);
      }
      
      // Reset form fields
      setTestCaseForm({
        title: '',
        description: '',
        reference: '',
        test_type: '',
        execution_type: '',
        priority: 'medium',
        preconditions: '',
        steps: '',
        expected_result: '',
        environment: '',
        is_multistep: false
      });
      setTestSteps([]);
      setCustomFieldValues({});
      setLinkedRequirements([]);
      setValidationErrors({});
      setIsDialogOpen(false);
      setHasUnsavedChanges(false);
      setIsModalOpening(false);
      
      toast({
        title: t('success'),
        description: t('testCaseCreatedSuccessfully', {section: sectionId ? getSelectedSectionName() : t('noSection')}),
      });
      
      // Refresh the test cases list and sections
      await loadTestCases();
      await loadSections();
    } catch (error) {
      console.error('Error creating test case:', error);
      toast({
        title: t('error'),
        description: t('failedToCreateTestCase'),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Helper function to get selected section name
  const getSelectedSectionName = () => {
    if (selectedTestSuite === 'all') return 'no section';
    
    const findSection = (sections: Section[], sectionId: string): string | null => {
      for (const section of sections) {
        if (section.id === sectionId) return section.name;
        if (section.children) {
          const found = findSection(section.children, sectionId);
          if (found) return found;
        }
      }
      return null;
    };
    
    return findSection(mockSections, selectedTestSuite) || 'unknown section';
  };

  // Helper function to build breadcrumb path for selected section
  const getBreadcrumbPath = (): string[] => {
    if (selectedTestSuite === 'all') return [];
    
    const buildPath = (sections: Section[], targetId: string, path: string[] = []): string[] | null => {
      for (const section of sections) {
        if (section.id === targetId) {
          return [...path, section.name];
        }
        if (section.children) {
          const found = buildPath(section.children, targetId, [...path, section.name]);
          if (found) return found;
        }
      }
      return null;
    };
    
    return buildPath(mockSections, selectedTestSuite) || [];
  };

  const handleExportSelected = async () => {
    if (selectedTestCases.length === 0) {
      toast({
        title: t('noSelection'),
        description: t('pleaseSelectAtLeastOneToExport'),
        variant: "destructive",
      });
      return;
    }

    try {
      // Get the selected test cases data and fill relations that are not always present in list responses.
      const selectedTestData = await Promise.all(
        apiTestCases
          .filter(tc => selectedTestCases.includes(tc.id))
          .map(async (tc) => {
            const [testSteps, customFieldValues] = await Promise.all([
              tc.is_multistep ? testCasesAPI.getSteps(tc.id).catch(() => tc.test_steps || []) : Promise.resolve(tc.test_steps || []),
              tc.custom_field_values?.length ? Promise.resolve(tc.custom_field_values) : customFieldsAPI.getValues(tc.id).catch(() => []),
            ]);
            return { ...tc, test_steps: testSteps, custom_field_values: customFieldValues };
          })
      );
      const exportCustomFields = customFields.length > 0
        ? customFields
        : currentProjectId
          ? await customFieldsAPI.getDefinitions(currentProjectId).catch(() => [])
          : [];
      
      const csvEscape = (value: unknown) => {
        const text = value === null || value === undefined ? '' : String(value);
        return `"${text.replace(/"/g, '""')}"`;
      };

      // Keep selected exports compatible with the CSV import mapper and backend export.
      const baseCsvHeaders = [
        'id', 'title', 'description', 'test_type', 'preconditions', 'steps', 'expected_result',
        'priority', 'status', 'reference', 'tags', 'test_suite_id', 'section_id', 'order_index',
        'is_multistep', 'multistep_data', 'created_at', 'updated_at'
      ];
      const usedHeaders = new Set(baseCsvHeaders);
      const customFieldHeaders = exportCustomFields.map((field) => {
        let header = field.name?.trim() || field.slug || `custom_field_${field.id}`;
        if (usedHeaders.has(header)) {
          header = field.slug || `${header}_${field.id}`;
        }
        while (usedHeaders.has(header)) {
          header = `${header}_${field.id}`;
        }
        usedHeaders.add(header);
        return { field, header };
      });
      const csvHeaders = [...baseCsvHeaders, ...customFieldHeaders.map(({ header }) => header)];
      const csvRows = selectedTestData.map(tc => [
        ...[
          tc.id,
          tc.title,
          tc.description || '',
          tc.test_type || 'manual',
          tc.preconditions || '',
          tc.steps || '',
          tc.expected_result || '',
          tc.priority || 'medium',
          tc.status || 'active',
          tc.reference || '',
          tc.tags || '',
          tc.test_suite_id || currentTestSuiteId || '',
          tc.section_id || '',
          tc.order_index || 0,
          tc.is_multistep ? 'true' : 'false',
          tc.test_steps?.length ? JSON.stringify(tc.test_steps) : '',
          tc.created_at || '',
          tc.updated_at || ''
        ],
        ...customFieldHeaders.map(({ field }) => (
          tc.custom_field_values?.find((value) => value.field_definition_id === field.id)?.value || ''
        )),
      ].map(csvEscape));
      
      const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
      
      // Create a blob and download the file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `selected_test_cases_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: t('exportComplete'),
        description: t('successfullyExportedTestCases', {count: selectedTestCases.length}),
      });
      
      // Clear selection after export
      setSelectedTestCases([]);
      setSelectAll(false);
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: t('exportFailed'),
        description: t('failedToExportSelectedTestCases'),
        variant: "destructive",
      });
    }
  };

  const handleExportCSV = async () => {
    if (!currentTestSuiteId) {
      toast({
        title: t('exportFailed'),
        description: t('selectTestSuite'),
        variant: "destructive",
      });
      return;
    }

    try {
      // Export test cases for the current test suite (project)
      const result = await importExportAPI.exportTestCases(currentTestSuiteId, 'csv');
      
      // Create a blob and download the file
      const blob = new Blob([result.content], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || 'test_cases.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: t('exportComplete'),
        description: result.truncated
          ? t('exportLimitedToRows', { count: result.total_rows || 0 })
          : t('testCasesExportedSuccessfully'),
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: t('exportFailed'),
        description: t('failedToExportTestCases'),
        variant: "destructive",
      });
    }
  };

  const handleImportClick = () => {
    if (urlSectionId) {
      setImportSectionId(urlSectionId);
    } else {
      setImportSectionId(selectedTestSuite === 'all' ? 'none' : selectedTestSuite);
    }
    setIsImportDialogOpen(true);
    void loadCustomFields();
  };

  const handleImportFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      event.target.value = '';
      toast({
        title: t('invalidFileType'),
        description: t('pleaseSelectCSVFile'),
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      event.target.value = '';
      toast({
        title: t('fileTooLarge'),
        description: t('pleaseSelectCSVFileSmallerThan10MB'),
        variant: "destructive",
      });
      return;
    }

    setImportFile(file);
  }, [t, toast]);

  // Bulk actions
  const handleSelectAll = (checked: boolean | "indeterminate") => {
    const isChecked = checked === true;
    setSelectAll(isChecked);
    if (isChecked) {
      setSelectedTestCases(paginatedTestCases.map(tc => tc.id));
    } else {
      setSelectedTestCases([]);
    }
  };

  const handleSelectTestCase = (testCaseId: number, checked: boolean) => {
    if (checked) {
      setSelectedTestCases(prev => [...prev, testCaseId]);
    } else {
      setSelectedTestCases(prev => prev.filter(id => id !== testCaseId));
      setSelectAll(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTestCases.length === 0) return;
    
    try {
      // Delete all selected test cases
      const deletePromises = selectedTestCases.map(testCaseId => 
        testCasesAPI.delete(testCaseId)
      );
      
      await Promise.all(deletePromises);
      
      // Remove from local state
      setApiTestCases(prev => prev.filter(tc => !selectedTestCases.includes(tc.id)));
      
      toast({
        title: t('success'),
        description: t('deletedTestCasesSuccessfully', {count: selectedTestCases.length}),
      });
      
      // Clear selection
      setSelectedTestCases([]);
      setSelectAll(false);
      
      // Reload data to refresh counts
      await loadTestCases();
      await loadSections();
    } catch (error) {
      console.error('Failed to delete test cases:', error);
      toast({
        title: t('error'),
        description: t('failedToDeleteSomeTestCases'),
        variant: "destructive",
      });
    }
  };

  const handleBulkExecute = async () => {
    if (selectedTestCases.length === 0) return;
    
    if (projectId) {
      try {
        // Create a new test run for the selected test cases
        const newRun = await testRunsAPI.create({
          name: `Bulk Execution - ${selectedTestCases.length} test cases`,
          description: `Execution run for ${selectedTestCases.length} selected test cases`,
          project_id: parseInt(projectId),
          status: 'in_progress',
          priority: 'medium',
        });

        // Create test results for all selected test cases
        await Promise.all(
          selectedTestCases.map(testCaseId =>
            testResultsAPI.create({
              test_run_id: newRun.id,
              test_case_id: testCaseId,
              status: 'pending',
              actual_result: '',
              comments: '',
            })
          )
        );

        // Navigate to execute the first test case
        const firstTestCaseId = selectedTestCases[0];
        navigate(`/projects/${projectId}/test-runs/${newRun.id}/test-cases/${firstTestCaseId}`);
      } catch (error) {
        console.error('Failed to create test run for bulk execution:', error);
        toast({
          title: t('error'),
          description: t('failedToCreateRunForExecution'),
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: t('error'),
        description: t('pleaseSelectProjectFirstToExecute'),
        variant: "destructive",
      });
    }
  };

// ... (rest of the code remains the same)
  // Individual actions
  const handleEdit = async (testCase: TestCase) => {
    setEditingTestCase(testCase);
    setTestCaseForm({
      title: testCase.title,
      description: testCase.description || '',
      reference: '', // Reference not available in TestCase type yet
      test_type: testCase.test_type,
      execution_type: '', // execution_type not available in TestCase type yet
      priority: testCase.priority,
      preconditions: testCase.preconditions || '',
      steps: testCase.steps || '',
      expected_result: testCase.expected_result || '',
      environment: '', // Environment not available in TestCase type yet
      is_multistep: testCase.is_multistep || false
    });

    const existingCustomFieldValues = (testCase.custom_field_values || []).reduce<Record<string, any>>((values, fieldValue) => {
      values[fieldValue.field_definition_id] = fieldValue.value;
      return values;
    }, {});
    setCustomFieldValues(existingCustomFieldValues);

    // Load steps if multistep
    if (testCase.is_multistep) {
      try {
        const steps = await testCasesAPI.getSteps(testCase.id);
        setTestSteps(steps);
      } catch (error) {
        console.error('Failed to load test case steps:', error);
        setTestSteps([]);
      }
    } else {
      setTestSteps([]);
    }

    setEditDialogOpen(true);
  };

  const handleExecute = (testCase: TestCase) => {
    if (projectId) {
      navigate(`/projects/${projectId}/test-cases/${testCase.id}/execute`);
    } else {
      navigate(`/test-cases/${testCase.id}/execute`);
    }
  };

  // Helper function to translate field names
  const translateFieldName = (fieldName: string) => {
    const fieldTranslations: Record<string, string> = {
      'title': t('fieldTitle'),
      'is_multistep': t('fieldIsMultistep'),
      'description': t('fieldDescription'),
      'priority': t('fieldPriority'),
      'test_type': t('fieldTestType'),
      'preconditions': t('fieldPreconditions'),
      'steps': t('fieldSteps'),
      'expected_result': t('fieldExpectedResult'),
      'environment': t('fieldEnvironment'),
    };
    return fieldTranslations[fieldName] || fieldName;
  };

  const handleViewHistory = async (testCase: TestCase) => {
    setSelectedTestCaseForHistory(testCase);
    setHistoryDialogOpen(true);
    setIsLoadingRevisions(true);
    
    try {
      const { api } = await import('@/lib/api');
      const response = await api.get(`/test-cases/${testCase.id}/revisions`);
      setRevisions(response.data || []);
    } catch (error) {
      console.error('Failed to load revision history:', error);
      setRevisions([]);
    } finally {
      setIsLoadingRevisions(false);
    }
  };

  const handleCompareRevision = (revision: any) => {
    // Navigate to revisions page
    if (selectedTestCaseForHistory && projectId) {
      navigate(`/projects/${projectId}/test-cases/${selectedTestCaseForHistory.id}/revisions`);
    } else if (selectedTestCaseForHistory) {
      navigate(`/test-cases/${selectedTestCaseForHistory.id}/revisions`);
    }
  };

  const handleRestoreRevision = async (revision: any) => {
    if (!selectedTestCaseForHistory) return;
    
    if (window.confirm(t('confirmRestoreRevision') || `Are you sure you want to restore revision ${revision.revision_number}?`)) {
      try {
        const { api } = await import('@/lib/api');
        await api.post(`/test-cases/${selectedTestCaseForHistory.id}/revisions/${revision.revision_number}/restore`);
        toast({
          title: t('success') || 'Success',
          description: t('revisionRestored') || `Revision ${revision.revision_number} restored successfully`,
        });
        // Reload the test case data
        loadTestCases();
        setHistoryDialogOpen(false);
      } catch (error) {
        console.error('Failed to restore revision:', error);
        toast({
          title: t('error') || 'Error',
          description: t('failedToRestoreRevision') || 'Failed to restore revision',
          variant: 'destructive',
        });
      }
    }
  };

  const handleCreateSection = async () => {
    if (!currentTestSuiteId) {
      toast({
        title: t('error'),
        description: t('noTestSuiteFound'),
        variant: "destructive",
      });
      return;
    }

    try {
      console.log('Creating section:', {
        name: newSectionName,
        parent_id: newSectionParentId === 'none' ? null : newSectionParentId
      });
      
      // Create the section via API
      const newSection = await sectionsAPI.create({
        name: newSectionName,
        test_suite_id: currentTestSuiteId,
        parent_section_id: newSectionParentId === 'none' ? undefined : parseInt(newSectionParentId)
      });
      
      console.log('Section created successfully:', newSection);
      
      // Reset form and close dialog
      setNewSectionName('');
      setNewSectionParentId('none');
      setSectionDialogOpen(false);
      
      // Immediately refresh sections to show the new section
      await loadSections();
      
      // Show success message
      toast({
        title: t('sectionCreated'),
        description: t('sectionCreatedSuccessfully', {name: newSection.name}),
      });
      
    } catch (error) {
      console.error('Failed to create section:', error);
      toast({
        title: t('error'),
        description: t('failedToCreateSection'),
        variant: "destructive",
      });
    }
  };

  const handleCreateTestSuiteForProject = async () => {
    const trimmedSuiteName = suiteName.trim();

    if (!currentProjectId) {
      toast({
        title: t('error'),
        description: t('noProjectSelected'),
        variant: "destructive",
      });
      return;
    }

    if (!trimmedSuiteName) {
      toast({
        title: t('validationError'),
        description: t('pleaseEnterASuiteName'),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreatingSuite(true);

      const createdSuite = await testSuitesAPI.create({
        name: trimmedSuiteName,
        description: suiteDescription.trim() || undefined,
        project_id: currentProjectId,
        status: 'active',
      });

      setCurrentTestSuiteId(createdSuite.id);
      setSuiteName('');
      setSuiteDescription('');
      setIsSuiteDialogOpen(false);

      toast({
        title: t('success'),
        description: t('testSuiteCreatedSuccessfully'),
      });

      await loadTestSuite();
      await loadSections();
      await loadTestCases();
    } catch (error) {
      console.error('Failed to create test suite:', error);
      toast({
        title: t('error'),
        description: t('failedToCreateTestSuiteRetry'),
        variant: "destructive",
      });
    } finally {
      setIsCreatingSuite(false);
    }
  };

  const toggleSectionExpansion = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const handleDelete = async (testCaseId: number) => {
    try {
      // Add actual API call to delete test case
      await testCasesAPI.delete(testCaseId);
      
      // Remove from local state
      setApiTestCases(prev => prev.filter(tc => tc.id !== testCaseId));
      
      toast({
        title: t('success'),
        description: t('testCaseDeletedSuccessfully'),
      });
      
      // Reload data to refresh counts
      await loadTestCases();
      await loadSections();
    } catch (error) {
      console.error('Failed to delete test case:', error);
      toast({
        title: t('error'),
        description: t('failedToDeleteTestCase'),
        variant: "destructive",
      });
    }
  };

  const handleUpdateTestCase = async () => {
    if (!editingTestCase) return;

    try {
      // Cast the form data to match TestCase type requirements
      const updateData = {
        ...testCaseForm,
        priority: testCaseForm.priority as 'low' | 'medium' | 'high' | 'critical'
      };
      const updatedTestCase = await testCasesAPI.update(editingTestCase.id, updateData);

      // Handle steps: if multistep, always sync steps (including empty array to clear)
      // If not multistep, send empty array to clear any existing steps
      if (testCaseForm.is_multistep) {
        await testCasesAPI.createWithSteps(editingTestCase.id, testSteps);
      } else {
        await testCasesAPI.createWithSteps(editingTestCase.id, []);
      }

      // Update local state
      setApiTestCases(prev => prev.map(tc =>
        tc.id === editingTestCase.id ? { ...tc, ...updatedTestCase } : tc
      ));

      setEditDialogOpen(false);
      setEditingTestCase(null);
      setTestCaseForm({
        title: '',
        description: '',
        reference: '',
        test_type: '',
        execution_type: '',
        priority: 'medium',
        preconditions: '',
        steps: '',
        expected_result: '',
        environment: '',
        is_multistep: false
      });
      setTestSteps([]);

      toast({
        title: t('success'),
        description: t('testCaseUpdatedSuccessfully'),
      });

      // Reload data to refresh counts
      await loadTestCases();
      await loadSections();
    } catch (error) {
      console.error('Failed to update test case:', error);
      toast({
        title: t('error'),
        description: t('failedToUpdateTestCase'),
        variant: "destructive",
      });
    }
  };

  const handleMoveTestCase = (testCase: TestCase) => {
    setSelectedTestCaseToMove(testCase);
    setDestinationSection(testCase.section || '');
    setMoveDialogOpen(true);
  };

  const handleConfirmMove = () => {
    if (!selectedTestCaseToMove || !destinationSection) return;
    
    // Log the activity
    const activity = {
      id: Date.now(),
      type: 'testCaseMoved',
      testCaseTitle: selectedTestCaseToMove.title,
      sectionName: destinationSection,
      timestamp: new Date().toISOString(),
      user: 'Current User'
    };
    
    const existingActivities = JSON.parse(localStorage.getItem('recentActivities') || '[]');
    existingActivities.unshift(activity);
    localStorage.setItem('recentActivities', JSON.stringify(existingActivities.slice(0, 10)));
    
    setMoveDialogOpen(false);
    setSelectedTestCaseToMove(null);
    setDestinationSection('');
    
    // Show success message
    alert(`Test case "${selectedTestCaseToMove.title}" moved to "${destinationSection}"`);
  };

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as number);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (over && over.data.current?.type === 'section') {
      setDragOverSectionId(over.data.current.sectionId);
    } else {
      setDragOverSectionId(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveDragId(null);
    setDragOverSectionId(null);

    if (!over) return;

    // Check if dropping on a section
    if (over.data.current?.type === 'section') {
      const sectionId = over.data.current.sectionId;
      const sectionName = over.data.current.sectionName;
      
      // Get test cases to move (either selected ones or just the dragged one)
      const testCasesToMove = selectedTestCases.length > 0 && selectedTestCases.includes(active.id as number)
        ? selectedTestCases
        : [active.id as number];
      
      console.log(`Moving ${testCasesToMove.length} test case(s) to section: ${sectionName}`);
      
      try {
        // Move each test case to the new section
        for (const testCaseId of testCasesToMove) {
          const testCase = apiTestCases.find(tc => tc.id === testCaseId);
          if (testCase) {
            await testCasesAPI.update(testCaseId, {
              ...testCase,
              section_id: parseInt(sectionId)
            });
          }
        }
        
        toast({
          title: t('success'),
          description: t('movedTestCasesSuccessfully', {count: testCasesToMove.length, sectionName}),
        });
        
        // Reload test cases and sections
        await loadTestCases();
        await loadSections();
        
        // Clear selection
        setSelectedTestCases([]);
        setSelectAll(false);
        
      } catch (error) {
        console.error('Failed to move test cases:', error);
        toast({
          title: t('error'),
          description: t('failedToMoveTestCases'),
          variant: "destructive",
        });
      }
      
      return;
    }

    // Original reordering logic (when not dropping on a section)
    if (active.id !== over.id) {
      const oldIndex = apiTestCases.findIndex((item) => item.id === active.id);
      const newIndex = apiTestCases.findIndex((item) => item.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const movedTestCase = apiTestCases[oldIndex];
        const targetTestCase = apiTestCases[newIndex];
        
        // Log the drag and drop activity
        const activity = {
          id: Date.now(),
          action: 'moved',
          testCaseId: movedTestCase.id,
          testCaseTitle: movedTestCase.title,
          fromPosition: oldIndex + 1,
          toPosition: newIndex + 1,
          timestamp: new Date().toISOString(),
          user: 'Current User'
        };

        const existingActivities = JSON.parse(localStorage.getItem('recentActivities') || '[]');
        existingActivities.unshift(activity);
        localStorage.setItem('recentActivities', JSON.stringify(existingActivities.slice(0, 10)));
        
        // Reorder the array (in real app, this would be an API call)
        const reorderedTestCases = arrayMove(apiTestCases, oldIndex, newIndex);
        
        // Update the test cases array
        setApiTestCases(reorderedTestCases);
        
        // Force re-render by updating state
        setSelectedTestSuite(prev => prev === 'all' ? 'all' : selectedTestSuite);
        
        console.log(`Test case "${movedTestCase.title}" moved from position ${oldIndex + 1} to ${newIndex + 1}`);
      }
    }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('testCasesTitle')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('testCasesDescription')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadTestCases} title="Refresh test cases">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setSectionDialogOpen(true)}>
            <FolderPlus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('newSection')}
          </Button>
          <Button variant="outline" onClick={handleExportCSV}>
            <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('exportCSV')}
          </Button>
          <Button variant="outline" onClick={handleImportClick}>
            <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('importCSV')}
          </Button>
          {isTestSuiteLoading ? (
            <Button disabled>
              {t('loading')}
            </Button>
          ) : !currentTestSuiteId ? (
            <Dialog open={isSuiteDialogOpen} onOpenChange={setIsSuiteDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('createTestSuite')}
                </Button>
              </DialogTrigger>
              <DialogContent isRTL={isRTL} className={`sm:max-w-[600px] ${isRTL ? 'font-vazir' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
                <DialogHeader>
                  <DialogTitle>{t('createNewTestSuite')}</DialogTitle>
                  <DialogDescription>
                    {t('noTestSuiteFound')}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="suite-name" className={`text-right ${isRTL ? 'text-left' : ''}`}>
                      {t('suiteName')} <span className="text-red-500">*</span>
                    </Label>
                    <div className="col-span-3 space-y-1">
                      <Input
                        id="suite-name"
                        value={suiteName}
                        onChange={(event) => setSuiteName(event.target.value)}
                        placeholder={t('enterSuiteName')}
                        maxLength={200}
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{t('enterSuiteName')}</span>
                        <span>{suiteName.length}/200</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-start gap-4">
                    <Label htmlFor="suite-description" className={`text-right ${isRTL ? 'text-left' : ''}`}>
                      {t('suiteDescription')}
                    </Label>
                    <Textarea
                      id="suite-description"
                      value={suiteDescription}
                      onChange={(event) => setSuiteDescription(event.target.value)}
                      placeholder={t('enterSuiteDescription')}
                      className="col-span-3"
                      rows={3}
                      maxLength={500}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsSuiteDialogOpen(false)}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={handleCreateTestSuiteForProject} disabled={!suiteName.trim() || isCreatingSuite}>
                    {isCreatingSuite ? t('creating') : t('createTestSuite')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
            if (!open) {
              // Check for unsaved changes before closing
              const hasChanges = 
                testCaseForm.title.trim() !== '' ||
                testCaseForm.description.trim() !== '' ||
                testCaseForm.reference.trim() !== '' ||
                testCaseForm.test_type !== '' ||
                testCaseForm.execution_type !== '' ||
                testCaseForm.preconditions.trim() !== '' ||
                testCaseForm.steps.trim() !== '' ||
                testCaseForm.expected_result.trim() !== '' ||
                testCaseForm.environment.trim() !== '' ||
                testSteps.length > 0 ||
                linkedRequirements.length > 0 ||
                Object.keys(customFieldValues).length > 0;
              
              if (hasChanges) {
                setShowUnsavedDialog(true);
                return; // Prevent dialog from closing
              }
              
              handleCloseModal();
            } else {
              handleOpenModal();
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('addNewTestCase')}
              </Button>
            </DialogTrigger>
            <DialogContent isRTL={isRTL} className={`sm:max-w-[900px] max-h-[80vh] overflow-y-auto ${isRTL ? 'font-vazir' : ''}`} onKeyDown={handleKeyDown}>
              <DialogHeader>
                <DialogTitle>{t('createNewTestCase')}</DialogTitle>
                <DialogDescription>
                  {t('createTestCaseDescription')}
                </DialogDescription>
                {selectedTestSuite !== 'all' && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-700">
                    <span className="text-sm text-blue-700 dark:text-blue-300">
                      📁 {t('testCaseWillBeAddedTo')} <strong>{getSelectedSectionName()}</strong>
                    </span>
                  </div>
                )}
              </DialogHeader>
              <div className="grid gap-6 py-4">
                {/* Basic Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">{t('basicInformation')}</h3>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="title" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('testCaseTitle')}</Label>
                    <div className="col-span-3 space-y-1">
                      <Input 
                        id="title" 
                        ref={titleInputRef}
                        value={testCaseForm.title} 
                        onChange={(e) => handleTitleChange(e.target.value)} 
                        className={validationErrors.title ? 'border-red-500 focus:border-red-500' : ''}
                        maxLength={200}
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{t('testCaseTitle')}</span>
                        <span>{testCaseForm.title.length}/200</span>
                      </div>
                      {validationErrors.title && (
                        <p className="text-red-500 text-sm mt-1">{validationErrors.title}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="reference" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('reference')}</Label>
                    <div className="col-span-3">
                      <ReferenceField
                        value={testCaseForm.reference}
                        onChange={(value) => handleFieldChange('reference', value)}
                        projectId={currentProjectId ?? undefined}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="type" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('fieldTestType')} <span className="text-red-500">*</span></Label>
                    <div className="col-span-3">
                      <Select value={testCaseForm.test_type} onValueChange={handleTestTypeChange} disabled={isEnumsLoading}>
                        <SelectTrigger ref={testTypeRef} className={validationErrors.test_type ? 'border-red-500 focus:border-red-500' : ''}>
                          <SelectValue placeholder={isEnumsLoading ? t('loading') : t('selectTestType')} />
                        </SelectTrigger>
                        <SelectContent>
                          {testTypeOptions.length === 0 && !isEnumsLoading ? (
                            <div className="p-2">
                              <div className="text-sm text-gray-500 mb-2">{t('noTestTypesAvailable')}</div>
                              {!isCreatingTestType ? (
                                <div>
                                  <Input
                                    placeholder={t('enterNewTestTypeName')}
                                    value={newTestTypeName}
                                    onChange={(e) => setNewTestTypeName(e.target.value)}
                                    className="mb-2"
                                  />
                                  <Button
                                    onClick={handleCreateTestType}
                                    disabled={!newTestTypeName.trim()}
                                    size="sm"
                                    className="w-full"
                                  >
                                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                    {t('createNewTestType')}
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center py-2">
                                  <div className={`animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                                  {t('creating')}
                                </div>
                              )}
                            </div>
                          ) : (
                            testTypeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {validationErrors.test_type && (
                        <p className="text-red-500 text-sm mt-1">{validationErrors.test_type}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="execution-type" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('fieldExecutionType')}</Label>
                    <Select value={testCaseForm.execution_type} onValueChange={(value) => handleFieldChange('execution_type', value)}>
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder={t('selectExecutionType')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="functional">{t('functionalTesting')}</SelectItem>
                        <SelectItem value="ui">{t('uiTesting')}</SelectItem>
                        <SelectItem value="api">{t('apiTesting')}</SelectItem>
                        <SelectItem value="database">{t('databaseTesting')}</SelectItem>
                        <SelectItem value="security">{t('securityTesting')}</SelectItem>
                        <SelectItem value="performance">{t('performanceTesting')}</SelectItem>
                        <SelectItem value="compatibility">{t('compatibilityTesting')}</SelectItem>
                        <SelectItem value="accessibility">{t('accessibilityTesting')}</SelectItem>
                        <SelectItem value="localization">{t('localizationTesting')}</SelectItem>
                        <SelectItem value="user-acceptance">{t('userAcceptanceTesting')}</SelectItem>
                        <SelectItem value="custom">{t('customMethod')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="priority" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('fieldPriority')} <span className="text-red-500">*</span></Label>
                    <div className="col-span-3">
                      <Select value={testCaseForm.priority} onValueChange={handlePriorityChange} disabled={isEnumsLoading}>
                        <SelectTrigger ref={priorityRef} className={validationErrors.priority ? 'border-red-500 focus:border-red-500' : ''}>
                          <SelectValue placeholder={isEnumsLoading ? t('loading') : t('selectPriority')} />
                        </SelectTrigger>
                        <SelectContent>
                          {priorityOptions.length === 0 && !isEnumsLoading ? (
                            <div className="p-2">
                              <div className="text-sm text-gray-500 mb-2">{t('noPrioritiesAvailable')}</div>
                              {!isCreatingPriority ? (
                                <div>
                                  <Input
                                    placeholder={t('enterNewPriorityName')}
                                    value={newPriorityName}
                                    onChange={(e) => setNewPriorityName(e.target.value)}
                                    className="mb-2"
                                  />
                                  <div className="flex gap-2 mb-2">
                                    <Label htmlFor="priority-value" className="text-xs">{t('value')} (1-4):</Label>
                                    <Input
                                      id="priority-value"
                                      type="number"
                                      min="1"
                                      max="4"
                                      value={newPriorityValue}
                                      onChange={(e) => setNewPriorityValue(parseInt(e.target.value) || 2)}
                                      className="w-20"
                                    />
                                  </div>
                                  <Button
                                    onClick={handleCreatePriority}
                                    disabled={!newPriorityName.trim()}
                                    size="sm"
                                    className="w-full"
                                  >
                                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                    {t('createNewPriority')}
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center py-2">
                                  <div className={`animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                                  {t('creating')}
                                </div>
                              )}
                            </div>
                          ) : (
                            priorityOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {validationErrors.priority && (
                        <p className="text-red-500 text-sm mt-1">{validationErrors.priority}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Environment Selection */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">{t('testEnvironment')}</h3>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="environment" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('environmentLabel')}</Label>
                    <div className="col-span-3">
                      {isEnvironmentsLoading ? (
                        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                      ) : (
                        <Select value={testCaseForm.environment} onValueChange={(value) => handleFieldChange('environment', value)}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('selectTestEnvironment')} />
                          </SelectTrigger>
                          <SelectContent>
                            {environments.length === 0 && !isEnvironmentsLoading ? (
                              <div className="p-2">
                                <div className="text-sm text-gray-500 mb-2">{t('noEnvironmentsAvailable')}</div>
                                {!isCreatingEnvironment ? (
                                  <div>
                                    <Input
                                      placeholder={t('enterNewEnvironmentName')}
                                      value={newEnvironmentName}
                                      onChange={(e) => setNewEnvironmentName(e.target.value)}
                                      className="mb-2"
                                    />
                                    <Input
                                      placeholder={t('enterDescriptionOptional')}
                                      value={newEnvironmentDescription}
                                      onChange={(e) => setNewEnvironmentDescription(e.target.value)}
                                      className="mb-2"
                                    />
                                    <Button
                                      onClick={handleCreateEnvironment}
                                      disabled={!newEnvironmentName.trim()}
                                      size="sm"
                                      className="w-full"
                                    >
                                      <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                      {t('createNewEnvironment')}
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center py-2">
                                    <div className={`animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                                    {t('creating')}
                                  </div>
                                )}
                              </div>
                            ) : (
                              environments.map((env) => (
                                <SelectItem key={env.id} value={env.id}>
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      env.name.toLowerCase() === 'production' ? 'bg-red-500' :
                                      env.name.toLowerCase() === 'staging' ? 'bg-yellow-500' :
                                      env.name.toLowerCase() === 'qa' ? 'bg-purple-500' :
                                      env.name.toLowerCase() === 'development' ? 'bg-blue-500' :
                                      'bg-gray-500'
                                    }`} />
                                    <div>
                                      <div className="font-medium">{env.name}</div>
                                      <div className="text-xs text-gray-500">{env.description}</div>
                                    </div>
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </div>

                {/* Requirements Linking */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{t('requirements')}</h3>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        loadAvailableRequirements();
                        setIsRequirementDialogOpen(true);
                      }}
                    >
                      <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('linkRequirements')}
                    </Button>
                  </div>
                  
                  {linkedRequirements.length > 0 ? (
                    <div className="space-y-2">
                      {linkedRequirements.map((requirement) => (
                        <div key={requirement.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 bg-blue-500 rounded-full" />
                            <div>
                              <p className="font-medium text-sm">{requirement.title}</p>
                              <p className="text-xs text-gray-500">{requirement.reference}</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnlinkRequirement(requirement.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                      <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">{t('noRequirementsLinked')}</p>
                      <p className="text-xs mt-1">{t('clickLinkRequirements')}</p>
                    </div>
                  )}
                </div>

                {/* Test Details */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">{t('testDetails')}</h3>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t('testCaseDescription')}</Label>
                    <MarkdownEditor
                      value={testCaseForm.description}
                      onChange={(value) => handleFieldChange('description', value)}
                      placeholder={t('describeTestCase')}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="precondition">{t('fieldPreconditions')}</Label>
                    <MarkdownEditor
                      value={testCaseForm.preconditions}
                      onChange={(value) => handleFieldChange('preconditions', value)}
                      placeholder={t('describePreconditions')}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="test-steps">{t('fieldSteps')}</Label>
                      <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <span className="text-sm text-gray-600">{t('simple')}</span>
                        <button
                          type="button"
                          onClick={() => handleMultistepToggle(!testCaseForm.is_multistep)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            testCaseForm.is_multistep ? 'bg-blue-600' : 'bg-gray-200'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isRTL
                                ? testCaseForm.is_multistep
                                  ? '-translate-x-6'
                                  : '-translate-x-1'
                                : testCaseForm.is_multistep
                                  ? 'translate-x-6'
                                  : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <span className="text-sm text-gray-600">{t('multistep')}</span>
                      </div>
                    </div>
                    {!testCaseForm.is_multistep ? (
                      <MarkdownEditor
                        value={testCaseForm.steps}
                        onChange={(value) => handleFieldChange('steps', value)}
                        placeholder={t('stepPlaceholder')}
                        rows={5}
                      />
                    ) : (
                      <div className="space-y-4">
                        {testSteps.map((step) => (
                          <div key={step.step_number} className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">{t('stepNumber', {number: step.step_number})}</h4>
                              {testSteps.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveStep(step.step_number)}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>{t('action')}</Label>
                                <Textarea
                                  value={step.action}
                                  onChange={(e) => handleStepChange(step.step_number, 'action', e.target.value)}
                                  placeholder={t('describeAction')}
                                  rows={3}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t('fieldExpectedResult')}</Label>
                                <Textarea
                                  value={step.expected_result}
                                  onChange={(e) => handleStepChange(step.step_number, 'expected_result', e.target.value)}
                                  placeholder={t('describeExpectedResult')}
                                  rows={3}
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>{t('stepType')}</Label>
                              <Select
                                value={step.step_type}
                                onValueChange={(value) => handleStepChange(step.step_number, 'step_type', value)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="manual">{t('manual')}</SelectItem>
                                  <SelectItem value="automated">{t('automated')}</SelectItem>
                                  <SelectItem value="verification">{t('verification')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleAddStep}
                            className="flex-1"
                          >
                            <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {t('addStep')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              loadAvailableSharedSteps();
                              setIsSharedStepsDialogOpen(true);
                            }}
                            className="flex-1"
                          >
                            <Layers className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {t('insertSharedStep')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {!testCaseForm.is_multistep && (
                    <div className="space-y-2">
                      <Label htmlFor="expected-results">{t('fieldExpectedResult')}</Label>
                      <MarkdownEditor
                        value={testCaseForm.expected_result}
                        onChange={(value) => handleFieldChange('expected_result', value)}
                        placeholder={t('describeExpectedOutcome')}
                        rows={3}
                      />
                    </div>
                  )}
                </div>

                {/* Custom Fields with Optimized Loading */}
                {customFields.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('customFields')}</h3>
                    {isCustomFieldsLoading ? (
                      <div className="space-y-4">
                        {/* Show skeleton loaders while custom fields are loading */}
                        {Array.from({ length: 2 }).map((_, index) => (
                          <div key={index} className="grid grid-cols-4 items-center gap-4">
                            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                            <div className="col-span-3 h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {customFields.map((field) => (
                          <div key={field.id} className="grid grid-cols-4 items-center gap-4">
                            <Label className={`text-right ${isRTL ? 'text-left' : ''}`}>
                              {field.name}
                              {field.is_required && <span className="text-red-500 ml-1">*</span>}
                            </Label>
                            <div className="col-span-3">
                              {field.field_type === 'text' && (
                                <div>
                                  <Input
                                    ref={(el) => { customFieldRefs.current[field.id] = el; }}
                                    value={customFieldValues[field.id] || ''}
                                    onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                                    placeholder={field.description}
                                    className={validationErrors[`custom_${field.id}`] ? 'border-red-500 focus:border-red-500' : ''}
                                  />
                                  {validationErrors[`custom_${field.id}`] && (
                                    <p className="text-red-500 text-sm mt-1">{validationErrors[`custom_${field.id}`]}</p>
                                  )}
                                </div>
                              )}
                              {field.field_type === 'number' && (
                                <div>
                                  <Input
                                    ref={(el) => { customFieldRefs.current[field.id] = el; }}
                                    type="number"
                                    value={customFieldValues[field.id] || ''}
                                    onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                                    placeholder={field.description}
                                    className={validationErrors[`custom_${field.id}`] ? 'border-red-500 focus:border-red-500' : ''}
                                  />
                                  {validationErrors[`custom_${field.id}`] && (
                                    <p className="text-red-500 text-sm mt-1">{validationErrors[`custom_${field.id}`]}</p>
                                  )}
                                </div>
                              )}
                              {field.field_type === 'boolean' && (
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`field-${field.id}`}
                                    checked={customFieldValues[field.id] || false}
                                    onCheckedChange={(checked) => handleCustomFieldChange(field.id, checked)}
                                  />
                                  <Label htmlFor={`field-${field.id}`} className="text-sm">
                                    {field.description}
                                  </Label>
                                  {validationErrors[`custom_${field.id}`] && (
                                    <p className="text-red-500 text-sm mt-1">{validationErrors[`custom_${field.id}`]}</p>
                                  )}
                                </div>
                              )}
                              {field.field_type === 'select' && field.options && (
                                <div>
                                  <Select
                                    value={customFieldValues[field.id] || ''}
                                    onValueChange={(value) => handleCustomFieldChange(field.id, value)}
                                  >
                                    <SelectTrigger className={validationErrors[`custom_${field.id}`] ? 'border-red-500 focus:border-red-500' : ''}>
                                      <SelectValue placeholder={field.description} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {field.options.map((option: string) => (
                                        <SelectItem key={option} value={option}>
                                          {option}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {validationErrors[`custom_${field.id}`] && (
                                    <p className="text-red-500 text-sm mt-1">{validationErrors[`custom_${field.id}`]}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto">
                  {t('toSubmit')}
                </div>
                <Button variant="outline" onClick={handleCloseModal}>
                  {t('cancel')}
                </Button>
                <Button onClick={handleCreateTestCase} disabled={isCreating} className="transition-all duration-200">
                  {isCreating ? t('creating') : t('createTestCase')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}

          {/* Unsaved Changes Confirmation Dialog */}
          <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
            <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
                <DialogDescription>
                  {t('unsavedChangesModalMessage')}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>
                  {t('keepEditingModal')}
                </Button>
                <Button onClick={() => handleUnsavedConfirm(true)}>
                  {t('discardChangesModal')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-6">
          {/* Sections Sidebar */}
        <div className="w-64 flex-shrink-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                {t('sections')}
                <Button variant="ghost" size="sm" onClick={() => setSectionDialogOpen(true)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* Search input for sections */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    placeholder={t('searchSections')}
                    value={sectionSearchQuery}
                    onChange={(e) => setSectionSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t('testCaseSections')}
                  </div>
                  <Button
                    variant={selectedTestSuite === 'all' ? 'secondary' : 'ghost'}
                    className="w-full justify-start text-sm font-semibold"
                    onClick={() => setSelectedTestSuite('all')}
                  >
                    <Folder className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4 text-blue-500`} />
                    <span className="flex-1 truncate text-left rtl:text-right">{t('testCasesTitle')}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      selectedTestSuite === 'all' 
                      ? 'bg-blue-100 text-blue-600 font-medium' 
                      : 'text-gray-600 bg-gray-100 font-medium'
                  }`}>
                    {apiTestCases.length}
                  </span>
                </Button>
                
                {/* Group sections by test suite */}
                {(() => {
                  // Filter sections recursively based on search query
                  const filterSections = (sections: Section[], query: string): Section[] => {
                    if (!query.trim()) return sections;
                    
                    const lowerQuery = query.toLowerCase();
                    
                    return sections.reduce((filtered: Section[], section) => {
                      // Check if current section matches
                      const sectionMatches = section.name.toLowerCase().includes(lowerQuery);
                      
                      // Filter children recursively
                      const filteredChildren = section.children 
                        ? filterSections(section.children, query)
                        : [];
                      
                      // Include section if it matches or has matching children
                      if (sectionMatches || filteredChildren.length > 0) {
                        filtered.push({
                          ...section,
                          children: filteredChildren.length > 0 ? filteredChildren : section.children
                        });
                        
                        // Auto-expand sections with matching children
                        if (filteredChildren.length > 0 && !expandedSections.has(section.id)) {
                          setExpandedSections(prev => new Set([...prev, section.id]));
                        }
                      }
                      
                      return filtered;
                    }, []);
                  };
                  
                  // Group sections by test suite
                  const sectionsBySuite = new Map<number, { name: string; sections: Section[] }>();
                  
                  // Apply search filter first
                  const filteredSections = filterSections(mockSections, sectionSearchQuery);
                  
                  filteredSections.forEach(section => {
                    if (section.test_suite_id) {
                      if (!sectionsBySuite.has(section.test_suite_id)) {
                        sectionsBySuite.set(section.test_suite_id, {
                          name: section.test_suite_name || 'Unknown Suite',
                          sections: []
                        });
                      }
                      sectionsBySuite.get(section.test_suite_id)!.sections.push(section);
                    }
                  });
                  
                  // Show message if no results
                  if (sectionSearchQuery.trim() && sectionsBySuite.size === 0) {
                    return (
                      <div className="text-center py-6 px-3">
                        <Search className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-xs text-gray-500">{t('noSectionsFound')}</p>
                        <p className="text-xs text-gray-400 mt-1">{t('tryDifferentSearchTerm')}</p>
                      </div>
                    );
                  }
                  
                  return Array.from(sectionsBySuite.entries()).map(([suiteId, suiteData]) => (
                    <div key={suiteId} className="mb-3">
                      <div className="flex items-center gap-2 mb-2 px-3 py-1 bg-gray-50 dark:bg-gray-800 rounded">
                        <Folder className="h-4 w-4 text-blue-600" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {suiteData.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({suiteData.sections.reduce((sum, s) => sum + (s.testCaseCount || 0), 0)} TCs)
                        </span>
                      </div>
                      <div className="ml-2">
                        {renderSectionTree(suiteData.sections)}
                      </div>
                    </div>
                  ));
                })()}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Breadcrumb Navigation */}
          {(() => {
            const breadcrumbPath = getBreadcrumbPath();
            return breadcrumbPath.length >= 1 ? (
              <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">Navigation:</span>
                  {breadcrumbPath.map((section, index) => (
                    <div key={index} className="flex items-center gap-2">
                      {index > 0 && <span className="text-gray-400">›</span>}
                      <button
                        onClick={() => {
                          // Find the section ID for this breadcrumb level
                          const findSectionIdByName = (sections: Section[], targetName: string, currentPath: string[] = []): string | null => {
                            for (const section of sections) {
                              const newPath = [...currentPath, section.name];
                              if (section.name === targetName && newPath.slice(0, index + 1).every((name, i) => name === breadcrumbPath[i])) {
                                return section.id;
                              }
                              if (section.children) {
                                const found = findSectionIdByName(section.children, targetName, newPath);
                                if (found) return found;
                              }
                            }
                            return null;
                          };
                          
                          const sectionId = findSectionIdByName(mockSections, section);
                          if (sectionId) {
                            setSelectedTestSuite(sectionId);
                          }
                        }}
                        className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors ${
                          index === breadcrumbPath.length - 1 
                            ? 'text-blue-600 dark:text-blue-400 font-medium' 
                            : 'hover:underline'
                        }`}
                      >
                        {section}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
          
          {/* Search Bar and Bulk Actions */}
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder={t('searchTestCases')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              {selectedTestCases.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedTestCases.length} selected
                  </span>
                  <Button variant="outline" size="sm" onClick={handleBulkExecute} className="text-blue-600">
                    <Play className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('execute')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportSelected} className="text-green-600">
                    <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('exportCSV')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-600">
                    <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('delete')}
                  </Button>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">{t('filters')}</span>
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-32"><SelectValue placeholder={t('type')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allTypes')}</SelectItem>
                  {testTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {testTypeOptions.find((option) => option.value === type)?.label || type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-32"><SelectValue placeholder={t('priority')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allPriorities')}</SelectItem>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {customFields.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={customFieldFilterId}
                    onValueChange={(value) => {
                      setCustomFieldFilterId(value);
                      setCustomFieldFilterValue(CUSTOM_FIELD_FILTER_ANY_VALUE);
                    }}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder={t('customFieldFilter')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CUSTOM_FIELD_FILTER_ALL}>{t('allCustomFields')}</SelectItem>
                      {customFields.map((field) => (
                        <SelectItem key={field.id} value={String(field.id)}>
                          {field.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCustomFieldFilter && selectedCustomFieldFilter.field_type === 'boolean' && (
                    <Select value={customFieldFilterValue} onValueChange={setCustomFieldFilterValue}>
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder={t('customFieldValue')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CUSTOM_FIELD_FILTER_ANY_VALUE}>{t('anyCustomFieldValue')}</SelectItem>
                        <SelectItem value="true">{t('yes')}</SelectItem>
                        <SelectItem value="false">{t('no')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {selectedCustomFieldFilter && ['select', 'multiselect'].includes(selectedCustomFieldFilter.field_type) && (
                    <Select value={customFieldFilterValue} onValueChange={setCustomFieldFilterValue}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder={t('customFieldValue')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CUSTOM_FIELD_FILTER_ANY_VALUE}>{t('anyCustomFieldValue')}</SelectItem>
                        {getCustomFieldOptions(selectedCustomFieldFilter).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {selectedCustomFieldFilter && !['boolean', 'select', 'multiselect'].includes(selectedCustomFieldFilter.field_type) && (
                    <Input
                      type={selectedCustomFieldFilter.field_type === 'number' ? 'number' : selectedCustomFieldFilter.field_type === 'date' ? 'date' : 'text'}
                      placeholder={t('enterCustomFieldValue')}
                      value={customFieldFilterValue === CUSTOM_FIELD_FILTER_ANY_VALUE ? '' : customFieldFilterValue}
                      onChange={(event) => setCustomFieldFilterValue(event.target.value)}
                      className="w-44"
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Test Cases Table */}
          <Card>
            <CardContent className="p-0">
              <SortableContext items={paginatedTestCases.map(tc => tc.id)} strategy={verticalListSortingStrategy}>
                <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox checked={selectAll} onCheckedChange={handleSelectAll} className="rtl:mr-0" />
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" size="sm" onClick={() => { setSortField('id'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            ID {sortField === 'id' && (sortDirection === 'asc' ? <ArrowUp className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" /> : <ArrowDown className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" />)}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" size="sm" onClick={() => { setSortField('title'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            Title {sortField === 'title' && (sortDirection === 'asc' ? <ArrowUp className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" /> : <ArrowDown className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" />)}
                          </Button>
                        </TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>{t('section')}</TableHead>
                        <TableHead>{t('type')}</TableHead>
                        <TableHead>{t('priority')}</TableHead>
                        <TableHead>
                          <Button variant="ghost" size="sm" onClick={() => { setSortField('created_at'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            {t('created')} {sortField === 'created_at' && (sortDirection === 'asc' ? <ArrowUp className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" /> : <ArrowDown className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" />)}
                          </Button>
                        </TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedTestCases.map((testCase) => (
                        <SortableRow
                          key={testCase.id}
                          testCase={testCase}
                          onEdit={handleEdit}
                          onMove={handleMoveTestCase}
                          onExecute={handleExecute}
                          onViewHistory={handleViewHistory}
                          onDelete={handleDelete}
                          getTestCaseDetailUrl={getTestCaseDetailUrl}
                          navigate={navigate}
                          selectedTestCases={selectedTestCases}
                          handleSelectTestCase={handleSelectTestCase}
                          sections={mockSections}
                          getTypeBadge={getTypeBadge}
                          getPriorityBadge={getPriorityBadge}
                          isRTL={isRTL}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </SortableContext>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg shadow mt-4">
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                {t('showing', { start: filteredAndSortedTestCases.length > 0 ? startIndex + 1 : 0, end: endIndex, total: totalCount })}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-600">{t('itemsPerPage')}:</Label>
                <Select value={itemsPerPage.toString()} onValueChange={(value) => {
                  const newItemsPerPage = parseInt(value);
                  setItemsPerPage(newItemsPerPage);
                  setCurrentPage(1); // Reset to first page
                  // Save user preference
                  userPreferencesAPI.updateItemsPerPage(newItemsPerPage).catch(console.error);
                }}>
                  <SelectTrigger className="w-20 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t('previous')}
              </Button>
              <span className="text-sm">{t('pageOf', { current: currentPage, total: totalPages })}</span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
                {t('next')} <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      </DndContext>

      {/* Revisions Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent isRTL={isRTL} className={`sm:max-w-[600px] ${isRTL ? 'font-vazir' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className={`h-5 w-5 text-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('revisionHistory')}: {selectedTestCaseForHistory?.title}
            </DialogTitle>
            <DialogDescription>{t('viewComparePreviousVersions')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 rtl:pl-2 rtl:pr-0">
            {isLoadingRevisions ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className={`ml-3 text-gray-600 ${isRTL ? 'mr-3 rtl:mr-0 rtl:ml-3' : ''}`}>{t('loadingRevisionHistory')}</span>
              </div>
            ) : revisions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p className="text-sm font-medium">{t('noRevisionHistoryAvailable')}</p>
                <p className="text-xs mt-1">{t('editToCreateRevision')}</p>
              </div>
            ) : (
              revisions.map((rev) => (
                <div key={rev.id || rev.revision_number} className={`relative pb-6 border-l-2 border-gray-100 last:border-0 last:pb-0 ${isRTL ? 'pr-6 pl-0 border-r-2 border-l-0' : 'pl-6 pr-0 border-l-2'}`}>
                  <div className={`absolute top-0 w-4 h-4 rounded-full bg-white border-2 border-blue-500 ${isRTL ? '-right-[9px] left-auto' : '-left-[9px] right-auto'}`} />
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="secondary">{t('revision')} #{rev.revision_number || rev.version}</Badge>
                    <span className="text-xs text-gray-500 flex items-center">
                      <Clock className={`h-3 w-3 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {new Date(rev.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                    {rev.change_reason && (
                      <p className="text-sm font-medium mb-1">{rev.change_reason.replace(/Updated fields/gi, t('updatedFields'))}</p>
                    )}
                    {rev.changed_fields && rev.changed_fields.length > 0 && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        <span className="font-medium">{t('updatedFields') || 'Updated fields'}:</span> {rev.changed_fields.map(translateFieldName).join(', ')}
                      </p>
                    )}
                    <div className="flex items-center text-xs text-gray-500">
                      <User className={`h-3 w-3 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {t('by')} {rev.changed_by || rev.author || t('unknown')}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleCompareRevision(rev)}>{t('compare')}</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleRestoreRevision(rev)}>{t('restore')}</Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* New Section Dialog */}
      <Dialog open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
        <DialogContent isRTL={isRTL}>
          <DialogHeader>
            <DialogTitle>Create New Section</DialogTitle>
            <DialogDescription>Organize your test cases with sections and folders.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Section Name</Label>
              <Input value={newSectionName} onChange={(e) => setNewSectionName(e.target.value)} placeholder="e.g. Authentication" />
            </div>
            <div className="space-y-2">
              <Label>Parent Section (Optional)</Label>
              <Select value={newSectionParentId} onValueChange={setNewSectionParentId}>
                <SelectTrigger><SelectValue placeholder="Select parent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Root)</SelectItem>
                  {mockSections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateSection} disabled={!newSectionName}>Create Section</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Test Case Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent isRTL={isRTL}>
          <DialogHeader>
            <DialogTitle>{t('moveTestCase')}</DialogTitle>
            <DialogDescription>{t('moveTestCaseDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('destinationSection')}</Label>
              <Select value={destinationSection} onValueChange={setDestinationSection}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectDestination')} />
                </SelectTrigger>
                <SelectContent>
                  {generateSectionOptions(mockSections)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-gray-500">
              <p>Current section: <span className="font-medium">{selectedTestCaseToMove?.section}</span></p>
              <p>Available sections: <span className="font-medium">{mockSections.length} main sections</span></p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>{t('cancelMove')}</Button>
            <Button onClick={handleConfirmMove} disabled={!destinationSection || destinationSection === selectedTestCaseToMove?.section}>
              {t('confirmMove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog (Simplified for example) */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Test Case: {editingTestCase?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={testCaseForm.title} onChange={(e) => handleFieldChange('title', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={testCaseForm.description} onChange={(e) => handleFieldChange('description', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Reference</Label>
              <ReferenceField
                value={testCaseForm.reference}
                onChange={(value) => handleFieldChange('reference', value)}
                projectId={currentProjectId ?? undefined}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={testCaseForm.test_type} onValueChange={(value) => handleFieldChange('test_type', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="automated">Automated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={testCaseForm.priority} onValueChange={(value) => handleFieldChange('priority', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateTestCase}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportDialogOpen} onOpenChange={(open) => {
        setIsImportDialogOpen(open);
        if (!open) {
          setImportFile(null);
          setImportSectionId('none');
        }
      }}>
        <DialogContent isRTL={isRTL} className="max-h-[92vh] max-w-7xl overflow-y-auto border-0 bg-background p-0 text-foreground">
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>{t('importTestCasesFromCSV')}</DialogTitle>
              <DialogDescription>{t('importTestCasesFromCSVDescription')}</DialogDescription>
            </DialogHeader>
            {importFile && currentTestSuiteId && (
              <ImportPreview
                file={importFile}
                testSuiteId={currentTestSuiteId}
                sectionId={importSectionId && importSectionId !== 'none' ? parseInt(importSectionId) : undefined}
	                customFields={customFields}
	                sections={mockSections}
	                existingTestCases={apiTestCases.map((testCase) => ({ id: testCase.id, title: testCase.title }))}
	                onConfirm={async (validatedData, options) => {
	                  const result = await importExportAPI.importMappedTestCasesChunked(currentTestSuiteId, validatedData, {
	                    duplicateMode: options.duplicateMode,
	                    dryRun: options.dryRun,
	                    filename: options.filename,
	                    idempotencyKey: options.idempotencyKey,
	                    chunkSize: 500,
	                    onProgress: options.onProgress,
	                  });

	                  if (result.errors?.length) {
	                    console.error('Import completed with errors:', result.errors);
                  }
                  if (result.warnings?.length) {
                    console.warn('Import completed with warnings:', result.warnings);
                  }

	                  if (!options.dryRun) {
	                    options.onProgress({ phase: 'refreshing', message: t('importPhaseRefreshing') });
	                    await loadTestCases();
	                    await loadSections();
	                  }

	                  return result;
	                }}
                onCancel={() => {
                  setIsImportDialogOpen(false);
                  setImportFile(null);
                  setImportSectionId('none');
                }}
              />
            )}
            {importFile && !currentTestSuiteId && (
              <div className="py-8 text-center text-sm text-red-600">{t('noTestSuiteFoundForProject')}</div>
            )}
            {!importFile && (
              <div className="mx-auto max-w-2xl py-8" dir={isRTL ? 'rtl' : 'ltr'}>
                <div className="rounded-3xl border border-dashed bg-card p-8 text-center text-card-foreground shadow-sm">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                    <Upload className="h-8 w-8" />
                  </div>
                  <div className="mt-5 space-y-2">
                    <h3 className="text-lg font-semibold">{t('selectCSVFile')}</h3>
                    <p className="text-sm text-muted-foreground">{t('selectCSVFileDescription')}</p>
                  </div>

                  <div className="mx-auto mt-6 max-w-md text-left rtl:text-right">
                    <Label htmlFor="import-file" className="mb-2 block text-sm font-medium">{t('csvFile')} <span className="text-destructive">*</span></Label>
                    <Input
                      ref={fileInputRef}
                      id="import-file"
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleImportFileSelect}
                      className="sr-only"
                    />
                    <Button type="button" variant="outline" className="h-12 w-full justify-center" onClick={() => fileInputRef.current?.click()}>
                      <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                      {t('browseCSVFile')}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">{t('csvImportLimitHint')}</p>
                  </div>

                  <div className="mt-6 grid gap-3 text-left rtl:text-right md:grid-cols-2">
                    {[
                      t('csvImportFeatureMapping'),
                      t('csvImportFeatureCustomFields'),
                      t('csvImportFeatureValidation'),
                      t('csvImportFeatureBulkSave'),
                    ].map((feature) => (
                      <div key={feature} className="flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                        <Check className="h-4 w-4 text-primary" />
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Requirements Selection Dialog */}
      <Dialog open={isRequirementDialogOpen} onOpenChange={setIsRequirementDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[600px] max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('linkRequirements')}</DialogTitle>
            <DialogDescription>
              {t('searchAndSelectRequirements')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Search */}
            <div className="space-y-2">
              <Label>{t('searchRequirementsLabel')}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t('searchByTitleOrReference')}
                  value={requirementSearchQuery}
                  onChange={(e) => setRequirementSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Requirements List */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {filteredRequirements.length > 0 ? (
                filteredRequirements.map((requirement) => {
                  const isLinked = linkedRequirements.find(req => req.id === requirement.id);
                  return (
                    <div
                      key={requirement.id}
                      className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                        isLinked 
                          ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                      onClick={() => isLinked ? handleUnlinkRequirement(requirement.id) : handleLinkRequirement(requirement)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={!!isLinked}
                          onCheckedChange={() => isLinked ? handleUnlinkRequirement(requirement.id) : handleLinkRequirement(requirement)}
                        />
                        <div>
                          <p className="font-medium text-sm">{requirement.title}</p>
                          <p className="text-xs text-gray-500">{requirement.reference}</p>
                        </div>
                      </div>
                      {isLinked && (
                        <Check className="h-4 w-4 text-blue-600" />
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm">{t('noRequirementsFound')}</p>
                  <p className="text-xs mt-1">{t('tryAdjustingSearchTerms')}</p>
                </div>
              )}
            </div>

            {/* Linked Requirements Summary */}
            {linkedRequirements.length > 0 && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('linkedRequirements')} ({linkedRequirements.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {linkedRequirements.map((requirement) => (
                    <Badge key={requirement.id} variant="secondary" className="text-xs">
                      {requirement.reference}
                      <button
                        onClick={() => handleUnlinkRequirement(requirement.id)}
                        className="ml-1 hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRequirementDialogOpen(false)}>
              {t('done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shared Steps Selection Dialog */}
      <Dialog open={isSharedStepsDialogOpen} onOpenChange={setIsSharedStepsDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('insertSharedStep')}</DialogTitle>
            <DialogDescription>
              {t('browseAndInsertSharedSteps')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Search */}
            <div className="space-y-2">
              <Label>{t('searchSharedSteps')}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t('searchByNameOrDescription')}
                  value={sharedStepSearchQuery}
                  onChange={(e) => setSharedStepSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Loading State */}
            {loadingSharedSteps && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-gray-600">Loading shared steps...</span>
              </div>
            )}

            {/* Shared Steps List */}
            {!loadingSharedSteps && (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {filteredSharedSteps.length > 0 ? (
                  filteredSharedSteps.map((step) => (
                    <div
                      key={step.id}
                      className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm">{step.name}</h4>
                          {step.description && (
                            <p className="text-xs text-gray-600 mt-1">{step.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex items-center text-xs text-gray-500">
                              <TrendingUp className="h-3 w-3 mr-1" />
                              Used {step.usage_count || 0} times
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            handleInsertSharedStep(step);
                            setIsSharedStepsDialogOpen(false);
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          {t('insert')}
                        </Button>
                      </div>
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded">
                          <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">{t('action')}:</p>
                          <p className="text-gray-600 dark:text-gray-400">{step.action}</p>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded">
                          <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">{t('expectedResult')}:</p>
                          <p className="text-gray-600 dark:text-gray-400">{step.expected_result}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Layers className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm font-medium">{t('noSharedStepsFound')}</p>
                    <p className="text-xs mt-1">
                      {sharedStepSearchQuery 
                        ? t('tryAdjustingSearchTerms')
                        : t('createSharedStepsToReuse')
                      }
                    </p>
                    {!sharedStepSearchQuery && projectId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => {
                          setIsSharedStepsDialogOpen(false);
                          window.open(`/projects/${projectId}/shared-steps`, '_blank');
                        }}
                      >
                        <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                        {t('createSharedStep')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSharedStepsDialogOpen(false)}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
