import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProjectGuard } from '@/components/ProjectGuard';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { Requirements } from '@/pages/Requirements';
import { TestSuites } from '@/pages/TestSuites';
import { TestSuiteDetail } from '@/pages/TestSuiteDetail';
import { TestCases } from '@/pages/TestCases';
import { TestCaseDetail } from '@/pages/TestCaseDetail';
import { TestCaseEdit } from '@/pages/TestCaseEdit';
import { TestCaseRevisions } from '@/pages/TestCaseRevisions';
import { TestCaseExecutionHistory } from '@/pages/TestCaseExecutionHistory';
import { TestCaseExecute } from '@/pages/TestCaseExecute';
import { TestCaseExecution } from '@/pages/TestCaseExecution';
import { SectionManagement } from '@/pages/SectionManagement';
import { Environments } from '@/pages/Environments';
import { TestPlans } from '@/pages/TestPlans';
import { TestRuns } from '@/pages/TestRuns';
import { TestRunDetail } from '@/pages/TestRunDetail';
import { TestRunReport } from '@/pages/TestRunReport';
import { Defects } from '@/pages/Defects';
import { Reports } from '@/pages/Reports';
import { Milestones } from '@/pages/Milestones';
import { CustomFields } from '@/pages/CustomFields';
import { SharedSteps } from '@/pages/SharedSteps';
import { GlobalParameters } from '@/pages/GlobalParameters';
import { ActivityManagement } from '@/pages/ActivityManagement';
import { Settings } from '@/pages/Settings';
import { Profile } from '@/pages/Profile';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuthStore, initializeAuthFromLocalStorage } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';
import { useEffect, useState } from 'react';

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  
  return (
    <Layout>
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
