import React from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Navbar } from '@/components/Navbar';
import { Toaster } from '@/components/ui/toaster';
import { PasswordChangeDialog } from '@/components/Profile/PasswordChangeDialog';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { theme, toggleTheme } = useTheme();
  const { language } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  // Collapsed by default; remember the user's choice across reloads.
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('sidebarCollapsed');
    return stored === null ? true : stored === 'true';
  });
  const [isHovering, setIsHovering] = React.useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = React.useState(false);

  const isRTL = language === 'fa' || language === 'ar';

  React.useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [isRTL, language]);

  // Global listener for password change required event
  React.useEffect(() => {
    const handlePasswordChangeRequired = () => {
      console.log('Password change required event received - showing dialog');
      setShowPasswordDialog(true);
    };

    window.addEventListener('passwordChangeRequired', handlePasswordChangeRequired);

    return () => {
      window.removeEventListener('passwordChangeRequired', handlePasswordChangeRequired);
    };
  }, []);

  const handlePasswordChange = async (oldPassword: string, newPassword: string) => {
    try {
      await api.post('/users/me/change-password', {
        old_password: oldPassword,
        new_password: newPassword
      });
      setShowPasswordDialog(false);
      // Reset the flag so dialog can show again if needed in future
      (api as any)._passwordChangeDialogShown = false;
      // Refresh the page or redirect to ensure fresh state
      window.location.reload();
    } catch (error) {
      console.error('Password change failed:', error);
      throw error;
    }
  };

  const handleMobileMenuToggle = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleSidebarToggle = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  };

  return (
    <div className={`h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 transition-colors duration-200 flex print:block print:h-auto print:overflow-visible print:bg-white ${isRTL ? 'font-vazir' : ''}`}>
      {/* Sidebar */}
      <div className="print:hidden">
        <Sidebar
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleSidebarToggle}
          isHovering={isHovering}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 print:block">
        {/* Navbar */}
        <div className="print:hidden">
          <Navbar
            onMobileMenuToggle={handleMobileMenuToggle}
            isSidebarCollapsed={sidebarCollapsed}
            onSidebarToggle={handleSidebarToggle}
            theme={theme}
            onThemeToggle={toggleTheme}
          />
        </div>

        {/* Page content — `min-h-0` lets this flex child shrink so its own
            overflow scrolls (instead of growing the page), which is what makes
            `position: sticky` work for descendants. */}
        <main className="flex-1 min-h-0 p-6 overflow-auto print:p-0 print:overflow-visible">
          {children}
        </main>
      </div>
      
      {/* Toast notifications */}
      <Toaster />

      {/* Global Password Change Dialog */}
      {showPasswordDialog && (
        <>
          {console.log('Rendering PasswordChangeDialog, showPasswordDialog:', showPasswordDialog)}
          <PasswordChangeDialog
            isOpen={showPasswordDialog}
            onClose={() => setShowPasswordDialog(false)}
            onSubmit={handlePasswordChange}
          />
        </>
      )}
    </div>
  );
}
