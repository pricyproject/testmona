import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, UserPlus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppName } from '@/hooks/useAppName';
import { useTranslation } from '@/hooks/useTranslation';
import { getApiErrorMessage } from '@/lib/api';
import { useInvitation, useAcceptInvitation } from '@/hooks/queries/invitations';

interface AcceptInviteFormValues {
  username: string;
  fullName: string;
  password: string;
  confirmPassword: string;
}

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { appName, appLogoUrl } = useAppName(false);
  const { t, isRTL } = useTranslation();

  const { data: invitation, isLoading, error: loadError } = useInvitation(token);
  const acceptInvitation = useAcceptInvitation(token);
  const isSubmitting = acceptInvitation.isPending;

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  const { register, handleSubmit } = useForm<AcceptInviteFormValues>({
    defaultValues: { username: '', fullName: '', password: '', confirmPassword: '' },
  });

  // Load-time error (bad/expired token or fetch failure) is surfaced separately
  // from form-submit errors.
  const loadErrorMessage = !token
    ? t('invalidInvitationLink')
    : loadError
      ? getApiErrorMessage(loadError, t('failedToLoadInvitation'))
      : '';

  const onSubmit = async (values: AcceptInviteFormValues) => {
    setError('');

    if (!token) {
      setError(t('invalidInvitationLink'));
      return;
    }

    const username = values.username.trim();
    if (!username || !values.password || !values.confirmPassword) {
      setError(t('allFieldsRequired'));
      return;
    }

    if (values.password !== values.confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    if (values.password.length < 6) {
      setError(t('passwordMinLength', { min: 6 }));
      return;
    }

    try {
      await acceptInvitation.mutateAsync({
        token,
        username,
        password: values.password,
        full_name: values.fullName.trim() || undefined,
      });
      setAccepted(true);
    } catch (err) {
      setError(getApiErrorMessage(err, t('failedToAcceptInvitation')));
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex min-h-48 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      );
    }

    if (accepted) {
      return (
        <div className="space-y-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('invitationAccepted')}</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('invitationAcceptedDescription')}</p>
          </div>
          <Button className="w-full" onClick={() => navigate('/login')}>
            {t('signIn')}
          </Button>
        </div>
      );
    }

    if (!invitation) {
      return (
        <div className="space-y-6 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-600" />
          <Alert variant="destructive">
            <AlertDescription>{loadErrorMessage || t('failedToLoadInvitation')}</AlertDescription>
          </Alert>
          <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
            {t('backToSignIn')}
          </Button>
        </div>
      );
    }

    return (
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="font-medium text-gray-900 dark:text-gray-100">{t('invitedEmail')}</p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">{invitation.email}</p>
        </div>

        <div>
          <Label htmlFor="username">{t('username')}</Label>
          <Input
            id="username"
            type="text"
            placeholder={t('enterUsername')}
            disabled={isSubmitting}
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
            disabled={isSubmitting}
            className="mt-1"
            {...register('fullName')}
          />
        </div>

        <div>
          <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
          <div className="relative mt-1">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder={t('enterPassword')}
              disabled={isSubmitting}
              className={isRTL ? 'pl-10' : 'pr-10'}
              {...register('password')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`absolute top-0 h-full px-3 py-2 hover:bg-transparent ${isRTL ? 'left-0' : 'right-0'}`}
              onClick={() => setShowPassword(!showPassword)}
              disabled={isSubmitting}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              )}
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
          <div className="relative mt-1">
            <Input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              placeholder={t('confirmPassword')}
              disabled={isSubmitting}
              className={isRTL ? 'pl-10' : 'pr-10'}
              {...register('confirmPassword')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`absolute top-0 h-full px-3 py-2 hover:bg-transparent ${isRTL ? 'left-0' : 'right-0'}`}
              onClick={() => setShowPassword(!showPassword)}
              disabled={isSubmitting}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              )}
            </Button>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <span className="flex items-center">
              <span className={`h-4 w-4 animate-spin rounded-full border-b-2 border-white ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('acceptingInvitation')}
            </span>
          ) : (
            <span className="flex items-center">
              <UserPlus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
              {t('acceptInvitation')}
            </span>
          )}
        </Button>
      </form>
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-900 sm:px-6 lg:px-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          {appLogoUrl && (
            <img src={appLogoUrl} alt={appName} className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-xs" />
          )}
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{appName}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{t('acceptInvitationDescription')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">{t('acceptInvitation')}</CardTitle>
          </CardHeader>
          <CardContent>{renderContent()}</CardContent>
        </Card>
      </div>
    </div>
  );
}
