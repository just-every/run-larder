// GOV-014 GOV-015 GOV-016: the owner narrows a person to chosen locations and the costs-and-wages restriction, and names custom roles.
import { rows } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, text } from './controls'
import { words } from './format'

const doors = ['po.approve', 'po.confirm', 'po.tolerance', 'so.confirm', 'so.changeApprove', 'count.approve', 'quality.release', 'quarantine.decide', 'nonconformance.release', 'nonconformance.deviation.approve', 'lot.dispose', 'proposal.approve', 'inventory.approve', 'rework.approve', 'supply.change.approve', 'engineering.approve', 'certificate.revoke']
const baseRoles = ['manager', 'sales', 'planner', 'buyer', 'engineer', 'production', 'operator', 'warehouse', 'quality', 'accounts', 'viewer']
const restrictedLabel = 'Costs and wages restricted'

function Places({ larder, name }: { larder: Larder; name: string }) {
  const places = rows(larder.state!, 'locations')
  return <label className="field wide"><span>Locations (none chosen means every location)</span><select aria-label="Locations" name={name} multiple size={Math.min(6, Math.max(2, places.length))}>{places.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
}
const chosen = (d: FormData, name: string) => d.getAll(name).map(String).filter(Boolean)

export function Scopes({ larder }: { larder: Larder }) {
  const s = larder.state!, people = rows(s, 'operators').filter(o => o.role !== 'owner'), places = new Map(rows(s, 'locations').map(l => [l.id, l.name]))
  const held = (id: string) => rows(s, 'roles').find(r => r.id === id), custom = rows(s, 'customRoles')
  const reach = (r?: Record<string, any>) => [r?.sites ? `Sites: ${r.sites.map((id: string) => rows(s, 'sites').find(x => x.id === id)?.name ?? 'removed site').join(', ')}, including future bins` : '', r?.locations ? `Only ${r.locations.map((id: string) => places.get(id) ?? 'a removed location').join(', ')}` : 'Every location', r?.costsRestricted ? restrictedLabel : ''].filter(Boolean).join('. ')
  return <>
    <Card title="Who sees what">{people.length === 0 ? <Empty>Invite someone first.</Empty> :
      <Table head={['Person', 'Role', 'Reach']}>{people.map(o => { const r = held(o.id), c = custom.find(x => x.id === r?.customRoleId); return <tr key={o.id}><td><strong>{o.name}</strong></td><td>{c ? <Chip tone="info">{c.name}</Chip> : words(o.role)}</td><td>{reach(r)}</td></tr> })}</Table>}</Card>
    <div className="split">
      <Card title="Limit a person"><Form submit="Save limits" busy={larder.busy} note="Takes effect on their next request. The owner is never limited." onSubmit={d => larder.run('member.scope', { operatorId: text(d, 'operatorId'), sites: chosen(d, 'sites').length ? chosen(d, 'sites') : null, locations: chosen(d, 'locations').length ? chosen(d, 'locations') : null, costsRestricted: d.get('costsRestricted') === 'on' })}>
        <Choose label="Person" name="operatorId" options={people.map(o => ({ value: o.id, label: o.name }))} />
        <Places larder={larder} name="locations" /><label className="field"><span>Sites including future bins</span><select name="sites" aria-label="Sites including future bins" multiple>{rows(s, 'sites').map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="field"><span>{restrictedLabel}</span><input type="checkbox" name="costsRestricted" aria-label={restrictedLabel} /></label></Form></Card>
      <Card title="Custom role"><Form submit="Save custom role" busy={larder.busy} note="A named copy of one role that can only be narrowed." onSubmit={d => larder.run('role.custom', { name: text(d, 'name'), base: text(d, 'base'), removedDoors: chosen(d, 'removedDoors'), locations: chosen(d, 'locations').length ? chosen(d, 'locations') : null, costsRestricted: d.get('costsRestricted') === 'on' })}>
        <Field label="Name" name="name" />
        <Choose label="Based on" name="base" options={baseRoles.map(v => ({ value: v, label: words(v) }))} />
        <label className="field wide"><span>Approvals removed</span><select aria-label="Approvals removed" name="removedDoors" multiple size={5}>{doors.map(d => <option key={d} value={d}>{words(d)}</option>)}</select></label>
        <Places larder={larder} name="locations" />
        <label className="field"><span>{restrictedLabel}</span><input type="checkbox" name="costsRestricted" aria-label={`Custom role ${restrictedLabel}`} /></label></Form></Card>
    </div>
    {custom.length > 0 && <Card title="Give a person a custom role"><Form submit="Assign" busy={larder.busy} onSubmit={d => larder.run('role.assign', { operatorId: text(d, 'operatorId'), customRoleId: text(d, 'customRoleId') })}>
      <Choose label="Person" name="operatorId" options={people.map(o => ({ value: o.id, label: o.name }))} />
      <Choose label="Custom role" name="customRoleId" options={custom.map(c => ({ value: c.id, label: `${c.name} (${words(c.base)})` }))} /></Form></Card>}
  </>
}
