import { useState, useEffect, useRef, useMemo, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Layers3,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  SlidersHorizontal,
  TestTube,
  Trash2,
} from 'lucide-react';
import { testSuitesAPI, testCasesAPI, sectionsAPI, auditAPI } from '@/lib/api';
import { TestSuite, TestCase } from '@/types';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';

export function TestSuites() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  
  // Dialog states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [suiteName, setSuiteName] = useState('');
  const [suiteDescription, setSuiteDescription] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  
  // Data states
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  
  // Selection states
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['all']));
  
  // Filter and search states
  const [searchQuery, setSearchQuery] = useState('');
  const [suiteSearchQuery, setSuiteSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingTestCases, setIsLoadingTestCases] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination for test cases
  const [testCasePage, setTestCasePage] = useState(1);
  const testCasesPerPage = 50;
  
  const currentProjectId = useMemo(() => {
    const parsedProjectId = Number(projectId);
    return projectId && Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [currentProjectId]);

  // Load test cases when dialog opens
  useEffect(() => {
    if (isDialogOpen && testCases.length === 0) {
      loadTestCasesForSelection();
    }
    // Auto-focus on name input when dialog opens
    if (isDialogOpen && nameInputRef.current) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isDialogOpen]);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(suiteName.trim() !== '' || suiteDescription.trim() !== '' || selectedTestCases.length > 0);
  }, [suiteName, suiteDescription, selectedTestCases]);

  const loadData = async () => {
    if (!currentProjectId) {
      setTestSuites([]);
      setError(t('noProjectSelected'));
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      console.log('🔍 Loading test suites for project:', currentProjectId);
      const testSuitesData = await testSuitesAPI.getAll(currentProjectId).catch((err) => {
        console.error('❌ Failed to load test suites:', err);
        return [];
      });
      console.log('✅ Test suites loaded:', testSuitesData);
      setTestSuites(testSuitesData);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(t('failedToLoadTestSuitesError'));
      toast({
        title: t('error'),
        description: t('failedToLoadTestSuitesError'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadTestCasesForSelection = async () => {
    if (!currentProjectId) {
      setTestCases([]);
      setSections([]);
      return;
    }

    try {
      setIsLoadingTestCases(true);
      const [testCasesData, hierarchyData] = await Promise.all([
        testCasesAPI.getAll(currentProjectId).catch(() => []),
        sectionsAPI.getProjectSectionHierarchy(currentProjectId).catch(() => null),
      ]);
      setTestCases(testCasesData);
      setSections(
        hierarchyData?.hierarchy?.flatMap((suiteData: any) =>
          (suiteData.sections || []).map((section: any) => ({
            ...section,
            test_suite_id: suiteData.test_suite.id,
          }))
        ) || []
      );
    } catch (err) {
      console.error('Failed to load test cases:', err);
      toast({
        title: t('warning'),
        description: t('failedToLoadTestCasesForSelectionError'),
        variant: "destructive",
      });
    } finally {
      setIsLoadingTestCases(false);
    }
  };

  // Log activity to audit trail
  const logActivity = async (action: string, entityType: string, entityId: number, description: string, newValues?: any) => {
    try {
      // Note: Audit logging disabled - API method not available
      // await auditAPI.createAuditTrail({
      //   action,
      //   entity_type: entityType,
      //   entity_id: entityId,
      //   project_id: currentProjectId,
      //   description,
      //   new_values: newValues,
      // });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  };

  // Helper functions for test case selection
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

  const selectAllFiltered = () => {
    const allIds = filteredAndPaginatedTestCases.map(tc => tc.id);
    setSelectedTestCases(allIds);
  };

  const deselectAll = () => {
    setSelectedTestCases([]);
  };

  // Enhanced filtering with priority and status
  const filteredTestCases = useMemo(() => {
    let filtered = testCases;
    
    // Search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(tc => 
        tc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tc.description && tc.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (tc.tags && tc.tags.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    // Priority filter
    if (priorityFilter !== 'all') {
      filtered = filtered.filter(tc => tc.priority === priorityFilter);
    }
    
    return filtered;
  }, [testCases, searchQuery, priorityFilter]);

  // Paginated test cases for better performance
  const filteredAndPaginatedTestCases = useMemo(() => {
    const startIndex = (testCasePage - 1) * testCasesPerPage;
    const endIndex = startIndex + testCasesPerPage;
    return filteredTestCases.slice(startIndex, endIndex);
  }, [filteredTestCases, testCasePage]);

  const totalPages = Math.ceil(filteredTestCases.length / testCasesPerPage);

  // Filter test suites
  const filteredTestSuites = useMemo(() => {
    let filtered = testSuites;
    
    if (suiteSearchQuery.trim()) {
      filtered = filtered.filter(suite =>
        suite.name.toLowerCase().includes(suiteSearchQuery.toLowerCase()) ||
        (suite.description && suite.description.toLowerCase().includes(suiteSearchQuery.toLowerCase()))
      );
    }
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter(suite => suite.status === statusFilter);
    }
    
    return filtered;
  }, [testSuites, suiteSearchQuery, statusFilter]);

  const suiteStats = useMemo(() => {
    const activeSuites = testSuites.filter((suite) => suite.status === 'active').length;
    const archivedSuites = testSuites.filter((suite) => suite.status === 'archived').length;
    const totalCases = testSuites.reduce((sum, suite) => sum + (suite.test_case_ids?.length || 0), 0);

    return {
      activeSuites,
      archivedSuites,
      totalCases,
    };
  }, [testSuites]);

  const hasActiveSuiteFilters = suiteSearchQuery.trim() !== '' || statusFilter !== 'all';
  const suitesLabel = testSuites.length === 1 ? t('suiteLabel') : t('suitesLabel');

  const handleCreateTestSuite = async () => {
    if (!currentProjectId) {
      setError(t('noProjectSelected'));
      toast({
        title: t('error'),
        description: t('noProjectSelected'),
        variant: "destructive",
      });
      return;
    }

    if (!suiteName.trim()) {
      setError(t('pleaseEnterASuiteName'));
      toast({
        title: t('validationError'),
        description: t('pleaseEnterASuiteName'),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      
      const newTestSuite = await testSuitesAPI.create({
        name: suiteName,
        description: suiteDescription || undefined,
        project_id: currentProjectId,
        status: 'active',
        test_case_ids: selectedTestCases,
      });
      
      // Log activity
      await logActivity(
        'create',
        'test_suite',
        newTestSuite.id,
        t('createdTestSuiteWithCases', { name: suiteName, count: selectedTestCases.length }),
        {
          name: suiteName,
          description: suiteDescription,
          test_case_count: selectedTestCases.length,
        }
      );
      
      setTestSuites([newTestSuite, ...testSuites]);
      
      // Reset form
      setSuiteName('');
      setSuiteDescription('');
      setSelectedTestCases([]);
      setSearchQuery('');
      setTestCasePage(1);
      setIsDialogOpen(false);
      
      toast({
        title: t('success'),
        description: t('testSuiteCreatedSuccessfully', { name: suiteName }),
      });
      
      // Navigate to the new test suite detail page
      navigate(`/projects/${currentProjectId}/test-suites/${newTestSuite.id}`);
    } catch (err) {
      console.error('Failed to create test suite:', err);
      setError(t('failedToCreateTestSuiteError'));
      toast({
        title: t('error'),
        description: t('failedToCreateTestSuiteRetryError'),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSuite = async (suite: TestSuite) => {
    if (!confirm(t('areYouSureToDeleteSuite', { name: suite.name }))) {
      return;
    }
    
    try {
      await testSuitesAPI.delete(suite.id);
      
      // Log activity
      await logActivity(
        'delete',
        'test_suite',
        suite.id,
        t('deletedTestSuite', { name: suite.name }),
        { name: suite.name }
      );
      
      setTestSuites(testSuites.filter(s => s.id !== suite.id));
      
      toast({
        title: t('success'),
        description: t('deletedTestSuite', { name: suite.name }),
      });
    } catch (err) {
      console.error('Failed to delete test suite:', err);
      toast({
        title: t('error'),
        description: t('failedToDeleteTestSuite'),
        variant: "destructive",
      });
    }
  };

  const handleDuplicateSuite = async (suite: TestSuite) => {
    try {
      const newSuite = await testSuitesAPI.create({
        name: t('suiteCopy', { name: suite.name }),
        description: suite.description,
        project_id: suite.project_id,
      });
      
      toast({
        title: t('success'),
        description: t('testSuiteDuplicatedSuccessfully'),
      });
      
      await loadData();
    } catch (err) {
      console.error('Failed to duplicate test suite:', err);
      toast({
        title: t('error'),
        description: t('failedToDuplicateTestSuite'),
        variant: "destructive",
      });
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      setIsDialogOpen(open);
      if (!open) {
        // Reset form when closing
        setSuiteName('');
        setSuiteDescription('');
        setSelectedTestCases([]);
        setHasUnsavedChanges(false);
      }
    }
  };

  const handleUnsavedConfirm = (discard: boolean) => {
    setShowUnsavedDialog(false);
    if (discard) {
      setSuiteName('');
      setSuiteDescription('');
      setSelectedTestCases([]);
      setHasUnsavedChanges(false);
      setIsDialogOpen(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleCreateTestSuite();
    }
  };

  return (
    <div className={`relative -m-6 min-h-[calc(100vh-4rem)] overflow-hidden bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-slate-50 sm:p-6 lg:p-8 ${isRTL ? 'rtl' : 'ltr'}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(37,99,235,0.18),transparent_30%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.15),transparent_30%)]" />
      <div className="relative mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-4xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-200/70 backdrop-blur-sm dark:border-white/10 dark:bg-linear-to-br dark:from-slate-950 dark:via-blue-950 dark:to-slate-900 dark:shadow-2xl dark:shadow-blue-950/20">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(14,165,233,0.10),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(37,99,235,0.12),transparent_24%)] dark:bg-[linear-gradient(120deg,rgba(255,255,255,0.12),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(125,211,252,0.24),transparent_24%)]" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <Badge className="border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/15">
                  <TestTube className={`h-3.5 w-3.5 ${isRTL ? 'ml-1.5' : 'mr-1.5'}`} />
                  {t('suitesLabel')}
                </Badge>
                <div>
                  <h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl lg:text-5xl">
                    {t('testSuitesTitle')}
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-blue-100 sm:text-base">
                    {t('testSuitesDescription')}
                  </p>
                </div>
              </div>

              <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
                <DialogTrigger asChild>
                  <Button className="h-12 rounded-2xl bg-blue-600 px-5 font-semibold text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700 dark:bg-white dark:text-slate-950 dark:shadow-blue-950/25 dark:hover:bg-blue-50">
                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('createTestSuite')}
                  </Button>
                </DialogTrigger>
                <DialogContent
                  isRTL={isRTL}
                  className={`max-h-[92vh] overflow-hidden p-0 sm:max-w-[980px] ${isRTL ? 'rtl' : 'ltr'}`}
                  onKeyDown={handleKeyDown}
                >
                  <div className="max-h-[92vh] overflow-y-auto bg-slate-50 dark:bg-slate-950">
                    <DialogHeader className="border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/20">
                          <FolderOpen className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <DialogTitle className="text-2xl font-bold text-slate-950 dark:text-white">
                            {t('createNewTestSuite')}
                          </DialogTitle>
                          <DialogDescription className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                            {t('createTestSuiteDescription')}
                          </DialogDescription>
                        </div>
                      </div>
                    </DialogHeader>

                    <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
                      <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
                        <CardHeader className="pb-4">
                          <CardTitle className="flex items-center text-lg">
                            <Layers3 className={`h-5 w-5 text-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                            {t('basicInformation')}
                          </CardTitle>
                          <CardDescription>{t('suiteNameHelper')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          <div className="space-y-2">
                            <Label htmlFor="name" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                              {t('suiteName')} <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              ref={nameInputRef}
                              id="name"
                              value={suiteName}
                              onChange={(e) => setSuiteName(e.target.value)}
                              className={`h-12 rounded-xl bg-white text-base dark:bg-slate-950 ${suiteName.trim() === '' ? 'border-red-300 focus-visible:ring-red-500' : 'border-slate-200 dark:border-slate-700'}`}
                              placeholder={t('enterSuiteName')}
                              maxLength={200}
                            />
                            <div className="flex justify-between gap-3 text-xs text-slate-500">
                              <span>{t('enterSuiteName')}</span>
                              <span>{suiteName.length}/200</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="description" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                              {t('suiteDescription')}
                            </Label>
                            <Textarea
                              id="description"
                              value={suiteDescription}
                              onChange={(e) => setSuiteDescription(e.target.value)}
                              placeholder={t('enterSuiteDescription')}
                              rows={6}
                              maxLength={1000}
                              className="rounded-xl border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-950"
                            />
                            <div className="flex justify-between gap-3 text-xs text-slate-500">
                              <span>{t('suiteDescriptionHelper')}</span>
                              <span>{suiteDescription.length}/1000</span>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-100">
                            <div className="flex items-center font-semibold">
                              <CheckSquare className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                              {selectedTestCases.length} {t('of')} {filteredTestCases.length} {t('selected')}
                            </div>
                            {filteredTestCases.length < testCases.length && (
                              <p className="mt-1 text-xs text-blue-700 dark:text-blue-200">
                                {testCases.length} {t('total')}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
                        <CardHeader className="pb-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <CardTitle className="flex items-center text-lg">
                                <FileText className={`h-5 w-5 text-blue-600 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('selectTestCases')}
                              </CardTitle>
                              <CardDescription>{t('searchTestCases')}</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {selectedTestCases.length > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={deselectAll}
                                  className="rounded-xl"
                                >
                                  {t('clearAll')}
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={selectAllFiltered}
                                className="rounded-xl"
                              >
                                {t('selectAllFiltered')}
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                            <div className="relative">
                              <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                              <Input
                                placeholder={t('searchTestCases')}
                                className={`h-11 rounded-xl border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 ${isRTL ? 'pr-10' : 'pl-10'}`}
                                value={searchQuery}
                                onChange={(e) => {
                                  setSearchQuery(e.target.value);
                                  setTestCasePage(1);
                                }}
                              />
                            </div>
                            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                                <SelectValue placeholder={t('priority')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">{t('allPriority')}</SelectItem>
                                <SelectItem value="low">{t('low')}</SelectItem>
                                <SelectItem value="medium">{t('medium')}</SelectItem>
                                <SelectItem value="high">{t('high')}</SelectItem>
                                <SelectItem value="critical">{t('critical')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                            {isLoadingTestCases ? (
                              <div className="flex min-h-64 items-center justify-center bg-slate-50 dark:bg-slate-950">
                                <div className="text-center">
                                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" />
                                  <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    {t('loading')}
                                  </p>
                                </div>
                              </div>
                            ) : filteredTestCases.length === 0 ? (
                              <div className="flex min-h-64 items-center justify-center bg-slate-50 p-6 text-center dark:bg-slate-950">
                                <div>
                                  <FileText className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-700" />
                                  <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                                    {t('noTestCasesFound')}
                                  </h3>
                                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    {t('tryAdjustingSearchFilters')}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="max-h-[360px] overflow-y-auto bg-white dark:bg-slate-900">
                                <div className="border-b border-slate-200 dark:border-slate-800">
                                  <div className="flex flex-col gap-3 bg-slate-50 p-3 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
                                    <button
                                      type="button"
                                      onClick={() => toggleSectionExpansion('all')}
                                      className="flex min-w-0 items-center gap-2 text-start"
                                    >
                                      <span className="rounded-lg bg-white p-1.5 shadow-xs dark:bg-slate-900">
                                        {expandedSections.has('all') ? (
                                          <ChevronDown className="h-4 w-4 text-slate-500" />
                                        ) : (
                                          <ChevronRight className={`h-4 w-4 text-slate-500 ${isRTL ? 'rotate-180' : ''}`} />
                                        )}
                                      </span>
                                      <Folder className="h-4 w-4 shrink-0 text-blue-600" />
                                      <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                        {t('allTestCases')}
                                      </span>
                                      <Badge variant="secondary" className="bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                        {filteredTestCases.length}
                                      </Badge>
                                    </button>
                                    <div className="flex gap-2">
                                      <Button variant="ghost" size="sm" onClick={() => selectAllInSection(filteredTestCases)} className="h-8 rounded-lg">
                                        {t('selectAll')}
                                      </Button>
                                      <Button variant="ghost" size="sm" onClick={() => deselectAllInSection(filteredTestCases)} className="h-8 rounded-lg">
                                        {t('deselectAll')}
                                      </Button>
                                    </div>
                                  </div>

                                  {expandedSections.has('all') && (
                                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                      {filteredAndPaginatedTestCases.map((testCase) => (
                                        <label
                                          key={testCase.id}
                                          className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
                                        >
                                          <Checkbox
                                            checked={selectedTestCases.includes(testCase.id)}
                                            onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                                            className="shrink-0"
                                          />
                                          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                                          <span className="min-w-0 flex-1 overflow-hidden">
                                            <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                                              {testCase.title}
                                            </span>
                                            {testCase.description && (
                                              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                                {testCase.description}
                                              </span>
                                            )}
                                          </span>
                                          {testCase.priority && (
                                            <Badge variant="outline" className="shrink-0 border-slate-200 text-xs dark:border-slate-700">
                                              {t(testCase.priority)}
                                            </Badge>
                                          )}
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {sections.map((section: any) => {
                                  const sectionKey = String(section.id);
                                  const sectionTestCases = filteredTestCases.filter(
                                    tc => tc.test_suite_id === section.id || tc.section === section.name
                                  );

                                  if (sectionTestCases.length === 0) return null;

                                  return (
                                    <div key={section.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                                      <div className="flex flex-col gap-3 bg-slate-50 p-3 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
                                        <button
                                          type="button"
                                          onClick={() => toggleSectionExpansion(sectionKey)}
                                          className="flex min-w-0 items-center gap-2 text-start"
                                        >
                                          <span className="rounded-lg bg-white p-1.5 shadow-xs dark:bg-slate-900">
                                            {expandedSections.has(sectionKey) ? (
                                              <ChevronDown className="h-4 w-4 text-slate-500" />
                                            ) : (
                                              <ChevronRight className={`h-4 w-4 text-slate-500 ${isRTL ? 'rotate-180' : ''}`} />
                                            )}
                                          </span>
                                          <Folder className="h-4 w-4 shrink-0 text-blue-600" />
                                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                            {section.name}
                                          </span>
                                          <Badge variant="secondary" className="bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                            {sectionTestCases.length}
                                          </Badge>
                                        </button>
                                        <div className="flex gap-2">
                                          <Button variant="ghost" size="sm" onClick={() => selectAllInSection(sectionTestCases)} className="h-8 rounded-lg">
                                            {t('selectAll')}
                                          </Button>
                                          <Button variant="ghost" size="sm" onClick={() => deselectAllInSection(sectionTestCases)} className="h-8 rounded-lg">
                                            {t('deselectAll')}
                                          </Button>
                                        </div>
                                      </div>

                                      {expandedSections.has(sectionKey) && (
                                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                          {sectionTestCases.map((testCase) => (
                                            <label
                                              key={testCase.id}
                                              className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
                                            >
                                              <Checkbox
                                                checked={selectedTestCases.includes(testCase.id)}
                                                onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                                                className="shrink-0"
                                              />
                                              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                                              <span className="min-w-0 flex-1 overflow-hidden">
                                                <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                                                  {testCase.title}
                                                </span>
                                                {testCase.description && (
                                                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                                    {testCase.description}
                                                  </span>
                                                )}
                                              </span>
                                              {testCase.priority && (
                                                <Badge variant="outline" className="shrink-0 border-slate-200 text-xs dark:border-slate-700">
                                                  {t(testCase.priority)}
                                                </Badge>
                                              )}
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {totalPages > 1 && (
                            <div className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                              <span>
                                {t('showingRange', { start: ((testCasePage - 1) * testCasesPerPage) + 1, end: Math.min(testCasePage * testCasesPerPage, filteredTestCases.length), total: filteredTestCases.length })}
                              </span>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setTestCasePage(p => Math.max(1, p - 1))}
                                  disabled={testCasePage === 1}
                                  className="h-8 rounded-lg"
                                >
                                  {t('previous')}
                                </Button>
                                <span className="min-w-20 text-center text-xs font-medium">
                                  {t('pageOf', { current: testCasePage, total: totalPages })}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setTestCasePage(p => Math.min(totalPages, p + 1))}
                                  disabled={testCasePage === totalPages}
                                  className="h-8 rounded-lg"
                                >
                                  {t('next')}
                                </Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    {error && (
                      <div className="mx-6 mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                        {error}
                      </div>
                    )}

                    <DialogFooter className="sticky bottom-0 flex-col gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 sm:flex-row">
                      <div className="text-xs text-slate-500 sm:mr-auto sm:rtl:ml-auto sm:rtl:mr-0">
                        {t('toSubmit')}
                      </div>
                      <Button variant="outline" onClick={() => handleDialogClose(false)} className="rounded-xl">
                        {t('cancel')}
                      </Button>
                      <Button
                        type="submit"
                        onClick={handleCreateTestSuite}
                        disabled={!currentProjectId || !suiteName.trim() || isCreating}
                        className="rounded-xl bg-blue-600 shadow-lg shadow-blue-600/20 hover:bg-blue-700"
                      >
                        {isCreating && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                        {isCreating ? t('creating') : t('createTestSuiteButton', { count: selectedTestCases.length })}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
                <DialogContent isRTL={isRTL} className="sm:max-w-[420px]">
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
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: t('totalSuites'), value: testSuites.length, icon: Layers3, accent: 'from-blue-500 to-cyan-500' },
            { label: t('active'), value: suiteStats.activeSuites, icon: CheckCircle2, accent: 'from-emerald-500 to-teal-500' },
            { label: t('totalCases'), value: suiteStats.totalCases, icon: FileText, accent: 'from-amber-500 to-orange-500' },
            { label: t('archived'), value: suiteStats.archivedSuites, icon: FolderOpen, accent: 'from-slate-500 to-slate-700' },
          ].map((stat) => {
            const Icon = stat.icon;

            return (
              <Card key={stat.label} className="overflow-hidden border-white bg-white/90 shadow-xs backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
                      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{stat.value}</p>
                    </div>
                    <div className={`rounded-2xl bg-linear-to-br ${stat.accent} p-3 text-white shadow-lg`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400">
                  <BarChart3 className="h-4 w-4" />
                  {filteredTestSuites.length} {filteredTestSuites.length === 1 ? t('suiteLabel') : t('suitesLabel')}
                  {filteredTestSuites.length !== testSuites.length && (
                    <span className="text-slate-500 dark:text-slate-400">
                      ({t('filteredFrom')} {testSuites.length})
                    </span>
                  )}
                </div>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
                  {testSuites.length} {suitesLabel}
                </h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px] xl:w-[620px]">
                <div className="relative">
                  <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                  <Input
                    placeholder={t('searchTestSuites')}
                    className={`h-11 rounded-2xl border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 ${isRTL ? 'pr-10' : 'pl-10'}`}
                    value={suiteSearchQuery}
                    onChange={(e) => setSuiteSearchQuery(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                    <SlidersHorizontal className={`h-4 w-4 text-slate-400 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    <SelectValue placeholder={t('statusLabel')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allStatus')}</SelectItem>
                    <SelectItem value="active">{t('active')}</SelectItem>
                    <SelectItem value="inactive">{t('inactive')}</SelectItem>
                    <SelectItem value="archived">{t('archived')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50 text-blue-600 dark:bg-blue-950/40">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-950 dark:text-white">{t('loadingTestSuites')}</h3>
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  <AlertCircle className="h-8 w-8" />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-950 dark:text-white">{t('error')}</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{error}</p>
              </div>
            </div>
          ) : testSuites.length === 0 ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-4xl bg-blue-50 text-blue-600 dark:bg-blue-950/40">
                  <TestTube className="h-10 w-10" />
                </div>
                <h3 className="mt-5 text-xl font-black text-slate-950 dark:text-white">{t('noTestSuites')}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {t('createFirstTestSuite')}
                </p>
                <Button onClick={() => setIsDialogOpen(true)} className="mt-5 rounded-2xl bg-blue-600 hover:bg-blue-700">
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('createYourFirstTestSuite')}
                </Button>
              </div>
            </div>
          ) : filteredTestSuites.length === 0 ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                  <Search className="h-8 w-8" />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-950 dark:text-white">{t('noTestSuites')}</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('tryAdjustingSearchFilters')}</p>
                {hasActiveSuiteFilters && (
                  <Button
                    variant="outline"
                    className="mt-5 rounded-2xl"
                    onClick={() => {
                      setSuiteSearchQuery('');
                      setStatusFilter('all');
                    }}
                  >
                    {t('clearFilters')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 sm:p-6 xl:grid-cols-2">
              {filteredTestSuites.map((suite) => {
                const suiteCaseCount = suite.test_case_ids?.length || 0;

                return (
                  <Card
                    key={suite.id}
                    className="group overflow-hidden border-slate-200 bg-white shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-950/10 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-blue-800"
                  >
                    <CardHeader className="space-y-4 pb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 gap-3">
                          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-950/50 dark:text-blue-300">
                            <FolderOpen className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="truncate text-lg font-bold text-slate-950 dark:text-white">
                              {suite.name}
                            </CardTitle>
                            {suite.description ? (
                              <CardDescription className="mt-2 line-clamp-2 leading-6">
                                {suite.description}
                              </CardDescription>
                            ) : (
                              <CardDescription className="mt-2">{t('suiteDescription')}</CardDescription>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={suite.status === 'active' ? 'default' : 'secondary'}
                            className={suite.status === 'active' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}
                          >
                            {t(suite.status)}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/projects/${currentProjectId}/test-suites/${suite.id}`)}>
                                <FileText className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('viewDetails')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicateSuite(suite)}>
                                <Copy className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('duplicateSuite')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteSuite(suite)}
                                className="text-red-600 dark:text-red-400"
                              >
                                <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                          <div className="flex items-center text-xs font-medium text-slate-500 dark:text-slate-400">
                            <CalendarDays className={`h-3.5 w-3.5 ${isRTL ? 'ml-1.5' : 'mr-1.5'}`} />
                            {t('createdLabel')}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            {new Date(suite.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                          <div className="flex items-center text-xs font-medium text-slate-500 dark:text-slate-400">
                            <FileText className={`h-3.5 w-3.5 ${isRTL ? 'ml-1.5' : 'mr-1.5'}`} />
                            {t('testCases')}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            {suiteCaseCount} {suiteCaseCount === 1 ? t('case') : t('cases')}
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => navigate(`/projects/${currentProjectId}/test-suites/${suite.id}`)}
                        className="h-11 w-full rounded-2xl border-slate-200 font-semibold hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                      >
                        {t('viewDetails')}
                        <ChevronRight className={`h-4 w-4 ${isRTL ? 'mr-2 rotate-180' : 'ml-2'}`} />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
