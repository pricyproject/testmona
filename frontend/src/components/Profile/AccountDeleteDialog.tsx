import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface AccountDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void | Promise<void>;
}

interface AccountDeleteFormValues {
  password: string;
  confirmText: string;
}

export function AccountDeleteDialog({ isOpen, onClose, onSubmit }: AccountDeleteDialogProps) {
  const { t, isRTL } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1: warning, 2: confirmation

  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<AccountDeleteFormValues>({
    defaultValues: { password: '', confirmText: '' },
  });
  const isSubmitting = formState.isSubmitting;
  const password = watch('password');
  const confirmText = watch('confirmText');

  useEffect(() => {
    if (!isOpen) {
      reset();
      setShowPassword(false);
      setError('');
      setStep(1);
    }
  }, [isOpen, reset]);

  const submit = async (values: AccountDeleteFormValues) => {
    setError('');

    if (step === 1) {
      if (values.confirmText !== 'DELETE') {
        setError(t('pleaseTypeDelete'));
        return;
      }
      // Clear the step-1 phrase so the step-2 field doesn't start pre-filled
      // with "DELETE" (which doesn't match the "DELETE MY ACCOUNT" it expects).
      setValue('confirmText', '');
      setStep(2);
      return;
    }

    if (!values.password) {
      setError(t('passwordRequired'));
      return;
    }

    if (values.confirmText !== 'DELETE MY ACCOUNT') {
      setError(t('pleaseTypeDeleteMyAccount'));
      return;
    }

    try {
      await onSubmit(values.password);
    } catch (error: any) {
      setError(error?.response?.data?.detail || error?.message || t('failedToDeleteAccount'));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent isRTL={isRTL} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="h-5 w-5" />
            {t('deleteAccountTitle')}
          </DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <form onSubmit={handleSubmit(submit)} className="space-y-4">
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t('deleteAccountWarning')}
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('typeDeleteToContinue')}
              </p>
              <Input
                placeholder={t('typeDelete')}
                className="text-center"
                {...register('confirmText')}
              />
              {error && (
                <div className="text-sm text-red-500" role="alert">{error}</div>
              )}
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={confirmText !== 'DELETE' || isSubmitting}
                >
                  {t('continue')}
                </Button>
              </DialogFooter>
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit(submit)} className="space-y-4">
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t('finalConfirmation')}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="password">{t('enterPassword')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('enterPassword')}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 ${isRTL ? 'left-3' : 'right-3'}`}
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">{t('typeDeleteMyAccount')}</Label>
              <Input
                id="confirm"
                placeholder={t('deleteMyAccountConfirmationText')}
                className="text-center"
                {...register('confirmText')}
              />
            </div>

            {error && (
              <div className="rounded bg-red-50 p-2 text-sm text-red-500 dark:bg-red-900/20" role="alert">
                {error}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setValue('confirmText', '');
                }}
                disabled={isSubmitting}
              >
                {t('back')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={!password || confirmText !== 'DELETE MY ACCOUNT' || isSubmitting}
              >
                <Trash2 className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
                {isSubmitting ? t('deleting') : t('deleteAccount')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
