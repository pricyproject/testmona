import { CoverageRiskSection } from '@/components/reports/CoverageRiskSection';
import { useReportsContext } from './ReportsLayout';

export function CoverageRiskPage() {
  return <CoverageRiskSection ctx={useReportsContext()} />;
}
