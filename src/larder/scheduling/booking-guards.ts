// Delegated bookings execute under a live grant authorizer, independently of
// the person recording the event. Every guard shares the business write batch.
import { type Context, type State } from '../model'
import { roleSql } from '../storage'

export const newBookings = (c: Context, before: State) => c.s.scheduleBookings.filter(b => b.status === 'active' && !before.scheduleBookings.some(old => old.id === b.id))

export function bookingGuards(db: D1Database, c: Context, before: State): D1PreparedStatement[] {
  return newBookings(c, before).flatMap(booking => [
    ...[...new Set<string>(booking.operations.map((o: any) => o.operatorId))].map(id =>
      db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','manager','production','operator')) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(), id)),
    ...(booking.automatic ? [
      db.prepare(`INSERT INTO larder_guard(id,ok) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM larder_records g WHERE g.kind='scheduleGrants' AND g.id=? AND g.version=? AND json_extract(g.data,'$.status')='active' AND json_extract(g.data,'$.approvedBy')=? AND julianday(json_extract(g.data,'$.expiresAt'))>julianday('now') AND json_extract(g.data,'$.protectionVersion')=(SELECT version FROM larder_records WHERE kind='schedulePolicies' LIMIT 1)) AND EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND ${roleSql} IN ('owner','manager','planner')) AND julianday(?)>=julianday('now') THEN 1 ELSE 0 END)`)
        .bind(crypto.randomUUID(), booking.grantId, booking.grantVersion, booking.approvedBy, booking.approvedBy, booking.asOf),
    ] : []),
  ])
}
