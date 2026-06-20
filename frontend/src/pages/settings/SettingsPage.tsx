// Settings shell. Owns only tab gating + URL sync; every panel is its own
// self-contained module under ./tabs (and ./sections / ./hooks). Powers three
// surfaces:
//   - /administrator            → adminMode (general, integrations, users, audit)
//   - /settings                 → per-user (general, ai-manager)
//   - /projects/:id/test-management → singleTab="test-management"
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, FileText, BrainCircuit, Link, Users, History } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isAdminUser } from '@/utils/roles';
import { GeneralTab } from './tabs/GeneralTab';
import { TestManagementTab } from './tabs/TestManagementTab';
import { IntegrationsTab } from './tabs/IntegrationsTab';
import { UsersTab } from './tabs/UsersTab';
import { AuditTab } from './tabs/AuditTab';
import { AIManagerTab } from './tabs/AIManagerTab';

const TAB_TRIGGER_CLASS =
  'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs';

export function Settings({ adminMode = false, projectId, singleTab }: { adminMode?: boolean; projectId?: number; singleTab?: string } = {}) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();

  // Constrain the active tab to the current surface so a stale ?tab= deep link
  // can't render a hidden panel. Test types/priorities/step templates are
  // per-project (singleTab='test-management'); cross-project admin settings live
  // under /administrator; per-user preferences + AI manager stay on /settings.
  const allowedTabs = singleTab
    ? [singleTab]
    : adminMode
    ? ['general', 'integrations', 'users', 'audit']
    : ['general', 'ai-manager'];
  const rawTab = singleTab || searchParams.get('tab') || 'general';
  const activeTab = allowedTabs.includes(rawTab) ? rawTab : allowedTabs[0];

  const handleTabChange = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === 'general') next.delete('tab');
      else next.set('tab', value);
      return next;
    }, { replace: true });
  };

  const admin = isAdminUser(user);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('manageSettings')}</h1>
          <p className="text-muted-foreground">{t('manageSettings')}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="inline-flex h-12 w-full items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
          {!singleTab && (
            <TabsTrigger value="general" className={TAB_TRIGGER_CLASS}>
              <Globe className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />
              {t('general')}
            </TabsTrigger>
          )}
          {singleTab === 'test-management' && (
            <TabsTrigger value="test-management" className={TAB_TRIGGER_CLASS}>
              <FileText className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />
              {t('testManagement')}
            </TabsTrigger>
          )}
          {!singleTab && !adminMode && admin && (
            <TabsTrigger value="ai-manager" className={TAB_TRIGGER_CLASS}>
              <BrainCircuit className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />
              {t('aiManager')}
            </TabsTrigger>
          )}
          {adminMode && (
            <TabsTrigger value="integrations" className={TAB_TRIGGER_CLASS}>
              <Link className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />
              {t('integrations')}
            </TabsTrigger>
          )}
          {adminMode && admin && (
            <TabsTrigger value="users" className={TAB_TRIGGER_CLASS}>
              <Users className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />
              {t('users')}
            </TabsTrigger>
          )}
          {adminMode && admin && (
            <TabsTrigger value="audit" className={TAB_TRIGGER_CLASS}>
              <History className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />
              {t('auditTrails')}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralTab />
        </TabsContent>

        <TabsContent value="test-management" className="space-y-6">
          <TestManagementTab projectId={projectId} />
        </TabsContent>

        {admin && (
          <TabsContent value="ai-manager" className="space-y-6">
            <AIManagerTab />
          </TabsContent>
        )}

        <TabsContent value="integrations" className="space-y-6">
          <IntegrationsTab projectId={projectId} />
        </TabsContent>

        {admin && (
          <TabsContent value="users" className="space-y-6">
            <UsersTab />
          </TabsContent>
        )}

        <TabsContent value="audit" className="space-y-6">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
