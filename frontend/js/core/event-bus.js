/** Tiny typed-ish event bus used by pages and components. */

export function createEventBus() {
  const listeners = new Map();

  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => this.off(event, handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[event-bus] handler failed for "${event}"`, error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

export const bus = createEventBus();
