import { useCallback, useEffect, useRef, useState } from 'react'

export type Rec = { id: string; version: number; [key: string]: any }
export type LarderState = { version: number; actor: { id: string; name: string; role: string }; [key: string]: any }
export type Run = (type: string, payload: object) => Promise<any | false>

type Reply = { ok: true; result: any; version: number } | { ok: false; error: { code: string; message: string; details?: unknown } }
const object = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
function reply(v: unknown): Reply {
  if (object(v) && v.ok === true && 'result' in v) return v as Reply
  if (object(v) && v.ok === false && object(v.error) && typeof v.error.message === 'string') return v as Reply
  throw new Error('The server response did not confirm the outcome.')
}

// Loads the operational state and sends commands with a durable identity: a
// lost response is retried with the same identity, which can never apply twice.
export function useLarder() {
  const [state, setState] = useState<LarderState | null>(null)
  const [error, setError] = useState(''), [details, setDetails] = useState<unknown>(null), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ signature: string; commandId: string } | null>(null), flight = useRef(false)
  const refresh = useCallback(async () => {
    const res = await fetch('/api/larder/state', { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 401) { window.location.href = '/signin?returnTo=%2Fapp'; return }
    const body: any = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? 'Records could not load.')
    setState(body)
  }, [])
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [refresh])
  const run: Run = async (type, payload) => {
    if (flight.current) return false
    flight.current = true; setBusy(true); setError(''); setDetails(null); setNotice('')
    const signature = JSON.stringify({ type, payload })
    if (pending.current?.signature !== signature) pending.current = { signature, commandId: crypto.randomUUID() }
    try {
      const res = await fetch('/api/larder/commands', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: pending.current.commandId, type, payload }) })
      const body = reply(await res.json())
      if (!body.ok) {
        if (!['UNCONFIRMED', 'BUSY', 'IMPORT_PUBLICATION'].includes(body.error.code)) pending.current = null
        setError(body.error.message); setDetails(body.error.details ?? null)
        await refresh().catch(() => {})
        return false
      }
      pending.current = null
      setNotice('Saved.')
      await refresh().catch(() => setError('Saved, but records could not reload. Reload before the next action.'))
      return body.result
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'Connection interrupted'} Try the same action again; it will not be applied twice.`)
      return false
    } finally { flight.current = false; setBusy(false) }
  }
  return { state, run, refresh, error, details, notice, busy, setNotice }
}

export const rows = (s: LarderState, key: string): Rec[] => Array.isArray(s[key]) ? s[key] : []
export const byId = (s: LarderState, key: string, id: unknown) => rows(s, key).find(r => r.id === id)
export const itemName = (s: LarderState, id: unknown) => {
  const item = byId(s, 'items', id)
  if (!item) return 'Removed item'
  const variant = Object.values(item.attributes ?? {}).join(', ')
  return variant ? `${item.name} (${variant})` : item.name
}
export const sku = (s: LarderState, id: unknown) => byId(s, 'items', id)?.sku ?? ''
export const unitOf = (s: LarderState, id: unknown) => byId(s, 'items', id)?.baseUnit ?? ''
export const partyName = (s: LarderState, id: unknown) => byId(s, 'parties', id)?.name ?? 'Removed contact'
export const locationName = (s: LarderState, id: unknown) => byId(s, 'locations', id)?.name ?? 'Removed location'
export const personName = (s: LarderState, id: unknown) => rows(s, 'people').find(p => p.id === id)?.name ?? 'Former team member'
export const can = (s: LarderState, roles: string[]) => s.actor.role === 'owner' || roles.includes(s.actor.role)
