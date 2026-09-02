import { useQuery } from '@tanstack/react-query';
import { testCasesAPI } from '@/lib/api';
import type { TestCase } from '@/types';

export const testCasesPageKeys = {
  list: (projectId: number | null, sortField: string, sortDirection: string) =>
    ['testCasesPage', 'list', projectId, sortField, sortDirection] as const,
};

const PAGE_SIZE = 500;

// All test cases for the project (selection/filtering is applied client-side)
// plus the total count, fetched together. Pages through the backend since a
// single request is capped, so no test case is silently dropped from the list.
export function useProjectTestCases(
  projectId: number | null,
  sortField: string,
  sortDirection: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: testCasesPageKeys.list(projectId, sortField, sortDirection),
    queryFn: async () => {
      const countResponse = await testCasesAPI.getCount(projectId as number);
      const reportedCount = Number(countResponse?.count);
      const testCases: TestCase[] = [];

      // Page until the server returns a short page rather than trusting the
      // count: it is a separate request, so it can be stale (or missing) and
      // would otherwise truncate the list - or, at 0, render an empty table for
      // a project that does have cases. MAX_PAGES bounds a misbehaving server.
      const MAX_PAGES = 200;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch = await testCasesAPI.getAll(
          projectId as number,
          undefined,
          undefined,
          sortField,
          sortDirection,
          page * PAGE_SIZE,
          PAGE_SIZE,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        testCases.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }

      return {
        testCases,
        count: Number.isFinite(reportedCount) ? reportedCount : testCases.length,
      };
    },
    enabled,
  });
}
