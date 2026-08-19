import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("voxora_admin_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const adminAPI = {
  login: (email: string, password: string) =>
    api.post("/admin/login", { email, password }),
  bootstrap: (email: string, password: string, name?: string) =>
    api.post("/admin/bootstrap", null, { params: { email, password, name } }),
  overview: () => api.get("/admin/overview"),
  analytics: (period = "weekly") => api.get("/admin/analytics", { params: { period } }),
  activeCalls: () => api.get("/admin/calls/active"),
  liveOps: () => api.get("/admin/live-ops"),
  forceEnd: (callId: string) => api.post(`/admin/calls/${callId}/force-end`),
  forceOffline: (userId: string) => api.post(`/admin/creators/${userId}/force-offline`),
  callLogs: () => api.get("/admin/calls/logs"),
  missed: () => api.get("/admin/calls/missed"),
  pendingCreators: () => api.get("/admin/creators/pending"),
  approve: (userId: string) => api.post(`/admin/creators/${userId}/approve`),
  reject: (userId: string) => api.post(`/admin/creators/${userId}/reject`),
  withdrawals: () => api.get("/admin/withdrawals/pending"),
  markPaid: (id: string) => api.post(`/admin/withdrawals/${id}/mark-paid`),
  rejectWd: (id: string) => api.post(`/admin/withdrawals/${id}/reject`),
  support: () => api.get("/admin/support/messages"),
  replySupport: (id: string, reply: string) =>
    api.post(`/admin/support/messages/${id}/reply`, { reply }),
  broadcast: (title: string, body: string, audience = "all") =>
    api.post("/admin/notifications/broadcast", { title, body, audience }),
  health: () => api.get("/admin/health"),
  audit: () => api.get("/admin/audit"),
};
