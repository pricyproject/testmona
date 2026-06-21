import { useState } from 'react';
import { Plus, Tags, Edit, Trash2, GitMerge, Check, MoreHorizontal, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { getApiErrorMessage } from '@/lib/api';
import type { Tag } from '@/types';
import {
  useProjectTags, useCreateTag, useUpdateTag, useDeleteTag, useMergeTags,
} from '@/hooks/queries/tags';
import {
  SettingsSection, SettingsEmptyState, SettingsErrorState, SettingsCardsSkeleton,
} from '../components/SettingsPrimitives';

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
];

const DEFAULT_COLOR = '#6366F1';

export function TagsSection({ projectId, canManage }: { projectId?: number; canManage: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const pid = projectId ?? null;

  const { data: tags = [], isLoading, isError, refetch } = useProjectTags(pid);
  const createTag = useCreateTag(pid);
  const updateTag = useUpdateTag(pid);
  const deleteTag = useDeleteTag(pid);
  const mergeTags = useMergeTags(pid);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{ name: string; color: string }>({ name: '', color: DEFAULT_COLOR });
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [mergeSource, setMergeSource] = useState<Tag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>('');

  const isEdit = editingId !== null;
  const isPreset = (c: string) => COLOR_PRESETS.some((p) => p.toLowerCase() === c.toLowerCase());

  const openCreate = () => { setEditingId(null); setForm({ name: '', color: DEFAULT_COLOR }); setOpen(true); };
  const openEdit = (tag: Tag) => { setEditingId(tag.id); setForm({ name: tag.name, color: tag.color }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim() || projectId == null) return;
    try {
      if (isEdit) {
        await updateTag.mutateAsync({ id: editingId!, tag: { name: form.name.trim(), color: form.color } });
      } else {
        await createTag.mutateAsync({ project_id: projectId, name: form.name.trim(), color: form.color });
      }
      setOpen(false);
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('tagSaveFailed')), variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTag.mutateAsync(deleteTarget.id);
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('tagDeleteFailed')), variant: 'destructive' });
    }
    setDeleteTarget(null);
  };

  const confirmMerge = async () => {
    if (!mergeSource || !mergeTargetId) return;
    try {
      await mergeTags.mutateAsync({ id: mergeSource.id, targetId: Number(mergeTargetId) });
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('tagMergeFailed')), variant: 'destructive' });
    }
    setMergeSource(null);
    setMergeTargetId('');
  };

  const saving = createTag.isPending || updateTag.isPending;

  return (
    <SettingsSection
      icon={Tags}
      tone="primary"
      title={t('tagsManagementTitle')}
      description={t('tagsManagementDesc')}
      action={
        projectId != null && canManage ? (
          <Dialog open={open} onOpenChange={(o) => (o ? openCreate() : setOpen(false))}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('addTag')}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>{isEdit ? t('editTag') : t('addTag')}</DialogTitle>
                <DialogDescription>{t('tagsManagementDesc')}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 py-2">
                <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 p-3">
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-medium"
                    style={{ backgroundColor: `${form.color}1f`, borderColor: `${form.color}55`, color: form.color }}
                  >
                    {form.name.trim() || t('tags')}
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tag-name">{t('name')}</Label>
                  <Input
                    id="tag-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('tagsPlaceholder')}
                    autoFocus
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
                <Button onClick={submit} disabled={!form.name.trim() || saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin rtl:ml-2 rtl:mr-0" />}
                  {isEdit ? t('save') : t('addTag')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : undefined
      }
    >
      {projectId == null ? (
        <SettingsEmptyState icon={Tags} title={t('tagsSelectProject')} description={t('tagsSelectProjectDesc')} />
      ) : isLoading ? (
        <SettingsCardsSkeleton count={4} columns={2} />
      ) : isError ? (
        <SettingsErrorState icon={Tags} message={t('tagsLoadFailed')} retryLabel={t('retry')} onRetry={() => refetch()} />
      ) : tags.length === 0 ? (
        <SettingsEmptyState icon={Tags} title={t('noTags')} description={t('tagsManagementDesc')} />
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 px-4 py-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{tag.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('tagUsageCount', { count: String(tag.usage_count ?? 0) })}
              </span>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(tag)}>
                      <Edit className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => { setMergeSource(tag); setMergeTargetId(''); }}
                      disabled={tags.length < 2}
                    >
                      <GitMerge className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('mergeTag')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(tag)}>
                      <Trash2 className="mr-2 h-4 w-4 rtl:ml-2 rtl:mr-0" />{t('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTag')}</AlertDialogTitle>
            <AlertDialogDescription>
              {(deleteTarget?.usage_count ?? 0) > 0
                ? t('deleteTagInUse', { name: deleteTarget?.name ?? '', count: String(deleteTarget?.usage_count ?? 0) })
                : t('deleteTagConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge dialog */}
      <Dialog open={mergeSource !== null} onOpenChange={(o) => { if (!o) { setMergeSource(null); setMergeTargetId(''); } }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('mergeTag')}</DialogTitle>
            <DialogDescription>{t('mergeTagInto', { name: mergeSource?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
              <SelectTrigger><SelectValue placeholder={t('mergeTagSelect')} /></SelectTrigger>
              <SelectContent>
                {tags.filter((tg) => tg.id !== mergeSource?.id).map((tg) => (
                  <SelectItem key={tg.id} value={String(tg.id)}>{tg.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMergeSource(null); setMergeTargetId(''); }}>{t('cancel')}</Button>
            <Button onClick={confirmMerge} disabled={!mergeTargetId || mergeTags.isPending}>
              {mergeTags.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin rtl:ml-2 rtl:mr-0" />}
              {t('mergeTag')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

export default TagsSection;
