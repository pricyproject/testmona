import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { RequirementChat } from '@/components/requirements/RequirementChat';

/** Dedicated full-page, project-wide AI assistant (multi-source scope). */
export function AskProject() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t, isRTL } = useTranslation();

  const publicId = useMemo(() => params.get('c') || undefined, [params]);

  if (!projectId) return null;

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-background shadow-sm dark:border-slate-800">
      <RequirementChat
        projectId={parseInt(projectId)}
        scopeMode="all"
        variant="page"
        active
        initialPublicId={publicId}
        headerActions={(
          <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}/requirements`)}>
            <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ms-0 me-1.5 rotate-180' : 'me-1.5'}`} />
            {t('reqChatBack')}
          </Button>
        )}
      />
    </div>
  );
}
