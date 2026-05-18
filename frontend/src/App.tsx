import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProjectGuard } from '@/components/ProjectGuard';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuthStore, initializeAuthFromLocalStorage } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';
import { lazy, Suspense, useEffect, useState } from 'react';

const lazyPage = (loader: () => Promise<any>, exportName: string) =>
  lazy(() => loader().then((module) => ({ default: module[exportName] })));

const Login = lazyPage(() => import('@/pages/Login'), 'Login');
const Signup = lazyPage(() => import('@/pages/Signup'), 'Signup');
const Dashboard = lazyPage(() => import('@/pages/Dashboard'), 'Dashboard');
const Projects = lazyPage(() => import('@/pages/Projects'), 'Projects');
const Requirements = lazyPage(() => import('@/pages/Requirements'), 'Requirements');
const TestSuites = lazyPage(() => import('@/pages/TestSuites'), 'TestSuites');
const TestSuiteDetail = lazyPage(() => import('@/pages/TestSuiteDetail'), 'TestSuiteDetail');
const TestCases = lazyPage(() => import('@/pages/TestCases'), 'TestCases');
const TestCaseDetail = lazyPage(() => import('@/pages/TestCaseDetail'), 'TestCaseDetail');
const TestCaseEdit = lazyPage(() => import('@/pages/TestCaseEdit'), 'TestCaseEdit');
const TestCaseRevisions = lazyPage(() => import('@/pages/TestCaseRevisions'), 'TestCaseRevisions');
const TestCaseExecutionHistory = lazyPage(() => import('@/pages/TestCaseExecutionHistory'), 'TestCaseExecutionHistory');
const TestCaseExecute = lazyPage(() => import('@/pages/TestCaseExecute'), 'TestCaseExecute');
const TestCaseExecution = lazyPage(() => import('@/pages/TestCaseExecution'), 'TestCaseExecution');
const SectionManagement = lazyPage(() => import('@/pages/SectionManagement'), 'SectionManagement');
const Environments = lazyPage(() => import('@/pages/Environments'), 'Environments');
const TestPlans = lazyPage(() => import('@/pages/TestPlans'), 'TestPlans');
const TestRuns = lazyPage(() => import('@/pages/TestRuns'), 'TestRuns');
const TestRunDetail = lazyPage(() => import('@/pages/TestRunDetail'), 'TestRunDetail');
const TestRunReport = lazyPage(() => import('@/pages/TestRunReport'), 'TestRunReport');
const Defects = lazyPage(() => import('@/pages/Defects'), 'Defects');
const Reports = lazyPage(() => import('@/pages/Reports'), 'Reports');
const Milestones = lazyPage(() => import('@/pages/Milestones'), 'Milestones');
const CustomFields = lazyPage(() => import('@/pages/CustomFields'), 'CustomFields');
const SharedSteps = lazyPage(() => import('@/pages/SharedSteps'), 'SharedSteps');
const GlobalParameters = lazyPage(() => import('@/pages/GlobalParameters'), 'GlobalParameters');
const ActivityManagement = lazyPage(() => import('@/pages/ActivityManagement'), 'ActivityManagement');
const Settings = lazyPage(() => import('@/pages/Settings'), 'Settings');
const Profile = lazyPage(() => import('@/pages/Profile'), 'Profile');

function PageFallback() {
  return (
    <div className="min-h-[40vh] bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}

function AppWithRouter() {
  const { isAuthenticated, initializeDevAuth, compactMode } = useAuthStore();
  const { isRTL, language } = useTranslation();
  const { appName, appLogoUrl } = useAppName();
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Initialize localStorage sync immediately on component mount
  useEffect(() => {
    initializeAuthFromLocalStorage().then(() => {
      setIsInitialized(true);
    });
  }, []);
  
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
  
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }
  
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/login" element={<Navigate to="/projects" replace />} />
        <Route path="/signup" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/dashboard" element={<Dashboard />} />
        
        {/* Project-scoped routes */}
        <Route path="/projects/:projectId/test-suites" element={
          <ProjectGuard>
            <TestSuites />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-suites/:id" element={
          <ProjectGuard>
            <TestSuiteDetail />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-cases" element={
          <ProjectGuard>
            <TestCases />
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
            <TestRuns />
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
        <Route path="/projects/:projectId/sections" element={
          <ProjectGuard>
            <SectionManagement />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/sections/:sectionId" element={
          <ProjectGuard>
            <SectionManagement />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/requirements" element={
          <ProjectGuard>
            <Requirements />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/defects" element={
          <ProjectGuard>
            <Defects />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/test-plans" element={
          <ProjectGuard>
            <TestPlans />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/reports" element={
          <ProjectGuard>
            <Reports />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/milestones" element={
          <ProjectGuard>
            <Milestones />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/custom-fields" element={
          <ProjectGuard>
            <CustomFields />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/shared-steps" element={
          <ProjectGuard>
            <SharedSteps />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/global-parameters" element={
          <ProjectGuard>
            <GlobalParameters />
          </ProjectGuard>
        } />
        <Route path="/projects/:projectId/environments" element={
          <ProjectGuard>
            <Environments />
          </ProjectGuard>
        } />
        
        {/* Global routes (not project-specific) */}
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
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppWithRouter />
      </Router>
    </ThemeProvider>
  );
}

export default App;
