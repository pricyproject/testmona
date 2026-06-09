import { TestCase } from '@/types';

export function caseBelongsToSuite(testCase: TestCase, suiteId: number): boolean {
  return (
    testCase.test_suite_id === suiteId ||
    Boolean(testCase.suite_memberships?.some((membership) => membership.test_suite_id === suiteId))
  );
}

export function caseSectionIdForSuite(testCase: TestCase, suiteId: number): number | undefined {
  const membershipSectionId = testCase.suite_memberships?.find(
    (membership) => membership.test_suite_id === suiteId
  )?.section_id;

  if (membershipSectionId !== undefined && membershipSectionId !== null) {
    return membershipSectionId;
  }

  return testCase.test_suite_id === suiteId ? testCase.section_id : undefined;
}

export function caseHasAnySuite(testCase: TestCase): boolean {
  return Boolean(testCase.test_suite_id || testCase.suite_memberships?.length);
}
