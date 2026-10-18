// Small line-art props from the hero's workshop, in charcoal ink on the grey paper (BUILD-NOTES: a walnut stack by
// the net requirements, a beeswax drum where the trace starts, a tin on the terminal's corner). Decorative only.

const ink = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** Five rough-sawn 8/4 walnut planks stacked on stickers, end grain toward you. */
export function Planks() {
  const layers = [0, 1, 2, 3, 4]
  return <svg className="prop planks" viewBox="0 0 260 150" aria-hidden="true" {...ink}>
    <path d="M6 142h248" strokeWidth="1.2" />
    {layers.map(i => {
      const y = 118 - i * 24, x = 14 + (i % 2) * 6
      return <g key={i}>
        <path className="wood" d={`M${x} ${y}h150v18h-150z`} />
        <path d={`M${x + 150} ${y}l58 -12v18l-58 12M${x} ${y}l58 -12h150`} />
        <path d={`M${x + 8} ${y + 6}c20 -2 40 3 64 0s46 2 70 -1M${x + 12} ${y + 12}c26 2 52 -3 80 0s32 1 50 -1`} strokeWidth="1" opacity=".55" />
        <ellipse cx={x + 179} cy={y + 3} rx="5" ry="4" strokeWidth="1" opacity=".6" />
        <path d={`M${x + 22} ${y + 18}h10v6h-10zM${x + 120} ${y + 18}h10v6h-10z`} strokeWidth="1.2" />
      </g>
    })}
  </svg>
}

/** A ribbed steel drum of beeswax pastilles with its lot tag. */
export function Drum() {
  return <svg className="prop drum" viewBox="0 0 120 170" aria-hidden="true" {...ink}>
    <ellipse cx="60" cy="22" rx="44" ry="11" />
    <ellipse cx="60" cy="22" rx="38" ry="8" strokeWidth="1" opacity=".6" />
    <path d="M16 22v122c0 6 20 12 44 12s44 -6 44 -12V22" />
    <path d="M16 62c0 6 20 12 44 12s44 -6 44 -12M16 104c0 6 20 12 44 12s44 -6 44 -12" />
    <circle cx="80" cy="20" r="3.5" strokeWidth="1.2" />
    <path className="tag" d="M30 80h40v20h-40z" />
    <path d="M36 87h26M36 93h18" strokeWidth="1" />
    <path d="M24 30v108M98 30v108" strokeWidth="1" opacity=".35" />
  </svg>
}

/** A 4 oz board butter tin with its chartreuse lid, set on the terminal's corner. */
export function Tin() {
  return <svg className="prop tin" viewBox="0 0 96 62" aria-hidden="true" {...ink}>
    <path className="tin-body" d="M10 26v18c0 7 17 13 38 13s38 -6 38 -13V26" />
    <ellipse className="tin-lid" cx="48" cy="22" rx="40" ry="11" />
    <path d="M8 22v6c0 7 18 13 40 13s40 -6 40 -13v-6" />
    <ellipse cx="48" cy="21" rx="30" ry="7" strokeWidth="1" opacity=".5" />
  </svg>
}
