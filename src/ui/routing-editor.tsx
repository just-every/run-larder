import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Area, Field, fileBase64, text } from './controls'

const stepsFrom = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
  const [name, workCentre = '', minutes = '0'] = line.split(',').map(cell => cell.trim())
  return { name, workCentre, minutes: Number(minutes) }
})
const separated = (value: string) => value.split(';').map(part => part.trim()).filter(Boolean)

export async function routingFromForm(data: FormData) {
  return Promise.all(stepsFrom(text(data, 'routing')).map(async (step, index) => {
    const prefix = `routing.${index + 1}.`, file = data.get(prefix + 'drawing')
    return {
      ...step, runMinutes: step.minutes, setupFamily: text(data, prefix + 'setupFamily'), requiredTools: separated(text(data, prefix + 'requiredTools')),
      setupMinutes: Number(text(data, prefix + 'setupMinutes') || '0'),
      queueMinutes: Number(text(data, prefix + 'queueMinutes') || '0'),
      dependsOn: text(data, prefix + 'dependsOn').toLowerCase() === 'none' ? [] : text(data, prefix + 'dependsOn') ? text(data, prefix + 'dependsOn').split(',').map(Number) : index ? [index] : [],
      eligibleCentres: separated(text(data, prefix + 'eligibleCentres') || step.workCentre),
      requiredSkills: separated(text(data, prefix + 'requiredSkills')),
      transferBatch: text(data, prefix + 'transferBatch') || '0',
      allowOverlap: data.has(prefix + 'allowOverlap'),
      requireMaterials: data.has(prefix + 'requireMaterials'),
      instructions: text(data, prefix + 'instructions'),
      drawings: file instanceof File && file.size ? [{ name: file.name, contentType: file.type, base64: await fileBase64(file) }] : [],
    }
  }))
}

export function RoutingEditor() {
  const [routing, setRouting] = useState('')
  const [gates, setGates] = useState<Record<number, { predecessors?: string; batch?: string; overlap?: boolean }>>({})
  const ref = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    const form = ref.current?.form
    const reset = () => { setRouting(''); setGates({}) }
    form?.addEventListener('reset', reset)
    return () => form?.removeEventListener('reset', reset)
  }, [])
  const steps = stepsFrom(routing)
  const updateRouting = (value: string) => {
    const count = stepsFrom(value).length
    setRouting(value)
    setGates(current => Object.fromEntries(Object.entries(current).filter(([sequence]) => Number(sequence) <= count)))
  }
  return <fieldset ref={ref} className="lines wide"><legend>Routing and instructions</legend>
    <Area label="Routing (one step per line: step, work center, minutes)" name="routing" required={false} value={routing} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateRouting(event.target.value)} placeholder={'Plane and cut, Bench, 20\nOil, Finishing, 5'} />
    <p className="muted">Minutes are run time per unit. Dependencies default to the previous step. Eligible centers and skills use semicolons.</p>
    {steps.map((step, index) => {
      const sequence = index + 1, prefix = `routing.${sequence}.`, label = `Step ${sequence}`, gate = gates[sequence] ?? {}
      const dependencies = gate.predecessors?.trim() ?? '', batch = gate.batch ?? '0'
      const hasPredecessor = dependencies ? dependencies.toLowerCase() !== 'none' && dependencies.split(',').some(n => Number(n) > 0 && Number(n) < sequence) : index > 0
      const canOverlap = hasPredecessor && /^\d{1,10}(\.\d{1,6})?$/.test(batch) && Number(batch) > 0
      const updateGate = (change: Partial<typeof gate>) => setGates(current => ({ ...current, [sequence]: { ...current[sequence], ...change } }))
      return <fieldset className="lines wide" key={sequence}><legend>{label}: {step.name}</legend><div className="form-grid">
        <Field label={`${label} setup minutes`} name={prefix + 'setupMinutes'} type="number" min="0" max="100000" step="any" defaultValue="0" required={false} />
        <Field label={`${label} queue minutes`} name={prefix + 'queueMinutes'} type="number" min="0" max="100000" step="any" defaultValue="0" required={false} />
        <Field label={`${label} eligible centers`} name={prefix + 'eligibleCentres'} required={false} hint="Semicolon separated; blank uses the routing work center." />
        <Field label={`${label} setup family`} name={prefix + 'setupFamily'} required={false} /><Field label={`${label} required tools`} name={prefix + 'requiredTools'} required={false} hint="Semicolon separated qualified tool names." />
        <Field label={`${label} required skills`} name={prefix + 'requiredSkills'} required={false} hint="Semicolon separated." />
        <Field label={`${label} predecessors`} name={prefix + 'dependsOn'} value={gate.predecessors ?? ''} onChange={(event: ChangeEvent<HTMLInputElement>) => updateGate({ predecessors: event.target.value })} required={false} hint="Earlier step numbers, comma separated; blank uses the previous step; “none” starts an independent step." />
        <Field label={`${label} transfer batch`} name={prefix + 'transferBatch'} value={batch} onChange={(event: ChangeEvent<HTMLInputElement>) => updateGate({ batch: event.target.value })} inputMode="decimal" pattern="[0-9]{1,10}([.][0-9]{1,6})?" required={false} hint="Finished-item base units physically transferred from each predecessor before start; blank or 0 uses full predecessor completion without a separate batch gate." />
        <label className="check"><input type="checkbox" name={prefix + 'allowOverlap'} checked={canOverlap && Boolean(gate.overlap)} disabled={!canOverlap} onChange={(event: ChangeEvent<HTMLInputElement>) => updateGate({ overlap: event.target.checked })} /> {label} allow overlap with predecessors</label>
        <p className="muted wide">Overlap requires a positive transfer batch and an earlier predecessor. Required predecessor inspections still apply. Without overlap, predecessors must also complete. A batch-gated step cannot complete until the full job quantity has been handed off from each predecessor.</p>
        <label className="check"><input type="checkbox" name={prefix + 'requireMaterials'} /> {label} require all job materials issued before start</label>
        <Area label={`${label} instructions`} name={prefix + 'instructions'} required={false} />
        <Field label={`${label} drawing file`} name={prefix + 'drawing'} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={false} hint="PDF or image, up to 1 MiB." />
      </div></fieldset>
    })}
    <div className="actions"><button className="button" type="button" disabled={steps.length >= 50} onClick={() => setRouting(value => `${value.trim()}${value.trim() ? '\n' : ''}Operation ${steps.length + 1}, , 0`)}>Add step</button>
      {steps.length > 0 && <button className="button" type="button" onClick={() => updateRouting(routing.split('\n').filter(line => line.trim()).slice(0, -1).join('\n'))}>Remove last step</button>}</div>
  </fieldset>
}
