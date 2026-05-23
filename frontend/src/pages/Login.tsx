import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';

export function Login() {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const [showDemoCredentials, setShowDemoCredentials] = useState(true);
  
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { t, isRTL } = useTranslation();
  const { appName, appLogoUrl } = useAppName(false);
  
  // Check if signup is enabled and demo credentials status
  useEffect(() => {
    checkSignupEnabled();
    checkDemoCredentialsStatus();
  }, []);
  
  const checkSignupEnabled = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/system/settings/public/signup_enabled`);
      if (response.ok) {
        const setting = await response.json();
        setSignupEnabled(setting.value === 'true');
      } else {
        // Default to enabled if request fails
        setSignupEnabled(true);
      }
    } catch (error) {
      // Default to enabled if setting doesn't exist or request fails
      setSignupEnabled(true);
    }
  };

  const checkDemoCredentialsStatus = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/system/settings/public/demo-credentials-status`);
      if (response.ok) {
        const status = await response.json();
        setShowDemoCredentials(status.show_demo_credentials);
      } else {
        // Default to showing demo credentials if request fails
        setShowDemoCredentials(true);
      }
    } catch (error) {
      // Default to showing demo credentials if request fails
      setShowDemoCredentials(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const forcePasswordChange = await login(usernameOrEmail, password);
      if (forcePasswordChange) {
        navigate('/change-password');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          {appLogoUrl && (
            <img src={appLogoUrl} alt={appName} className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-xs" />
          )}
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{appName}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{t('signInToAccount')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">{t('welcomeBack')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div>
                  <Label htmlFor="username-or-email">{t('emailOrUsername')}</Label>
                  <Input
                    id="username-or-email"
                    type="text"
                    value={usernameOrEmail}
                    onChange={(e) => setUsernameOrEmail(e.target.value)}
                    placeholder={t('enterEmailOrUsername')}
                    required
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('enterPassword')}
                      required
                      disabled={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`absolute top-0 h-full px-3 py-2 hover:bg-transparent ${isRTL ? 'left-0' : 'right-0'}`}
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center">
                    <div className={`animate-spin rounded-full h-4 w-4 border-b-2 border-white ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                    {t('signingIn')}
                  </div>
                ) : (
                  <div className="flex items-center">
                    <LogIn className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                    {t('signIn')}
                  </div>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('dontHaveAccount')}{' '}
                {signupEnabled ? (
                  <button
                    type="button"
                    className="font-medium text-blue-600 hover:text-blue-500"
                    onClick={() => navigate('/signup')}
                  >
                    {t('signUp')}
                  </button>
                ) : (
                  <span className="text-gray-400">{t('registrationDisabled')}</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {showDemoCredentials && (
          <div className="rounded-lg border border-gray-200 bg-white/80 px-4 py-3 text-center text-sm text-gray-600 shadow-xs backdrop-blur-xs dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300">
            <p className="font-medium text-gray-800 dark:text-gray-100">{t('demoCredentials')}</p>
            <p className="mt-1">{t('emailLabelValue', { value: 'demo@testmona.com' })}</p>
            <p>{t('passwordLabelValue', { value: 'demo123' })}</p>
          </div>
        )}
      </div>
    </div>
  );
}
