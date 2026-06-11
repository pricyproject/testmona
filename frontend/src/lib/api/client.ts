import axios from "axios";
import { useAuthStore } from "@/stores/authStore";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export async function resolveProjectSeq(
  projectId: number,
  entity: string,
  seqOrId: number,
): Promise<number> {
  try {
    const response = await api.get(`/projects/${projectId}/lookup/${entity}/${seqOrId}`);
    return response.data.id as number;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return seqOrId;
    }
    throw error;
  }
}

export const seqAPI = { resolve: resolveProjectSeq };

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) => item?.msg || item?.message)
        .filter(Boolean)
        .join(", ") || fallback;
    }
    const message = error.response?.data?.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return error instanceof Error ? error.message : fallback;
};

(api as any)._refreshing = false;
(api as any)._refreshPromise = null;

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = String(originalRequest?.url || "");
    const isAuthEndpoint =
      requestUrl.includes("/refresh") ||
      requestUrl.includes("/token") ||
      requestUrl.includes("/login") ||
      requestUrl.includes("/logout");

    if (error.response?.status === 403 &&
        error.response?.data?.detail?.includes("Password change required")) {
      if (!(api as any)._passwordChangeDialogShown) {
        console.log('Password change required - dispatching event');
        (api as any)._passwordChangeDialogShown = true;
        window.dispatchEvent(new CustomEvent('passwordChangeRequired'));
      }
      return Promise.reject(error);
    }

    // Read-only (viewer) guard from the backend. Surface a friendly toast so any
    // write control that wasn't gated in the UI still fails gracefully instead of
    // looking broken. The backend remains the source of truth.
    if (error.response?.status === 403 &&
        error.response?.data?.detail === "Viewer role is read-only") {
      window.dispatchEvent(new CustomEvent('viewerReadOnly'));
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if ((api as any)._refreshing && (api as any)._refreshPromise) {
        try {
          await (api as any)._refreshPromise;
          const token = useAuthStore.getState().token;
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return api(originalRequest);
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      }

      originalRequest._retry = true;

      try {
        (api as any)._refreshing = true;
        const refreshToken = useAuthStore.getState().refreshToken;
        (api as any)._refreshPromise = api.post("/refresh", refreshToken ? {
          refresh_token: refreshToken,
        } : {}).then((response) => response.data);
        const response = await (api as any)._refreshPromise;

        useAuthStore.setState({
          token: response.access_token,
          refreshToken: response.refresh_token || refreshToken || null,
        });

        if (response.access_token) {
          originalRequest.headers.Authorization = `Bearer ${response.access_token}`;
        }
        return api(originalRequest);
      } catch (refreshError) {
        if (!axios.isAxiosError(refreshError) || refreshError.response?.status !== 401) {
          console.error("Token refresh failed:", refreshError);
        }
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");

        useAuthStore.setState({
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          user: null,
        });

        if (window.location.pathname !== "/login") {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?next=${next}`;
        }
        return Promise.reject(refreshError);
      } finally {
        (api as any)._refreshing = false;
        (api as any)._refreshPromise = null;
      }
    }

    if (error.response?.status === 401 && isAuthEndpoint) {
      localStorage.removeItem("token");
      localStorage.removeItem("refreshToken");
      useAuthStore.setState({
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        user: null,
      });
      if (window.location.pathname !== "/login") {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}`;
      }
    }

    return Promise.reject(error);
  }
);

export { api };
