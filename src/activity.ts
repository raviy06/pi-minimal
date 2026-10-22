export type ActivityContext = {
  isPartial?: boolean
  isError?: boolean
  state?: { done?: boolean; running?: boolean }
}

export function rowIsRunning(context: ActivityContext): boolean {
  if (context.isError) return false
  if (context.state?.done) return false
  if (context.isPartial === false) return false
  return true
}
