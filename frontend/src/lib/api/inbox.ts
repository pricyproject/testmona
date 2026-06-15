import { Notification, InboxSummary } from "@/types";
import { api } from "./client";

export type InboxStatus = "open" | "snoozed" | "done" | "all";

// Age-based ordering by created_at. "oldest" surfaces the most-aged work first
// (W4 aging / SLA), and paginates server-side so it isn't just a local re-sort.
export type InboxSort = "newest" | "oldest";

// Triage actions the bulk endpoint accepts for a multi-selection.
export type InboxBulkActionType = "archive" | "unarchive" | "read" | "unread" | "snooze";

// Work Inbox: the actionable slice of the user's notifications, plus the
// triage actions (read / archive) the dedicated inbox page drives.
export const inboxAPI = {
  list: async (
    params: { status?: InboxStatus; category?: string | null; unreadOnly?: boolean; sort?: InboxSort; skip?: number; limit?: number } = {}
  ): Promise<Notification[]> => {
    const search = new URLSearchParams();
    search.set("status", params.status ?? "open");
    if (params.category) search.set("category", params.category);
    if (params.unreadOnly) search.set("unread_only", "true");
    if (params.sort) search.set("sort", params.sort);
    search.set("skip", String(params.skip ?? 0));
    search.set("limit", String(params.limit ?? 50));
    const response = await api.get(`/inbox?${search.toString()}`);
    return response.data;
  },

  summary: async (): Promise<InboxSummary> => {
    const response = await api.get("/inbox/summary");
    return response.data;
  },

  archive: async (id: number): Promise<Notification> => {
    const response = await api.post(`/inbox/${id}/archive`);
    return response.data;
  },

  unarchive: async (id: number): Promise<Notification> => {
    const response = await api.post(`/inbox/${id}/unarchive`);
    return response.data;
  },

  archiveAll: async (category?: string | null): Promise<{ archived_count: number }> => {
    const response = await api.post(`/inbox/archive-all${category ? `?category=${encodeURIComponent(category)}` : ""}`);
    return response.data;
  },

  markAllRead: async (category?: string | null): Promise<{ marked_count: number }> => {
    const response = await api.post(`/inbox/mark-all-read${category ? `?category=${encodeURIComponent(category)}` : ""}`);
    return response.data;
  },

  // Defer an item until `until` (ISO 8601). It returns to the open inbox on its
  // own once the time passes (the backend sweeps due snoozes on read).
  snooze: async (id: number, until: string): Promise<Notification> => {
    const response = await api.post(`/inbox/${id}/snooze`, { until });
    return response.data;
  },

  unsnooze: async (id: number): Promise<Notification> => {
    const response = await api.post(`/inbox/${id}/unsnooze`);
    return response.data;
  },

  // Apply one triage action to a multi-selection. `until` is required for snooze.
  bulk: async (
    ids: number[],
    action: InboxBulkActionType,
    until?: string
  ): Promise<{ affected_count: number }> => {
    const response = await api.post(`/inbox/bulk`, { ids, action, until });
    return response.data;
  },

  // Read-state actions reuse the existing notification endpoints.
  markRead: async (id: number): Promise<void> => {
    await api.put(`/notifications/${id}`, { is_read: true });
  },

  markUnread: async (id: number): Promise<void> => {
    await api.put(`/notifications/${id}/mark-unread`);
  },
};
