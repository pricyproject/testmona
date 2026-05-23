import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, TestTube, Calendar, User, Play, Edit, Download, Trash2, Plus, Loader2, Search, ChevronLeft, ChevronRight, FileText, Filter, CheckSquare, Square } from 'lucide-react';
import { testSuitesAPI, testCasesAPI } from '@/lib/api';
import { TestSuite, TestCase } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

export function TestSuiteDetail() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const navigate = useNavigate();
  const [testSuite, setTestSuite] = useState<TestSuite | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);
  const [isBulkActionLoading, setIsBulkActionLoading] = useState(false);
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  
  // Debounced search for performance
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Optimized search with debouncing
  const debouncedSearch = useCallback((query: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      setSearchQuery(query);
    }, 300);
  }, []);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);
  
  // Pagination and filtering states
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const testCasesPerPage = 10;
  const normalizeTestCasesResponse = (data: unknown): TestCase[] => {
    if (Array.isArray(data)) {
      return data as TestCase[];
    }
    if (data && typeof data === 'object') {
      const maybeItems = (data as { items?: unknown }).items;
      if (Array.isArray(maybeItems)) {
        return maybeItems as TestCase[];
      }
      const maybeData = (data as { data?: unknown }).data;
      if (Array.isArray(maybeData)) {
        return maybeData as TestCase[];
      }
    }
    return [];
  };

  useEffect(() => {
    loadTestSuite();
  }, [projectId, id]);

  // Reset pagination when filters change - optimized with proper dependencies
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, priorityFilter]);

  const loadTestSuite = async () => {
    try {
      setLoading(true);
      const suiteId = parseInt(id!);
      const [suiteData, testCasesData] = await Promise.all([
        testSuitesAPI.getById(suiteId),
        testCasesAPI.getAll().then((cases) => normalizeTestCasesResponse(cases).filter((tc) => tc.test_suite_id === suiteId))
      ]);
      setTestSuite(suiteData);
      setTestCases(testCasesData);
    } catch (err) {
      console.error('Failed to load test suite:', err);
      setError(t('failedToLoadTestSuiteDetail'));
    } finally {
      setLoading(false);
    }
  };

  const handleEditTestSuite = () => {
    if (!testSuite) return;
    
    // Set the form with current test suite data
    setEditForm({
      name: testSuite.name,
      description: testSuite.description || ''
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!testSuite || !editForm.name.trim()) {
      toast({
        title: t('validationError'),
        description: t('testSuiteNameRequired'),
        variant: "destructive",
      });
      return;
    }
    
    // Client-side validation
    if (editForm.name.length < 3 || editForm.name.length > 100) {
      toast({
        title: t('validationError'),
        description: t('testSuiteNameLengthError'),
        variant: "destructive",
      });
      return;
    }
    
    if (editForm.description && editForm.description.length > 500) {
      toast({
        title: t('validationError'),
        description: t('descriptionLengthError'),
        variant: "destructive",
      });
      return;
    }
    
    // Store original for optimistic update revert
    const originalSuite = { ...testSuite };
    
    try {
      setIsUpdating(true);
      
      // Optimistic update
      const updatedSuite = { 
        ...testSuite, 
        name: editForm.name.trim(),
        description: editForm.description.trim()
      };
      
      setTestSuite(updatedSuite);
      
      // API call
      await testSuitesAPI.update(testSuite.id, updatedSuite);
      
      setIsEditDialogOpen(false);
      toast({
        title: t('success'),
        description: t('testSuiteUpdatedSuccessfully'),
      });
    } catch (err) {
      // Revert optimistic update
      setTestSuite(originalSuite);
      console.error('Failed to update test suite:', err);
      toast({
        title: t('error'),
        description: t('failedToUpdateTestSuite'),
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRunTestSuite = async () => {
    if (!testSuite) return;

    if (testCases.length === 0) {
      toast({
        title: t('noData'),
        description: t('noTestCasesInSuite'),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsCreatingRun(true);

      const testRunData = {
        name: t('testRunName', { name: testSuite.name, date: new Date().toLocaleDateString() }),
        description: t('automatedTestRunDescription', { name: testSuite.name }),
        project_id: parseInt(projectId!),
        status: 'pending' as const,
        priority: 'medium' as const,
      };

      const newTestRun = await testSuitesAPI.createRun(testSuite.id, testRunData);

      navigate(`/projects/${projectId}/test-runs/${newTestRun.id}`);
    } catch (err) {
      console.error('Failed to create test run from suite:', err);
      toast({
        title: t('error'),
        description: t('failedToCreateTestRun'),
        variant: "destructive",
      });
    } finally {
      setIsCreatingRun(false);
    }
  };

  const handleExportTestSuite = async () => {
    if (!testSuite) return;
    
    try {
      setIsExporting(true);
      
      // Get all test cases for this suite
      const suiteTestCases = await testCasesAPI
        .getAll()
        .then((cases) => normalizeTestCasesResponse(cases).filter((tc) => tc.test_suite_id === testSuite.id));
      
      if (suiteTestCases.length === 0) {
        toast({
          title: t('noData'),
          description: t('noTestCasesToExport'),
          variant: "destructive",
        });
        return;
      }
      
      // Create CSV content
      const csvHeaders = ['Title', 'Description', 'Priority', 'Status', 'Preconditions', 'Steps', 'Expected Result'];
      const csvRows = suiteTestCases.map(tc => [
        tc.title || '',
        tc.description || '',
        tc.priority || '',
        tc.status || '',
        tc.preconditions || '',
        tc.steps || '',
        tc.expected_result || ''
      ]);
      
      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      // Create and download CSV file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `test-suite-${testSuite.name}-${Date.now()}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: t('success'),
        description: t('exportedTestCasesSuccessfully', { count: suiteTestCases.length }),
      });
    } catch (err) {
      console.error('Failed to export test suite:', err);
      toast({
        title: t('error'),
        description: t('failedToExportTestSuite'),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteTestSuite = async () => {
    if (!testSuite) return;
    
    if (confirm(t('areYouSureToDeleteSuiteWithCases', { name: testSuite.name }))) {
      // Store original for optimistic update revert
      const deletedSuite = { ...testSuite };
      
      try {
        setIsDeleting(true);
        
        // Optimistic update - remove from UI immediately
        setTestSuite(null);
        
        await testSuitesAPI.delete(testSuite.id);
        
        toast({
          title: t('success'),
          description: t('testSuiteDeletedSuccessfullyDetail'),
        });
        
        // Navigate back to test suites list
        navigate(`/projects/${projectId}/test-suites`);
      } catch (err) {
        // Revert optimistic update
        setTestSuite(deletedSuite);
        console.error('Failed to delete test suite:', err);
        toast({
          title: t('error'),
          description: t('failedToDeleteTestSuiteDetail'),
          variant: "destructive",
        });
      } finally {
        setIsDeleting(false);
      }
    }
  };
  
  // Bulk operations
  const toggleTestCaseSelection = (testCaseId: number) => {
    setSelectedTestCases(prev => 
      prev.includes(testCaseId) 
        ? prev.filter(id => id !== testCaseId)
        : [...prev, testCaseId]
    );
  };
  
  const selectAllFiltered = () => {
    const allIds = filteredTestCases.map(tc => tc.id);
    setSelectedTestCases(allIds);
  };
  
  const deselectAll = () => {
    setSelectedTestCases([]);
  };
  
  const handleBulkDelete = async () => {
    if (selectedTestCases.length === 0) {
      toast({
        title: t('noSelection'),
        description: t('pleaseSelectTestCasesToDelete'),
        variant: "destructive",
      });
      return;
    }
    
    if (confirm(t('areYouSureToDeleteTestCases', { count: selectedTestCases.length }))) {
      // Store original for optimistic update revert
      const originalTestCases = [...testCases];
      
      try {
        setIsBulkActionLoading(true);
        
        // Optimistic update - remove selected test cases from UI
        setTestCases(prev => prev.filter(tc => !selectedTestCases.includes(tc.id)));
        
        // Delete all selected test cases
        await Promise.all(
          selectedTestCases.map(id => testCasesAPI.delete(id))
        );
        
        setSelectedTestCases([]);
        toast({
          title: t('success'),
          description: t('testCasesDeletedSuccessfully', { count: selectedTestCases.length }),
        });
      } catch (err) {
        // Revert optimistic update
        setTestCases(originalTestCases);
        console.error('Failed to delete test cases:', err);
        toast({
          title: t('error'),
          description: t('failedToDeleteTestCases'),
          variant: "destructive",
        });
      } finally {
        setIsBulkActionLoading(false);
      }
    }
  };

  // Filter and paginate test cases
  const filteredTestCases = useMemo(() => {
    let filtered = testCases;
    
    // Search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(tc => 
        tc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tc.description && tc.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (tc.preconditions && tc.preconditions.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(tc => tc.status === statusFilter);
    }
    
    // Priority filter
    if (priorityFilter !== 'all') {
      filtered = filtered.filter(tc => tc.priority === priorityFilter);
    }
    
    return filtered;
  }, [testCases, searchQuery, statusFilter, priorityFilter]);

  // Paginated test cases - optimized for large datasets
  const paginatedTestCases = useMemo(() => {
    const startIndex = (currentPage - 1) * testCasesPerPage;
    const endIndex = startIndex + testCasesPerPage;
    return filteredTestCases.slice(startIndex, endIndex);
  }, [filteredTestCases, currentPage]);

  // Pagination calculations - memoized for performance
  const paginationInfo = useMemo(() => {
    const totalPages = Math.ceil(filteredTestCases.length / testCasesPerPage);
    const startIndex = filteredTestCases.length > 0 ? (currentPage - 1) * testCasesPerPage + 1 : 0;
    const endIndex = Math.min(currentPage * testCasesPerPage, filteredTestCases.length);
    return { totalPages, startIndex, endIndex };
  }, [filteredTestCases, currentPage, testCasesPerPage]);

  const handlePageChange = useCallback((page: number) => {
    // Validate page number
    if (page >= 1 && page <= paginationInfo.totalPages) {
      setCurrentPage(page);
    }
  }, [paginationInfo.totalPages]);
  
  // Reset filters function
  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setCurrentPage(1);
    setSelectedTestCases([]);
  }, []);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'destructive';
      case 'high': return 'default';
      case 'medium': return 'secondary';
      case 'low': return 'outline-solid';
      default: return 'secondary';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'default';
      case 'draft': return 'secondary';
      case 'deprecated': return 'outline-solid';
      default: return 'secondary';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <TestTube className="mx-auto h-8 w-8 animate-spin text-blue-500" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">{t('loadingTestSuiteDetail')}</h3>
        </div>
      </div>
    );
  }

  if (error || !testSuite) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <TestTube className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">{t('testSuiteNotFound')}</h3>
          <p className="mt-1 text-sm text-gray-500">{error || t('testSuiteNotFoundDescription')}</p>
          <Button className="mt-4" onClick={() => navigate(`/projects/${projectId}/test-suites`)}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('backToTestSuites')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${isRTL ? 'rtl' : 'ltr'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/test-suites`)}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('back')}
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{testSuite.name}</h1>
            <p className="text-gray-600">{t('testSuiteDetails')}</p>
          </div>
        </div>
        <Badge variant={testSuite.status === 'active' ? 'default' : 'secondary'}>
          {t(testSuite.status)}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-500">{t('description')}</label>
              <p className="mt-1">{testSuite.description || t('noDescriptionProvided')}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">{t('statusLabel')}</label>
                <p className="mt-1 capitalize">{t(testSuite.status)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">{t('projectIdLabel')}</label>
                <p className="mt-1">{testSuite.project_id}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <div className="flex items-center">
                <Calendar className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                {t('createdLabel')} {new Date(testSuite.created_at).toLocaleDateString()}
              </div>
              {testSuite.updated_at && (
                <div className="flex items-center">
                  <User className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('updatedLabel')} {new Date(testSuite.updated_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" variant="default" onClick={handleEditTestSuite} disabled={isUpdating}>
              {isUpdating && <Loader2 className={`mr-2 h-4 w-4 animate-spin`} />}
              <Edit className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('editTestSuite')}
            </Button>
            <Button className="w-full" variant="outline" onClick={handleRunTestSuite} disabled={isCreatingRun || testCases.length === 0}>
              {isCreatingRun && <Loader2 className={`mr-2 h-4 w-4 animate-spin`} />}
              <Play className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('runTestSuite')}
            </Button>
            <Button className="w-full" variant="outline" onClick={handleExportTestSuite} disabled={isExporting}>
              {isExporting && <Loader2 className={`mr-2 h-4 w-4 animate-spin`} />}
              <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('exportTestSuite')}
            </Button>
            <Button className="w-full" variant="destructive" onClick={handleDeleteTestSuite} disabled={isDeleting}>
              {isDeleting && <Loader2 className={`mr-2 h-4 w-4 animate-spin`} />}
              <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('deleteTestSuite')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('testCasesCount', { count: filteredTestCases.length })}</CardTitle>
          {/* Search and Filter Controls */}
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t('searchTestCasesPlaceholder')}
                  onChange={(e) => debouncedSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t('statusLabel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStatus')}</SelectItem>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="draft">{t('draft')}</SelectItem>
                  <SelectItem value="deprecated">{t('deprecated')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t('priority')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allPriority')}</SelectItem>
                  <SelectItem value="critical">{t('critical')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                  <SelectItem value="medium">{t('medium')}</SelectItem>
                  <SelectItem value="low">{t('low')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Bulk Operations Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllFiltered}
                  disabled={filteredTestCases.length === 0}
                >
                  <CheckSquare className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('selectAllCount', { count: filteredTestCases.length })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deselectAll}
                  disabled={selectedTestCases.length === 0}
                >
                  <Square className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                  {t('deselectAll')}
                </Button>
                {selectedTestCases.length > 0 && (
                  <>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t('selectedCount', { count: selectedTestCases.length })}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkDelete}
                      disabled={isBulkActionLoading}
                    >
                      {isBulkActionLoading && <Loader2 className={`mr-2 h-4 w-4 animate-spin`} />}
                      <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('deleteSelected')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {/* Results count and filter info */}
            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
              <div>
                {filteredTestCases.length > 0 ? (
                  paginationInfo.totalPages > 1 ? (
                    <span>{t('showingTestCasesRange', { start: paginationInfo.startIndex, end: paginationInfo.endIndex, total: filteredTestCases.length })}</span>
                  ) : (
                    <span>{t('testCasesCountSimple', { count: filteredTestCases.length })}</span>
                  )
                ) : (
                  <span>{t('noTestCasesFound')}</span>
                )}
                {filteredTestCases.length !== testCases.length && filteredTestCases.length > 0 && (
                  <span className="ml-2">
                    {t('filteredFromTotal', { total: testCases.length })}
                  </span>
                )}
              </div>
              {(searchQuery || statusFilter !== 'all' || priorityFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="text-xs"
                >
                  {t('clearFilters')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTestCases.length === 0 ? (
            <div className="text-center py-8">
              <TestTube className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-semibold text-gray-900">
                {testCases.length === 0 ? t('noTestCases') : t('noMatchingTestCases')}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {testCases.length === 0 
                  ? t('noTestCasesInSuite')
                  : t('tryAdjustingSearchFilters')
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedTestCases.map((testCase) => (
                <div key={testCase.id} className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Checkbox
                        checked={selectedTestCases.includes(testCase.id)}
                        onCheckedChange={() => toggleTestCaseSelection(testCase.id)}
                        className="mt-1 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                          <h4 className="font-medium text-gray-900 dark:text-white truncate">
                            {testCase.title}
                          </h4>
                        </div>
                        
                        {testCase.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                            {testCase.description}
                          </p>
                        )}
                        
                        {testCase.preconditions && (
                          <div className="text-xs text-gray-500 dark:text-gray-500 mb-2">
                            <span className="font-medium">{t('preconditions')}</span> {testCase.preconditions}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={getStatusColor(testCase.status)} className="text-xs">
                            {t(testCase.status)}
                          </Badge>
                          <Badge variant={getPriorityColor(testCase.priority)} className="text-xs">
                            {t(testCase.priority)}
                          </Badge>
                          {testCase.tags && (
                            <Badge variant="outline" className="text-xs">
                              {testCase.tags}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => navigate(`/projects/${projectId}/test-cases/${testCase.id}`)}
                        className="shrink-0"
                      >
                        {t('viewDetails')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Pagination Controls */}
              {paginationInfo.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {t('showingTestCasesRange', { start: paginationInfo.startIndex, end: paginationInfo.endIndex, total: filteredTestCases.length })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, paginationInfo.totalPages) }, (_, i) => {
                        let pageNum;
                        if (paginationInfo.totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= paginationInfo.totalPages - 2) {
                          pageNum = paginationInfo.totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        
                        return (
                          <Button
                            key={pageNum}
                            variant={currentPage === pageNum ? "default" : "outline-solid"}
                            size="sm"
                            onClick={() => handlePageChange(pageNum)}
                            className="h-8 w-8 p-0 text-xs"
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === paginationInfo.totalPages}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Test Suite Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent isRTL={isRTL} className={`sm:max-w-[425px] ${isRTL ? 'rtl' : 'ltr'}`}>
          <DialogHeader>
            <DialogTitle>{t('editTestSuite')}</DialogTitle>
            <DialogDescription>
              {t('makeChangesToTestSuite')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className={`text-right ${isRTL ? 'text-left' : ''}`}>
                {t('nameLabel')}
              </Label>
              <Input
                id="name"
                value={editForm.name}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                className="col-span-3"
                placeholder={t('enterTestSuiteName')}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className={`text-right pt-2 ${isRTL ? 'text-left' : ''}`}>
                {t('description')}
              </Label>
              <Textarea
                id="description"
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                className="col-span-3"
                placeholder={t('enterTestSuiteDescription')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleSaveEdit}
              disabled={!editForm.name.trim() || isUpdating}
            >
              {isUpdating && <Loader2 className={`mr-2 h-4 w-4 animate-spin`} />}
              {t('saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
