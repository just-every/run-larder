// Bars in pixels. Each step keeps its true span; its label sits inside when the span holds it, otherwise beside
// it in the free time on that row. A step whose bar or label would touch another drops to a lane below, so every
// bar names its job and nothing is drawn over anything else.
import type { Op } from './plan'

export const INSIDE = 112
const GAP = 6, TAG_MAX = 210, TAG_PAD = 12, SPACE = 6
export const LANE = { op: 64, ghost: 54 }

export type Item = { op: Op; ghost: boolean }
export type Placed = Item & { left: number; width: number; tag?: { side: 'right' | 'left'; width: number }; lane: number }

// The label a step carries: its job and step, then what it makes, its flag, or where it moves.
export function lines(op: Op, ghost: boolean, flag: string, moveTo: string) {
  if (ghost) return { id: op.reference, step: `Proposed · Op ${op.sequence} ${op.step}`, note: '' }
  return { id: op.reference, step: `Op ${op.sequence} ${op.step}`, note: moveTo ? `Moves to ${moveTo}` : flag || `${op.quantity.toLocaleString('en-US')} ${op.item}` }
}

let canvas: HTMLCanvasElement | undefined
export function textWidth(text: string, font: string) {
  const g = (canvas ??= document.createElement('canvas')).getContext('2d')!
  g.font = font
  return g.measureText(text).width
}

export function place(items: Item[], span: (op: Op) => [number, number], total: number, label: (item: Item) => number) {
  // Each step's true span, and for a short one the places its label can go: beside it on the right or the left,
  // as wide as it needs where the chart has the room.
  const options = items.map((item): { item: Item; left: number; width: number; tags: Placed['tag'][] } => {
    const [a, b] = span(item.op), left = a, width = Math.max(6, b - a)
    if (width >= INSIDE) return { item, left, width, tags: [undefined] }
    const want = Math.min(TAG_MAX, label(item) + TAG_PAD), right = total - (left + width) - GAP, room = left - GAP
    const tags = ([['right', right], ['left', room]] as const).filter(([, r]) => r >= want).map(([side]) => ({ side, width: want }))
    return { item, left, width, tags: tags.length ? tags : [{ side: right >= room ? 'right' as const : 'left' as const, width: Math.max(0, Math.max(right, room)) }] }
  })
  const reach = (left: number, width: number, tag?: Placed['tag']): [number, number] => !tag ? [left, left + width] : tag.side === 'right' ? [left, left + width + GAP + tag.width] : [left - GAP - tag.width, left + width]
  // Steps first, proposed ghosts in the lanes under them; each, earliest first, takes the first lane where its bar
  // and one of its label places touch nothing already there.
  const kinds: ('op' | 'ghost')[] = [], placed: Placed[] = []
  for (const ghost of [false, true]) {
    const lanes: [number, number][][] = [], base = kinds.length
    for (const o of options.filter(o => o.item.ghost === ghost).sort((a, b) => a.left - b.left)) {
      const free = (lane: [number, number][], r: [number, number]) => lane.every(([f, t]) => r[1] + SPACE <= f || t + SPACE <= r[0])
      let lane = 0, tag = o.tags[0]
      for (;; lane++) {
        if (lane === lanes.length) { lanes.push([]); kinds.push(ghost ? 'ghost' : 'op'); break }
        const fit = o.tags.findIndex(t => free(lanes[lane]!, reach(o.left, o.width, t)))
        if (fit >= 0) { tag = o.tags[fit]; break }
      }
      lanes[lane]!.push(reach(o.left, o.width, tag))
      placed.push({ ...o.item, left: o.left, width: o.width, tag, lane: base + lane })
    }
  }
  const tops = kinds.reduce<number[]>((t, k, i) => [...t, t[i]! + LANE[k]], [8])
  return { placed, kinds, tops, height: Math.max(84, tops[kinds.length]! + 12) }
}
