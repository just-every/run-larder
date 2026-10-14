import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { itemName, locationName, partyName, personName, type LarderState, type Rec } from './api'
import { day, money, qty } from './format'

export function Field({ label, name, hint, required = true, ...props }: { label: string; name: string; hint?: string; required?: boolean; [key: string]: any }) {
  return <label className="field"><span>{label}</span><input aria-label={label} name={name} required={required} {...props} />{hint && <small>{hint}</small>}</label>
}
export function Area({ label, name, required = true, ...props }: { label: string; name: string; required?: boolean; [key: string]: any }) {
  return <label className="field wide"><span>{label}</span><textarea aria-label={label} name={name} required={required} rows={4} {...props} /></label>
}
export function Choose({ label, name, options, required = true, ...props }: { label: string; name: string; options: { value: string; label: string }[]; required?: boolean; [key: string]: any }) {
  return <label className="field"><span>{label}</span><select aria-label={label} name={name} required={required} {...props}><option value="">Choose…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
}
export const options = (list: Rec[], label: (r: Rec) => string) => list.map(r => ({ value: r.id, label: label(r) }))
export const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim()

export function Form({ title, submit, onSubmit, busy, children, note, quiet }: { title?: string; submit: string; onSubmit: (data: FormData, form: HTMLFormElement) => unknown; busy?: boolean; children: ReactNode; note?: ReactNode; quiet?: boolean }) {
  function handle(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (!busy) { const form = e.currentTarget; void Promise.resolve(onSubmit(new FormData(form), form)).then(ok => { if (ok) form.reset() }) } }
  return <form className="form" onSubmit={handle}>{title && <h3>{title}</h3>}{note && <p className="muted">{note}</p>}<div className="form-grid">{children}</div><div className="form-actions"><button type="submit" className={quiet ? 'button' : 'button primary'} disabled={busy}>{submit}</button></div></form>
}

export function Card({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{(title || aside) && <header className="card-head">{title && <h2>{title}</h2>}{aside}</header>}{children}</section>
}

// On a phone a table of more than two columns becomes labelled stacks: each cell carries its column's name.
export function Table({ head, children, numeric = [], stack = head.length > 2 }: { head: string[]; children: ReactNode; numeric?: number[]; stack?: boolean }) {
  const label = (row: ReactNode) => isValidElement<{ children?: ReactNode }>(row) ? cloneElement(row, {}, Children.toArray(row.props.children).map((cell, i) => isValidElement(cell) && head[i] ? cloneElement(cell as ReactElement<Record<string, unknown>>, { 'data-label': head[i] }) : cell)) : row
  return <div className={stack ? 'table-wrap stack-table' : 'table-wrap'}><table><thead><tr>{head.map((h, i) => <th key={i} className={numeric.includes(i) ? 'num' : undefined} scope="col">{h}</th>)}</tr></thead><tbody>{stack ? Children.map(children, label) : children}</tbody></table></div>
}

export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>
}

export function Empty({ children, picture }: { children: ReactNode; picture?: Goods }) {
  return picture ? <p className="empty pictured"><GoodsPicture name={picture} />{children}</p> : <p className="empty">{children}</p>
}

// The riso goods printed from the picks (public/brand/goods): shown only where the kind of thing is known.
export type Goods = 'docket' | 'po' | 'board' | 'blanks' | 'bottle' | 'parcel' | 'papers' | 'still-life'
export function GoodsPicture({ name, className = 'goods' }: { name: Goods; className?: string }) {
  return <img className={className || undefined} src={`/brand/goods/${name}.webp`} alt="" loading="lazy" />
}

// A disclosure with the facts behind a refusal or a proposal, in words: records by name, numbers formatted,
// internal ids left out.
const named: Record<string, (s: LarderState, id: string) => string> = { itemId: itemName, locationId: locationName, partyId: partyName, supplierId: partyName, customerId: partyName, actorId: personName, operatorId: personName }
const heading = (key: string) => { const t = key.replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }
function Facts({ value, s, asMoney }: { value: unknown; s?: LarderState; asMoney?: boolean }): ReactNode {
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.every(v => typeof v !== 'object' || v === null) ? value.map(String).join('; ') : <>{value.map((v, i) => <Facts key={i} value={v} s={s} />)}</>
  if (value && typeof value === 'object') {
    const rows = Object.entries(value).filter(([k, v]) => v !== undefined && v !== null && v !== '' && (named[k] ? !!s : !/(^id$|Id$)/.test(k)))
    return <dl>{rows.map(([k, v]) => <div key={k} className="fact"><dt>{heading(k)}</dt><dd>{named[k] ? named[k](s!, String(v)) : <Facts value={v} s={s} asMoney={/price|amount|cost|exposure|value/i.test(k)} />}</dd></div>)}</dl>
  }
  const t = String(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? day(t) : /^-?\d+(\.\d+)?$/.test(t) ? (asMoney ? money(t) : qty(t)) : t
}
export function Details({ label = 'Details', value, s }: { label?: string; value: unknown; s?: LarderState }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  return <div className="details"><button ref={button} type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
    {open && <div ref={ref} tabIndex={-1} className="details-body" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }}><Facts value={value} s={s} /></div>}</div>
}

// Line entry for orders: item, quantity and price per row.
export function Lines({ items, price = true, name = 'lines' }: { items: Rec[]; price?: boolean; name?: string }) {
  const [count, setCount] = useState(1)
  return <fieldset className="lines wide"><legend>Lines</legend>{Array.from({ length: count }, (_, i) => <div className="line" key={i}>
    <Choose label={`Item ${i + 1}`} name={`${name}.${i}.itemId`} options={options(items, r => `${r.name} · ${r.sku}`)} />
    <Field label="Quantity" name={`${name}.${i}.quantity`} inputMode="decimal" />
    {price && <Field label="Unit price" name={`${name}.${i}.unitPrice`} inputMode="decimal" required={false} hint="Blank uses the list price" />}
  </div>)}<button type="button" className="button" onClick={() => setCount(count + 1)}>Add line</button></fieldset>
}
export function readLines(data: FormData, name = 'lines') {
  const out: Record<string, string>[] = []
  for (const [key, value] of data.entries()) {
    const m = new RegExp(`^${name}\\.(\\d+)\\.(\\w+)$`).exec(key)
    if (!m) continue
    const i = Number(m[1]); out[i] ??= {}; if (String(value).trim()) out[i][m[2]] = String(value).trim()
  }
  return out.filter(l => l && l.itemId)
}

export const fileBase64 = (file: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.onerror = () => reject(r.error); r.readAsDataURL(file) })
