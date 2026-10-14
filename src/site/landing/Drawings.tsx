import type { ReactNode } from 'react'
import { Goods, Print, Row } from './Print'

// One printed card per section (SPEC.md §1.2), every string a real Larder label or value.

const Doc = () => <svg className="doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" /></svg>

export function Licence() {
  return <div className="certificate"><Goods name="certificate" className="certificate-art" /><p className="certificate-text"><b>MIT License</b><span>Copyright (c) 2026 Run Edit Run</span></p></div>
}

export function Availability() {
  return <Print className="wide-card"><p className="card-title">Selected line availability</p><p className="serif">Walnut serving board</p>
    <div className="card-split"><div className="rows"><Row label="On hand" value="16" /><Row label="Reserved for this order" value="16" /><Row label="Reserved for others" value="0" /><Row label="Expected from work orders" value="24" /><Row label="Available to promise" value="0" strong /></div><Goods name="board-wide" /></div></Print>
}

export function WorkOrder() {
  return <Print className="wide-card"><div className="card-split"><div><p className="ref">WO-0001</p><p className="serif">Walnut serving board</p><p><span className="tag">BOM rev 2</span></p>
    <div className="rows"><Row label="Walnut blank" value="24" /><Row label="Board oil" value="2 L" /></div></div><div className="card-side"><Goods name="board-wo" /><span className="chip">Released</span></div></div></Print>
}

export function Shortage() {
  return <Print className="wide-card"><div className="card-split"><div><p className="card-title">What is short, and why</p><p className="item-line"><b>Board oil</b><span className="chip solid">Short 2 L</span></p><p className="serif">SO-0001 needs 2 L by 28 Oct</p></div><Goods name="bottle" className="goods bottle" /></div>
    <p className="card-action"><span className="button-ink">Draft purchase order</span></p></Print>
}

export function Handoff() {
  return <Print className="wide-card"><div className="card-split"><div><p className="card-title"><Doc /> HO-0001</p>
    <div className="rows"><p className="row"><span>Supplier receipt</span></p><p className="row"><span>Customer shipment</span><span className="chip">INV-1043</span></p><p className="row"><span>Production output</span></p></div>
    <p className="card-action"><span className="button-line">Download CSV</span></p></div><Goods name="papers" className="goods papers" /></div></Print>
}

export function MoveIn() {
  return <Print className="wide-card"><div className="card-split"><div><p className="card-title"><Doc /> Preview an Odoo export</p><p className="row"><span>Rejected rows</span><span className="disc small">1</span></p>
    <p className="card-action"><span className="button-ink">Commit, leaving 1 rejected</span></p></div><Goods name="papers-flat" className="goods papers" /></div></Print>
}

export const drawings: Record<string, () => ReactNode> = { free: Licence, promised: Availability, made: WorkOrder, short: Shortage, handoff: Handoff, 'move-in': MoveIn }
