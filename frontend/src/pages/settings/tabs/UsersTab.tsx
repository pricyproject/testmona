import { Users } from 'lucide-react';
import { UserManagement } from '@/components/UserManagement';
import { useTranslation } from '@/hooks/useTranslation';
import { SettingsSection } from '../components/SettingsPrimitives';

export function UsersTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SettingsSection icon={Users} tone="violet" title={t('userManagement')}>
        <UserManagement />
      </SettingsSection>
    </div>
  );
}

export default UsersTab;
