import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useExecution } from './ExecutionContext';

function DefectDialog() {
  const {
    t, isRTL, isDefectDialogOpen, handleDialogClose, handleDefectDialogKeyDown,
    newDefect, setNewDefect, defectTouchedFields, setDefectTouchedFields,
    defectTitleInputRef, isCreating, handleCreateDefect,
  } = useExecution();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Allow both Enter and Ctrl+Enter for convenience
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      handleCreateDefect();
    }
    // Still call the existing handler for Ctrl+Enter
    handleDefectDialogKeyDown(e);
  };

  return (
    <Dialog open={isDefectDialogOpen} onOpenChange={handleDialogClose}>
      <DialogContent isRTL={isRTL} className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('reportNewDefect')}</DialogTitle>
          <DialogDescription>{t('reportExecutionDefectDesc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="defectTitle" className="text-right">{t('title')}</Label>
            <div className="col-span-3 space-y-1">
              <Input
                ref={defectTitleInputRef}
                id="defectTitle"
                value={newDefect.title}
                onChange={(e) => setNewDefect({ ...newDefect, title: e.target.value })}
                onBlur={() => setDefectTouchedFields({ ...defectTouchedFields, title: true })}
                className={defectTouchedFields.title && newDefect.title.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                placeholder={t('defectTitlePlaceholder')}
                maxLength={200}
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>{t('defectTitlePlaceholder')}</span>
                <span>{newDefect.title.length}/200</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="defectDescription" className="pt-2 text-right">{t('description')}</Label>
            <div className="col-span-3 space-y-1">
              <Textarea
                id="defectDescription"
                value={newDefect.description}
                onChange={(e) => setNewDefect({ ...newDefect, description: e.target.value })}
                placeholder={t('defectDescriptionPlaceholder')}
                rows={3}
                maxLength={1000}
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>{t('defectDescriptionPlaceholder')}</span>
                <span>{newDefect.description.length}/1000</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="severity" className="text-right">{t('defectSeverity')}</Label>
            <Select value={newDefect.severity} onValueChange={(v) => setNewDefect({ ...newDefect, severity: v })}>
              <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t('low')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="critical">{t('critical')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="priority" className="text-right">{t('defectPriority')}</Label>
            <Select value={newDefect.priority} onValueChange={(v) => setNewDefect({ ...newDefect, priority: v })}>
              <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t('low')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="high">{t('high')}</SelectItem>
                <SelectItem value="urgent">{t('urgent')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <div className="mb-2 text-xs text-slate-400 sm:mb-0 sm:mr-auto">{t('ctrlEnterToSubmit')}</div>
          <Button variant="outline" onClick={() => handleDialogClose(false)}>{t('cancel')}</Button>
          <Button onClick={handleCreateDefect} disabled={!newDefect.title.trim() || isCreating}>
            {isCreating ? t('creating') : t('reportDefect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnsavedChangesDialog() {
  const { t, isRTL, showUnsavedDialog, setShowUnsavedDialog, handleUnsavedConfirm } = useExecution();
  return (
    <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
      <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
          <DialogDescription>{t('unsavedChangesModalMessage')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleUnsavedConfirm(false)}>{t('keepEditingModal')}</Button>
          <Button onClick={() => handleUnsavedConfirm(true)}>{t('discardChangesModal')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualTimeDialog() {
  const {
    t, isRTL, showManualTimeDialog, setShowManualTimeDialog,
    manualTimeEntry, setManualTimeEntry, handleManualTimeEntry,
  } = useExecution();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualTimeEntry();
    }
  };

  return (
    <Dialog open={showManualTimeDialog} onOpenChange={setShowManualTimeDialog}>
      <DialogContent isRTL={isRTL} className="sm:max-w-[400px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('addManualTime')}</DialogTitle>
          <DialogDescription>{t('addManualTimeDesc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="manualTime" className="text-right">{t('hours')}</Label>
            <div className="col-span-3 space-y-1">
              <Input
                id="manualTime" type="number" step="0.1" min="0" max="24"
                value={manualTimeEntry}
                onChange={(e) => setManualTimeEntry(e.target.value)}
                placeholder={t('enterHoursPlaceholder')}
                className="h-9"
              />
              <div className="text-xs text-slate-400">{t('manualTimeHelper')}</div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowManualTimeDialog(false)}>{t('cancel')}</Button>
          <Button onClick={handleManualTimeEntry} disabled={!manualTimeEntry || parseFloat(manualTimeEntry) <= 0}>
            {t('addTime')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetTimerDialog() {
  const { t, isRTL, showResetTimerDialog, setShowResetTimerDialog, handleConfirmResetTimer } = useExecution();
  return (
    <Dialog open={showResetTimerDialog} onOpenChange={setShowResetTimerDialog}>
      <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('resetTimer')}</DialogTitle>
          <DialogDescription>{t('resetTimerConfirm')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowResetTimerDialog(false)}>{t('cancel')}</Button>
          <Button onClick={handleConfirmResetTimer} className="bg-red-600 hover:bg-red-700">{t('resetTimer')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscardChangesDialog() {
  const { t, isRTL, showDiscardDialog, confirmDiscardLeave, cancelDiscard } = useExecution();
  return (
    <Dialog open={showDiscardDialog} onOpenChange={(open) => { if (!open) cancelDiscard(); }}>
      <DialogContent isRTL={isRTL} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('unsavedChangesTitle')}</DialogTitle>
          <DialogDescription>{t('discardChangesPrompt')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancelDiscard}>{t('keepEditingModal')}</Button>
          <Button onClick={confirmDiscardLeave} className="bg-red-600 hover:bg-red-700">{t('discardChangesModal')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExecutionDialogs() {
  return (
    <>
      <DefectDialog />
      <UnsavedChangesDialog />
      <ManualTimeDialog />
      <ResetTimerDialog />
      <DiscardChangesDialog />
    </>
  );
}
