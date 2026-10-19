// CAP-009: an ETA never releases equipment; repair evidence and a human do.
import { attach } from './attachments'
import { bump, fresh, get, nextReference, oneOf, optionalText, row, text, type Context, type Row } from './model'
import { fail } from './problem'
import { allow } from './roles'
import { timestamp } from './timestamp'

export function maintenance(c: Context, type: string, p: any): Row | undefined {
  if (!['maintenance.create', 'maintenance.update', 'maintenance.release'].includes(type)) return
  allow(c, ['manager'])
  if (type === 'maintenance.create') {
    const workCentre = text(p.workCentre, 'work center', 120)
    const centres = [...c.s.boms.flatMap(b => b.routing ?? []), ...c.s.workOrders.flatMap(w => w.routing ?? [])]
      .flatMap(r => [r.workCentre, ...(r.eligibleCentres ?? [])])
    if (!centres.includes(workCentre)) fail('WORK_CENTER', 'Choose a named work center from an existing routing.')
    const kind = oneOf(p.kind, ['preventive', 'breakdown'] as const, 'maintenance kind')
    const startsAt = kind === 'breakdown' ? c.now : timestamp(p.startsAt, 'maintenance start')
    if (kind === 'preventive' && startsAt < c.now) fail('INPUT', 'Preventive maintenance must start now or in the future.')
    const expectedReturnAt = timestamp(p.expectedReturnAt, 'expected return')
    if (expectedReturnAt <= startsAt) fail('INPUT', 'Expected return must be after maintenance starts.')
    const repairOwner = text(p.repairOwner, 'repair owner', 200), note = text(p.note, 'maintenance note')
    return row(c, 'maintenance', { reference: nextReference(c.s.maintenance, 'MT'), workCentre, kind, startsAt, expectedReturnAt, repairOwner,
      cmmsId: optionalText(p.cmmsId, 'CMMS record ID', 200), status: 'unreleased',
      evidence: p.evidence ? [attach(c, p.evidence)] : [], history: [{ type: 'created', by: c.actor.id, at: c.now, note, repairOwner, expectedReturnAt }] })
  }
  const m = get(c.s, 'maintenance', p.maintenanceId, 'maintenance record'); fresh(m, p.version)
  if (m.status !== 'unreleased') fail('STATE', 'Released maintenance is immutable; create a new record for later work.')
  const note = text(p.note, 'maintenance note')
  if (type === 'maintenance.update') {
    const repairOwner = text(p.repairOwner, 'repair owner', 200), expectedReturnAt = timestamp(p.expectedReturnAt, 'expected return')
    if (expectedReturnAt <= m.startsAt || expectedReturnAt <= c.now) fail('INPUT', 'A revised expected return must be after the start and now.')
    const evidence = p.evidence ? [...m.evidence, attach(c, p.evidence)] : m.evidence
    const cmmsId = p.cmmsId === undefined ? m.cmmsId : optionalText(p.cmmsId, 'CMMS record ID', 200)
    return bump(m, { repairOwner, expectedReturnAt, cmmsId, evidence,
      history: [...m.history, { type: 'updated', by: c.actor.id, at: c.now, note, repairOwner, expectedReturnAt, cmmsId }] })
  }
  if (c.now < m.startsAt) fail('STATE', 'Release only after this maintenance has started and repair is recorded.')
  const evidence = [...m.evidence, attach(c, p.evidence)]
  return bump(m, { status: 'released', releasedAt: c.now, releasedBy: c.actor.id, repairNote: note, evidence,
    history: [...m.history, { type: 'released', by: c.actor.id, at: c.now, note, evidenceId: evidence.at(-1)!.id }] })
}
