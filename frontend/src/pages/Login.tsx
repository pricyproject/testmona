import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
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

interface LoginFormValues {
  usernameOrEmail: string;
  password: string;
  twoFactorCode: string;
}

export function Login() {
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [signupEnabled, setSignupEnabled] = useState(true);

  const { register, handleSubmit, setValue, setFocus, watch, formState } = useForm<LoginFormValues>({
    defaultValues: { usernameOrEmail: '', password: '', twoFactorCode: '' },
  });
  const isLoading = formState.isSubmitting;
  const usernameOrEmail = watch('usernameOrEmail');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuthStore();
  const { t, isRTL } = useTranslation();
  const { appName, appLogoUrl } = useAppName(false);

  // Normalise the 2FA code as the user types (uppercase, alphanumeric, max 16).
  const twoFactorField = register('twoFactorCode', { required: requiresTwoFactor });

  useEffect(() => {
    checkSignupEnabled();
  }, []);

  useEffect(() => {
    if (requiresTwoFactor) {
      window.setTimeout(() => setFocus('twoFactorCode'), 0);
    }
  }, [requiresTwoFactor, setFocus]);

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

  const onSubmit = async (values: LoginFormValues) => {
    setError('');
    try {
      const loginResult = await login(
        values.usernameOrEmail,
        values.password,
        requiresTwoFactor ? values.twoFactorCode : undefined,
      );
      if (loginResult === 'requires_2fa') {
        setRequiresTwoFactor(true);
        setValue('twoFactorCode', '');
        return;
      }
      navigate(resolveSafeRedirect(searchParams.get('next')) || '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
      if (requiresTwoFactor) {
        setValue('twoFactorCode', '');
      }
    }
  };

  const handleBackToCredentials = () => {
    setRequiresTwoFactor(false);
    setValue('twoFactorCode', '');
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
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
                        placeholder={t('enterEmailOrUsername')}
                        disabled={isLoading}
                        autoComplete="username"
                        {...register('usernameOrEmail', { required: true })}
                      />
                    </div>

                    <div>
                      <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder={t('enterPassword')}
                          disabled={isLoading}
                          autoComplete="current-password"
                          className={isRTL ? 'pl-10' : 'pr-10'}
                          {...register('password', { required: true })}
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
                        id="two-factor-code"
                        type="text"
                        inputMode="text"
                        autoComplete="one-time-code"
                        placeholder={t('enterTwoFactorOrRecoveryCode')}
                        disabled={isLoading}
                        className="text-center tracking-[0.2em]"
                        dir="ltr"
                        {...twoFactorField}
                        onChange={(e) => {
                          e.target.value = normalizeTwoFactorInput(e.target.value);
                          twoFactorField.onChange(e);
                        }}
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
