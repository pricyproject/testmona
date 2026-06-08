import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Eye, EyeOff, Key, Shield, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { authAPI, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

interface TwoFactorSetupData {
  secret: string;
  provisioning_uri: string;
}

interface TwoFactorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  onStatusChange: (enabled: boolean) => void;
}

export function TwoFactorDialog({ isOpen, onClose, enabled, onStatusChange }: TwoFactorDialogProps) {
  const { t, isRTL } = useTranslation();
  const [setupData, setSetupData] = useState<TwoFactorSetupData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sessionRevoked, setSessionRevoked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sanitizedCode = code.replace(/\D/g, '').slice(0, 6);
  const submittedCode = code.trim();

  useEffect(() => {
    let cancelled = false;
    if (!setupData?.provisioning_uri) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(setupData.provisioning_uri, { margin: 1, width: 192 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [setupData?.provisioning_uri]);

  const redirectToLogin = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
    window.location.href = '/login';
  };

  const handleSetup = async () => {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      setSetupData(await authAPI.setupTwoFactor());
    } catch (err) {
      setError(getApiErrorMessage(err, t('twoFactorSetupFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnable = async () => {
    if (!currentPassword || sanitizedCode.length !== 6) {
      setError(t('twoFactorEnableMissingFields'));
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const status = await authAPI.enableTwoFactor(currentPassword, sanitizedCode);
      onStatusChange(Boolean(status.enabled));
      setRecoveryCodes(status.recovery_codes || []);
      setSessionRevoked(true);
      setSuccess(t('twoFactorEnabledSuccess'));
    } catch (err) {
      setError(getApiErrorMessage(err, t('twoFactorEnableFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async () => {
    if (!currentPassword || !submittedCode) {
      setError(t('twoFactorDisableMissingFields'));
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const status = await authAPI.disableTwoFactor(currentPassword, submittedCode);
      onStatusChange(Boolean(status.enabled));
      setSessionRevoked(true);
      setSuccess(t('twoFactorDisabledSuccess'));
    } catch (err) {
      setError(getApiErrorMessage(err, t('twoFactorDisableFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerateRecoveryCodes = async () => {
    if (!currentPassword || !submittedCode) {
      setError(t('twoFactorRecoveryMissingFields'));
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const response = await authAPI.regenerateTwoFactorRecoveryCodes(currentPassword, submittedCode);
      setRecoveryCodes(response.recovery_codes || []);
      setSuccess(t('twoFactorRecoveryCodesRegenerated'));
    } catch (err) {
      setError(getApiErrorMessage(err, t('twoFactorRecoveryCodesFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setSuccess(t('twoFactorRecoveryCodesCopied'));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' || isSubmitting) {
      return;
    }

    event.preventDefault();
    if (sessionRevoked) {
      redirectToLogin();
    } else if (enabled) {
      handleDisable();
    } else if (setupData) {
      handleEnable();
    } else {
      handleSetup();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && (sessionRevoked ? redirectToLogin() : onClose())}>
      <DialogContent isRTL={isRTL} className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-muted-foreground" />
            {t('twoFactorAuthentication')}
          </DialogTitle>
          <DialogDescription>{enabled ? t('twoFactorEnabled') : t('twoFactorDisabled')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-primary/20 bg-primary/5">
            <Shield className="h-4 w-4" />
            <AlertDescription>{enabled ? t('twoFactorEnabled') : t('twoFactorDisabled')}</AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-primary/20 bg-primary/5">
              <Shield className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {!enabled && !recoveryCodes.length && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('twoFactorSetupInstructions')}</p>
              {!setupData ? (
                <Button type="button" onClick={handleSetup} disabled={isSubmitting}>
                  {isSubmitting ? t('loading') : t('setup2FA')}
                </Button>
              ) : (
                <div className="space-y-3">
                  {qrDataUrl && (
                    <div className="flex justify-center rounded-lg border bg-background p-3 sm:p-4">
                      <img src={qrDataUrl} alt={t('twoFactorQrAlt')} className="h-40 w-40 sm:h-48 sm:w-48" />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="two-factor-secret">{t('twoFactorSecretLabel')}</Label>
                    <Input id="two-factor-secret" value={setupData.secret} readOnly dir="ltr" />
                    <p className="text-xs text-muted-foreground">{t('twoFactorManualSecretHint')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {recoveryCodes.length > 0 && (
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <h4 className="text-sm font-medium">{t('twoFactorRecoveryCodes')}</h4>
                <p className="text-xs text-muted-foreground">{t('twoFactorRecoveryCodesNote')}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" dir="ltr">
                {recoveryCodes.map((recoveryCode) => (
                  <code key={recoveryCode} className="rounded bg-muted px-2 py-1 text-center text-sm text-foreground">
                    {recoveryCode}
                  </code>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleCopyRecoveryCodes}>
                {t('copyRecoveryCodes')}
              </Button>
            </div>
          )}

          {(enabled || setupData) && !sessionRevoked && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="two-factor-password">{t('currentPassword')}</Label>
                <div className="relative">
                  <Input
                    id="two-factor-password"
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder={t('enterPassword')}
                    disabled={isSubmitting}
                    className={isRTL ? 'pl-10' : 'pr-10'}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`absolute top-0 h-full px-3 py-2 hover:bg-transparent ${isRTL ? 'left-0' : 'right-0'}`}
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={isSubmitting}
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="two-factor-code">{t('twoFactorCode')}</Label>
                <Input
                  id="two-factor-code"
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
                  placeholder={t('enterTwoFactorOrRecoveryCode')}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('when2FAEnabled')}</p>
            <ul className={`list-inside list-disc space-y-1 ${isRTL ? 'mr-2' : 'ml-2'}`}>
              <li>{t('needVerificationCode')}</li>
              <li>{t('accountProtected')}</li>
              <li>{t('useAuthenticatorApp')}</li>
            </ul>
          </div>

          <DialogFooter className="flex-col gap-2 pt-2 sm:flex-row">
            <Button variant="outline" onClick={sessionRevoked ? redirectToLogin : onClose} disabled={isSubmitting}>
              {sessionRevoked ? t('returnToLogin') : t('close')}
            </Button>
            {!sessionRevoked && enabled && (
              <Button type="button" variant="outline" onClick={handleRegenerateRecoveryCodes} disabled={isSubmitting}>
                {t('regenerateRecoveryCodes')}
              </Button>
            )}
            {!sessionRevoked && enabled ? (
              <Button onClick={handleDisable} disabled={isSubmitting} variant="destructive">
                {isSubmitting ? t('disabling2FA') : t('disable2FA')}
              </Button>
            ) : !sessionRevoked && setupData ? (
              <Button onClick={handleEnable} disabled={isSubmitting}>
                {isSubmitting ? t('enabling2FA') : t('verifyAndEnable2FA')}
              </Button>
            ) : null}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
