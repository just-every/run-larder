import type { Row, State } from './model'
import { fail } from './problem'

export function activeMaintenance(s: Pick<State, 'maintenance'>, workCentre: string, at: string): Row[] {
  return s.maintenance.filter(m => m.workCentre === workCentre && m.status === 'unreleased' && m.startsAt <= at)
}
export function assertEquipmentAvailable(s: State, workCentre: string, at: string) {
  const blocked = activeMaintenance(s, workCentre, at)
  if (blocked.length) fail('MAINTENANCE', `${workCentre} is unavailable until maintenance is released after repair.`, { maintenanceIds: blocked.map(m => m.id) })
}
