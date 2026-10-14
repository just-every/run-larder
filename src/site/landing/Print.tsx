import type { ReactNode } from 'react'

/** A riso-printed card: a red second-colour frame on card stock with its halftone offset behind. */
export function Print({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`print ${className}`}>{children}</div>
}

/** One of the riso goods printed from the picks (public/brand/goods). */
export function Goods({ name, className = 'goods' }: { name: string; className?: string }) {
  return <img className={className} src={`/brand/goods/${name}.webp`} alt="" loading="lazy" />
}

/** A label and its figure on a printed card. */
export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <p className={strong ? 'row strong' : 'row'}><span>{label}</span><b>{value}</b></p>
}
