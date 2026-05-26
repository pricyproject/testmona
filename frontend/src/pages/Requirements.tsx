import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Search, ChevronLeft, ChevronRight, Edit, Trash2, Download, Eye, Users, Clock, CheckCircle, AlertCircle, XCircle, AlertTriangle, ExternalLink, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { requirementsAPI } from '@/lib/api';
import { Requirement, RequirementCreate, RequirementUpdate } from '@/types';
import { ContentEditor } from '@/components/ui/content-editor';
import { GherkinViewer } from '@/components/requirements/GherkinViewer';
import { diffWords } from 'diff';

const parsePositiveQueryNumber = (value: string | null): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export function Requirements() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t, isRTL } = useTranslation();
  const linkedMilestoneId = parsePositiveQueryNumber(searchParams.get('milestone_id'));
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRequirement, setSelectedRequirement] = useState<Requirement | null>(null);
  const [requirementToDelete, setRequirementToDelete] = useState<Requirement | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const itemsPerPage = 10;

  // Form states
  const [reqTitle, setReqTitle] = useState('');
  const [reqDescription, setReqDescription] = useState('');
  const [reqId, setReqId] = useState('');
  const [reqPriority, setReqPriority] = useState('medium');
  const [reqStatus, setReqStatus] = useState('draft');
  const [reqAcceptanceCriteria, setReqAcceptanceCriteria] = useState('');
  const [reqTags, setReqTags] = useState('');
  const [reqEstimatedEffort, setReqEstimatedEffort] = useState('');
  const [useGherkinSyntax, setUseGherkinSyntax] = useState(false);
  const [externalDocumentUrl, setExternalDocumentUrl] = useState('');
  const [isFetchingDocument, setIsFetchingDocument] = useState(false);
  const [showExternalImport, setShowExternalImport] = useState(false);
  const [showAdvancedRequirementTools, setShowAdvancedRequirementTools] = useState(false);
  const [initialFormState, setInitialFormState] = useState<any>(null);
  const draftSaveTimeoutRef = useRef<number | null>(null);
  const [contentVersions, setContentVersions] = useState<Array<{ id: string; createdAt: string; description: string; acceptance: string }>>([]);
  const [compareFromId, setCompareFromId] = useState<string>('');
  const [compareToId, setCompareToId] = useState<string>('');

  const getPlainTextLength = (html: string): number =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length;
  
  const toPlain = (html: string): string =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Requirement description/acceptance is stored as rich-text HTML, sometimes
  // escaped or double-escaped. Decode it, then show only readable text in the
  // list/export views so wrapper tags like <p> are not displayed.
  const toDisplayText = (value?: string | null): string => {
    if (!value) return '';
    const decodeHtmlEntities = (input: string): string => {
      const namedEntities: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };

      return input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
          const codePoint = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }

        if (entity.startsWith('#')) {
          const codePoint = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }

        return namedEntities[entity] ?? match;
      });
    };

    const decoded = decodeHtmlEntities(decodeHtmlEntities(value));
    if (!/<[a-z][\s\S]*>/i.test(decoded)) {
      return decoded.replace(/\s+/g, ' ').trim();
    }

    const htmlForText = decoded
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote|section)\s*>/gi, '\n');

    if (typeof window === 'undefined') {
      return htmlForText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const parsed = new DOMParser().parseFromString(htmlForText, 'text/html');
    return (parsed.body.textContent || decoded).replace(/\s+/g, ' ').trim();
  };

  const gherkinTemplate = [
    'Feature: ',
    '',
    '  Scenario: ',
    '    Given ',
    '    When ',
    '    Then ',
  ].join('\n');

  const gherkinBackgroundTemplate = ['  Background:', '    Given '].join('\n');
  const gherkinScenarioOutlineTemplate = [
    '  Scenario Outline: ',
    '    Given ',
    '    When ',
    '    Then ',
    '',
    '    Examples:',
    '      | input | result |',
    '      | value | expected |',
  ].join('\n');

  const looksLikeGherkin = (value: string): boolean =>
    /^\s*(Feature|Scenario|Scenario Outline|Background|Given|When|Then|And|But):?\b/im.test(value);

  const isValidExternalDocumentUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      // Match on the host only — matching the path let through URLs like
      // https://evil.com/jira. The backend remains the authoritative gate.
      const host = parsed.hostname.toLowerCase();
      return host.endsWith('.atlassian.net') || /(^|\.)(jira|confluence)(\.|$)/.test(host);
    } catch {
      return false;
    }
  };

  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const buildExternalDocumentText = (documentData: any, currentDescription: string): string => {
    const sourceType = String(documentData.source_type || 'external').toLowerCase();
    const heading = sourceType === 'confluence' ? t('confluenceDocument') : t('jiraDocument');
    const sourceUrl = String(documentData.url || '');
    const documentText = [
      `<section data-requirement-source="true" data-requirement-source-url="${escapeHtml(sourceUrl)}">`,
      `<h2>${escapeHtml(`${heading}: ${documentData.title || t('untitledDocument')}`)}</h2>`,
      documentData.external_key ? `<p><strong>Key:</strong> ${escapeHtml(String(documentData.external_key))}</p>` : '',
      `<p><strong>Source:</strong> <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>`,
      `<pre>${escapeHtml(documentData.description || '')}</pre>`,
      '</section>',
    ].filter(Boolean).join('');

    const existing = currentDescription.trim();
    if (!existing) return documentText;
    if (/data-requirement-source-url=/i.test(existing)) return documentText;
    return `${existing}<hr />${documentText}`;
  };

  const insertGherkinSnippet = (snippet: string) => {
    setReqAcceptanceCriteria((current) => current.trim() ? `${current.trim()}\n\n${snippet}` : snippet);
  };

  const buildDiffHtml = (from: string, to: string): string => {
    const parts = diffWords(toPlain(from), toPlain(to));
    return parts
      .map((part) => {
        const escaped = part.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        if (part.added) return `<span style="background:#dcfce7;color:#166534;">${escaped}</span>`;
        if (part.removed) return `<span style="background:#fee2e2;color:#991b1b;text-decoration:line-through;">${escaped}</span>`;
        return `<span>${escaped}</span>`;
      })
      .join('');
  };

  const saveVersionSnapshot = () => {
    const snapshot = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      description: reqDescription,
      acceptance: reqAcceptanceCriteria,
    };
    setContentVersions((previous) => [snapshot, ...previous].slice(0, 30));
    setCompareFromId(snapshot.id);
  };

  const loadRequirements = useCallback(async () => {
    if (!projectId) return;
    
    try {
      setLoading(true);
      // Fetch a high limit so projects with >100 requirements are not silently truncated.
      const data = await requirementsAPI.getAll(parseInt(projectId), 0, 1000, {
        milestoneId: linkedMilestoneId,
      });
      setRequirements(data);
    } catch (error) {
      console.error('Error loading requirements:', error);
      toast({
        title: t('error'),
        description: t('failedToLoadRequirements'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, linkedMilestoneId, t, toast]);

  // Load requirements
  useEffect(() => {
    Promise.resolve().then(loadRequirements);
  }, [loadRequirements]);

  // Filtering logic
  const filteredRequirements = requirements.filter(req => {
    const matchesSearch = searchQuery === '' || 
      req.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.requirement_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.tags?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || req.priority === priorityFilter;
    
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRequirements.length / itemsPerPage));
  // Clamp so a stale page index (e.g. after filtering) never yields an empty slice.
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * itemsPerPage;
  const paginatedRequirements = filteredRequirements.slice(startIndex, startIndex + itemsPerPage);

  // Reset to the first page whenever the active filters change.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, priorityFilter]);

  // API functions
  const handleCreateRequirement = async () => {
    if (!projectId) return;
    
    if (!reqId.trim() || !reqTitle.trim()) {
      toast({
        title: t('error'),
        description: t('fieldRequired', {field: 'All required fields'}),
        variant: 'destructive',
      });
      return;
    }
    
    if (!/^REQ-\d{3,}$/.test(reqId.trim())) {
      toast({
        title: t('error'),
        description: t('requirementIdInvalid'),
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      let currentUser;
      try {
        currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      } catch {
        currentUser = { id: 1 };
      }
      
      const estimatedEffort = reqEstimatedEffort ? parseFloat(reqEstimatedEffort) : undefined;
      if (estimatedEffort !== undefined && (!Number.isFinite(estimatedEffort) || estimatedEffort < 0)) {
        toast({
          title: t('error'),
          description: t('estimatedEffortInvalid'),
          variant: 'destructive',
        });
        return;
      }
      
      const newRequirement: RequirementCreate = {
        title: reqTitle,
        description: reqDescription,
        requirement_id: reqId,
        priority: reqPriority as any,
        status: reqStatus as any,
        acceptance_criteria: reqAcceptanceCriteria,
        tags: reqTags,
        estimated_effort: estimatedEffort,
        project_id: parseInt(projectId),
        created_by: currentUser.id || 1,
      };

      await requirementsAPI.create(newRequirement);
      
      toast({
        title: t('success'),
        description: t('requirementCreated', {name: reqTitle}),
      });
      
      setIsCreateDialogOpen(false);
      resetForm();
      loadRequirements();
    } catch (error: any) {
      console.error('Error creating requirement:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToCreateRequirement'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditRequirement = (requirement: Requirement) => {
    setSelectedRequirement(requirement);
    setReqTitle(requirement.title);
    setReqDescription(requirement.description || '');
    setReqId(requirement.requirement_id);
    setReqPriority(requirement.priority);
    setReqStatus(requirement.status);
    setReqAcceptanceCriteria(requirement.acceptance_criteria || '');
    setReqTags(requirement.tags || '');
    setReqEstimatedEffort(requirement.estimated_effort?.toString() || '');
    setUseGherkinSyntax(looksLikeGherkin(requirement.acceptance_criteria || ''));
    setExternalDocumentUrl('');
    setShowExternalImport(false);
    setShowAdvancedRequirementTools(false);
    setInitialFormState({
      title: requirement.title,
      description: requirement.description || '',
      priority: requirement.priority,
      status: requirement.status,
      acceptanceCriteria: requirement.acceptance_criteria || '',
      tags: requirement.tags || '',
      estimatedEffort: requirement.estimated_effort?.toString() || '',
      useGherkinSyntax: looksLikeGherkin(requirement.acceptance_criteria || ''),
    });
    setContentVersions([]);
    setCompareFromId('');
    setCompareToId('');
    setIsEditDialogOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  const handleUpdateRequirement = async () => {
    if (!selectedRequirement) return;
    
    if (!reqTitle.trim()) {
      toast({
        title: t('error'),
        description: t('fieldRequired', {field: 'Title'}),
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      const estimatedEffort = reqEstimatedEffort ? parseFloat(reqEstimatedEffort) : undefined;
      if (estimatedEffort !== undefined && (!Number.isFinite(estimatedEffort) || estimatedEffort < 0)) {
        toast({
          title: t('error'),
          description: t('estimatedEffortInvalid'),
          variant: 'destructive',
        });
        return;
      }
      
      const updateData: RequirementUpdate = {
        title: reqTitle,
        description: reqDescription,
        priority: reqPriority as any,
        status: reqStatus as any,
        acceptance_criteria: reqAcceptanceCriteria,
        tags: reqTags,
        estimated_effort: estimatedEffort,
      };

      await requirementsAPI.update(selectedRequirement.id, updateData);
      
      toast({
        title: t('success'),
        description: t('requirementUpdated'),
      });
      
      setIsEditDialogOpen(false);
      setSelectedRequirement(null);
      resetForm();
      loadRequirements();
    } catch (error: any) {
      console.error('Error updating requirement:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToUpdateRequirement'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequirement = async () => {
    if (!requirementToDelete) return;
    
    if (deleteConfirmationName.trim().toLowerCase() !== requirementToDelete.title.trim().toLowerCase()) {
      toast({
        title: t('error'),
        description: t('titleDoesntMatch'),
        variant: 'destructive',
      });
      return;
    }

    try {
      await requirementsAPI.delete(requirementToDelete.id);
      
      toast({
        title: t('success'),
        description: t('requirementDeleted', {name: requirementToDelete.title}),
      });
      
      setIsDeleteDialogOpen(false);
      setRequirementToDelete(null);
      setDeleteConfirmationName('');
      
      // Reload requirements
      loadRequirements();
    } catch (error) {
      console.error('Error deleting requirement:', error);
      toast({
        title: t('error'),
        description: t('failedToDeleteRequirement'),
        variant: 'destructive',
      });
    }
  };

  const handleFetchExternalDocument = async () => {
    if (!projectId) return;
    const url = externalDocumentUrl.trim();
    if (!isValidExternalDocumentUrl(url)) {
      toast({
        title: t('validationError'),
        description: t('externalDocInvalidUrl'),
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsFetchingDocument(true);
      const documentData = await requirementsAPI.fetchExternalDocument({
        project_id: Number(projectId),
        url,
      });
      setReqTitle(documentData.title || reqTitle);
      setReqDescription(buildExternalDocumentText(documentData, reqDescription));
      setReqAcceptanceCriteria(documentData.acceptance_criteria || reqAcceptanceCriteria);
      setUseGherkinSyntax(looksLikeGherkin(documentData.acceptance_criteria || reqAcceptanceCriteria));
      toast({
        title: t('success'),
        description: t('externalDocImported', { title: documentData.title || url }),
      });
    } catch (error: any) {
      console.error('Error fetching external document:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('failedToFetchExternalDoc'),
        variant: 'destructive',
      });
    } finally {
      setIsFetchingDocument(false);
    }
  };

  const resetForm = () => {
    setReqTitle('');
    setReqDescription('');
    setReqId('');
    setReqPriority('medium');
    setReqStatus('draft');
    setReqAcceptanceCriteria('');
    setReqTags('');
    setReqEstimatedEffort('');
    setUseGherkinSyntax(false);
    setExternalDocumentUrl('');
    setShowExternalImport(false);
    setShowAdvancedRequirementTools(false);
    setHasUnsavedChanges(false);
    setInitialFormState(null);
    if (projectId) {
      localStorage.removeItem(`requirement-draft-${projectId}`);
    }
  };
  
  const currentFormState = useMemo(() => ({
      title: reqTitle,
      description: reqDescription,
      priority: reqPriority,
      status: reqStatus,
      acceptanceCriteria: reqAcceptanceCriteria,
      tags: reqTags,
      estimatedEffort: reqEstimatedEffort,
      useGherkinSyntax,
  }), [reqTitle, reqDescription, reqPriority, reqStatus, reqAcceptanceCriteria, reqTags, reqEstimatedEffort, useGherkinSyntax]);

  const checkUnsavedChanges = useCallback(() => {
    return JSON.stringify(currentFormState) !== JSON.stringify(initialFormState);
  }, [currentFormState, initialFormState]);
  
  const handleDialogClose = (dialogType: 'create' | 'edit') => {
    if (hasUnsavedChanges && checkUnsavedChanges()) {
      setShowUnsavedDialog(true);
      return;
    }
    if (dialogType === 'create') {
      setIsCreateDialogOpen(false);
    } else {
      setIsEditDialogOpen(false);
      setSelectedRequirement(null);
    }
    resetForm();
  };
  
  const handleUnsavedConfirm = (dialogType: 'create' | 'edit') => {
    setShowUnsavedDialog(false);
    if (dialogType === 'create') {
      setIsCreateDialogOpen(false);
    } else {
      setIsEditDialogOpen(false);
      setSelectedRequirement(null);
    }
    resetForm();
  };
  
  const handleUnsavedCancel = () => {
    setShowUnsavedDialog(false);
  };

  const handleViewRequirement = (requirement: Requirement) => {
    if (projectId) {
      navigate(`/projects/${projectId}/requirements/${requirement.id}`);
    }
  };

  const openDeleteDialog = (requirement: Requirement) => {
    setRequirementToDelete(requirement);
    setDeleteConfirmationName('');
    setIsDeleteDialogOpen(true);
  };

  const handleExportRequirements = () => {
    if (filteredRequirements.length === 0) {
      toast({
        title: t('error'),
        description: t('noRequirementsFound'),
        variant: 'destructive',
      });
      return;
    }

    const escapeCsv = (value: unknown): string => {
      const str = value == null ? '' : String(value);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headers = ['Requirement ID', 'Title', 'Status', 'Priority', 'Tags', 'Estimated Effort', 'Description', 'Acceptance Criteria', 'Created At'];
    const rows = filteredRequirements.map((req) => [
      req.requirement_id,
      req.title,
      req.status,
      req.priority,
      req.tags || '',
      req.estimated_effort ?? '',
      toDisplayText(req.description),
      toDisplayText(req.acceptance_criteria),
      req.created_at,
    ].map(escapeCsv).join(','));

    // Prepend a BOM so Excel reads the UTF-8 content correctly.
    const csv = '﻿' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `requirements-project-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: t('success'),
      description: t('requirementsExported', { count: filteredRequirements.length }),
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      reviewed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      implemented: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      deprecated: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    };
    return variants[priority] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft':
        return <FileText className="h-4 w-4" />;
      case 'reviewed':
        return <Eye className="h-4 w-4" />;
      case 'approved':
        return <CheckCircle className="h-4 w-4" />;
      case 'implemented':
        return <Users className="h-4 w-4" />;
      case 'verified':
        return <CheckCircle className="h-4 w-4" />;
      case 'deprecated':
        return <XCircle className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  // Generate next requirement ID
  const generateRequirementId = () => {
    if (requirements.length === 0) {
      return 'REQ-001';
    }
    
    // Only consider well-formed "REQ-<number>" ids so an outlier like
    // "REQ-2024-001" cannot inflate the next suggested id.
    const maxId = requirements.reduce((max, req) => {
      const match = /^REQ-(\d+)$/.exec((req.requirement_id || '').trim());
      if (!match) return max;
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }, 0);
    return `REQ-${String(maxId + 1).padStart(3, '0')}`;
  };

  // Initialize requirement ID when opening create dialog
  const handleOpenCreateDialog = () => {
    if (projectId) {
      const rawDraft = localStorage.getItem(`requirement-draft-${projectId}`);
      if (rawDraft) {
        try {
          const draft = JSON.parse(rawDraft);
          setReqTitle(draft.reqTitle || '');
          setReqDescription(draft.reqDescription || '');
          setReqId(draft.reqId || generateRequirementId());
          setReqPriority(draft.reqPriority || 'medium');
          setReqStatus(draft.reqStatus || 'draft');
          setReqAcceptanceCriteria(draft.reqAcceptanceCriteria || '');
          setReqTags(draft.reqTags || '');
          setReqEstimatedEffort(draft.reqEstimatedEffort || '');
          setUseGherkinSyntax(Boolean(draft.useGherkinSyntax || looksLikeGherkin(draft.reqAcceptanceCriteria || '')));
          setExternalDocumentUrl('');
          setShowExternalImport(false);
          setShowAdvancedRequirementTools(false);
          setInitialFormState({
            title: draft.reqTitle || '',
            description: draft.reqDescription || '',
            priority: draft.reqPriority || 'medium',
            status: draft.reqStatus || 'draft',
            acceptanceCriteria: draft.reqAcceptanceCriteria || '',
            tags: draft.reqTags || '',
            estimatedEffort: draft.reqEstimatedEffort || '',
            useGherkinSyntax: Boolean(draft.useGherkinSyntax || looksLikeGherkin(draft.reqAcceptanceCriteria || '')),
          });
          setContentVersions([]);
          setCompareFromId('');
          setCompareToId('');
          setIsCreateDialogOpen(true);
          setTimeout(() => titleInputRef.current?.focus(), 100);
          return;
        } catch {
          localStorage.removeItem(`requirement-draft-${projectId}`);
        }
      }
    }
    resetForm();
    setReqId(generateRequirementId());
    setUseGherkinSyntax(false);
    setExternalDocumentUrl('');
    setShowExternalImport(false);
    setShowAdvancedRequirementTools(false);
    setInitialFormState({
      title: '',
      description: '',
      priority: 'medium',
      status: 'draft',
      acceptanceCriteria: '',
      tags: '',
      estimatedEffort: '',
      useGherkinSyntax: false,
    });
    setContentVersions([]);
    setCompareFromId('');
    setCompareToId('');
    setIsCreateDialogOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  useEffect(() => {
    if (!isCreateDialogOpen || !projectId) return;
    if (draftSaveTimeoutRef.current) {
      window.clearTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      localStorage.setItem(
        `requirement-draft-${projectId}`,
        JSON.stringify({
          reqTitle,
          reqDescription,
          reqId,
          reqPriority,
          reqStatus,
          reqAcceptanceCriteria,
          reqTags,
          reqEstimatedEffort,
          useGherkinSyntax,
        })
      );
    }, 350);
    return () => {
      if (draftSaveTimeoutRef.current) {
        window.clearTimeout(draftSaveTimeoutRef.current);
      }
    };
  }, [isCreateDialogOpen, projectId, reqTitle, reqDescription, reqId, reqPriority, reqStatus, reqAcceptanceCriteria, reqTags, reqEstimatedEffort, useGherkinSyntax]);
  
  // Track form changes
  useEffect(() => {
    if (initialFormState) {
      Promise.resolve().then(() => setHasUnsavedChanges(checkUnsavedChanges()));
    }
  }, [checkUnsavedChanges, initialFormState]);
  
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((isCreateDialogOpen || isEditDialogOpen) && !showUnsavedDialog) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleDialogClose(isCreateDialogOpen ? 'create' : 'edit');
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (isCreateDialogOpen) {
            handleCreateRequirement();
          } else {
            handleUpdateRequirement();
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);

  }, [isCreateDialogOpen, isEditDialogOpen, showUnsavedDialog, reqId, reqTitle, reqDescription, reqPriority, reqStatus, reqAcceptanceCriteria, reqTags, reqEstimatedEffort, selectedRequirement]);

  const renderExternalDocumentImport = (inputId: string) => (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="flex items-center gap-2">
        <ExternalLink className="h-4 w-4 text-blue-600 dark:text-blue-300" />
        <Label htmlFor={inputId} className="text-sm font-semibold">
          {t('importFromAtlassian')}
        </Label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          value={externalDocumentUrl}
          onChange={(e) => setExternalDocumentUrl(e.target.value)}
          placeholder={t('externalDocUrlPlaceholder')}
          className="min-w-0 flex-1"
          dir="ltr"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleFetchExternalDocument}
          disabled={isFetchingDocument || !externalDocumentUrl.trim()}
          className="shrink-0"
        >
          {isFetchingDocument ? (
            <>
              <div className={`h-4 w-4 animate-spin rounded-full border-b-2 border-current ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
              {t('fetching')}
            </>
          ) : (
            <>
              <Wand2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('fetchDocument')}
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-blue-700 dark:text-blue-300">{t('externalDocImportHelp')}</p>
    </div>
  );

  const renderRequirementModeControls = (idPrefix: string) => (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <Label htmlFor={`${idPrefix}-external-import`} className="text-sm font-medium">
          {t('importFromAtlassian')}
        </Label>
        <Switch
          id={`${idPrefix}-external-import`}
          checked={showExternalImport}
          onCheckedChange={setShowExternalImport}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <Label htmlFor={`${idPrefix}-advanced-tools`} className="text-sm font-medium">
          {t('advancedRequirementTools')}
        </Label>
        <Switch
          id={`${idPrefix}-advanced-tools`}
          checked={showAdvancedRequirementTools}
          onCheckedChange={setShowAdvancedRequirementTools}
        />
      </div>
    </div>
  );

  const renderAcceptanceCriteriaEditor = (idPrefix: string) => (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Label htmlFor={`${idPrefix}-acceptanceCriteria`} className="text-base font-semibold">
          {t('acceptanceCriteria')}
        </Label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{getPlainTextLength(reqAcceptanceCriteria)} {t('chars')}</span>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${idPrefix}-gherkin`} className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('gherkinSyntax')}
            </Label>
            <Switch
              id={`${idPrefix}-gherkin`}
              checked={useGherkinSyntax}
              onCheckedChange={(checked) => {
                setUseGherkinSyntax(checked);
                if (checked && !reqAcceptanceCriteria.trim()) {
                  setReqAcceptanceCriteria(gherkinTemplate);
                }
              }}
            />
          </div>
        </div>
      </div>
      {useGherkinSyntax ? (
        <div className="space-y-2">
          <Textarea
            id={`${idPrefix}-acceptanceCriteria`}
            value={reqAcceptanceCriteria}
            onChange={(e) => setReqAcceptanceCriteria(e.target.value)}
            placeholder={t('gherkinAcceptancePlaceholder')}
            dir={isRTL ? 'rtl' : 'ltr'}
            className="min-h-[190px] font-mono text-sm leading-6"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => insertGherkinSnippet(gherkinTemplate)}
            >
              {t('insertGherkinTemplate')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => insertGherkinSnippet(gherkinBackgroundTemplate)}>
              {t('insertGherkinBackground')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => insertGherkinSnippet(gherkinScenarioOutlineTemplate)}>
              {t('insertScenarioOutline')}
            </Button>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('gherkinPreview')}</div>
            <GherkinViewer value={reqAcceptanceCriteria} emptyLabel={t('noAcceptanceCriteriaProvided')} />
          </div>
        </div>
      ) : (
        <ContentEditor
          value={reqAcceptanceCriteria}
          onChange={setReqAcceptanceCriteria}
          placeholder={t('enterAcceptanceCriteria')}
          format="html"
          dir={isRTL ? 'rtl' : 'ltr'}
          minHeight="170px"
        />
      )}
      <p className="text-xs text-gray-500">
        {useGherkinSyntax ? t('gherkinAcceptanceHelper') : t('acceptanceCriteriaHelper')}
      </p>
    </div>
  );

  const fromSnapshot = contentVersions.find((version) => version.id === compareFromId) || null;
  const toSnapshot = contentVersions.find((version) => version.id === compareToId) || null;

  const renderVersionHistory = () => (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{t('rteVersionHistory')}</Label>
        <Button type="button" size="sm" variant="outline" onClick={saveVersionSnapshot}>
          {t('rteSaveSnapshot')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={compareFromId}
          onChange={(e) => setCompareFromId(e.target.value)}
        >
          <option value="">{t('rteCompareFrom')}</option>
          {contentVersions.map((version) => (
            <option key={version.id} value={version.id}>
              {new Date(version.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={compareToId}
          onChange={(e) => setCompareToId(e.target.value)}
        >
          <option value="">{t('rteCompareTo')}</option>
          {contentVersions.map((version) => (
            <option key={version.id} value={version.id}>
              {new Date(version.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
      </div>
      {fromSnapshot && toSnapshot && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900/30">
          <div className="font-medium">{t('rteInlineDiff')}</div>
          <div
            className="prose prose-sm max-w-none whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: buildDiffHtml(fromSnapshot.description, toSnapshot.description) }}
          />
        </div>
      )}
    </div>
  );

  const requirementStatusOptions = ['draft', 'reviewed', 'approved', 'implemented', 'verified', 'deprecated'];
  const requirementPriorityOptions = ['low', 'medium', 'high', 'critical'];
  const isRequirementIdValid = /^REQ-\d{3,}$/.test(reqId.trim());
  const estimatedEffortValue = reqEstimatedEffort ? parseFloat(reqEstimatedEffort) : undefined;
  const hasInvalidEstimatedEffort = estimatedEffortValue !== undefined && (!Number.isFinite(estimatedEffortValue) || estimatedEffortValue < 0);
  const canCreateRequirement = Boolean(reqId.trim() && reqTitle.trim() && isRequirementIdValid && !hasInvalidEstimatedEffort && !isSubmitting);
  const canUpdateRequirement = Boolean(reqTitle.trim() && !hasInvalidEstimatedEffort && !isSubmitting);

  const getRequirementSubmitDisabledReason = (mode: 'create' | 'edit'): string => {
    if (isSubmitting) return '';
    if (mode === 'create' && !reqId.trim()) return t('fieldRequired', { field: t('reqId') });
    if (!reqTitle.trim()) return t('fieldRequired', { field: t('title') });
    if (mode === 'create' && !isRequirementIdValid) return t('requirementIdInvalid');
    if (hasInvalidEstimatedEffort) return t('estimatedEffortInvalid');
    return '';
  };

  const renderRequirementTitleField = (mode: 'create' | 'edit') => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${mode}-reqTitle`} className="text-base font-semibold">
          {t('title')} <span className="text-red-500">*</span>
        </Label>
        {reqTitle.trim().length > 0 && (
          <span className="text-xs font-medium text-green-600">✓</span>
        )}
      </div>
      <Input
        id={`${mode}-reqTitle`}
        ref={titleInputRef}
        value={reqTitle}
        onChange={(e) => setReqTitle(e.target.value)}
        className="h-12 text-lg font-medium transition-all focus:ring-2 focus:ring-blue-500"
        placeholder={t('enterRequirementTitle')}
      />
      <p className="text-xs text-gray-500">{t('titleHelper')}</p>
    </div>
  );

  const renderRequirementDescriptionField = (mode: 'create' | 'edit') => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${mode}-reqDescription`} className="text-base font-semibold">
          {t('description')}
        </Label>
        <span className="text-xs text-gray-500">{getPlainTextLength(reqDescription)} {t('chars')}</span>
      </div>
      <ContentEditor
        value={reqDescription}
        onChange={setReqDescription}
        placeholder={t('enterRequirementDescription')}
        format="html"
        dir={isRTL ? 'rtl' : 'ltr'}
        minHeight="220px"
      />
      <p className="text-xs text-gray-500">{t('descriptionHelper')}</p>
    </div>
  );

  const renderRequirementMetadataFields = (mode: 'create' | 'edit') => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqId`} className="text-sm font-medium">
          {t('reqId')} {mode === 'create' && <span className="text-red-500">*</span>}
        </Label>
        <Input
          id={`${mode}-reqId`}
          value={reqId}
          onChange={(e) => setReqId(e.target.value)}
          disabled={mode === 'edit'}
          className={mode === 'edit' ? 'border-gray-300 bg-gray-100 text-sm dark:border-gray-600 dark:bg-gray-700' : 'text-sm transition-all focus:ring-2 focus:ring-blue-500'}
          placeholder="REQ-001"
        />
        {mode === 'edit' ? (
          <p className="text-xs text-gray-500">{t('reqIdImmutable')}</p>
        ) : reqId && !isRequirementIdValid ? (
          <p className="text-xs text-red-500">{t('reqIdFormatHelper')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqStatus`} className="text-sm font-medium">
          {t('status')}
        </Label>
        <Select value={reqStatus} onValueChange={setReqStatus}>
          <SelectTrigger className="text-sm transition-all focus:ring-2 focus:ring-blue-500">
            <SelectValue placeholder={t('selectStatus')} />
          </SelectTrigger>
          <SelectContent>
            {requirementStatusOptions.map((status) => (
              <SelectItem key={status} value={status}>{t(status as any)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqPriority`} className="text-sm font-medium">
          {t('priority')}
        </Label>
        <Select value={reqPriority} onValueChange={setReqPriority}>
          <SelectTrigger className="text-sm transition-all focus:ring-2 focus:ring-blue-500">
            <SelectValue placeholder={t('selectPriority')} />
          </SelectTrigger>
          <SelectContent>
            {requirementPriorityOptions.map((priority) => (
              <SelectItem key={priority} value={priority}>{t(priority as any)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqEstimatedEffort`} className="text-sm font-medium">
          {t('estEffort')}
        </Label>
        <Input
          id={`${mode}-reqEstimatedEffort`}
          type="number"
          step="0.5"
          min="0"
          value={reqEstimatedEffort}
          onChange={(e) => setReqEstimatedEffort(e.target.value)}
          className="text-sm transition-all focus:ring-2 focus:ring-blue-500"
          placeholder="8.0"
        />
        <p className={hasInvalidEstimatedEffort ? 'text-xs text-red-500' : 'text-xs text-gray-500'}>
          {hasInvalidEstimatedEffort ? t('estimatedEffortInvalid') : t('estimatedEffortHelper')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-reqTags`} className="text-sm font-medium">
          {t('tags')}
        </Label>
        <Input
          id={`${mode}-reqTags`}
          value={reqTags}
          onChange={(e) => setReqTags(e.target.value)}
          className="text-sm transition-all focus:ring-2 focus:ring-blue-500"
          placeholder="security, authentication"
        />
        <p className="text-xs text-gray-500">{t('tagsHelper')}</p>
      </div>
    </div>
  );

  const renderRequirementToolPanel = (mode: 'create' | 'edit', isCreateMode: boolean) => (
    <aside className="space-y-4">
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('requirementDetails')}</h3>
        {renderRequirementMetadataFields(mode)}
      </div>
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('tools')}</h3>
        <div className="space-y-3">
          {renderRequirementModeControls(mode)}
        </div>
      </div>
      {showExternalImport && renderExternalDocumentImport(isCreateMode ? 'external-document-url' : 'edit-external-document-url')}
      {showAdvancedRequirementTools && renderVersionHistory()}
    </aside>
  );

  const renderRequirementDialogContent = (mode: 'create' | 'edit') => {
    const isCreateMode = mode === 'create';
    const canSubmit = isCreateMode ? canCreateRequirement : canUpdateRequirement;
    const submitLabel = isCreateMode ? t('createRequirement') : t('updateRequirement');
    const submittingLabel = isCreateMode ? t('creating') : t('updating');

    return (
      <DialogContent isRTL={isRTL} className="max-h-[90vh] w-[96vw] max-w-[96vw] overflow-y-auto overflow-x-hidden sm:max-w-[95vw] lg:max-w-[1080px]">
        <DialogHeader className="border-b border-gray-200 pb-4 text-start dark:border-gray-700">
          <div className="min-w-0">
            <DialogTitle className="text-2xl font-semibold">
              {isCreateMode ? t('createNewRequirement') : t('editRequirement')}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              {isCreateMode ? t('createRequirementDesc') : t('updateRequirementInfo')}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 space-y-5">
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              {renderRequirementTitleField(mode)}
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              {renderRequirementDescriptionField(mode)}
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              {renderAcceptanceCriteriaEditor(mode)}
            </div>
          </section>
          {renderRequirementToolPanel(mode, isCreateMode)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleDialogClose(mode)}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            onClick={isCreateMode ? handleCreateRequirement : handleUpdateRequirement}
            disabled={!canSubmit}
            title={getRequirementSubmitDisabledReason(mode)}
          >
            {isSubmitting ? (
              <>
                <div className={`h-4 w-4 animate-spin rounded-full border-b-2 border-current ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                {submittingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('requirements')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('requirementsDescription')}</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={(open) => !open && handleDialogClose('create')}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenCreateDialog}>
              <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('addRequirement')}
            </Button>
          </DialogTrigger>
          {renderRequirementDialogContent('create')}
        </Dialog>
      </div>

      {/* Enhanced Search and Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-4">
        <div className="flex gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder={t('searchRequirements')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t('status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatus')}</SelectItem>
                <SelectItem value="draft">{t('draft')}</SelectItem>
                <SelectItem value="reviewed">{t('reviewed')}</SelectItem>
                <SelectItem value="approved">{t('approved')}</SelectItem>
                <SelectItem value="implemented">{t('implemented')}</SelectItem>
                <SelectItem value="verified">{t('verified')}</SelectItem>
                <SelectItem value="deprecated">{t('deprecated')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-40">
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
            <Button variant="outline" size="sm" onClick={handleExportRequirements}>
              <Download className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
              {t('export')}
            </Button>
          </div>
        </div>
      </div>

      {/* Requirements List */}
      <div className="space-y-4">
        {paginatedRequirements.length > 0 ? (
          paginatedRequirements.map((requirement) => (
            <Card key={requirement.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-gray-500 dark:text-gray-400">{requirement.requirement_id}</span>
                      <Badge className={getStatusBadge(requirement.status)}>
                        <div className="flex items-center gap-1">
                          {getStatusIcon(requirement.status)}
                          {requirement.status}
                        </div>
                      </Badge>
                      <Badge className={getPriorityBadge(requirement.priority)}>
                        {requirement.priority}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg mb-1">{requirement.title}</CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                      {toDisplayText(requirement.description) || t('noDescriptionProvided')}
                    </p>
                    {requirement.tags && requirement.tags.trim() && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {requirement.tags.split(',').map((tag, index) => {
                          const trimmedTag = tag.trim();
                          return trimmedTag ? (
                            <span key={index} className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded">
                              {trimmedTag}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                    {requirement.estimated_effort && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Clock className="h-3 w-3" />
                        {t('estimatedEffort', { effort: requirement.estimated_effort })}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(requirement.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleViewRequirement(requirement)}
                    >
                      <Eye className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('view')}
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleEditRequirement(requirement)}
                    >
                      <Edit className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                      {t('edit')}
                    </Button>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => openDeleteDialog(requirement)}
                  >
                    <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} />
                    {t('delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm">
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <FileText className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {searchQuery ? t('noRequirementsFound') : t('noRequirements')}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? t('tryAdjustingSearch')
                    : t('getStartedCreating')
                  }
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit Requirement Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => !open && handleDialogClose('edit')}>
        {renderRequirementDialogContent('edit')}
      </Dialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent isRTL={isRTL}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedChangesTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unsavedChangesModalMessage')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleUnsavedCancel}>
              {t('keepEditingModal')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleUnsavedConfirm(isCreateDialogOpen ? 'create' : 'edit')}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('discardChangesModal')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent isRTL={isRTL} className="sm:max-w-[95vw] md:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className={`h-5 w-5 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('deleteRequirementConfirm')}
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('aboutToDeleteRequirement')}
            </AlertDialogDescription>
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {t('aboutToDeleteRequirement')}
                </p>
                <p className="font-bold text-lg text-red-600 dark:text-red-400 mb-3">
                  "{requirementToDelete?.title}"
                </p>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-3">
                  <p className="font-semibold text-red-800 dark:text-red-200 mb-2">
                    {t('actionWillDelete')}
                  </p>
                  <ul className={`text-xs text-red-700 dark:text-red-300 space-y-1 ${isRTL ? 'mr-4' : 'ml-4'} list-disc`}>
                    <li>{t('deleteRequirementItem1')}</li>
                    <li>{t('deleteRequirementItem2')}</li>
                    <li>{t('deleteRequirementItem3')}</li>
                    <li>{t('deleteRequirementItem4')}</li>
                  </ul>
                </div>
                <p className="text-red-600 dark:text-red-400 font-semibold mb-2">
                  {t('cannotUndo')}
                </p>
                <div className="mt-4">
                  <Label htmlFor="confirm-name" className="text-sm font-medium">
                    {t('toConfirmTypeTitle')} <span className="font-bold">{requirementToDelete?.title}</span>
                  </Label>
                  <Input
                    id="confirm-name"
                    value={deleteConfirmationName}
                    onChange={(e) => setDeleteConfirmationName(e.target.value)}
                    placeholder={t('typeRequirementTitle')}
                    className="mt-2"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteDialogOpen(false);
              setRequirementToDelete(null);
              setDeleteConfirmationName('');
            }}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRequirement}
              disabled={deleteConfirmationName.trim().toLowerCase() !== requirementToDelete?.title?.trim().toLowerCase()}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {t('deleteRequirement')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pagination */}
      {totalPages > 1 && filteredRequirements.length > 0 && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mt-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('showingRequirements', { start: startIndex + 1, end: Math.min(startIndex + itemsPerPage, filteredRequirements.length), total: filteredRequirements.length })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
            >
              {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {t('previous')}
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t('pageOf', { current: safePage, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage === totalPages}
            >
              {t('next')}
              {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
