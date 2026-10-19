// Shared with the schedule: reports are whole-job estimates, never stock or
// inferred completion. Unreported tasks retain the pinned routing estimate.
import type { Row } from './model'
export function operationEffort(w: Row, step: any): number {
  const task = w.operationStates?.find((t: any) => t.sequence === step.sequence)
  if (task?.status === 'done') return 0
  if (task?.progress) return task.progress.remainingMinutes
  const quantity = Math.max(0, Number(w.quantity) - Number(w.output) - Number(w.scrap))
  return (step.setupMinutes ?? 0) + (step.runMinutes ?? step.minutes) * quantity + (step.queueMinutes ?? 0)
}
export function operationReady(w: Row, step: any, now: Date): Date | undefined {
  const task = w.operationStates?.find((t: any) => t.sequence === step.sequence)
  if (!['running', 'paused'].includes(task?.status)) return
  const pause = task.downtime?.findLast((d: any) => !d.stoppedAt)
  return new Date(Math.max(now.getTime(), pause ? Date.parse(pause.anticipatedResumeAt) : 0))
}
