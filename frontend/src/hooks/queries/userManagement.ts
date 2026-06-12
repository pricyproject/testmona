import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, usersAPI } from '@/lib/api';

export const userManagementKeys = {
  users: ['userManagement', 'users'] as const,
  invitations: ['userManagement', 'invitations'] as const,
  projects: ['userManagement', 'projects'] as const,
};

export function useManagedUsers(enabled: boolean) {
  return useQuery({
    queryKey: userManagementKeys.users,
    queryFn: async () => (await api.get('/users')).data,
    enabled,
  });
}

export function useManagedInvitations(enabled: boolean) {
  return useQuery({
    queryKey: userManagementKeys.invitations,
    queryFn: async () => (await api.get('/invitations')).data,
    enabled,
  });
}

export function useManagedProjects(enabled: boolean) {
  return useQuery({
    queryKey: userManagementKeys.projects,
    queryFn: async () => (await api.get('/projects/')).data,
    enabled,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => (await api.post('/users', payload)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userManagementKeys.users }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) =>
      (await api.put(`/users/${id}`, payload)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userManagementKeys.users }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userManagementKeys.users }),
  });
}

export function useResetUserTwoFactor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => usersAPI.resetTwoFactor(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userManagementKeys.users }),
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => (await api.post('/invitations', payload)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userManagementKeys.invitations }),
  });
}

export function useDeleteInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userManagementKeys.invitations }),
  });
}
