import { useQuery } from '@tanstack/react-query';
import { milestonesAPI, projectAssignmentsAPI, requirementsAPI, testPlansAPI } from '@/lib/api';
import type { Milestone } from '@/types';

export interface TestPlanMember {
  user_id: number;
  username: string;
  full_name?: string | null;
}

export interface TestPlanListFilters {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  statusFilter: string;
  searchQuery: string;
  milestoneFilter: string;
}

export const testPlanKeys = {
  list: (projectId: number | null, filters: TestPlanListFilters) =>
    ['testPlans', 'list', projectId, filters] as const,
  listRoot: (projectId: number | null) => ['testPlans', 'list', projectId] as const,
  milestones: (projectId: number | null) => ['testPlans', 'milestones', projectId] as const,
  reqOptions: (projectId: number | null) => ['testPlans', 'reqOptions', projectId] as const,
  members: (projectId: number | null) => ['testPlans', 'members', projectId] as const,
};

export function useTestPlansList(projectId: number | null, filters: TestPlanListFilters, enabled: boolean) {
  return useQuery({
    queryKey: testPlanKeys.list(projectId, filters),
    queryFn: async () => {
      const plans = await testPlansAPI.getAll(projectId as number, {
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        status: filters.statusFilter !== 'all' ? filters.statusFilter : undefined,
        search: filters.searchQuery.trim() || undefined,
        milestoneId:
          filters.milestoneFilter !== 'all' && filters.milestoneFilter !== 'none'
            ? Number(filters.milestoneFilter)
            : undefined,
        limit: 500,
      });
      return (Array.isArray(plans) ? plans : []) as any[];
    },
    enabled,
  });
}

export function useTestPlanMilestones(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testPlanKeys.milestones(projectId),
    queryFn: async () => {
      const list = await milestonesAPI.getAll(projectId as number, 0, 500);
      return (Array.isArray(list) ? list : []) as Milestone[];
    },
    enabled,
  });
}

// Project members for the assignee picker (de-duped + filtered to this project).
export function useTestPlanMembers(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testPlanKeys.members(projectId),
    queryFn: async () => {
      const rows: any[] = await projectAssignmentsAPI.listMembers(projectId as number);
      const seen = new Set<number>();
      return rows.reduce<TestPlanMember[]>((acc, r) => {
        if (Number(r.project_id) !== projectId || !r.user_id || !r.username || seen.has(r.user_id)) {
          return acc;
        }
        seen.add(r.user_id);
        acc.push({ user_id: r.user_id, username: r.username, full_name: r.full_name });
        return acc;
      }, []);
    },
    enabled,
  });
}

export function useTestPlanReqOptions(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testPlanKeys.reqOptions(projectId),
    queryFn: async () => {
      const data = await requirementsAPI.getAll(projectId as number, 0, 500);
      const list = Array.isArray(data) ? data : [];
      return list.map((r: any) => ({ id: r.id, requirement_id: r.requirement_id, title: r.title, status: r.status }));
    },
    enabled,
  });
}
