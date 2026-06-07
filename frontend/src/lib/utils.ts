import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// --- Project-first entity numbering -----------------------------------------
// Every project-scoped entity exposes a per-project `project_seq` used in URLs
// and display badges (so project 2's first requirement is REQ-001 at
// /projects/2/requirements/1, regardless of its global database id). When a row
// has not been numbered yet (created before the rollout, or a legacy bookmark),
// we fall back to the global `id` so links/badges still work.
type SeqLike = { project_seq?: number | null; id: number } | null | undefined;

export function entitySeq(item: SeqLike): number | undefined {
  if (!item) return undefined;
  return item.project_seq ?? item.id;
}

/** Build a display key like `TC-001` / `REQ-007` from a per-project sequence. */
export function entityKey(prefix: string, item: SeqLike, pad = 3): string {
  const seq = entitySeq(item);
  return seq == null ? prefix : `${prefix}-${String(seq).padStart(pad, "0")}`;
}
