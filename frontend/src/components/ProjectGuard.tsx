import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FolderOpen, ArrowRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';
import { getApiErrorMessage, projectsAPI } from '@/lib/api';

interface ProjectGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ProjectGuard({ children, fallback }: ProjectGuardProps) {
  const navigate = useNavigate();
  const { projects } = useProjectStore();
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();
  const { appName } = useAppName(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [checkingProject, setCheckingProject] = useState(false);
  const numericProjectId = useMemo(() => {
    if (!projectId) return null;
    const parsed = Number(projectId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [projectId]);

  // Check if there are any projects in the database
  const hasProjects = projects && projects.length > 0;
  const isProjectsLoaded = projects !== undefined;

  useEffect(() => {
    // Only redirect if projects are loaded and none exist
    if (isProjectsLoaded && !hasProjects && !projectId) {
      navigate('/projects');
    }
  }, [hasProjects, isProjectsLoaded, navigate, projectId]);

  useEffect(() => {
    if (!projectId) return;
    if (numericProjectId == null) {
      setProjectError(t('invalidProjectId'));
      return;
    }
    if (projects.some((project) => project.id === numericProjectId)) {
      setProjectError(null);
      return;
    }
    setCheckingProject(true);
    setProjectError(null);
    projectsAPI.getById(numericProjectId)
      .then(() => setProjectError(null))
      .catch((err) => setProjectError(getApiErrorMessage(err, t('projectGuardProjectUnavailable'))))
      .finally(() => setCheckingProject(false));
  }, [projectId, numericProjectId, projects, t]);

  if (checkingProject) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  if (projectError) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-8 w-8 text-amber-600" />
              </div>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">{t('projectGuardProjectUnavailableTitle')}</h2>
              <p className="mb-6 text-gray-600">{projectError}</p>
              <Button onClick={() => navigate('/projects')} className="w-full">
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('goToProjects')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasProjects && !projectId) {
    return fallback || (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <FolderOpen className="h-8 w-8 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                No Projects Found
              </h2>
              <p className="text-gray-600 mb-6 leading-relaxed">
                {t('projectGuardNoProjectsDesc', { appName })}
              </p>
              <Button 
                onClick={() => navigate('/projects')}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Go to Projects
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
