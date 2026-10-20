# Larder API

The app and agents use the same door. Every request needs a native session cookie (an invited person signs in through the emailed link); agents are invited people given the `agent` role.

- `GET /api/larder/state` — every record, the formatted movement ledger, reservations, positions, availability per item, shortages, weekly forecasts/MPS, the exception queue and owned `followUpCases` (including closed-case history), recent recorded actions and (for the owner) the team.
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
| `party.save` | `{id?, version?, name, kind: customer\|supplier\|both, email?, abn?, terms?, minShelfLifeDays?}` | manager, buyer, sales |
| `partyItem.save` | `{id?, version?, partyId, itemId, partyCode, unit?, price?, leadDays?, preferred?}` | manager, buyer, sales |
| `opening.record` | `{locationId, countedOn, valuationBasis: supplier-invoice\|last-purchase\|standard-cost\|owner-estimate, countedBy, evidence: {name, contentType, base64}, lines: [{itemId, quantity, unit?, unitCost, lot?, dates?}]}` | manager, warehouse |
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
| `receipt.create` | `{poId, supplierReference, lines: [{lineId, quantity, unit?, locationId, lot?, dates?, inspection?: accept\|quarantine}]}` | manager, warehouse |
| `quarantine.decide` | `{itemId, locationId, lotId?, quantity, decision: release\|reject, reason}` | manager, warehouse |
| `lot.dispose` | `{lotId, version, decision: extend\|scrap, expiresOn?, retestOn?, locationId?, reason, evidence: [{name, contentType, base64}]}` — documented disposition of an expired or retest-due lot | manager (never an agent) |
| `wo.draft` | `{itemId, quantity, requiredBy, reason, priority?, plannedStart?}` | manager, production, agent |
| `wo.release` | `{workOrderId, version}` | manager, production |
| `wo.reserve` | `{workOrderId}` | manager, production, warehouse |
| `wo.issue` | `{workOrderId, lines: [{itemId, locationId, quantity, unit?, lotId?, note?}]}` | manager, production, warehouse |
| `wo.output` | `{workOrderId, version, locationId?, quantity?, scrap?, scrapReason?, lot?, dates?}` | manager, production |
| `rework.draft` | `{kind: rework\|unbuild, sourceLotId, sourceJobId, locationId, sourceStatus: available\|quarantine, quantity, disposition, instructions, evidence: [file], outputs: [{itemId, quantity, lot, value}], materials?: [{itemId, locationId, lotId?, quantity}], labor?: [{person, hours, rate, note}], scrapValue?}` | manager, production |
| `rework.approve` | `{orderId, version, reason}` | manager, independent preparer (owner exception) |
| `rework.execute` | `{orderId, version}` — consume source/extras and post quarantined outputs at approved allocation | manager, production |
| `rework.release` | `{orderId, version, reason, evidence: [file]}` — approve usable repair/recovery, existing QC/certificate gates apply | manager, independent executor (owner exception) |
| `wo.split` | `{workOrderId, version, reason, parts: [{quantity, centres?: {operationSequence: centerName}}]}` — transfer remaining work to disjoint successor jobs | manager, production |
| `wo.merge` | `{reason, sources: [{workOrderId, version}], centres?: {operationSequence: centerName}}` — merge compatible remaining WIP once | manager, production |
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
| `exception.resolve` | `{key, note}` — compatibility decision-note door; retains history and does not hide a continuing failure (AUTO-001 / LARDER-013) | manager |
| `exception.assign` | `{key, version, ownerId, dueOn, nextAction, escalationOwnerId, note}` — version 0 for a new owned case; active human writer and active owner/manager destinations | manager |
| `exception.followUp` | `{key, version, dueOn, nextAction, note, evidence?: [file]}` — original files use the same attachment shape as opening evidence, up to five | current assignee, manager |
| `exception.escalate` | `{key, version, note, evidence?: [file]}` — records in-app escalation to the case's current escalation owner; never sends mail/chat | manager |
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

## Forecasts and master production schedule (DEMAND-003)

`forecast.import` takes `{stateVersion, file: {name, content}, reason}`; CSV columns are `sku,week,quantity,seasonality`, with Monday-start UTC weeks and base-unit quantities. Imports are atomic, keep original bytes/digest and retain before/after history for replacements. `forecast.adjust` takes `{forecastId, version, seasonality?, overrideQuantity?: string|null, reason}`. Omitted fields stay unchanged; null removes the override. `forecast.undo` takes `{forecastId, version, historyId, reason}` and appends compensation for the latest non-undo change with an earlier basis. Manager/production maintain adjustments; manager/buyer/production/agent prepare imports.

The state API returns `forecasts`, retained `productionPlans` and the current `masterSchedule`. Weekly rows distinguish baseline, seasonality, override, actual demand, outstanding/reserved, consumed/residual forecast, net demand, signed error, usable supply, proposed supply, closing stock and source documents. Adjusted baseline multiplies at six decimal places, half away from zero; an explicit override replaces it. Actual outstanding schedules and issued deliveries consume that same SKU/week once. Missing historical issued delivery dates are explicit and block MPS preparation. Supply arriving by the week’s Sunday covers that week; this quantity plan makes no capacity or customer-date promise.

`mps.preview` takes `{reason}` and retains the exact rows/state version. Existing planning roles prepare. `mps.release` takes `{planId, version}`; owner/manager/production approve, with a different preparer except the owner and no agent release. Any business write after preview makes it stale. Release creates linked draft work or purchases for uncovered weekly quantities; bought items require a recorded supplier, and a missing supplier refuses the whole batch. Work release and purchasing approval stay separate. Draft/open supply prevents a second schedule from duplicating the first. Original forecasts, overrides, undo entries and released MPS snapshots are included in the complete archive.

## Catalog bulk edits (ENG-007)

Owner/manager/buyer/production download `GET /api/larder/catalog.csv`, and prepare `catalog.bulkPreview` with `{file:{name,content}}`. The CSV contains stable `larder_id`, `location_id` and every editable item field, including variants, units/conversions, prices, category, price-list membership, barcode, tracking, preferred supplier terms and per-location reorder/safety/min/max/bin/lead settings. Supplier prices remain per their stated `purchase_unit`. Locations serve as bins. Archived items are excluded from the active export; a retained ID can still be edited explicitly.

Blank cells leave stored values unchanged. `#CLEAR` removes an optional text, JSON or location setting; a leading backslash escapes literal `#CLEAR` (add one backslash before an existing run). Required identifiers and numeric values need explicit values; `0` and `false` are edits. Every nonempty exported text cell carries one reversible leading apostrophe for safe spreadsheet handling, including leading-zero and formula-like identifiers. Import removes exactly that one prefix. Keep it when editing downloaded files; double an intended literal leading apostrophe. Rows without Larder IDs create one item grouped by SKU, with one row per location. Unknown supplied IDs never create records. Global values on repeated location rows must agree, and each invalid row excludes the entire item group.

The preview retains original text, every field's old/new values, file/physical-row/column errors and affected quotes, orders, POs, planning settings/work/forecasts and physical positions for valid and rejected groups. Catalog values apply to future documents; current issued documents, reservations, stock and used units remain unchanged. Location settings configure DEMAND-004's future policy planner and do not silently allocate inventory.

`catalog.bulkApprove` takes `{previewId,version,acceptRejected?:<exact row-error count>}` and applies every valid item group atomically. Owner/manager/buyer/production approve; a different preparer is required except for the owner, and agents cannot approve or enable tracking. Any intervening business write refuses the stale preview. The original CSV, proposal, approver and resulting item IDs remain in the state/archive.

Tracking is declared configuration. Enabling batch refuses any nonzero position lacking a valid lot, across every location/disposition. Batch physical receipts/output require a lot. Serial configuration refuses existing physical stock and displays “serial policy configured; serial execution not yet available”; current serial physical receipt/output is refused. TRACE-002 inherits honoring that configured serial policy when serial-aware execution ships. The future GOV-001 engineer inherits these catalog authorities. No serial lifecycle or inventory-policy engine is claimed by this catalog edit.

## Engineering changes (ENG-005)

`engineering.propose` accepts `itemId`, optional exact `sourceBomId`, `reason`, `safety`, UTC `effectiveOn`, full `components`, optional `routing`/`yield`, original-file `attachments`, `substitutes` (`fromItemId,toItemId,reason`), `dispositions` (each entire positive removed-component stock position with `itemId,locationId,lotId,status,quantity,action,reason`), and `workTreatments` (`workOrderId,version,action,reason`). Stock actions are retain/return/rework/scrap instructions, never physical transactions; draft actions are keep/adopt/cancel. Phantom-parent drafts are included. The response retains source/prospective revisions, drawings/digests, all impacted stock/work and the exact business version. No revision is published yet.

`engineering.approve {changeId,version}` is owner/manager only, with a different preparer except owner, and refuses any intervening write. It creates the immutable approved revision, pins the selected prior/new revision on every affected draft or cancels it, and preserves released work. `engineering.decline {changeId,version,reason}` records a manager decision; stale proposals can be declined and resubmitted. Ordinary direct/CSV revisions cannot bypass an open proposal. Safety proposals block direct and flattened-parent work releases.

`engineering.acknowledge {changeId,version,bomId,note}` records the current production person’s reading of the approved change. An affected release needs that person’s acknowledgment; adopting a future revision refuses release until its UTC effective day. Per-job ENG-002 instruction/drawing acknowledgment is still separate. Approved payloads never change; acknowledgments append with optimistic record versions. All engineering records and original files export/restore in the business archive.

## Downtime and operation progress (FLOOR-007)

All commands take `workOrderId,version,sequence`. `wo.operation.pause` also takes `reason` (breakdown/waiting-material/changeover/quality/other), `note`, `escalationOwnerId` and a future ISO UTC `anticipatedResumeAt`. The handler and atomic write both verify an active owner/manager escalation destination. The production starter reports their own operation; owner/manager may report with a reason; agents never do. Pausing records a server-time interval and an in-app notice, not an email. The assigned supervisor or owner acknowledges with `wo.operation.escalationAck {downtimeId,note}`; acknowledgment persists even after resume.

`wo.operation.resume {reason}` closes the one open interval at server time. `wo.operation.progress {completedQuantity,remainingMinutes,note,reason?}` appends a nondecreasing bounded operation-quantity report and a whole-job remaining-effort estimate; owner/manager supplies a reason (the UI uses the progress note). These are neither output nor stock and never mark completion, including zero remaining minutes. Paused operations cannot complete. Each record uses the current work version; ordinary command identities replay without a second interval, including after the recorded escalation owner loses that role. Cached outcomes are returned before validating a new escalation destination; the current caller/session is still checked and every new pause retains both supervisor checks.

State includes `lostTimeReport` with source job/operation/operator, reason/note, supervisor acknowledgment, server start/stop, open/closed status, as-of timestamp and half-up six-place elapsed minutes. Task `progressReports` and `progress` retain estimate history. The schedule uses reported minutes and open-pause resume estimates; unreported work uses pinned setup/run/queue estimates. Started tasks project from now; paused status remains explicit. It recomputes bookings on the next read without changing customer promises or posting physical completion. These histories remain in the normal archive.

## Equipment maintenance (CAP-009)

Owner/manager uses `maintenance.create` with `{workCentre, kind: preventive|breakdown, startsAt?, expectedReturnAt, repairOwner, note, cmmsId?, evidence?}`. Centers are exact existing routing names. Breakdowns use server time; preventive starts and all ETAs are valid UTC ISO instants. Repair owner is responsibility text, not an access grant. `maintenance.update` sends `{maintenanceId, version, repairOwner, expectedReturnAt, note, cmmsId?, evidence?}`; revised ETAs must be after start and now. `maintenance.release` sends `{maintenanceId, version, note, evidence}` with a new repair file; release before start is refused. Files use the existing evidence shape, remain downloadable with digests, and records/history round-trip in the business archive. Released records cannot be edited.

Unreleased equipment blocks operation start/resume/completion after its start regardless of ETA. Schedule shows after-ETA dates and downstream bookings as provisional; an overdue ETA forecasts one minute after the read, never an automatic release. Release replaces the projected outage end with its actual server time. No output/stock/promise changes are inferred. Production and agents cannot create/update/release maintenance; ordinary operational reads retain their existing scope.

## Controlled lot documents (TRACE-007)

`certificate.requirements` takes `{itemId, customerId?, version?, types, note}`. Owner/manager configures the general SKU policy (empty customer) or additive customer types: `coa`, `sds`, `test-report`, `specification`, `coc`. Send the current policy version for an update; empty types clears that policy with history/reason. General requirements force receipts/openings/finished output/returns into quarantine with a named lot; customer requirements are additionally checked at shipment.

`certificate.prepare` takes `{itemId, lotId, type, documentVersion, declaredLot, issuer, expiresOn, evidence}`. Owner/manager/production/warehouse/agent can prepare. Exact original files/digests and logical revisions remain retained; expiry is an inclusive real UTC date. `certificate.approve` and `certificate.revoke` take `{certificateId, version, note}` and require owner/manager. Approval is independent except for the owner, refuses expired or mismatched-lot evidence, and never claims external certification. Preparing a replacement leaves the current decision usable; latest approved/revoked revision controls and revocation never falls back to an older approval.

Lot `dates` are `{manufacturedOn?, expiresOn?, retestOn?, supplierShelfLifeDays?, storage?}` as UTC `YYYY-MM-DD` days on a named lot (TRACE-003). State carries `lotStatuses` and `fefoPlans` (each open reserved line's lots in FEFO order with eligibility on the promise date or today, whichever is later). `shipment.pick` refuses an ineligible named lot and otherwise takes eligible lots first-expiry-first-out (`FEFO_INELIGIBLE`); shipment, issue and transfer refuse expired or retest-due lots (`LOT_BLOCKED`).

`quarantine.decide` release and positive available-stock count adjustments require current general certificates. `shipment.ship` rechecks general plus customer requirements per actual physical lot movement, then freezes the exact approved document snapshots. `GET /api/larder/shipments/<id>/certificates.json` downloads shipment/order/lot/SKU/quantity trace with those document versions, digests and base64 original files. Later certificate decisions never rewrite earlier packets. Business archives preserve the policies, evidence, history and snapshots. Existing session/Origin/version/role guards apply.

## Assigned shop-floor dispatch (FLOOR-001)

State includes `dispatch` with each released operation’s assigned person, live start gates, readiness and as-of time. The Make & buy → Shop-floor dispatch screen shows the same checks and the pinned instructions/drawings.

`wo.operation.assign {workOrderId,version,sequence,operatorId}` is owner/manager-only and checks an active production/manager/owner target in the handler and atomic transaction. Every new start requires that assignment plus `{workCentre,station,reason}`. Completion requires the same assigned starter and `{reason}`. Existing pause/resume record the task’s station and equipment as well as the named operator/reason. These commands never post stock/output. An older active task without assignment requires an explicit manager assignment to its recorded starter with `reason`; the absent historical station remains not recorded. Native shared-station sign-out revokes the session; the next operator uses their own native sign-in.

## Inventory policies (DEMAND-004)

`inventory.policy {itemId,locationId,previousId?,mode,effectiveOn,batchSize,orderMultiple,reason}` appends an immutable manager/production revision. Modes are `make-to-stock`, `make-to-order`, `assemble-to-order`; order/assembly require a made item. `previousId` names the latest saved revision. The latest effective UTC revision applies; future revisions do not activate early. Current catalog location reorder/safety/min/max/default-bin/lead values remain authoritative. The default bin is the physical stock pool and proposed destination.

`inventory.preview {policyId,orderIds,reason}` retains a read-only exact-state proposal. Existing assigned open demand is always included; explicit selection assigns new demand only at approval. The protected floor is max(safety,min). Common available stock above it follows rank/due order; all prior hard reservations remain intact. Stock mode replenishes toward max(maxStock,floor) at/below reorder, otherwise only a floor shortfall. Customer/assembly modes create separate dated order-line pegs after common allocation. Both batch and order multiples are satisfied by rounding upward to their scaled-integer LCM. Lead days are UTC calendar days. Late starts/supply remain labelled; quantity netting is not capacity feasibility.

Open/draft supply must have an explicit physical bin. `inventory.supplyAssign {policyId,kind:workOrders|purchaseOrders,documentId,lineId?,version,orderId?,orderLineId?,reason}` records an unlocated document’s bin and optional exact customer peg under manager/production authority, without changing terms/quantities. Assigned commitments cannot silently move.

`inventory.approve {planId,version}` is owner/manager/production only, independently from preparation except the owner; agents only prepare. Any intervening write refuses the preview. Approval atomically records line planning bins, reserves the exact reviewed common physical quantities and creates pegged draft work/purchases. Receipt/output, production release and spend retain their existing separate doors. Unlocated supply or missing BOM blocks approval; all prior reviews and policies survive archive restore. Existing shortage/MPS shortcuts refuse configured items and direct the person to this policy preview. Explicit manual drafts remain manual operations.

## Owned exception follow-up (AUTO-001 / LARDER-013)

The owner also holds every manager authority. Assignees are active human write-capable roles; viewers and agents cannot own cases, and viewers retain read-only access. Assignment/escalation validates current targets in both the handler and atomic commit. Updates bind the case version and current caller; identical command identities replay the saved outcome, including after the former target changes role.

Use the state API's stable case key and version. A note, ETA revision, draft purchase/work or retry submission cannot certify physical acceptance, work completion or ledger reconciliation. `status` is recomputed from source evidence as `following up` or `closed`; history and original file digests remain available after closure and through business archive/restore. Date-derived overdue escalation starts on the UTC day after `dueOn` and is a Today notice in this app. Provider-confirmed failed-sync closure is inherited by CONN-001–CONN-015 before those capabilities ship; today's ledger evidence is the accountant's exact issued-line acknowledgment.

## BUY-004 subcontract service and customer custody

`subcontract.draft` takes `{supplierId, vendorLocationId, itemId, customerId?, quantity, serviceRate, expectedDate, operation}`. `subcontract.approve` takes `{orderId, version}`. Drafts: buyer/manager/agent; independent approval: buyer/manager (owner exception).

Every subsequent command takes `orderId, version`. `subcontract.dispatch` takes `lines: [{lotId, locationId, quantity}]`; `subcontract.receive` takes `{good, scrap, lot, locationId, reason, evidence, inputs: [{issuedId, quantity}]}`; `subcontract.return` takes `{issuedId, quantity, locationId, reason}`. Buyer/manager/warehouse record these physical events. `subcontract.bill` takes `{reference, amount, evidence}` and requires accounts/manager; records local reconciliation, never a provider outcome. All quantities use base units and six-decimal strings; service is per good-plus-scrap output unit. Agents never post these effects.

`customerStock.receive` takes `{customerId, itemId, locationId, lot, quantity, evidence}` (buyer/manager/warehouse). It creates customer property with separate `subcontractCustody` events and zero owned value; customer lots cannot enter the owned movement ledger. `subcontractOrders` state includes approved terms, issued lots/consumption/returns, dated receipts with input movement IDs, output lot IDs, yield, material/service/output/scrap costs and bill history. Each finished lot names its service order and receipt, allowing that receipt's exact upstream lots and supplier to be traced. The Make & buy Subcontract screen shows these same quantities, source lots and supplier references, and the separate customer custody ledger.

## TRACE-001 genealogy and production allocations

`GET /api/larder/lots/:id/trace?direction=upstream|downstream` returns the selected lot, direction, graph nodes and typed rows; the same route with `trace.csv` downloads those rows. `movement` and `custody` rows occur once and sum to `balance` rows by lot/item/location/status. `relation` and `event` rows describe ancestry, exact batch inputs, recorded output/scrap or WIP responsibility, never another physical posting. Rows retain stable IDs, signed quantities/base units, dates, locations/status, related document/order/party references and reversal identity. Legacy job-level ancestry is explicit.

`wo.output` additionally accepts `allocations: [{movementId, quantity}]` naming the actual component issues used in that output batch. A sole final batch auto-records all unallocated issued inputs when no choice exists; partial/ambiguous batches require actual inputs. Shared split/merge issue pools enforce source non-reuse and the current job's component WIP quota. Final output and closure reconcile all issued material. State `workMaterialPools[workOrderId]` lists available issue IDs/lots, source quantities and job quotas.

`wo.batch.allocate` takes `{workOrderId, version, batchIndex, allocations, reason, evidence}` (production/manager, owner included), recording missing historical allocation once with actor/time/original evidence. It retains original output quantities/movements and refuses ambiguous original output identity. New output or closure cannot bypass unresolved historical batch allocations. The Stock genealogy screen and work-order allocation forms use these same public doors.

## Nonconformance cases (TRACE-005, partial)

Owner/manager uses `nonconformance.open` with `{lotId, locationId, quantity, complaint, dueOn, evidence: [file]}` to contain available units and own the case. `nonconformance.update` takes `{caseId, version, rootCause, correctiveAction, nextAction, dueOn, supplierId?, reworkOrderId?, evidence: [file]}` and records follow-up in app; it sends nothing and executes no repair. A linked draft quarantined repair acquires the case reference and later consumes its held quantity through the independently approved `rework.execute` door. Case closure waits for that repair’s inspection and release.

Record a scoped result using `quality.inspect` with `{nonconformanceId, quantity, planId, planVersion, samples, evidence?}`. `nonconformance.release` takes `{caseId, version, quantity, inspectionId, reason, evidence: [file]}`; it needs the latest current passing result for exactly those units, every applicable required plan, and an independent manager (owner exception). All quality/expiry/certificate gates still apply. `nonconformance.reject` uses the same disposition input without inspectionId. `nonconformance.close` takes `{caseId, version, effective: true, check, evidence: [file]}` only after all affected units are disposed and root cause/CAPA/follow-up exists. Case and original files survive archive restore. `nonconformance.return` additionally requires `supplierId` and `supplierReference`, removes held stock with its original cost, and records an in-app physical return rather than provider confirmation. Supplier RMA/credit reconciliation remains BUY-006; approved deviation remains unimplemented.
