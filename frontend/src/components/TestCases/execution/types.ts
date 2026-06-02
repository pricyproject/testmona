import type { ExecutionStatus } from './statusConfig';

export interface TestStep {
  id?: number;
  step_number: number;
  action: string;
  expected_result: string;
  step_type: string;
}

export type ExecutionPhase = 'idle' | 'running' | 'paused' | 'completed';

export const DEFECT_LINK_TYPES = ['found', 'blocked_by', 'related'] as const;
export type DefectLinkType = (typeof DEFECT_LINK_TYPES)[number];

export interface NewDefectDraft {
  title: string;
  description: string;
  severity: string;
  priority: string;
}

export type IterationStatusMap = Record<number, ExecutionStatus>;
