import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { resolveSafeRedirect } from '@/utils/safeRedirect';
import { Layout } from '@/components/Layout';
import { ProjectGuard } from '@/components/ProjectGuard';
import { FeatureGuard } from '@/components/FeatureGuard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuthStore, initializeAuthFromLocalStorage } from '@/stores/authStore';
import { isAdminUser } from '@/utils/roles';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';

const lazyPage = <P extends object = object>(loader: () => Promise<any>, exportName: string) =>
  lazy<ComponentType<P>>(() => loader().then((module) => ({ default: module[exportName] as ComponentType<P> })));

const Login = lazyPage(() => import('@/pages/Login'), 'Login');
const Signup = lazyPage(() => import('@/pages/Signup'), 'Signup');
const Setup = lazyPage(() => import('@/pages/Setup'), 'Setup');
const AcceptInvite = lazyPage(() => import('@/pages/AcceptInvite'), 'AcceptInvite');
const Dashboard = lazyPage(() => import('@/pages/Dashboard'), 'Dashboard');
const Projects = lazyPage(() => import('@/pages/Projects'), 'Projects');
const Requirements = lazyPage(() => import('@/pages/Requirements'), 'Requirements');
const RequirementDetail = lazyPage(() => import('@/pages/RequirementDetail'), 'RequirementDetail');
const AskProject = lazyPage(() => import('@/pages/AskProject'), 'AskProject');
const DocHub = lazyPage(() => import('@/pages/DocHub'), 'DocHub');
const DocDetail = lazyPage<{ initialTab?: 'document' | 'revisions' | 'links' | 'stats' }>(() => import('@/pages/DocDetail'), 'DocDetail');
const DocEditor = lazyPage(() => import('@/pages/DocEditor'), 'DocEditor');
const ReleaseNotes = lazyPage(() => import('@/pages/ReleaseNotes'), 'ReleaseNotes');
const PublicDoc = lazyPage(() => import('@/pages/PublicDoc'), 'PublicDoc');
const TestSuites = lazyPage(() => import('@/pages/TestSuites'), 'TestSuites');
const TestSuiteDetail = lazyPage(() => import('@/pages/TestSuiteDetail'), 'TestSuiteDetail');
const TestCases = lazyPage(() => import('@/pages/TestCases'), 'TestCases');
const TestCaseDetail = lazyPage(() => import('@/pages/TestCaseDetail'), 'TestCaseDetail');
const TestCaseEdit = lazyPage(() => import('@/pages/TestCaseEdit'), 'TestCaseEdit');
const TestCaseRevisions = lazyPage(() => import('@/pages/TestCaseRevisions'), 'TestCaseRevisions');
const TestCaseExecutionHistory = lazyPage(() => import('@/pages/TestCaseExecutionHistory'), 'TestCaseExecutionHistory');
const TestCaseExecute = lazyPage(() => import('@/pages/TestCaseExecute'), 'TestCaseExecute');
const TestCaseExecution = lazyPage(() => import('@/pages/TestCaseExecution'), 'TestCaseExecution');
const SectionRedirect = lazyPage(() => import('@/pages/SectionRedirect'), 'SectionRedirect');
const Environments = lazyPage(() => import('@/pages/Environments'), 'Environments');
const TestPlans = lazyPage(() => import('@/pages/TestPlans'), 'TestPlans');
const TestPlanDetail = lazyPage(() => import('@/pages/TestPlanDetail'), 'TestPlanDetail');
const TestRuns = lazyPage(() => import('@/pages/TestRuns'), 'TestRuns');
const TestRunDetail = lazyPage(() => import('@/pages/TestRunDetail'), 'TestRunDetail');
const TestRunReport = lazyPage(() => import('@/pages/TestRunReport'), 'TestRunReport');
const MatrixRuns = lazyPage(() => import('@/pages/MatrixRuns'), 'MatrixRuns');
const MatrixRunDetail = lazyPage(() => import('@/pages/MatrixRunDetail'), 'MatrixRunDetail');
const Defects = lazyPage(() => import('@/pages/Defects'), 'Defects');
const DefectDetail = lazyPage(() => import('@/pages/DefectDetail'), 'DefectDetail');
const RootCauseAnalysisPage = lazyPage(() => import('@/pages/RootCauseAnalysisPage'), 'RootCauseAnalysisPage');
const AdvancedSearch = lazyPage(() => import('@/pages/AdvancedSearch'), 'AdvancedSearch');
const TestAssetHealth = lazyPage(() => import('@/pages/TestAssetHealth'), 'TestAssetHealth');
const Reports = lazyPage(() => import('@/pages/Reports'), 'Reports');
const SharedReportViewer = lazyPage(() => import('@/pages/SharedReportViewer'), 'SharedReportViewer');
const Milestones = lazyPage(() => import('@/pages/Milestones'), 'Milestones');
const MilestoneDetail = lazyPage(() => import('@/pages/MilestoneDetail'), 'MilestoneDetail');
const CustomFields = lazyPage(() => import('@/pages/CustomFields'), 'CustomFields');
const SharedSteps = lazyPage(() => import('@/pages/SharedSteps'), 'SharedSteps');
const GlobalParameters = lazyPage(() => import('@/pages/GlobalParameters'), 'GlobalParameters');
const TestData = lazyPage(() => import('@/pages/TestData'), 'TestData');
const ActivityManagement = lazyPage(() => import('@/pages/ActivityManagement'), 'ActivityManagement');
const Settings = lazyPage<{ adminMode?: boolean; projectId?: number; singleTab?: string }>(() => import('@/pages/Settings'), 'Settings');
const Profile = lazyPage(() => import('@/pages/Profile'), 'Profile');
const WorkInbox = lazyPage(() => import('@/pages/WorkInbox'), 'WorkInbox');
const NotificationRedirect = lazyPage(() => import('@/pages/NotificationRedirect'), 'NotificationRedirect');
const ProjectMembers = lazyPage(() => import('@/pages/ProjectMembers'), 'ProjectMembers');
const ProjectSettings = lazyPage(() => import('@/pages/ProjectSettings'), 'ProjectSettings');
const ApiTokens = lazyPage(() => import('@/pages/ApiTokens'), 'ApiTokens');
const Webhooks = lazyPage(() => import('@/pages/Webhooks'), 'Webhooks');

function RedirectToTestSuites() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId || ''}/test-suites`} replace />;
}

// Per-project Test Management: test types / priorities / step templates are now
// owned by each project, so this reuses the Settings test-management panel scoped
// to the project rather than the old global /administrator tab.
function ProjectTestManagement() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Settings projectId={Number(projectId)} singleTab="test-management" />;
}

// An already-authenticated user landing on /login or /signup (e.g. via a
// `?next=` deep link, or because auth flips to true while the URL is still on
// the auth screen) must be sent to their intended destination, not blanket
// /projects. Honoring `next` here closes the race where this redirect would
// otherwise fire before the Login page's own post-login navigation.
function PostAuthRedirect() {
  const [searchParams] = useSearchParams();
  return <Navigate to={resolveSafeRedirect(searchParams.get('next')) || '/projects'} replace />;
}

// Cross-project administration lives at /administrator and is restricted to
// admins; everyone else is bounced to their projects.
function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthStore();
  return isAdminUser(user) ? <>{children}</> : <Navigate to="/projects" replace />;
}

function LoginRedirect() {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/login?next=${next}`} replace />;
}

function PageFallback() {
  return (
    <div className="min-h-[40vh] bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}

// Unauthenticated entry point. On a brand-new instance (no accounts yet) it
// forces the visitor through the web-based setup wizard; once an account
// exists it falls back to the normal login/signup screens. The wizard is never
// reachable again after the first account is created.
function UnauthenticatedApp() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    fetch(`${apiUrl}/system/setup-status`)
      .then((res) => (res.ok ? res.json() : { needs_setup: false }))
      .then((data) => {
        if (!cancelled) setNeedsSetup(Boolean(data?.needs_setup));
      })
      .catch(() => {
        // Network/transient error: don't trap the user in setup — show login.
        if (!cancelled) setNeedsSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (needsSetup === null) {
    return <PageFallback />;
  }

  if (needsSetup) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/accept-invite/:token" element={<AcceptInvite />} />
        {/* Setup already completed — never expose the wizard again. */}
        <Route path="/setup" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<LoginRedirect />} />
      </Routes>
    </Suspense>
  );
}

function AppWithRouter() {
  const { isAuthenticated, initializeDevAuth, compactMode, applyDefaultLanguage } = useAuthStore();
  const { isRTL, language } = useTranslation();
  const { appName, appLogoUrl } = useAppName();
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize localStorage sync immediately on component mount
  useEffect(() => {
    initializeAuthFromLocalStorage().then(() => {
      setIsInitialized(true);
    });
  }, []);

  // Adopt the backend's default language for anyone who hasn't picked one yet
  // (e.g. a first-time visitor on the sign-in / setup screen). A real user
  // choice is never overwritten — applyDefaultLanguage respects that.
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    fetch(`${apiUrl}/system/settings/public/default_language`)
      .then((res) => (res.ok ? res.json() : null))
      .then((setting) => {
        const value = setting?.value;
        if (value === 'en' || value === 'fa' || value === 'ar') {
          applyDefaultLanguage(value);
        }
      })
      .catch(() => {
        /* offline / not ready — keep the current language */
      });
  }, [applyDefaultLanguage]);
  
  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [isRTL, language]);

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  useEffect(() => {
    const existingIcon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!existingIcon || !appLogoUrl) return;

    existingIcon.href = appLogoUrl;
  }, [appLogoUrl]);

  // Apply compact mode on mount and when it changes
  useEffect(() => {
    document.documentElement.classList.toggle('compact-mode', compactMode);
    document.documentElement.dataset.uiDensity = compactMode ? 'compact' : 'comfortable';
  }, [compactMode]);

  // Initialize development auto-login
  useEffect(() => {
    initializeDevAuth();
  }, [initializeDevAuth]);
  
  // Show loading state while initializing auth
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  // These routes are fully public and should render without the app chrome
  // (no Layout, no auth gate) in either auth state.
  if (
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/shared-reports/') ||
      window.location.pathname.startsWith('/docs/public/') ||
      window.location.pathname.startsWith('/accept-invite/'))
  ) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/shared-reports/:token" element={<SharedReportViewer />} />
          <Route path="/docs/public/:publicId" element={<PublicDoc />} />
          <Route path="/accept-invite/:token" element={<AcceptInvite />} />
        </Routes>
      </Suspense>
    );
  }

  if (!isAuthenticated) {
    return <UnauthenticatedApp />;
  }
  
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/login" element={<PostAuthRedirect />} />
        <Route path="/signup" element={<PostAuthRedirect />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inbox" element={<WorkInbox />} />
        <Route path="/n/:id" element={<NotificationRedirect />} />
        
        {/* Project-scoped routes */}
        <Route path="/projects/:projectId/test-suites" element={
          <ProjectGuard>
            <FeatureGuard feature="test_suites">
              <TestSuites />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-suites/:id" element={
          <ProjectGuard>
            <TestSuiteDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases" element={
          <ProjectGuard>
            <FeatureGuard feature="test_cases">
              <TestCases />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases/:id" element={
          <ProjectGuard>
            <TestCaseDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases/:id/edit" element={
          <ProjectGuard>
            <TestCaseEdit />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases/:id/revisions" element={
          <ProjectGuard>
            <TestCaseRevisions />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases/:id/execution-history" element={
          <ProjectGuard>
            <TestCaseExecutionHistory />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases/:id/execute" element={
          <ProjectGuard>
            <TestCaseExecute />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-runs" element={
          <ProjectGuard>
            <FeatureGuard feature="test_runs">
              <TestRuns />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-runs/:id" element={
          <ProjectGuard>
            <TestRunDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-runs/:testRunId/report" element={
          <ProjectGuard>
            <TestRunReport />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-runs/:testRunId/test-cases/:testCaseId" element={
          <ProjectGuard>
            <TestCaseExecution />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/matrix-runs" element={
          <ProjectGuard>
            <FeatureGuard feature="test_runs">
              <MatrixRuns />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/matrix-runs/:matrixRunId" element={
          <ProjectGuard>
            <FeatureGuard feature="test_runs">
              <MatrixRunDetail />
            </FeatureGuard>
          </ProjectGuard>
        } />
        {/* Sections were folded into TestSuiteDetail (?section=<id>); keep these
            redirects so existing links keep working. */}
        <Route
          path="/projects/:projectId/sections"
          element={<RedirectToTestSuites />}
        />
        <Route path="/projects/:projectId/sections/:sectionId" element={
          <ProjectGuard>
            <SectionRedirect />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/requirements" element={
          <ProjectGuard>
            <FeatureGuard feature="requirements">
              <Requirements />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/ask" element={
          <ProjectGuard>
            <FeatureGuard feature="ask_ai">
              <AskProject />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/requirements/:requirementId" element={
          <ProjectGuard>
            <RequirementDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/docs" element={
          <ProjectGuard>
            <FeatureGuard feature="doc_hub">
              <DocHub />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/docs/release-notes" element={
          <ProjectGuard>
            <FeatureGuard feature="doc_hub">
              <ReleaseNotes />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/docs/:docId" element={
          <ProjectGuard>
            <DocDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/docs/:docId/revisions" element={
          <ProjectGuard>
            <DocDetail initialTab="revisions" />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/docs/:docId/edit" element={
          <ProjectGuard>
            <DocEditor />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/defects" element={
          <ProjectGuard>
            <FeatureGuard feature="defects">
              <Defects />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/defects/root-cause-analysis" element={
          <ProjectGuard>
            <FeatureGuard feature="defects">
              <RootCauseAnalysisPage />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/defects/:defectId" element={
          <ProjectGuard>
            <DefectDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/advanced-search" element={
          <ProjectGuard>
            <FeatureGuard feature="advanced_search">
              <AdvancedSearch />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-asset-health" element={
          <ProjectGuard>
            <FeatureGuard feature="test_asset_health">
              <TestAssetHealth />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-plans" element={
          <ProjectGuard>
            <FeatureGuard feature="test_plans">
              <TestPlans />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-plans/:testPlanId" element={
          <ProjectGuard>
            <TestPlanDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/reports" element={
          <ProjectGuard>
            <FeatureGuard feature="reports">
              <Reports />
            </FeatureGuard>
          </ProjectGuard>
        } />
        {/* Each reports section is its own URL so tabs are linkable/bookmarkable. */}
        <Route path="/projects/:projectId/reports/:section" element={
          <ProjectGuard>
            <FeatureGuard feature="reports">
              <Reports />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/milestones" element={
          <ProjectGuard>
            <FeatureGuard feature="milestones">
              <Milestones />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/milestones/:milestoneId" element={
          <ProjectGuard>
            <MilestoneDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/members" element={
          <ProjectGuard>
            <ProjectMembers />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/settings" element={
          <ProjectGuard>
            <ProjectSettings />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-management" element={
          <ProjectGuard>
            <ProjectTestManagement />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/custom-fields" element={
          <ProjectGuard>
            <FeatureGuard feature="custom_fields">
              <CustomFields />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/shared-steps" element={
          <ProjectGuard>
            <FeatureGuard feature="shared_steps">
              <SharedSteps />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/global-parameters" element={
          <ProjectGuard>
            <FeatureGuard feature="global_parameters">
              <GlobalParameters />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-data" element={
          <ProjectGuard>
            <FeatureGuard feature="test_data">
              <TestData />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/environments" element={
          <ProjectGuard>
            <FeatureGuard feature="environments">
              <Environments />
            </FeatureGuard>
          </ProjectGuard>
        } />
        
        {/* Global routes (not project-specific) */}
        <Route path="/docs" element={<DocHub />} />
        <Route path="/docs/:docId" element={<DocDetail />} />
        <Route path="/docs/:docId/revisions" element={<DocDetail initialTab="revisions" />} />
        <Route path="/docs/:docId/edit" element={<DocEditor />} />
        <Route path="/test-cases/:id" element={
          <ProjectGuard>
            <TestCaseDetail />
          </ProjectGuard>
        } />
        <Route path="/test-cases/:id/edit" element={
          <ProjectGuard>
            <TestCaseEdit />
          </ProjectGuard>
        } />
        <Route path="/test-cases/:id/revisions" element={
          <ProjectGuard>
            <TestCaseRevisions />
          </ProjectGuard>
        } />
        <Route path="/test-cases/:id/execution-history" element={
          <ProjectGuard>
            <TestCaseExecutionHistory />
          </ProjectGuard>
        } />
        <Route path="/test-cases/:id/execute" element={
          <ProjectGuard>
            <TestCaseExecute />
          </ProjectGuard>
        } />
        <Route path="/environments" element={<Navigate to="/projects" replace />} />
        <Route path="/activity-management" element={<ActivityManagement />} />
        {/* Cross-project globals were merged into the per-project page; keep the
            old URL working by redirecting it. */}
        <Route path="/global-parameters" element={<Navigate to="/projects" replace />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/administrator" element={<AdminRoute><Settings adminMode /></AdminRoute>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/api-tokens" element={<ApiTokens />} />
        <Route path="/projects/:projectId/webhooks" element={
          <ProjectGuard>
            <FeatureGuard feature="webhooks">
              <Webhooks />
            </FeatureGuard>
          </ProjectGuard>
        } />
        <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function AppRouteBoundary() {
  const { t, isRTL, language } = useTranslation();
  const location = useLocation();

  return (
    <ErrorBoundary
      description={t('appUnexpectedErrorDescription')}
      isRTL={isRTL}
      reloadLabel={t('refresh')}
      resetKey={`${language}:${location.pathname}${location.search}`}
      retryLabel={t('retry')}
      title={t('appUnexpectedErrorTitle')}
    >
      <AppWithRouter />
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppRouteBoundary />
      </Router>
    </ThemeProvider>
  );
}

export default App;
