import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { collections, type Context, type State } from '../model'

export function planningDigest(s: State, people: Context['people']) {
  return sha256(canonicalJson({ records: Object.fromEntries(collections.filter(k => !['schedulePlans','replenishmentPlans'].includes(k)).map(k => [k,s[k]])),
    movements: s.movements.map(m=>({...m,quantity:String(m.quantity),unitCost:String(m.unitCost)})),
    reservations:s.reservations.map(r=>({...r,quantity:String(r.quantity)})), people }))
}
