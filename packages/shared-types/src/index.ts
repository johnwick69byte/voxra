/** Shared Voxora TypeScript types. */

export type UserType = "user" | "creator" | "admin";

export type CreatorStatus = "ACTIVE" | "BUSY" | "DND" | "OFFLINE";

export type CallStatus =
  | "RINGING"
  | "ACCEPTED"
  | "LIVE"
  | "ENDED"
  | "REJECTED"
  | "CANCELLED"
  | "MISSED"
  | "ENDED_INSUFFICIENT_BALANCE"
  | "ENDED_DISCONNECT";

export type CallType = "AUDIO" | "VIDEO";

export interface User {
  user_id: string;
  name?: string | null;
  username?: string | null;
  phone?: string;
  picture?: string | null;
  user_type: UserType;
  profile_complete?: boolean;
  referral_code?: string;
}

export interface CreatorProfile {
  user_id: string;
  bio?: string;
  images: string[];
  audio_rate_per_minute?: number | null;
  video_rate_per_minute?: number | null;
  instant_call_enabled: boolean;
  is_dnd: boolean;
  is_approved: boolean;
  verification_status?: string;
  name?: string;
  picture?: string | null;
  status?: CreatorStatus;
}

export interface CallRecord {
  call_id: string;
  caller_id: string;
  receiver_id: string;
  call_type: CallType;
  status: CallStatus;
  channel_name: string;
  rate_per_minute: number;
  total_amount: number;
  duration_seconds?: number;
}

export interface WalletBalance {
  balance: number;
  earnings_balance: number;
}

export interface RechargePackage {
  id: string;
  amount: number;
  bonus: number;
  label: string;
}

export interface AdminMetrics {
  total_users: number;
  total_creators: number;
  pending_creators: number;
  active_calls: number;
  gmv_week: number;
  commission_week: number;
  calls_today: number;
  missed_today: number;
  miss_rate_today: number;
  platform_wallet: number;
}

export interface IncomingCallPayload {
  call_id: string;
  caller_id: string;
  caller_name?: string;
  caller_picture?: string;
  call_type: CallType;
  channel_name: string;
  decline_token?: string;
}
