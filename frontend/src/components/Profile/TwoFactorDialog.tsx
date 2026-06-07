import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Key, Shield, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface TwoFactorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  onToggle: () => void;
}

export function TwoFactorDialog({ isOpen, onClose, enabled, onToggle }: TwoFactorDialogProps) {
  const { t, isRTL } = useTranslation();
  const handleToggle = () => {
    onToggle();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent isRTL={isRTL} className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            {t('twoFactorAuthentication')}
          </DialogTitle>
          <DialogDescription>
            {enabled ? t('twoFactorEnabled') : t('twoFactorDisabled')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Alert className={enabled ? "bg-green-50 border-green-200" : "bg-blue-50 border-blue-200"}>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              {enabled ? (
                <>
                  <strong>{t('twoFactorEnabled')}</strong>
                </>
              ) : (
                <>
                  <strong>{t('twoFactorDisabled')}</strong>
                </>
              )}
            </AlertDescription>
          </Alert>

          {!enabled && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t('twoFactorNote')}
              </AlertDescription>
            </Alert>
          )}

          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <p>{t('when2FAEnabled')}</p>
            <ul className={`list-inside list-disc space-y-1 ${isRTL ? 'mr-2' : 'ml-2'}`}>
              <li>{t('needVerificationCode')}</li>
              <li>{t('accountProtected')}</li>
              <li>{t('useAuthenticatorApp')}</li>
            </ul>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              {t('close')}
            </Button>
            <Button
              onClick={handleToggle}
              className={enabled ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}
            >
              {enabled ? t('disable2FA') : t('enable2FA')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
