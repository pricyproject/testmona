import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  useManagedUsers,
  useManagedInvitations,
  useManagedProjects,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserTwoFactor,
  useInviteUser,
  useDeleteInvitation,
} from '@/hooks/queries/userManagement';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, MoreHorizontal, Trash2, Edit, Mail, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { USER_ROLES, isAdminRole, isAdminUser, normalizeRole } from '@/utils/roles';

interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
  two_factor_enabled: boolean;
  created_at: string;
}

interface Invitation {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  is_used: boolean;
  created_at: string;
}

interface Project {
  id: number;
  name: string;
}

const isInvitationExpired = (expiresAt: string) => {
  const expirationTime = new Date(expiresAt).getTime();
  return Number.isFinite(expirationTime) && expirationTime < Date.now();
};

export function UserManagement() {
  const { t, isRTL, language } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser } = useAuthStore();
  const isAdmin = isAdminUser(currentUser);
  const usersQuery = useManagedUsers(isAdmin);
  const invitationsQuery = useManagedInvitations(isAdmin);
  const projectsQuery = useManagedProjects(isAdmin);
  const users: User[] = usersQuery.data ?? [];
  const invitations: Invitation[] = invitationsQuery.data ?? [];
  const projects: Project[] = projectsQuery.data ?? [];

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const resetUserTwoFactor = useResetUserTwoFactor();
  const inviteUser = useInviteUser();
  const deleteInvitationMutation = useDeleteInvitation();


  // Invite dialog state
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>(USER_ROLES.TESTER);
  const [selectedProjects, setSelectedProjects] = useState<number[]>([]);
  
  // Create user dialog state
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createFullName, setCreateFullName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<string>(USER_ROLES.TESTER);
  const [createIsActive, setCreateIsActive] = useState(true);
  
  // Edit user dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState('');
  const [originalRole, setOriginalRole] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  
  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const getRoleLabel = (role: string) => {
    const normalizedRole = normalizeRole(role);
    const roleLabels: Record<string, string> = {
      [USER_ROLES.TESTER]: t('tester'),
      [USER_ROLES.VIEWER]: t('viewer'),
      [USER_ROLES.MANAGER]: t('manager'),
      [USER_ROLES.ADMIN]: t('admin'),
    };

    return roleLabels[normalizedRole] || normalizedRole;
  };

  const handleCreateUser = async () => {
    if (!createUsername || !createEmail || !createPassword) {
      toast({
        title: t('error'),
        description: t('pleaseFillRequiredFields'),
        variant: "destructive",
      });
      return;
    }

    try {
      await createUser.mutateAsync({
        username: createUsername,
        email: createEmail,
        full_name: createFullName,
        password: createPassword,
        role: normalizeRole(createRole),
        is_active: createIsActive,
      });

      toast({
        title: t('success'),
        description: t('userCreatedSuccessfully', { username: createUsername }),
      });
      
      // Reset form
      setCreateUsername('');
      setCreateEmail('');
      setCreateFullName('');
      setCreatePassword('');
      setCreateRole(USER_ROLES.TESTER);
      setCreateIsActive(true);
      setCreateUserDialogOpen(false);
    } catch (error: any) {
      console.error('Failed to create user:', error);
      toast({
        title: t('error'),
        description: error.message || t('failedToCreateUser'),
        variant: "destructive",
      });
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail) {
      toast({
        title: t('error'),
        description: t('pleaseEnterEmailAddress'),
        variant: "destructive",
      });
      return;
    }

    try {
      await inviteUser.mutateAsync({
        email: inviteEmail,
        role: normalizeRole(inviteRole),
        project_ids: selectedProjects,
      });

      toast({
        title: t('success'),
        description: t('invitationSentCopyLink', { email: inviteEmail }),
      });
      
      // Reset form
      setInviteEmail('');
      setInviteRole(USER_ROLES.TESTER);
      setSelectedProjects([]);
      setInviteDialogOpen(false);
    } catch (error: any) {
      console.error('Failed to invite user:', error);
      toast({
        title: t('error'),
        description: error.message || t('failedToSendInvitation'),
        variant: "destructive",
      });
    }
  };

  const handleDeleteUser = (user: User) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      await deleteUser.mutateAsync(userToDelete.id);

      toast({
        title: t('success'),
        description: t('userDeletedSuccessfully'),
      });
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (error: any) {
      console.error('Failed to delete user:', error);
      const errorMessage = error.response?.data?.detail || t('failedToDeleteUser');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    const normalizedRole = normalizeRole(user.role);
    setEditRole(normalizedRole);
    setOriginalRole(normalizedRole);
    setEditIsActive(user.is_active);
    setEditDialogOpen(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    try {
      await updateUser.mutateAsync({
        id: editingUser.id,
        payload: {
          role: normalizeRole(editRole),
          is_active: editIsActive,
        },
      });

      toast({
        title: t('success'),
        description: t('userUpdatedSuccessfully'),
      });

      setEditDialogOpen(false);
      setEditingUser(null);
    } catch (error: any) {
      console.error('Failed to update user:', error);
      const errorMessage = error.response?.data?.detail || t('failedToUpdateUser');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleResetTwoFactor = async (user: User) => {
    if (!window.confirm(t('reset2FAConfirm', { username: user.username || user.email }))) {
      return;
    }

    try {
      await resetUserTwoFactor.mutateAsync(user.id);
      toast({
        title: t('success'),
        description: t('reset2FASuccess', { username: user.username || user.email }),
      });
    } catch (error: any) {
      console.error('Failed to reset two-factor authentication:', error);
      toast({
        title: t('error'),
        description: error.response?.data?.detail || t('reset2FAFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteInvitation = async (invitationId: number) => {
    try {
      await deleteInvitationMutation.mutateAsync(invitationId);

      toast({
        title: t('success'),
        description: t('invitationDeletedSuccessfully'),
      });
    } catch (error: any) {
      console.error('Failed to delete invitation:', error);
      const errorMessage = error.response?.data?.detail || t('failedToDeleteInvitation');
      toast({
        title: t('error'),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const toggleProjectSelection = (projectId: number) => {
    setSelectedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  if (!isAdminUser(currentUser)) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {t('accessDenied')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Users Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{t('users')}</h3>
          <div className="flex items-center gap-2">
            <Button onClick={() => setCreateUserDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('createUser')}
            </Button>
            <Button onClick={() => setInviteDialogOpen(true)} size="sm" variant="outline">
              <Mail className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('inviteUser')}
            </Button>
          </div>
        </div>
        
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('username')}</TableHead>
                <TableHead>{t('email')}</TableHead>
                <TableHead>{t('fullName')}</TableHead>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('twoFactorAuth')}</TableHead>
                <TableHead>{t('created')}</TableHead>
                <TableHead className="text-end">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                    {t('noUsersFound')}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.full_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={isAdminRole(user.role) ? 'default' : 'secondary'}>
                        {getRoleLabel(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? 'default' : 'secondary'}>
                        {user.is_active ? t('active') : t('inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.two_factor_enabled ? 'default' : 'secondary'}>
                        {user.two_factor_enabled ? t('enabled') : t('disabled')}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(user.created_at).toLocaleDateString(language)}</TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditUser(user)}>
                            <Edit className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                            {t('edit')}
                          </DropdownMenuItem>
                          {currentUser?.id !== user.id && (
                            <>
                              {user.two_factor_enabled && (
                                <DropdownMenuItem onClick={() => handleResetTwoFactor(user)}>
                                  <KeyRound className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                                  {t('reset2FA')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteUser(user)}
                                className="text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                                {t('delete')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pending Invitations Section */}
      <div>
        <h3 className="text-lg font-semibold mb-4">{t('pendingInvitations')}</h3>
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('email')}</TableHead>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('expires')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead className="text-end">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.filter(i => !i.is_used).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                    {t('noPendingInvitations')}
                  </TableCell>
                </TableRow>
              ) : (
                invitations.filter(i => !i.is_used).map((invitation) => {
                  const expired = isInvitationExpired(invitation.expires_at);

                  return (
                    <TableRow key={invitation.id}>
                      <TableCell className="font-medium">{invitation.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{getRoleLabel(invitation.role)}</Badge>
                      </TableCell>
                      <TableCell>{new Date(invitation.expires_at).toLocaleDateString(language)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{t('pending')}</Badge>
                          {expired && (
                            <Badge variant="destructive">{t('expired')}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteInvitation(invitation.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createUserDialogOpen} onOpenChange={setCreateUserDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('createUser')}</DialogTitle>
            <DialogDescription>
              {t('createUserDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-username">{t('username')} *</Label>
              <Input
                id="create-username"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder={t('usernamePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-email">{t('email')} *</Label>
              <Input
                id="create-email"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-fullname">{t('fullName')}</Label>
              <Input
                id="create-fullname"
                value={createFullName}
                onChange={(e) => setCreateFullName(e.target.value)}
                placeholder={t('fullNamePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-password">{t('password')} *</Label>
              <Input
                id="create-password"
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder={t('enterPassword')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-role">{t('role')}</Label>
              <Select value={createRole} onValueChange={setCreateRole}>
                <SelectTrigger id="create-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USER_ROLES.TESTER}>{t('tester')}</SelectItem>
                  <SelectItem value={USER_ROLES.VIEWER}>{t('viewer')}</SelectItem>
                  <SelectItem value={USER_ROLES.MANAGER}>{t('manager')}</SelectItem>
                  <SelectItem value={USER_ROLES.ADMIN}>{t('admin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 rtl:space-x-reverse">
              <Checkbox
                id="create-active"
                checked={createIsActive}
                onCheckedChange={(checked) => setCreateIsActive(checked as boolean)}
              />
              <Label htmlFor="create-active" className="cursor-pointer">
                {t('active')}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateUserDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreateUser}>
              <Plus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('createUser')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('inviteUser')}</DialogTitle>
            <DialogDescription>
              {t('inviteUserDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="invite-email">{t('emailAddress')}</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('userEmailPlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">{t('role')}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USER_ROLES.TESTER}>{t('tester')}</SelectItem>
                  <SelectItem value={USER_ROLES.VIEWER}>{t('viewer')}</SelectItem>
                  <SelectItem value={USER_ROLES.MANAGER}>{t('manager')}</SelectItem>
                  <SelectItem value={USER_ROLES.ADMIN}>{t('admin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('assignToProjects')}</Label>
              <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                {projects.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('noProjectsAvailable')}</p>
                ) : (
                  projects.map((project) => (
                    <div key={project.id} className="flex items-center space-x-2 rtl:space-x-reverse">
                      <Checkbox
                        id={`project-${project.id}`}
                        checked={selectedProjects.includes(project.id)}
                        onCheckedChange={() => toggleProjectSelection(project.id)}
                      />
                      <Label
                        htmlFor={`project-${project.id}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {project.name}
                      </Label>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleInviteUser}>
              <Mail className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
              {t('sendInvitation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('editUser')}</DialogTitle>
            <DialogDescription>
              {t('editUserDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-role">{t('role')}</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USER_ROLES.TESTER}>{t('tester')}</SelectItem>
                  <SelectItem value={USER_ROLES.VIEWER}>{t('viewer')}</SelectItem>
                  <SelectItem value={USER_ROLES.MANAGER}>{t('manager')}</SelectItem>
                  <SelectItem value={USER_ROLES.ADMIN}>{t('admin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 rtl:space-x-reverse">
              <Checkbox
                id="edit-active"
                checked={editIsActive}
                onCheckedChange={(checked) => setEditIsActive(checked as boolean)}
              />
              <Label htmlFor="edit-active" className="cursor-pointer">
                {t('active')}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleUpdateUser} disabled={editRole === originalRole}>
              {t('saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent isRTL={isRTL} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('deleteUser')}</DialogTitle>
            <DialogDescription>
              {t('deleteUserConfirmDesc', { username: userToDelete?.username || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDeleteUser}>
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
