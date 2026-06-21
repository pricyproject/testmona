import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, ShieldAlert, Trash2, UserCheck, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Label } from '@/components/ui/label';
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
import { useDateFormat } from '@/hooks/useDateFormat';
import { useAuthStore } from '@/stores/authStore';
import { projectAssignmentsAPI, projectsAPI, usersAPI, getApiErrorMessage } from '@/lib/api';
import { isAdminUser, normalizeRole, USER_ROLES, type UserRole } from '@/utils/roles';

interface ProjectMember {
  assignment_id: number | null;
  user_id: number;
  project_id: number;
  username: string;
  email?: string | null;
  full_name?: string | null;
  role: string;
  is_owner: boolean;
  assigned_at?: string | null;
  assigned_by?: number | null;
}

interface UserRow {
  id: number;
  username: string;
  email: string;
  full_name?: string | null;
  role: string;
  is_active: boolean;
}

interface ProjectSummary {
  id: number;
  name: string;
  owner_id?: number | null;
  owner_name?: string | null;
}

const ROLE_OPTIONS: UserRole[] = [
  USER_ROLES.VIEWER,
  USER_ROLES.TESTER,
  USER_ROLES.MANAGER,
  USER_ROLES.ADMIN,
];

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  [USER_ROLES.ADMIN]: 'default',
  [USER_ROLES.MANAGER]: 'default',
  [USER_ROLES.TESTER]: 'secondary',
  [USER_ROLES.VIEWER]: 'outline',
};

export function ProjectMembers() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { formatDate: fmtDate } = useDateFormat();
  const { toast } = useToast();
  const { user: currentUser } = useAuthStore();

  const numericProjectId = projectId ? Number(projectId) : null;

  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAssignmentId, setSavingAssignmentId] = useState<number | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newUserId, setNewUserId] = useState<string>('');
  const [newRole, setNewRole] = useState<UserRole>(USER_ROLES.TESTER);
  const [isAdding, setIsAdding] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const isOwnerOfThisProject = Boolean(
    project?.owner_id && currentUser && project.owner_id === currentUser.id,
  );
  const currentUserMember = useMemo(
    () => members.find((m) => m.user_id === currentUser?.id) || null,
    [members, currentUser?.id],
  );
  const currentUserProjectRole = normalizeRole(currentUserMember?.role);
  const hasProjectAdminOrManagerAssignment =
    currentUserProjectRole === USER_ROLES.ADMIN || currentUserProjectRole === USER_ROLES.MANAGER;
  const canManage = Boolean(
    isAdminUser(currentUser) ||
    normalizeRole(currentUser?.role) === USER_ROLES.MANAGER ||
    isOwnerOfThisProject ||
    hasProjectAdminOrManagerAssignment,
  );

  const loadAll = async () => {
    if (!numericProjectId || Number.isNaN(numericProjectId)) {
      setError(t('invalidProjectId'));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [projectData, memberData] = await Promise.all([
        projectsAPI.getById(numericProjectId),
        projectAssignmentsAPI.listMembers(numericProjectId),
      ]);
      setProject({
        id: projectData.id,
        name: projectData.name,
        owner_id: projectData.owner_id,
        owner_name: projectData.owner_name,
      });
      setMembers(memberData as ProjectMember[]);

      // Try to load the user directory regardless — non-admins get a 403,
      // which we swallow so the page still renders the read-only members view.
      try {
        const users = await usersAPI.getAll(0, 500);
        setAllUsers(users as UserRow[]);
      } catch (userError) {
        // Directory listing requires manage_users; project admins/managers
        // without that global permission still see existing members.
        console.warn('Failed to load user directory:', userError);
      }
    } catch (err) {
      console.error('Failed to load members:', err);
      setError(getApiErrorMessage(err, t('failedToLoadMembers')));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();

  }, [numericProjectId, currentUser?.id]);

  const assignableUsers = useMemo(() => {
    const taken = new Set(members.map((m) => m.user_id));
    return allUsers
      .filter((u) => u.is_active)
      .filter((u) => !taken.has(u.id))
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [allUsers, members]);

  const handleRoleChange = async (member: ProjectMember, role: UserRole) => {
    if (!member.assignment_id) return;
    if (member.role === role) return;
    setSavingAssignmentId(member.assignment_id);
    try {
      const updated = await projectAssignmentsAPI.updateRole(member.assignment_id, role);
      setMembers((prev) =>
        prev.map((m) =>
          m.assignment_id === member.assignment_id
            ? { ...m, role: normalizeRole(updated.role) || role }
            : m,
        ),
      );
      toast({
        title: t('success'),
        description: t('memberRoleUpdated'),
      });
    } catch (err) {
      console.error('Failed to update role:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToUpdateMemberRole')),
        variant: 'destructive',
      });
    } finally {
      setSavingAssignmentId(null);
    }
  };

  const handleAddMember = async () => {
    if (!numericProjectId) return;
    const userId = Number(newUserId);
    if (!Number.isFinite(userId) || userId <= 0) {
      toast({
        title: t('error'),
        description: t('pleaseSelectUser'),
        variant: 'destructive',
      });
      return;
    }
    setIsAdding(true);
    try {
      await projectAssignmentsAPI.add(numericProjectId, userId, newRole);
      await loadAll();
      setAddDialogOpen(false);
      setNewUserId('');
      setNewRole(USER_ROLES.TESTER);
      toast({
        title: t('success'),
        description: t('memberAdded'),
      });
    } catch (err) {
      console.error('Failed to add member:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToAddMember')),
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  const handleRemove = async () => {
    if (!removeTarget?.assignment_id) return;
    setIsRemoving(true);
    try {
      await projectAssignmentsAPI.remove(removeTarget.assignment_id);
      setMembers((prev) => prev.filter((m) => m.assignment_id !== removeTarget.assignment_id));
      toast({ title: t('success'), description: t('memberRemoved') });
      setRemoveTarget(null);
    } catch (err) {
      console.error('Failed to remove member:', err);
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToRemoveMember')),
        variant: 'destructive',
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const formatDate = (value?: string | null) => (value ? fmtDate(value) || '-' : '-');

  const roleLabel = (role: string) => {
    const normalized = normalizeRole(role);
    const map: Record<string, string> = {
      [USER_ROLES.ADMIN]: t('admin'),
      [USER_ROLES.MANAGER]: t('manager'),
      [USER_ROLES.TESTER]: t('tester'),
      [USER_ROLES.VIEWER]: t('viewer'),
    };
    return map[normalized] || normalized;
  };

  if (!numericProjectId || Number.isNaN(numericProjectId)) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t('invalidProjectId')}</div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/projects')}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('projects')}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('projectMembers')}</h1>
            <p className="text-sm text-muted-foreground">
              {project ? project.name : t('loading')}
            </p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setAddDialogOpen(true)} size="sm" className="gap-2">
            <UserPlus className="h-4 w-4" />
            {t('addMember')}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('rolesAndPermissions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div className="flex items-start gap-2">
              <Badge variant="default" className="mt-0.5">{t('admin')}</Badge>
              <span className="text-muted-foreground">{t('rolePermsAdmin')}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="default" className="mt-0.5">{t('manager')}</Badge>
              <span className="text-muted-foreground">{t('rolePermsManager')}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="secondary" className="mt-0.5">{t('tester')}</Badge>
              <span className="text-muted-foreground">{t('rolePermsTester')}</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5">{t('viewer')}</Badge>
              <span className="text-muted-foreground">{t('rolePermsViewer')}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            {t('members')}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? t('memberSingular') : t('memberPlural')}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="flex items-center gap-2 p-6 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          ) : isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('username')}</TableHead>
                  <TableHead>{t('email')}</TableHead>
                  <TableHead>{t('role')}</TableHead>
                  <TableHead>{t('joined')}</TableHead>
                  <TableHead className="text-end">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {t('noMembersYet')}
                    </TableCell>
                  </TableRow>
                ) : (
                  members.map((member) => {
                    const roleNormalized = normalizeRole(member.role);
                    const badgeVariant = ROLE_BADGE_VARIANT[roleNormalized] || 'secondary';
                    const isSelf = currentUser?.id === member.user_id;
                    // Forbid self-edits so a manager can't accidentally
                    // demote or remove themselves and lock out of the page.
                    const editable = canManage && !member.is_owner && !isSelf && Boolean(member.assignment_id);
                    return (
                      <TableRow key={`${member.user_id}-${member.assignment_id ?? 'owner'}`}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{member.username}</span>
                            {member.full_name && (
                              <span className="text-xs text-muted-foreground">
                                {member.full_name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {member.email || '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {editable ? (
                              <Select
                                value={roleNormalized}
                                onValueChange={(value) =>
                                  handleRoleChange(member, value as UserRole)
                                }
                                disabled={savingAssignmentId === member.assignment_id}
                              >
                                <SelectTrigger className="h-8 w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_OPTIONS.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {roleLabel(role)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant={badgeVariant}>{roleLabel(roleNormalized)}</Badge>
                            )}
                            {member.is_owner && (
                              <Badge variant="outline" className="text-xs">
                                {t('owner')}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(member.assigned_at)}
                        </TableCell>
                        <TableCell className="text-end">
                          {editable && !isSelf ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRemoveTarget(member)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('addMember')}</DialogTitle>
            <DialogDescription>{t('addMemberDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('user')}</Label>
              <Select value={newUserId} onValueChange={setNewUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectUser')} />
                </SelectTrigger>
                <SelectContent>
                  {assignableUsers.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {t('noUsersAvailable')}
                    </div>
                  ) : (
                    assignableUsers.map((user) => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.username}
                        {user.full_name ? ` — ${user.full_name}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('role')}</Label>
              <Select value={newRole} onValueChange={(value) => setNewRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={isAdding}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAddMember} disabled={isAdding || !newUserId} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('addMember')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeMember')}</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? t('removeMemberConfirm', { username: removeTarget.username })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleRemove();
              }}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
