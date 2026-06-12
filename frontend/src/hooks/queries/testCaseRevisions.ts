import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, testCasesAPI } from '@/lib/api';

export const testCaseRevisionKeys = {
  detail: (testCaseId: number | null) => ['testCaseRevisions', testCaseId] as const,
};

// Fetches the test case and its revision list together (they're validated against
// each other in the page).
export function useTestCaseRevisions(testCaseId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: testCaseRevisionKeys.detail(testCaseId),
    queryFn: async () => {
      const [testCase, revisionsRes] = await Promise.all([
        testCasesAPI.getById(testCaseId as number),
        api.get(`/test-cases/${testCaseId}/revisions`),
      ]);
      return {
        testCase,
        revisions: Array.isArray(revisionsRes.data) ? revisionsRes.data : [],
      };
    },
    enabled,
  });
}

export function useRestoreRevision(testCaseId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionNumber: number) =>
      api.post(`/test-cases/${testCaseId}/revisions/${revisionNumber}/restore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: testCaseRevisionKeys.detail(testCaseId) }),
  });
}
