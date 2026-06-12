import { useQuery } from '@tanstack/react-query';
import { milestonesAPI, requirementsAPI, testPlansAPI } from '@/lib/api';
import type { Milestone } from '@/types';

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
