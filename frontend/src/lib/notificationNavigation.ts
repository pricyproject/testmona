import { Notification } from "@/types";
import { api } from "@/lib/api";

/**
 * Resolve the in-app route a notification should open, performing whatever
 * lookups are needed to translate a related entity into a project-scoped URL.
 *
 * This is the single source of truth shared by the bell dropdown and the Work
 * Inbox page, so a notification deep-links the same way wherever it is opened.
 * Returns null when the notification has no navigable target.
 */
export async function resolveNotificationTarget(
  notification: Pick<Notification, "related_entity_type" | "related_entity_id">
): Promise<string | null> {
  const { related_entity_type: type, related_entity_id: id } = notification;
  if (!type || !id) return null;

  switch (type) {
    case "test_run": {
      const { data } = await api.get(`/test-runs/${id}`);
      return `/projects/${data.project_id}/test-runs/${id}`;
    }
    case "defect":
      return `/defects/${id}`;
    case "test_case":
      return `/test-cases/${id}`;
    case "requirement": {
      const { data } = await api.get(`/requirements/${id}`);
      return `/projects/${data.project_id}/requirements/${data.project_seq ?? id}`;
    }
    case "requirement_change": {
      // Watch alert: open the requirement with its version-history diff in view.
      const { data } = await api.get(`/requirements/${id}`);
      return `/projects/${data.project_id}/requirements/${data.project_seq ?? id}?compare=1`;
    }
    case "doc": {
      const { data } = await api.get(`/docs/${id}`);
      return data.project_id ? `/projects/${data.project_id}/docs/${id}` : `/docs/${id}`;
    }
    case "doc_change": {
      // Watch alert: land on the revisions tab in diff mode.
      const { data } = await api.get(`/docs/${id}`);
      const base = data.project_id ? `/projects/${data.project_id}/docs/${id}` : `/docs/${id}`;
      return `${base}/revisions?compare=1`;
    }
    default:
      return null;
  }
}

/** Resolve and navigate to a notification's target. Returns true on success. */
export async function openNotification(
  notification: Pick<Notification, "related_entity_type" | "related_entity_id">,
  navigate: (path: string) => void
): Promise<boolean> {
  try {
    const target = await resolveNotificationTarget(notification);
    if (!target) return false;
    navigate(target);
    return true;
  } catch (error) {
    console.error("Failed to open notification target:", error);
    return false;
  }
}
