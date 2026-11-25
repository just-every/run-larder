// Test-only D1 meter: wraps a D1 binding and sums meta.rows_read, the figure
// Cloudflare bills against Workers Free's 5,000,000 rows a day.
export function meterDb(db: D1Database, trace: { sql: string; read: number }[]): D1Database {
  const raw = new WeakMap<object, D1PreparedStatement>(), text = new WeakMap<object, string>()
  const note = (sql: string, r: D1Result) => trace.push({ sql, read: r.meta?.rows_read ?? 0 })
  const wrap = (s: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const p: D1PreparedStatement = new Proxy(s, { get(t, k) {
      if (k === 'bind') return (...a: unknown[]) => wrap(t.bind(...a), sql)
      if (k === 'all' || k === 'run') return async () => { const r = await (t as any)[k](); note(sql, r); return r }
      if (k === 'first') return async (col?: string) => { const r = await t.all(); note(sql, r); const row: any = r.results[0] ?? null; return col ? row?.[col] : row }
      if (k === 'raw') return async () => { const r = await t.all(); note(sql, r); return r.results.map(o => Object.values(o as object)) }
      const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v
    } })
    raw.set(p, s); text.set(p, sql)
    return p
  }
  return new Proxy(db, { get(t, k) {
    if (k === 'prepare') return (sql: string) => wrap(t.prepare(sql), sql)
    if (k === 'batch') return async (list: D1PreparedStatement[]) => { const rs = await t.batch(list.map(x => raw.get(x) ?? x)); rs.forEach((r, i) => note('[batch] ' + (text.get(list[i]) ?? ''), r)); return rs }
    const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v
  } })
}
