// MRP-001: a bought suggestion honours the preferred supplier's recorded terms. Receipt falls on an open
// supplier day, the order day counts lead working days back from it, and the quantity meets MOQ and pack.
// Informational only: nothing is ordered, and the preparer still enters the price explicitly.
import { addDays } from './forecast-plan'
import { materialReleaseOn } from './material-lead'
import { openDay, supplierQuote } from './supplier-terms'
import { format } from './decimal'
import type { Row } from './model'

export type BuySuggestion = { kind: 'buy'; quantity: string; supplierId: string | null; receiptOn: string; releaseOn: string | null; leadDays: number | null; requiresPastRelease: boolean | null; basis?: string; shortageQuantity?: string; quotedUnitPrice?: string }

export function buySuggestion(terms: Row | undefined, shortage: bigint, requiredOn: string, today: string): BuySuggestion {
  const legacy = () => {
    const releaseOn = terms ? materialReleaseOn(requiredOn, terms.leadDays) : null
    return { kind: 'buy' as const, quantity: format(shortage), supplierId: terms?.partyId ?? null, receiptOn: requiredOn, releaseOn, leadDays: terms?.leadDays ?? null, requiresPastRelease: releaseOn === null ? null : releaseOn < today }
  }
  const t = terms?.supplierTerms
  if (!t || requiredOn < '0100-01-01' || requiredOn > '9000-01-01') return legacy()
  let receiptOn = requiredOn
  for (let i = 0; i < 400 && !openDay(t, receiptOn); i++) receiptOn = addDays(receiptOn, -1)
  if (!openDay(t, receiptOn)) return legacy()
  const quantity = supplierQuote(terms!, format(shortage), receiptOn, today)
  let releaseOn = receiptOn
  for (let i = 0; i < 800 && supplierQuote(terms!, quantity.quantity, receiptOn, releaseOn).earliestDate > receiptOn; i++) releaseOn = addDays(releaseOn, -1)
  return { kind: 'buy', quantity: quantity.quantity, supplierId: terms!.partyId, receiptOn, releaseOn, leadDays: t.leadDays, requiresPastRelease: releaseOn < today,
    basis: 'supplier working days and closed dates, MOQ and pack quantity', shortageQuantity: format(shortage), quotedUnitPrice: quantity.unitPrice }
}
