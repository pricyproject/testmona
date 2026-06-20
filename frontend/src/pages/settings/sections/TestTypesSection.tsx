import { useState } from 'react';
import { Plus, Tag, Layers, MoreHorizontal, Edit, Copy, Trash2, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { SettingsSection, SettingsEmptyState, SettingsErrorState, SettingsCardsSkeleton } from '../components/SettingsPrimitives';
import { TestType, TestTypeForm, emptyTestTypeForm } from '../types';
import { TestManagementData } from '../hooks/useTestManagementData';

// Shared palette + quick-pick glyphs so every type reads as part of one system
// instead of a grab-bag of arbitrary colours and emoji.
const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
];

const ICON_PRESETS = ['🧪', '🚀', '🔒', '⚡', '🖱️', '🔁', '🌐', '📱', '♿', '🔍', '🧩', '⚙️'];

export function TestTypesSection({ data, canManage }: { data: TestManagementData; canManage: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TestTypeForm>(emptyTestTypeForm());
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const isEdit = editingId !== null;
  const activeTypes = data.testTypes.filter((type) => type.is_active);

  const openCreate = () => { setEditingId(null); setForm(emptyTestTypeForm()); setOpen(true); };
  const openEdit = (type: TestType) => {
    setEditingId(type.id);
    setForm({ name: type.name, description: type.description, color: type.color, icon: type.icon });
    setOpen(true);
  };
  const openDuplicate = (type: TestType) => {
    setEditingId(null);
    setForm({ name: t('nameCopySuffix', { name: type.name }), description: type.description, color: type.color, icon: type.icon });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    const ok = isEdit ? await data.updateTestType(editingId!, form) : await data.createTestType(form);
    setSubmitting(false);
    if (ok) setOpen(false);
  };

  const confirmDelete = async () => {
    if (deleteId) await data.deleteTestType(deleteId);
    setDeleteId(null);
  };

  const isPreset = (c: string) => COLOR_PRESETS.some((preset) => preset.toLowerCase() === c.toLowerCase());

  return (
    <SettingsSection
      icon={Tag}
      tone="blue"
      title={t('testTypesManagementTitle')}
      description={t('testTypesManagementDesc')}
      action={
        <Dialog open={open} onOpenChange={(o) => (o ? openCreate() : setOpen(false))}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addTestType')}</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{isEdit ? t('editTestType') : t('createNewTestType')}</DialogTitle>
              <DialogDescription>{isEdit ? t('updateTestTypeDetails') : t('addTestTypeDesc')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 py-2">
              {/* Live preview — mirrors how the type renders on its card */}
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 p-3">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl text-white shadow-sm"
                  style={{ backgroundColor: form.color }}
                >
                  {form.icon || '🧪'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{form.name.trim() || t('testTypeNamePlaceholder')}</p>
                  <p className="truncate text-xs text-muted-foreground">{form.description.trim() || t('testTypePreview')}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tt-name">{t('name')}</Label>
                <Input
                  id="tt-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('testTypeNamePlaceholder')}
                  maxLength={100}
                  autoFocus
                  aria-invalid={!form.name.trim()}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('testTypeNameHelp')}</span>
                  <span>{form.name.length}/100</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tt-desc">{t('description')}</Label>
                <Textarea
                  id="tt-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('testTypeDescriptionPlaceholder')}
                  rows={3}
                  maxLength={500}
                  className="resize-none"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('testTypeDescriptionHelp')}</span>
                  <span>{form.description.length}/500</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <Label htmlFor="tt-icon">{t('icon')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {ICON_PRESETS.map((emoji) => {
                    const selected = form.icon === emoji;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setForm({ ...form, icon: emoji })}
                        aria-label={emoji}
                        aria-pressed={selected}
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition',
                          selected ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-border hover:bg-muted',
                        )}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                  <Input
                    id="tt-icon"
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    placeholder="🚀"
                    maxLength={10}
                    className="w-16 text-center"
                    aria-label={t('icon')}
                  />
                </div>
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
                  <span className="font-mono text-xs text-muted-foreground">{form.color.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button onClick={submit} disabled={!form.name.trim() || submitting}>
                {submitting ? t('saving') : isEdit ? t('updateTestType') : t('createTestType')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {data.loading ? (
        <SettingsCardsSkeleton count={6} columns={3} />
      ) : data.error ? (
        <SettingsErrorState icon={AlertCircle} message={data.error} retryLabel={t('retry')} onRetry={data.reload} />
      ) : activeTypes.length === 0 ? (
        <SettingsEmptyState
          icon={Layers}
          title={t('noTestTypesFoundDesc')}
          action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addTestType')}</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeTypes.map((type) => (
            <div
              key={type.id}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md"
            >
              {/* Soft colour wash anchored to the type's identity colour */}
              <div
                className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-10 blur-xl transition-opacity group-hover:opacity-20 rtl:-left-8 rtl:right-auto"
                style={{ backgroundColor: type.color }}
                aria-hidden
              />

              <div className="mb-4 flex items-start justify-between">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-xl text-white shadow-sm"
                  style={{ backgroundColor: type.color }}
                >
                  {type.icon}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => openEdit(type)}>
                      <Edit className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openDuplicate(type)}>
                      <Copy className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('duplicate')}
                    </DropdownMenuItem>
                    {canManage && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleteId(type.id)} className="text-destructive focus:text-destructive">
                          <Trash2 className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('delete')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <h4 className="mb-1 truncate text-lg font-semibold text-foreground">{type.name}</h4>
              <p className="mb-4 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">{type.description || t('noDescriptionProvided')}</p>

              <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />{t('active')}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                  {type.usage_count} <span className="font-normal text-muted-foreground">{t('uses')}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDeleteTestType')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteTestTypeDesc')}</AlertDialogDescription>
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
