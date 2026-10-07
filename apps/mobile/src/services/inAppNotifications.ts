/**
 * Non-call push notifications.
 *
 * Two distinct Android behaviours this has to cover:
 *
 * 1. FOREGROUND: FCM `notification` messages are delivered to `onMessage` and
 *    nothing is drawn automatically, so we must display them ourselves.
 *
 * 2. BACKGROUND/KILLED: Android draws the notification for us, but a tap only
 *    reaches JS through `onNotificationOpenedApp` / `getInitialNotification`.
 *    Without handling those the tap silently did nothing.
 *
 * Call notifications are deliberately excluded -- those are owned by
 * IncomingCallService / CallKeep and must never be drawn twice.
 */

import { Platform } from "react-native";
import type { CallRoutePayload } from "./callRouter";

type PushData = CallRoutePayload & {
  title?: string;
  message?: string;
  body?: string;
  reason?: string;
  creator_id?: string;
  user_id?: string;
};

const CHANNEL_DEFAULT = "app_notifications";

function getNotifee(): any | null {
  try {
    const mod = require("@notifee/react-native");
    return mod.default || mod;
  } catch {
    return null;
  }
}

/** Human title/body for a push payload, falling back to sensible copy. */
function copyFor(data: PushData): { title: string; body: string } {
  const title = data.title || defaultTitle(data.type);
  const body = data.body || data.message || defaultBody(data.type);
  return { title, body };
}

function defaultTitle(type?: string): string {
  switch (type) {
    case "creator_online":
      return "Creator is online";
    case "profile_verified":
      return "You're approved!";
    case "profile_rejected":
      return "Verification needs a new selfie";
    case "withdrawal_approved":
      return "Withdrawal approved";
    case "withdrawal_rejected":
      return "Withdrawal update";
    case "withdrawal_increase_approved":
      return "Withdrawal limit increased";
    case "withdrawal_increase_rejected":
      return "Withdrawal limit request";
    case "gift_received":
      return "You received a gift";
    case "new_follower":
      return "New follower";
    case "admin_broadcast":
      return "Simple Talk";
    default:
      return "Simple Talk";
  }
}

function defaultBody(type?: string): string {
  switch (type) {
    case "creator_online":
      return "They're available for an instant call.";
    case "profile_verified":
      return "Your creator profile is live. Go online and take calls.";
    case "profile_rejected":
      return "Open Simple Talk and retake a clear live selfie.";
    case "withdrawal_approved":
      return "Your payout is on the way.";
    case "withdrawal_rejected":
      return "Your withdrawal request was not approved.";
    case "withdrawal_increase_approved":
      return "Your withdrawal limit request was approved.";
    case "withdrawal_increase_rejected":
      return "Your withdrawal limit request was not approved.";
    case "gift_received":
      return "Someone sent you a gift.";
    case "new_follower":
      return "Someone started following you.";
    default:
      return "You have a new update.";
  }
}

/**
 * Draw a notification for a non-call push.
 *
 * No-ops without the native module (Expo Go) and skips call events.
 */
export async function displayGeneralNotification(data: PushData): Promise<void> {
  if (data?.type === "incoming_call") return;
  const notifee = getNotifee();
  if (!notifee) return;

  try {
    const { AndroidImportance, AndroidStyle } = require("@notifee/react-native");
    const { title, body } = copyFor(data);

    await notifee.createChannel({
      id: CHANNEL_DEFAULT,
      name: "Notifications",
      importance: AndroidImportance?.DEFAULT ?? 3,
      sound: "default",
    });

    await notifee.displayNotification({
      id: `ntf_${data.type || "general"}_${data.creator_id || data.call_id || Date.now()}`,
      title,
      body,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
      ) as Record<string, string>,
      android: {
        channelId: CHANNEL_DEFAULT,
        smallIcon: "ic_notification",
        color: "#0F766E",
        pressAction: { id: "default", launchActivity: "default" },
        // Long bodies (admin broadcasts) get expandable text instead of a cut-off.
        style: body.length > 60 ? { type: AndroidStyle?.BIGTEXT ?? 2, text: body } : undefined,
      },
    });
  } catch (e) {
    console.warn("[push] could not display notification", e);
  }
}

/**
 * Handle a tap on a non-call notification.
 *
 * Routes to the most useful screen for the type. Buffered via the call router's
 * sibling queue so a cold start still navigates once the UI is mounted.
 */
export async function routeGeneralNotification(data: PushData): Promise<void> {
  if (!data?.type || data.type === "incoming_call") return;

  // The notification centre is the safe destination for everything: it renders
  // the server-side notification list, so the user never lands nowhere.
  const target = "/notifications";
  try {
    const { queueNavigation } = require("./navigationQueue");
    queueNavigation(target);
  } catch (e) {
    console.warn("[push] could not route notification", e);
  }
}
