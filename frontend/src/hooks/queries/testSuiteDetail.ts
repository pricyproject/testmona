import { useQuery } from '@tanstack/react-query';
import { sectionsAPI, testCasesAPI, testSuitesAPI } from '@/lib/api';

export const testSuiteDetailKeys = {
  detail: (suiteId: number | null) => ['testSuiteDetail', suiteId] as const,
  sections: (projectId: number | null, suiteId: number | null) =>
    ['testSuiteDetail', 'sections', projectId, suiteId] as const,
};

// Suite + its test cases. The case list pages through the whole suite (a single
// getAll call would silently stop at the API's 500-row page) and a failure here
// surfaces as a query error instead of an empty suite.
export function useTestSuiteDetail(projectId: number | null, suiteId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testSuiteDetailKeys.detail(suiteId),
    queryFn: async () => {
      const [suite, testCasesRaw] = await Promise.all([
        testSuitesAPI.getById(suiteId as number),
        testCasesAPI.getAllPages(projectId as number, { testSuiteId: suiteId as number }),
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
