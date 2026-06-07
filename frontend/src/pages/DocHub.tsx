import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Clock,
  Download,
  Eye,
  FileText,
  FolderPlus,
  Globe,
  Layers,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
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
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { docsAPI, type DocListParams } from '@/lib/api';
import { parsePositiveIntegerParam } from '@/utils/validation';
import { formatRelativeTime, formatServerDateTime } from '@/utils/datetime';
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
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  archived: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

const STATUS_FILTERS: Array<DocStatus | 'all'> = ['all', 'draft', 'published', 'archived'];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wrap query terms in <mark> for in-result highlighting. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.join('|')})`, 'ig');
  // split() with a capturing group yields matched delimiters at odd indices.
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-400/30">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pe-1 ps-2 text-foreground dark:bg-slate-800">
      <span dir="auto" className="max-w-[160px] truncate">{label}</span>
      <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700">
        <X className="h-3 w-3" />
      </button>
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

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [statusFilter, setStatusFilter] = useState<DocStatus | 'all'>('all');
  const [tagFilter, setTagFilter] = useState(searchParams.get('tag') || '');
  const [classificationFilter, setClassificationFilter] = useState('');
  const [sort, setSort] = useState<'latest_edited' | 'latest_visited' | 'created' | 'title'>('latest_edited');
  const [searchScope, setSearchScope] = useState<'space' | 'all'>('space');
  const [showFilters, setShowFilters] = useState(false);
  const [facets, setFacets] = useState<DocFacets>({ tags: [], classifications: [] });
  const searchRef = useRef<HTMLInputElement | null>(null);

  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user && (user.is_superuser || user.role === 'admin');

  // View mode (grid/table/list) and sidebar collapse, both persisted.
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_KEY) === 'true',
  );
  const [hiddenHighlights, setHiddenHighlights] = useState(readStoredHiddenHighlights);
  useEffect(() => { window.localStorage.setItem(VIEW_MODE_KEY, viewMode); }, [viewMode]);
  useEffect(() => { window.localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { window.localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(hiddenHighlights)); }, [hiddenHighlights]);

  // Admin-only read-statistics dashboard for the current scope.
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [overview, setOverview] = useState<DocStatsOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const scopeAll = searchScope === 'all';
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (tagFilter.trim() ? 1 : 0) + (classificationFilter.trim() ? 1 : 0);
  const hasAnyFilter = activeFilterCount > 0 || !!search.trim() || scopeAll;
  const hasMore = docs.length < total;
  const highlightParams = useMemo<DocListParams>(() => (
    projectId
      ? { projectId, includeGlobal: true }
      : { includeGlobal: false }
  ), [projectId]);

  const clearAllFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setTagFilter('');
    setClassificationFilter('');
    setSearchScope('space');
    setSearchParams({});
  };

  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceClass, setNewSpaceClass] = useState('');
  const [creatingSpace, setCreatingSpace] = useState(false);
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

  // Debounce the raw search box into the value actually queried.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Query params for the current scope + filters at a given page offset.
  const queryParams = useCallback((skip: number): DocListParams => {
    const base: DocListParams = {
      q: debouncedSearch.trim() || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      tag: tagFilter.trim() || undefined,
      classification: classificationFilter.trim() || undefined,
      sort,
      skip,
      limit: PAGE_SIZE,
    };
    return scopeAll
      ? { ...base, projectId: projectId ?? undefined, includeGlobal: true }
      : { ...base, spaceId: activeSpaceId ?? undefined, folderId: activeFolderId ?? undefined };
  }, [activeFolderId, activeSpaceId, classificationFilter, debouncedSearch, projectId, scopeAll, sort, statusFilter, tagFilter]);

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

  // Server-side facets for the current scope (no full-doc download).
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

  // Admin read-statistics overview for the current scope (only when the panel is
  // open). Mirrors the facets scope logic.
  useEffect(() => {
    if (!isAdmin || !insightsOpen) return;
    if (!scopeAll && activeSpaceId == null) { setOverview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoadingOverview(true);
        const data = await docsAPI.getStatsOverview(
          scopeAll ? { projectId: projectId ?? undefined, includeGlobal: true } : { spaceId: activeSpaceId ?? undefined },
        );
        if (!cancelled) setOverview(data);
      } catch {
        if (!cancelled) setOverview(null);
      } finally {
        if (!cancelled) setLoadingOverview(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, insightsOpen, scopeAll, activeSpaceId, projectId]);

  // Press "/" anywhere (outside an input) to jump to the search box; Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current && search) {
        setSearch('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [search]);

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    try {
      setCreatingSpace(true);
      const space = await docsAPI.createSpace({
        name: newSpaceName.trim(),
        classification: newSpaceClass.trim() || null,
        project_id: projectId ?? null,
      });
      setSpaceDialogOpen(false);
      setNewSpaceName('');
      setNewSpaceClass('');
      await loadSpaces();
      setActiveSpaceId(space.id);
      toast({ title: t('success'), description: t('docSpaceCreated') });
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docSpaceCreateFailed'), variant: 'destructive' });
    } finally {
      setCreatingSpace(false);
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
        parent_folder_id: activeFolderId,
      });
      setFolderDialogOpen(false);
      setNewFolderName('');
      await loadFolders();
      setActiveFolderId(folder.id);
    } catch (e: any) {
      toast({ title: t('error'), description: e?.response?.data?.detail || t('docFolderCreateFailed'), variant: 'destructive' });
    } finally {
      setCreatingFolder(false);
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

  return (
    <div className="px-4 py-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mb-6 flex items-center gap-3">
        <BookOpen className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('docHub')}</h1>
          <p className="text-sm text-muted-foreground">{projectId ? t('docHubProjectSubtitle') : t('docHubGlobalSubtitle')}</p>
        </div>
      </div>

      <div className={`grid gap-6 ${sidebarCollapsed ? 'grid-cols-1' : 'lg:grid-cols-[260px_1fr]'}`}>
        {/* Spaces rail */}
        {!sidebarCollapsed && (
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('docSpaces')}</h2>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSpaceDialogOpen(true)} title={t('docNewSpace')}>
                <FolderPlus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarCollapsed(true)} title={t('docHideSidebar')}>
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {loadingSpaces ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
            </div>
          ) : spaces.length === 0 ? (
            <button
              type="button"
              onClick={() => setSpaceDialogOpen(true)}
              className="w-full rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-muted-foreground hover:border-primary/40 dark:border-slate-700"
            >
              {t('docCreateFirstSpace')}
            </button>
          ) : (
            <ul className="space-y-1">
              {spaces.map((space) => {
                const active = space.id === activeSpaceId;
                return (
                  <li key={space.id}>
                    <button
                      type="button"
                      onClick={() => selectSpace(space.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors ${active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      {space.project_id == null ? <Globe className="h-4 w-4 shrink-0 opacity-70" /> : <FileText className="h-4 w-4 shrink-0 opacity-70" />}
                      <span className="flex-1 truncate" dir="auto">{space.name}</span>
                      <Badge variant="secondary" className="shrink-0">{space.doc_count}</Badge>
                    </button>
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
              <ul className="space-y-1">
                <li>
                  <button type="button" onClick={() => setActiveFolderId(null)} className={`w-full rounded-lg px-3 py-2 text-start text-sm ${activeFolderId == null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                    {t('docAllFolders')}
                  </button>
                </li>
                {folders.map((folder) => (
                  <li key={folder.id}>
                    <button type="button" onClick={() => setActiveFolderId(folder.id)} className={`w-full rounded-lg px-3 py-2 text-start text-sm ${activeFolderId === folder.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`} dir="auto">
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
          {/* Smart search + filters toolbar */}
          <div className="mb-4 space-y-3">
            {/* Search row */}
            <div className="flex flex-wrap items-center gap-2">
              {sidebarCollapsed && (
                <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setSidebarCollapsed(false)} title={t('docShowSidebar')}>
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              )}
              <div className="group relative flex-1 min-w-[240px]">
                <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary ${isRTL ? 'right-3' : 'left-3'}`} />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setSearchParams(e.target.value ? { q: e.target.value } : {}); }}
                  placeholder={t('docSearchSmartPlaceholder')}
                  className={`h-10 transition-shadow focus-visible:shadow-md ${isRTL ? 'pr-9 pl-16' : 'pl-9 pr-16'}`}
                  dir="auto"
                />
                <div className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 ${isRTL ? 'left-2.5' : 'right-2.5'}`}>
                  {search ? (
                    <button type="button" onClick={() => { setSearch(''); setSearchParams({}); searchRef.current?.focus(); }} className="rounded p-0.5 text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800" title={t('clear')}>
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-muted-foreground sm:inline dark:border-slate-700 dark:bg-slate-800">/</kbd>
                  )}
                </div>
              </div>

              {/* Search scope toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                <button type="button" onClick={() => setSearchScope('space')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${!scopeAll ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  <FileText className="h-3.5 w-3.5" /> {t('docScopeSpace')}
                </button>
                <button type="button" onClick={() => setSearchScope('all')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${scopeAll ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                  <Layers className="h-3.5 w-3.5" /> {t('docScopeAll')}
                </button>
              </div>

              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest_edited">{t('docSortLatestEdited')}</SelectItem>
                  <SelectItem value="latest_visited">{t('docSortLatestVisited')}</SelectItem>
                  <SelectItem value="created">{t('docSortCreated')}</SelectItem>
                  <SelectItem value="title">{t('docSortTitle')}</SelectItem>
                </SelectContent>
              </Select>

              <Button variant={showFilters ? 'default' : 'outline'} size="sm" onClick={() => setShowFilters((v) => !v)}>
                <SlidersHorizontal className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('filters')}
                {activeFilterCount > 0 && <Badge variant="secondary" className={`${isRTL ? 'mr-2' : 'ml-2'} h-5 px-1.5`}>{activeFilterCount}</Badge>}
              </Button>

              {/* View-mode toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
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

              {isAdmin && (
                <Button variant={insightsOpen ? 'default' : 'outline'} size="sm" onClick={() => setInsightsOpen((v) => !v)}>
                  <BarChart3 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docInsights')}
                </Button>
              )}

              {projectId && (
                <Button variant="outline" size="sm" onClick={() => navigate(`${basePath}/release-notes`)}>
                  <Rocket className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('releaseNotes')}
                </Button>
              )}

              <span className="flex-1" />

              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.zip"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
              />
              <Button variant="outline" size="sm" disabled={importing || activeSpaceId == null} onClick={() => fileInputRef.current?.click()}>
                {importing ? <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <Upload className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                {t('import')}
              </Button>
              <Button variant="outline" size="sm" disabled={!activeSpace} onClick={handleExportSpace}>
                <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('export')}
              </Button>
              <Button size="sm" disabled={activeSpaceId == null} onClick={() => setDocDialogOpen(true)}>
                <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {t('docNewDoc')}
              </Button>
            </div>

            {/* Status pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((s) => {
                const selected = statusFilter === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-muted-foreground hover:border-primary/40 dark:border-slate-700'}`}
                  >
                    {s === 'all' ? t('allStatuses') : t(`docStatus_${s}` as any)}
                  </button>
                );
              })}
            </div>

            {/* Expandable filter panel: tag + classification facets */}
            {showFilters && (
              <div className="grid gap-4 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-800">
                <div className="space-y-2">
                  <Label className="text-xs">{t('tags')}</Label>
                  <Input
                    value={tagFilter}
                    onChange={(e) => { setTagFilter(e.target.value); }}
                    placeholder={t('docFilterTagPlaceholder')}
                    className="h-8"
                    dir="auto"
                  />
                  {facets.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {facets.tags.slice(0, 12).map(({ value, count }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTagFilter((cur) => (cur === value ? '' : value))}
                          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${tagFilter === value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-muted-foreground hover:border-primary/40 dark:border-slate-700'}`}
                        >
                          {value} <span className="opacity-60">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">{t('docClassification')}</Label>
                  <Input
                    value={classificationFilter}
                    onChange={(e) => setClassificationFilter(e.target.value)}
                    placeholder={t('docFilterClassificationPlaceholder')}
                    className="h-8"
                    dir="auto"
                  />
                  {facets.classifications.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {facets.classifications.slice(0, 12).map(({ value, count }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setClassificationFilter((cur) => (cur === value ? '' : value))}
                          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${classificationFilter === value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-muted-foreground hover:border-primary/40 dark:border-slate-700'}`}
                        >
                          {value} <span className="opacity-60">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Result count + active filter chips */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {!loadingDocs && (
                <span className="font-medium text-foreground">{t('docResultCount', { n: total })}</span>
              )}
              {search.trim() && <FilterChip label={`"${search.trim()}"`} onClear={() => { setSearch(''); setSearchParams({}); }} />}
              {scopeAll && <FilterChip label={t('docScopeAll')} onClear={() => setSearchScope('space')} />}
              {statusFilter !== 'all' && <FilterChip label={t(`docStatus_${statusFilter}` as any)} onClear={() => setStatusFilter('all')} />}
              {tagFilter.trim() && <FilterChip label={`#${tagFilter.trim()}`} onClear={() => setTagFilter('')} />}
              {classificationFilter.trim() && <FilterChip label={classificationFilter.trim()} onClear={() => setClassificationFilter('')} />}
              {hasAnyFilter && (
                <button type="button" onClick={clearAllFilters} className="font-medium text-primary hover:underline">
                  {t('docClearFilters')}
                </button>
              )}
            </div>
          </div>

          {!loadingDocs && (pinnedDocs.length > 0 || recentDocs.length > 0) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pinnedDocs.length > 0 && hiddenHighlights.pinned && (
                <Button type="button" variant="outline" size="sm" onClick={() => setHighlightHidden('pinned', false)}>
                  <Pin className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docShowPinnedDocs')}
                </Button>
              )}
              {recentDocs.length > 0 && hiddenHighlights.recent && (
                <Button type="button" variant="outline" size="sm" onClick={() => setHighlightHidden('recent', false)}>
                  <Clock className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                  {t('docShowRecentDocs')}
                </Button>
              )}
            </div>
          )}

          {!loadingDocs && ((pinnedDocs.length > 0 && !hiddenHighlights.pinned) || (recentDocs.length > 0 && !hiddenHighlights.recent)) && (
            <div className="mb-4 grid gap-3 xl:grid-cols-2">
              {pinnedDocs.length > 0 && !hiddenHighlights.pinned && (
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Pin className="h-3.5 w-3.5 text-primary" />
                  <span className="min-w-0 flex-1">{t('docPinnedDocs')}</span>
                  <button type="button" onClick={() => setHighlightHidden('pinned', true)} className="rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800" title={t('docHidePinnedDocs')} aria-label={t('docHidePinnedDocs')}>
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
                  <button type="button" onClick={() => setHighlightHidden('recent', true)} className="rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800" title={t('docHideRecentDocs')} aria-label={t('docHideRecentDocs')}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {renderQuickDocs(recentDocs)}
              </div>
              )}
            </div>
          )}

          {/* Admin insights */}
          {isAdmin && insightsOpen && (
            <div className="mb-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" />{t('docInsights')}
              </div>
              {loadingOverview ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</div>
              ) : overview ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t('docStatTotalDocs')}</p><p className="text-2xl font-semibold">{overview.total_docs}</p></div>
                    <div className="rounded-lg border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" />{t('docStatTotalViews')}</p><p className="text-2xl font-semibold">{overview.total_views}</p></div>
                    <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t('uniqueVisitors')}</p><p className="text-2xl font-semibold">{overview.unique_visitors}</p></div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('docMostViewed')}</p>
                    {overview.most_viewed.length > 0 ? (
                      <ul className="divide-y rounded-lg border">
                        {overview.most_viewed.map((d) => (
                          <li key={d.id}>
                            <button type="button" onClick={() => navigate(`${basePath}/${d.project_seq ?? d.id}`)} className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{d.title}</span>
                              {d.last_viewed_at && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{formatServerDateTime(d.last_viewed_at)}</span>}
                              <Badge variant="outline" className="shrink-0 gap-1"><Eye className="h-3 w-3" />{d.view_count}</Badge>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t('docNoViewsYet')}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="py-4 text-sm text-muted-foreground">{t('docNoViewsYet')}</p>
              )}
            </div>
          )}

          {/* Doc grid */}
          {loadingDocs ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <li key={i}><DocCardSkeleton /></li>)}
            </ul>
          ) : !scopeAll && activeSpaceId == null ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-muted-foreground dark:border-slate-700">
              {t('docSelectSpace')}
            </div>
          ) : docs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
              {hasAnyFilter ? (
                <>
                  <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('docNoMatches')}</p>
                  <Button className="mt-4" size="sm" variant="outline" onClick={clearAllFilters}>
                    {t('docClearFilters')}
                  </Button>
                </>
              ) : (
                <>
                  <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('docNoneInSpace')}</p>
                  <Button className="mt-4" size="sm" disabled={activeSpaceId == null} onClick={() => setDocDialogOpen(true)}>
                    <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('docNewDoc')}
                  </Button>
                </>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground dark:bg-slate-800/50">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">
                      <button type="button" onClick={() => setSort('title')} className="inline-flex items-center gap-1 hover:text-foreground">
                        {t('title')}
                        {sort === 'title' ? <ChevronUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-start font-medium">{t('status')}</th>
                    <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{t('tags')}</th>
                    <th className="px-3 py-2 text-end font-medium">v</th>
                    <th className="px-3 py-2 text-end font-medium">{t('docPinned')}</th>
                    <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">
                      <button type="button" onClick={() => setSort('latest_edited')} className="inline-flex items-center gap-1 hover:text-foreground">
                        {t('docColUpdated')}
                        {sort === 'latest_edited' ? <ChevronDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                    {isAdmin && <th className="px-3 py-2 text-end font-medium">{t('views')}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {docs.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => navigate(`${basePath}/${d.project_seq ?? d.id}`)}
                      className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-3 py-2">
                        <span className="font-medium" dir="auto"><Highlight text={d.title} query={debouncedSearch} /></span>
                        {scopeAll && d.space_id !== activeSpaceId && (
                          <span className="ms-2 text-xs text-muted-foreground">· {spaces.find((s) => s.id === d.space_id)?.name || t('docSpace')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><Badge className={`border-0 ${statusTone[d.status] || statusTone.draft}`}>{t(`docStatus_${d.status}` as any)}</Badge></td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {d.tags?.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="cursor-pointer hover:bg-primary/10 hover:text-primary"
                              onClick={(event) => { event.stopPropagation(); setTagFilter((cur) => (cur === tag ? '' : tag)); setShowFilters(true); }}
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end text-muted-foreground">{d.current_version}</td>
                      <td className="px-3 py-2 text-end" onClick={(event) => event.stopPropagation()}>{renderDocPinButton(d)}</td>
                      <td className="hidden px-3 py-2 text-end text-xs text-muted-foreground sm:table-cell">{d.updated_at ? formatServerDateTime(d.updated_at) : '-'}</td>
                      {isAdmin && <td className="px-3 py-2 text-end text-muted-foreground"><span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{d.view_count ?? 0}</span></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : viewMode === 'list' ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <button
                    type="button"
                    onClick={() => navigate(`${basePath}/${d.project_seq ?? d.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-start"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium" dir="auto"><Highlight text={d.title} query={debouncedSearch} /></span>
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
                    className="flex h-full w-full flex-col rounded-lg border border-slate-200 bg-white p-4 text-start transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 font-semibold leading-snug" dir="auto">
                        <Highlight text={d.title} query={debouncedSearch} />
                      </h3>
                      <div className="flex shrink-0 items-center gap-1">
                        {renderDocPinButton(d, '-mt-1')}
                        <Badge className={`border-0 ${statusTone[d.status] || statusTone.draft}`}>{t(`docStatus_${d.status}` as any)}</Badge>
                      </div>
                    </div>
                    {d.excerpt && (
                      <p className="line-clamp-3 flex-1 text-sm text-muted-foreground" dir="auto">
                        <Highlight text={d.excerpt} query={debouncedSearch} />
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {scopeAll && d.space_id !== activeSpaceId && (
                        <Badge variant="outline" className="gap-1">
                          <Layers className="h-3 w-3" />{spaces.find((s) => s.id === d.space_id)?.name || t('docSpace')}
                        </Badge>
                      )}
                      {d.classification && <Badge variant="outline">{d.classification}</Badge>}
                      {d.tags?.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="cursor-pointer hover:bg-primary/10 hover:text-primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            setTagFilter((cur) => (cur === tag ? '' : tag));
                            setShowFilters(true);
                          }}
                        >
                          {tag}
                        </Badge>
                      ))}
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

      {/* New space dialog */}
      <Dialog open={spaceDialogOpen} onOpenChange={setSpaceDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('docNewSpace')}</DialogTitle>
            <DialogDescription>{projectId ? t('docNewProjectSpaceDesc') : t('docNewGlobalSpaceDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('name')}</Label>
              <Input value={newSpaceName} onChange={(e) => setNewSpaceName(e.target.value)} placeholder={t('docSpaceNamePlaceholder')} dir="auto" autoFocus />
            </div>
            <div className="space-y-1">
              <Label>{t('docClassification')}</Label>
              <Input value={newSpaceClass} onChange={(e) => setNewSpaceClass(e.target.value)} placeholder={t('docClassificationPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpaceDialogOpen(false)} disabled={creatingSpace}>{t('cancel')}</Button>
            <Button onClick={handleCreateSpace} disabled={creatingSpace || !newSpaceName.trim()}>
              {creatingSpace && <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? 'ml-2' : 'mr-2'}`} />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
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
