/** A tiny change-notification set shared by the git and sibling sources. */
export function createListeners() {
  const listeners = new Set<() => void>()
  return {
    notify() {
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          // One listener's failure must not starve the others.
        }
      }
    },
    add(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clear() {
      listeners.clear()
    },
  }
}
