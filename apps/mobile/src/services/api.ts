import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AUTH_TOKEN_KEY, AUTH_TOKEN_KEY_LEGACY } from "../theme/brand";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://voxra-dkfe.onrender.com/api";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use(async (config) => {
  const token =
    (await AsyncStorage.getItem(AUTH_TOKEN_KEY)) ||
    (await AsyncStorage.getItem(AUTH_TOKEN_KEY_LEGACY));
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authAPI = {
  sendOtp: (phone: string, country_code = "+91") =>
    api.post("/auth/otp/send", { phone, country_code }),
  verifyOtp: (
    phone: string,
    otp: string,
    verification_id?: string,
    user_type?: string,
    country_code = "+91"
  ) => api.post("/auth/otp/verify", { phone, otp, verification_id, user_type, country_code }),
  me: () => api.get("/auth/me"),
  completeProfile: (data: Record<string, unknown>) =>
    api.post("/auth/complete-profile", data),
  checkUsername: (username: string) =>
    api.get("/auth/check-username", { params: { username } }),
  updateProfile: (data: Record<string, unknown>) =>
    api.post("/auth/update-profile", data),
  deleteAccount: () => api.post("/auth/delete-account"),
};

export const creatorsAPI = {
  browse: (params?: Record<string, unknown>) => api.get("/creators/browse", { params }),
  filters: () => api.get("/creators/filters"),
  get: (id: string) => api.get(`/creators/${id}`),
  status: (id: string) => api.get(`/creators/${id}/status`),
  follow: (id: string) => api.post(`/follow/${id}`),
  unfollow: (id: string) => api.delete(`/follow/${id}`),
  followStatus: (id: string) => api.get(`/follow/status/${id}`),
  followers: () => api.get("/follow/followers"),
  following: () => api.get("/following"),
  pricingSetup: (data: Record<string, unknown>) => api.post("/profile/pricing-setup", data),
  toggleDnd: () => api.post("/profile/dnd"),
  pushToken: (device_push_token: string, platform: string) =>
    api.post("/profile/push-token", { device_push_token, platform }),
  addImage: (image_base64: string) => api.post("/profile/images", { image_base64 }),
  deleteImage: (image_url: string) => api.delete("/profile/images", { data: { image_url } }),
  startVerification: () => api.post("/profile/verification/start"),
  submitVerificationSelfie: (verification_id: string, image_base64: string) =>
    api.post("/profile/verification/selfie", { verification_id, image_base64 }),
  onboardingStatus: () => api.get("/profile/onboarding-status"),
  block: (userId: string) => api.post(`/users/${userId}/block`),
};

export const moderationAPI = {
  reportUser: (reportedUserId: string, reason: string) =>
    api.post("/report-user", { reported_user_id: reportedUserId, reason }),
  reportCall: (callId: string, reportedUserId: string, reason: string) =>
    api.post("/report-call", { call_id: callId, reported_user_id: reportedUserId, reason }),
  blockUser: (blockedUserId: string) => api.post("/block-user", { blocked_user_id: blockedUserId }),
  unblockUser: (blockedUserId: string) => api.post("/unblock-user", { blocked_user_id: blockedUserId }),
  blockedUsers: () => api.get("/blocked-users"),
};

export const reviewsAPI = {
  list: (modelId: string, limit = 50, skip = 0) =>
    api.get(`/models/${modelId}/reviews`, { params: { limit, skip } }),
  stats: (modelId: string) => api.get(`/models/${modelId}/reviews/stats`),
};

export const earningsAPI = {
  overview: () => api.get("/profile/earnings/overview"),
  breakdown: (period = "month") => api.get("/profile/earnings/breakdown", { params: { period } }),
  calls: (limit = 50) => api.get("/profile/earnings/calls", { params: { limit } }),
  gifts: (limit = 50) => api.get("/profile/earnings/gifts", { params: { limit } }),
};

export const withdrawalAPI = {
  profile: () => api.get("/wallet/withdrawal/profile"),
  requests: () => api.get("/withdrawal/requests"),
  submit: (payload: {
    amount: number;
    upi_id: string;
    account_name?: string;
    bank_details: {
      bank_name: string;
      account_number: string;
      ifsc_code: string;
      account_holder_name: string;
    };
  }) => api.post("/wallet/withdraw", payload),
  requestIncrease: (requested_max_amount: number, reason?: string) =>
    api.post("/withdrawal/request-increase", { requested_max_amount, reason }),
};

export const callsAPI = {
  initiate: (receiver_id: string, call_type: "AUDIO" | "VIDEO") =>
    api.post("/calls/initiate", { receiver_id, call_type }),
  accept: (callId: string) => api.post(`/calls/${callId}/accept`),
  reject: (callId: string, decline_token?: string) =>
    api.post(`/calls/${callId}/reject`, { decline_token }),
  rejectToken: (callId: string, decline_token: string) =>
    api.post(`/calls/${callId}/reject-token`, { decline_token }),
  cancel: (callId: string) => api.post(`/calls/${callId}/cancel`),
  prepaidStart: (callId: string) => api.post(`/calls/${callId}/prepaid-start`),
  billMinute: (callId: string, current_minute: number) =>
    api.post(`/calls/${callId}/bill-minute`, { current_minute }),
  end: (callId: string) => api.post(`/calls/${callId}/end`),
  handleDisconnect: (callId: string) => api.post(`/calls/${callId}/handle-disconnect`),
  reconnect: (callId: string) => api.post(`/calls/${callId}/reconnect`),
  active: () => api.get("/calls/active"),
  history: () => api.get("/calls/history"),
  gift: (callId: string, amount: number) =>
    api.post(`/calls/${callId}/gift`, { amount }),
  review: (callId: string, rating: number, comment?: string) =>
    api.post(`/calls/${callId}/review`, { rating, comment }),
  report: (callId: string, reason: string) =>
    api.post(`/calls/${callId}/report`, { reason }),
};

export const referralAPI = {
  overview: () => api.get("/profile/referral"),
  apply: (code: string) => api.post("/profile/referral/apply", { code }),
};

export const walletAPI = {
  packages: () => api.get("/wallet/packages"),
  balance: () => api.get("/wallet/balance"),
  transactions: () => api.get("/wallet/transactions"),
  initiate: (amount: number, package_id?: string) =>
    api.post("/wallet/recharge/initiate", { amount, package_id }),
  verifyPending: (order_id?: string) =>
    api.post("/wallet/recharge/verify-pending", order_id ? { order_id } : {}),
  withdraw: (amount: number, upi_id: string, account_name?: string) =>
    api.post("/wallet/withdraw", { amount, upi_id, account_name }),
};

export const appAPI = {
  config: () => api.get("/app/config"),
  notifications: () => api.get("/notifications"),
  unreadCount: () => api.get("/notifications/unread-count"),
  markNotificationRead: (id: string) => api.post(`/notifications/${id}/read`),
  deleteNotification: (id: string) => api.delete(`/notifications/${id}`),
  markNotificationsRead: () => api.post("/notifications/read-all"),
  support: (subject: string, message: string) =>
    api.post("/support/message", { subject, message }),
  supportMessages: () => api.get("/support/messages"),
};
