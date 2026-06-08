import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppName } from '@/hooks/useAppName';
import { resolveSafeRedirect } from '@/utils/safeRedirect';

const normalizeTwoFactorInput = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

export function Login() {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const twoFactorInputRef = useRef<HTMLInputElement | null>(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuthStore();
  const { t, isRTL } = useTranslation();
  const { appName, appLogoUrl } = useAppName(false);

  useEffect(() => {
    checkSignupEnabled();
  }, []);

  useEffect(() => {
    if (requiresTwoFactor) {
      window.setTimeout(() => twoFactorInputRef.current?.focus(), 0);
    }
  }, [requiresTwoFactor]);

  const checkSignupEnabled = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/system/settings/public/signup_enabled`);
      if (response.ok) {
        const setting = await response.json();
        setSignupEnabled(setting.value === 'true');
      } else {
        setSignupEnabled(true);
      }
    } catch (error) {
      setSignupEnabled(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const loginResult = await login(usernameOrEmail, password, requiresTwoFactor ? twoFactorCode : undefined);
      if (loginResult === 'requires_2fa') {
        setRequiresTwoFactor(true);
        setTwoFactorCode('');
        return;
      }
      const forcePasswordChange = Boolean(loginResult);
      if (forcePasswordChange) {
        navigate('/change-password');
      } else {
        navigate(resolveSafeRedirect(searchParams.get('next')) || '/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
      if (requiresTwoFactor) {
        setTwoFactorCode('');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToCredentials = () => {
    setRequiresTwoFactor(false);
    setTwoFactorCode('');
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          {appLogoUrl && (
            <img src={appLogoUrl} alt={appName} className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-xs" />
          )}
          <h1 className="text-3xl font-bold text-foreground">{appName}</h1>
          <p className="mt-2 text-muted-foreground">{t('signInToAccount')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">{requiresTwoFactor ? t('twoFactorChallengeTitle') : t('welcomeBack')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                {!requiresTwoFactor ? (
                  <>
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
                        autoComplete="username"
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
                          autoComplete="current-password"
                          className={isRTL ? 'pl-10' : 'pr-10'}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={`absolute top-0 h-full px-3 py-2 hover:bg-transparent ${isRTL ? 'left-0' : 'right-0'}`}
                          onClick={() => setShowPassword(!showPassword)}
                          disabled={isLoading}
                          aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 rounded-lg border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-primary/10 p-2 text-primary">
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{t('twoFactorChallengeSubtitle')}</p>
                        <p className="truncate text-sm text-muted-foreground">{t('signingInAs', { value: usernameOrEmail })}</p>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="two-factor-code">{t('twoFactorCode')}</Label>
                      <Input
                        ref={twoFactorInputRef}
                        id="two-factor-code"
                        type="text"
                        inputMode="text"
                        autoComplete="one-time-code"
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(normalizeTwoFactorInput(e.target.value))}
                        placeholder={t('enterTwoFactorOrRecoveryCode')}
                        required
                        disabled={isLoading}
                        className="text-center tracking-[0.2em]"
                        dir="ltr"
                      />
                      <p className="mt-1 text-sm text-muted-foreground">{t('twoFactorLoginRequired')}</p>
                    </div>

                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleBackToCredentials} disabled={isLoading}>
                      <ArrowLeft className={`h-4 w-4 ${isRTL ? 'ml-2 rotate-180' : 'mr-2'}`} />
                      {t('changeLoginDetails')}
                    </Button>
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <div className="flex items-center">
                    <div className={`h-4 w-4 animate-spin rounded-full border-2 border-current border-b-transparent ${isRTL ? 'ml-2' : 'mr-2'}`}></div>
                    {requiresTwoFactor ? t('verifying') : t('signingIn')}
                  </div>
                ) : (
                  <div className="flex items-center">
                    {requiresTwoFactor ? <ShieldCheck className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> : <LogIn className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />}
                    {requiresTwoFactor ? t('verifyCode') : t('signIn')}
                  </div>
                )}
              </Button>
            </form>

            {!requiresTwoFactor && (
              <div className="mt-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {t('dontHaveAccount')}{' '}
                  {signupEnabled ? (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => navigate('/signup')}
                    >
                      {t('signUp')}
                    </button>
                  ) : (
                    <span className="text-muted-foreground/70">{t('registrationDisabled')}</span>
                  )}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
