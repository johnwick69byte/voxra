/**
 * Routes an incoming call into the app from any entry point.
 *
 * Incoming calls can arrive through several paths:
 *   - a socket event while the app is open (handled in _layout directly),
 *   - a tap on the system notification while the app is running,
 *   - a tap that cold-starts the app (getInitialNotification),
 *   - the Accept action button on the notification.
 *
 * The notification paths can fire before the router is mounted (index.js runs
 * before React), so payloads are buffered until a subscriber attaches.
 * Previously these were written to AsyncStorage and read once on mount, which
 * silently dropped any tap that happened while the app was already running.
 */

export type CallRoutePayload = {
  call_id?: string;
  caller_id?: string;
  caller_name?: string;
  caller_picture?: string;
  call_type?: string;
  channel_name?: string;
  decline_token?: string;
  action?: string;
  type?: string;
};

type Handler = (payload: CallRoutePayload) => void;

const handlers = new Set<Handler>();
let buffered: CallRoutePayload | null = null;

export function emitCallRoute(payload: CallRoutePayload) {
  if (!payload?.call_id) return;
  if (handlers.size === 0) {
    // No subscriber yet (app still booting) -- hold the latest one.
    buffered = payload;
    return;
  }
  handlers.forEach((h) => {
    try {
      h(payload);
    } catch (e) {
      console.warn("[callRouter] handler failed", e);
    }
  });
}

export function subscribeCallRoute(handler: Handler): () => void {
  handlers.add(handler);
  if (buffered) {
    const pending = buffered;
    buffered = null;
    // Deliver after subscribing so the caller's state is ready.
    setTimeout(() => {
      try {
        handler(pending);
      } catch (e) {
        console.warn("[callRouter] buffered handler failed", e);
      }
    }, 0);
  }
  return () => handlers.delete(handler);
}
