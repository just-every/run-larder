# Larder product contract

Larder is operations software for a small maker: one business of roughly 5–50 people that makes repeatable discrete goods (with some light distribution) and keeps its own accountant and ledger. Its job is to answer, every morning, what can be promised, what must be bought or made, what actually moved, and what needs a person today, and to carry one confirmed order through reserved stock, purchase or production, partial shipment and a reconciled handoff to the external ledger.

This document is the required product behaviour. Proof for each first-release clause is recorded in [ACCEPTANCE.md](ACCEPTANCE.md). A named test is a target; it is evidence only when its passing run is recorded.

## Decided defaults

These were decided for the first release. They are not open questions.

- **Buyer:** one Australian, single-entity, non-regulated discrete maker with light distribution and external books. Amounts are AUD. No tax, statutory, payroll or industry-compliance assertion is made.
- **Name:** Larder is the working product name; it is not a legal clearance.
- **Move-in:** the first kit is Odoo CSV with External IDs (“import-compatible export”); Katana BOM export is second and is not in this release.
- **Ledger:** the accountant's ledger stays the authority. Larder prepares and reconciles handoffs; it never posts journals.
- **Agents:** an agent prepares; a person with authority approves the exact version; approvals are recorded. Phase one makes no model or provider call.
- **Costing:** weighted average cost of stock on hand; inbound movements carry their own cost (purchase price, counted opening cost, or the work order's standard cost); released work records a standard cost from its pinned BOM and reports material variance when closed. Stock value is operational evidence, not a financial statement.
- **Reservations:** hard reservations, no automatic expiry, never below zero available.

## Operating rules

- A new installation starts empty: no sample items, stock, orders or provider records.
- A stock position is an item, location, status (available or quarantine) and lot. Its quantity is the sum of append-only signed movements. Available stock is available-status on hand minus reservations; quarantine and expected receipts cannot be promised or picked.
- The database refuses, by trigger, any movement that would make a position negative and any reservation or movement that would leave reserved stock above on-hand stock, whatever code issued it.
- Quantities and money are fixed-point decimals with six places. Unit conversions must be exact; a conversion that would round, an undefined unit or a unit defined twice with different sizes is refused.
- Once an item is used, its base unit and existing conversions are fixed; create a new SKU to change them.
- A BOM revision never changes after it is saved. A released work order pins the revision it was released with.
- Corrections are compensating movements that point to the original. Originals are never edited or deleted. A reversal is refused while later work depends on the stock; the person reverses that work first.
- Every write is one atomic D1 batch that re-checks, inside the write, the live native session, the operator's current status and their current Larder role, and the state version it was computed from. A failed check writes nothing.
- Every command carries a durable identity; repeating it returns the recorded outcome and never applies twice; reusing it with different content is refused.
- Roles: owner, manager, sales, buyer, production, warehouse, accounts, agent, viewer. Each command handler checks the role itself before reading anything; routes are not the only guard.

## First release: thirteen flows

LARDER-001. **Items, variants, units and parties.** A person creates items (made or bought), variants of a template with distinct attribute sets, exact unit conversions, customers and suppliers, and each party's own code for an item. Ambiguous conversions, duplicate SKUs or variants, ambiguous party codes and duplicate party names are refused.

LARDER-002. **Opening stock.** A person records a counted opening position by location with its count date, valuation basis (supplier invoices, last purchase, standard cost or owner estimate), unit cost, optional lot and a required evidence file kept with its digest. Opening stock cannot be posted twice for an item and location.

LARDER-003. **Versioned BOM and routing.** A person saves BOM revisions (components per finished unit, simple routing steps). Releasing work pins the active revision; a later revision does not change released work.

LARDER-004. **Quote and confirm.** A person quotes an order and confirms it. For every item Larder shows on hand, reserved, quarantine, expected from purchase, expected from production, unreserved demand and available to promise, each kept separate.

LARDER-005. **Atomic reservation.** Confirming or reserving takes only available stock. Concurrent orders cannot both consume the same stock; a retried command returns its first outcome.

LARDER-006. **Shortages.** Larder computes shortages deterministically from confirmed orders and released work against free stock and open supply, with the date needed and the documents that need it, and drafts a purchase order (preferred supplier and price) or a work order with that required-by date and reason.

LARDER-007. **Purchase approval.** A buyer or manager approves a draft purchase order (approval recorded with the exact terms and cash exposure), records the supplier's confirmation and reference, and revises the expected delivery with history.

LARDER-008. **Partial receipt, lots and quarantine.** A warehouse person receives part of a purchase order into a location, records supplier lots and either accepts or holds stock in quarantine; a recorded release or rejection decision moves it on. Over-receipt is refused.

LARDER-009. **Production.** Released work reserves its components; materials are issued as actually used (drawn across lots when no lot is named), good output and scrap are recorded against the pinned revision, and closing records material cost and variance.

LARDER-010. **Pick, pack and partial shipment.** A warehouse person picks only reserved stock, packs, and ships part of an order; shipping consumes those reservations, and the remaining commitments stay reserved or short.

LARDER-011. **Returns, transfers, counts and corrections.** Returns of shipped quantities come back to stock or quarantine; transfers move only free stock; counts by one person need another's approval before an adjustment (the owner, who holds every authority, may approve their own count so a one-person workshop can keep its stock right); a stale count is refused; reversals restore stock and order state through compensating movements and are refused while downstream work depends on the stock.

LARDER-012. **Accountant handoff.** A manager or accounts person prepares an immutable batch of not-yet-handed-off movements, valued: supplier receipts, customer shipments for invoice preparation (with the order price), production issue and output, adjustments, returns and corrections. The batch downloads as CSV. Acknowledgements record ledger references line by line; differing amounts show as mismatches until corrected; a later reversal appears in the next batch as a correction pointing to the original batch and line.

LARDER-013. **Exceptions and the complete archive.** One queue shows shortages, overdue purchases, quarantine, waiting approvals and proposals, unreconciled handoffs and rejected move-in rows; a manager resolves the ones that are decisions, with a recorded note. The owner or a manager exports the complete business archive with a checksum; the owner restores it into an empty installation in one atomic write that proves every stock position against the archive.

## Agent-native work (approved by people)

LARDER-014. **Authority everywhere.** Every command and read checks the current session and role in the handler and again inside the atomic write; losing a role or signing out takes effect on the next request; cross-site commands are refused.

LARDER-015. **Agents prepare, people approve.** Through the same public command API an agent prepares: order intake from a pasted enquiry (kept as data, never obeyed; missing quantities block approval), replenishment as grouped purchase orders over deterministic shortages with its explanation and cash exposure, a duplicate-item merge with its previewed impact (stock moved by compensating movements), a work-order reschedule with conflicts, and a ledger reconciliation. A person with the right role, never the preparer (except the owner, who holds every authority) and never an agent, approves or declines the exact version; stale inputs are refused; every decision is recorded.

## Move-in

LARDER-016. **Odoo kit.** A manager (or an agent, for preparation) previews Odoo import-compatible CSV exports of contacts, units, products and variants, locations, BOMs with routing, on-hand quantities and open sales and purchase orders. The preview is a dry run listing counts, rejected rows with file, line, External ID and reason, deliberate skips and unread columns. Committing publishes through Base's import kit, which journals the job and keeps every original file and digest. Undo before live use removes the whole batch; once later work depends on it, undo is refused and points at the dependency. The documented shape is in [MOVE-IN.md](MOVE-IN.md).

## Out of the first release

Statutory books, GST/BAS or any tax filing, payroll, journal posting, multi-entity or multi-currency, finite-capacity or optimal scheduling, process or continuous manufacturing, regulated quality or recall certification, serial numbers, machine control, CAD, automatic supplier payment, carrier, EDI, ecommerce, 3PL or barcode-hardware integrations, email ingestion, live model calls, the Katana, NetSuite and Business Central kits, the homepage, run site and docs site, and any hosted or provider acceptance. Physical counts and shipped goods remain the owner's evidence; a database restore cannot undo a dispatched parcel or a supplier order.
