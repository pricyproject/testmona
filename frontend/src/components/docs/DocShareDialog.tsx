import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Clock,
  Copy,
  Globe,
  History,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Share2,
  Shield,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { docsAPI, getApiErrorMessage, projectAssignmentsAPI, projectsAPI } from '@/lib/api';
import { formatServerDateTime } from '@/utils/datetime';
import { copyToClipboard } from '@/utils/clipboard';
import type {
  DocShareAuditEntry,
  DocShareGrant,
  DocShareGrantType,
  DocShareInfo,
  DocShareRole,
  DocShareScope,
} from '@/types';

interface ProjectMemberLite {
  user_id: number;
  username: string;
  full_name?: string | null;
  email?: string | null;
}

interface ProjectLite {
  id: number;
  name: string;
}

const SHARE_ROLES: DocShareRole[] = ['viewer', 'tester', 'manager', 'admin'];

interface DocShareDialogProps {
  docId: number;
  /** Project the doc belongs to (null/undefined for a global doc). */
  projectId?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Notifies the parent so it can refresh the doc's scope badge. */
  onScopeChange?: (scope: DocShareScope) => void;
}

export function DocShareDialog({ docId, projectId, open, onOpenChange, onScopeChange }: DocShareDialogProps) {
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();

  const [info, setInfo] = useState<DocShareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingScope, setSavingScope] = useState<DocShareScope | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  // Subject pickers (only relevant for project-scoped docs).
  const [members, setMembers] = useState<ProjectMemberLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [grantType, setGrantType] = useState<DocShareGrantType>('user');
  const [subjectUserId, setSubjectUserId] = useState<string>('');
  const [subjectRole, setSubjectRole] = useState<DocShareRole>('viewer');
  const [subjectProjectId, setSubjectProjectId] = useState<string>('');
  const [grantExpiry, setGrantExpiry] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Audit trail.
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<DocShareAuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const scope: DocShareScope | null = info?.share_scope ?? null;

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docsAPI.getShare(docId);
      setInfo(data);
    } catch (e: unknown) {
      toast({ title: t('error'), description: getApiErrorMessage(e, t('docShareFailed')), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [docId, t, toast]);

  useEffect(() => {
    if (!open) return;
    setAuditOpen(false);
    setAudit(null);
    loadInfo();
    if (projectId) {
      projectAssignmentsAPI.listMembers(projectId).then(setMembers).catch(() => setMembers([]));
      projectsAPI.getAll(0, 200).then((rows: ProjectLite[]) => setProjects(rows || [])).catch(() => setProjects([]));
    }
  }, [open, projectId, loadInfo]);

  const applyInfo = (data: DocShareInfo) => {
    setInfo(data);
    onScopeChange?.(data.share_scope);
  };

  const changeScope = async (next: DocShareScope) => {
    if (savingScope || next === scope) return;
    setSavingScope(next);
    try {
      const data = await docsAPI.updateShare(docId, { share_scope: next });
      applyInfo(data);
    } catch (e: unknown) {
      toast({ title: t('error'), description: getApiErrorMessage(e, t('docShareFailed')), variant: 'destructive' });
    } finally {
      setSavingScope(null);
    }
  };

  const copyLink = async () => {
    if (!info?.share_url) return;
    if (await copyToClipboard(`${window.location.origin}${info.share_url}`)) {
      setCopied(true);
      // Cleared on unmount too, so the timer can't fire against a dead component.
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } else {
      toast({ title: t('error'), description: t('docCopyFailed'), variant: 'destructive' });
    }
  };

  const addGrant = async () => {
    const payload: any = { grant_type: grantType };
    if (grantType === 'user') {
      if (!subjectUserId) return;
      payload.subject_user_id = Number(subjectUserId);
    } else if (grantType === 'role') {
      payload.subject_role = subjectRole;
    } else {
      if (!subjectProjectId) return;
      payload.subject_project_id = Number(subjectProjectId);
    }
    if (grantExpiry) payload.expires_at = new Date(grantExpiry).toISOString();
    setAdding(true);
    try {
      const data = await docsAPI.addShareGrant(docId, payload);
      applyInfo(data);
      setSubjectUserId('');
      setSubjectProjectId('');
      setGrantExpiry('');
      if (audit) setAudit(null); // invalidate so it reloads fresh on next open
    } catch (e: unknown) {
      toast({ title: t('error'), description: getApiErrorMessage(e, t('docShareGrantFailed')), variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const removeGrant = async (grant: DocShareGrant) => {
    setRemovingId(grant.id);
    try {
      const data = await docsAPI.removeShareGrant(docId, grant.id);
      applyInfo(data);
      if (audit) setAudit(null);
    } catch (e: unknown) {
      toast({ title: t('error'), description: getApiErrorMessage(e, t('docShareGrantFailed')), variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  const toggleAudit = async () => {
    const next = !auditOpen;
    setAuditOpen(next);
    if (next && audit === null) {
      setAuditLoading(true);
      try {
        setAudit(await docsAPI.getShareAudit(docId));
      } catch {
        setAudit([]);
      } finally {
        setAuditLoading(false);
      }
    }
  };

  const grantIcon = (type: DocShareGrantType) =>
    type === 'user' ? <UserIcon className="h-4 w-4" /> : type === 'role' ? <Shield className="h-4 w-4" /> : <Users className="h-4 w-4" />;

  const auditLabel = (action: string) => t(`docShareAudit_${action}`) || action.replace(/_/g, ' ');

  const scopeOptions: { value: DocShareScope; icon: ReactNode; label: string; desc: string }[] = [
    { value: 'private', icon: <Lock className="h-4 w-4" />, label: t('docScopePrivate'), desc: t('docScopePrivateDesc') },
    { value: 'restricted', icon: <Users className="h-4 w-4" />, label: t('docScopeRestricted'), desc: t('docScopeRestrictedDesc') },
    { value: 'public', icon: <Globe className="h-4 w-4" />, label: t('docScopePublic'), desc: t('docScopePublicDesc') },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRTL ? 'rtl' : 'ltr'} className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="h-5 w-5 text-primary" />{t('share')}</DialogTitle>
          <DialogDescription>{t('docShareDesc')}</DialogDescription>
        </DialogHeader>

        {loading && !info ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !info ? (
          // Nothing is known about the current scope, so every control is disabled —
          // falling back to a default here would let the first click un-share the doc.
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t('docShareFailed')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadInfo()}>
              <RotateCcw className={`h-4 w-4 ${isRTL ? 'ml-1' : 'mr-1'}`} /> {t('retry')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Scope selector */}
            <div className="grid grid-cols-3 gap-2">
              {scopeOptions.map((opt) => {
                const active = scope === opt.value;
                const busy = savingScope === opt.value;
                // Restricted sharing only applies to project docs (the backend
                // rejects it for global docs), so disable it there.
                const blocked = opt.value === 'restricted' && !projectId;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => changeScope(opt.value)}
                    aria-pressed={active}
                    disabled={!!savingScope || blocked}
                    title={blocked ? t('docShareGlobalRestricted') : opt.desc}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-slate-200 text-muted-foreground hover:border-slate-300 dark:border-slate-800'
                    }`}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : opt.icon}
                    <span className="font-medium">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{scopeOptions.find((o) => o.value === scope)?.desc}</p>

            {/* Public link */}
            {scope === 'public' && info?.share_url && (
              <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}${info.share_url}`}
                    onFocus={(e) => e.currentTarget.select()}
                    className="font-mono text-xs"
                    dir="ltr"
                  />
                  <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copyLink} title={t('copy')}>
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                {info.share_expires_at && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    {t('docShareExpiresAt', { date: formatServerDateTime(info.share_expires_at, language) })}
                  </p>
                )}
              </div>
            )}

            {/* Restricted grants */}
            {scope === 'restricted' && (
              <div className="space-y-3">
                {!projectId ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    {t('docShareGlobalRestricted')}
                  </p>
                ) : (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-28">
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('docShareGrantType')}</label>
                        <Select value={grantType} onValueChange={(v) => setGrantType(v as DocShareGrantType)}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">{t('docShareGrantUser')}</SelectItem>
                            <SelectItem value="role">{t('docShareGrantRole')}</SelectItem>
                            <SelectItem value="project">{t('docShareGrantProject')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-[10rem] flex-1">
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('docShareGrantSubject')}</label>
                        {grantType === 'user' && (
                          <Select value={subjectUserId} onValueChange={setSubjectUserId}>
                            <SelectTrigger className="h-9"><SelectValue placeholder={t('docShareSelectUser')} /></SelectTrigger>
                            <SelectContent>
                              {members.map((m) => (
                                <SelectItem key={m.user_id} value={String(m.user_id)}>
                                  {m.full_name || m.username}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {grantType === 'role' && (
                          <Select value={subjectRole} onValueChange={(v) => setSubjectRole(v as DocShareRole)}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SHARE_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>{t(`role_${r}`) || r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {grantType === 'project' && (
                          <Select value={subjectProjectId} onValueChange={setSubjectProjectId}>
                            <SelectTrigger className="h-9"><SelectValue placeholder={t('docShareSelectProject')} /></SelectTrigger>
                            <SelectContent>
                              {projects.map((p) => (
                                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('docShareExpiryOptional')}</label>
                        <Input
                          type="datetime-local"
                          value={grantExpiry}
                          onChange={(e) => setGrantExpiry(e.target.value)}
                          className="h-9 text-xs"
                        />
                      </div>
                      <Button type="button" size="sm" onClick={addGrant} disabled={adding}>
                        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        <span className={isRTL ? 'mr-1' : 'ml-1'}>{t('add')}</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Grant list */}
                <div className="space-y-2">
                  {(info?.grants ?? []).length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground">{t('docShareNoGrants')}</p>
                  ) : (
                    (info?.grants ?? []).map((grant) => (
                      <div
                        key={grant.id}
                        className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800"
                      >
                        <span className="text-muted-foreground">{grantIcon(grant.grant_type)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{grant.subject_label || `#${grant.id}`}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {grant.subject_sublabel}
                            {grant.expires_at && (
                              <span className="inline-flex items-center gap-1">
                                {grant.subject_sublabel ? ' · ' : ''}
                                <Clock className="inline h-3 w-3" />
                                {t('docShareExpiresAt', { date: formatServerDateTime(grant.expires_at) })}
                              </span>
                            )}
                          </p>
                        </div>
                        {grant.is_expired && <Badge variant="outline" className="text-[10px] text-amber-600">{t('docShareExpired')}</Badge>}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-rose-600"
                          onClick={() => removeGrant(grant)}
                          disabled={removingId === grant.id}
                          title={t('docShareRevoke')}
                        >
                          {removingId === grant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Audit trail */}
            <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={toggleAudit}
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <History className="h-4 w-4" />
                {t('docShareAuditTrail')}
                {auditLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </button>
              {auditOpen && (
                <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                  {audit && audit.length > 0 ? (
                    audit.map((row) => (
                      <div key={row.id} className="flex items-start gap-2 text-[11px]">
                        <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{auditLabel(row.action)}</Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground">{row.detail || '—'}</p>
                          <p className="text-muted-foreground">
                            {row.actor_name || t('docShareAnonymous')}
                            {row.created_at ? ` · ${formatServerDateTime(row.created_at, language)}` : ''}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    !auditLoading && <p className="text-center text-[11px] text-muted-foreground">{t('docShareNoAudit')}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
