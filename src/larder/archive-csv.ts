// Lossless tabular companion to the JSON archive. JSON cells keep nested links,
// exact decimal strings, file bytes and the distinction between types intact.
export function archiveCsv(archive: Record<string, any>) {
  const rows: unknown[][] = [['section', 'index', 'json']]
  for (const [section, value] of Object.entries(archive)) {
    if (section === 'records') {
      for (const [kind, records] of Object.entries(value as Record<string, any[]>)) {
        rows.push([`records.${kind}`, '', '[]'])
        records.forEach((r, i) => rows.push([`records.${kind}`, i, JSON.stringify(r)]))
      }
    } else if (Array.isArray(value)) {
      rows.push([section, '', '[]'])
      value.forEach((r, i) => rows.push([section, i, JSON.stringify(r)]))
    } else rows.push([section, '', JSON.stringify(value)])
  }
  return rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n'
}
