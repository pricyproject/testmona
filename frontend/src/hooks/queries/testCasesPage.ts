import { useQuery } from '@tanstack/react-query';
import { testCasesAPI } from '@/lib/api';

export const testCasesPageKeys = {
  list: (projectId: number | null, sortField: string, sortDirection: string) =>
    ['testCasesPage', 'list', projectId, sortField, sortDirection] as const,
};

// All test cases for the project (selection/filtering is applied client-side)
// plus the total count, fetched together.
export function useProjectTestCases(
  projectId: number | null,
  sortField: string,
  sortDirection: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: testCasesPageKeys.list(projectId, sortField, sortDirection),
    queryFn: async () => {
      const [testCases, count] = await Promise.all([
        testCasesAPI.getAll(projectId as number, undefined, undefined, sortField, sortDirection),
        testCasesAPI.getCount(projectId as number),
      ]);
      return { testCases: (Array.isArray(testCases) ? testCases : []), count: count.count as number };
    },
    enabled,
  });
}
