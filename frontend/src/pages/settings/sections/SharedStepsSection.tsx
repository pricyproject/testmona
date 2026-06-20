import { useState } from 'react';
import { Plus, Layers, Clock, TrendingUp, MoreHorizontal, Edit, Copy, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import { SettingsSection, SettingsEmptyState } from '../components/SettingsPrimitives';
import {
  SharedStepTemplate, SharedStepTemplateForm, SharedStepTemplateFormErrors,
  emptySharedStepTemplateForm,
  SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH, SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH, SHARED_STEP_TEMPLATE_MAX_TIME,
} from '../types';
import { TestManagementData } from '../hooks/useTestManagementData';

const CATEGORIES = ['authentication', 'database', 'api', 'ui', 'setup', 'cleanup', 'validation', 'reporting'] as const;
const COMPLEXITIES = ['simple', 'medium', 'complex'] as const;

export function SharedStepsSection({ data }: { data: TestManagementData }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SharedStepTemplateForm>(emptySharedStepTemplateForm());
  const [errors, setErrors] = useState<SharedStepTemplateFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const isEdit = editingId !== null;
  const activeSteps = data.sharedStepTemplates.filter((s) => s.is_active);

  const reset = () => { setForm(emptySharedStepTemplateForm()); setErrors({}); setEditingId(null); };
  const openCreate = () => { reset(); setOpen(true); };
  const fillFrom = (step: SharedStepTemplate) => ({
    name: step.name,
    description: step.description,
    category: step.category,
    tags: step.tags.join(', '),
    complexity: step.complexity,
    estimated_time: step.estimated_time || 1,
    prerequisites: step.prerequisites.join(', '),
    related_steps: step.related_steps.join(', '),
  });
  const openEdit = (step: SharedStepTemplate) => { setEditingId(step.id); setErrors({}); setForm(fillFrom(step)); setOpen(true); };
  const openDuplicate = (step: SharedStepTemplate) => {
    setEditingId(null);
    setErrors({});
    setForm({ ...fillFrom(step), name: t('nameCopySuffix', { name: step.name }) });
    setOpen(true);
  };

  const patch = (changes: Partial<SharedStepTemplateForm>, clearError?: keyof SharedStepTemplateForm) => {
    setForm((current) => ({ ...current, ...changes }));
    if (clearError) setErrors((current) => ({ ...current, [clearError]: undefined }));
  };

  const submit = async () => {
    const validation = data.validateSharedStepForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setSubmitting(true);
    const ok = isEdit ? await data.updateSharedStep(editingId!, form) : await data.createSharedStep(form);
    setSubmitting(false);
    if (ok) { setOpen(false); reset(); }
  };

  const confirmDelete = async () => {
    if (deleteId) await data.deleteSharedStep(deleteId);
    setDeleteId(null);
  };

  return (
    <SettingsSection
      icon={Layers}
      tone="violet"
      title={t('sharedStepTemplates')}
      action={
        <Dialog open={open} onOpenChange={(o) => (o ? openCreate() : (setOpen(false), reset()))}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addTemplate')}</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{isEdit ? t('editSharedStepTemplate') : t('addSharedStepTemplate')}</DialogTitle>
              <DialogDescription>{isEdit ? t('updateSharedStepTemplateDesc') : t('createSharedStepTemplateDesc')}</DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-2 pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="ss-name">{t('name')}</Label>
                <Input
                  id="ss-name"
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value }, 'name')}
                  placeholder={t('sharedStepNamePlaceholder')}
                  maxLength={SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH}
                  aria-invalid={Boolean(errors.name)}
                  autoFocus
                />
                <div className="flex justify-between text-xs">
                  <span className="text-destructive">{errors.name}</span>
                  <span className="text-muted-foreground">{t('characterCount', { count: form.name.length, max: SHARED_STEP_TEMPLATE_NAME_MAX_LENGTH })}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-desc">{t('description')}</Label>
                <Textarea
                  id="ss-desc"
                  value={form.description}
                  onChange={(e) => patch({ description: e.target.value }, 'description')}
                  placeholder={t('stepDescriptionPlaceholder')}
                  rows={2}
                  maxLength={SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH}
                  aria-invalid={Boolean(errors.description)}
                />
                <div className="flex justify-between text-xs">
                  <span className="text-destructive">{errors.description}</span>
                  <span className="text-muted-foreground">{t('characterCount', { count: form.description.length, max: SHARED_STEP_TEMPLATE_DESCRIPTION_MAX_LENGTH })}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t('category')}</Label>
                  <Select value={form.category} onValueChange={(v: any) => patch({ category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('complexity')}</Label>
                  <Select value={form.complexity} onValueChange={(v: any) => patch({ complexity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COMPLEXITIES.map((c) => <SelectItem key={c} value={c}>{t(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ss-time">{t('estimatedTimeMinutes')}</Label>
                  <Input
                    id="ss-time"
                    type="number"
                    min={1}
                    max={SHARED_STEP_TEMPLATE_MAX_TIME}
                    value={form.estimated_time}
                    onChange={(e) => patch({ estimated_time: e.target.value === '' ? '' : Number(e.target.value) }, 'estimated_time')}
                    aria-invalid={Boolean(errors.estimated_time)}
                  />
                  {errors.estimated_time && <p className="text-xs text-destructive">{errors.estimated_time}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-tags">{t('tags')}</Label>
                <Input id="ss-tags" value={form.tags} onChange={(e) => patch({ tags: e.target.value }, 'tags')} placeholder={t('tagsPlaceholder')} aria-invalid={Boolean(errors.tags)} />
                {errors.tags && <p className="text-xs text-destructive">{errors.tags}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-prereq">{t('prerequisites')}</Label>
                <Textarea id="ss-prereq" value={form.prerequisites} onChange={(e) => patch({ prerequisites: e.target.value }, 'prerequisites')} placeholder={t('prerequisitesPlaceholder')} rows={2} aria-invalid={Boolean(errors.prerequisites)} />
                {errors.prerequisites && <p className="text-xs text-destructive">{errors.prerequisites}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-related">{t('relatedSteps')}</Label>
                <Textarea id="ss-related" value={form.related_steps} onChange={(e) => patch({ related_steps: e.target.value }, 'related_steps')} placeholder={t('relatedStepsPlaceholder')} rows={2} aria-invalid={Boolean(errors.related_steps)} />
                {errors.related_steps && <p className="text-xs text-destructive">{errors.related_steps}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={submitting}>{t('cancel')}</Button>
              <Button onClick={submit} disabled={submitting || !form.name.trim()}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin rtl:ml-2 rtl:mr-0" />}
                {submitting ? (isEdit ? t('updating') : t('creating')) : isEdit ? t('updateTemplate') : t('createTemplate')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {activeSteps.length === 0 ? (
        <SettingsEmptyState
          icon={Layers}
          title={t('noSharedStepTemplatesFoundDesc')}
          action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addTemplate')}</Button>}
        />
      ) : (
        <div className="space-y-3">
          {activeSteps.map((step) => (
            <div key={step.id} className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-foreground">{step.name}</h4>
                  <Badge variant="outline">{t(step.category)}</Badge>
                  <Badge variant={step.complexity === 'simple' ? 'default' : step.complexity === 'medium' ? 'secondary' : 'destructive'}>
                    {t(step.complexity)}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />{t('minutesShort', { count: step.estimated_time })}
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <TrendingUp className="h-3 w-3" />{t('usedTimes', { count: step.usage_count })}
                  </span>
                </div>
                {step.description && <p className="mb-2 text-sm text-muted-foreground">{step.description}</p>}
                {step.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {step.tags.map((tag, i) => (
                      <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(step)}><Edit className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('edit')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openDuplicate(step)}><Copy className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('duplicate')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDeleteId(step.id)} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteSharedStep')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteSharedStepDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
