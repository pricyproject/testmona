import { CheckCircle, XCircle, Clock, AlertTriangle, type LucideIcon } from 'lucide-react';

export type ExecutionStatus = 'pending' | 'passed' | 'failed' | 'blocked';

export interface StatusOption {
  value: ExecutionStatus;
  /** Translation key resolved by the caller via t(). */
  labelKey: string;
  icon: LucideIcon;
  /** Foreground colour for the icon. */
  color: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'pending', labelKey: 'pending', icon: Clock, color: 'text-slate-500' },
  { value: 'passed', labelKey: 'passed', icon: CheckCircle, color: 'text-emerald-600' },
  { value: 'failed', labelKey: 'failed', icon: XCircle, color: 'text-red-600' },
  { value: 'blocked', labelKey: 'blocked', icon: AlertTriangle, color: 'text-amber-600' },
];

export const getStatusOption = (status: string): StatusOption | undefined =>
  STATUS_OPTIONS.find((opt) => opt.value === status);

/** Soft badge styling per execution status, used across the page for consistency. */
export const getStatusBadgeClass = (status: string): string => {
  const map: Record<string, string> = {
    pending: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300',
    passed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
    blocked: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
  };
  return map[status] || map.pending;
};

/** Accent ring/border for the active status surface (timer card, status pill). */
export const getStatusAccent = (status: string): string => {
  const map: Record<string, string> = {
    pending: 'text-slate-500',
    passed: 'text-emerald-600 dark:text-emerald-400',
    failed: 'text-red-600 dark:text-red-400',
    blocked: 'text-amber-600 dark:text-amber-400',
  };
  return map[status] || map.pending;
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'border-transparent bg-red-600 text-white',
  high: 'border-transparent bg-orange-500 text-white',
  medium: 'border-transparent bg-amber-500 text-white',
  low: 'border-transparent bg-sky-500 text-white',
  urgent: 'border-transparent bg-red-700 text-white',
};

export const getPriorityBadgeClass = (priority?: string): string =>
  PRIORITY_BADGE[String(priority || '').toLowerCase()] || PRIORITY_BADGE.medium;

/** Human label for run/result statuses that aren't part of the execution set. */
export const formatStatusLabel = (status: string): string => {
  const normalized = String(status || '').toLowerCase();
  const labels: Record<string, string> = {
    not_tested: 'Not Tested',
    pass: 'Pass',
    passed: 'Passed',
    fail: 'Fail',
    failed: 'Failed',
    block: 'Block',
    blocked: 'Blocked',
    skip: 'Skip',
    skipped: 'Skipped',
    pending: 'Pending',
    in_progress: 'In Progress',
    running: 'Running',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return labels[normalized] || status.replace(/[-_]/g, ' ');
};
