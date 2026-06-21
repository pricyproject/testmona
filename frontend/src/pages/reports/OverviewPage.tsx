import { OverviewSection } from '@/components/reports/OverviewSection';
import { useReportsContext } from './ReportsLayout';

export function OverviewPage() {
  return <OverviewSection ctx={useReportsContext()} />;
}
