import type { Larder } from './app'
import { can, itemName, locationName, partyName, rows } from './api'
import { Card, Choose, Empty, Field, Form, Table, fileBase64, options, text } from './controls'
import { qty, words } from './format'

export function BinRules({ larder }: { larder: Larder }) {
  const s = larder.state!
  return <Card title="Bin rules">
    <Table head={['Bin', 'Item', 'Replenish from', 'Minimum', 'Target', 'Capacity', 'Lot']} numeric={[3, 4, 5]}>{rows(s, 'binRules').map(r => <tr key={r.id}><td>{locationName(s, r.locationId)}</td><td>{itemName(s, r.itemId)}</td><td>{locationName(s, r.sourceLocationId)}</td><td>{qty(r.minimum)}</td><td>{qty(r.target)}</td><td>{qty(r.capacity)}</td><td>{rows(s, 'lots').find(l => l.id === r.lotId)?.code || 'Any released lot'}</td></tr>)}</Table>
    {s.actor.role === 'owner' && <Form submit="Save bin rule" busy={larder.busy} onSubmit={d => {
      const locationId = text(d, 'locationId'), itemId = text(d, 'itemId'), existing = rows(s, 'binRules').find(r => r.locationId === locationId && r.itemId === itemId)
      return larder.run('bin.rule', { locationId, itemId, sourceLocationId: text(d, 'sourceLocationId'), minimum: text(d, 'minimum'), target: text(d, 'target'), capacity: text(d, 'capacity'), lotId: text(d, 'lotId'), reason: text(d, 'reason'), version: existing?.version })
    }}>
      <Choose label="Rule bin" name="locationId" options={options(rows(s, 'locations').filter(l => l.siteId && !l.archived), l => l.name)} /><Choose label="Rule item" name="itemId" options={options(rows(s, 'items'), i => i.name)} /><Choose label="Replenishment source" name="sourceLocationId" options={options(rows(s, 'locations').filter(l => !l.archived), l => l.name)} />
      <Field label="Minimum base units" name="minimum" inputMode="decimal" /><Field label="Target base units" name="target" inputMode="decimal" /><Field label="Capacity base units" name="capacity" inputMode="decimal" />
      <Choose label="Only this lot" name="lotId" required={false} options={options(rows(s, 'lots'), l => l.code)} /><Field label="Rule reason" name="reason" />
    </Form>}
  </Card>
}

export function WarehouseLogistics({ larder }: { larder: Larder }) {
  const s = larder.state!, run = larder.run, busy = larder.busy
  const locations = options(rows(s, 'locations').filter(l => !l.archived), l => l.name), items = options(rows(s, 'items').filter(i => !i.archived), i => i.name), lots = options(rows(s, 'lots').filter(l => !l.ownerId), l => l.code)
  const transits = rows(s, 'transfers').filter(t => t.logistics)
  return <>
    <Card title="Transit and bin movements">
      {transits.length === 0 ? <Empty>No transit or bin movements recorded.</Empty> : transits.map(t => <section key={t.id} aria-label={`Transit ${t.reference}`}>
        <h3>{t.reference} · {t.status}</h3><p>{itemName(s, t.itemId)} · {qty(t.quantity)} · {locationName(s, t.fromLocationId)} → {locationName(s, t.toLocationId)}</p>
        {(t.sources ?? []).map((source: any, i: number) => <p key={i}>Lot {rows(s, 'lots').find(l => l.id === source.lotId)?.code || 'Unlotted'} · {qty(source.quantity)}</p>)}
        {t.status === 'in transit' && <p>Unavailable until received.</p>}
        {t.status === 'in transit' && can(s, ['manager', 'warehouse']) && <Form submit="Receive transit" busy={busy} onSubmit={d => run('transit.receive', { transferId: t.id, version: t.version, reason: text(d, 'reason') })}><Field label={`Receipt reason ${t.reference}`} name="reason" /></Form>}
      </section>)}
      {can(s, ['manager', 'warehouse']) && <Form title="Move released stock" submit="Record warehouse movement" busy={busy} onSubmit={d => run(text(d, 'action'), { itemId: text(d, 'itemId'), fromLocationId: text(d, 'from'), toLocationId: text(d, 'to'), quantity: text(d, 'quantity'), lotId: text(d, 'lotId'), reason: text(d, 'reason') })}>
        <Choose label="Warehouse action" name="action" options={[{ value: 'transit.dispatch', label: 'Dispatch into transit' }, { value: 'putaway.move', label: 'Put away by bin rule' }, { value: 'bin.replenish', label: 'Replenish to bin target' }]} />
        <Choose label="Warehouse item" name="itemId" options={items} /><Choose label="Warehouse source" name="from" options={locations} /><Choose label="Warehouse destination" name="to" options={locations} /><Choose label="Warehouse lot" name="lotId" required={false} options={lots} /><Field label="Warehouse quantity" name="quantity" inputMode="decimal" /><Field label="Warehouse reason" name="reason" />
      </Form>}
    </Card>
    <Card title="Ownership reconciliation"><Table head={['Item', 'Owned on site', 'In transit', 'Owned total', 'Customer-owned', 'Consigned']} numeric={[1, 2, 3, 4, 5]}>{s.ownershipBalances.map((r: any) => r.restricted ? <tr key={r.itemId}><td>{itemName(s, r.itemId)}</td><td colSpan={5}>{r.restricted}</td></tr> : <tr key={r.itemId}><td>{itemName(s, r.itemId)}</td><td className="num">{qty(r.ownedOnSite)}</td><td className="num">{qty(r.inTransit)}</td><td className="num">{qty(r.ownedTotal)}</td><td className="num">{qty(r.customerOwned)}</td><td className="num">{qty(r.consigned)}</td></tr>)}</Table></Card>
    <Card title="Customer and consigned property">
      <p>Property remains separate from owned stock and is unavailable for sales or production.</p>
      <Table head={['Owner', 'Ownership', 'Item', 'Lot', 'Location', 'Quantity']} numeric={[5]}>{s.custodyBalances.map((r: any, i: number) => r.restricted ? <tr key={i}><td colSpan={6}>{r.restricted}</td></tr> : <tr key={`${r.lotId}:${r.locationId}`}><td>{partyName(s, r.ownerId)}</td><td>{words(r.ownership)}</td><td>{itemName(s, r.itemId)}</td><td>{rows(s, 'lots').find(l => l.id === r.lotId)?.code}</td><td>{locationName(s, r.locationId)}</td><td>{qty(String(r.quantity))}</td></tr>)}</Table>
      {can(s, ['manager', 'warehouse']) && <>
        <Form title="Record property receipt" submit="Receive property" busy={busy} onSubmit={async d => { const file = d.get('evidence') as File; return run('custody.receive', { itemId: text(d, 'itemId'), locationId: text(d, 'locationId'), ownerId: text(d, 'ownerId'), ownership: text(d, 'ownership'), quantity: text(d, 'quantity'), lot: text(d, 'lot'), reason: text(d, 'reason'), evidence: file?.size ? { name: file.name, contentType: file.type || ['application', 'octet-stream'].join('/'), base64: await fileBase64(file) } : undefined }) }}>
          <Choose label="Property item" name="itemId" options={items} /><Choose label="Property location" name="locationId" options={locations} /><Choose label="Property owner" name="ownerId" options={options(rows(s, 'parties'), p => p.name)} /><Choose label="Ownership" name="ownership" options={[{ value: 'customer-owned', label: 'Customer-owned' }, { value: 'consigned', label: 'Consigned' }]} /><Field label="Property lot" name="lot" /><Field label="Property quantity" name="quantity" inputMode="decimal" /><Field label="Property reason" name="reason" /><label className="field"><span>Property evidence</span><input name="evidence" type="file" required /></label>
        </Form>
        <Form title="Move property" submit="Move property" busy={busy} onSubmit={d => run('custody.move', { lotId: text(d, 'lotId'), fromLocationId: text(d, 'from'), toLocationId: text(d, 'to'), quantity: text(d, 'quantity'), reason: text(d, 'reason') })}><Choose label="Custody lot" name="lotId" options={options(rows(s, 'lots').filter(l => l.source === 'custody'), l => l.code)} /><Choose label="Custody source" name="from" options={locations} /><Choose label="Custody destination" name="to" options={locations} /><Field label="Custody quantity" name="quantity" inputMode="decimal" /><Field label="Custody reason" name="reason" /></Form>
      </>}
    </Card>
  </>
}
