import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, ArrowRight, FolderOpen } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isFeatureEnabled, type ProjectFeatureKey } from '@/lib/projectFeatures';

interface FeatureGuardProps {
  feature: ProjectFeatureKey;
  children: React.ReactNode;
}

/**
 * Blocks a project-scoped page when its feature module is disabled for the
 * project. Render inside ProjectGuard, which already validates the project.
 *
 * While project data is still loading we default to enabled to avoid flashing
 * the blocked screen; once the project (with its `features` map) is in the
 * store the guard re-evaluates.
 */
export function FeatureGuard({ feature, children }: FeatureGuardProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, selectedProject } = useProjectStore();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const project = useMemo(() => {
    const numericId = projectId ? Number(projectId) : null;
    if (numericId != null) {
      const found = projects.find((p) => p.id === numericId);
      if (found) return found;
    }
    return selectedProject;
  }, [projectId, projects, selectedProject]);

  if (isFeatureEnabled(project?.features, feature)) {
    return <>{children}</>;
  }

  const overviewHref = projectId ? `/projects/${projectId}/settings` : '/projects';

  return (
    <div className="flex min-h-[40vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <Ban className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              {t('featureDisabledTitle')}
            </h2>
            <p className="mb-6 text-gray-600 dark:text-gray-300">
              {t('featureDisabledDesc')}
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate(overviewHref)} className="w-full">
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('projectSettings')}
                <ArrowRight className="ml-2 h-4 w-4 rtl:rotate-180" />
              </Button>
              <Button variant="ghost" onClick={() => navigate('/dashboard')} className="w-full">
                {t('overview')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
