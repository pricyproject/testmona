import { ActivitySection } from '@/components/reports/ActivitySection';
import { useReportsContext } from './ReportsLayout';

export function ActivityPage() {
  return <ActivitySection ctx={useReportsContext()} />;
}
