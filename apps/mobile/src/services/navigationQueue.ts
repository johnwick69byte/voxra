/**
 * Buffers a navigation target until the router is mounted.
 *
 * A push tapped from a cold start runs before React mounts, so
 * `router.push()` would be a no-op. The target is held here and flushed by
 * <NavigationFlush /> once the app is ready.
 */

type Listener = (path: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

export function queueNavigation(path: string) {
  if (!path) return;
  if (listeners.size === 0) {
    pending = path;
    return;
  }
  listeners.forEach((l) => {
    try {
      l(path);
    } catch (e) {
      console.warn("[navQueue] listener failed", e);
    }
  });
}

export function subscribeNavigation(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const target = pending;
    pending = null;
    setTimeout(() => {
      try {
        listener(target);
      } catch (e) {
        console.warn("[navQueue] buffered listener failed", e);
      }
    }, 0);
  }
  return () => listeners.delete(listener);
}
