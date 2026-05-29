import { Fragment, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { NotificationDropdown } from '@/components/NotificationDropdown';
import { ProjectSelector } from '@/components/ProjectSelector';
import { api } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/locales/translations';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface NavbarProps {
  onMobileMenuToggle: () => void;
  isSidebarCollapsed: boolean;
  onSidebarToggle: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
}

type Crumb = { label: string; href?: string };

// Maps a URL path segment to its translation key for breadcrumb labels.
const SECTION_LABEL_KEYS: Record<string, TranslationKey> = {
  dashboard: 'overview',
  projects: 'projects',
  requirements: 'requirements',
  'test-cases': 'testCases',
  'test-suites': 'testSuites',
  'test-runs': 'testRuns',
  'test-plans': 'testPlans',
  defects: 'defects',
  reports: 'reports',
  milestones: 'milestones',
  'custom-fields': 'customFields',
  'shared-steps': 'sharedSteps',
  'global-parameters': 'globalParameters',
  'test-data': 'testData',
  sections: 'sections',
  environments: 'environments',
  'activity-management': 'activity',
  profile: 'profile',
  settings: 'settings',
};

const titleCase = (segment: string): string =>
  segment.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

export function Navbar({
  onMobileMenuToggle,
  isSidebarCollapsed,
  onSidebarToggle,
  theme,
  onThemeToggle,
}: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();
  const { selectedProject, projects } = useProjectStore();
  const { t, isRTL } = useTranslation();
  const [unreadCount, setUnreadCount] = useState(0);

  const sectionLabel = (segment: string): string => {
    const key = SECTION_LABEL_KEYS[segment];
    return key ? t(key) : titleCase(segment);
  };

  // Builds an accurate trail from the current route instead of guessing a
  // single "current page" label.
  const buildBreadcrumbs = (): Crumb[] => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length === 0 || parts[0] === 'dashboard') {
      return [{ label: t('dashboard') }];
    }

    const crumbs: Crumb[] = [{ label: t('dashboard'), href: '/dashboard' }];

    if (parts[0] === 'projects') {
      crumbs.push({ label: t('projects'), href: parts.length > 1 ? '/projects' : undefined });
      if (parts.length >= 2) {
        crumbs.push({ label: selectedProject?.name || `#${parts[1]}` });
      }
      if (parts.length >= 3) {
        crumbs.push({ label: sectionLabel(parts[2]) });
      }
      return crumbs;
    }

    crumbs.push({ label: sectionLabel(parts[0]) });
    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  const handleProjectSelected = (project: any) => {
    if (location.pathname.startsWith('/projects/') && selectedProject?.id !== project.id) {
      const pathParts = location.pathname.split('/');
      if (pathParts.length >= 3) {
        pathParts[2] = project.id.toString();
        navigate(pathParts.join('/'));
      }
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    if (!user) return;

    const fetchUnreadCount = async () => {
      try {
        const response = await api.get('/notifications/unread/count');
        setUnreadCount(response.data.unread_count);
      } catch (error) {
        console.error('Failed to fetch unread count:', error);
      }
    };

    fetchUnreadCount();
    window.addEventListener('notifications:refresh', fetchUnreadCount);
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => {
      window.removeEventListener('notifications:refresh', fetchUnreadCount);
      clearInterval(interval);
    };
  }, [user]);

  const SidebarToggleIcon = isSidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const iconButtonClass = 'h-9 w-9 rounded-lg p-0 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white';

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 shadow-xs backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/80">
      <div className="mx-auto flex h-16 max-w-[2000px] items-center gap-3 px-3 sm:px-4 lg:px-6">
        {/* Left: navigation toggles + brand + breadcrumbs */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="sm"
            className={`lg:hidden ${iconButtonClass}`}
            onClick={onMobileMenuToggle}
            aria-label={t('menu')}
          >
            <Menu className="h-[18px] w-[18px]" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={`hidden lg:flex ${iconButtonClass}`}
            onClick={onSidebarToggle}
            title={isSidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
            aria-label={isSidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
          >
            <SidebarToggleIcon className="h-[18px] w-[18px]" />
          </Button>

          {/* Breadcrumb trail */}
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm md:flex">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 && (
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600 ${isRTL ? 'rotate-180' : ''}`} />
                  )}
                  {crumb.href && !isLast ? (
                    <Link
                      to={crumb.href}
                      className="shrink-0 rounded px-1 font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      {index === 0 ? (
                        <span className="flex items-center gap-1.5">
                          <LayoutDashboard className="h-3.5 w-3.5" />
                          <span className="hidden lg:inline">{crumb.label}</span>
                        </span>
                      ) : (
                        crumb.label
                      )}
                    </Link>
                  ) : (
                    <span className={`truncate px-1 ${isLast ? 'font-semibold text-gray-900 dark:text-white' : 'font-medium text-gray-500 dark:text-gray-400'}`}>
                      {crumb.label}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </nav>
        </div>

        {/* Right: project selector + actions + user menu */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {projects.length > 0 && (
            <>
              <div className="hidden max-w-[180px] sm:block lg:max-w-[240px]">
                <ProjectSelector onProjectSelected={handleProjectSelected} />
              </div>
              <div className="hidden h-6 w-px bg-gray-200 dark:bg-gray-700 sm:block" />
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onThemeToggle}
            title={theme === 'light' ? t('darkMode') : t('lightMode')}
            aria-label={theme === 'light' ? t('darkMode') : t('lightMode')}
            className={iconButtonClass}
          >
            {theme === 'light' ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
          </Button>

          <NotificationDropdown unreadCount={unreadCount} onUnreadCountChange={setUnreadCount} />

          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 w-9 rounded-full p-0 transition-transform duration-200 hover:scale-105 active:scale-95"
                aria-label={t('profile')}
              >
                <Avatar className="h-9 w-9 ring-2 ring-gray-200 ring-offset-2 ring-offset-white dark:ring-gray-700 dark:ring-offset-gray-900">
                  <AvatarImage src="" alt={user?.username || 'User'} />
                  <AvatarFallback className="bg-linear-to-br from-blue-600 to-blue-700 text-sm font-semibold text-white">
                    {(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64 p-2" align={isRTL ? 'start' : 'end'} forceMount>
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <Avatar className="h-10 w-10 ring-2 ring-blue-500/20">
                  <AvatarImage src="" alt={user?.username || 'User'} />
                  <AvatarFallback className="bg-linear-to-br from-blue-600 to-blue-700 text-sm font-semibold text-white">
                    {(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{user?.full_name || user?.username}</p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">{user?.email}</p>
                </div>
              </div>
              <DropdownMenuSeparator className="my-2" />
              <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer rounded-md px-3 py-2.5">
                <User className={`h-[18px] w-[18px] ${isRTL ? 'ml-3' : 'mr-3'}`} />
                <span className="text-sm font-medium">{t('profile')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer rounded-md px-3 py-2.5">
                <Settings className={`h-[18px] w-[18px] ${isRTL ? 'ml-3' : 'mr-3'}`} />
                <span className="text-sm font-medium">{t('settings')}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-2" />
              <DropdownMenuItem
                onClick={handleLogout}
                className="cursor-pointer rounded-md px-3 py-2.5 text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950/30"
              >
                <LogOut className={`h-[18px] w-[18px] ${isRTL ? 'ml-3' : 'mr-3'}`} />
                <span className="text-sm font-medium">{t('logout')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
