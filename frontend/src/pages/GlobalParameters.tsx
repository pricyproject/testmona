import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectPermissions } from '@/hooks/useProjectPermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Search, Lock, Unlock, Loader2, Globe, FolderKanban } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { globalParametersAPI, getApiErrorMessage, type GlobalParameter } from '@/lib/api';

type ParamScope = 'project' | 'global';

interface ParamForm {
  name: string;
  value: string;
  description: string;
  parameter_type: string;
  is_encrypted: boolean;
  scope: ParamScope;
}

const emptyForm: ParamForm = {
  name: '',
  value: '',
  description: '',
  parameter_type: 'string',
  is_encrypted: false,
  scope: 'project',
};

interface ManagerProps {
  // null = manage cross-project global parameters (admin route); otherwise the
  // page is project-scoped and also surfaces inherited cross-project globals.
  projectId: number | null;
}

function ParametersManager({ projectId }: ManagerProps) {
  const { t, isRTL } = useTranslation();
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const { canWrite } = usePermissions();

  const isProjectPage = projectId != null;
  // Cross-project globals are admin-or-higher only — both to view and to manage.
  // "Admin or higher" = the ADMIN role or a superuser (manager/tester/viewer are
  // below admin), mirroring the backend's manage_users gate.
  const isAdmin = Boolean(user?.is_superuser) || user?.role?.toLowerCase() === 'admin';
  // Who can mutate which scope. Project params: anyone who reached the (guarded)
  // project page — the backend still enforces write. Global params: admins+.
  const canManageProject = isProjectPage && canWrite;
  // Deleting a parameter is a manager+ action even though testers can create/edit
  // (write) them — so the delete control needs the project's manage capability.
  const { canManageProject: canDeleteProjectParam } = useProjectPermissions(projectId);
  const canManageGlobal = isAdmin;
  // Non-admins can neither see nor edit cross-project globals.
  const canViewGlobal = isAdmin;

  const [globalParams, setGlobalParams] = useState<GlobalParameter[]>([]);
  const [projectParams, setProjectParams] = useState<GlobalParameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEncrypted, setShowEncrypted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ParamForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GlobalParameter | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    // Load this project's own parameters, plus the cross-project globals only
    // when the user is an admin+ (a non-admin would just get a 403). Settled
    // (not all-or-nothing) so one failing fetch still renders the other group.
    const [globalRes, projectRes] = await Promise.allSettled([
      canViewGlobal ? globalParametersAPI.list() : Promise.resolve([]),
      isProjectPage ? globalParametersAPI.list(projectId as number) : Promise.resolve([]),
    ]);

    if (globalRes.status === 'fulfilled') {
      setGlobalParams(globalRes.value);
    } else {
      setGlobalParams([]);
      toast({ title: t('error'), description: getApiErrorMessage(globalRes.reason, t('failedToLoadParameters')), variant: 'destructive' });
    }
    if (projectRes.status === 'fulfilled') {
      setProjectParams(projectRes.value);
    } else {
      setProjectParams([]);
      toast({ title: t('error'), description: getApiErrorMessage(projectRes.reason, t('failedToLoadParameters')), variant: 'destructive' });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();

  }, [projectId]);

  useEffect(() => {
    if (dialogOpen) setTimeout(() => nameInputRef.current?.focus(), 100);
  }, [dialogOpen]);

  const openCreate = () => {
    setEditingId(null);
    // Default to project scope on a project page; the admin page can only ever
    // create global parameters.
    setForm({ ...emptyForm, scope: isProjectPage ? 'project' : 'global' });
    setDialogOpen(true);
  };

  const openEdit = (param: GlobalParameter) => {
    setEditingId(param.id);
    setForm({
      name: param.name,
      value: param.value,
      description: param.description || '',
      parameter_type: param.parameter_type,
      is_encrypted: param.is_encrypted,
      scope: param.project_id == null ? 'global' : 'project',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.value.trim()) {
      toast({ title: t('error'), description: t('parameterNameRequired'), variant: 'destructive' });
      return;
    }
    // Guard the scope the user is actually allowed to write to (defence in depth
    // alongside the backend check).
    if (form.scope === 'global' && !canManageGlobal) {
      toast({ title: t('error'), description: t('onlyAdminsManageGlobalParameters'), variant: 'destructive' });
      return;
    }
    if (form.scope === 'project' && !isProjectPage) {
      toast({ title: t('error'), description: t('failedToSaveParameter'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editingId == null) {
        await globalParametersAPI.create({
          name: form.name.trim(),
          value: form.value,
          description: form.description.trim() || undefined,
          parameter_type: form.parameter_type,
          // Scope decides where it lives. Editing never moves a parameter.
          project_id: form.scope === 'global' ? null : projectId,
          is_encrypted: form.is_encrypted,
        });
        toast({ title: t('success'), description: t('parameterCreated') });
      } else {
        await globalParametersAPI.update(editingId, {
          name: form.name.trim(),
          value: form.value,
          description: form.description.trim(),
          parameter_type: form.parameter_type,
          is_encrypted: form.is_encrypted,
        });
        toast({ title: t('success'), description: t('parameterUpdated') });
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToSaveParameter')), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await globalParametersAPI.remove(deleteTarget.id);
      toast({ title: t('success'), description: t('parameterDeleted') });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast({ title: t('error'), description: getApiErrorMessage(err, t('failedToDeleteParameter')), variant: 'destructive' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const matchesSearch = (p: GlobalParameter) => {
    const q = searchTerm.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
  };

  const filteredProjectParams = useMemo(
    () => projectParams.filter(matchesSearch),

    [projectParams, searchTerm],
  );
  const filteredGlobalParams = useMemo(
    () => globalParams.filter(matchesSearch),

    [globalParams, searchTerm],
  );

  // Same name in both scopes => the project value wins. Used to render the
  // "overrides global" / "overridden by project" badges so the effective value
  // is unambiguous.
  const projectParamNames = useMemo(() => new Set(projectParams.map((p) => p.name)), [projectParams]);
  const globalParamNames = useMemo(() => new Set(globalParams.map((p) => p.name)), [globalParams]);

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      string: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      number: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      boolean: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      json: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const displayValue = (param: GlobalParameter) =>
    param.is_encrypted && !showEncrypted ? '••••••••' : param.value;

  const renderParamCard = (param: GlobalParameter, opts: { canManage: boolean; canDelete: boolean; scope: ParamScope }) => {
    const overridesGlobal = opts.scope === 'project' && globalParamNames.has(param.name);
    const overriddenByProject = opts.scope === 'global' && projectParamNames.has(param.name);
    return (
      <Card key={param.id} className={`hover:shadow-md transition-shadow ${overriddenByProject ? 'opacity-70' : ''}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-lg truncate" title={param.name}>{param.name}</CardTitle>
                {param.is_encrypted && <Lock className="h-4 w-4 text-orange-600" />}
                {overridesGlobal && (
                  <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
                    {t('overridesGlobalBadge')}
                  </Badge>
                )}
                {overriddenByProject && (
                  <Badge variant="outline" className="border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400">
                    {t('overriddenByProjectBadge')}
                  </Badge>
                )}
              </div>
              {param.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{param.description}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <Badge className={getTypeColor(param.parameter_type)}>{param.parameter_type}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {opts.canManage || opts.canDelete ? (
                <>
                  {opts.canManage && (
                    <Button variant="outline" size="sm" onClick={() => openEdit(param)} title={t('edit')}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  {opts.canDelete && (
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget(param)} title={t('delete')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </>
              ) : (
                <Badge variant="outline" className="text-gray-500">{t('readOnly')}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div>
              <h4 className="font-medium text-sm text-gray-700 dark:text-gray-300">{t('value')}:</h4>
              <p className={`text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 p-2 rounded font-mono break-all ${overriddenByProject ? 'line-through' : ''}`}>
                {displayValue(param)}
              </p>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('created')}: {new Date(param.created_at).toLocaleString()}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSection = (
    title: string,
    description: string,
    icon: React.ReactNode,
    params: GlobalParameter[],
    opts: { canManage: boolean; canDelete: boolean; scope: ParamScope; emptyLabel: string },
  ) => (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-xl font-semibold">{title}</h2>
        <Badge variant="secondary">{params.length}</Badge>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      {params.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">{opts.emptyLabel}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {params.map((param) => renderParamCard(param, { canManage: opts.canManage, canDelete: opts.canDelete, scope: opts.scope }))}
        </div>
      )}
    </section>
  );

  // Whether the create button is available at all on this page.
  const canCreateAnything = isProjectPage ? (canManageProject || canManageGlobal) : canManageGlobal;
  // A scope chooser only makes sense when the user can write to both scopes.
  const showScopeSelector = editingId == null && isProjectPage && canManageGlobal;
  const totalFiltered = filteredProjectParams.length + filteredGlobalParams.length;

  return (
    <div className="space-y-6 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{isProjectPage ? t('globalParameters') : t('globalParametersAdmin')}</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {isProjectPage ? t('mergedParametersDescription') : t('globalParametersAdminDescription')}
          </p>
        </div>
        {canCreateAnything && (
          <Button onClick={openCreate}>
            <Plus className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {t('createParameter')}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className={`absolute top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 ${isRTL ? 'right-3' : 'left-3'}`} />
          <Input
            placeholder={t('searchParameters')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={isRTL ? 'pr-10' : 'pl-10'}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowEncrypted(!showEncrypted)}>
          {showEncrypted ? <Unlock className="h-4 w-4 mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
          {showEncrypted ? t('hideEncrypted') : t('showEncrypted')}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      ) : totalFiltered === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t('noParametersYet')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Project section only exists on a project page. */}
          {isProjectPage && renderSection(
            t('projectParametersSection'),
            t('globalParametersDescription'),
            <FolderKanban className="h-5 w-5 text-blue-600" />,
            filteredProjectParams,
            { canManage: canManageProject, canDelete: canDeleteProjectParam, scope: 'project', emptyLabel: t('noProjectParametersYet') },
          )}
          {/* Cross-project globals are visible to admins+ only. */}
          {canViewGlobal && renderSection(
            t('crossProjectParameters'),
            t('crossProjectParametersDescription'),
            <Globe className="h-5 w-5 text-emerald-600" />,
            filteredGlobalParams,
            { canManage: canManageGlobal, canDelete: canManageGlobal, scope: 'global', emptyLabel: t('noGlobalParametersYet') },
          )}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{editingId == null ? t('createNewParameter') : t('editParameter')}</DialogTitle>
            <DialogDescription>{editingId == null ? t('createParameterDesc') : t('updateParameterDetails')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Scope: selectable only when creating and able to write both scopes;
                otherwise shown read-only so the destination is always explicit. */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('parameterScope')}</Label>
              {showScopeSelector ? (
                <Select value={form.scope} onValueChange={(value) => setForm((f) => ({ ...f, scope: value as ParamScope }))}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">{t('scopeThisProject')}</SelectItem>
                    <SelectItem value="global">{t('scopeGlobal')}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="col-span-3">
                  <Badge variant="outline">
                    {form.scope === 'global' ? t('scopeGlobal') : t('scopeThisProject')}
                  </Badge>
                </div>
              )}
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">{t('name')} *</Label>
              <div className="col-span-3 space-y-1">
                <Input
                  ref={nameInputRef}
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={form.name.trim() === '' ? 'border-red-300 focus:border-red-500' : ''}
                  placeholder={t('enterParameterName')}
                  maxLength={100}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{t('enterParameterName')}</span>
                  <span>{form.name.length}/100</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="type" className="text-right">{t('type')} *</Label>
              <Select value={form.parameter_type} onValueChange={(value) => setForm((f) => ({ ...f, parameter_type: value }))}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t('selectType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">{t('string')}</SelectItem>
                  <SelectItem value="number">{t('number')}</SelectItem>
                  <SelectItem value="boolean">{t('boolean')}</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="value" className="text-right pt-2">{t('value')} *</Label>
              <div className="col-span-3 space-y-1">
                <Textarea
                  id="value"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder={t('enterParameterValue')}
                  rows={2}
                  maxLength={1000}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{t('enterParameterValue')}</span>
                  <span>{form.value.length}/1000</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className="text-right pt-2">{t('description')}</Label>
              <div className="col-span-3 space-y-1">
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={t('enterParameterDescription')}
                  rows={2}
                  maxLength={500}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{t('enterParameterDescription')}</span>
                  <span>{form.description.length}/500</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="encrypted" className="text-right">{t('encrypted')}</Label>
              <Select value={form.is_encrypted.toString()} onValueChange={(value) => setForm((f) => ({ ...f, is_encrypted: value === 'true' }))}>
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">{t('no')}</SelectItem>
                  <SelectItem value="true">{t('yes')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="text-xs text-gray-500 mb-2 sm:mb-0 sm:mr-auto">{t('ctrlEnterToSubmit')}</div>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>{t('cancel')}</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.value.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteParameter')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteParameterConfirm', { name: deleteTarget?.name || '' })}</AlertDialogDescription>
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

// The single global-parameters page (route: /projects/:projectId/global-parameters).
// Shows the project's own parameters to all members, plus a cross-project
// "Global" section that is visible and editable for admins-or-higher only.
// (The former standalone /global-parameters admin page was merged into this one.)
export function GlobalParameters() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ParametersManager projectId={projectId ? parseInt(projectId) : null} />;
}

export default GlobalParameters;
