import axios from "axios";

const API = import.meta.env.VITE_API_URL || "https://voxra-dkfe.onrender.com/api";

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("simpletalk_admin_token") ||
    localStorage.getItem("voxora_admin_token");
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
  monitorToken: (channelName: string) =>
    api.post("/admin/calls/generate-token", { channel_name: channelName }),
  callLogs: (params?: any) => api.get("/admin/calls/logs", { params }),
  missed: () => api.get("/admin/calls/missed"),
  pendingCreators: () => api.get("/admin/creators/pending"),
  verifiedCreators: () => api.get("/admin/creators/verified"),
  approve: (userId: string) => api.post(`/admin/creators/${userId}/approve`),
  reject: (userId: string, reason?: string) =>
    api.post(`/admin/creators/${userId}/reject`, { reason }),
  suspend: (userId: string) => api.post(`/admin/users/${userId}/suspend`),

  withdrawals: () => api.get("/admin/withdrawals/pending"),
  processedWithdrawals: () => api.get("/admin/withdrawals/processed"),
  failedWithdrawals: () => api.get("/admin/withdrawals/failed"),
  markPaid: (id: string, admin_notes?: string) =>
    api.post(`/admin/withdrawals/${id}/mark-paid`, { admin_notes }),
  rejectWd: (id: string) => api.post(`/admin/withdrawals/${id}/reject`),
  markError: (id: string, payment_error_remarks: string, refund_amount: boolean) =>
    api.post(`/admin/withdrawals/${id}/mark-error`, { payment_error_remarks, refund_amount }),
  increaseRequests: () => api.get("/admin/withdrawals/increase-requests"),
  approveIncrease: (id: string, approved_max_amount: number) =>
    api.post(`/admin/withdrawals/increase-requests/${id}/approve`, { approved_max_amount }),
  rejectIncrease: (id: string) =>
    api.post(`/admin/withdrawals/increase-requests/${id}/reject`),

  financialDashboard: () => api.get("/admin/financial/dashboard"),
  financialOverview: () => api.get("/admin/financial/overview"),
  financialTransactions: (params?: any) => api.get("/admin/financial/transactions", { params }),
  financialCommissions: (params?: any) => api.get("/admin/financial/commissions", { params }),
  financialAnalytics: (period = "month") =>
    api.get("/admin/financial/analytics", { params: { period } }),

  support: () => api.get("/admin/support/messages"),
  markSupportRead: (id: string) => api.post(`/admin/support/messages/${id}/mark-read`),
  replySupport: (id: string, reply: string) =>
    api.post(`/admin/support/messages/${id}/reply`, { reply }),
  broadcast: (title: string, body: string, audience = "all") =>
    api.post("/admin/notifications/broadcast", { title, body, audience }),
  health: () => api.get("/admin/health"),
  audit: () => api.get("/admin/audit"),
};
