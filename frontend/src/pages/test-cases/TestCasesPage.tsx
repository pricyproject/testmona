import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { aiManagerAPI, AIManagerStatus, api, testCasesAPI, testSuitesAPI, sectionsAPI, importExportAPI, userPreferencesAPI, requirementsAPI, testRunsAPI, testResultsAPI, sharedStepsAPI, environmentsAPI } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Plus,
  Search,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit,
  Play,
  History,
  Trash2,
  FileText,
  FolderPlus,
  ArrowUp,
  ArrowDown,
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
  Wand2,
  Loader2,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';
import { ContentEditor } from '@/components/ui/content-editor';
import { ReferenceField } from '@/components/ui/reference-field';
import { customFieldsAPI } from '@/lib/api';
import { useProjectTestCases } from '@/hooks/queries/testCasesPage';
import { CustomFieldDefinition, SharedStep, TestCase } from '@/types';
import { Section } from '@/types/testCases';
import { ImportPreview } from '@/components/ImportPreview';
import { SortableTestCaseRow } from '@/components/TestCases/SortableTestCaseRow';
import { SavedFilters } from '@/components/SavedFilters';
import { BulkEditTestCasesDialog } from '@/components/BulkEditTestCasesDialog';

const CUSTOM_FIELD_FILTER_ALL = 'all';
const CUSTOM_FIELD_FILTER_ANY_VALUE = '__any__';
const SUITE_SELECTION_PREFIX = 'suite:';
const UNSECTIONED_SELECTION_SUFFIX = ':unsectioned';

type SuiteSummary = {
  id: number;
  name: string;
  description?: string | null;
};

const getSuiteSelectionValue = (suiteId: number) => `${SUITE_SELECTION_PREFIX}${suiteId}`;
const getUnsectionedSelectionValue = (suiteId: number) => `${SUITE_SELECTION_PREFIX}${suiteId}${UNSECTIONED_SELECTION_SUFFIX}`;
const isSuiteSelectionValue = (value: string) => value.startsWith(SUITE_SELECTION_PREFIX);
const isUnsectionedSelectionValue = (value: string) => value.endsWith(UNSECTIONED_SELECTION_SUFFIX);
const getSuiteIdFromSelectionValue = (value: string): number | null => {
  if (!isSuiteSelectionValue(value)) return null;
  const rawSuiteId = value
    .replace(SUITE_SELECTION_PREFIX, '')
    .replace(UNSECTIONED_SELECTION_SUFFIX, '');
  const suiteId = Number(rawSuiteId);
  return Number.isInteger(suiteId) && suiteId > 0 ? suiteId : null;
};

type AIAssistantAction = 'suggest_steps' | 'improve_expected_result' | 'add_negative_cases' | 'convert_to_gherkin' | 'split_broad_case';

export function TestCases() {
  const { t, isRTL } = useTranslation();
  const { canWrite } = usePermissions();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const urlSectionId = searchParams.get('section');
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
    tags: string;
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
    tags: '',
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
  const [aiAssistantLoading, setAiAssistantLoading] = useState(false);
  const [aiAssistantAction, setAiAssistantAction] = useState<AIAssistantAction>('suggest_steps');
  const [aiAssistantResult, setAiAssistantResult] = useState<any>(null);
  const [aiAssistantDialogOpen, setAiAssistantDialogOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIManagerStatus | null>(null);
  const [loadingAIStatus, setLoadingAIStatus] = useState(false);

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
  const [availableSharedSteps, setAvailableSharedSteps] = useState<SharedStep[]>([]);
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
  const [testSuites, setTestSuites] = useState<SuiteSummary[]>([]);
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

  // Bulk actions state
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTestCase, setEditingTestCase] = useState<TestCase | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedTestCaseForHistory, setSelectedTestCaseForHistory] = useState<TestCase | null>(null);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [isLoadingRevisions, setIsLoadingRevisions] = useState(false);
  // Only the 'all' bucket is pre-expanded; section ids are added as the API hierarchy
  // loads so we don't bake any project's actual ids into source.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['all']));
  const [sectionsPanelCollapsed, setSectionsPanelCollapsed] = useState(false);

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

  // API data state. The list is fetched via react-query and seeded into local
  // state so the page's optimistic mutations (delete/update/reorder) keep
  // working; reloads after mutations become query refetches.
  const [apiTestCases, setApiTestCases] = useState<TestCase[]>([]);
  const testCasesQuery = useProjectTestCases(currentProjectId, sortField, sortDirection, !!currentProjectId);
  const loading = !!currentProjectId && testCasesQuery.isFetching;
  const mockSectionsRef = useRef<Section[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadAIStatus = async () => {
      setLoadingAIStatus(true);
      try {
        const status = await aiManagerAPI.getStatus();
        if (isMounted) setAiStatus(status);
      } catch (error) {
        console.error('Failed to load AI status:', error);
        if (isMounted) setAiStatus({ active_provider: 'openai', available: false, reason: 'active_provider_not_configured' });
      } finally {
        if (isMounted) setLoadingAIStatus(false);
      }
    };

    loadAIStatus();
    return () => {
      isMounted = false;
    };
  }, []);

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
        const fields = await customFieldsAPI.getDefinitions(currentProjectId, 'test_case');
        setCustomFields(fields);
      } catch (error) {
        console.error('Failed to load custom field definitions:', error);
        setCustomFields([]);
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

        const [prioritiesResponse, testTypesResponse] = await Promise.all([
          api.get(`/priority-definitions/?project_id=${projectId}`),
          api.get(`/test-type-definitions/?project_id=${projectId}`)
        ]);

        const prioritiesData = prioritiesResponse.data;
        const testTypesData = testTypesResponse.data;

        setDbPriorities(prioritiesData.filter((p: any) => p.is_active));
        setDbTestTypes(testTypesData.filter((t: any) => t.is_active));

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

        const defaultPriority = prioritiesData.find((p: any) => p.is_default && p.is_active);
        if (defaultPriority) {
          setTestCaseForm(prev => ({ ...prev, priority: defaultPriority.name.toLowerCase() }));
        } else if (priorityOptions.length > 0) {
          setTestCaseForm(prev => ({ ...prev, priority: priorityOptions[0].value }));
        }
      } catch (error) {
        console.error('Failed to load enum definitions:', error);
        setPriorityOptions([]);
        setTestTypeOptions([]);
        setTestTypes([]);
        toast({
          title: t('error'),
          description: t('failedToLoadEnums'),
          variant: 'destructive',
        });
      } finally {
        setIsEnumsLoading(false);
      }
    };

    loadEnums();
  }, [projectId]);

  // Function to create a new test type inline
  const handleCreateTestType = async () => {
    try {
      setIsCreatingTestType(true);
      await api.post(`/test-type-definitions/?project_id=${projectId}`, {
        name: newTestTypeName,
        description: `Custom test type: ${newTestTypeName}`,
        color: '#3B82F6',
        icon: '📝',
      });

      // Refresh test types
      const testTypesResponse = await api.get(`/test-type-definitions/?project_id=${projectId}`);
      const testTypesData = testTypesResponse.data;

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
      await api.post(`/priority-definitions/?project_id=${projectId}`, {
        name: newPriorityName,
        value: newPriorityValue,
        color: '#F59E0B',
        description: `Custom priority: ${newPriorityName}`,
      });

      // Refresh priorities
      const prioritiesResponse = await api.get(`/priority-definitions/?project_id=${projectId}`);
      const prioritiesData = prioritiesResponse.data;

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
      await environmentsAPI.create({
        name: newEnvironmentName,
        description: newEnvironmentDescription || `${newEnvironmentName} environment`,
        environment_type: 'testing',
        project_id: currentProjectId
      });

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
        const data = await environmentsAPI.getAll(currentProjectId);
        const transformedEnvironments = data.map((env: any) => ({
          id: env.id.toString(),
          name: env.name,
          description: env.description || `${env.name} environment`
        }));
        setEnvironments(transformedEnvironments);
      } catch (error) {
        console.error('Failed to load environments:', error);
        setEnvironments([]);
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
    });
  };

  // Focus management
  useEffect(() => {
    if (isDialogOpen && titleInputRef.current && !isModalOpening) {
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
    }
  }, [isDialogOpen, isModalOpening]);

  // Seed fetched cases into local state + derive counts/types (the query keyed
  // on project + sort handles refetching when those change).
  useEffect(() => {
    if (!currentProjectId) {
      setApiTestCases([]);
      setTotalCount(0);
      return;
    }
    if (testCasesQuery.data) {
      const fetched = testCasesQuery.data.testCases;
      setApiTestCases(fetched);
      setTotalCount(testCasesQuery.data.count);
      const types = Array.from(new Set([
        ...testTypeOptions.map((option) => option.value),
        ...extractTestTypes(fetched),
      ])).sort();
      setTestTypes(types);
    }
  }, [currentProjectId, testCasesQuery.data]);

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

  // Reload = refetch the react-query list (the seed effect re-applies the data).
  const loadTestCases = async () => {
    await testCasesQuery.refetch();
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

  // Project-wide section tree, loaded from sectionsAPI.getProjectSectionHierarchy.
  // Starts empty — no mock data is shown before the API responds or if it fails.
  const [mockSections, setMockSectionsState] = useState<Section[]>([]);

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

  const findSectionById = (sections: Section[], sectionId: string): Section | null => {
    for (const section of sections) {
      if (section.id === sectionId) return section;
      if (section.children?.length) {
        const found = findSectionById(section.children, sectionId);
        if (found) return found;
      }
    }
    return null;
  };

  const collectSectionAndDescendantIds = (section: Section): number[] => {
    const ids = [Number(section.id)].filter((id) => Number.isInteger(id));
    section.children?.forEach((child) => {
      ids.push(...collectSectionAndDescendantIds(child));
    });
    return ids;
  };

  const handleScopeSelection = (scope: string) => {
    setSelectedTestSuite(scope);

    if (scope === 'all') return;

    const suiteId = getSuiteIdFromSelectionValue(scope);
    if (suiteId) {
      setCurrentTestSuiteId(suiteId);
      return;
    }

    const section = findSectionById(mockSectionsRef.current, scope);
    if (section?.test_suite_id) {
      setCurrentTestSuiteId(section.test_suite_id);
    }
  };

  // Load sections from API
  const loadSections = async () => {
    if (!currentProjectId) return;

    try {
      const hierarchyData = await sectionsAPI.getProjectSectionHierarchy(currentProjectId);

      if (hierarchyData && hierarchyData.hierarchy && hierarchyData.hierarchy.length > 0) {
        setTestSuites(hierarchyData.hierarchy.map((suiteData: any) => ({
          id: suiteData.test_suite.id,
          name: suiteData.test_suite.name,
          description: suiteData.test_suite.description,
        })));

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

        hierarchyData.hierarchy.forEach((suiteData: any) => {
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

        setMockSections(allSections);
      } else {
        setTestSuites([]);
        setMockSections([]);
      }
    } catch (error) {
      console.error('Failed to load section hierarchy:', error);
      setMockSections([]);
    }
  };

  useEffect(() => {
    const initializeData = async () => {
      // Clear sections when project changes
      setMockSections([]);
      setCurrentTestSuiteId(null);
      setSelectedTestSuite('all');
      // Drop any selection carried over from the previous project — those IDs
      // aren't in the new project and would silently land in skipped_ids.
      setSelectedTestCases([]);
      setSelectAll(false);

      await loadTestSuite();
      await loadTestCases();
    };

    initializeData();
  }, [currentProjectId]);

  // Reload sections when project ID changes
  useEffect(() => {
    if (currentProjectId) {
      loadSections();
    } else {
      // Clear sections if no project is available
      setTestSuites([]);
      setMockSections([]);
    }
  }, [currentProjectId]); // Only reload when project changes, not when test cases change

  // Load test suite for the current project
  const loadTestSuite = async (preferredSuiteId?: number) => {
    if (!currentProjectId) {
      setTestSuites([]);
      setIsTestSuiteLoading(false);
      return;
    }

    try {
      setIsTestSuiteLoading(true);
      const testSuites = await testSuitesAPI.getAll(currentProjectId);
      setTestSuites(testSuites.map((suite: any) => ({
        id: suite.id,
        name: suite.name,
        description: suite.description,
      })));

      if (testSuites && testSuites.length > 0) {
        // Auto-select the first suite as the active context for "Add Test Case" /
        // "Import / Export" actions. The user can still browse all suites' cases via
        // the section panel (clicking sections changes the filter, not this default).
        setCurrentTestSuiteId(preferredSuiteId && testSuites.some((suite: any) => suite.id === preferredSuiteId)
          ? preferredSuiteId
          : testSuites[0].id);
      } else {
        setCurrentTestSuiteId(null);
      }
    } catch (error) {
      console.error('Failed to load test suite:', error);
      setTestSuites([]);
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
      const fields = await customFieldsAPI.getDefinitions(currentProjectId, 'test_case');
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
        <SelectItem key={section.id} value={section.id}>
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

  const generateDestinationOptions = (): React.ReactElement[] => {
    if (testSuites.length === 0) {
      return [];
    }

    return testSuites.flatMap((suite) => {
      const suiteSections = mockSections.filter((section) => section.test_suite_id === suite.id);
      return [
        <SelectItem key={`unsectioned-${suite.id}`} value={getUnsectionedSelectionValue(suite.id)}>
          {suite.name} / {t('unsectioned')}
        </SelectItem>,
        ...generateSectionOptions(suiteSections),
      ];
    });
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
            className="absolute inset-0 z-5"
            style={{ pointerEvents: 'auto' }}
          />
        )}

        {/* Content with lower z-index so overlay is on top when dragging */}
        <div className="relative z-1">
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

  const DroppableUnsectioned = ({
    suiteId,
    suiteName,
    children,
  }: {
    suiteId: number;
    suiteName: string;
    children: React.ReactNode;
  }) => {
    const { setNodeRef, isOver } = useDroppable({
      id: `unsectioned-${suiteId}`,
      data: {
        type: 'unsectioned',
        suiteId,
        sectionName: `${suiteName} / ${t('unsectioned')}`,
      },
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
      >
        {isDraggingTestCases && <div className="absolute inset-0 z-5" style={{ pointerEvents: 'auto' }} />}
        <div className="relative z-1">{children}</div>
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
                handleScopeSelection(section.id);
                if (hasChildren) {
                  toggleSectionExpansion(section.id);
                }
              }}
            >
            <div className="flex items-center mr-1.5 rtl:mr-0 rtl:ml-1.5">
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400 shrink-0 rtl:rotate-180" />
                )
              ) : (
                <div className="w-3 h-3 shrink-0" />
              )}
              <Folder className={`h-3.5 w-3.5 ml-0.5 rtl:ml-0 rtl:mr-0.5 shrink-0 ${isRoot ? 'text-blue-500' : level === 1 ? 'text-gray-500' : 'text-gray-400'}`} />
            </div>
            <span className="flex-1 text-left rtl:text-right min-w-0 truncate" title={`${section.name}${section.test_suite_name ? ` (${section.test_suite_name})` : ''}`}>
              {level > 0 && <span className="text-gray-400 mr-1 rtl:mr-0 rtl:ml-1">└─</span>}
              {section.name}
              {level === 0 && section.test_suite_name && (
                <span className="text-xs text-gray-500 ml-1 rtl:ml-0 rtl:mr-1">({section.test_suite_name})</span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-1 shrink-0">
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
        handleScopeSelection('all');
      }
    }
  };

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
    const normalizedSearchQuery = normalizeSearchValue(searchQuery);

    return apiTestCases.filter(testCase => {
      const standardSearchText = [
        testCase.title,
        testCase.description,
        testCase.reference,
        testCase.tags,
        testCase.preconditions,
        testCase.steps,
        testCase.expected_result,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !normalizedSearchQuery || standardSearchText.includes(normalizedSearchQuery);
      const matchesCustomField = matchesCustomFieldFilter(testCase);

      const matchesType = filterType === 'all' || normalizeSearchValue(testCase.test_type) === normalizeSearchValue(filterType);
      const matchesPriority = filterPriority === 'all' || testCase.priority === filterPriority;
      let matchesSuite = true;
      if (selectedTestSuite !== 'all') {
        const selectedSuiteId = getSuiteIdFromSelectionValue(selectedTestSuite);

        if (selectedSuiteId) {
          matchesSuite = testCase.test_suite_id === selectedSuiteId;
          if (isUnsectionedSelectionValue(selectedTestSuite)) {
            matchesSuite = matchesSuite && !testCase.section_id;
          }
        } else {
          const selectedSection = findSectionById(mockSections, selectedTestSuite);
          const sectionIds = selectedSection
            ? collectSectionAndDescendantIds(selectedSection)
            : [Number(selectedTestSuite)];
          matchesSuite = !!testCase.section_id && sectionIds.includes(testCase.section_id);
        }
      }

      return matchesSearch && matchesCustomField && matchesType && matchesPriority && matchesSuite;
    });
  }, [apiTestCases, mockSections, searchQuery, customFieldFilterId, customFieldFilterValue, filterType, filterPriority, selectedTestSuite, selectedCustomFieldFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, customFieldFilterId, customFieldFilterValue, filterType, filterPriority, selectedTestSuite]);

  // Pagination logic using filtered data
  const totalPages = Math.ceil(filteredAndSortedTestCases.length / itemsPerPage);
  // Clamp during render so the table never lands on an out-of-range empty
  // page after deletes/filtering/page-size changes shrink the result set.
  const safePage = Math.min(Math.max(1, currentPage), Math.max(1, totalPages));
  const startIndex = (safePage - 1) * itemsPerPage;
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
      case 'tags':
        if (value && value.length > 500) {
          return t('tagLengthExceeded', { max: 500 });
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

    const tagsError = validateField('tags', testCaseForm.tags);
    if (tagsError) errors.tags = tagsError;

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
    if (field === 'tags') {
      setValidationErrors(prev => ({
        ...prev,
        tags: validateField('tags', value)
      }));
    }
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

  const applyAIAssistantResult = () => {
    const result = aiAssistantResult;
    if (!result) return;
    if (Array.isArray(result.steps) && result.steps.length > 0) {
      setTestSteps(result.steps.map((step: any, index: number) => ({
        step_number: index + 1,
        action: step.action || '',
        expected_result: step.expected_result || '',
        step_type: step.step_type || 'manual',
      })));
      setTestCaseForm((prev) => ({ ...prev, is_multistep: true }));
    }
    if (result.expected_result) {
      setTestCaseForm((prev) => ({ ...prev, expected_result: result.expected_result }));
    }
    if (result.gherkin) {
      setTestCaseForm((prev) => ({ ...prev, steps: result.gherkin, is_multistep: false }));
    }
    if (Array.isArray(result.drafts) && result.drafts.length > 0) {
      const draft = result.drafts[0];
      setTestCaseForm((prev) => ({
        ...prev,
        title: draft.title || prev.title,
        description: draft.description || prev.description,
        preconditions: draft.preconditions || prev.preconditions,
        steps: draft.steps || prev.steps,
        expected_result: draft.expected_result || prev.expected_result,
        priority: draft.priority || prev.priority,
        test_type: draft.test_type || prev.test_type,
        tags: draft.tags || prev.tags,
        is_multistep: Array.isArray(draft.test_steps) && draft.test_steps.length > 0 ? true : prev.is_multistep,
      }));
      if (Array.isArray(draft.test_steps) && draft.test_steps.length > 0) {
        setTestSteps(draft.test_steps.map((step: any, index: number) => ({
          step_number: index + 1,
          action: step.action || '',
          expected_result: step.expected_result || '',
          step_type: step.step_type || 'manual',
        })));
      }
    }
    setAiAssistantDialogOpen(false);
  };

  const runAIDraftAssistant = async (action: AIAssistantAction) => {
    if (!currentProjectId) return;
    setAiAssistantAction(action);
    setAiAssistantLoading(true);
    setAiAssistantResult(null);
    try {
      const result = await testCasesAPI.assistDraft({
        project_id: currentProjectId,
        action,
        title: testCaseForm.title,
        description: testCaseForm.description,
        preconditions: testCaseForm.preconditions,
        steps: testCaseForm.steps,
        expected_result: testCaseForm.expected_result,
        priority: testCaseForm.priority || 'medium',
        test_type: testCaseForm.test_type || 'manual',
        tags: testCaseForm.tags,
        reference: testCaseForm.reference,
        test_steps: testSteps,
      });
      setAiAssistantResult(result);
      setAiAssistantDialogOpen(true);
    } catch (error: any) {
      console.error('AI test case draft assistant failed:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('aiAssistantFailed'),
        variant: 'destructive',
      });
    } finally {
      setAiAssistantLoading(false);
    }
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
      const data = await sharedStepsAPI.getAll(projectId ? Number(projectId) : undefined);
      setAvailableSharedSteps(data);
    } catch (error) {
      console.error('Failed to load shared steps:', error);
      setAvailableSharedSteps([]);
    } finally {
      setLoadingSharedSteps(false);
    }
  };

  const handleInsertSharedStep = async (sharedStep: SharedStep) => {
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
      await sharedStepsAPI.incrementUsage(sharedStep.id);
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
      testCaseForm.tags.trim() !== '' ||
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
      tags: '',
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
        tags: '',
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

    // Get the selected section ID. Suite and unsectioned scopes intentionally
    // create the test case without a section, but still inside currentTestSuiteId.
    let sectionId: number | undefined = undefined;
    if (selectedTestSuite !== 'all' && !isSuiteSelectionValue(selectedTestSuite)) {
      sectionId = parseInt(selectedTestSuite);
    }

    const newTestCase = {
      title: testCaseForm.title,
      description: testCaseForm.description,
      reference: testCaseForm.reference,
      tags: testCaseForm.tags.trim(),
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
        tags: '',
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
        description: t('testCaseCreatedSuccessfully', {section: getSelectedScopeName()}),
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

  // Helper function to get selected scope name for creation and messages.
  const getSelectedScopeName = () => {
    if (selectedTestSuite === 'all') {
      const activeSuite = testSuites.find((suite) => suite.id === currentTestSuiteId);
      return activeSuite ? `${activeSuite.name} / ${t('unsectioned')}` : t('noSection');
    }

    const selectedSuiteId = getSuiteIdFromSelectionValue(selectedTestSuite);
    if (selectedSuiteId) {
      const suiteName = testSuites.find((suite) => suite.id === selectedSuiteId)?.name || t('suiteName');
      return isUnsectionedSelectionValue(selectedTestSuite)
        ? `${suiteName} / ${t('unsectioned')}`
        : suiteName;
    }

    return findSectionById(mockSections, selectedTestSuite)?.name || t('noSection');
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
          ? await customFieldsAPI.getDefinitions(currentProjectId, 'test_case').catch(() => [])
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
      setImportSectionId(selectedTestSuite === 'all' || isSuiteSelectionValue(selectedTestSuite) ? 'none' : selectedTestSuite);
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
    const pageIds = paginatedTestCases.map(tc => tc.id);
    if (isChecked) {
      // Merge with existing selection so other pages stay selected.
      setSelectedTestCases(prev => Array.from(new Set([...prev, ...pageIds])));
    } else {
      // Only clear the rows visible on the current page.
      setSelectedTestCases(prev => prev.filter(id => !pageIds.includes(id)));
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
      reference: testCase.reference || '',
      tags: testCase.tags || '',
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
      navigate(`/projects/${projectId}/test-cases/${testCase.project_seq ?? testCase.id}/execute`);
    } else {
      navigate(`/test-cases/${testCase.project_seq ?? testCase.id}/execute`);
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
      'tags': t('tags'),
    };
    return fieldTranslations[fieldName] || fieldName;
  };

  const handleViewHistory = async (testCase: TestCase) => {
    setSelectedTestCaseForHistory(testCase);
    setHistoryDialogOpen(true);
    setIsLoadingRevisions(true);

    try {
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
      navigate(`/projects/${projectId}/test-cases/${selectedTestCaseForHistory.project_seq ?? selectedTestCaseForHistory.id}/revisions`);
    } else if (selectedTestCaseForHistory) {
      navigate(`/test-cases/${selectedTestCaseForHistory.project_seq ?? selectedTestCaseForHistory.id}/revisions`);
    }
  };

  const handleRestoreRevision = async (revision: any) => {
    if (!selectedTestCaseForHistory) return;

    if (window.confirm(t('confirmRestoreRevision') || `Are you sure you want to restore revision ${revision.revision_number}?`)) {
      try {
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
      setSelectedTestSuite(getSuiteSelectionValue(createdSuite.id));
      setTestSuites(prev => [
        ...prev.filter((suite) => suite.id !== createdSuite.id),
        { id: createdSuite.id, name: createdSuite.name, description: createdSuite.description },
      ]);
      setSuiteName('');
      setSuiteDescription('');
      setIsSuiteDialogOpen(false);

      toast({
        title: t('success'),
        description: t('testSuiteCreatedSuccessfully'),
      });

      await loadTestSuite(createdSuite.id);
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
      const tagsError = validateField('tags', testCaseForm.tags);
      if (tagsError) {
        setValidationErrors(prev => ({ ...prev, tags: tagsError }));
        toast({
          title: t('validationError'),
          description: tagsError,
          variant: "destructive",
        });
        return;
      }

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
        tags: '',
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
    setDestinationSection(testCase.section_id ? String(testCase.section_id) : '');
    setMoveDialogOpen(true);
  };

  // Resolve a section name from its id within the section tree (for messages).
  const findSectionNameById = (sectionId: string, sections: Section[]): string => {
    for (const section of sections) {
      if (section.id === sectionId) return section.name;
      if (section.children && section.children.length > 0) {
        const found = findSectionNameById(sectionId, section.children);
        if (found) return found;
      }
    }
    return '';
  };

  const handleConfirmMove = async () => {
    if (!selectedTestCaseToMove || !destinationSection) return;

    const testCaseToMove = selectedTestCaseToMove;
    const targetSection = findSectionById(mockSections, destinationSection);
    const sectionName = targetSection?.name || findSectionNameById(destinationSection, mockSections) || destinationSection;

    if (!targetSection?.test_suite_id) {
      toast({
        title: t('error'),
        description: t('failedToMoveTestCases'),
        variant: "destructive",
      });
      return;
    }

    try {
      // Persist only the placement fields to avoid re-escaping every text field server-side.
      await testCasesAPI.update(testCaseToMove.id, {
        section_id: parseInt(destinationSection),
        test_suite_id: targetSection.test_suite_id,
      });

      setMoveDialogOpen(false);
      setSelectedTestCaseToMove(null);
      setDestinationSection('');

      toast({
        title: t('success'),
        description: t('movedTestCasesSuccessfully', { count: 1, sectionName }),
      });

      // Refresh data so the test case appears under its new section.
      await loadTestCases();
      await loadSections();
    } catch (error) {
      console.error('Failed to move test case:', error);
      toast({
        title: t('error'),
        description: t('failedToMoveTestCases'),
        variant: "destructive",
      });
    }
  };

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as number);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (over && (over.data.current?.type === 'section' || over.data.current?.type === 'unsectioned')) {
      setDragOverSectionId(String(over.data.current.sectionId || over.data.current.suiteId));
    } else {
      setDragOverSectionId(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveDragId(null);
    setDragOverSectionId(null);

    if (!over) return;

    if (over.data.current?.type === 'unsectioned') {
      const suiteId = Number(over.data.current.suiteId);
      const sectionName = over.data.current.sectionName || t('unsectioned');

      if (!Number.isInteger(suiteId) || suiteId <= 0) {
        toast({
          title: t('error'),
          description: t('failedToMoveTestCases'),
          variant: "destructive",
        });
        return;
      }

      const testCasesToMove = selectedTestCases.length > 0 && selectedTestCases.includes(active.id as number)
        ? selectedTestCases
        : [active.id as number];

      try {
        for (const testCaseId of testCasesToMove) {
          await testCasesAPI.update(testCaseId, {
            section_id: null,
            test_suite_id: suiteId,
          });
        }

        toast({
          title: t('success'),
          description: t('movedTestCasesSuccessfully', {count: testCasesToMove.length, sectionName}),
        });

        await loadTestCases();
        await loadSections();
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

    // Check if dropping on a section
    if (over.data.current?.type === 'section') {
      const sectionId = over.data.current.sectionId;
      const sectionName = over.data.current.sectionName;
      const targetSection = findSectionById(mockSections, String(sectionId));

      if (!targetSection?.test_suite_id) {
        toast({
          title: t('error'),
          description: t('failedToMoveTestCases'),
          variant: "destructive",
        });
        return;
      }

      // Get test cases to move (either selected ones or just the dragged one)
      const testCasesToMove = selectedTestCases.length > 0 && selectedTestCases.includes(active.id as number)
        ? selectedTestCases
        : [active.id as number];

      try {
        // Move each test case to the new section
        for (const testCaseId of testCasesToMove) {
          const testCase = apiTestCases.find(tc => tc.id === testCaseId);
          if (testCase) {
            // Persist only the placement fields to avoid re-escaping every text field server-side.
            await testCasesAPI.update(testCaseId, {
              section_id: parseInt(sectionId),
              test_suite_id: targetSection.test_suite_id,
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
          {currentTestSuiteId && (
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/projects/${currentProjectId}/test-suites/${currentTestSuiteId}`)
              }
              title={t('sectionsManagedInTestSuites')}
            >
              <FolderPlus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('openTestSuiteToManageSections')}
            </Button>
          )}
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
              {canWrite && (
                <DialogTrigger asChild>
                  <Button>
                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('createTestSuite')}
                  </Button>
                </DialogTrigger>
              )}
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
                testCaseForm.tags.trim() !== '' ||
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
            {canWrite && (
              <DialogTrigger asChild>
                <Button>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('addNewTestCase')}
                </Button>
              </DialogTrigger>
            )}
            <DialogContent isRTL={isRTL} className={`sm:max-w-[900px] max-h-[80vh] overflow-y-auto ${isRTL ? 'font-vazir' : ''}`} onKeyDown={handleKeyDown}>
              <DialogHeader>
                <DialogTitle>{t('createNewTestCase')}</DialogTitle>
                <DialogDescription>
                  {t('createTestCaseDescription')}
                </DialogDescription>
                {selectedTestSuite !== 'all' && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-700">
                    <span className="text-sm text-blue-700 dark:text-blue-300">
                      📁 {t('testCaseWillBeAddedTo')} <strong>{getSelectedScopeName()}</strong>
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
                    <Label htmlFor="tags" className={`text-right ${isRTL ? 'text-left' : ''}`}>{t('tags')}</Label>
                    <div className="col-span-3 space-y-1">
                      <Input
                        id="tags"
                        value={testCaseForm.tags}
                        onChange={(e) => handleFieldChange('tags', e.target.value)}
                        placeholder={t('enterTagsSeparatedByCommas')}
                        maxLength={500}
                        className={validationErrors.tags ? 'border-red-500 focus:border-red-500' : ''}
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{t('tagsHelper')}</span>
                        <span>{testCaseForm.tags.length}/500</span>
                      </div>
                      {validationErrors.tags && (
                        <p className="text-red-500 text-sm mt-1">{validationErrors.tags}</p>
                      )}
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
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Wand2 className="h-4 w-4 text-indigo-600" />
                      {t('aiTestCaseAssistant')}
                    </div>
                    {loadingAIStatus ? (
                      <div className="mb-2 rounded-md border border-slate-200 bg-white/70 p-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
                        <Loader2 className={`inline h-3.5 w-3.5 animate-spin ${isRTL ? 'ml-1' : 'mr-1'}`} />
                        {t('loading')}
                      </div>
                    ) : aiStatus && !aiStatus.available ? (
                      <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        <AlertTriangle className={`inline h-3.5 w-3.5 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                        {t('aiEnabledTokenMissing')}
                      </div>
                    ) : (
                      <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">{t('aiDraftReviewRequired')}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {([
                        ['suggest_steps', t('suggestSteps')],
                        ['improve_expected_result', t('improveExpectedResult')],
                        ['add_negative_cases', t('addNegativeCases')],
                        ['convert_to_gherkin', t('convertToGherkin')],
                        ['split_broad_case', t('splitBroadCase')],
                      ] as [AIAssistantAction, string][]).map(([action, label]) => (
                        <Button key={action} type="button" variant="outline" size="sm" onClick={() => runAIDraftAssistant(action)} disabled={aiAssistantLoading || !currentProjectId || loadingAIStatus || aiStatus?.available === false}>
                          {aiAssistantLoading && aiAssistantAction === action ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Wand2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">{t('testCaseDescription')}</Label>
                    <ContentEditor
                      value={testCaseForm.description}
                      onChange={(value) => handleFieldChange('description', value)}
                      placeholder={t('describeTestCase')}
                      format="markdown"
                      minHeight="120px"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="precondition">{t('fieldPreconditions')}</Label>
                    <ContentEditor
                      value={testCaseForm.preconditions}
                      onChange={(value) => handleFieldChange('preconditions', value)}
                      placeholder={t('describePreconditions')}
                      format="markdown"
                      minHeight="120px"
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
                      <ContentEditor
                        value={testCaseForm.steps}
                        onChange={(value) => handleFieldChange('steps', value)}
                        placeholder={t('stepPlaceholder')}
                        format="markdown"
                        minHeight="180px"
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
                      <ContentEditor
                        value={testCaseForm.expected_result}
                        onChange={(value) => handleFieldChange('expected_result', value)}
                        placeholder={t('describeExpectedOutcome')}
                        format="markdown"
                        minHeight="150px"
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

          <Dialog open={aiAssistantDialogOpen} onOpenChange={setAiAssistantDialogOpen}>
            <DialogContent isRTL={isRTL} className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{t('aiAssistantResult')}</DialogTitle>
                <DialogDescription>{t('aiAssistantResultDesc')}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 text-sm">
                {aiAssistantResult?.warnings?.map((warning: string, index: number) => (
                  <div key={index} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    {warning}
                  </div>
                ))}
                {aiAssistantResult?.expected_result && <AIPreviewBlock title={t('expectedResult')} value={aiAssistantResult.expected_result} />}
                {aiAssistantResult?.gherkin && <AIPreviewBlock title={t('gherkinSyntax')} value={aiAssistantResult.gherkin} />}
                {Array.isArray(aiAssistantResult?.steps) && aiAssistantResult.steps.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-medium">{t('testSteps')}</h3>
                    {aiAssistantResult.steps.map((step: any, index: number) => (
                      <div key={index} className="rounded-md border p-3 dark:border-slate-800">
                        <p className="font-medium">{index + 1}. {step.action}</p>
                        <p className="mt-1 text-muted-foreground">{step.expected_result}</p>
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(aiAssistantResult?.drafts) && aiAssistantResult.drafts.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-medium">{t('generatedDrafts')}</h3>
                    {aiAssistantResult.drafts.map((draft: any, index: number) => (
                      <div key={index} className="rounded-md border p-3 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{draft.title}</p>
                          {typeof draft.confidence === 'number' && <Badge variant="outline">{t('aiConfidence', { confidence: Math.round(draft.confidence * 100) })}</Badge>}
                        </div>
                        <p className="mt-1 text-muted-foreground">{draft.description}</p>
                      </div>
                    ))}
                  </div>
                )}
                {!aiAssistantResult?.expected_result && !aiAssistantResult?.gherkin && (!Array.isArray(aiAssistantResult?.steps) || aiAssistantResult.steps.length === 0) && (!Array.isArray(aiAssistantResult?.drafts) || aiAssistantResult.drafts.length === 0) && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    {t('aiNoDraftContent')}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAiAssistantDialogOpen(false)}>{t('cancel')}</Button>
                <Button type="button" onClick={applyAIAssistantResult}>{t('applyDraft')}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
        {sectionsPanelCollapsed ? (
          <div className="shrink-0">
            <Button
              variant="outline"
              onClick={() => setSectionsPanelCollapsed(false)}
              title={t('sections')}
              className="flex h-auto flex-col items-center gap-2 px-2 py-3"
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              <Layers className="h-4 w-4" />
            </Button>
          </div>
        ) : (
        <div className="w-64 shrink-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setSectionsPanelCollapsed(true)}
                    title={t('collapse')}
                  >
                    <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                  </Button>
                  {t('sections')}
                </span>
                {currentTestSuiteId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(`/projects/${currentProjectId}/test-suites/${currentTestSuiteId}`)
                    }
                    title={t('sectionsManagedInTestSuites')}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
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
                    onClick={() => handleScopeSelection('all')}
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

                  const normalizedQuery = sectionSearchQuery.trim().toLowerCase();
                  const sectionsBySuite = new Map<number, { name: string; sections: Section[]; matchesSuite: boolean }>();

                  testSuites.forEach((suite) => {
                    const matchesSuite = !normalizedQuery || suite.name.toLowerCase().includes(normalizedQuery);
                    const matchesUnsectioned = !!normalizedQuery && t('unsectioned').toLowerCase().includes(normalizedQuery);
                    if (matchesSuite || matchesUnsectioned || !normalizedQuery) {
                      sectionsBySuite.set(suite.id, {
                        name: suite.name,
                        sections: [],
                        matchesSuite,
                      });
                    }
                  });

                  // Apply search filter first
                  const filteredSections = filterSections(mockSections, sectionSearchQuery);

                  filteredSections.forEach(section => {
                    if (section.test_suite_id) {
                      if (!sectionsBySuite.has(section.test_suite_id)) {
                        sectionsBySuite.set(section.test_suite_id, {
                          name: section.test_suite_name || 'Unknown Suite',
                          sections: [],
                          matchesSuite: false,
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
                      <Button
                        variant={selectedTestSuite === getSuiteSelectionValue(suiteId) ? 'secondary' : 'ghost'}
                        className="mb-1 h-auto w-full justify-start px-3 py-1.5 text-xs font-semibold"
                        onClick={() => handleScopeSelection(getSuiteSelectionValue(suiteId))}
                      >
                        <Folder className={`${isRTL ? 'ml-2' : 'mr-2'} h-4 w-4 text-blue-600`} />
                        <span className="min-w-0 flex-1 truncate text-left rtl:text-right">
                          {suiteData.name}
                        </span>
                        <span className="shrink-0 text-xs text-gray-500">
                          {t('testCasesCountSimple', { count: apiTestCases.filter((tc) => tc.test_suite_id === suiteId).length })}
                        </span>
                      </Button>
                      <div className="ml-2">
                        {(() => {
                          const unsectionedValue = getUnsectionedSelectionValue(suiteId);
                          const unsectionedCount = apiTestCases.filter((tc) => tc.test_suite_id === suiteId && !tc.section_id).length;
                          const unsectionedMatches = t('unsectioned').toLowerCase().includes(normalizedQuery);
                          const showUnsectioned = !normalizedQuery || suiteData.matchesSuite || unsectionedMatches || unsectionedCount > 0;

                          return (
                            <>
                              {showUnsectioned && (
                                <DroppableUnsectioned suiteId={suiteId} suiteName={suiteData.name}>
                                  <Button
                                    variant={selectedTestSuite === unsectionedValue ? 'secondary' : 'ghost'}
                                    className="h-auto w-full justify-start px-3 py-1 text-xs font-normal"
                                    onClick={() => handleScopeSelection(unsectionedValue)}
                                    title={t('unsectionedTooltip')}
                                  >
                                    <Folder className={`${isRTL ? 'ml-2' : 'mr-2'} h-3.5 w-3.5 text-gray-400`} />
                                    <span className="min-w-0 flex-1 truncate text-left rtl:text-right">{t('unsectioned')}</span>
                                    <span className="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800">
                                      {unsectionedCount}
                                    </span>
                                  </Button>
                                </DroppableUnsectioned>
                              )}
                              {suiteData.sections.length > 0 ? (
                                renderSectionTree(suiteData.sections)
                              ) : (
                                <p className="px-3 py-1.5 text-xs text-gray-500">{t('noSectionsYetForSuite')}</p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ));
                })()}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Breadcrumb Navigation */}
          {(() => {
            const breadcrumbPath = getBreadcrumbPath();
            return breadcrumbPath.length >= 1 ? (
              <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm">
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
                            handleScopeSelection(sectionId);
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
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm">
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
                  <Button variant="outline" size="sm" onClick={() => setBulkEditOpen(true)}>
                    <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('bulkEdit')}
                  </Button>
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
              {currentProjectId && (
                <SavedFilters
                  projectId={currentProjectId}
                  scope="test_cases"
                  hasActiveFilters={
                    searchQuery.trim() !== ''
                    || filterType !== 'all'
                    || filterPriority !== 'all'
                    || customFieldFilterId !== CUSTOM_FIELD_FILTER_ALL
                    || customFieldFilterValue !== CUSTOM_FIELD_FILTER_ANY_VALUE
                  }
                  currentDefinition={{
                    searchQuery,
                    filterType,
                    filterPriority,
                    customFieldFilterId,
                    customFieldFilterValue,
                  }}
                  onApply={(def) => {
                    if (typeof def.searchQuery === 'string') setSearchQuery(def.searchQuery);
                    if (typeof def.filterType === 'string') setFilterType(def.filterType);
                    if (typeof def.filterPriority === 'string') setFilterPriority(def.filterPriority);
                    if (typeof def.customFieldFilterId === 'string') setCustomFieldFilterId(def.customFieldFilterId);
                    if (typeof def.customFieldFilterValue === 'string') setCustomFieldFilterValue(def.customFieldFilterValue);
                  }}
                />
              )}
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
                      <TableRow className="bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <TableHead className="w-12">
                          <Checkbox
                            checked={
                              paginatedTestCases.length > 0 && paginatedTestCases.every(tc => selectedTestCases.includes(tc.id))
                                ? true
                                : paginatedTestCases.some(tc => selectedTestCases.includes(tc.id))
                                  ? 'indeterminate'
                                  : false
                            }
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" size="sm" onClick={() => { setSortField('id'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            ID {sortField === 'id' && (sortDirection === 'asc' ? <ArrowUp className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" /> : <ArrowDown className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" />)}
                          </Button>
                        </TableHead>
                        <TableHead>
                          <Button variant="ghost" size="sm" onClick={() => { setSortField('title'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                            {t('title')} {sortField === 'title' && (sortDirection === 'asc' ? <ArrowUp className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" /> : <ArrowDown className="ml-1 rtl:ml-0 rtl:mr-1 h-3 w-3" />)}
                          </Button>
                        </TableHead>
                        <TableHead>{t('type')}</TableHead>
                        <TableHead>{t('priority')}</TableHead>
                        <TableHead>{t('tags')}</TableHead>
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
                        <SortableTestCaseRow
                          key={testCase.id}
                          testCase={testCase}
                          onEdit={handleEdit}
                          onMove={handleMoveTestCase}
                          onExecute={handleExecute}
                          onViewHistory={handleViewHistory}
                          onDelete={handleDelete}
                          getTestCaseDetailUrl={getTestCaseDetailUrl}
                          selectedTestCases={selectedTestCases}
                          handleSelectTestCase={handleSelectTestCase}
                          getTypeBadge={getTypeBadge}
                          getPriorityBadge={getPriorityBadge}
                          isRTL={isRTL}
                        />
                      ))}
                      {!loading && paginatedTestCases.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={8} className="h-40 text-center">
                            <div className="flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                              <FileText className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                              <p className="text-sm font-medium">{t('noTestCasesFound')}</p>
                              <p className="text-xs text-gray-400">{t('tryAdjustingSearch')}</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </SortableContext>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mt-4">
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                {t('showing', { start: filteredAndSortedTestCases.length > 0 ? startIndex + 1 : 0, end: endIndex, total: filteredAndSortedTestCases.length })}
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
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {t('previous')}
              </Button>
              <span className="text-sm">{t('pageOf', { current: safePage, total: Math.max(1, totalPages) })}</span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>
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
                  <div className={`absolute top-0 w-4 h-4 rounded-full bg-white border-2 border-blue-500 ${isRTL ? 'right-[-9px] left-auto' : 'left-[-9px] right-auto'}`} />
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
                    {rev.changed_fields && Object.keys(rev.changed_fields).length > 0 && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        <span className="font-medium">{t('updatedFields') || 'Updated fields'}:</span> {Object.keys(rev.changed_fields).map(translateFieldName).join(', ')}
                      </p>
                    )}
                    <div className="flex items-center text-xs text-gray-500">
                      <User className={`h-3 w-3 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {t('by')} {rev.creator?.full_name || rev.creator?.username || t('unknown')}
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
              <p>{t('currentSection')}: <span className="font-medium">{selectedTestCaseToMove?.section}</span></p>
              <p>{t('availableSections')}: <span className="font-medium">{t('mainSectionsCount', { count: mockSections.length })}</span></p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>{t('cancelMove')}</Button>
            <Button onClick={handleConfirmMove} disabled={!destinationSection || destinationSection === String(selectedTestCaseToMove?.section_id ?? '')}>
              {t('confirmMove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog (Simplified for example) */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t('editTestCaseTitle', { title: editingTestCase?.title || '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('title')}</Label>
              <Input value={testCaseForm.title} onChange={(e) => handleFieldChange('title', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('description')}</Label>
              <Textarea value={testCaseForm.description} onChange={(e) => handleFieldChange('description', e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="reference">{t('reference')}</Label>
              <ReferenceField
                value={testCaseForm.reference}
                onChange={(value) => handleFieldChange('reference', value)}
                projectId={currentProjectId ?? undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tags">{t('tags')}</Label>
              <Input
                id="edit-tags"
                value={testCaseForm.tags}
                onChange={(e) => handleFieldChange('tags', e.target.value)}
                placeholder={t('enterTagsSeparatedByCommas')}
                maxLength={500}
              />
              {validationErrors.tags && (
                <p className="text-sm text-red-500">{validationErrors.tags}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('type')}</Label>
                <Select value={testCaseForm.test_type} onValueChange={(value) => handleFieldChange('test_type', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{t('manual')}</SelectItem>
                    <SelectItem value="automated">{t('automated')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('priority')}</Label>
                <Select value={testCaseForm.priority} onValueChange={(value) => handleFieldChange('priority', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('low')}</SelectItem>
                    <SelectItem value="medium">{t('medium')}</SelectItem>
                    <SelectItem value="high">{t('high')}</SelectItem>
                    <SelectItem value="critical">{t('critical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleUpdateTestCase}>{t('saveChanges')}</Button>
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
                <div className="rounded-3xl border border-dashed bg-card p-8 text-center text-card-foreground shadow-xs">
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
                <span className={`${isRTL ? 'mr-3' : 'ml-3'} text-gray-600`}>{t('loadingSharedSteps')}</span>
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
                              {t('usedTimes', { count: step.usage_count || 0 })}
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

      <BulkEditTestCasesDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        ids={selectedTestCases}
        priorityOptions={priorityOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
        testTypeOptions={testTypes.map((tt) => ({
          value: tt,
          label: testTypeOptions.find((o) => o.value === tt)?.label || tt.charAt(0).toUpperCase() + tt.slice(1),
        }))}
        onApplied={() => {
          // Refresh the list so updated rows reflect the new values, and
          // clear the selection so users don't immediately re-apply.
          loadTestCases();
          setSelectedTestCases([]);
        }}
      />
    </div>
  );
}

function AIPreviewBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium">{title}</h3>
      <pre className="whitespace-pre-wrap rounded-md border bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">{value}</pre>
    </div>
  );
}
