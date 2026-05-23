import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  TestTube,
  FileText,
  PlayCircle,
  BarChart3,
  Settings,
  LogOut,
  FileCheck,
  Bug,
  Target,
  Flag,
  ChevronLeft,
  Settings2,
  FolderTree,
  User,
  Sparkles,
  Database,
  Layers,
  Wrench,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getAppInitials, useAppName } from '@/hooks/useAppName';

interface NavigationItem {
  name: string;
  href: string;
  icon: any;
  group?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface NavigationGroup {
  name: string;
  items: NavigationItem[];
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isHovering: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  isHovering,
  onMouseEnter,
  onMouseLeave,
  isOpen,
  onClose
}: SidebarProps) {
  const location = useLocation();
  const { logout } = useAuthStore();
  const { selectedProject, projects } = useProjectStore();
  const { t, isRTL } = useTranslation();
  const { appName, appLogoUrl } = useAppName(false);

  // Build project-scoped navigation based on selected project and available projects
  const buildNavigation = (): NavigationGroup[] => {
    const projectId = selectedProject?.id;
    const hasProjectsInDb = projects && projects.length > 0;
    
    if (!hasProjectsInDb) {
      // Show only essential navigation when no projects exist in database
      return [
        {
          name: t('gettingStarted'),
          items: [
            { name: t('projects'), href: '/projects', icon: FolderOpen },
          ]
        },
        {
          name: t('user'),
          items: [
            { name: t('profile'), href: '/profile', icon: User },
            { name: t('settings'), href: '/settings', icon: Settings2 },
          ]
        }
      ];
    }
    
    if (!projectId) {
      // Show global navigation when projects exist but none is selected
      return [
        {
          name: t('global'),
          items: [
            { name: t('projects'), href: '/projects', icon: FolderOpen },
            { name: t('environments'), href: '/environments', icon: Settings },
            { name: t('activity'), href: '/activity-management', icon: BarChart3 },
          ]
        },
        {
          name: t('user'),
          items: [
            { name: t('profile'), href: '/profile', icon: User },
            { name: t('settings'), href: '/settings', icon: Settings2 },
          ]
        }
      ];
    }

    // Full navigation with project-scoped items organized in groups
    return [
      {
        name: t('main'),
        items: [
          { name: t('projects'), href: '/projects', icon: FolderOpen },
          { name: t('overview'), href: '/dashboard', icon: LayoutDashboard },
        ]
      },
      {
        name: t('testing'),
        items: [
          { name: t('requirements'), href: `/projects/${projectId}/requirements`, icon: FileCheck },
          { name: t('testCases'), href: `/projects/${projectId}/test-cases`, icon: FileText },
          { name: t('testSuites'), href: `/projects/${projectId}/test-suites`, icon: TestTube },
          { name: t('testRuns'), href: `/projects/${projectId}/test-runs`, icon: PlayCircle },
          { name: t('sections'), href: `/projects/${projectId}/sections`, icon: FolderTree },
        ]
      },
      {
        name: t('planning'),
        items: [
          { name: t('milestones'), href: `/projects/${projectId}/milestones`, icon: Flag },
          { name: t('testPlans'), href: `/projects/${projectId}/test-plans`, icon: ClipboardList },
        ]
      },
      {
        name: t('management'),
        items: [
          { name: t('defects'), href: `/projects/${projectId}/defects`, icon: Bug },
          { name: t('reports'), href: `/projects/${projectId}/reports`, icon: BarChart3 },
        ]
      },
      {
        name: t('configuration'),
        items: [
          { name: t('customFields'), href: `/projects/${projectId}/custom-fields`, icon: Database },
          { name: t('sharedSteps'), href: `/projects/${projectId}/shared-steps`, icon: Layers },
          { name: t('globalParameters'), href: `/projects/${projectId}/global-parameters`, icon: Wrench },
        ]
      },
      {
        name: t('global'),
        items: [
          { name: t('environments'), href: `/projects/${projectId}/environments`, icon: Settings },
        ]
      },
      {
        name: t('user'),
        items: [
          { name: t('profile'), href: '/profile', icon: User },
          { name: t('settings'), href: '/settings', icon: Settings2 },
        ]
      }
    ];
  };

  const navigation = buildNavigation();

  const isActive = (href: string) => location.pathname === href;
  const showCollapsed = isCollapsed && !isHovering;

  return (
    <>
      {/* Mobile sidebar backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          bg-white dark:bg-gray-900 shadow-lg border-r border-gray-200 dark:border-gray-700
          flex flex-col transition-all duration-300 ease-in-out
          ${showCollapsed ? 'w-16' : 'w-64'}
          ${isOpen ? 'fixed lg:static top-0 bottom-0 left-0 z-50 lg:z-auto translate-x-0 lg:translate-x-0' : 'fixed lg:static top-0 bottom-0 left-0 z-50 lg:z-auto -translate-x-full lg:translate-x-0'}
          min-w-0 h-screen lg:relative
        `}
      >
        {/* Sidebar Header */}
        <div className={`flex items-center h-16 border-b border-gray-200 dark:border-gray-700 shrink-0 transition-all duration-300 ease-in-out ${
          showCollapsed ? 'justify-center px-2' : 'justify-between px-6'
        }`}>
          <Link
            to="/dashboard"
            onClick={onClose}
            title={appName}
            className="flex items-center gap-2 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
          >
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
              {appLogoUrl ? (
                <img src={appLogoUrl} alt={appName} className="h-full w-full rounded-lg object-cover" />
              ) : (
                <span className="text-white font-bold text-sm">{getAppInitials(appName)}</span>
              )}
            </div>
            {!showCollapsed && (
              <span className="text-xl font-bold text-gray-900 dark:text-white whitespace-nowrap">{appName}</span>
            )}
          </Link>

          {/* Mobile close button */}
          {!showCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={onClose}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 mt-6 overflow-y-auto min-h-0">
          <div className={`space-y-3 transition-all duration-300 ease-in-out ${
            showCollapsed ? 'px-1' : 'px-3'
          }`}>
            {navigation.map((group, groupIndex) => (
              <div key={group.name}>
                {/* Group Header */}
                {!showCollapsed && (
                  <div className={`px-3 pt-2 pb-1 ${isRTL ? 'text-right' : 'text-left'}`}>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      {group.name}
                    </span>
                  </div>
                )}

                {/* Group Items */}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isItemActive = isActive(item.href);

                    return (
                      <div key={item.name}>
                        {item.disabled ? (
                          <div
                            className={`
                              group flex items-center py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ease-in-out relative overflow-hidden
                              text-gray-400 cursor-not-allowed opacity-60
                              ${showCollapsed ? 'justify-center px-1' : 'px-3'}
                            `}
                            title={showCollapsed ? item.disabledReason || item.name : item.disabledReason}
                          >
                            <Icon className={`${showCollapsed ? 'h-6 w-6' : (isRTL ? 'ml-3' : 'mr-3') + ' h-5 w-5'} transition-all duration-300 ease-in-out shrink-0`} />
                            <span className={`transition-all duration-300 ease-in-out whitespace-nowrap overflow-hidden ${
                              showCollapsed ? 'opacity-0 w-0' : 'opacity-100'
                            }`}>
                              {item.name}
                            </span>
                          </div>
                        ) : (
                          <Link
                            to={item.href}
                            className={`
                              group flex items-center py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ease-in-out relative overflow-hidden
                              ${isItemActive
                                ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700 shadow-xs dark:bg-blue-900/20 dark:text-blue-400'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 hover:shadow-xs dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                              }
                              ${showCollapsed ? 'justify-center px-1' : 'px-3'}
                            `}
                            title={showCollapsed ? item.name : undefined}
                          >
                            <Icon className={`${showCollapsed ? 'h-6 w-6' : (isRTL ? 'ml-3' : 'mr-3') + ' h-5 w-5'} transition-all duration-300 ease-in-out shrink-0`} />
                            <span className={`transition-all duration-300 ease-in-out whitespace-nowrap overflow-hidden ${
                              showCollapsed ? 'opacity-0 w-0' : 'opacity-100'
                            }`}>
                              {item.name}
                            </span>
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Inline Group Separator - subtle dot line */}
                {!showCollapsed && groupIndex < navigation.length - 1 && (
                  <div className="flex items-center justify-center py-2">
                    <div className="flex-1 h-px bg-linear-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600"></div>
                    <div className="w-1 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-2"></div>
                    <div className="flex-1 h-px bg-linear-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600"></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className={`shrink-0 border-t border-gray-200 dark:border-gray-700 space-y-3 transition-all duration-300 ease-in-out ${
          showCollapsed ? 'p-2' : 'p-4'
        }`}>
          {/* Collapse/Expand button for desktop */}
          <Button
            variant="ghost"
            className={`w-full text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white transition-all duration-300 ease-in-out justify-start ${
              showCollapsed ? 'px-1' : 'px-3'
            }`}
            onClick={onToggleCollapse}
            title={isCollapsed ? t('expandSidebar') : t('collapseSidebar')}
          >
            <ChevronLeft className={`h-4 w-4 transition-transform duration-300 ease-in-out ${
              isRTL ? (isCollapsed ? '-rotate-180' : 'rotate-180') : (isCollapsed ? 'rotate-180' : '')
            }`} />
            <span className={`transition-all duration-300 ease-in-out whitespace-nowrap overflow-hidden ${isRTL ? 'mr-2' : 'ml-2'} ${
              showCollapsed ? 'opacity-0 w-0' : 'opacity-100'
            }`}>
              {isCollapsed ? t('expand') : t('collapse')}
            </span>
          </Button>

          {/* Logout button */}
          <Button
            variant="ghost"
            className={`w-full text-gray-600 hover:text-gray-900 hover:bg-red-50 hover:text-red-700 transition-all duration-300 ease-in-out relative overflow-hidden ${
              showCollapsed ? 'justify-center px-1' : 'justify-start px-3'
            }`}
            onClick={logout}
            title={showCollapsed ? t('logout') : undefined}
          >
            <LogOut className={`${showCollapsed ? 'h-6 w-6' : (isRTL ? 'ml-3' : 'mr-3') + ' h-5 w-5'} transition-all duration-300 ease-in-out shrink-0`} />
            <span className={`transition-all duration-300 ease-in-out whitespace-nowrap overflow-hidden ${
              showCollapsed ? 'opacity-0 w-0' : 'opacity-100'
            }`}>
              {t('logout')}
            </span>
          </Button>
        </div>
      </div>
    </>
  );
}
