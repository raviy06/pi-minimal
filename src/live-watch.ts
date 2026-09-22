export type LiveWatch = {
  watch: (id: string, invalidate: () => void) => void
  unwatch: (id: string) => void
  has: (id: string) => boolean
  stop: () => void
  tick: () => void
  readonly frame: 0 | 1
  readonly size: number
}

export function createLiveWatch(intervalMs = 400): LiveWatch {
  let frame: 0 | 1 = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const invalidators = new Map<string, () => void>()

  const tick = () => {
    frame = frame === 0 ? 1 : 0
    const snapshot = [...invalidators.values()]
    for (const invalidate of snapshot) {
      try {
        invalidate()
      } catch {}
    }
  }

  return {
    watch(id, invalidate) {
      if (!id) return
      invalidators.set(id, invalidate)
      if (!timer) timer = setInterval(tick, intervalMs)
    },
    unwatch(id) {
      if (!id) return
      invalidators.delete(id)
      if (invalidators.size === 0 && timer) {
        clearInterval(timer)
        timer = undefined
      }
    },
    has(id) {
      return Boolean(id) && invalidators.has(id)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
      invalidators.clear()
      frame = 0
    },
    tick,
    get frame() {
      return frame
    },
    get size() {
      return invalidators.size
    },
  }
}
