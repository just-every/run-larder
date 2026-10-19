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
      ...step, runMinutes: step.minutes,
      setupMinutes: Number(text(data, prefix + 'setupMinutes') || '0'),
      queueMinutes: Number(text(data, prefix + 'queueMinutes') || '0'),
      dependsOn: text(data, prefix + 'dependsOn').toLowerCase() === 'none' ? [] : text(data, prefix + 'dependsOn') ? text(data, prefix + 'dependsOn').split(',').map(Number) : index ? [index] : [],
      eligibleCentres: separated(text(data, prefix + 'eligibleCentres') || step.workCentre),
      requiredSkills: separated(text(data, prefix + 'requiredSkills')),
      instructions: text(data, prefix + 'instructions'),
      drawings: file instanceof File && file.size ? [{ name: file.name, contentType: file.type, base64: await fileBase64(file) }] : [],
    }
  }))
}

export function RoutingEditor() {
  const [routing, setRouting] = useState('')
  const ref = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    const form = ref.current?.form
    const reset = () => setRouting('')
    form?.addEventListener('reset', reset)
    return () => form?.removeEventListener('reset', reset)
  }, [])
  const steps = stepsFrom(routing)
  return <fieldset ref={ref} className="lines wide"><legend>Routing and instructions</legend>
    <Area label="Routing (one step per line: step, work center, minutes)" name="routing" required={false} value={routing} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setRouting(event.target.value)} placeholder={'Plane and cut, Bench, 20\nOil, Finishing, 5'} />
    <p className="muted">Minutes are run time per unit. Dependencies default to the previous step. Eligible centers and skills use semicolons.</p>
    {steps.map((step, index) => {
      const sequence = index + 1, prefix = `routing.${sequence}.`, label = `Step ${sequence}`
      return <fieldset className="lines wide" key={sequence}><legend>{label}: {step.name}</legend><div className="form-grid">
        <Field label={`${label} setup minutes`} name={prefix + 'setupMinutes'} type="number" min="0" max="100000" step="any" defaultValue="0" required={false} />
        <Field label={`${label} queue minutes`} name={prefix + 'queueMinutes'} type="number" min="0" max="100000" step="any" defaultValue="0" required={false} />
        <Field label={`${label} eligible centers`} name={prefix + 'eligibleCentres'} required={false} hint="Semicolon separated; blank uses the routing work center." />
        <Field label={`${label} required skills`} name={prefix + 'requiredSkills'} required={false} hint="Semicolon separated." />
        <Field label={`${label} predecessors`} name={prefix + 'dependsOn'} required={false} hint="Earlier step numbers, comma separated; blank uses the previous step; “none” starts an independent step." />
        <Area label={`${label} instructions`} name={prefix + 'instructions'} required={false} />
        <Field label={`${label} drawing file`} name={prefix + 'drawing'} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required={false} hint="PDF or image, up to 1 MiB." />
      </div></fieldset>
    })}
    <div className="actions"><button className="button" type="button" disabled={steps.length >= 50} onClick={() => setRouting(value => `${value.trim()}${value.trim() ? '\n' : ''}Operation ${steps.length + 1}, , 0`)}>Add step</button>
      {steps.length > 0 && <button className="button" type="button" onClick={() => setRouting(value => value.split('\n').filter(line => line.trim()).slice(0, -1).join('\n'))}>Remove last step</button>}</div>
  </fieldset>
}
