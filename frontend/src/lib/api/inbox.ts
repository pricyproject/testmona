import { Notification, InboxSummary } from "@/types";
import { api } from "./client";

export type InboxStatus = "open" | "done" | "all";

// Work Inbox: the actionable slice of the user's notifications, plus the
// triage actions (read / archive) the dedicated inbox page drives.
export const inboxAPI = {
  list: async (
    params: { status?: InboxStatus; category?: string | null; unreadOnly?: boolean; skip?: number; limit?: number } = {}
  ): Promise<Notification[]> => {
    const search = new URLSearchParams();
    search.set("status", params.status ?? "open");
    if (params.category) search.set("category", params.category);
    if (params.unreadOnly) search.set("unread_only", "true");
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

  // Read-state actions reuse the existing notification endpoints.
  markRead: async (id: number): Promise<void> => {
    await api.put(`/notifications/${id}`, { is_read: true });
  },

  markUnread: async (id: number): Promise<void> => {
    await api.put(`/notifications/${id}/mark-unread`);
  },
};
