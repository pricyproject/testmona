import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Clock,
  Download,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  HelpCircle,
  Layers,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Table as TableIcon,
  Trash2,
  Upload,
  Rocket,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useAuthStore } from '@/stores/authStore';
import { docsAPI, type DocListParams } from '@/lib/api';
import { parsePositiveIntegerParam } from '@/utils/validation';
import { formatRelativeTime, formatServerDateTime } from '@/utils/datetime';
import { TestCaseSearchBar, type SearchSuggestionGroup } from '@/components/TestCases/TestCaseSearchBar';
import type { DocFacets, DocFolder, DocListItem, DocSpace, DocStatsOverview, DocStatus } from '@/types';

const PAGE_SIZE = 30;
type ViewMode = 'grid' | 'table' | 'list';
const VIEW_MODE_KEY = 'dochub.viewMode';
const SIDEBAR_KEY = 'dochub.sidebarCollapsed';
const HIGHLIGHTS_KEY = 'dochub.hiddenHighlights';

const readStoredViewMode = (): ViewMode => {
  if (typeof window === 'undefined') return 'grid';
  const v = window.localStorage.getItem(VIEW_MODE_KEY);
  return v === 'table' || v === 'list' ? v : 'grid';
};

const readStoredHiddenHighlights = () => {
  if (typeof window === 'undefined') return { pinned: false, recent: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIGHLIGHTS_KEY) || '{}');
    return { pinned: parsed.pinned === true, recent: parsed.recent === true };
  } catch {
    return { pinned: false, recent: false };
  }
};

const statusTone: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  in_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  published: 'bg-primary/10 text-primary',
  archived: 'bg-secondary text-secondary-foreground',
};

const STATUS_FILTERS: Array<DocStatus | 'all'> = ['all', 'draft', 'in_review', 'published', 'archived'];

// Curated presets for space identity. Free-form values from the API still render.
const SPACE_ICONS = ['📘', '📐', '🛠️', '🚀', '🔒', '🧪', '📋', '💡', '🌐', '📦'];
const SPACE_COLORS = ['#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#64748b'];

interface ParsedDocSearchQuery {
  terms: string[];
  status?: DocStatus;
  tag?: string;
  classification?: string;
}

const DOC_SEARCH_KEY_ALIASES: Record<string, keyof Omit<ParsedDocSearchQuery, 'terms'>> = {
  status: 'status',
  s: 'status',
  state: 'status',
  tag: 'tag',
  tags: 'tag',
  t: 'tag',
  classification: 'classification',
  class: 'classification',
  c: 'classification',
};

const stripSearchQuotes = (value: string) => {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const tokenizeDocSearch = (input: string): string[] =>
  input.match(/[^\s:]+:(?:"[^"]*"|'[^']*'|\S*)|"[^"]*"|'[^']*'|\S+/g) ?? [];

const parseDocSearchQuery = (query: string): ParsedDocSearchQuery => {
  const parsed: ParsedDocSearchQuery = { terms: [] };
  for (const rawToken of tokenizeDocSearch(query)) {
    let token = rawToken;
    const negated = token.startsWith('-') && token.length > 1;
    if (negated) token = token.slice(1);

    const match = token.match(/^([a-zA-Z]+):(.*)$/);
    if (match && !negated) {
      const key = DOC_SEARCH_KEY_ALIASES[match[1].toLowerCase()];
      const value = stripSearchQuotes(match[2]).trim();
      if (key && value) {
        if (key === 'status') {
          const status = value.toLowerCase() as DocStatus;
          if (STATUS_FILTERS.includes(status)) parsed.status = status;
        } else {
          parsed[key] = value;
        }
        continue;
      }
    }

    const term = stripSearchQuotes(rawToken).trim();
    if (term) parsed.terms.push(term);
  }
  return parsed;
};

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pe-1 ps-2 text-foreground">
      <span dir="auto" className="max-w-[160px] truncate">{label}</span>
      <button type="button" onClick={onClear} className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Expand #abc to #aabbcc so an alpha suffix can be appended safely. */
const expandHex = (hex: string) =>
  hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;

function SpaceAvatar({
  icon,
  color,
  isGlobal,
  className = 'h-7 w-7 text-sm',
}: {
  icon?: string | null;
  color?: string | null;
  isGlobal: boolean;
  className?: string;
}) {
  const hex = color ? expandHex(color) : null;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-lg ${hex ? '' : 'bg-slate-100 text-muted-foreground dark:bg-slate-800'} ${className}`}
      style={hex ? { backgroundColor: `${hex}24`, color: hex } : undefined}
    >
      {icon ? (
        <span className="leading-none">{icon}</span>
      ) : isGlobal ? (
        <Globe className="h-[55%] w-[55%]" />
      ) : (
        <FileText className="h-[55%] w-[55%]" />
      )}
    </span>
  );
}

function DocCardSkeleton() {
  return (
    <div className="h-[140px] animate-pulse rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mb-2 h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
      <div className="mb-2 h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800" />
      <div className="mt-4 h-4 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
    </div>
  );
}

export function DocHub() {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId: projectIdParam } = useParams<{ projectId?: string }>();
  const projectId = parsePositiveIntegerParam(projectIdParam);
  // Project-aware write gating: a globally read-only viewer elevated to a
  // write role in this project should still see create/edit affordances here.
  const { canWrite } = useProjectPermissions(projectId);
  const basePath = projectId ? `/projects/${projectId}/docs` : '/docs';

  const [spaces, setSpaces] = useState<DocSpace[]>([]);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [pinnedDocs, setPinnedDocs] = useState<DocListItem[]>([]);
  const [recentDocs, setRecentDocs] = useState<DocListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(() => searchParams.get('q') || '');
  const [sort, setSort] = useState<'latest_edited' | 'latest_visited' | 'created' | 'title'>('latest_edited');
  const [searchScope, setSearchScope] = useState<'space' | 'all'>(() => (searchParams.get('scope') === 'all' ? 'all' : 'space'));
  const [facets, setFacets] = useState<DocFacets>({ tags: [], classifications: [] });

  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user && (user.is_superuser || user.role === 'admin');

  // View mode (grid/table/list) and sidebar collapse, both persisted.
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_KEY) === 'true',
  );
  const [hiddenHighlights, setHiddenHighlights] = useState(readStoredHiddenHighlights);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  useEffect(() => { window.localStorage.setItem(VIEW_MODE_KEY, viewMode); }, [viewMode]);
  useEffect(() => { window.localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { window.localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(hiddenHighlights)); }, [hiddenHighlights]);

  // Admin-only read-statistics dashboard for the current scope.
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [overview, setOverview] = useState<DocStatsOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState(false);

  const scopeAll = searchScope === 'all';
  const parsedSearchQuery = useMemo(() => parseDocSearchQuery(debouncedSearchQuery), [debouncedSearchQuery]);
  const hasActiveFilters = searchQuery.trim() !== '';
  const hasMore = docs.length < total;
  const highlightParams = useMemo<DocListParams>(() => (
    projectId
      ? { projectId, includeGlobal: true }
      : { includeGlobal: false }
  ), [projectId]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
  };

  const emptySpaceForm = { name: '', description: '', classification: '', icon: '', color: '' };
  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<DocSpace | null>(null);
  const [spaceForm, setSpaceForm] = useState(emptySpaceForm);
  const [savingSpace, setSavingSpace] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState<DocSpace | null>(null);
  const [deleteSpaceBusy, setDeleteSpaceBusy] = useState(false);
  const [reorderingSpaces, setReorderingSpaces] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const activeSpace = useMemo(() => spaces.find((s) => s.id === activeSpaceId) || null, [spaces, activeSpaceId]);

  const selectSpace = (spaceId: number) => {
    setActiveSpaceId(spaceId);
    setActiveFolderId(null);
  };

  const loadSpaces = useCallback(async () => {
    try {
      setLoadingSpaces(true);
      const data = await docsAPI.listSpaces({ projectId, includeGlobal: true });
      setSpaces(data);
      setActiveSpaceId((current) => (
        current != null && data.some((space) => space.id === current)
          ? current
          : (data[0]?.id ?? null)
      ));
    } catch {
      toast({ title: t('error'), description: t('docSpacesLoadFailed'), variant: 'destructive' });
    } finally {
      setLoadingSpaces(false);
    }
  }, [projectId, t, toast]);

  useEffect(() => { loadSpaces(); }, [loadSpaces]);

  useEffect(() => { setActiveFolderId(null); }, [activeSpaceId]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 250);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (searchQuery.trim()) next.set('q', searchQuery.trim());
    if (searchScope === 'all') next.set('scope', 'all');
    setSearchParams(next, { replace: true });
  }, [searchQuery, searchScope, setSearchParams]);

  const loadFolders = useCallback(async () => {
    if (activeSpaceId == null) {
      setFolders([]);
      setActiveFolderId(null);
      return;
    }
    try {
      const data = await docsAPI.listFolders(activeSpaceId);
      setFolders(data);
      setActiveFolderId((current) => (
        current != null && data.some((folder) => folder.id === current) ? current : null
      ));
    } catch {
      setFolders([]);
      setActiveFolderId(null);
    }
  }, [activeSpaceId]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  // Query params for the current scope + filters at a given page offset.
  const queryParams = useCallback((skip: number): DocListParams => {
    const base: DocListParams = {
      q: parsedSearchQuery.terms.join(' ').trim() || undefined,
      status: parsedSearchQuery.status,
      tag: parsedSearchQuery.tag,
      classification: parsedSearchQuery.classification,
      sort,
      skip,
      limit: PAGE_SIZE,
    };
    return scopeAll
      ? { ...base, projectId: projectId ?? undefined, includeGlobal: true }
      : { ...base, spaceId: activeSpaceId ?? undefined, folderId: activeFolderId ?? undefined };
  }, [activeFolderId, activeSpaceId, parsedSearchQuery.classification, parsedSearchQuery.status, parsedSearchQuery.tag, parsedSearchQuery.terms, projectId, scopeAll, sort]);

  // First page (replaces the list) whenever scope/filters change.
  const reloadDocs = useCallback(async () => {
    if (!scopeAll && activeSpaceId == null) { setDocs([]); setTotal(0); return; }
    try {
      setLoadingDocs(true);
      const page = await docsAPI.listPaged(queryParams(0));
      setDocs(page.items);
      setTotal(page.total);
    } catch {
      toast({ title: t('error'), description: t('docsLoadFailed'), variant: 'destructive' });
    } finally {
      setLoadingDocs(false);
    }
  }, [scopeAll, activeSpaceId, queryParams, t, toast]);

  useEffect(() => { reloadDocs(); }, [reloadDocs]);

  const loadDocHighlights = useCallback(async () => {
    try {
      const [pinned, recent] = await Promise.all([
        docsAPI.list({ ...highlightParams, pinnedOnly: true, sort: 'latest_edited', limit: 8 }),
        docsAPI.list({ ...highlightParams, visitedOnly: true, sort: 'latest_visited', limit: 10 }),
      ]);
      setPinnedDocs(pinned);
      setRecentDocs(recent.slice(0, 10));
    } catch {
      setPinnedDocs([]);
      setRecentDocs([]);
    }
  }, [highlightParams]);

  useEffect(() => { loadDocHighlights(); }, [loadDocHighlights]);

  // Append the next page (infinite scroll / "Load more").
  const loadMore = useCallback(async () => {
    if (loadingMore || loadingDocs) return;
    try {
      setLoadingMore(true);
      const page = await docsAPI.listPaged(queryParams(docs.length));
      setDocs((prev) => {
        const seen = new Set(prev.map((d) => d.id));
        return [...prev, ...page.items.filter((d) => !seen.has(d.id))];
      });
      setTotal(page.total);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadingDocs, queryParams, docs.length]);

  // Stable ref so the IntersectionObserver always calls the latest loadMore.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMoreRef.current(); },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore]);

  // Server-side facets for search suggestions (no full-doc download).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!scopeAll && activeSpaceId == null) { setFacets({ tags: [], classifications: [] }); return; }
      try {
        const data = await docsAPI.getFacets(
          scopeAll ? { projectId: projectId ?? undefined, includeGlobal: true } : { spaceId: activeSpaceId ?? undefined },
        );
        if (!cancelled) setFacets(data);
      } catch {
        if (!cancelled) setFacets({ tags: [], classifications: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [activeSpaceId, scopeAll, projectId]);

  // Admin read-statistics overview for the current scope. Mirrors the facets scope logic.
  useEffect(() => {
    if (!isAdmin || !insightsOpen) { setOverview(null); setOverviewError(false); return; }
    if (!scopeAll && activeSpaceId == null) { setOverview(null); setOverviewError(false); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoadingOverview(true);
        setOverviewError(false);
        const data = await docsAPI.getStatsOverview(
          scopeAll ? { projectId: projectId ?? undefined, includeGlobal: true } : { spaceId: activeSpaceId ?? undefined },
        );
        if (!cancelled) setOverview(data);
      } catch {
        if (!cancelled) {
          setOverview(null);
          setOverviewError(true);
        }
      } finally {
        if (!cancelled) setLoadingOverview(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, insightsOpen, scopeAll, activeSpaceId, projectId]);

  // UX gating only — the backend enforces permissions. Global spaces are
  // writable only by admins; project spaces follow the project write role.
  const canManageSpace = (space: DocSpace) => (space.project_id == null ? isAdmin : canWrite);

  const openCreateSpace = () => {
    setEditingSpace(null);
    setSpaceForm(emptySpaceForm);
    setSpaceDialogOpen(true);
  };

  const openEditSpace = (space: DocSpace) => {
    setEditingSpace(space);
    setSpaceForm({
      name: space.name,
      description: space.description || '',
      classification: space.classification || '',
      icon: space.icon || '',
      color: space.color || '',
    });
    setSpaceDialogOpen(true);
  };

  const handleSaveSpace = async () => {
    if (!spaceForm.name.trim()) return;
    const payload = {
      name: spaceForm.name.trim(),
      description: spaceForm.description.trim() || null,
      classification: spaceForm.classification.trim() || null,
      icon: spaceForm.icon || null,
      color: spaceForm.color || null,
    };
    try {
      setSavingSpace(true);
      if (editingSpace) {
        await docsAPI.updateSpace(editingSpace.id, payload);
        toast({ title: t('success'), description: t('docSpaceUpdated') });
      } else {
        const space = await docsAPI.createSpace({ ...payload, project_id: projectId ?? null });
        toast({ title: t('success'), description: t('docSpaceCreated') });
        setActiveSpaceId(space.id);
      }
      setSpaceDialogOpen(false);
      await loadSpaces();
    } catch (e: any) {
      toast({
        title: t('error'),
        description: e?.response?.data?.detail || t(editingSpace ? 'docSpaceUpdateFailed' : 'docSpaceCreateFailed'),
        variant: 'destructive',
      });
    } finally {
      setSavingSpace(false);
    }
  };

  const handleSpaceKeyDown = (e: React.KeyboardEvent) => {
    // Enter submits from single-line inputs; the description textarea keeps it.
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      handleSaveSpace();
    }
  };

  const handleMoveSpace = async (space: DocSpace, dir: -1 | 1) => {
    const index = spaces.findIndex((s) => s.id === space.id);
    const target = index + dir;
    if (reorderingSpaces || index < 0 || target < 0 || target >= spaces.length) return;
    const next = [...spaces];
    [next[index], next[target]] = [next[target], next[index]];
    setSpaces(next);
    try {
      setReorderingSpaces(true);
      const updated = await docsAPI.reorderSpaces(next.map((s) => s.id));
      setSpaces(updated);
    } catch {
      await loadSpaces();
      toast({ title: t('error'), description: t('docSpaceReorderFailed'), variant: 'destructive' });
    } finally {
      setReorderingSpaces(false);
    }
  };

  const handleDeleteSpace = async () => {
    if (!deletingSpace) return;
    try {
      setDeleteSpaceBusy(true);
      await docsAPI.deleteSpace(deletingSpace.id);
      toast({ title: t('success'), description: t('docSpaceDeleted') });
      setDeletingSpace(null);
      await loadSpaces();
      await loadDocHighlights();
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docSpaceDeleteFailed'), variant: 'destructive' });
    } finally {
      setDeleteSpaceBusy(false);
    }
  };

  const handleCreateDoc = async () => {
    if (!newDocTitle.trim() || activeSpaceId == null) return;
    try {
      setCreatingDoc(true);
      const doc = await docsAPI.create({ title: newDocTitle.trim(), space_id: activeSpaceId, folder_id: activeFolderId, content_markdown: '' });
      setDocDialogOpen(false);
      setNewDocTitle('');
      navigate(`${basePath}/${doc.project_seq ?? doc.id}/edit`);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docCreateFailed'), variant: 'destructive' });
    } finally {
      setCreatingDoc(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || activeSpaceId == null) return;
    try {
      setCreatingFolder(true);
      const folder = await docsAPI.createFolder({
        space_id: activeSpaceId,
        name: newFolderName.trim(),
      });
      setFolderDialogOpen(false);
      setNewFolderName('');
      await loadSpaces();
      toast({ title: t('success'), description: t('docFolderCreated') });
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docFolderCreateFailed'), variant: 'destructive' });
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateFolder();
    }
  };

  const handleImport = async (file: File) => {
    if (activeSpaceId == null) {
      toast({ title: t('error'), description: t('docImportPickSpace'), variant: 'destructive' });
      return;
    }
    try {
      setImporting(true);
      const created = await docsAPI.importFile(activeSpaceId, file, activeFolderId);
      toast({ title: t('success'), description: t('docImportedCount', { n: created.length }) });
      await reloadDocs();
      await loadSpaces();
      await loadFolders();
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docImportFailed'), variant: 'destructive' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportSpace = async () => {
    if (!activeSpace) return;
    try {
      await docsAPI.exportSpace(activeSpace.id, `${activeSpace.slug}.zip`);
    } catch {
      toast({ title: t('error'), description: t('docExportFailed'), variant: 'destructive' });
    }
  };

  const applyPinState = (docId: number, pinned: boolean) => {
    const update = (item: DocListItem) => (item.id === docId ? { ...item, is_pinned: pinned } : item);
    setDocs((prev) => prev.map(update));
    setRecentDocs((prev) => prev.map(update));
    setPinnedDocs((prev) => pinned ? prev.map(update) : prev.filter((item) => item.id !== docId));
  };

  const handleTogglePin = async (doc: DocListItem, event?: MouseEvent) => {
    event?.stopPropagation();
    const nextPinned = !doc.is_pinned;
    applyPinState(doc.id, nextPinned);
    try {
      const updated = await docsAPI.setPinned(doc.id, nextPinned);
      applyPinState(doc.id, updated.is_pinned);
      await loadDocHighlights();
    } catch {
      applyPinState(doc.id, doc.is_pinned);
      toast({ title: t('error'), description: t('docPinUpdateFailed'), variant: 'destructive' });
    }
  };

  const setHighlightHidden = (key: 'pinned' | 'recent', hidden: boolean) => {
    setHiddenHighlights((current) => ({ ...current, [key]: hidden }));
  };

  const renderDocPinButton = (doc: DocListItem, className = '') => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-7 w-7 shrink-0 ${doc.is_pinned ? 'text-primary' : 'text-muted-foreground'} ${className}`}
      title={doc.is_pinned ? t('docUnpin') : t('docPin')}
      aria-label={doc.is_pinned ? t('docUnpin') : t('docPin')}
      aria-pressed={doc.is_pinned}
      onClick={(event) => handleTogglePin(doc, event)}
    >
      <Pin className={`h-4 w-4 ${doc.is_pinned ? 'fill-current' : ''}`} />
    </Button>
  );

  const renderQuickDocs = (items: DocListItem[]) => (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.map((doc) => (
        <div
          key={doc.id}
          className="min-w-[220px] max-w-[260px] rounded-lg border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-primary/40 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/70"
        >
          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`${basePath}/${doc.project_seq ?? doc.id}`)}
              className="min-w-0 flex-1 truncate text-start text-sm font-medium hover:text-primary"
              dir="auto"
              title={doc.title}
            >
              {doc.title}
            </button>
            {renderDocPinButton(doc, 'h-6 w-6')}
          </div>
          <button
            type="button"
            onClick={() => navigate(`${basePath}/${doc.project_seq ?? doc.id}`)}
            className="block w-full truncate text-start text-xs text-muted-foreground hover:text-primary"
          >
            {doc.my_last_visited_at ? t('docVisitedTime', { time: formatRelativeTime(doc.my_last_visited_at) }) : t(`docStatus_${doc.status}` as any)}
          </button>
        </div>
      ))}
    </div>
  );

  const searchSuggestionGroups = useMemo<SearchSuggestionGroup[]>(() => [
    {
      key: 'status',
      label: t('status'),
      values: STATUS_FILTERS.filter((status): status is DocStatus => status !== 'all').map((status) => ({
        value: status,
        label: t(`docStatus_${status}` as any),
      })),
    },
    {
      key: 'tag',
      label: t('tags'),
      values: facets.tags.slice(0, 20).map(({ value }) => ({ value, label: value })),
    },
    {
      key: 'classification',
      label: t('docClassification'),
      values: facets.classifications.slice(0, 20).map(({ value }) => ({ value, label: value })),
    },
  ], [facets.classifications, facets.tags, t]);

  const searchExamples = useMemo(() => {
    const examples = STATUS_FILTERS.filter((status): status is DocStatus => status !== 'all').slice(0, 1).map((status) => `status:${status}`);
    const tag = facets.tags[0]?.value;
    const classification = facets.classifications[0]?.value;
    if (tag) examples.push(`tag:${tag.includes(' ') ? `"${tag}"` : tag}`);
    if (classification) examples.push(`classification:${classification.includes(' ') ? `"${classification}"` : classification}`);
    return examples;
  }, [facets.classifications, facets.tags]);

  const renderInsightsPanel = () => {
    if (!isAdmin || !insightsOpen) return null;

    const statusEntries = STATUS_FILTERS.filter((status): status is DocStatus => status !== 'all').map((status) => ({
      status,
      count: overview?.by_status?.[status] ?? 0,
    }));
    const statusTotal = statusEntries.reduce((sum, item) => sum + item.count, 0);
    const mostViewed = overview?.most_viewed.slice(0, 3) ?? [];
    const scopeLabel = scopeAll
      ? t('docInsightsAllScope')
      : activeSpace
        ? t('docInsightsSpaceScope', { name: activeSpace.name })
        : t('docInsightsNoScope');

    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground" aria-label={t('docInsights')}>
        <div className="relative p-4 sm:p-5">
          <div className="pointer-events-none absolute -top-12 end-8 h-28 w-28 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="rounded-xl bg-primary p-2 text-primary-foreground">
                    <BarChart3 className="h-4 w-4" />
                  </span>
                  {t('docInsights')}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">{scopeLabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">{t('docInsightsLive')}</Badge>
                <button type="button" onClick={() => setInsightsOpen(false)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title={t('docHideInsights')} aria-label={t('docHideInsights')}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {loadingOverview ? (
              <div className="space-y-3" role="status" aria-busy="true" aria-label={t('loading')}>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-border bg-muted/50 p-3">
                      <div className="mb-2 h-3 w-12 animate-pulse rounded bg-muted" />
                      <div className="h-6 w-8 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
                <div className="h-20 animate-pulse rounded-xl border border-border bg-muted/50" />
              </div>
            ) : overviewError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {t('docInsightsLoadFailed')}
              </div>
            ) : overview ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">{t('docStatTotalDocs')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{overview.total_docs}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">{t('docStatTotalViews')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{overview.total_views}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <p className="text-[11px] text-muted-foreground">{t('uniqueVisitors')}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{overview.unique_visitors}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[0.85fr_1.15fr]">
                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('docInsightsStatusBreakdown')}</p>
                    <div className="space-y-2">
                      {statusEntries.map(({ status, count }) => {
                        const percent = statusTotal > 0 ? (count / statusTotal) * 100 : 0;
                        return (
                          <div key={status} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span>{t(`docStatus_${status}` as any)}</span>
                              <span className="tabular-nums text-muted-foreground">{count}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/50 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('docMostViewed')}</p>
                    {mostViewed.length > 0 ? (
                      <div className="space-y-1.5">
                        {mostViewed.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => navigate(`${basePath}/${doc.project_seq ?? doc.id}`)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-muted"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm" dir="auto">{doc.title}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                              <Eye className="h-3 w-3" />
                              {t('docVisitCount', { n: doc.view_count })}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">{t('docNoViewsYet')}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">{t('docInsightsNoScope')}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 py-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mb-6 flex items-center gap-3">
        <BookOpen className="h-7 w-7 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('docHub')}</h1>
          <p className="text-sm text-muted-foreground">{projectId ? t('docHubProjectSubtitle') : t('docHubGlobalSubtitle')}</p>
        </div>
      </div>

      <div className={`grid gap-6 ${sidebarCollapsed ? 'grid-cols-1' : 'lg:grid-cols-[260px_1fr]'}`}>
        {/* Spaces rail */}
        {!sidebarCollapsed && (
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('docSpaces')}</h2>
            <div className="flex items-center gap-0.5">
              {canWrite && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openCreateSpace} title={t('docNewSpace')}>
                  <FolderPlus className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarCollapsed(true)} title={t('docHideSidebar')}>
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {loadingSpaces ? (
            <ul className="space-y-1" role="status" aria-busy="true" aria-label={t('loading')}>
              {Array.from({ length: 5 }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg px-2 py-2"
                >
                  <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <div
                    className="h-3.5 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                    style={{ width: `${70 - i * 8}%` }}
                  />
                </li>
              ))}
            </ul>
          ) : spaces.length === 0 ? (
            <button
              type="button"
              onClick={openCreateSpace}
              className="w-full rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-muted-foreground hover:border-primary/40 dark:border-slate-700"
            >
              {t('docCreateFirstSpace')}
            </button>
          ) : (
            <ul className="space-y-1">
              {spaces.map((space, index) => {
                const active = space.id === activeSpaceId;
                const manageable = canManageSpace(space);
                const prev = spaces[index - 1];
                const next = spaces[index + 1];
                const canMoveUp = !!prev && manageable && canManageSpace(prev);
                const canMoveDown = !!next && manageable && canManageSpace(next);
                return (
                  <li key={space.id}>
                    <div
                       className={`group flex w-full items-center gap-1.5 rounded-lg py-1.5 pe-1 ps-2 transition-colors ${active ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-muted'}`}
                    >
                      <button
                        type="button"
                        onClick={() => selectSpace(space.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 text-start text-sm ${active ? 'font-medium text-primary' : ''}`}
                      >
                        <SpaceAvatar icon={space.icon} color={space.color} isGlobal={space.project_id == null} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" dir="auto" title={space.name}>{space.name}</span>
                          {space.classification && (
                            <span className="block truncate text-[11px] font-normal text-muted-foreground" dir="auto">
                              {space.classification}
                            </span>
                          )}
                        </span>
                      </button>
                      <Badge variant="secondary" className="shrink-0">{space.doc_count}</Badge>
                      {(manageable || canMoveUp || canMoveDown) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                              aria-label={t('docSpaceActions')}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align={isRTL ? 'start' : 'end'}>
                            {manageable && (
                              <DropdownMenuItem onClick={() => openEditSpace(space)}>
                                <Pencil className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('docEditSpace')}
                              </DropdownMenuItem>
                            )}
                            {canMoveUp && (
                              <DropdownMenuItem onClick={() => handleMoveSpace(space, -1)}>
                                <ArrowUp className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('docMoveUp')}
                              </DropdownMenuItem>
                            )}
                            {canMoveDown && (
                              <DropdownMenuItem onClick={() => handleMoveSpace(space, 1)}>
                                <ArrowDown className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                {t('docMoveDown')}
                              </DropdownMenuItem>
                            )}
                            {manageable && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeletingSpace(space)}>
                                  <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                                  {t('docDeleteSpace')}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {activeSpaceId != null && (
            <div className="pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('folders')}</h2>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFolderDialogOpen(true)} title={t('docNewFolder')}>
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
              <ul className="max-h-[320px] space-y-1 overflow-y-auto pe-1">
                <li>
                    <button type="button" onClick={() => setActiveFolderId(null)} className={`w-full rounded-lg px-3 py-2 text-start text-sm ${activeFolderId == null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'}`}>
                    {t('docAllFolders')}
                  </button>
                </li>
                {folders.map((folder) => (
                  <li key={folder.id}>
                    <button type="button" onClick={() => setActiveFolderId(folder.id)} className={`w-full rounded-lg px-3 py-2 text-start text-sm ${activeFolderId === folder.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'}`} dir="auto">
                      {folder.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
        )}

        {/* Docs panel */}
        <section className="min-w-0">
          {/* Active space header */}
          {!scopeAll && activeSpace && (
            <div className="mb-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
              <div className="flex flex-wrap items-start gap-3">
                <SpaceAvatar
                  icon={activeSpace.icon}
                  color={activeSpace.color}
                  isGlobal={activeSpace.project_id == null}
                  className="h-12 w-12 text-2xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold leading-tight" dir="auto">{activeSpace.name}</h2>
                    {activeSpace.project_id == null && (
                      <Badge variant="outline" className="gap-1">
                        <Globe className="h-3 w-3" />
                        {t('docSpaceGlobal')}
                      </Badge>
                    )}
                    {activeSpace.classification && <Badge variant="secondary" dir="auto">{activeSpace.classification}</Badge>}
                  </div>
                  {activeSpace.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" dir="auto">{activeSpace.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {t('docSpaceDocCount', { n: activeSpace.doc_count })}
                    </Badge>
                    <Badge variant="secondary" className="gap-1">
                      <Folder className="h-3.5 w-3.5" />
                      {t('docSpaceFolderCount', { n: activeSpace.folder_count })}
                    </Badge>
                    {activeSpace.published_count > 0 && (
                      <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
                        {activeSpace.published_count} {t('docStatus_published')}
                      </Badge>
                    )}
                    {activeSpace.draft_count > 0 && (
                      <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
                        {activeSpace.draft_count} {t('docStatus_draft')}
                      </Badge>
                    )}
                    {activeSpace.archived_count > 0 && (
                      <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
                        {activeSpace.archived_count} {t('docStatus_archived')}
                      </Badge>
                    )}
                    {activeSpace.last_doc_updated_at && (
                      <Badge variant="outline" className="gap-1" title={formatServerDateTime(activeSpace.last_doc_updated_at)}>
                        <Clock className="h-3.5 w-3.5" />
                        {t('docSpaceLastUpdated', { time: formatRelativeTime(activeSpace.last_doc_updated_at) })}
                      </Badge>
                    )}
                  </div>
                </div>
                {canManageSpace(activeSpace) && (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => openEditSpace(activeSpace)}>
                    <Pencil className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('docEditSpace')}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Search/filter toolbar */}
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 lg:flex-row lg:flex-wrap lg:items-center">
              {sidebarCollapsed && (
                <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setSidebarCollapsed(false)} title={t('docShowSidebar')}>
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              )}

              <div className="w-full min-w-0 lg:w-auto lg:min-w-[220px] lg:flex-1">
                <TestCaseSearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={t('docSearchSmartPlaceholder')}
                  groups={searchSuggestionGroups}
                  isRTL={isRTL}
                  resultCount={total}
                  resultLabel={t('docHub')}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" title={t('docSearchExamples')} aria-label={t('docSearchExamples')}>
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-64">
                  <DropdownMenuLabel>{t('docSearchExamples')}</DropdownMenuLabel>
                  {searchExamples.map((example) => (
                    <DropdownMenuItem key={example} onClick={() => setSearchQuery(example)}>
                      <span className="font-mono text-xs">{example}</span>
                    </DropdownMenuItem>
                  ))}
                  {searchExamples.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('docNoSearchExamples')}</div>}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="inline-flex h-10 shrink-0 rounded-lg border border-border p-0.5">
                <button type="button" onClick={() => setSearchScope('space')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${!scopeAll ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  <FileText className="h-3.5 w-3.5" /> {t('docScopeSpace')}
                </button>
                <button type="button" onClick={() => setSearchScope('all')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${scopeAll ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  <Layers className="h-3.5 w-3.5" /> {t('docScopeAll')}
                </button>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 shrink-0 gap-1.5">
                    <ChevronsUpDown className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {{ latest_edited: t('docSortLatestEdited'), latest_visited: t('docSortLatestVisited'), created: t('docSortCreated'), title: t('docSortTitle') }[sort]}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-48">
                  <DropdownMenuLabel>{t('docSortLabel')}</DropdownMenuLabel>
                  {([
                    ['latest_edited', t('docSortLatestEdited')],
                    ['latest_visited', t('docSortLatestVisited')],
                    ['created', t('docSortCreated')],
                    ['title', t('docSortTitle')],
                  ] as Array<[typeof sort, string]>).map(([value, label]) => (
                    <DropdownMenuItem key={value} onClick={() => setSort(value)} className="flex items-center justify-between gap-2">
                      {label}
                      {sort === value && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* View-mode toggle */}
              <div className="inline-flex h-10 shrink-0 rounded-lg border border-border bg-muted/50 p-1">
                {([
                  { mode: 'grid' as const, icon: LayoutGrid, label: t('docViewGrid') },
                  { mode: 'table' as const, icon: TableIcon, label: t('docViewTable') },
                  { mode: 'list' as const, icon: ListIcon, label: t('docViewList') },
                ]).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    title={label}
                    aria-pressed={viewMode === mode}
                    className={`rounded-md p-1.5 transition-colors ${viewMode === mode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>

              <span className="flex-1" />

              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.zip"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 shrink-0 gap-2 px-3">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    <span>{t('moreActions')}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-56">
                  {(projectId || isAdmin) && <DropdownMenuLabel>{t('docMoreReview')}</DropdownMenuLabel>}
                  {projectId && (
                    <DropdownMenuItem onClick={() => navigate(`${basePath}/release-notes`)} className="gap-2">
                      <Rocket className="h-4 w-4 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span>{t('releaseNotes')}</span>
                        <span className="text-xs text-muted-foreground">{t('docReleaseNotesActionHint')}</span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => setInsightsOpen(true)} className="gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span>{t('docInsights')}</span>
                        <span className="text-xs text-muted-foreground">{t('docInsightsActionHint')}</span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {(projectId || isAdmin) && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{t('docImportExport')}</DropdownMenuLabel>
                  <DropdownMenuItem disabled={importing || activeSpaceId == null} onSelect={() => fileInputRef.current?.click()}>
                    {importing ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                    {t('import')}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!activeSpace} onSelect={handleExportSpace}>
                    <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('export')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canWrite && (
                <Button className="h-10 shrink-0" disabled={activeSpaceId == null} onClick={() => setDocDialogOpen(true)}>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docNewDoc')}
                </Button>
              )}
            </div>

            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t('filters')}</span>
                <FilterChip label={`"${searchQuery.trim()}"`} onClear={() => setSearchQuery('')} />
                <button type="button" onClick={clearAllFilters} className="font-medium text-primary hover:underline">
                  {t('clearFilters')}
                </button>
              </div>
            )}
          </div>

          {!loadingDocs && (pinnedDocs.length > 0 || recentDocs.length > 0) && (
            <section
              className={`mb-4 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-sm ${quickAccessOpen ? '' : 'cursor-pointer transition-colors hover:bg-muted/30'}`}
              onClick={() => { if (!quickAccessOpen) setQuickAccessOpen(true); }}
              role={quickAccessOpen ? undefined : 'button'}
              tabIndex={quickAccessOpen ? undefined : 0}
              onKeyDown={(event) => {
                if (!quickAccessOpen && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  setQuickAccessOpen(true);
                }
              }}
              aria-expanded={quickAccessOpen}
            >
              <div className="flex items-center gap-2">
                <Pin className="h-4 w-4 text-primary" />
                <h3 className="min-w-0 flex-1 text-sm font-semibold">{t('docQuickAccess')}</h3>
                {(pinnedDocs.length > 0 && hiddenHighlights.pinned) && (
                  <Button type="button" variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setHighlightHidden('pinned', false); }}>
                    {t('docShowPinnedDocs')}
                  </Button>
                )}
                {(recentDocs.length > 0 && hiddenHighlights.recent) && (
                  <Button type="button" variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setHighlightHidden('recent', false); }}>
                    {t('docShowRecentDocs')}
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={(event) => { event.stopPropagation(); setQuickAccessOpen((open) => !open); }} title={quickAccessOpen ? t('docHideQuickAccess') : t('docShowQuickAccess')} aria-label={quickAccessOpen ? t('docHideQuickAccess') : t('docShowQuickAccess')}>
                  {quickAccessOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              {quickAccessOpen && ((pinnedDocs.length > 0 && !hiddenHighlights.pinned) || (recentDocs.length > 0 && !hiddenHighlights.recent)) && (
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  {pinnedDocs.length > 0 && !hiddenHighlights.pinned && (
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Pin className="h-3.5 w-3.5 text-primary" />
                        <span className="min-w-0 flex-1">{t('docPinnedDocs')}</span>
                        <button type="button" onClick={() => setHighlightHidden('pinned', true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('docHidePinnedDocs')} aria-label={t('docHidePinnedDocs')}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {renderQuickDocs(pinnedDocs)}
                    </div>
                  )}
                  {recentDocs.length > 0 && !hiddenHighlights.recent && (
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        <span className="min-w-0 flex-1">{t('docRecentlyViewed')}</span>
                        <button type="button" onClick={() => setHighlightHidden('recent', true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('docHideRecentDocs')} aria-label={t('docHideRecentDocs')}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {renderQuickDocs(recentDocs)}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Doc grid */}
          {loadingDocs ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-busy="true" aria-label={t('loading')}>
              {Array.from({ length: 6 }).map((_, i) => <li key={i}><DocCardSkeleton /></li>)}
            </ul>
          ) : !scopeAll && activeSpaceId == null ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
              <p className="text-sm text-muted-foreground">
                {t(spaces.length === 0 ? 'docNoSpacesYet' : 'docSelectSpace')}
              </p>
              {spaces.length === 0 && (projectId != null ? canWrite : isAdmin) && (
                <Button className="mt-4" size="sm" onClick={openCreateSpace}>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docNewSpace')}
                </Button>
              )}
            </div>
          ) : docs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('docNoneInSpace')}</p>
              {canWrite && (
                <Button className="mt-4" size="sm" disabled={activeSpaceId == null} onClick={() => setDocDialogOpen(true)}>
                  <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docNewDoc')}
                </Button>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">
                      <button type="button" onClick={() => setSort('title')} className="inline-flex items-center gap-1 hover:text-foreground">
                        {t('title')}
                        {sort === 'title' ? <ChevronUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-start font-medium">{t('status')}</th>
                    <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{t('tags')}</th>
                    <th className="px-3 py-2 text-center font-medium">{t('docVersion')}</th>
                    <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">
                      <button type="button" onClick={() => setSort('latest_edited')} className="inline-flex items-center gap-1 hover:text-foreground">
                        {t('docColUpdated')}
                        {sort === 'latest_edited' ? <ChevronDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {isAdmin && <th className="px-3 py-2 text-center font-medium">{t('views')}</th>}
                    <th className="px-3 py-2 text-center font-medium" title={t('docPinned')} aria-label={t('docPinned')}><Pin className="mx-auto h-3.5 w-3.5" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {docs.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => navigate(`${basePath}/${d.project_seq ?? d.id}`)}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                    >
                      <td className="px-3 py-2">
                        <span className="font-medium" dir="auto">{d.title}</span>
                        {scopeAll && d.space_id !== activeSpaceId && (
                          <span className="ms-2 text-xs text-muted-foreground">· {spaces.find((s) => s.id === d.space_id)?.name || t('docSpace')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><Badge className={`border-0 ${statusTone[d.status] || statusTone.draft}`}>{t(`docStatus_${d.status}` as any)}</Badge></td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {(() => {
                            const tags = d.tags?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
                            return <>
                              {tags.slice(0, 2).map((tag) => <Badge key={tag} variant="secondary" className="max-w-24 truncate">{tag}</Badge>)}
                              {tags.length > 2 && <Badge variant="outline">+{tags.length - 2}</Badge>}
                            </>;
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{d.current_version}</td>
                      <td className="hidden px-3 py-2 text-end text-xs text-muted-foreground sm:table-cell">{d.updated_at ? formatServerDateTime(d.updated_at) : '-'}</td>
                      {isAdmin && <td className="px-3 py-2 text-center text-muted-foreground"><span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{d.view_count ?? 0}</span></td>}
                      <td className="px-3 py-2 text-center" onClick={(event) => event.stopPropagation()}>{renderDocPinButton(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : viewMode === 'list' ? (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50">
                  <button
                    type="button"
                    onClick={() => navigate(`${basePath}/${d.project_seq ?? d.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-start"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium" dir="auto">{d.title}</span>
                    {scopeAll && d.space_id !== activeSpaceId && (
                      <Badge variant="outline" className="hidden shrink-0 gap-1 lg:inline-flex"><Layers className="h-3 w-3" />{spaces.find((s) => s.id === d.space_id)?.name || t('docSpace')}</Badge>
                    )}
                    {d.classification && <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">{d.classification}</Badge>}
                    <Badge className={`hidden shrink-0 border-0 sm:inline-flex ${statusTone[d.status] || statusTone.draft}`}>{t(`docStatus_${d.status}` as any)}</Badge>
                    {isAdmin && <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><Eye className="h-3 w-3" />{d.view_count ?? 0}</span>}
                    {d.updated_at && <span className="hidden shrink-0 text-xs text-muted-foreground md:inline" title={formatServerDateTime(d.updated_at)}>{formatRelativeTime(d.updated_at)}</span>}
                    <span className="shrink-0 text-xs text-muted-foreground">v{d.current_version}</span>
                  </button>
                  {renderDocPinButton(d)}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {docs.map((d) => (
                <li key={d.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`${basePath}/${d.project_seq ?? d.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`${basePath}/${d.project_seq ?? d.id}`);
                      }
                    }}
                    className="flex h-full w-full flex-col rounded-2xl border border-border bg-card p-4 text-start shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 font-semibold leading-snug" dir="auto">
                        {d.title}
                      </h3>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge className={`border-0 ${statusTone[d.status] || statusTone.draft}`}>{t(`docStatus_${d.status}` as any)}</Badge>
                        {renderDocPinButton(d, '-mt-1')}
                      </div>
                    </div>
                    {d.excerpt && (
                      <p className="line-clamp-3 flex-1 text-sm text-muted-foreground" dir="auto">
                        {d.excerpt}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {scopeAll && d.space_id !== activeSpaceId && (
                        <Badge variant="outline" className="gap-1">
                          <Layers className="h-3 w-3" />{spaces.find((s) => s.id === d.space_id)?.name || t('docSpace')}
                        </Badge>
                      )}
                      {d.classification && <Badge variant="outline">{d.classification}</Badge>}
                      {(() => {
                        const tags = d.tags?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
                        return <>
                          {tags.slice(0, 3).map((tag) => <Badge key={tag} variant="secondary" className="max-w-28 truncate">{tag}</Badge>)}
                          {tags.length > 3 && <Badge variant="outline">+{tags.length - 3}</Badge>}
                        </>;
                      })()}
                      <span className="flex-1" />
                      {isAdmin && (
                        <span className="inline-flex items-center gap-1" title={t('views')}>
                          <Eye className="h-3 w-3" />{d.view_count ?? 0}
                        </span>
                      )}
                      {d.updated_at && (
                        <span className="inline-flex items-center gap-1" title={formatServerDateTime(d.updated_at)}>
                          <Clock className="h-3 w-3" />{formatRelativeTime(d.updated_at)}
                        </span>
                      )}
                      <span>v{d.current_version}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Infinite-scroll sentinel + explicit "Load more" fallback */}
          {!loadingDocs && hasMore && (
            <div ref={sentinelRef} className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('docLoadMore', { n: total - docs.length })}
              </Button>
            </div>
          )}
        </section>
      </div>

      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className="max-w-4xl" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('docInsights')}</DialogTitle>
            <DialogDescription>{t('docInsightsDialogDesc')}</DialogDescription>
          </DialogHeader>
          {renderInsightsPanel()}
        </DialogContent>
      </Dialog>

      {/* Create / edit space dialog */}
      <Dialog open={spaceDialogOpen} onOpenChange={setSpaceDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} onKeyDown={handleSpaceKeyDown}>
          <DialogHeader>
            <DialogTitle>{editingSpace ? t('docEditSpace') : t('docNewSpace')}</DialogTitle>
            <DialogDescription>
              {editingSpace
                ? t('docEditSpaceDesc')
                : projectId ? t('docNewProjectSpaceDesc') : t('docNewGlobalSpaceDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('name')}</Label>
              <Input
                value={spaceForm.name}
                onChange={(e) => setSpaceForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('docSpaceNamePlaceholder')}
                dir="auto"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>{t('description')}</Label>
              <Textarea
                value={spaceForm.description}
                onChange={(e) => setSpaceForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t('docSpaceDescriptionPlaceholder')}
                rows={2}
                dir="auto"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('docClassification')}</Label>
              <Input
                value={spaceForm.classification}
                onChange={(e) => setSpaceForm((f) => ({ ...f, classification: e.target.value }))}
                placeholder={t('docClassificationPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('docSpaceIcon')}</Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSpaceForm((f) => ({ ...f, icon: '' }))}
                  aria-pressed={!spaceForm.icon}
                  title={t('docSpaceNone')}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition-colors ${!spaceForm.icon ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-muted-foreground hover:border-primary/40 dark:border-slate-700'}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {SPACE_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setSpaceForm((f) => ({ ...f, icon: f.icon === icon ? '' : icon }))}
                    aria-pressed={spaceForm.icon === icon}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base transition-colors ${spaceForm.icon === icon ? 'border-primary bg-primary/10' : 'border-slate-200 hover:border-primary/40 dark:border-slate-700'}`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('docSpaceColor')}</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSpaceForm((f) => ({ ...f, color: '' }))}
                  aria-pressed={!spaceForm.color}
                  title={t('docSpaceNone')}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${!spaceForm.color ? 'border-primary text-primary' : 'border-slate-200 text-muted-foreground hover:border-primary/40 dark:border-slate-700'}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {SPACE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSpaceForm((f) => ({ ...f, color: f.color === color ? '' : color }))}
                    aria-pressed={spaceForm.color === color}
                    title={color}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${spaceForm.color === color ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpaceDialogOpen(false)} disabled={savingSpace}>{t('cancel')}</Button>
            <Button onClick={handleSaveSpace} disabled={savingSpace || !spaceForm.name.trim()}>
              {savingSpace && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {editingSpace ? t('save') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete space confirmation */}
      <AlertDialog open={deletingSpace != null} onOpenChange={(open) => { if (!open) setDeletingSpace(null); }}>
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('docSpaceDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('docSpaceDeleteDesc', { name: deletingSpace?.name ?? '', n: deletingSpace?.doc_count ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSpaceBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteSpaceBusy}
              onClick={(e) => { e.preventDefault(); handleDeleteSpace(); }}
            >
              {deleteSpaceBusy && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('docDeleteSpace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New doc dialog */}
      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('docNewDoc')}</DialogTitle>
            <DialogDescription>{t('docNewDocDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>{t('title')}</Label>
            <Input
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              placeholder={t('docTitlePlaceholder')}
              dir="auto"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && newDocTitle.trim()) handleCreateDoc(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialogOpen(false)} disabled={creatingDoc}>{t('cancel')}</Button>
            <Button onClick={handleCreateDoc} disabled={creatingDoc || !newDocTitle.trim()}>
              {creatingDoc && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('docCreateAndWrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'} onKeyDown={handleFolderKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('docNewFolder')}</DialogTitle>
            <DialogDescription>{t('docFolderDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>{t('name')}</Label>
            <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} dir="auto" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)} disabled={creatingFolder}>{t('cancel')}</Button>
            <Button onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
              {creatingFolder && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
