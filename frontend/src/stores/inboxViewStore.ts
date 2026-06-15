import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InboxStatus, InboxSort } from '@/lib/api/inbox';

// How the Work Inbox groups the visible items in the list. Purely a view
// concern — grouping happens client-side over the loaded page.
export type InboxGroupBy = 'date' | 'category' | 'entity' | 'project';

// Persisted Work Inbox UI state ("last-used view"). This is deliberately
// separate from Plan A's NotificationPreference (delivery opt-outs): this is the
// shape of the *view*, not what the user receives. It lives in localStorage so a
// user's last filter/grouping survives reloads without a backend round-trip.
export interface InboxViewState {
  status: InboxStatus;
  activeCategory: string | null;
  unreadOnly: boolean;
  groupBy: InboxGroupBy;
  sort: InboxSort;
  setView: (patch: Partial<Pick<InboxViewState, 'status' | 'activeCategory' | 'unreadOnly' | 'groupBy' | 'sort'>>) => void;
}

export const useInboxViewStore = create<InboxViewState>()(
  persist(
    (set) => ({
      status: 'open',
      activeCategory: null,
      unreadOnly: false,
      groupBy: 'date',
      sort: 'newest',
      setView: (patch) => set(patch),
    }),
    {
      name: 'inbox-view',
      // Only persist the view shape, never the setter.
      partialize: (s) => ({
        status: s.status,
        activeCategory: s.activeCategory,
        unreadOnly: s.unreadOnly,
        groupBy: s.groupBy,
        sort: s.sort,
      }),
    }
  )
);
