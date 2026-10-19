// AUTO-001 supersedes LARDER-013's note-based suppression. A note records the
// decision/follow-up history; only source evidence clears a derived failure.
import { followUpView } from './follow-up-state'
import { fail } from './problem'
import { allow } from './roles'
import { row, text, type Context, type Row, type State } from './model'

export function exceptionRows(cases: ReturnType<typeof followUpView>) {
  return cases.filter(x => x.status !== 'closed').map(x => ({ ...x,
    // The compatibility note door still refuses decisions which must be made
    // through the linked operational command. Owned cases can record progress.
    resolvable: !['quarantine', 'approval', 'proposal'].includes(x.kind) && !x.key.startsWith('blocked-lot:'),
  }))
}

export const exceptions = (s: State, today: string) => exceptionRows(followUpView(s, today))

export function resolutions(c: Context, type: string, p: any): Row | undefined {
  if (type !== 'exception.resolve') return
  allow(c, ['manager'])
  const x = exceptions(c.s, c.now.slice(0, 10)).find(e => e.key === p.key) ?? fail('NOT_FOUND', 'That exception is no longer open.')
  if (!x.resolvable) fail('NOT_RESOLVABLE', 'Resolve this by doing the work it points to.')
  return row(c, 'resolutions', { key: x.key, kind: x.kind, title: x.title, note: text(p.note, 'note', 1000) })
}
