import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { testSuitesAPI, testCasesAPI, sectionsAPI } from '@/lib/api';
import type { TestSuite, TestCase } from '@/types';

export const testSuiteKeys = {
  list: (projectId: number | null) => ['testSuites', 'list', projectId] as const,
  selection: (projectId: number | null) => ['testSuites', 'selection', projectId] as const,
};

export function useTestSuites(projectId: number | null) {
  return useQuery({
    queryKey: testSuiteKeys.list(projectId),
    queryFn: async () => {
      const data = await testSuitesAPI.getAll(projectId as number, 0, 500);
      return (Array.isArray(data) ? data : []) as TestSuite[];
    },
    enabled: projectId != null,
  });
}

// Test-case + section data for the "add cases to suite" dialog. Only fetched
// while the dialog is open; flattens the section hierarchy for the picker.
export function useTestSuiteSelectionData(projectId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testSuiteKeys.selection(projectId),
    queryFn: async () => {
      const [testCasesData, hierarchyData] = await Promise.all([
        testCasesAPI.getAll(projectId as number).catch(() => []),
        sectionsAPI.getProjectSectionHierarchy(projectId as number).catch(() => null),
      ]);
      const flatSections: any[] = [];
      const walk = (nodes: any[], suiteId: number) => {
        nodes.forEach((node) => {
          flatSections.push({
            id: node.id,
            name: node.name,
            test_suite_id: suiteId,
            test_case_count: node.test_case_count,
            subsections: node.subsections,
          });
          if (Array.isArray(node.subsections) && node.subsections.length > 0) {
            walk(node.subsections, suiteId);
          }
        });
      };
      (hierarchyData?.hierarchy || []).forEach((suiteData: any) => {
        walk(suiteData.sections || [], suiteData.test_suite?.id);
      });
      return {
        testCases: (Array.isArray(testCasesData) ? testCasesData : []) as TestCase[],
        sections: flatSections,
      };
    },
    enabled: enabled && projectId != null,
  });
}

export function useCreateTestSuite(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) => testSuitesAPI.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(projectId) }),
  });
}

export function useDeleteTestSuite(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => testSuitesAPI.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(projectId) }),
  });
}
