import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import { useAppName } from '@/hooks/useAppName';
import { authAPI, getApiErrorMessage } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';

interface SignupFormValues {
  username: string;
  email: string;
  fullName: string;
  password: string;
  confirmPassword: string;
}

export function Signup() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { appName, appLogoUrl } = useAppName(false);
  const { t, isRTL } = useTranslation();

  const { register, handleSubmit, formState } = useForm<SignupFormValues>({
    defaultValues: { username: '', email: '', fullName: '', password: '', confirmPassword: '' },
  });
  const isLoading = formState.isSubmitting;

  const navigate = useNavigate();

  const onSubmit = async (values: SignupFormValues) => {
    setError('');
    const username = values.username.trim();
    const email = values.email.trim();
    const fullName = values.fullName.trim();
    const { password, confirmPassword } = values;

    if (!username || !email || !password || !confirmPassword) {
      setError(t('allFieldsRequired'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    if (password.length < 6) {
      setError(t('passwordMinLength', { min: 6 }));
      return;
    }

    try {
      await authAPI.signup(username, email, fullName, password);
      navigate('/login?registered=true');
    } catch (err) {
      setError(getApiErrorMessage(err, t('registrationFailed')));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          {appLogoUrl && (
            <img src={appLogoUrl} alt={appName} className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-xs" />
          )}
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{appName}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{t('createYourAccount')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">{t('signUp')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div>
                <Label htmlFor="username">{t('username')}</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder={t('enterUsername')}
                  disabled={isLoading}
                  className="mt-1"
                  {...register('username')}
                />
              </div>

              <div>
                <Label htmlFor="fullName">{t('fullName')}</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder={t('enterFullName')}
                  disabled={isLoading}
                  className="mt-1"
                  {...register('fullName')}
                />
              </div>

              <div>
                <Label htmlFor="email">{t('email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('enterEmail')}
                  disabled={isLoading}
                  className="mt-1"
                  {...register('email')}
                />
              </div>

              <div>
                <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
                <div className="mt-1 relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('enterPassword')}
                    disabled={isLoading}
                    className={isRTL ? 'pl-10' : 'pr-10'}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRTL ? 'left-3' : 'right-3'}`}
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
                <div className="mt-1 relative">
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('confirmPassword')}
                    disabled={isLoading}
                    className={isRTL ? 'pl-10' : 'pr-10'}
                    {...register('confirmPassword')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRTL ? 'left-3' : 'right-3'}`}
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? t('creatingAccount') : t('signUp')}
                <UserPlus className={`${isRTL ? 'mr-2' : 'ml-2'} h-4 w-4`} />
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('alreadyHaveAccount')}{' '}
                <button
                  type="button"
                  className="font-medium text-blue-600 hover:text-blue-500"
                  onClick={() => navigate('/login')}
                >
                  {t('signIn')}
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
