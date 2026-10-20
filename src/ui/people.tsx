import { useState } from 'react'
import { rows } from './api'
import type { Larder } from './app'
import { Card, Chip, Choose, Empty, Field, Form, Table, text } from './controls'
import { words } from './format'

const roleHelp: [string, string][] = [['manager', 'Everything day to day, approvals and move-in'], ['sales', 'Quotes, orders and reservations'], ['buyer', 'Purchase orders and supplier terms'], ['production', 'BOMs and work orders'], ['warehouse', 'Receiving, shipping, transfers and counts'], ['quality', 'Inspections, holds, nonconformances, deviations, certificates, expiry and recalls'], ['accounts', 'Handoff batches and ledger acknowledgements'], ['agent', 'Prepares drafts and proposals; never approves or posts'], ['viewer', 'Reads everything, changes nothing']]

export function People({ larder }: { larder: Larder }) {
  const s = larder.state!, [message, setMessage] = useState('')
  if (s.actor.role !== 'owner') return <Empty>Only the owner manages people and roles.</Empty>
  async function invite(d: FormData) {
    setMessage('')
    const res = await fetch('/auth/invite', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: text(d, 'email'), displayName: text(d, 'name'), role: 'member', returnTo: '/app' }) })
    if (res.status === 202) { setMessage(`Invitation sent to ${text(d, 'email')}. They join as a viewer until you give them a role.`); await larder.refresh(); return true }
    setMessage('The invitation was not accepted. Check the email address and that this person is not already invited.'); return false
  }
  return <>
    <Card title="Team">{rows(s, 'operators').length === 0 ? <Empty>Only you so far.</Empty> :
      <Table head={['Person', 'Status', 'Role']}>{rows(s, 'operators').map(o => <tr key={o.id}><td><strong>{o.name}</strong><small>{o.email}</small></td><td><Chip tone={o.status === 'active' ? 'neutral' : 'warn'}>{words(o.status)}</Chip></td><td>{words(o.role)}</td></tr>)}</Table>}</Card>
    <div className="split">
      <Card title="Invite someone"><Form submit="Send invitation" busy={larder.busy} onSubmit={invite}><Field label="Name" name="name" /><Field label="Email" name="email" type="email" /></Form>{message && <p role="status" className="notice">{message}</p>}</Card>
      <Card title="Set a role"><Form submit="Save role" busy={larder.busy} onSubmit={d => larder.run('role.set', { operatorId: text(d, 'operatorId'), role: text(d, 'role') })}>
        <Choose label="Person" name="operatorId" options={rows(s, 'operators').filter(o => o.role !== 'owner').map(o => ({ value: o.id, label: o.name }))} />
        <Choose label="Role" name="role" options={roleHelp.map(([v, help]) => ({ value: v, label: `${words(v)}: ${help}` }))} /></Form></Card>
    </div>
  </>
}
