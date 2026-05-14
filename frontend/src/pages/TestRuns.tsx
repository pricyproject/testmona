import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  History,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Folder,
  FileText,
  Calendar,
  User,
  Target,
  CheckCircle2,
  XCircle,
  PlayCircle,
  CircleDot,
  Ban,
  PauseCircle,
} from 'lucide-react';
import { testRunsAPI, testCasesAPI, sectionsAPI, usersAPI, testSuitesAPI, testResultsAPI, environmentsAPI, enumsAPI } from '@/lib/api';
import { TestRun, TestCase } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';

// Define User interface locally since it's not in types
interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
}

// Define Section interface to match backend TestCaseSection model
interface Section {
  id: number;
  name: string;
  description?: string;
  test_suite_id: number;
  parent_section_id?: number;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  subsections?: Section[];
}

interface PriorityOption {
  value: string;
  label: string;
  weight: number;
  color?: string;
  isDefault?: boolean;
}

export function TestRuns() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const { t, isRTL } = useTranslation();
  const { user: currentUser } = useAuthStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [runName, setRunName] = useState('');
  const [runDescription, setRunDescription] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [environment, setEnvironment] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [priority, setPriority] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const runNameInputRef = useRef<HTMLInputElement>(null);
  const [selectedTestRun, setSelectedTestRun] = useState<TestRun | null>(null);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testSuites, setTestSuites] = useState<any[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [environments, setEnvironments] = useState<any[]>([]);
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);
  const [selectedTestSuites, setSelectedTestSuites] = useState<number[]>([]);
  const [selectedSections, setSelectedSections] = useState<number[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [testRunSearchQuery, setTestRunSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(6);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isPrioritiesLoading, setIsPrioritiesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Validate projectId from URL params
  const currentProjectId = projectId ? parseInt(projectId) : null;
  const linkedTestPlanId = parsePositiveQueryNumber(searchParams.get('test_plan_id'));
  const linkedMilestoneId = parsePositiveQueryNumber(searchParams.get('milestone_id'));

  const totalPages = Math.max(1, Math.ceil(testRuns.length / itemsPerPage));
  const hasActiveTestRunFilters =
    testRunSearchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    assigneeFilter !== 'all';
  const paginatedTestRuns = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return testRuns.slice(startIndex, startIndex + itemsPerPage);
  }, [testRuns, currentPage, itemsPerPage]);
  const [priorityOptions, setPriorityOptions] = useState<PriorityOption[]>([]);
  const paginationStart = testRuns.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const paginationEnd = Math.min(currentPage * itemsPerPage, testRuns.length);
  const defaultPriorityValue = useMemo(
    () => priorityOptions.find((option) => option.isDefault)?.value || priorityOptions[0]?.value || '',
    [priorityOptions]
  );

  const getStatusMeta = (status: TestRun['status']) => {
    const normalizedStatus = status || 'pending';
    const statusConfig = {
      pending: {
        label: t('testRunStatusPending'),
        icon: CircleDot,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700',
        accentClass: 'from-slate-500 to-slate-400',
      },
      running: {
        label: t('testRunStatusRunning'),
        icon: PlayCircle,
        badgeClass: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
        accentClass: 'from-blue-500 to-cyan-400',
      },
      in_progress: {
        label: t('testRunStatusRunning'),
        icon: PlayCircle,
        badgeClass: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
        accentClass: 'from-blue-500 to-cyan-400',
      },
      passed: {
        label: t('testRunStatusPassed'),
        icon: CheckCircle2,
        badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
        accentClass: 'from-emerald-500 to-lime-400',
      },
      failed: {
        label: t('testRunStatusFailed'),
        icon: XCircle,
        badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
        accentClass: 'from-red-500 to-rose-400',
      },
      skipped: {
        label: t('testRunStatusSkipped'),
        icon: PauseCircle,
        badgeClass: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
        accentClass: 'from-amber-500 to-yellow-400',
      },
      blocked: {
        label: t('testRunStatusBlocked'),
        icon: Ban,
        badgeClass: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700',
        accentClass: 'from-orange-500 to-red-400',
      },
      completed: {
        label: t('testRunStatusCompleted'),
        icon: CheckCircle2,
        badgeClass: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700',
        accentClass: 'from-indigo-500 to-blue-400',
      },
    } satisfies Record<TestRun['status'], {
      label: string;
      icon: typeof CircleDot;
      badgeClass: string;
      accentClass: string;
    }>;

    return statusConfig[normalizedStatus] || statusConfig.pending;
  };

  const getAssigneeName = (assignedToId?: number) => {
    if (!assignedToId) return t('unassigned');
    const assignee = users.find((user) => user.id === assignedToId);
    return assignee?.full_name || assignee?.username || assignee?.email || t('unassigned');
  };

  const getProgressMeta = (run: TestRun) => {
    const total = run.total_tests ?? 0;
    const executed = run.executed_tests ?? 0;
    const percent = total > 0 ? Math.round(run.progress_percent ?? (executed / total) * 100) : 0;

    return { total, executed, percent };
  };

  const getCompletionLabel = (run: TestRun) => {
    if (run.completed_at) {
      return new Date(run.completed_at).toLocaleString();
    }

    return run.status === 'completed' ? t('completionTimeMissing') : t('notCompleted');
  };

  const getAssigneeFilterValue = (value?: number | 'me') => {
    if (value === 'me') {
      return currentUser?.id ? String(currentUser.id) : 'all';
    }

    return value ? String(value) : 'all';
  };

  const getSelectedAssigneeId = () => {
    if (!assignedTo) return undefined;
    if (assignedTo === 'me') return currentUser?.id;
    const selectedId = parseInt(assignedTo, 10);
    return Number.isInteger(selectedId) ? selectedId : undefined;
  };

  const formatDateTime = (date?: string) => (
    date ? new Date(date).toLocaleString() : t('notStarted')
  );

  const getRunStartedAt = (run: TestRun) => {
    if (run.started_at) {
      return run.started_at;
    }

    return ['running', 'in_progress', 'completed', 'passed', 'failed', 'blocked'].includes(run.status)
      ? run.created_at
      : undefined;
  };

  const clearTestRunFilters = () => {
    setTestRunSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setAssigneeFilter('all');
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [testRuns.length, itemsPerPage]);

  useEffect(() => {
    const loadPriorityOptions = async () => {
      try {
        setIsPrioritiesLoading(true);
        const prioritiesData = await enumsAPI.getPriorities();
        const apiPriorityOptions = (Array.isArray(prioritiesData) ? prioritiesData : [])
          .filter((item: any) => item?.name)
          .sort((a: any, b: any) => Number(b.value || 0) - Number(a.value || 0))
          .map((item: any) => ({
            value: String(item.name).toLowerCase(),
            label: String(item.name),
            weight: Number(item.value || 0),
            color: item.color,
            isDefault: Boolean(item.is_default),
          }));

        setPriorityOptions(apiPriorityOptions);

        const defaultOption =
          apiPriorityOptions.find((option) => option.isDefault) ||
          apiPriorityOptions[0];

        setPriority((currentPriority) =>
          currentPriority && apiPriorityOptions.some((option) => option.value === currentPriority)
            ? currentPriority
            : defaultOption?.value || ''
        );

        setPriorityFilter((currentFilter) =>
          currentFilter === 'all' || apiPriorityOptions.some((option) => option.value === currentFilter)
            ? currentFilter
            : 'all'
        );
      } catch (loadPriorityError) {
        console.error('Failed to load priority options from API:', loadPriorityError);
        setPriorityOptions([]);
        setPriority('');
        setPriorityFilter('all');
      } finally {
        setIsPrioritiesLoading(false);
      }
    };

    loadPriorityOptions();
  }, []);

  useEffect(() => {
    // Auto-focus on name input when dialog opens
    if (isCreateDialogOpen && runNameInputRef.current) {
      setTimeout(() => runNameInputRef.current?.focus(), 100);
    }
  }, [isCreateDialogOpen]);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(
      runName.trim() !== '' || 
      runDescription.trim() !== '' || 
      scheduledDate !== '' || 
      environment !== '' || 
      assignedTo !== '' || 
      estimatedDuration !== '' ||
      priority !== defaultPriorityValue ||
      selectedTestCases.length > 0 ||
      selectedTestSuites.length > 0 ||
      selectedSections.length > 0
    );
  }, [runName, runDescription, scheduledDate, environment, assignedTo, estimatedDuration, priority, defaultPriorityValue, selectedTestCases, selectedTestSuites, selectedSections]);

  useEffect(() => {
    // Validate projectId is a valid positive integer
    if (!currentProjectId || isNaN(currentProjectId) || currentProjectId <= 0) {
      setError('Invalid Project ID');
      setIsLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      loadData();
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [projectId, testRunSearchQuery, statusFilter, priorityFilter, assigneeFilter, linkedTestPlanId, linkedMilestoneId]);

  const loadData = async () => {
    if (!currentProjectId || isNaN(currentProjectId) || currentProjectId <= 0) return;
    
    try {
      setIsLoading(true);
      setError(null);
      const selectedAssigneeId = assigneeFilter !== 'all' ? parseInt(assigneeFilter, 10) : undefined;
      const [testRunsData, testCasesData, testSuitesData, usersData, sectionsData, environmentsData] = await Promise.all([
        testRunsAPI.getAll(currentProjectId, 0, 500, {
          search: testRunSearchQuery,
          status: statusFilter,
          priority: priorityFilter,
          assigned_to: Number.isInteger(selectedAssigneeId) ? selectedAssigneeId : undefined,
          test_plan_id: linkedTestPlanId,
          milestone_id: linkedMilestoneId,
        }).catch(err => {
          if (err.response?.status === 404) {
            setError('Project not found');
            return [];
          }
          throw err;
        }),
        testCasesAPI.getAll(currentProjectId, undefined, undefined, 'id', 'asc', 0, 500).catch(() => []),
        testSuitesAPI.getAll(currentProjectId).catch(() => []),
        usersAPI.getAll().catch(() => []),
        sectionsAPI.getByProject(currentProjectId).catch(() => []),
        environmentsAPI.getAll(currentProjectId).catch(() => []),
      ]);
      setTestRuns(testRunsData);
      setTestCases(testCasesData);
      setTestSuites(testSuitesData);
      setUsers(usersData);
      setSections(sectionsData);
      setEnvironments(environmentsData);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Failed to load test runs');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTestRun = async () => {
    if (!runName.trim() || selectedTestCases.length === 0) {
      setError(t('pleaseEnterRunNameAndSelectCases'));
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      
      const newTestRun = await testRunsAPI.create({
        name: runName,
        description: runDescription || undefined,
        project_id: currentProjectId,
        test_plan_id: linkedTestPlanId,
        milestone_id: linkedMilestoneId,
        status: 'pending',
        environment_id: environment ? parseInt(environment) : undefined,
        scheduled_date: scheduledDate || undefined,
        assigned_to: getSelectedAssigneeId(),
        estimated_duration: estimatedDuration ? parseInt(estimatedDuration) : undefined,
        priority: priority || undefined,
      });
      
      // Create test results for each selected test case
      const testResultsPromises = selectedTestCases.map(testCaseId =>
        testResultsAPI.create({
          test_run_id: newTestRun.id,
          test_case_id: testCaseId,
          status: 'not_tested',
          actual_result: undefined,
          comments: undefined,
          execution_time: undefined,
          executed_by: undefined,
        })
      );
      
      await Promise.all(testResultsPromises);
      
      setTestRuns([newTestRun, ...testRuns]);
      // Reset form
      setRunName('');
      setRunDescription('');
      setScheduledDate('');
      setEnvironment('');
      setAssignedTo('');
      setEstimatedDuration('');
      setPriority(defaultPriorityValue);
      setSelectedTestCases([]);
      setSelectedTestSuites([]);
      setSelectedSections([]);
      setHasUnsavedChanges(false);
      setIsCreateDialogOpen(false);
      
      // Navigate to the new test run detail page
      navigate(`/projects/${currentProjectId}/test-runs/${newTestRun.id}`);
    } catch (err) {
      console.error('Failed to create test run:', err);
      setError(t('failedToCreateTestRun'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsCreateDialogOpen(open);
      if (!open) {
        // Reset form when closing
        setRunName('');
        setRunDescription('');
        setScheduledDate('');
        setEnvironment('');
        setAssignedTo('');
        setEstimatedDuration('');
        setPriority(defaultPriorityValue);
        setSelectedTestCases([]);
        setSelectedTestSuites([]);
        setSelectedSections([]);
        setHasUnsavedChanges(false);
        setTouchedFields({});
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      setRunName('');
      setRunDescription('');
      setScheduledDate('');
      setEnvironment('');
      setAssignedTo('');
      setEstimatedDuration('');
      setPriority(defaultPriorityValue);
      setSelectedTestCases([]);
      setSelectedTestSuites([]);
      setSelectedSections([]);
      setHasUnsavedChanges(false);
      setTouchedFields({});
      setIsCreateDialogOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateTestRun();
    }
  };

  // Helper functions for hierarchical selection
  const toggleSectionExpansion = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const toggleTestCaseSelection = (testCaseId: number) => {
    const newSelected = new Set(selectedTestCases);
    if (newSelected.has(testCaseId)) {
      newSelected.delete(testCaseId);
    } else {
      newSelected.add(testCaseId);
    }
    setSelectedTestCases(Array.from(newSelected));
  };

  const selectAllInSection = (sectionTestCases: TestCase[]) => {
    const sectionIds = sectionTestCases.map(tc => tc.id);
    const newSelected = new Set(selectedTestCases);
    sectionIds.forEach(id => newSelected.add(id));
    setSelectedTestCases(Array.from(newSelected));
  };

  const deselectAllInSection = (sectionTestCases: TestCase[]) => {
    const sectionIds = sectionTestCases.map(tc => tc.id);
    const newSelected = selectedTestCases.filter(id => !sectionIds.includes(id));
    setSelectedTestCases(newSelected);
  };

  // Build hierarchical section structure
  const buildSectionHierarchy = (sections: Section[]): Section[] => {
    const sectionMap = new Map<number, Section>();
    const rootSections: Section[] = [];

    // Create map of all sections
    sections.forEach(section => {
      sectionMap.set(section.id, { ...section, subsections: [] });
    });

    // Build hierarchy
    sections.forEach(section => {
      const sectionWithSubs = sectionMap.get(section.id)!;
      if (section.parent_section_id) {
        const parent = sectionMap.get(section.parent_section_id);
        if (parent) {
          parent.subsections!.push(sectionWithSubs);
        }
      } else {
        rootSections.push(sectionWithSubs);
      }
    });

    return rootSections;
  };

  // Get test cases for a section (including subsections)
  const getTestCasesForSection = (section: Section): TestCase[] => {
    let sectionTestCases = testCases.filter(tc => {
      // Match test cases to sections using section_id
      const testCaseSectionId = (tc as any).section_id;
      return testCaseSectionId === section.id;
    });
    
    if (section.subsections) {
      section.subsections.forEach(subsection => {
        sectionTestCases = [...sectionTestCases, ...getTestCasesForSection(subsection)];
      });
    }
    
    return sectionTestCases;
  };

  // Toggle section selection
  const toggleSectionSelection = (section: Section) => {
    const sectionTestCases = getTestCasesForSection(section);
    const isAllSelected = sectionTestCases.every(tc => selectedTestCases.includes(tc.id));
    
    if (isAllSelected) {
      deselectAllInSection(sectionTestCases);
    } else {
      selectAllInSection(sectionTestCases);
    }
  };

  // Toggle test suite selection
  const toggleTestSuiteSelection = (suiteId: number) => {
    const suiteTestCases = testCases.filter(tc => tc.test_suite_id === suiteId);
    const isAllSelected = suiteTestCases.every(tc => selectedTestCases.includes(tc.id));
    
    if (isAllSelected) {
      deselectAllInSection(suiteTestCases);
      setSelectedTestSuites(selectedTestSuites.filter(id => id !== suiteId));
    } else {
      selectAllInSection(suiteTestCases);
      setSelectedTestSuites([...selectedTestSuites, suiteId]);
    }
  };

  
  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      passed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      blocked: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  // Render section tree recursively
  const renderSection = (section: Section, level = 0) => {
    const sectionTestCases = getTestCasesForSection(section);
    const isExpanded = expandedSections.has(section.id.toString());
    const isAllSelected = sectionTestCases.length > 0 && sectionTestCases.every(tc => selectedTestCases.includes(tc.id));
    const isPartiallySelected = sectionTestCases.some(tc => selectedTestCases.includes(tc.id));

    return (
      <div key={section.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
        <div
          className="flex flex-col gap-2 bg-white p-3 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60 sm:flex-row sm:items-center sm:justify-between"
          style={{ paddingInlineStart: `${level * 20 + 12}px` }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 flex-shrink-0 rounded-lg p-0"
              onClick={() => toggleSectionExpansion(section.id.toString())}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronRight className={`h-4 w-4 text-slate-500 ${isRTL ? 'rotate-180' : ''}`} />
              )}
            </Button>
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={() => toggleSectionSelection(section)}
              className={isPartiallySelected && !isAllSelected ? "data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500" : ""}
            />
            <Folder className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={section.name}>{section.name}</span>
            <Badge variant="secondary" className="flex-shrink-0 bg-slate-100 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {sectionTestCases.length} {t('cases')}
            </Badge>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => selectAllInSection(sectionTestCases)}
              className="h-8 rounded-lg text-xs"
            >
              {t('selectAll')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => deselectAllInSection(sectionTestCases)}
              className="h-8 rounded-lg text-xs"
            >
              {t('deselectAll')}
            </Button>
          </div>
        </div>
        
        {isExpanded && (
          <div className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {sectionTestCases
              .filter(tc => tc.title?.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((testCase) => (
                <label
                  key={testCase.id}
                  className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-blue-50/70 dark:hover:bg-blue-950/20"
                  style={{ paddingInlineStart: `${(level + 1) * 20 + 12}px` }}
                >
                  <Checkbox
                    checked={selectedTestCases.includes(testCase.id)}
                    onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                    className="flex-shrink-0"
                  />
                  <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900 dark:text-white" title={testCase.title}>{testCase.title}</div>
                    {testCase.description && (
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400" title={testCase.description}>
                        {testCase.description.length > 80 ? `${testCase.description.substring(0, 80)}...` : testCase.description}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="flex-shrink-0 border-slate-200 text-xs dark:border-slate-700">
                    {t(testCase.priority)}
                  </Badge>
                </label>
              ))}
          </div>
        )}
        
        {section.subsections && section.subsections.map(subsection => renderSection(subsection, level + 1))}
      </div>
    );
  };

  const hierarchicalSections = buildSectionHierarchy(sections);

  return (
    <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('testRunsTitle')}</h1>
          <p className="text-gray-600">{t('testRunsDescription')}</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button type="button">
              <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('createTestRun')}
            </Button>
          </DialogTrigger>
          <DialogContent isRTL={isRTL} className={`max-h-[92vh] overflow-hidden p-0 sm:max-w-[1100px] ${isRTL ? 'rtl' : 'ltr'}`} onKeyDown={handleKeyDown}>
            <div className="max-h-[92vh] overflow-y-auto bg-slate-50 dark:bg-slate-950">
            <DialogHeader className="border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/20">
                  <PlayCircle className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-2xl font-bold text-slate-950 dark:text-white">{t('createNewTestRun')}</DialogTitle>
                  <DialogDescription className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {t('createTestRunDescription')}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="grid gap-5 p-6 lg:grid-cols-2">
              {/* Basic Information */}
              <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
                  <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  {t('basicInformation')}
                </h3>
                
                <div className="space-y-2">
                  <Label htmlFor="runName" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('runName')} *
                  </Label>
                  <div className="space-y-1">
                    <Input
                      ref={runNameInputRef}
                      id="runName"
                      value={runName}
                      onChange={(e) => setRunName(e.target.value)}
                      onBlur={() => setTouchedFields({...touchedFields, runName: true})}
                      className={`h-12 rounded-xl bg-white text-base dark:bg-slate-950 ${touchedFields.runName && runName.trim() === '' ? 'border-red-300 focus-visible:ring-red-500' : 'border-slate-200 dark:border-slate-700'}`}
                      placeholder={t('enterRunName')}
                      maxLength={200}
                    />
                    <div className="flex justify-between gap-3 text-xs text-slate-500">
                      <span>{t('enterRunName')}</span>
                      <span>{runName.length}/200</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="runDescription" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('runDescriptionLabel')}
                  </Label>
                  <div className="space-y-1">
                    <Textarea
                      id="runDescription"
                      value={runDescription}
                      onChange={(e) => setRunDescription(e.target.value)}
                      placeholder={t('enterRunDescription')}
                      rows={5}
                      maxLength={1000}
                      className="rounded-xl border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <div className="flex justify-between gap-3 text-xs text-slate-500">
                      <span>{t('enterRunDescription')}</span>
                      <span>{runDescription.length}/1000</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scheduling and Assignment */}
              <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
                  <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  {t('schedulingAssignment')}
                </h3>
                
                <div className="space-y-2">
                  <Label htmlFor="scheduledDate" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('scheduledDate')}
                  </Label>
                  <Input
                    id="scheduledDate"
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="h-11 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="assignedTo" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('assignedToLabel')}
                  </Label>
                  <Select value={assignedTo} onValueChange={setAssignedTo}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                      <SelectValue placeholder={t('selectAssignee')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="me">{t('meCurrentUser')}</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id.toString()}>
                          {user.full_name || user.username} ({user.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="estimatedDuration" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('estimatedDuration')}
                  </Label>
                  <Input
                    id="estimatedDuration"
                    type="number"
                    value={estimatedDuration}
                    onChange={(e) => setEstimatedDuration(e.target.value)}
                    className="h-11 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
                    placeholder={t('estimatedDurationPlaceholder')}
                  />
                </div>
              </div>

              {/* Test Configuration */}
              <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
                  <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  {t('testConfiguration')}
                </h3>
                
                <div className="space-y-2">
                  <Label htmlFor="environment" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('environmentLabel')}
                  </Label>
                  <Select value={environment} onValueChange={setEnvironment}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                      <SelectValue placeholder={t('selectTestEnvironment')} />
                    </SelectTrigger>
                    <SelectContent>
                      {environments.map((env) => (
                        <SelectItem key={env.id} value={env.id.toString()}>
                          {env.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="priority" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {t('priority')}
                  </Label>
                  <Select value={priority} onValueChange={setPriority} disabled={isPrioritiesLoading || priorityOptions.length === 0}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                      <SelectValue placeholder={t('selectPriority')} />
                    </SelectTrigger>
                    <SelectContent>
                      {priorityOptions.length === 0 ? (
                        <SelectItem value="no-priorities" disabled>
                          {isPrioritiesLoading ? t('loading') : t('noData')}
                        </SelectItem>
                      ) : (
                        priorityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Test Case Selection */}
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-start" dir={isRTL ? 'rtl' : 'ltr'}>
                  <div className="min-w-0" dir={isRTL ? 'rtl' : 'ltr'}>
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white" style={{ justifyContent: 'flex-start' }}>
                      <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      {t('testCaseSelection')}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {t('createTestRunDescription')}
                    </p>
                  </div>
                  <div className="flex justify-start sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedTestCases([]);
                        setSelectedTestSuites([]);
                        setSelectedSections([]);
                      }}
                      className={`rounded-xl ${selectedTestCases.length === 0 ? 'invisible pointer-events-none' : ''}`}
                      tabIndex={selectedTestCases.length === 0 ? -1 : 0}
                      aria-hidden={selectedTestCases.length === 0}
                    >
                      {t('clearAll')}
                    </Button>
                  </div>
                </div>
                
                {/* Search */}
                <div className="relative">
                  <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                  <Input
                    dir={isRTL ? 'rtl' : 'ltr'}
                    placeholder={t('searchTestCases')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-11 rounded-xl border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
                    style={{ paddingInlineStart: '2.75rem' }}
                  />
                </div>

                {/* Selection Summary */}
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/30">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                      {t('selectedCount', { count: selectedTestCases.length })}
                    </span>
                    <span className="text-xs font-medium text-blue-700 dark:text-blue-200">
                      {testCases.length} {t('total')}
                    </span>
                  </div>
                  {(selectedTestSuites.length > 0 || selectedSections.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-blue-700 dark:text-blue-300">
                      {selectedTestSuites.length > 0 && (
                        <Badge variant="outline" className="border-blue-200 bg-white/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                          {t('testSuitesSelected', { count: selectedTestSuites.length })}
                        </Badge>
                      )}
                      {selectedSections.length > 0 && (
                        <Badge variant="outline" className="border-blue-200 bg-white/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                          {t('sectionsSelected', { count: selectedSections.length })}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                {/* Hierarchical Selection with improved height and scrolling */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        <span className="hidden sm:inline">{t('hoverToSeeDescriptions')}</span>
                        <span className="sm:hidden">{t('tapToSelect')}</span>
                      </span>
                      <span className="font-semibold text-slate-500 dark:text-slate-400">
                        {selectedTestCases.length} {t('selected')}
                      </span>
                    </div>
                  </div>
                  
                  {/* Scrollable content area with max height */}
                  <div className="max-h-[430px] overflow-y-auto bg-white dark:bg-slate-900">
                    {/* Show loading state for large datasets */}
                    {testCases.length > 1000 && (
                      <div className="border-b border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                          {testCases.length} {t('total')} · {t('searchTestCases')}
                        </p>
                      </div>
                    )}
                    
                    {/* Sections */}
                    {hierarchicalSections.length > 0 && (
                      <div className="border-b border-slate-200 dark:border-slate-800">
                        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                          {t('sectionsSubsections')}
                        </div>
                        {hierarchicalSections.map(section => renderSection(section))}
                      </div>
                    )}

                    {/* Test Suites */}
                    {testSuites.length > 0 && (
                      <div className="border-b border-slate-200 dark:border-slate-800">
                        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                          {t('testSuitesLabel')}
                        </div>
                        {testSuites.map((suite) => {
                          const suiteTestCases = testCases.filter(tc => tc.test_suite_id === suite.id);
                          const filteredSuiteTestCases = suiteTestCases.filter(tc => 
                            tc.title?.toLowerCase().includes(searchQuery.toLowerCase())
                          );
                          
                          // Skip suite if no test cases match search
                          if (searchQuery && filteredSuiteTestCases.length === 0) {
                            return null;
                          }
                          
                          const isAllSelected = suiteTestCases.length > 0 && suiteTestCases.every(tc => selectedTestCases.includes(tc.id));
                          const isPartiallySelected = suiteTestCases.some(tc => selectedTestCases.includes(tc.id));

                          return (
                            <div key={suite.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                              <div className="flex flex-col gap-2 bg-white px-4 py-3 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <Checkbox
                                    checked={isAllSelected}
                                    onCheckedChange={() => toggleTestSuiteSelection(suite.id)}
                                    className={`h-3.5 w-3.5 ${isPartiallySelected && !isAllSelected ? "data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500" : ""}`}
                                  />
                                  <Folder className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                                  <span className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={suite.name}>{suite.name}</span>
                                  <Badge variant="secondary" className="h-5 flex-shrink-0 bg-slate-100 px-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                    {suiteTestCases.length}
                                  </Badge>
                                </div>
                                <div className="flex flex-shrink-0 gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => selectAllInSection(suiteTestCases)}
                                    className="h-8 rounded-lg text-xs"
                                  >
                                    {t('selectAll')}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => deselectAllInSection(suiteTestCases)}
                                    className="h-8 rounded-lg text-xs"
                                  >
                                    {t('deselectAll')}
                                  </Button>
                                </div>
                              </div>
                            
                              {/* Only show first 50 test cases per suite if not searching, otherwise show all matches */}
                              <div className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                                {filteredSuiteTestCases
                                  .slice(0, searchQuery ? undefined : 50)
                                  .map((testCase) => (
                                    <label key={testCase.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-blue-50/70 dark:hover:bg-blue-950/20">
                                      <Checkbox
                                        checked={selectedTestCases.includes(testCase.id)}
                                        onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                                        className="flex-shrink-0"
                                      />
                                      <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-white" title={testCase.title}>{testCase.title}</span>
                                        {testCase.description && (
                                          <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={testCase.description}>
                                            {testCase.description.length > 60 ? `${testCase.description.substring(0, 60)}...` : testCase.description}
                                          </p>
                                        )}
                                      </div>
                                      <Badge variant="outline" className="flex-shrink-0 border-slate-200 text-xs dark:border-slate-700">
                                        {t(testCase.priority)}
                                      </Badge>
                                    </label>
                                  ))}
                                {!searchQuery && filteredSuiteTestCases.length > 50 && (
                                  <div className="bg-slate-50 px-4 py-2 text-center text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                                    {t('showingTestCasesRange', { start: 1, end: 50, total: filteredSuiteTestCases.length })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Uncategorized Test Cases */}
                    {testCases.filter(tc => !tc.test_suite_id && !(tc as any).section_id).length > 0 && (
                      <div>
                        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                          {t('uncategorizedTestCases')}
                        </div>
                        <div className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                          {testCases
                            .filter(tc => !tc.test_suite_id && !(tc as any).section_id)
                            .filter(tc => tc.title?.toLowerCase().includes(searchQuery.toLowerCase()))
                            .slice(0, searchQuery ? undefined : 50)
                            .map((testCase) => (
                              <label key={testCase.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-blue-50/70 dark:hover:bg-blue-950/20">
                                <Checkbox
                                  checked={selectedTestCases.includes(testCase.id)}
                                  onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                                  className="flex-shrink-0"
                                />
                                <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                <div className="flex-1 min-w-0">
                                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-white" title={testCase.title}>{testCase.title}</span>
                                  {testCase.description && (
                                    <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={testCase.description}>
                                      {testCase.description.length > 60 ? `${testCase.description.substring(0, 60)}...` : testCase.description}
                                    </p>
                                  )}
                                </div>
                                <Badge variant="outline" className="flex-shrink-0 border-slate-200 text-xs dark:border-slate-700">
                                  {t(testCase.priority)}
                                </Badge>
                              </label>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {error && (
              <div className="mx-6 mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}
            
            <DialogFooter
              className="sticky bottom-0 grid grid-cols-1 gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:grid-cols-[minmax(0,1fr)_auto]"
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-950/70 dark:text-slate-400" style={{ textAlign: isRTL ? 'right' : 'left' }}>
                {t('toSubmit')}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row" style={{ justifyContent: isRTL ? 'flex-start' : 'flex-end' }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogClose(false)}
                  className="rounded-xl"
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  onClick={handleCreateTestRun}
                  disabled={!runName.trim() || selectedTestCases.length === 0 || !priority || isPrioritiesLoading || isCreating}
                  className="rounded-xl bg-blue-600 shadow-lg shadow-blue-600/20 hover:bg-blue-700"
                >
                  {isCreating && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                  {isCreating ? t('creating') : `${t('createTestRun')} (${selectedTestCases.length} ${t('cases')})`}
                </Button>
              </div>
            </DialogFooter>
            </div>
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
              <Button type="button" variant="outline" onClick={() => handleUnsavedConfirm(false)}>
                {t('keepEditingModal')}
              </Button>
              <Button type="button" onClick={() => handleUnsavedConfirm(true)}>
                {t('discardChangesModal')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <CardContent className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_220px_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="test-run-search" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('searchTestRuns')}
              </Label>
              <div className="relative">
                <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                <Input
                  id="test-run-search"
                  value={testRunSearchQuery}
                  onChange={(event) => setTestRunSearchQuery(event.target.value)}
                  placeholder={t('searchTestRunsPlaceholder')}
                  className={isRTL ? 'pr-9' : 'pl-9'}
                  maxLength={200}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('status')}</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStatuses')}</SelectItem>
                  <SelectItem value="pending">{t('testRunStatusPending')}</SelectItem>
                  <SelectItem value="running">{t('testRunStatusRunning')}</SelectItem>
                  <SelectItem value="in_progress">{t('testRunStatusInProgress')}</SelectItem>
                  <SelectItem value="passed">{t('testRunStatusPassed')}</SelectItem>
                  <SelectItem value="failed">{t('testRunStatusFailed')}</SelectItem>
                  <SelectItem value="skipped">{t('testRunStatusSkipped')}</SelectItem>
                  <SelectItem value="blocked">{t('testRunStatusBlocked')}</SelectItem>
                  <SelectItem value="completed">{t('testRunStatusCompleted')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('priority')}</Label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter} disabled={isPrioritiesLoading}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allPriorities')}</SelectItem>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('assignedToLabel')}</Label>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allAssignees')}</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      {user.full_name || user.username || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={clearTestRunFilters}
              disabled={!hasActiveTestRunFilters}
              className="lg:mb-0"
            >
              {t('clearFilters')}
            </Button>
          </div>

          {currentUser?.id && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant={assigneeFilter === String(currentUser.id) ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAssigneeFilter(getAssigneeFilterValue('me'))}
              >
                {t('myAssignedRuns')}
              </Button>
              {assigneeFilter === String(currentUser.id) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAssigneeFilter('all')}>
                  {t('showAllRuns')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Runs List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className={`ml-2 ${isRTL ? 'mr-2' : ''}`}>{t('loadingTestRuns')}</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-600">
          {error}
        </div>
      ) : testRuns.length === 0 ? (
        <div className="text-center py-12">
          <History className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            {hasActiveTestRunFilters ? t('noMatchingTestRunsFound') : t('noTestRunsFound')}
          </h3>
          <p className="text-gray-500 mb-4">
            {hasActiveTestRunFilters ? t('adjustTestRunFilters') : t('createFirstTestRun')}
          </p>
          {hasActiveTestRunFilters ? (
            <Button variant="outline" onClick={clearTestRunFilters}>
              {t('clearFilters')}
            </Button>
          ) : (
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('createTestRun')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {paginatedTestRuns.map((run) => {
              const statusMeta = getStatusMeta(run.status);
              const StatusIcon = statusMeta.icon;
              const startedAt = getRunStartedAt(run);
              const progress = getProgressMeta(run);

              return (
                <Card
                  key={run.id}
                  className="group relative cursor-pointer overflow-hidden border-slate-200/80 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-950"
                  onClick={() => navigate(`/projects/${currentProjectId}/test-runs/${run.id}`)}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${statusMeta.accentClass}`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <span>{t('runId')}: TR-{run.id.toString().padStart(3, '0')}</span>
                          <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                          <span>{t('projectIdLabel')}: {run.project_id}</span>
                        </div>
                        <CardTitle className="line-clamp-2 text-lg leading-tight text-slate-950 dark:text-slate-50" title={run.name}>
                          {run.name}
                        </CardTitle>
                      </div>
                      <Badge variant="outline" className={`shrink-0 gap-1.5 border px-2.5 py-1 font-semibold ${statusMeta.badgeClass}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {statusMeta.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {run.description && (
                      <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                        {run.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {t('executionProgress')}
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-50">
                          {t('completedOfTotal', { completed: progress.executed, total: progress.total })}
                        </p>
                      </div>
                      <div
                        className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
                        style={{
                          background: `conic-gradient(rgb(37 99 235) ${progress.percent * 3.6}deg, rgb(226 232 240) 0deg)`,
                        }}
                        aria-label={t('progressPercent', { percent: progress.percent })}
                      >
                        <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-xs font-black text-slate-900 dark:bg-slate-950 dark:text-slate-50">
                          {progress.percent}%
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/70">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <Calendar className="h-3.5 w-3.5" />
                          {t('started')}
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={startedAt ? new Date(startedAt).toLocaleString() : t('notStarted')}>
                          {formatDateTime(startedAt)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/70">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <Target className="h-3.5 w-3.5" />
                          {t('completion')}
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={getCompletionLabel(run)}>
                          {getCompletionLabel(run)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                      <div className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                        <User className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate" title={getAssigneeName(run.assigned_to)}>
                          {getAssigneeName(run.assigned_to)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/projects/${currentProjectId}/test-runs/${run.id}`);
                        }}
                      >
                        {t('viewDetails')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              {t('showing', { start: paginationStart, end: paginationEnd, total: testRuns.length })}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-slate-600 dark:text-slate-300">{t('itemsPerPage')}:</Label>
                <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(parseInt(value, 10))}>
                  <SelectTrigger className="h-9 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6</SelectItem>
                    <SelectItem value="9">9</SelectItem>
                    <SelectItem value="12">12</SelectItem>
                    <SelectItem value="24">24</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                  {t('previous')}
                </Button>
                <span className="min-w-24 text-center text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('pageOf', { current: currentPage, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                >
                  {t('next')}
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test Details Dialog */}
      <Dialog open={!!selectedTestRun} onOpenChange={() => setSelectedTestRun(null)}>
        <DialogContent isRTL={isRTL} className={`max-w-[95vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto ${isRTL ? 'rtl' : 'ltr'}`}>
          <DialogHeader>
            <DialogTitle>{t('testRunDetails')}: {selectedTestRun?.name}</DialogTitle>
            <DialogDescription>
              {t('testRunDetailsDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {selectedTestRun && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-600">{t('status')}</Label>
                    <Badge variant="outline" className={`${getStatusMeta(selectedTestRun.status).badgeClass} mt-1 gap-1.5`}>
                      {(() => {
                        const StatusIcon = getStatusMeta(selectedTestRun.status).icon;
                        return <StatusIcon className="h-3.5 w-3.5" />;
                      })()}
                      {getStatusMeta(selectedTestRun.status).label}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-600">{t('projectIdLabel')}</Label>
                    <p className="text-sm">{selectedTestRun.project_id}</p>
                  </div>
                </div>
                
                {selectedTestRun.description && (
                  <div>
                    <Label className="text-sm font-medium text-gray-600">{t('description')}</Label>
                    <p className="text-sm mt-1">{selectedTestRun.description}</p>
                  </div>
                )}
                
                {selectedTestRun.environment && (
                  <div>
                    <Label className="text-sm font-medium text-gray-600">{t('environmentLabel')}</Label>
                    <p className="text-sm mt-1">{selectedTestRun.environment.name}</p>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-600">{t('created')}</Label>
                    <p className="text-sm mt-1">{new Date(selectedTestRun.created_at).toLocaleString()}</p>
                  </div>
                  {selectedTestRun.started_at && (
                    <div>
                      <Label className="text-sm font-medium text-gray-600">{t('started')}</Label>
                      <p className="text-sm mt-1">{new Date(selectedTestRun.started_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>
                
                {selectedTestRun.completed_at && (
                  <div>
                    <Label className="text-sm font-medium text-gray-600">{t('completedLabel')}</Label>
                    <p className="text-sm mt-1">{new Date(selectedTestRun.completed_at).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedTestRun(null)}
            >
              {t('close')}
            </Button>
            <Button
              onClick={() => {
                if (selectedTestRun) {
                  navigate(`/projects/${currentProjectId}/test-runs/${selectedTestRun.id}`);
                  setSelectedTestRun(null);
                }
              }}
            >
              {t('viewFullDetails')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function parsePositiveQueryNumber(value: string | null) {
  const parsed = value ? Number(value) : undefined;
  return parsed && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
