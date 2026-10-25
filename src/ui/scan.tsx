import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { rows, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Field, Table, options } from './controls'

// FLOOR-008: a USB or Bluetooth scanner types its code and Enter into the scan
// field; a phone or tablet camera decodes frames locally. Each scan is resolved by the server; nothing moves until the person
// posts the scanned lines as one receipt, issue or pick.
type Use = 'receipt' | 'issue' | 'pick' | 'transfer'
type Line = { key: string; lineId: string; itemId: string; item: string; lot: string; lotId: string; serial: boolean; expiresOn: string; quantity: number }
const commandFor = { receipt: 'receipt.create', issue: 'wo.issue', pick: 'shipment.pick', transfer: 'transfer.create' } as const
const titles = { receipt: 'Scan this delivery', issue: 'Scan materials to issue', pick: 'Scan the pick', transfer: 'Scan a transfer' }

export function ScanPanel({ larder, use, doc }: { larder: Larder; use: Use; doc?: Rec }) {
  const s = larder.state!, [lines, setLines] = useState<Line[]>([]), [note, setNote] = useState(''), [refusal, setRefusal] = useState(''), [camera, setCamera] = useState(false)
  const [locationId, setLocationId] = useState(''), [toId, setToId] = useState(''), [slip, setSlip] = useState(''), input = useRef<HTMLInputElement>(null)
  const bins = rows(s, 'locations').filter(l => !l.archived)
  // Scans can arrive faster than a render; the list they check is kept in step here.
  const current = useRef<Line[]>([]), keep = (next: Line[]) => { current.current = next; setLines(next) }
  async function resolve(code: string) {
    setRefusal(''); setNote('')
    // A scanned bin label chooses the location; a transfer's second bin is where the stock goes.
    const bin = bins.find(l => l.name.trim().toUpperCase() === code.trim().toUpperCase())
    if (bin) { if (use === 'transfer' && locationId && locationId !== bin.id) setToId(bin.id); else setLocationId(bin.id); setNote(`Bin ${bin.name} selected.`); return }
    const id = use === 'transfer' ? locationId : doc!.id
    if (!id) { setRefusal('Choose or scan the bin you are moving out of first.'); return }
    const r = await fetch(`/api/larder/scan?code=${encodeURIComponent(code)}&use=${use}&id=${id}`, { credentials: 'same-origin', cache: 'no-store' })
    const b: any = await r.json()
    if (!r.ok) { setRefusal(b.error?.message ?? 'That code was not accepted.'); return }
    const lot: string = b.lot?.code || b.receive?.serial || b.receive?.lot || '', serial = !!(b.lot?.serial || b.receive?.serial)
    const key = `${b.lineId ?? b.item.id}|${lot}`
    const now = current.current
    if (serial && now.some(l => l.key === key)) { setRefusal(`Duplicate scan: serial ${lot} is already on this list.`); return }
    keep(now.some(l => l.key === key) ? now.map(l => l.key === key ? { ...l, quantity: l.quantity + 1 } : l)
      : [...now, { key, lineId: b.lineId ?? '', itemId: b.item.id, item: b.item.name, lot, lotId: b.lot?.id ?? '', serial, expiresOn: b.receive?.expiresOn ?? '', quantity: 1 }])
    setNote(`Scanned ${b.item.name}${lot ? ` · ${serial ? 'serial' : 'lot'} ${lot}` : ''}.`)
  }
  function keyed(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault(); const code = e.currentTarget.value; e.currentTarget.value = ''
    if (code.trim()) void resolve(code)
  }
  async function post() {
    const grouped = (by: (l: Line) => string) => [...new Map(lines.map(l => [by(l), lines.filter(x => by(x) === by(l))])).values()]
    const serials = (ls: Line[]) => ls.filter(l => l.serial).map(l => l.lot)
    const quantity = (ls: Line[]) => String(ls.reduce((n, l) => n + l.quantity, 0))
    if (use === 'transfer') {
      // Each scanned line is its own transfer; posted lines leave the list.
      for (const l of current.current) {
        if (!await larder.run('transfer.create', { itemId: l.itemId, fromLocationId: locationId, toLocationId: toId, quantity: String(l.quantity), ...(l.lotId ? { lotId: l.lotId } : {}), reason: slip })) return
        keep(current.current.filter(x => x.key !== l.key))
      }
      setNote('Posted.'); return
    }
    const payload = use === 'receipt'
      ? { poId: doc!.id, supplierReference: slip, lines: grouped(l => l.serial ? `${l.lineId}|serial` : l.key).map(ls => ({ lineId: ls[0].lineId, locationId, quantity: quantity(ls), inspection: 'accept', ...(ls[0].serial ? { serials: serials(ls) } : { lot: ls[0].lot, ...(ls[0].expiresOn ? { dates: { expiresOn: ls[0].expiresOn } } : {}) }) })) }
      : use === 'issue'
        ? { workOrderId: doc!.id, lines: grouped(l => l.serial ? `${l.itemId}|serial` : l.key).map(ls => ({ itemId: ls[0].itemId, locationId, quantity: quantity(ls), ...(ls[0].serial ? { serials: serials(ls) } : ls[0].lotId ? { lotId: ls[0].lotId } : {}) })) }
        : { orderId: doc!.id, lines: grouped(l => l.serial ? `${l.lineId}|serial` : l.key).map(ls => ({ lineId: ls[0].lineId, locationId, quantity: quantity(ls), ...(ls[0].serial ? { serials: serials(ls) } : ls[0].lotId ? { lotId: ls[0].lotId } : {}) })) }
    if (await larder.run(commandFor[use], payload)) { keep([]); setNote('Posted.') }
  }
  return <section className="scan" aria-label={titles[use]}>
    <h3>{titles[use]}</h3>
    <div className="form-grid">
      <label className="field"><span>Scan code</span><input ref={input} aria-label="Scan code" name="scan" autoComplete="off" onKeyDown={keyed} /><small>Scanner or keyboard, then Enter</small></label>
      <Choose label={use === 'receipt' ? 'Scan into location' : 'Scan from location'} name="scanLocation" options={options(bins, r => r.name)} value={locationId} onChange={(e: any) => setLocationId(e.target.value)} />
      {use === 'transfer' && <Choose label="Move to location" name="scanTo" options={options(bins.filter(l => l.id !== locationId), r => r.name)} value={toId} onChange={(e: any) => setToId(e.target.value)} />}
      {(use === 'receipt' || use === 'transfer') && <Field label={use === 'receipt' ? 'Scanned packing slip' : 'Transfer reason'} name="scanSlip" value={slip} onChange={(e: any) => setSlip(e.target.value)} />}
    </div>
    {<button type="button" className="button" onClick={() => setCamera(!camera)}>{camera ? 'Stop camera' : 'Scan with camera'}</button>}
    {camera && <CameraScan onCode={code => { setCamera(false); void resolve(code) }} />}
    {refusal && <p className="scan-refusal" role="status">Not accepted: {refusal}</p>}{note && <p className="muted" role="status">{note}</p>}
    {lines.length > 0 && <><Table head={['Item', 'Lot or serial', 'Quantity']} numeric={[2]}>{lines.map(l => <tr key={l.key}><td>{l.item}</td><td>{l.lot || '—'}{l.expiresOn && <small>Expires {l.expiresOn}</small>}</td><td className="num">{l.quantity}</td></tr>)}</Table>
      <div className="form-actions"><button type="button" className="button primary" disabled={larder.busy || !locationId || ((use === 'receipt' || use === 'transfer') && !slip.trim()) || (use === 'transfer' && !toId)} onClick={() => void post()}>{{ receipt: 'Receive scanned', issue: 'Issue scanned', pick: 'Pick scanned', transfer: 'Transfer scanned' }[use]}</button><button type="button" className="button" onClick={() => { keep([]); setNote(''); setRefusal(''); input.current?.focus() }}>Clear scans</button></div></>}
  </section>
}

// Decode locally with the bundled reader; camera frames never leave this device.
function CameraScan({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null), [error, setError] = useState('')
  useEffect(() => {
    let stream: MediaStream | undefined, stopped = false, controls: { stop: () => void } | undefined
    async function start() {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      if (stopped) return
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      stream = media
      if (stopped || !video.current) { media.getTracks().forEach(t => t.stop()); return }
      video.current.srcObject = media
      await video.current.play()
      if (stopped) return
      controls = await new BrowserMultiFormatReader().decodeFromVideoElement(video.current, (result, _error, scan) => {
        if (!stopped && result?.getText()) { stopped = true; scan.stop(); media.getTracks().forEach(t => t.stop()); onCode(result.getText()) }
      })
      if (stopped) controls.stop()
    }
    void start().catch(e => { stream?.getTracks().forEach(t => t.stop()); if (!stopped) setError(e?.message ?? 'The camera could not start.') })
    return () => { stopped = true; controls?.stop(); stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return <div className="scan-camera">{error ? <p role="status">{error}</p> : <video ref={video} aria-label="Camera scan" muted playsInline />}</div>
}

// An output label (FLOOR-008): the job's own GS1 label fills the serial, batch and expiry of the output form.
export function ScanOutputLabel({ workOrderId }: { workOrderId: string }) {
  const [message, setMessage] = useState('')
  async function keyed(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault(); const field = e.currentTarget, code = field.value, form = field.form; field.value = ''
    if (!code.trim() || !form) return
    const r = await fetch(`/api/larder/scan?code=${encodeURIComponent(code)}&use=output&id=${workOrderId}`, { credentials: 'same-origin', cache: 'no-store' }), b: any = await r.json()
    if (!r.ok) { setMessage(`Not accepted: ${b.error?.message ?? 'That label was not accepted.'}`); return }
    const set = (name: string, value: string) => { const input = form.elements.namedItem(name); if (value && input instanceof HTMLInputElement) input.value = value }
    set('serial', b.output.serial); set('lot', b.output.lot); set('dates.expiresOn', b.output.expiresOn)
    setMessage(`Scanned ${b.item.name}${b.output.serial ? ` · serial ${b.output.serial}` : b.output.lot ? ` · batch ${b.output.lot}` : ''}.`)
  }
  return <label className="field"><span>Scan output label</span><input aria-label="Scan output label" name="scanOutput" autoComplete="off" onKeyDown={e => void keyed(e)} /><small role="status">{message || 'Scanner or keyboard, then Enter'}</small></label>
}
