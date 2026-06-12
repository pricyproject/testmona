import { useQuery } from '@tanstack/react-query';
import { sectionsAPI, testCasesAPI, testSuitesAPI } from '@/lib/api';

export const testSuiteDetailKeys = {
  detail: (suiteId: number | null) => ['testSuiteDetail', suiteId] as const,
  sections: (projectId: number | null, suiteId: number | null) =>
    ['testSuiteDetail', 'sections', projectId, suiteId] as const,
};

// Suite + its test cases. The cases fetch fails soft (the suite is the critical
// part); the page normalises the raw case payload itself.
export function useTestSuiteDetail(projectId: number | null, suiteId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testSuiteDetailKeys.detail(suiteId),
    queryFn: async () => {
      const [suite, testCasesRaw] = await Promise.all([
        testSuitesAPI.getById(suiteId as number),
        testCasesAPI
          .getAll(projectId as number, suiteId as number, undefined, 'id', 'asc', 0, 500)
          .catch(() => []),
      ]);
      return { suite, testCasesRaw };
    },
    enabled,
  });
}

export function useTestSuiteSections(projectId: number | null, suiteId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testSuiteDetailKeys.sections(projectId, suiteId),
    queryFn: async () => {
      const data = await sectionsAPI.getProjectSectionHierarchy(projectId as number);
      const suiteEntry = (data?.hierarchy || []).find((entry: any) => entry.test_suite?.id === suiteId);
      return suiteEntry?.sections || [];
    },
    enabled,
  });
}
