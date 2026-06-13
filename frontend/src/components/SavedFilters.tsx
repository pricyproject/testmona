import { useEffect, useState } from 'react';
import { Bookmark, BookmarkPlus, Check, Loader2, Star, Trash2, Users2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { getApiErrorMessage, savedFiltersAPI, type SavedFilter, type SavedFilterScope } from '@/lib/api';

interface Props {
  projectId: number;
  scope: SavedFilterScope;
  /** Current filter state to capture when "Save current" is clicked. */
  currentDefinition: Record<string, any>;
  /** Are any filters currently applied? Drives the disabled state of Save. */
  hasActiveFilters: boolean;
  /** Apply the saved definition to the page state. */
  onApply: (definition: Record<string, any>) => void;
  /** Apply on mount when the user has a default filter for this scope. */
  applyDefaultOnMount?: boolean;
}

export function SavedFilters({ projectId, scope, currentDefinition, hasActiveFilters, onApply, applyDefaultOnMount = true }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [appliedId, setAppliedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [newDefault, setNewDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const rows = await savedFiltersAPI.list(projectId, scope);
        if (cancelled) return;
        setFilters(rows);
        if (applyDefaultOnMount) {
          const def = rows.find((row) => row.is_default);
          if (def) {
            onApply(def.definition || {});
            setAppliedId(def.id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          toast({
            title: t('error'),
            description: getApiErrorMessage(err, t('failedToLoadSavedFilters')),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };

  }, [projectId, scope]);

  const apply = (filter: SavedFilter) => {
    onApply(filter.definition || {});
    setAppliedId(filter.id);
    toast({ title: t('success'), description: t('filterApplied', { name: filter.name }) });
  };

  const handleSave = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ title: t('error'), description: t('savedFilterNameRequired'), variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const created = await savedFiltersAPI.create({
        project_id: projectId,
        scope,
        name,
        definition: currentDefinition,
        is_default: newDefault,
        is_shared: newShared,
      });
      // The backend demotes any prior default in this scope when ``is_default``
      // is set, so mirror that locally so two rows don't show as default.
      setFilters((prev) => {
        const cleaned = newDefault ? prev.map((row) => ({ ...row, is_default: false })) : prev;
        return [...cleaned, created].sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || a.name.localeCompare(b.name));
      });
      setAppliedId(created.id);
      setDialogOpen(false);
      setNewName('');
      setNewShared(false);
      setNewDefault(false);
      toast({ title: t('success'), description: t('savedFilterSaved') });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToSaveSavedFilter')),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (filter: SavedFilter) => {
    try {
      await savedFiltersAPI.remove(filter.id);
      setFilters((prev) => prev.filter((row) => row.id !== filter.id));
      if (appliedId === filter.id) setAppliedId(null);
      toast({ title: t('success'), description: t('savedFilterRemoved') });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToDeleteSavedFilter')),
        variant: 'destructive',
      });
    }
  };

  const handleSetDefault = async (filter: SavedFilter) => {
    try {
      const updated = await savedFiltersAPI.update(filter.id, { is_default: !filter.is_default });
      setFilters((prev) => {
        const next = prev.map((row) =>
          row.id === filter.id
            ? { ...row, is_default: updated.is_default }
            : updated.is_default
              ? { ...row, is_default: false }
              : row,
        );
        return next.sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || a.name.localeCompare(b.name));
      });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateSavedFilter')),
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Bookmark className="h-4 w-4" />
              {appliedId != null
                ? filters.find((f) => f.id === appliedId)?.name || t('savedFilters')
                : t('savedFilters')}
              {filters.length > 0 && <span className="text-xs text-muted-foreground">({filters.length})</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>{t('savedFilters')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isLoading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('loading')}
              </div>
            ) : filters.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">{t('noSavedFiltersYet')}</div>
            ) : (
              filters.map((filter) => (
                <DropdownMenuItem
                  key={filter.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    apply(filter);
                  }}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {appliedId === filter.id && <Check className="h-3 w-3 text-primary shrink-0" />}
                      <span className="truncate text-sm">{filter.name}</span>
                      {filter.is_default && <Star className="h-3 w-3 fill-amber-500 text-amber-500 shrink-0" />}
                      {filter.is_shared && <Users2 className="h-3 w-3 text-blue-500 shrink-0" />}
                    </div>
                    {!filter.owned_by_current_user && (
                      <p className="text-[10px] text-muted-foreground">{t('savedFilterSharedNotice')}</p>
                    )}
                  </div>
                  {filter.owned_by_current_user && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetDefault(filter);
                        }}
                        title={filter.is_default ? t('unsetDefaultFilter') : t('setDefaultFilter')}
                      >
                        <Star className={`h-3 w-3 ${filter.is_default ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground'}`} />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-destructive/10 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(filter);
                        }}
                        title={t('delete')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setDialogOpen(true);
              }}
              disabled={!hasActiveFilters}
            >
              <BookmarkPlus className="h-4 w-4 mr-2" />
              {t('saveCurrentFilters')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('saveCurrentFilters')}</DialogTitle>
            <DialogDescription>{t('saveCurrentFiltersDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('name')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && newName.trim() && !isSaving) {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                autoFocus
                placeholder={t('savedFilterNamePlaceholder')}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={newDefault} onCheckedChange={(v) => setNewDefault(v === true)} />
              {t('savedFilterMakeDefault')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={newShared} onCheckedChange={(v) => setNewShared(v === true)} />
              {t('savedFilterShareWithProject')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !newName.trim()}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
