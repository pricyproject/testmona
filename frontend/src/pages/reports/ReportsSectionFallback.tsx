import { Navigate, useParams } from 'react-router-dom';

// Unknown reports section slug → canonical default (overview). Keeps deep-links
// to retired/typo'd sections from rendering a blank page under the layout.
export function ReportsSectionFallback() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}/reports`} replace />;
}
