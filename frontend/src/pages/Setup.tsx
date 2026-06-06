import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ShieldCheck,
  Eye,
  EyeOff,
  User,
  Mail,
  Lock,
  KeyRound,
  Check,
  X,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { useAppName } from '@/hooks/useAppName';
import { authAPI, getApiErrorMessage } from '@/lib/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

const MIN_PASSWORD_LENGTH = 8;

// Mirror of the backend password policy (auth.validate_password_strength) so the
// user gets instant feedback; the server remains the source of truth.
function meetsPolicy(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    /[a-zA-Z]/.test(password) &&
    /\d/.test(password)
  );
}

// 0 = weak, 1 = fair, 2 = strong
function passwordScore(password: string): 0 | 1 | 2 {
  if (!meetsPolicy(password)) return 0;
  if (password.length >= 12 && /[^a-zA-Z0-9]/.test(password)) return 2;
  return 1;
}

export function Setup() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { appName, appLogoUrl } = useAppName(false);
  const { t, isRTL } = useTranslation();
  const { login } = useAuthStore();
  const navigate = useNavigate();

  // RTL-aware positioning for inline field icons.
  const startPos = isRTL ? 'right-3' : 'left-3';
  const endPos = isRTL ? 'left-3' : 'right-3';
  const padStart = isRTL ? 'pr-9' : 'pl-9';
  const padEnd = isRTL ? 'pl-9' : 'pr-9';

  const score = useMemo(() => passwordScore(password), [password]);
  const strengthLabel = [t('passwordStrengthWeak'), t('passwordStrengthFair'), t('passwordStrengthStrong')][score];
  const strengthText = ['text-red-500', 'text-amber-500', 'text-green-600'][score];
  const segmentColor = ['bg-red-500', 'bg-amber-500', 'bg-green-500'][score];

  const requirements = [
    { ok: password.length >= MIN_PASSWORD_LENGTH, label: t('reqMinChars') },
    { ok: /[a-zA-Z]/.test(password) && /\d/.test(password), label: t('reqLettersNumbers') },
  ];

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    username.trim() !== '' &&
    email.trim() !== '' &&
    setupToken.trim() !== '' &&
    meetsPolicy(password) &&
    password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !email.trim() || !password || !confirmPassword || !setupToken.trim()) {
      setError(t('allFieldsRequired'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }
    if (!meetsPolicy(password)) {
      setError(t('passwordPolicyHint'));
      return;
    }

    setIsLoading(true);

    // Step 1: create the first account (token-gated). A failure here is a real
    // error to show (bad token, weak password, taken username, ...).
    try {
      await authAPI.completeSetup(username.trim(), email.trim(), fullName.trim(), password, setupToken.trim());
    } catch (err) {
      setError(getApiErrorMessage(err, t('registrationFailed')));
      setIsLoading(false);
      return;
    }

    // Step 2: the account now exists. Try to log straight in; if that hiccups,
    // don't show a scary error — the admin was created, just send them to login.
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch {
      navigate('/login?registered=true', { replace: true });
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-gradient-to-b from-background via-background to-muted/40 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Decorative ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-blue-400/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Brand + step badge */}
        <div className="text-center">
          {appLogoUrl ? (
            <img
              src={appLogoUrl}
              alt={appName}
              className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover shadow-lg ring-1 ring-black/5"
            />
          ) : (
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-blue-600 shadow-lg shadow-primary/30">
              <ShieldCheck className="h-8 w-8 text-white" />
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{appName}</h1>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {t('setupStepBadge')}
          </span>
        </div>

        <Card className="border-border/60 shadow-xl shadow-black/5">
          <CardHeader className="space-y-1.5 pb-4">
            <CardTitle className="text-xl">{t('setupHeading')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('setupSubtitle')}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Setup token (gates first-admin creation) */}
              <div>
                <Label htmlFor="setupToken">{t('setupTokenLabel')}</Label>
                <div className="relative mt-1.5">
                  <span className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', startPos)}>
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <Input
                    id="setupToken"
                    type="text"
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                    placeholder={t('setupTokenPlaceholder')}
                    required
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isLoading}
                    className={cn(padStart, 'font-mono text-sm')}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t('setupTokenHint')}</p>
              </div>

              {/* Username */}
              <div>
                <Label htmlFor="username">{t('username')}</Label>
                <div className="relative mt-1.5">
                  <span className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', startPos)}>
                    <User className="h-4 w-4" />
                  </span>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('enterUsername')}
                    required
                    autoComplete="username"
                    disabled={isLoading}
                    className={padStart}
                  />
                </div>
              </div>

              {/* Full name (optional) */}
              <div>
                <Label htmlFor="fullName" className="flex items-center gap-2">
                  {t('fullName')}
                  <span className="text-xs font-normal text-muted-foreground">({t('optionalLabel')})</span>
                </Label>
                <div className="relative mt-1.5">
                  <span className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', startPos)}>
                    <User className="h-4 w-4" />
                  </span>
                  <Input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t('enterFullName')}
                    autoComplete="name"
                    disabled={isLoading}
                    className={padStart}
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <Label htmlFor="email">{t('email')}</Label>
                <div className="relative mt-1.5">
                  <span className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', startPos)}>
                    <Mail className="h-4 w-4" />
                  </span>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('enterEmail')}
                    required
                    autoComplete="email"
                    disabled={isLoading}
                    className={padStart}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
                <div className="relative mt-1.5">
                  <span className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', startPos)}>
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('enterPassword')}
                    required
                    autoComplete="new-password"
                    disabled={isLoading}
                    className={cn(padStart, padEnd)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={cn('absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors', endPos)}
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    disabled={isLoading}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Strength meter + requirement checklist */}
                {password ? (
                  <div className="mt-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-1 gap-1">
                        {[0, 1, 2].map((seg) => (
                          <div
                            key={seg}
                            className={cn(
                              'h-1.5 flex-1 rounded-full transition-colors',
                              seg <= score ? segmentColor : 'bg-muted',
                            )}
                          />
                        ))}
                      </div>
                      <span className={cn('text-xs font-medium', strengthText)}>{strengthLabel}</span>
                    </div>
                    <ul className="space-y-1">
                      {requirements.map((req) => (
                        <li key={req.label} className="flex items-center gap-1.5 text-xs">
                          {req.ok ? (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-muted-foreground/60" />
                          )}
                          <span className={req.ok ? 'text-foreground' : 'text-muted-foreground'}>{req.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t('passwordPolicyHint')}</p>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
                <div className="relative mt-1.5">
                  <span className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', startPos)}>
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('confirmPassword')}
                    required
                    autoComplete="new-password"
                    disabled={isLoading}
                    className={cn(
                      padStart,
                      padEnd,
                      passwordsMismatch && 'border-red-500 focus-visible:ring-red-500',
                      passwordsMatch && 'border-green-500/60',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className={cn('absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors', endPos)}
                    aria-label={showConfirmPassword ? t('hidePassword') : t('showPassword')}
                    disabled={isLoading}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {passwordsMatch && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-green-600">
                    <Check className="h-3.5 w-3.5" />
                    {t('passwordsMatch')}
                  </p>
                )}
                {passwordsMismatch && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
                    <X className="h-3.5 w-3.5" />
                    {t('passwordsDoNotMatch')}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading || !canSubmit}>
                {isLoading ? (
                  <>
                    <Loader2 className={cn('h-4 w-4 animate-spin', isRTL ? 'ml-2' : 'mr-2')} />
                    {t('setupCompleting')}
                  </>
                ) : (
                  <>
                    {t('setupCreateAdmin')}
                    <ArrowRight className={cn('h-4 w-4', isRTL ? 'mr-2 rotate-180' : 'ml-2')} />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              {t('setupSecurityNote')}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">{t('setupFooterNote')}</p>
      </div>
    </div>
  );
}
