import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { rows, type Rec } from './api'
import type { Larder } from './app'
import { Choose, Field, Table, options } from './controls'

// FLOOR-008: a USB or Bluetooth scanner types its code and Enter into the scan
// field; a phone or tablet camera reads codes where the browser can decode
// them. Each scan is resolved by the server; nothing moves until the person
// posts the scanned lines as one receipt, issue or pick.
type Use = 'receipt' | 'issue' | 'pick'
type Line = { key: string; lineId: string; itemId: string; item: string; lot: string; lotId: string; serial: boolean; expiresOn: string; quantity: number }
const commandFor = { receipt: 'receipt.create', issue: 'wo.issue', pick: 'shipment.pick' } as const
const titles = { receipt: 'Scan this delivery', issue: 'Scan materials to issue', pick: 'Scan the pick' }

export function ScanPanel({ larder, use, doc }: { larder: Larder; use: Use; doc: Rec }) {
  const s = larder.state!, [lines, setLines] = useState<Line[]>([]), [note, setNote] = useState(''), [refusal, setRefusal] = useState(''), [camera, setCamera] = useState(false)
  const [locationId, setLocationId] = useState(''), [slip, setSlip] = useState(''), input = useRef<HTMLInputElement>(null)
  // Scans can arrive faster than a render; the list they check is kept in step here.
  const current = useRef<Line[]>([]), keep = (next: Line[]) => { current.current = next; setLines(next) }
  async function resolve(code: string) {
    setRefusal(''); setNote('')
    const r = await fetch(`/api/larder/scan?code=${encodeURIComponent(code)}&use=${use}&id=${doc.id}`, { credentials: 'same-origin', cache: 'no-store' })
    const b: any = await r.json()
    if (!r.ok) { setRefusal(b.error?.message ?? 'That code was not accepted.'); return }
    const lot: string = b.lot?.code || b.receive?.serial || b.receive?.lot || '', serial = !!(b.lot?.serial || b.receive?.serial)
    const key = `${b.lineId}|${lot}`
    const now = current.current
    if (serial && now.some(l => l.key === key)) { setRefusal(`Duplicate scan: serial ${lot} is already on this list.`); return }
    keep(now.some(l => l.key === key) ? now.map(l => l.key === key ? { ...l, quantity: l.quantity + 1 } : l)
      : [...now, { key, lineId: b.lineId, itemId: b.item.id, item: b.item.name, lot, lotId: b.lot?.id ?? '', serial, expiresOn: b.receive?.expiresOn ?? '', quantity: 1 }])
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
    const payload = use === 'receipt'
      ? { poId: doc.id, supplierReference: slip, lines: grouped(l => l.serial ? `${l.lineId}|serial` : l.key).map(ls => ({ lineId: ls[0].lineId, locationId, quantity: quantity(ls), inspection: 'accept', ...(ls[0].serial ? { serials: serials(ls) } : { lot: ls[0].lot, ...(ls[0].expiresOn ? { dates: { expiresOn: ls[0].expiresOn } } : {}) }) })) }
      : use === 'issue'
        ? { workOrderId: doc.id, lines: grouped(l => l.serial ? `${l.itemId}|serial` : l.key).map(ls => ({ itemId: ls[0].itemId, locationId, quantity: quantity(ls), ...(ls[0].serial ? { serials: serials(ls) } : ls[0].lotId ? { lotId: ls[0].lotId } : {}) })) }
        : { orderId: doc.id, lines: grouped(l => l.serial ? `${l.lineId}|serial` : l.key).map(ls => ({ lineId: ls[0].lineId, locationId, quantity: quantity(ls), ...(ls[0].serial ? { serials: serials(ls) } : ls[0].lotId ? { lotId: ls[0].lotId } : {}) })) }
    if (await larder.run(commandFor[use], payload)) { keep([]); setNote('Posted.') }
  }
  return <section className="scan" aria-label={titles[use]}>
    <h3>{titles[use]}</h3>
    <div className="form-grid">
      <label className="field"><span>Scan code</span><input ref={input} aria-label="Scan code" name="scan" autoComplete="off" onKeyDown={keyed} /><small>Scanner or keyboard, then Enter</small></label>
      <Choose label={use === 'receipt' ? 'Scan into location' : 'Scan from location'} name="scanLocation" options={options(rows(s, 'locations').filter(l => !l.archived), r => r.name)} value={locationId} onChange={(e: any) => setLocationId(e.target.value)} />
      {use === 'receipt' && <Field label="Scanned packing slip" name="scanSlip" value={slip} onChange={(e: any) => setSlip(e.target.value)} />}
    </div>
    {typeof window !== 'undefined' && 'BarcodeDetector' in window && <button type="button" className="button" onClick={() => setCamera(!camera)}>{camera ? 'Stop camera' : 'Scan with camera'}</button>}
    {camera && <CameraScan onCode={code => { setCamera(false); void resolve(code) }} />}
    {refusal && <p className="scan-refusal" role="status">Not accepted: {refusal}</p>}{note && <p className="muted" role="status">{note}</p>}
    {lines.length > 0 && <><Table head={['Item', 'Lot or serial', 'Quantity']} numeric={[2]}>{lines.map(l => <tr key={l.key}><td>{l.item}</td><td>{l.lot || '—'}{l.expiresOn && <small>Expires {l.expiresOn}</small>}</td><td>{l.quantity}</td></tr>)}</Table>
      <div className="form-actions"><button type="button" className="button primary" disabled={larder.busy || !locationId || (use === 'receipt' && !slip.trim())} onClick={() => void post()}>{use === 'receipt' ? 'Receive scanned' : use === 'issue' ? 'Issue scanned' : 'Pick scanned'}</button><button type="button" className="button" onClick={() => { keep([]); setNote(''); setRefusal(''); input.current?.focus() }}>Clear scans</button></div></>}
  </section>
}

// The camera reads codes with the browser's BarcodeDetector where one exists.
function CameraScan({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null), [error, setError] = useState('')
  useEffect(() => {
    let stream: MediaStream | undefined, stopped = false
    const Detector = (window as any).BarcodeDetector
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async media => {
      stream = media; if (!video.current || stopped) return
      video.current.srcObject = media; await video.current.play()
      const detector = new Detector({ formats: ['code_128', 'data_matrix', 'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] })
      while (!stopped) {
        const [found] = await detector.detect(video.current)
        if (found?.rawValue) { onCode(found.rawValue); return }
        await new Promise(r => setTimeout(r, 250))
      }
    }).catch(e => setError(e?.message ?? 'The camera could not start.'))
    return () => { stopped = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return <div className="scan-camera">{error ? <p role="status">{error}</p> : <video ref={video} aria-label="Camera scan" muted playsInline />}</div>
}
