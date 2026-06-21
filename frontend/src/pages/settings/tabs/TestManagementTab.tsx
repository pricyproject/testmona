// Test Management tab — the surface rendered at /projects/:id/test-management
// and inside the full Settings page. Composes the redesigned, self-contained
// sections over a single data hook. Extracted from the former monolithic
// SettingsPage.tsx.
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { useTestManagementData } from '../hooks/useTestManagementData';
import { TestTypesSection } from '../sections/TestTypesSection';
import { PrioritiesSection } from '../sections/PrioritiesSection';
import { TagsSection } from '../sections/TagsSection';
import { SharedStepsSection } from '../sections/SharedStepsSection';
import { TestSettingsSection } from '../sections/TestSettingsSection';

export function TestManagementTab({ projectId }: { projectId?: number }) {
  const { t } = useTranslation();
  const { canManageProject } = useProjectPermissions(projectId ?? null);
  const data = useTestManagementData(projectId);

  return (
    <div className="space-y-6 pb-24">
      <TestTypesSection data={data} canManage={canManageProject} />
      <PrioritiesSection data={data} canManage={canManageProject} />
      <TagsSection projectId={projectId} canManage={canManageProject} />
      <SharedStepsSection data={data} />
      <TestSettingsSection data={data} />

      {/* Sticky save bar for the batch-saved execution/notification/automation settings. */}
      <div className="sticky bottom-0 z-10 -mx-1 flex justify-end border-t border-border/60 bg-background/80 px-1 py-3 backdrop-blur">
        <Button onClick={data.saveSettings} disabled={data.savingSettings}>
          {data.savingSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin rtl:ml-2 rtl:mr-0" />}
          {data.savingSettings ? t('saving') : t('saveTestManagementSettings')}
        </Button>
      </div>
    </div>
  );
}

export default TestManagementTab;
