// ENG-002: one routing definition shared by direct edits and CSV revisions.
import { decimal, format } from './decimal'
import { attach } from './attachments'
import { fail } from './problem'
import { optionalText, text, type Context, type Row } from './model'

const minutes = (value: unknown, name: string) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000 ? value : fail('INPUT', `${name} must be between 0 and 100000 minutes.`)
const names = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.length > 20) fail('INPUT', `${name} must be a list of at most 20 names.`)
  return [...new Set((value as unknown[]).map(v => text(v, name, 120)))]
}
const fields = ['sequence', 'name', 'workCentre', 'minutes', 'runMinutes', 'setupMinutes', 'queueMinutes', 'dependsOn', 'eligibleCentres', 'requiredSkills', 'instructions', 'drawings', 'transferBatch', 'allowOverlap', 'requireMaterials', 'setupFamily', 'requiredTools']

// Drawing references are resolved against retained revisions, never trusted from
// an uploaded CSV. New bytes are attached atomically by bom.revise only.
export function normalizeRouting(value: unknown, boms: Row[] = [], c?: Context): any[] {
  if (!Array.isArray(value) || value.length > 50) fail('INPUT', 'Routing must be an array of at most 50 operations.')
  return (value as any[]).map((step, index) => {
    const sequence = index + 1
    if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).some(k => !fields.includes(k))) fail('INPUT', `Operation ${sequence} has invalid fields.`)
    if (step.sequence !== undefined && step.sequence !== sequence) fail('INPUT', 'Operation sequence must match array order.')
    const workCentre = optionalText(step.workCentre, 'work center', 120)
    const eligibleCentres = names(step.eligibleCentres ?? (workCentre ? [workCentre] : []), 'eligible centers')
    if (workCentre && !eligibleCentres.includes(workCentre)) fail('INPUT', 'The primary work center must be eligible.')
    const dependsOn = step.dependsOn ?? (index ? [index] : [])
    if (!Array.isArray(dependsOn) || dependsOn.length > index || dependsOn.some(n => !Number.isInteger(n) || n < 1 || n >= sequence) || new Set(dependsOn).size !== dependsOn.length) fail('INPUT', `Operation ${sequence} predecessors must be unique earlier operation numbers.`)
    for (const key of ['allowOverlap', 'requireMaterials']) if (step[key] !== undefined && typeof step[key] !== 'boolean') fail('INPUT', `${key} must be true or false.`)
    const transferBatch = format(decimal(step.transferBatch ?? '0', 'transfer batch'))
    if ((transferBatch !== '0' || step.allowOverlap) && !dependsOn.length) fail('INPUT', 'Transfer batches need a predecessor operation.')
    if (step.allowOverlap && transferBatch === '0') fail('INPUT', 'Overlapping operations need a positive transfer batch.')
    const runMinutes = minutes(step.runMinutes ?? step.minutes, 'Run time')
    if (step.runMinutes !== undefined && step.minutes !== undefined && step.runMinutes !== step.minutes) fail('INPUT', 'Run minutes and legacy minutes must agree.')
    if (step.drawings !== undefined && (!Array.isArray(step.drawings) || step.drawings.length > 5)) fail('INPUT', 'Attach at most five drawings per operation.')
    const drawings = (step.drawings ?? []).map((drawing: any) => {
      if (drawing?.id) {
        const existing = boms.flatMap(b => b.routing ?? []).flatMap(r => r.drawings ?? []).find(d => d.id === drawing.id)
        return existing ?? fail('EVIDENCE', 'Drawing reference is not retained in a BOM revision. Upload its original file.')
      }
      if (!c) fail('EVIDENCE', 'CSV drawings must reference retained BOM drawings.')
      return attach(c!, drawing)
    })
    return { sequence, name: text(step.name, 'step name', 120), workCentre, minutes: runMinutes, runMinutes,
      setupMinutes: minutes(step.setupMinutes ?? 0, 'Setup time'), queueMinutes: minutes(step.queueMinutes ?? 0, 'Queue time'),
      dependsOn, transferBatch, allowOverlap: step.allowOverlap ?? false, requireMaterials: step.requireMaterials ?? false, eligibleCentres, requiredSkills: names(step.requiredSkills ?? [], 'required skills'),
      setupFamily: optionalText(step.setupFamily, 'setup family', 120), requiredTools: names(step.requiredTools ?? [], 'required tools'),
      instructions: optionalText(step.instructions, 'step instructions', 8000), drawings }
  })
}
