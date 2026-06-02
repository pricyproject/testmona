import { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { RequirementChat } from '@/components/requirements/RequirementChat';

interface RequirementChatPanelProps {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Requirements-scoped AI chat shown as a modal from the Requirements page.
 * For project-wide, multi-source Q&A use the dedicated /ask route.
 */
export function RequirementChatPanel({ projectId, open, onOpenChange }: RequirementChatPanelProps) {
  const { t, isRTL } = useTranslation();
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        isRTL={isRTL}
        className={`flex flex-col gap-0 overflow-hidden p-0 ${
          fullscreen
            ? 'h-screen w-screen max-w-none left-0 top-0 translate-x-0 translate-y-0 rounded-none sm:rounded-none'
            : 'h-[82vh] max-w-5xl'
        }`}
      >
        <RequirementChat
          projectId={projectId}
          scopeMode="requirements"
          variant="modal"
          active={open}
          onClose={() => onOpenChange(false)}
          headerActions={(
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={isRTL ? 'ml-8' : 'mr-8'}
              onClick={() => setFullscreen((v) => !v)}
              aria-label={fullscreen ? t('reqChatExitFullscreen') : t('reqChatFullscreen')}
              title={fullscreen ? t('reqChatExitFullscreen') : t('reqChatFullscreen')}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
