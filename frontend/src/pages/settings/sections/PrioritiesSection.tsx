import { useState } from 'react';
import { Plus, AlertCircle, MoreHorizontal, Edit, Copy, Trash2, Flag, Check, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { SettingsSection, SettingsEmptyState, SettingsErrorState } from '../components/SettingsPrimitives';
import { Priority, PriorityForm, emptyPriorityForm } from '../types';
import { TestManagementData, nextFreePriorityValue } from '../hooks/useTestManagementData';

// Curated swatches so users can compose a coherent severity scale with one tap
// instead of fishing inside the native colour picker every time.
const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
];

const PRIORITY_SCALE_MAX = 10;

/** Compact 10-segment meter that reads a priority's weight at a glance. */
function WeightMeter({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <div className="flex flex-1 gap-1">
        {Array.from({ length: PRIORITY_SCALE_MAX }).map((_, i) => (
          <span
            key={i}
            className={cn('h-1.5 flex-1 rounded-full transition-colors', i >= value && 'bg-muted')}
            style={i < value ? { backgroundColor: color } : undefined}
          />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground rtl:text-left">
        {value}/{PRIORITY_SCALE_MAX}
      </span>
    </div>
  );
}

export function PrioritiesSection({ data, canManage }: { data: TestManagementData; canManage: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PriorityForm>(emptyPriorityForm());
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const isEdit = editingId !== null;
  const activePriorities = data.priorities
    .filter((p) => p.is_active)
    .sort((a, b) => b.value - a.value);

  const openCreate = () => { setEditingId(null); setForm(emptyPriorityForm()); setOpen(true); };
  const openEdit = (priority: Priority) => {
    setEditingId(priority.id);
    setForm({ name: priority.name, value: priority.value, color: priority.color, description: priority.description, is_default: priority.is_default });
    setOpen(true);
  };
  const openDuplicate = (priority: Priority) => {
    const taken = data.priorities.filter((p) => p.is_active).map((p) => p.value);
    const value = nextFreePriorityValue(taken, priority.value);
    setEditingId(null);
    setForm({
      name: t('nameCopySuffix', { name: priority.name }),
      value: value ?? priority.value,
      color: priority.color,
      description: priority.description,
      is_default: false,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    const ok = isEdit ? await data.updatePriority(editingId!, form) : await data.createPriority(form);
    setSubmitting(false);
    if (ok) setOpen(false);
  };

  const confirmDelete = async () => {
    if (deleteId) await data.deletePriority(deleteId);
    setDeleteId(null);
  };

  const previewValue = typeof form.value === 'number' ? form.value : 0;
  const isPreset = (c: string) => COLOR_PRESETS.some((preset) => preset.toLowerCase() === c.toLowerCase());

  return (
    <SettingsSection
      icon={AlertCircle}
      tone="amber"
      title={t('prioritiesManagementTitle')}
      description={t('prioritiesManagementDesc')}
      action={
        <Dialog open={open} onOpenChange={(o) => (o ? openCreate() : setOpen(false))}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addPriority')}</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>{isEdit ? t('editPriorityLevel') : t('createNewPriorityLevel')}</DialogTitle>
              <DialogDescription>{isEdit ? t('updatePriorityDetails') : t('addPriorityDesc')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 py-2">
              {/* Live preview — shows exactly how the level will read in lists */}
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 p-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold tabular-nums text-white shadow-sm"
                  style={{ backgroundColor: form.color }}
                >
                  {previewValue || '–'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">
                      {form.name.trim() || t('priorityNamePlaceholder')}
                    </span>
                    {form.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <Star className="h-3 w-3 fill-current" />{t('default')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('priorityPreview')}</p>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pr-name">{t('name')}</Label>
                  <Input
                    id="pr-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('priorityNamePlaceholder')}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pr-value">{t('priorityValueRange')}</Label>
                  <Input
                    id="pr-value"
                    type="number"
                    min={1}
                    max={10}
                    className="w-24"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value === '' ? '' : Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pr-desc">{t('description')}</Label>
                <Textarea
                  id="pr-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('priorityDescriptionPlaceholder')}
                  rows={2}
                  className="resize-none"
                />
              </div>

              <div className="space-y-2.5">
                <Label>{t('color')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {COLOR_PRESETS.map((c) => {
                    const selected = form.color.toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        aria-label={c}
                        aria-pressed={selected}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-background transition',
                          selected ? 'ring-foreground' : 'ring-transparent hover:ring-border',
                        )}
                        style={{ backgroundColor: c }}
                      >
                        {selected && <Check className="h-4 w-4 text-white" />}
                      </button>
                    );
                  })}
                  <div className="mx-1 h-6 w-px bg-border" />
                  <div className="relative">
                    <Input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value })}
                      aria-label={t('color')}
                      className={cn(
                        'h-9 w-9 cursor-pointer rounded-full p-1',
                        !isPreset(form.color) && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                      )}
                    />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{form.color.toUpperCase()}</span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3">
                <div className="space-y-0.5 rtl:text-right">
                  <Label htmlFor="pr-default" className="cursor-pointer">{t('default')}</Label>
                  <p className="text-xs text-muted-foreground">{t('priorityDefaultHint')}</p>
                </div>
                <Switch id="pr-default" checked={form.is_default} onCheckedChange={(checked) => setForm({ ...form, is_default: checked })} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button onClick={submit} disabled={!form.name.trim() || submitting}>
                {submitting ? t('saving') : isEdit ? t('updatePriority') : t('createPriority')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {data.loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-xl border border-border/60 bg-muted/40" />
          ))}
        </div>
      ) : data.error ? (
        <SettingsErrorState icon={AlertCircle} message={data.error} retryLabel={t('retry')} onRetry={data.reload} />
      ) : activePriorities.length === 0 ? (
        <SettingsEmptyState
          icon={Flag}
          title={t('noPrioritiesFoundDesc')}
          action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addPriority')}</Button>}
        />
      ) : (
        <div className="space-y-3">
          {activePriorities.map((priority) => (
            <div
              key={priority.id}
              className="group relative flex items-center gap-4 overflow-hidden rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-border hover:shadow-sm"
            >
              {/* Colour accent rail */}
              <span
                className="absolute inset-y-0 left-0 w-1 rtl:left-auto rtl:right-0"
                style={{ backgroundColor: priority.color }}
                aria-hidden
              />

              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold tabular-nums text-white shadow-sm"
                style={{ backgroundColor: priority.color }}
              >
                {priority.value}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="truncate font-semibold text-foreground">{priority.name}</h4>
                  {priority.is_default && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <Star className="h-3 w-3 fill-current" />{t('default')}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">{priority.description || t('noDescriptionProvided')}</p>
              </div>

              <div className="hidden w-44 shrink-0 sm:block">
                <WeightMeter value={priority.value} color={priority.color} label={t('priorityValueInline', { value: priority.value })} />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 opacity-60 transition-opacity group-hover:opacity-100">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => openEdit(priority)}>
                    <Edit className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openDuplicate(priority)}>
                    <Copy className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('duplicate')}
                  </DropdownMenuItem>
                  {canManage && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDeleteId(priority.id)} className="text-destructive focus:text-destructive">
                        <Trash2 className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeletePriority')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deletePriorityDesc')}</AlertDialogDescription>
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
