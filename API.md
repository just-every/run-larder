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
| `bom.revise` | `{itemId, components: [{itemId, quantity, unit?, supply?: make\|buy\|phantom}], yield?: <fraction>, routing?: [{name, workCentre?, minutes?, runMinutes?, setupMinutes?, queueMinutes?, dependsOn?, eligibleCentres?, requiredSkills?, instructions?, drawings?}], note?, effectiveOn?}` | manager, production |
| `bom.bulkPreview` | `{file: {name, content}}` — CSV rows, errors and stock/open-work impact; creates only the review record | manager, production |
| `bom.bulkApprove` | `{previewId, version, acceptRejected?: <exact error count>}` — approve all valid whole-BOM groups atomically; changed business state requires a new preview | manager, production (different preparer; owner may approve own) |
| `order.rank` | `{kind: sales\|work, orderId, version, rank}` — lower positive whole-number ranks first; preserves reservations/promises | manager, production |
| `work.expected` | `{workOrderId, version, expectedOn}` — declared MO completion ETA | manager, production |
| `so.quote` | `{orderId?, version?, customerId, promiseDate, customerReference?, note?, lines: [{itemId, quantity, unit?, unitPrice?}]}` | manager, sales |
| `so.confirm` | `{orderId, version, reserve?: true}` | manager, sales |
| `so.reserve` | `{orderId, locationId?}` | manager, sales, warehouse |
| `so.cancelLine` | `{orderId, version, lineId, quantity, unit?, customerApproval, reason?}` | manager, sales |
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
| `count.schedule` | `{locationId, scheduledOn, basis: value\|risk\|bin, counterId, recountTolerance?, minimumValue?, risk?: high\|medium\|low, itemId?}` | manager |
| `count.submit` | `{sessionId, lineId, version, counted, serials?: [string], note?}` | assigned warehouse counter |
| `count.recount` | `{sessionId, lineId, version, note}` | manager |
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

## Blind counts (STOCK-002)

Schedule by bin, minimum position value (highest first), or a selected item/risk classification. Locations serve as count bins. Each session records the due date, assigned warehouse counter, quantity tolerance and immutable observations. Only available stock is counted; quarantine is a separate disposition. A risk selection records the manager's assessment for that session. A zero-stock item can be explicitly selected.

On its due UTC date the counter enters a server-enforced blind workspace. State exposes task identities, SKU, base unit and lot code, with all balances, costs, observations and other business records excluded. Other downloads and commands (including old command replays) are refused until the session is complete. The counter can sign out normally. Other people continue warehouse work.

Reconcile mode snapshots a movement frontier per position. Intervening movements invalidate approval and require a new snapshot/recount; they are never silently netted against an observation. The first variance exceeding the session tolerance requires a second blind observation. Managers can request additional recounts or reject an observation. All attempts, physical/base-unit basis, time, person, lot and optional observed serial identities remain in the archive. Observed serials must be unique and match the counted quantity; these are count evidence, not a claim that the unfinished serial-tracking workflow has shipped.

A different manager approves each latest observation; no self-approval exception applies to sessions. Approval appends valued compensating movements, links their IDs and approval, and records the exact financial variance at the observation's recorded weighted-average cost. Zero-variance approval posts no movement. The financial adjustment enters the existing accountant handoff CSV once. Existing individual `count.record` commands retain their prior independent-approval behavior.

## Live ranked order status (DEMAND-006)

Every state read returns `orderStatuses: {sales, work}` with order/line ingredient and production status, effective rank and allocated supply references/quantities/current dates. Ingredient statuses are `In stock`, `Expected`, `Not available` and `No BOM`; production statuses are `not started`, `blocked`, `in progress`, `done` and `ready to ship`. Both list screens sort/filter these values and rank, and authorized managers/planners set rank from each row.

Lower explicit ranks consume scarce free supply first; equal ranks resolve by due date, creation time and ID. Unranked documents follow explicitly ranked documents in that deterministic order. Live hard reservations remain protected before free stock is shared. Quarantine is excluded. PO supply is only outstanding approved/confirmed quantity at the current expected date. Released MO supply is remaining good output at its explicit `expectedOn` completion ETA, or its existing declared required-by date until an ETA is set. These dates are declared expectations, not a claim of finite capacity scheduling.

Made sales lines consume finished stock and open MO supply once. MO-covered sales quantity inherits that MO's component coverage through `supplyingWork`, including its actual PO sources; uncovered sales quantity gets effective single-level BOM ingredient demand in `ingredients`. The existing multilevel/phantom extension remains ENG-001 work. All physical and future pools are shared across demand for that read; a supplying MO's components are not allocated again for its sales consumers. `available` is physically allocated quantity, `missing` is quantity without a declared source; a blocked supplying MO can therefore still have a declared product source while its nested ingredients expose the shortage.

Receipts, ETA changes, rank edits, reservations, cancellations and production reports require no MRP refresh: the next state read recomputes everything. Ranking changes indicative free-supply coverage only, preserves hard reservations and never changes promises. The reviewed displacement and recovery workflow remains DEMAND-005 work.

## Multilevel material planning (ENG-001)

The state API’s `shortages` recursively nets all confirmed sales and released/draft work through effective BOMs. Every row retains `pegs`: root document IDs/references, dates, quantities and each intermediate BOM ID/revision. Shared stock, hard reservations and approved/open/draft supply are counted once across branches; draft work adds its own input demand once. This is quantity netting; dated feasibility remains MRP-001.

`bom.revise` accepts a `yield` fraction greater than zero and at most one (default `1`) and per-component `supply`: `make`, `buy` or `phantom` (default the item’s kind). Make nets subassembly supply before expanding the uncovered quantity; buy stops expansion; phantom ignores its own stock and expands directly. Make/phantom require a made item. Each aggregate recipe input is `ceil(perUnit × output / yield)` at six quantity places. Today’s UTC effective revision is used; new revisions are checked for cycles now and at every future effectivity boundary.

`plan.draft` optionally takes `supply: make|buy`; `supplyChoices` gives each uncovered quantity when an item has both requirements. Release merges physical requirements by SKU, retains make/buy quantities and pins all resolved phantom revision IDs/yields in `bomRevisions`. Subsequent revisions cannot change that released snapshot. BOM CSV adds `yield` and `supply`; older files remain supported.


## Pinned operation tasks (ENG-002)

`bom.revise` retains ordered operations with setup and queue minutes per job and run minutes per base-unit output. Legacy `minutes` is the run-minute alias; if both aliases are supplied they must agree. Each time is finite and between 0 and 100000 inclusive. Sequence numbers follow array order. `dependsOn` contains unique earlier sequence numbers (default: the previous operation; `[]` makes a step independent). `eligibleCentres` contains exact, case-sensitive names and includes `workCentre` when one is named. Required labor skills are a list of names. Instructions are literal text, never executable directives to Larder.

`drawings` accepts up to five evidence files per operation using `{name,contentType,base64}` (each at most 1 MiB), or references to files retained by existing revisions. A file's digest and original bytes are retained. Direct and CSV revisions use the same validator; CSV carries complete routing JSON and may reference retained drawings, never arbitrary file IDs. Saving an authorized revision records its authorizing person/time. Release snapshots the definition and creates pending tasks; revision changes cannot rewrite that snapshot or its files.

All task commands use `workOrderId`, the current work-order `version`, and the pinned operation `sequence` through `/api/larder/commands`:

| Command | Additional input | Behavior |
| --- | --- | --- |
| `wo.operation.acknowledge` | `bomId` | Records the current person's acknowledgment of the exact pinned revision. An instruction/drawing task cannot start without it. Every new job starts unacknowledged. |
| `wo.operation.assign` | `operatorId` | Owner/manager records a named active production person’s skill authorization for this task’s pinned requirements; this is not certification. |
| `wo.operation.start` | `workCentre` | Requires completed predecessors, acknowledgment and an eligible named station; records operator/time. |
| `wo.operation.complete` | none | The person who started the running operation records completion/time. |

Tasks retain their acknowledgment and execution history in state and the business archive. Stock output/closure for a routing containing instructions, drawings or skill requirements waits for all its operations to complete. Simple existing routings remain usable with the published material/output flow. Setup/run/queue times are declared routing estimates, not actual labor capture (FLOOR-002) or finite calendar bookings (CAP-001/CAP-002/CAP-004). Engineering change proposals and obsolescence remain ENG-005 work.

The current `production` role authors and operates routings. Task acknowledgment, start and completion require current owner/manager/production authority; agents cannot execute. Skill-required tasks need owner/manager authorization of the exact operator before start, and any assigned task can be started/completed only by that operator (completion also checks the original starter). Authority is rechecked through the same native-session atomic command door.

## Reviewed sales amendments (DEMAND-002)

`so.quote` accepts optional plain-text `billingAddress` and `shippingAddress` (at most 2000 characters). Confirmed orders change through a locally recorded customer attestation and a reviewed preview:

- `so.changePreview` (sales, manager, owner): `{orderId, version, reason, customerApproval: {name, reference, approvedOn, evidence?: {name,contentType,base64}}, billingAddress?, shippingAddress?, lines: [{lineId?, itemId, quantity, unitPrice, schedules: [{quantity,date}]}]}`.
- `so.changeApprove` (sales, manager, owner): `{previewId, version}`. The current authorized sales/manager person reviews and applies the recorded customer-approved terms, following the existing sales command authority. Agents cannot prepare or approve customer amendments. Returns the updated order.

Quantities use the item's base unit. Every existing line must be included with its stable `lineId` and unchanged item; a new line omits `lineId`. Request `quantity` means total **non-cancelled** quantity, including shipped quantity. Schedules describe only outstanding deliveries and must sum to `quantity - shipped`; a fully cancelled/shipped line uses an empty schedule. A reduction cannot touch shipped or picked/packed quantities. Reductions increase the internal cumulative `cancelled` amount; increases grow gross `quantity`. Gross ordered quantity and prior cancellation history never shrink. Preview snapshots expose `activeQuantity = quantity - cancelled` for editing. The order's compatible `promiseDate` is the latest outstanding schedule date (retained as the last approved date once no delivery remains); MRP pegs retain individual delivery dates, and order status exposes the outstanding schedules. Shipping consumes earliest dates; direct cancellation removes latest dates first. A shipment reversal restores outstanding delivery demand.

Addresses omitted from a change remain unchanged; empty strings explicitly clear them. Customer approval records who approved, the source reference, a real date no later than today, optional immutable evidence, and who recorded it. This is a local attestation, not remote customer identity or approval validation. Preview creation leaves the order untouched. The returned `orderChanges` record has `before`, `after`, `customerApproval`, `impact`, `status: preview`, and `stateVersion`. Its impact contains `reservations`, `lineBalances`, `shipments`, `allocations`, `work`, and `procurement`. Work rows show source movement IDs and incurred material costs; purchase rows show outstanding exposure. Derived indicative allocations are distinguished from potential shared supply matching the product/component tree.

Approval refuses any intervening business write and checks the current order version in the same guarded transaction. It applies exactly the reviewed values, retains immutable snapshots in `order.changeHistory`, records the approver, and changes the preview to `approved`. The existing per-location reservation is kept up to outstanding demand; only unpicked excess is released. An increase does not silently reserve more stock. Approved procurement and released work remain intact, with their incurred costs/exposure visible; changing those commitments requires their own authorized workflow. The existing `so.cancelLine` command requires the same `customerApproval` attestation and accepts an optional reason. It records immutable before/after history and refuses cancellation of picked quantities at any location. The screen uses reviewed amendments for cancellation; there is no approval-free cancellation shortcut.

New shipments snapshot billing/shipping addresses, customer reference, commercial revision and order version at picking in `commercialTerms`, and unit price per shipment line. Shipping retains source movement identities. Invoice preparation and shipment reversals use those issued prices even after an order amendment. Returns retain their original shipment movement/price/cost allocations, and return corrections offset those values. Historical shipments created before this capability may have no recorded issued commercial terms. Missing or ambiguous issued prices cause `HISTORICAL_TERMS` refusal for invoice preparation, returns and shipment corrections; current order prices are never substituted. A preview cannot reprice a line tied to a picked, packed or shipped shipment missing its unit price. Undo and re-pick unshipped parcels at their authorized terms; shipped parcels require historical source-document evidence reconciliation before repricing. This capability does not fabricate a historical price or offer a reconciliation command that invents one. Historical returns lacking issued-price evidence retain their recorded stock-cost treatment, explicitly labeled as such.

`shipment.unpick` (manager, warehouse, owner) accepts `{shipmentId, version, reason}` for a picked/packed parcel that has not shipped. It records the undo and marks that pick `cancelled`; stock and reservations remain available to its order until separately released or cancelled. This provides the public resolution for an amendment blocked by picked commitments.

Order-list commercial value uses issued shipment prices plus the current outstanding quantity at the revised price; missing historical prices are labelled unrecorded. Existing direct-cancellation callers must now supply customer approval evidence; the DEMAND-006 cancellation journey was updated to supply the required attestation.
