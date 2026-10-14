// Strict RFC 4180 CSV: a malformed quote fails the file rather than guessing.
import { fail } from '../problem'

export function parseCsv(input: string, file: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  for (let n = input.startsWith('﻿') ? 1 : 0; n < input.length; n++) {
    const ch = input[n]
    if (ch === '"') {
      if (quoted && input[n + 1] === '"') { cell += '"'; n++ }
      else if (!quoted && (cell !== '' || closed)) fail('CSV', `${file}: unexpected quote inside an unquoted value (line ${rows.length + 1}).`)
      else { closed = quoted; quoted = !quoted }
    } else if (closed && ch !== ',' && ch !== '\n' && ch !== '\r') fail('CSV', `${file}: text after a closing quote (line ${rows.length + 1}).`)
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; closed = false }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && input[n + 1] === '\n') n++
      row.push(cell)
      if (row.some(Boolean)) rows.push(row)
      row = []; cell = ''; closed = false
    } else cell += ch
  }
  if (quoted) fail('CSV', `${file}: a quoted value is never closed.`)
  row.push(cell)
  if (row.some(Boolean)) rows.push(row)
  return rows
}
