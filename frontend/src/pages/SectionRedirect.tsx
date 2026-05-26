import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { sectionsAPI } from '@/lib/api';

/**
 * Preserves the old /projects/:projectId/sections/:sectionId deep link by
 * resolving the section's owning test suite and forwarding to the suite-scoped
 * URL with ?section=<id>.
 */
export function SectionRedirect() {
  const { projectId, sectionId } = useParams<{ projectId: string; sectionId: string }>();
  const [target, setTarget] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const numericSectionId = Number(sectionId);
    if (!Number.isInteger(numericSectionId) || numericSectionId <= 0) {
      setErrored(true);
      return;
    }
    let cancelled = false;
    sectionsAPI
      .getSectionDetails(numericSectionId)
      .then((data) => {
        if (cancelled) return;
        const suiteId = data?.test_suite?.id;
        if (suiteId && projectId) {
          setTarget(
            `/projects/${projectId}/test-suites/${suiteId}?section=${numericSectionId}`,
          );
        } else {
          setErrored(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sectionId]);

  if (errored) {
    return <Navigate to={`/projects/${projectId || ''}/test-suites`} replace />;
  }
  if (target) {
    return <Navigate to={target} replace />;
  }
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
    </div>
  );
}
