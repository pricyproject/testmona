export interface Section {
  id: string;
  name: string;
  parentId?: string;
  children?: Section[];
  testCaseCount: number;
  cumulativeCount?: number;
  expanded?: boolean;
  test_suite_id?: number;
  test_suite_name?: string;
}
