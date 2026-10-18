// Bars in pixels. Each step keeps its true span; its label sits inside when the bar holds its job and step lines
// whole, otherwise beside it in the free time on that row (never over a weekend). A step whose bar or label would
// touch another drops to a lane below, so every bar names its job and nothing is drawn over anything else.
import type { Op } from './plan'

const GAP = 6, TAG_PAD = 12, SPACE = 6, INSET = 2
// Inside a bar: its left edge (the rail stripe, or the wider hatch on an exception), right padding and border.
export const PAD = { plain: 11 + 6 + 2, exception: 20 + 6 + 2, ghost: 6 + 6 + 2, continues: 10 }
export const LANE = { op: 58, ghost: 34 }

// What a label needs: inside, the bar width that holds its job and step whole; beside, its widest line.
export type Need = { inside: number; beside: number }
// One bar: a step, or the part of a step that runs on consecutive working days in view. A ghost reads on one line
// in a ghost lane (need) and on two in a step's lane (tall).
export type Item = { op: Op; ghost: boolean; part: number; start: Date; end: Date; continues?: Date; need: Need; tall?: Need }
export type Tag = { side: 'right' | 'left'; width: number }
export type Placed = Item & { left: number; width: number; tag?: Tag; lane: number; top: number; twoLine: boolean }

// The label a step carries: its job and step, then the day it continues on, or inside a bar where it moves, its
// flag or what it makes. Beside a short bar only the job and step (and where it continues) show, so the label
// stays narrow; the rest is in the bar's tooltip and the job's panel.
export function lines(op: Op, ghost: boolean, flag: string, moveTo: string, continues: string, beside: boolean) {
  const cont = continues && `Continues ${continues}`
  if (ghost) return { id: op.reference, step: `Proposed · Op ${op.sequence} ${op.step}`, note: cont }
  return { id: op.reference, step: `Op ${op.sequence} ${op.step}`, note: cont || (beside ? '' : moveTo ? `Moves to ${moveTo}` : flag || `${op.quantity.toLocaleString('en-US')} ${op.item}`) }
}

let canvas: HTMLCanvasElement | undefined
export function textWidth(text: string, font: string) {
  const g = (canvas ??= document.createElement('canvas')).getContext('2d')!
  g.font = font
  return g.measureText(text).width
}

// blocked: spans no label may cover (the greyed weekend).
export function place(items: Item[], span: (item: Item) => [number, number], total: number, blocked: [number, number][] = []) {
  // Each bar's true span, and for one too narrow for its lines the places its label can go: beside it on the right
  // or the left, as wide as it needs, up to the chart's edge or the weekend.
  type Option = { item: Item; left: number; width: number; tags: (Tag | undefined)[]; twoLine: boolean }
  const option = (item: Item, need: Need, twoLine: boolean): Option => {
    // A very short step still shows 6 px, grown back from its end so it never reaches past a shift's end.
    const [a, b] = span(item), width = Math.max(6, b - a), left = Math.max(0, Math.min(a, b - width))
    if (width >= need.inside) return { item, left, width, tags: [undefined], twoLine }
    const want = need.beside + TAG_PAD
    const right = Math.min(total, ...blocked.map(([f]) => f).filter(f => f >= left + width)) - (left + width) - GAP
    const room = left - Math.max(0, ...blocked.map(([, t]) => t).filter(t => t <= left)) - GAP
    const tags = ([['right', right], ['left', room]] as const).filter(([, r]) => r >= want).map(([side]) => ({ side, width: want }))
    return { item, left, width, tags: tags.length ? tags : [{ side: right >= room ? 'right' : 'left', width: Math.max(0, right, room) }], twoLine }
  }
  // Bars sit inset by INSET each side, so back-to-back steps (one ends at a shift's end, the next starts the next
  // morning on the same x) share a lane; labels keep SPACE clear of everything.
  const reach = (o: Option, tag?: Tag): [number, number] => !tag ? [o.left + INSET, o.left + o.width - INSET] : tag.side === 'right' ? [o.left + INSET, o.left + o.width + GAP + tag.width + SPACE] : [o.left - GAP - tag.width - SPACE, o.left + o.width - INSET]
  type Slot = { r: [number, number]; o: Option; placed: Placed }
  const free = (lane: Slot[], r: [number, number], skip?: Slot) => lane.every(s => s === skip || r[1] <= s.r[0] || s.r[1] <= r[0])
  // A label place for o in this lane: a free one, or one freed by moving the one earlier label in its way to that
  // step's other side.
  const fit = (here: Slot[], o: Option): { tag?: Tag } | undefined => {
    const at = o.tags.findIndex(t => free(here, reach(o, t)))
    if (at >= 0) return { tag: o.tags[at] }
    for (const t of o.tags) {
      const r = reach(o, t), [s, ...more] = here.filter(x => !free([x], r))
      if (!s || more.length || !s.placed.tag) continue
      for (const other of s.o.tags) {
        if (!other || other.side === s.placed.tag.side) continue
        const moved = reach(s.o, other)
        if (!free(here, moved, s) || moved[1] > r[0] && r[1] > moved[0]) continue
        s.placed.tag = other; s.r = moved
        return { tag: t }
      }
    }
  }
  // Steps first, then proposed ghosts; each, earliest first, takes the first lane where it fits. A ghost may share
  // a step's lane where it is free, as a rescheduled move sits in its row; otherwise it takes a lower ghost lane.
  const kinds: ('op' | 'ghost')[] = [], lanes: Slot[][] = [], placed: Placed[] = []
  const put = (o: Option, lane: number, tag?: Tag) => {
    const p: Placed = { ...o.item, left: o.left, width: o.width, tag, lane, top: 0, twoLine: o.twoLine }
    lanes[lane]!.push({ r: reach(o, tag), o, placed: p }); placed.push(p)
  }
  const ordered = items.map(item => ({ item, flat: option(item, item.need, !item.ghost), tall: item.tall && option(item, item.tall, true) }))
    .sort((a, b) => Number(a.item.ghost) - Number(b.item.ghost) || a.flat.left - b.flat.left)
  for (const { item, flat, tall } of ordered) {
    const tries = kinds.flatMap((k, lane) => !item.ghost ? (k === 'op' ? [{ lane, o: flat }] : []) : k === 'op' ? (tall ? [{ lane, o: tall }] : []) : [{ lane, o: flat }])
    let done = false
    for (const { lane, o } of tries) { const got = fit(lanes[lane]!, o); if (got) { put(o, lane, got.tag); done = true; break } }
    if (!done) { lanes.push([]); kinds.push(item.ghost ? 'ghost' : 'op'); put(flat, lanes.length - 1, flat.tags[0]) }
  }
  // Step lanes from the top, ghost lanes under them.
  const tops = new Map<number, number>()
  kinds.map((k, i) => ({ k, i })).sort((a, b) => Number(a.k === 'ghost') - Number(b.k === 'ghost')).reduce((y, { k, i }) => (tops.set(i, y), y + LANE[k]), 6)
  return { placed: placed.map(p => ({ ...p, top: tops.get(p.lane)! })), height: Math.max(68, kinds.reduce((n, k) => n + LANE[k], 6) + 6) }
}
