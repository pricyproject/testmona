import { useEffect, useState, useRef, useMemo } from 'react';
import { Check, ChevronsUpDown, FolderOpen, FolderPlus, Search, X } from 'lucide-react';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { projectsAPI } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';

interface ProjectSelectorProps {
  onProjectSelected?: (project: Project) => void;
  showCreateButton?: boolean;
  onCreateClick?: () => void;
}

// Deterministic gradient per project so each avatar is recognisable at a glance
// without storing a colour on the model.
const AVATAR_GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-fuchsia-500 to-purple-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
  'from-violet-500 to-indigo-600',
  'from-lime-500 to-green-600',
];

const gradientFor = (project: Pick<Project, 'id'>) =>
  AVATAR_GRADIENTS[Math.abs(project.id ?? 0) % AVATAR_GRADIENTS.length];

const initialOf = (name?: string) => (name?.trim()?.charAt(0) || '?').toUpperCase();

function ProjectAvatar({ project, large = false }: { project: Project; large?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md bg-linear-to-br font-bold text-white shadow-sm ${gradientFor(project)} ${large ? 'h-7 w-7 text-xs' : 'h-6 w-6 text-[11px]'}`}
      aria-hidden="true"
    >
      {initialOf(project.name)}
    </span>
  );
}

export function ProjectSelector({
  onProjectSelected,
  showCreateButton = false,
  onCreateClick,
}: ProjectSelectorProps) {
  const { selectedProject, projects, setSelectedProject, setProjects } = useProjectStore();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hasLoaded = useRef(false);
  const refreshController = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load projects from API on component mount
  useEffect(() => {
    if (hasLoaded.current) return; // Prevent multiple calls

    const loadProjects = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const projectsData = await projectsAPI.getAll();
        setProjects(projectsData);

        // If no project is selected and we have projects, select the first one
        if (!selectedProject && projectsData.length > 0) {
          const firstProject = projectsData[0];
          setSelectedProject(firstProject);
          onProjectSelected?.(firstProject);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
        setError('Failed to load projects');
        setProjects([]);
      } finally {
        setIsLoading(false);
        hasLoaded.current = true;
      }
    };

    loadProjects();
  }, []); // Only run on mount

  const handleProjectChange = async (projectId: number) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    // Cancel any pending refresh request from previous selection
    if (refreshController.current) {
      refreshController.current.abort();
    }

    // Create new AbortController for this request
    refreshController.current = new AbortController();
    const currentRequestId = ++requestId.current;

    // Set selected project immediately for UI responsiveness
    setSelectedProject(project);
    onProjectSelected?.(project);

    // Refresh project data to get latest counts
    try {
      const updatedProject = await projectsAPI.getById(project.id, refreshController.current.signal);

      // Ignore response if a newer selection has been made
      if (currentRequestId !== requestId.current) {
        return;
      }

      // Update the project in the store with fresh data
      setProjects(projects.map(p => p.id === project.id ? updatedProject : p));
      setSelectedProject(updatedProject);
      onProjectSelected?.(updatedProject);
    } catch (error) {
      // Ignore error if request was aborted due to new selection
      if (error.name !== 'AbortError') {
        console.error('Failed to refresh project data:', error);
        // Continue with the cached project data
      }
    }
  };

  // Show the filter field only once the list is long enough to warrant it.
  const showSearch = projects.length > 7;

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  const closeMenu = () => {
    setOpen(false);
    setQuery('');
  };

  const selectProject = (project: Project) => {
    closeMenu();
    if (project.id !== selectedProject?.id) {
      handleProjectChange(project.id);
    }
  };

  // Focus the search field as soon as the menu opens so power users can type
  // straight away.
  useEffect(() => {
    if (open && showSearch) {
      // Defer until the panel has mounted.
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, showSearch]);

  // Close on outside click. A `position: fixed` backdrop can't be used here:
  // the navbar's `backdrop-blur` makes fixed descendants resolve against the
  // header box (not the viewport), so it would never cover the page. A document
  // listener scoped to the container ref is immune to ancestor filters/transforms.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          closeMenu();
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isLoading || projects.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group flex h-9 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white ps-2 pe-2.5 text-start transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-gray-600 dark:hover:bg-gray-800"
      >
        {selectedProject ? (
          <ProjectAvatar project={selectedProject} />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400 dark:bg-gray-700">
            <FolderOpen className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
          {selectedProject?.name || (isLoading ? t('loadingProjects') : t('selectProject'))}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-gray-600 dark:group-hover:text-gray-300" />
      </button>

      {error && (
        <p className="mt-1 truncate text-xs text-red-500" title={error}>
          {error}
        </p>
      )}

      {open && (
        <div className="absolute start-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900">
            {showSearch && (
              <div className="border-b border-gray-100 p-1.5 dark:border-gray-800">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('searchProjects')}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 ps-9 pe-8 text-sm text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:bg-gray-800"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}
                      className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      aria-label={t('clearSearch')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="max-h-[300px] overflow-y-auto p-1.5" role="listbox">
              {filteredProjects.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('noProjectsFound')}
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const isSelected = project.id === selectedProject?.id;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectProject(project)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                      <ProjectAvatar project={project} large />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${isSelected ? 'font-semibold text-blue-700 dark:text-blue-300' : 'font-medium text-gray-900 dark:text-white'}`}>
                          {project.name}
                        </span>
                        {project.test_cases_count !== undefined && (
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                            {t('testCasesCountSimple', { count: project.test_cases_count })}
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />}
                    </button>
                  );
                })
              )}
            </div>

            {showCreateButton && (
              <button
                type="button"
                onClick={() => { closeMenu(); onCreateClick?.(); }}
                className="flex w-full items-center gap-2.5 border-t border-gray-100 px-3.5 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:border-gray-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
              >
                <FolderPlus className="h-4 w-4" />
                {t('createProject')}
              </button>
            )}
        </div>
      )}
    </div>
  );
}
