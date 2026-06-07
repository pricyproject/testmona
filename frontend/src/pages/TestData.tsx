import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Database, Loader2, Plus, Trash2, Pencil, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { datasetsAPI, getApiErrorMessage, type TestDataset } from '@/lib/api';

interface DatasetForm {
  name: string;
  description: string;
  params: string[];
  // Grid of values aligned to `params` by column index.
  grid: string[][];
}

const emptyForm: DatasetForm = {
  name: '',
  description: '',
  params: ['param1'],
  grid: [['']],
};

function datasetToForm(ds: TestDataset): DatasetForm {
  const params = [...ds.parameters];
  const grid = (ds.rows || []).map((row) => params.map((p) => (row[p] ?? '')));
  return {
    name: ds.name,
    description: ds.description || '',
    params: params.length ? params : ['param1'],
    grid: grid.length ? grid : [params.map(() => '')],
  };
}

export function TestData() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = projectId ? parseInt(projectId) : null;
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();

  const [datasets, setDatasets] = useState<TestDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DatasetForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TestDataset | null>(null);

  const load = async () => {
    if (!projectIdNum) return;
    setLoading(true);
    try {
      setDatasets(await datasetsAPI.list(projectIdNum));
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToLoadDatasets')), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
     
  }, [projectIdNum]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (ds: TestDataset) => {
    setEditingId(ds.id);
    setForm(datasetToForm(ds));
    setDialogOpen(true);
  };

  // --- grid editing helpers ---
  const setParamName = (idx: number, value: string) =>
    setForm((f) => ({ ...f, params: f.params.map((p, i) => (i === idx ? value : p)) }));
  const addParam = () =>
    setForm((f) => ({ ...f, params: [...f.params, ''], grid: f.grid.map((r) => [...r, '']) }));
  const removeParam = (idx: number) =>
    setForm((f) => ({
      ...f,
      params: f.params.filter((_, i) => i !== idx),
      grid: f.grid.map((r) => r.filter((_, i) => i !== idx)),
    }));
  const addRow = () => setForm((f) => ({ ...f, grid: [...f.grid, f.params.map(() => '')] }));
  const removeRow = (idx: number) => setForm((f) => ({ ...f, grid: f.grid.filter((_, i) => i !== idx) }));
  const setCell = (rowIdx: number, colIdx: number, value: string) =>
    setForm((f) => ({
      ...f,
      grid: f.grid.map((r, i) => (i === rowIdx ? r.map((c, j) => (j === colIdx ? value : c)) : r)),
    }));

  const trimmedParams = useMemo(() => form.params.map((p) => p.trim()), [form.params]);
  const validationError = useMemo(() => {
    if (!form.name.trim()) return t('datasetNameRequired');
    const nonEmpty = trimmedParams.filter(Boolean);
    if (nonEmpty.length === 0) return t('datasetNeedsParameter');
    if (new Set(nonEmpty).size !== nonEmpty.length) return t('datasetDuplicateParameter');
    return null;
  }, [form.name, trimmedParams, t]);

  const handleSave = async () => {
    if (!projectIdNum || validationError) {
      if (validationError) toast({ title: t('error'), description: validationError, variant: 'destructive' });
      return;
    }
    // Drop blank columns, then build row objects keyed by parameter name.
    const keepCols = form.params.map((p, i) => ({ name: p.trim(), i })).filter((c) => c.name);
    const params = keepCols.map((c) => c.name);
    const rows = form.grid.map((r) => Object.fromEntries(keepCols.map((c) => [c.name, r[c.i] ?? ''])));

    setSaving(true);
    try {
      if (editingId == null) {
        await datasetsAPI.create({ project_id: projectIdNum, name: form.name.trim(), description: form.description.trim() || undefined, parameters: params, rows });
        toast({ title: t('success'), description: t('datasetCreated') });
      } else {
        await datasetsAPI.update(editingId, { name: form.name.trim(), description: form.description.trim(), parameters: params, rows });
        toast({ title: t('success'), description: t('datasetUpdated') });
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToSaveDataset')), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await datasetsAPI.remove(deleteTarget.id);
      toast({ title: t('success'), description: t('datasetDeleted') });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToDeleteDataset')), variant: 'destructive' });
    }
  };

  return (
    <div className="p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" /> {t('testData')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('testDataDescription')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} /> {t('newDataset')}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      ) : datasets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t('noDatasetsYet')}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {datasets.map((ds) => (
            <Card key={ds.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base truncate" title={ds.name}>{ds.name}</CardTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(ds)} title={t('edit')}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(ds)} title={t('delete')}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {ds.description && <p className="text-xs text-muted-foreground line-clamp-2">{ds.description}</p>}
              </CardHeader>
              <CardContent className="flex-1 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {ds.parameters.map((p) => (
                    <Badge key={p} variant="secondary" className="text-[10px]">{p}</Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('datasetRowCount', { count: String(ds.rows.length) })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{editingId == null ? t('newDataset') : t('editDataset')}</DialogTitle>
            <DialogDescription>{t('datasetDialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('name')}</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus placeholder={t('datasetNamePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('description')}</Label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('parameters')}</Label>
                <Button type="button" variant="outline" size="sm" onClick={addParam}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t('addColumn')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('datasetParametersHint')}</p>

              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="w-8 p-1"></th>
                      {form.params.map((p, i) => (
                        <th key={i} className="p-1 min-w-[140px]">
                          <div className="flex items-center gap-1">
                            <Input
                              value={p}
                              onChange={(e) => setParamName(i, e.target.value)}
                              placeholder={t('columnNamePlaceholder')}
                              className="h-8 font-mono text-xs"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground"
                              onClick={() => removeParam(i)}
                              disabled={form.params.length <= 1}
                              title={t('removeColumn')}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.grid.map((row, rIdx) => (
                      <tr key={rIdx} className="border-t">
                        <td className="p-1 align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeRow(rIdx)}
                            title={t('removeRow')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                        {form.params.map((_, cIdx) => (
                          <td key={cIdx} className="p-1">
                            <Input
                              value={row[cIdx] ?? ''}
                              onChange={(e) => setCell(rIdx, cIdx, e.target.value)}
                              className="h-8 text-xs"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5 mr-1" /> {t('addRow')}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !!validationError}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDataset')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDatasetConfirm', { name: deleteTarget?.name || '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TestData;
