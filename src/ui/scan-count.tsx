import { useState, type KeyboardEvent } from 'react'
import { isGs1, parseGs1 } from '../larder/gs1'
import { rows, type LarderState, type Rec } from './api'

// FLOOR-008 in a blind count: a scan is matched in the browser against this
// line's own item, barcode and lot, so counting by scanner never asks the
// server for a quantity. Each accepted scan adds one unit (or the GS1 count)
// to the counted quantity and its serial to the observed serials.
const norm = (v: unknown) => typeof v === 'string' ? v.trim().toUpperCase() : ''
const gtin14 = (v: unknown) => typeof v === 'string' && /^\d{8,14}$/.test(v.trim()) ? v.trim().padStart(14, '0') : ''

export function ScanCount({ s, line }: { s: LarderState; line: Rec }) {
  const [message, setMessage] = useState('')
  const item = rows(s, 'items').find(i => i.id === line.itemId), lot = rows(s, 'lots').find(l => l.id === line.lotId)?.code ?? ''
  function keyed(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault(); const field = e.currentTarget, code = field.value, form = field.form; field.value = ''
    if (!code.trim() || !form || !item) return
    let gs1
    try { gs1 = isGs1(code) ? parseGs1(code, new Date().toISOString().slice(0, 10)) : null } catch (error: any) { setMessage(`Not accepted: ${error.message}`); return }
    const matches = gs1 ? gtin14(item.barcode) !== '' && gtin14(item.barcode) === gs1.gtin : [norm(item.sku), norm(item.barcode)].includes(norm(code)) || (gtin14(code) !== '' && gtin14(code) === gtin14(item.barcode))
    if (!matches) { setMessage(`Not accepted: that code is not ${item.name}; scan only this line's item.`); return }
    if (lot && gs1?.lot && norm(gs1.lot) !== norm(lot)) { setMessage(`Not accepted: lot ${gs1.lot} is not lot ${lot} of this line.`); return }
    const counted = form.elements.namedItem('counted'), serials = form.elements.namedItem('serials')
    if (!(counted instanceof HTMLInputElement) || !(serials instanceof HTMLTextAreaElement)) return
    if (gs1?.serial) {
      const listed = serials.value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean)
      if (listed.some(v => norm(v) === norm(gs1!.serial))) { setMessage(`Duplicate scan: serial ${gs1.serial} is already counted.`); return }
      serials.value = [...listed, gs1.serial].join('\n')
    }
    counted.value = String((Number(counted.value) || 0) + Number(gs1?.count ?? 1))
    setMessage(`Scanned ${item.name}${gs1?.serial ? ` · serial ${gs1.serial}` : ''}.`)
  }
  return <label className="field"><span>Scan into this count</span><input aria-label={`Scan ${item?.name ?? 'item'} into this count`} name="scanCount" autoComplete="off" onKeyDown={keyed} /><small role="status">{message || 'Scanner or keyboard, then Enter'}</small></label>
}
