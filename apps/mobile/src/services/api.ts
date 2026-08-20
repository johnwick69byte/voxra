import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://voxra-dkfe.onrender.com/api";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("voxora_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authAPI = {
  sendOtp: (phone: string, country_code = "+91") =>
    api.post("/auth/otp/send", { phone, country_code }),
  verifyOtp: (phone: string, otp: string, user_type?: string, country_code = "+91") =>
    api.post("/auth/otp/verify", { phone, otp, user_type, country_code }),
  me: () => api.get("/auth/me"),
  completeProfile: (data: Record<string, unknown>) =>
    api.post("/auth/complete-profile", data),
  updateProfile: (data: Record<string, unknown>) =>
    api.post("/auth/update-profile", data),
};

export const creatorsAPI = {
  browse: (params?: Record<string, unknown>) => api.get("/creators/browse", { params }),
  get: (id: string) => api.get(`/creators/${id}`),
  status: (id: string) => api.get(`/creators/${id}/status`),
  follow: (id: string) => api.post(`/follow/${id}`),
  unfollow: (id: string) => api.delete(`/follow/${id}`),
  following: () => api.get("/following"),
  pricingSetup: (data: Record<string, unknown>) => api.post("/profile/pricing-setup", data),
  toggleDnd: () => api.post("/profile/dnd"),
  pushToken: (device_push_token: string, platform: string) =>
    api.post("/profile/push-token", { device_push_token, platform }),
  submitVerificationSelfie: (image_base64: string) =>
    api.post("/profile/verification/selfie", { image_base64 }),
  onboardingStatus: () => api.get("/profile/onboarding-status"),
  block: (userId: string) => api.post(`/users/${userId}/block`),
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
  verifyPending: (order_id: string) =>
    api.post("/wallet/recharge/verify-pending", { order_id }),
  withdraw: (amount: number, upi_id: string) =>
    api.post("/wallet/withdraw", { amount, upi_id }),
};

export const appAPI = {
  config: () => api.get("/app/config"),
  notifications: () => api.get("/notifications"),
  support: (subject: string, message: string) =>
    api.post("/support/message", { subject, message }),
};
