// ENG-004: the reviewed CSV is a versioned proposal, never a direct rewrite.
import { bom } from './bom'
import { parseBomCsv } from './bom-csv'
import { bump, fresh, get, row, text, type Context, type Row } from './model'
import { allow, approver } from './roles'
import { fail } from './problem'
import { positions } from './stock'

export function bomBulk(c: Context, type: string, p: any): Row | undefined {
  if (type === 'bom.bulkPreview') {
    allow(c, ['manager', 'production'])
    const file = text(p.file?.name, 'CSV filename', 200)
    if (typeof p.file?.content !== 'string' || p.file.content.length > 2 * 1024 * 1024) fail('INPUT', 'Send CSV text of at most 2 MiB.')
    const content: string = p.file.content
    const { revisions, errors } = parseBomCsv(c.s, content, file)
    // Exercise the same revision validator before presenting an approvable plan.
    const candidate = { ...c, s: structuredClone(c.s) }
    for (const revision of revisions) bom(candidate, 'bom.revise', revision)
    const stock = positions(c.s)
    const impact = revisions.map(r => {
      const old = get(c.s, 'boms', r.sourceBomId, 'source BOM')
      const affected = new Set([r.itemId, ...old.components.map((x: any) => x.itemId), ...r.components.map((x: any) => x.itemId)])
      return {
        itemId: r.itemId, sku: get(c.s, 'items', r.itemId).sku, oldRevision: old.revision, effectiveOn: r.effectiveOn,
        componentsBefore: old.components, componentsAfter: r.components,
        stock: stock.filter(x => affected.has(x.itemId)),
        openWork: c.s.workOrders.filter(w => w.itemId === r.itemId && ['draft', 'released'].includes(w.status)).map(w => ({ id: w.id, reference: w.reference, status: w.status, pinnedRevision: w.bomRevision, treatment: w.status === 'released' ? 'keeps pinned revision' : 'uses effective revision when released' })),
      }
    })
    return row(c, 'bomChanges', { file, content, revisions, errors, impact, status: 'preview', stateVersion: c.s.version + 1 })
  }
  if (type !== 'bom.bulkApprove') return
  const preview = get(c.s, 'bomChanges', p.previewId, 'BOM preview')
  approver(c, ['manager', 'production'], preview.createdBy)
  fresh(preview, p.version)
  if (preview.status !== 'preview') fail('STATE', 'This BOM preview has already been decided.')
  if (preview.stateVersion !== c.s.version) fail('STALE', 'Business records changed after this preview. Upload the CSV again and review the impact.')
  if (!preview.revisions.length) fail('INPUT', 'No valid BOM revisions are available to approve.')
  if (preview.errors.length && p.acceptRejected !== preview.errors.length) fail('REJECTED_ROWS', 'Confirm the exact rejected-row count to leave those BOMs unchanged.', { count: preview.errors.length })
  const result = preview.revisions.map((revision: any) => bom(c, 'bom.revise', revision)!.id)
  return bump(preview, { status: 'approved', approvedBy: c.actor.id, approvedAt: c.now, revisionIds: result })
}
