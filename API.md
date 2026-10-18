# Larder API

The app and agents use the same door. Every request needs a native session cookie (an invited person signs in through the emailed link); agents are invited people given the `agent` role.

- `GET /api/larder/state` — every record, the formatted movement ledger, reservations, positions, availability per item, shortages, the exception queue, recent recorded actions and (for the owner) the team.
- `POST /api/larder/commands` — `{ "commandId": "<8–100 of A-Z a-z 0-9 _ ->", "type": "...", "payload": { ... } }` with `content-type: application/json` and the installation's own `Origin`. Repeating a `commandId` returns its recorded outcome; reusing it with other content or by someone else is refused (`IDEMPOTENCY`). Replies are `{ ok: true, result, version }` or `{ ok: false, error: { code, message, details } }`.
- `GET /api/larder/handoffs/<id>.csv` — a handoff batch as CSV (owner, manager, accounts).
- `GET /api/larder/attachments/<id>` — an evidence file.
- `GET /api/larder/imports/<id>.json` — a move-in preview: counts, rejected rows, skips, unread columns.
- `GET /api/larder/boms.csv` — current effective BOMs and routings as editable CSV (owner, manager, production).
- `GET /api/larder/archive` — the complete business archive with its checksum (owner, manager).
- `POST /api/larder/archive/restore` — restore an archive into an empty installation (owner).

Quantities, prices and costs are decimal strings with at most six decimal places. Dates are `YYYY-MM-DD`. Record changes that edit an existing record send its current `version`; a changed record answers `STALE`.

## Commands

| Command | Payload | Who |
| --- | --- | --- |
| `item.save` | `{id?, version?, sku, name, kind: make\|buy, baseUnit, conversions?: [{unit, factor}], template?, attributes?: {name: value}, standardCost?, salePrice?, archived?}` | manager, buyer |
| `location.save` | `{id?, version?, name, note?, archived?}` | manager, warehouse |
| `party.save` | `{id?, version?, name, kind: customer\|supplier\|both, email?, abn?, terms?}` | manager, buyer, sales |
| `partyItem.save` | `{id?, version?, partyId, itemId, partyCode, unit?, price?, leadDays?, preferred?}` | manager, buyer, sales |
| `opening.record` | `{locationId, countedOn, valuationBasis: supplier-invoice\|last-purchase\|standard-cost\|owner-estimate, countedBy, evidence: {name, contentType, base64}, lines: [{itemId, quantity, unit?, unitCost, lot?}]}` | manager, warehouse |
| `bom.revise` | `{itemId, components: [{itemId, quantity, unit?}], routing?: [{name, workCentre?, minutes}], note?, effectiveOn?}` | manager, production |
| `bom.bulkPreview` | `{file: {name, content}}` — CSV rows, errors and stock/open-work impact; creates only the review record | manager, production |
| `bom.bulkApprove` | `{previewId, version, acceptRejected?: <exact error count>}` — approve all valid whole-BOM groups atomically; changed business state requires a new preview | manager, production (different preparer; owner may approve own) |
| `so.quote` | `{orderId?, version?, customerId, promiseDate, customerReference?, note?, lines: [{itemId, quantity, unit?, unitPrice?}]}` | manager, sales |
| `so.confirm` | `{orderId, version, reserve?: true}` | manager, sales |
| `so.reserve` | `{orderId, locationId?}` | manager, sales, warehouse |
| `so.cancelLine` | `{orderId, version, lineId, quantity, unit?}` | manager, sales |
| `shipment.pick` | `{orderId, lines: [{lineId, locationId, quantity, unit?, lotId?}]}` | manager, warehouse |
| `shipment.pack` | `{shipmentId, version, packages, weightKg?}` | manager, warehouse |
| `shipment.ship` | `{shipmentId, version, carrier, tracking?}` | manager, warehouse |
| `plan.draft` | `{itemId, quantity?, supplierId?, unitPrice?, expectedDate?, reason?}` — drafts the work or purchase order a shortage calls for | manager, buyer, production, agent |
| `po.draft` | `{supplierId, expectedDate, requiredBy?, reason, lines: [{itemId, quantity, unit?, unitPrice}]}` | manager, buyer, agent |
| `po.approve` | `{poId, version, note?}` | manager, buyer (never an agent) |
| `po.confirm` | `{poId, version, supplierReference, confirmedDate, evidence?}` | manager, buyer |
| `po.revise` | `{poId, version, expectedDate, note}` | manager, buyer |
| `receipt.create` | `{poId, supplierReference, lines: [{lineId, quantity, unit?, locationId, lot?, inspection?: accept\|quarantine}]}` | manager, warehouse |
| `quarantine.decide` | `{itemId, locationId, lotId?, quantity, decision: release\|reject, reason}` | manager, warehouse |
| `wo.draft` | `{itemId, quantity, requiredBy, reason, priority?, plannedStart?}` | manager, production, agent |
| `wo.release` | `{workOrderId, version}` | manager, production |
| `wo.reserve` | `{workOrderId}` | manager, production, warehouse |
| `wo.issue` | `{workOrderId, lines: [{itemId, locationId, quantity, unit?, lotId?, note?}]}` | manager, production, warehouse |
| `wo.output` | `{workOrderId, version, locationId?, quantity?, scrap?, scrapReason?, lot?}` | manager, production |
| `wo.close` | `{workOrderId, version}` | manager, production |
| `transfer.create` | `{itemId, fromLocationId, toLocationId, quantity, unit?, lotId?, reason}` | manager, warehouse |
| `count.record` | `{itemId, locationId, counted, lotId?, note?}` | manager, warehouse |
| `count.approve` / `count.reject` | `{countId, version, note?}` | manager (not the counter), owner |
| `return.receive` | `{orderId, lineId, quantity, unit?, locationId, disposition: restock\|quarantine, reason}` | manager, warehouse |
| `movement.reverse` | `{documentKind: receipts\|shipments\|transfers\|counts\|openings\|returns\|workOrders, documentId, movementIds?, reason}` | manager, warehouse, production |
| `handoff.prepare` | `{note?}` | manager, accounts |
| `handoff.acknowledge` | `{handoffId, version, entries: [{lineId, ledgerId, amount, note?}]}` | manager, accounts |
| `exception.resolve` | `{key, note}` (decisions only: shortages, late purchases, ledger mismatches, rejected move-in rows, work short of materials) | manager |
| `proposal.prepare` | `{kind, summary, evidence: [string], assumptions?, plan}` — see below | any role but viewer |
| `proposal.approve` / `proposal.reject` | `{proposalId, version, note?}` | by kind; never the preparer (the owner may), never an agent |
| `import.preview` | `{label, files: [{name, model?, content}], opening?: {countedOn, valuationBasis, countedBy}}` | manager, agent |
| `import.commit` | `{importId, version, acceptRejected?: <number of rejected rows>}` | manager |
| `import.undo` | `{importId, version, reason}` | manager |
| `role.set` | `{operatorId, role: manager\|sales\|buyer\|production\|warehouse\|accounts\|agent\|viewer}` | owner |

## Agent proposals

The agent prepares; nothing changes until a person approves the exact version.

| `kind` | `plan` | Approved by | On approval |
| --- | --- | --- | --- |
| `order-intake` | `{customerId, enquiry, lines: [{itemId, quantity \| null, unitPrice}], promiseDate, message, questions?}` | sales, manager | creates the quote; refused while a quantity is missing. The enquiry text is stored as data only. |
| `replenishment` | `{explanation, purchases: [{supplierId, expectedDate, lines: [{itemId, quantity, unitPrice}]}]}` | buyer, manager | creates approved purchase orders. Larder attaches the deterministic shortages and cash exposure; changed shortages make it stale. |
| `item-merge` | `{duplicateItemId, keepItemId}` | manager | re-points codes, quotes and draft purchases, revises active BOMs, moves stock by compensating movements and archives the duplicate; refused while open orders or reservations use it. |
| `reschedule` | `{changes: [{workOrderId, priority, plannedStart}], conflicts?}` | production, manager | updates priorities and planned starts; a changed work order makes it stale. |
| `reconciliation` | `{handoffId, entries: [{lineId, ledgerId, amount}]}` | accounts, manager | records the acknowledgements. |

## BOM CSV revisions (ENG-004)

Download `/api/larder/boms.csv`, edit component SKUs, quantities, units, routing or effectivity, then send the file to `bom.bulkPreview`. CSV columns are `item_sku,revision,effective_on,component_sku,quantity,unit,routing,note`, one row per component. Keep the source revision; all rows for a made item carry the same effective date, note and routing JSON (ordered `{name,workCentre,minutes}` steps). The export includes the current effective revision of every active made SKU. `effective_on` is the proposed new revision's UTC date, today or later; exports default it to today. Quantity conversions must be exact. Free-text notes use reversible apostrophe escaping for spreadsheet formulas.

The preview lists file/row/column errors and the affected SKUs, existing stock positions, component changes, and open work. A bad row excludes that entire BOM, preventing a truncated recipe. Approval needs the preview's version and, when errors exist, the exact rejected-row count. An intervening business write makes the preview stale. A different production engineer or manager approves; the owner can approve their own preview. The original CSV, preview, approver and created revision IDs remain in the state/archive.

Approval creates immutable new revisions in one transaction. Future revisions become eligible on their effective UTC date; release pins the effective revision at release time. Released work, reservations and physical movements stay unchanged. Changing released work requires a separate reviewed workflow; bulk CSV approval never changes it. Re-download to inspect the newly effective component quantities and routings.
