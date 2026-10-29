# Larder API

The app and agents use the same door. Every request needs a native session cookie (an invited person signs in through the emailed link); agents are invited people given the `agent` role.

- `GET /api/larder/state` — every record, the formatted movement ledger, reservations, positions, availability per item, shortages, weekly forecasts/MPS, the exception queue and owned `followUpCases` (including closed-case history), recent recorded actions and (for the owner) the team.
- `GET /api/larder/planning/pegging` — current dated forward/reverse material allocations; see MRP-002 below.
- `GET /api/larder/planning/supply-changes` — MRP-007 expedite, defer and cancel recommendations on open purchase lines, each with its affected orders and a stable `key`; decide them with `supply.change.approve` / `supply.change.reject` (see MRP-002 below).
- `GET /api/larder/planning/materials` — MRP-001 read-only dated physical/purchase projection, its exact input version, source quantities/dates, unavailable and provisional supply, and remaining limitations (see below).
- `POST /api/larder/commands` — `{ "commandId": "<8–100 of A-Z a-z 0-9 _ ->", "type": "...", "payload": { ... } }` with `content-type: application/json` and the installation's own `Origin`. Repeating a `commandId` returns its recorded outcome; reusing it with other content or by someone else is refused (`IDEMPOTENCY`). Replies are `{ ok: true, result, version }` or `{ ok: false, error: { code, message, details } }`.
- `GET /api/larder/handoffs/<id>.csv` — a handoff batch as CSV (owner, manager, accounts).
- `GET /api/larder/attachments/<id>` — an evidence file.
- `GET /api/larder/imports/<id>.json` — a move-in preview: counts, rejected rows, skips, unread columns.
- `GET /api/larder/configurations/resolve?itemId=<made item>&selection=<json>` — ENG-003 the components, routing and cost a configuration makes, each with its rule and arithmetic; `409 INVALID_CONFIGURATION` carries the refusal reason. Save rules with `config.save`; pin a choice on a quote line with `configuration: { selection }` in `so.quote` lines and on work with `wo.draft` (`orderId` + `lineId`, or `configuration`).
- ENG-006 kits: `kit.save` and `kit.approve` (two people), `kit.sell` with `channel` and the channel's own `eventId` (a repeat returns the first outcome).
- FLOOR-002 time: `time.start` (`phase`: setup, run or cleanup), `time.pause`, `time.resume`, `time.stop`, `time.correct` and `time.decide` (a different manager approves with a reason), and `time.lock` / `time.reopen` (accounts or the owner). `GET /api/larder/scheduling/labor-costs` also returns `entries`: each closed entry priced at its retained rate (owner, manager, accounts, unrestricted).
- GOV-001 scopes: `member.scope`, `role.custom` and `role.assign` (owner). A scoped member's reads and downloads follow their scope; the archive, audit, handoff and import downloads answer `403` to them.
- `GET /api/larder/boms.csv` — current effective BOMs and routings as editable CSV (owner, manager, production, engineer).
- `GET /api/larder/archive` — the complete business archive with its checksum (owner, manager).
- `POST /api/larder/archive/restore` — restore an archive into an empty installation (owner).

Quantities, prices and costs are decimal strings with at most six decimal places. Dates are `YYYY-MM-DD`. Record changes that edit an existing record send its current `version`; a changed record answers `STALE`.

## Dated material pegging (MRP-002, partial)

`GET /api/larder/planning/pegging?kind=<kind>&id=<record-id>&lineId=<optional-line>`
uses the current native-session and blind-count guards. Kinds are `item`, `sales`,
`work`, `purchase`, `receipt`, `lot` and `forecast`. `lineId` is accepted only for
sales lines, work component lines, purchase lines and receipt purchase-line IDs;
unknown records/lines are refused. The read never creates a draft, changes a
reservation or promise, or sends anything.

`version` and `asOf` identify the current dated projection. `requirements` retains
matching full dated rows. `pegs` follows allocated sources forward from an item or
demand, or backward from a purchase/receipt/lot; each edge has `demand` (kind,
root document/line/reference, component item, required date and revision path) and
`source` (stock lot/bin or PO line/reference/date, exact base-unit quantity and
reservation flag). All queries use the same shared-pool allocation, rather than
re-netting a selected order with extra stock. `allocatedSalesOrders` deduplicates
the customer orders reached by those actual indicative edges. These are current
planning allocations, not persisted reservations or physical genealogy.

Purchase lookup includes outstanding lines and current stock from their recorded
receipt lots. Receipt and lot lookup use recorded lot identity; an unlotted
receipt returns `untrackedReceiptLines` instead of guessing ancestry from its
item/bin. Quarantine, expired stock and unapproved supply cannot produce usable
pegs. `lateCandidates` lists late/overdue purchase alternatives only for rows with
a shortage; candidate quantities are **unallocated** and must not be summed
across competing demand. An ETA slip or demand cancellation is reflected on the
next read, with physical reservations unchanged.

Work lookup exposes pinned component requirements (and their descendant paths)
and `blockedExplosions`. Output whose material feasibility is unproved never
creates a work-to-customer peg; output of a material-feasible released job (MRP-001)
is a `work` source on the demand it supplies, and `kind=work` follows it forward to
that demand. The archive preserves the inputs and restore reproduces the pegs
without executing any command or external effect.

### Supply-change recommendations and decisions (MRP-007)

`GET /api/larder/planning/supply-changes` reads the same shared allocation and
returns, for each open approved purchase line: an `expedite` when it arrives after
requirements that are short (`requestedDate` is the earliest such day, `quantity`
the shortage it could cover); a `cancel` for outstanding quantity no demand or
floor allocates; a `defer` when everything it supplies is first needed seven or
more days after it arrives. Each carries `affected`, the orders (and other demand)
it serves or would hurt, with exact quantities. Recommendations are recomputed on
every read and carry no state.

| Command | Payload | Who |
| --- | --- | --- |
| `supply.change.approve` | `{key, version, asOf, reason}` from a current read | manager, buyer; a `cancel` manager only; never an agent |
| `supply.change.reject` | `{key, version, asOf, reason}` | manager, buyer; never an agent |

A stale `version` or `asOf` (the UTC day) answers `STALE`, an unknown `key`
`NOT_FOUND`. An approved expedite or deferral records a `supplyRequest` on the
line and in the order history; the supplier's date changes only through
`po.revise`, nothing is sent and no stock or reservation changes. An approved
cancel trims only the outstanding unallocated quantity from the line (recorded as
`cancelled`; the order becomes `cancelled` when every line is zero) and updates its
exposure; received stock and reservations are untouched. Every decision writes an
approval record (`category: supply-change`) with the recommendation and reason,
and the usual audit entries.

## Commands

| Command | Payload | Who |
| --- | --- | --- |
| `item.save` | `{id?, version?, sku, name, kind: make\|buy, baseUnit, conversions?: [{unit, factor}], template?, attributes?: {name: value}, standardCost?, salePrice?, archived?}` | manager, buyer |
| `location.save` | `{id?, version?, name, note?, archived?, siteId?, binCode?, binSequence?}` | manager, warehouse |
| `party.save` | `{id?, version?, name, kind: customer\|supplier\|both, email?, abn?, terms?, minShelfLifeDays?}` | manager, buyer, sales |
| `partyItem.save` | `{id?, version?, partyId, itemId, partyCode, unit?, price?, leadDays?, preferred?}` | manager, buyer, sales |
| `opening.record` | `{locationId, countedOn, valuationBasis: supplier-invoice\|last-purchase\|standard-cost\|owner-estimate, countedBy, evidence: {name, contentType, base64}, lines: [{itemId, quantity, unit?, unitCost, lot?, dates?}]}` | manager, warehouse |
| `bom.revise` | `{itemId, components: [{itemId, quantity, unit?, supply?: make\|buy\|phantom}], yield?: <fraction>, routing?: [{name, workCentre?, minutes?, runMinutes?, setupMinutes?, queueMinutes?, dependsOn?, eligibleCentres?, requiredSkills?, transferBatch?, allowOverlap?, requireMaterials?, instructions?, drawings?}], note?, effectiveOn?}` | manager, production |
| `bom.bulkPreview` | `{file: {name, content}}` — CSV rows, errors and stock/open-work impact; creates only the review record | manager, production, engineer |
| `bom.bulkApprove` | `{previewId, version, acceptRejected?: <exact error count>}` — approve all valid whole-BOM groups atomically; changed business state requires a new preview | manager, production, engineer (different preparer; owner may approve own) |
| `order.rank` | `{kind: sales\|work, orderId, version, rank}` — lower positive whole-number ranks first; preserves reservations/promises | manager, production, planner |
| `work.expected` | `{workOrderId, version, expectedOn}` — declared MO completion ETA | manager, production, planner |
| `so.quote` | `{orderId?, version?, customerId, promiseDate, customerReference?, note?, lines: [{itemId, quantity, unit?, unitPrice?}]}` | manager, sales |
| `so.confirm` | `{orderId, version, reserve?: true}` | manager, sales |
| `so.reserve` | `{orderId, locationId?}` | manager, sales, warehouse |
| `so.cancelLine` | `{orderId, version, lineId, quantity, unit?, customerApproval, reason?}` | manager, sales |
| `shipment.pick` | `{orderId, lines: [{lineId, locationId, quantity, unit?, lotId?, serials?}]}` | manager, warehouse |
| `shipment.pack` | `{shipmentId, version, packages, weightKg?}` | manager, warehouse |
| `shipment.ship` | `{shipmentId, version, carrier, tracking?}` | manager, warehouse |
| `plan.draft` | `{itemId, quantity?, supplierId?, unitPrice?, expectedDate?, reason?}` (aggregate) or `{itemId, dated: {version, asOf, key}, unitPrice?, reason}` (exact dated suggestion; see below) — drafts the work or purchase order a shortage calls for | manager, buyer, production, planner, agent |
| `po.draft` | `{supplierId, expectedDate, requiredBy?, reason, lines: [{itemId, quantity, unit?, unitPrice}]}` | manager, buyer, agent |
| `po.approve` | `{poId, version, note?}` | manager, buyer (never an agent) |
| `po.confirm` | `{poId, version, supplierReference, source: phone\|email\|portal\|in person\|other, confirmedDate, evidence?, lineId?}` — a buyer records a supplier confirmation received outside the product: the line's supplier-confirmed date (`confirmedDate`, with `confirmation: {date, source, reference, by, at}`) and its promised `expectedDate` become the supplier's date; the line's `requestedDate` (set by an approved MRP-002 expedite or deferral, never changing a supplier date) stays beside it; audited | manager, buyer (never an agent) |
| `po.revise` | `{poId, version, expectedDate, note}` | manager, buyer |
| `receipt.create` | `{poId, supplierReference, documents?: [{name, contentType, base64}], lines: [{lineId, quantity, unit?, locationId, lot?, serials?, dates?, inspection?: accept\|quarantine, damage?: {quantity, reason}}]}` — `quantity` is what arrived; `damage.quantity` of it is received into quarantine as its own `<lot>-DAMAGED` lot with the reason; supplier documents are kept on the receipt; a PO line's `tolerancePercent` (0–20, set on `po.draft` lines, default 0) lets a delivery exceed the ordered quantity by that share | manager, warehouse |
| `receipt.allocate` | `{receiptId, version, asOf, reason}` from a current `GET /planning/pegging?kind=receipt&id=<receiptId>` — reserves the receipt's accepted, unreserved stock for the sales lines and released-job components the dated plan pegs it to, in the plan's date order; demand reached only through a make path is skipped and listed; the record lists `allocated` and `skipped`; a stale version or UTC day answers `STALE` | manager, warehouse (never an agent) |
| `receipt.allocate.job` | `{receiptId, workOrderId, version, itemId, quantity, unit?, reason, takeFrom?: [{demandId, lineId, locationId, quantity}]}` — reserves the receipt's accepted, unreserved stock of a component to a released job that makes the product, by hand and never automatically; a draft, closed, cancelled or quality-held job answers `STATE`/`QUALITY_HOLD`, quarantined, damaged and rejected stock is never counted (`INSUFFICIENT_STOCK`); `takeFrom` takes stock reserved to another demand and needs a manager or the owner; the `receipt-allocation` approval record names the receipt, job, reservation, quantity, role and anything taken, and closing the job returns the reservation; no signatures | manager, warehouse (never an agent); `takeFrom`: manager |
| `quarantine.decide` | `{itemId, locationId, lotId?, quantity, decision: release\|reject, reason, evidence?}` — recovered nesting lots require their own current certificates, passing applicable receipt inspections and an original release evidence file | manager, warehouse |
| `lot.dispose` | `{lotId, version, decision: extend\|scrap, expiresOn?, retestOn?, locationId?, reason, evidence: [{name, contentType, base64}]}` — documented disposition of an expired or retest-due lot | manager (never an agent) |
| `wo.draft` | `{itemId, quantity, requiredBy, reason, priority?, plannedStart?}` | manager, production, planner, agent |
| `wo.release` | `{workOrderId, version}` | manager, production |
| `wo.reserve` | `{workOrderId}` | manager, production, warehouse |
| `wo.issue` | `{workOrderId, lines: [{itemId, locationId, quantity, unit?, lotId?, serials?, note?}]}` | manager, production, warehouse |
| `wo.output` | `{workOrderId, version, locationId?, quantity?, scrap?, scrapReason?, lot?, serials?, dates?}` | manager, production |
| `rework.draft` | `{kind: rework\|unbuild, sourceLotId, sourceJobId, locationId, sourceStatus: available\|quarantine, quantity, disposition, instructions, evidence: [file], outputs: [{itemId, quantity, lot, value}], materials?: [{itemId, locationId, lotId?, quantity}], labor?: [{person, hours, rate, note}], scrapValue?}` | manager, production |
| `rework.approve` | `{orderId, version, reason}` | manager, independent preparer (owner exception) |
| `rework.execute` | `{orderId, version}` — consume source/extras and post quarantined outputs at approved allocation | manager, production |
| `rework.release` | `{orderId, version, reason, evidence: [file]}` — approve usable repair/recovery, existing QC/certificate gates apply | manager, independent executor (owner exception) |
| `wo.split` | `{workOrderId, version, reason, parts: [{quantity, centres?: {operationSequence: centerName}}]}` — transfer remaining work to disjoint successor jobs | manager, production, planner |
| `wo.merge` | `{reason, sources: [{workOrderId, version}], centres?: {operationSequence: centerName}}` — merge compatible remaining WIP once | manager, production, planner |
| `wo.close` | `{workOrderId, version}` | manager, production |
| `transfer.create` | `{itemId, fromLocationId, toLocationId, quantity, unit?, lotId?, reason}` | manager, warehouse |
| `count.schedule` | `{locationId, scheduledOn, basis: value\|risk\|bin, counterId, recountTolerance?, minimumValue?, risk?: high\|medium\|low, itemId?}` | manager |
| `count.submit` | `{sessionId, lineId, version, counted, serials?: [string], note?}` | assigned warehouse counter |
| `count.recount` | `{sessionId, lineId, version, note}` | manager |
| `count.record` | `{itemId, locationId, counted, lotId?, note?}` | manager, warehouse |
| `count.approve` / `count.reject` | `{countId, version, note?}` | manager (not the counter), owner |
| `return.receive` | `{orderId, lineId, quantity, unit?, locationId, disposition: restock\|quarantine, reason, serials?}` | manager, warehouse |
| `serial.service` | `{itemId, serial, kind: service\|warranty repair\|inspection, on, note}` | manager, quality |
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
| `role.set` | `{operatorId, role: manager\|sales\|planner\|buyer\|engineer\|production\|operator\|warehouse\|quality\|accounts\|agent\|viewer}` | owner |

## Agent proposals

The agent prepares; nothing changes until a person approves the exact version.

| `kind` | `plan` | Approved by | On approval |
| --- | --- | --- | --- |
| `order-intake` | `{customerId, enquiry, lines: [{itemId, quantity \| null, unitPrice}], promiseDate, message, questions?}` | sales, manager | creates the quote; refused while a quantity is missing. The enquiry text is stored as data only. |
| `replenishment` | `{explanation, purchases: [{supplierId, expectedDate, lines: [{itemId, quantity, unitPrice}]}]}` | buyer, manager | creates approved purchase orders. Larder attaches the deterministic shortages and cash exposure; changed shortages make it stale. |
| `item-merge` | `{duplicateItemId, keepItemId}` | manager | re-points codes, quotes and draft purchases, revises active BOMs, moves stock by compensating movements and archives the duplicate; refused while open orders or reservations use it. |
| `reschedule` | `{changes: [{workOrderId, priority, plannedStart}], conflicts?}` | production, planner, manager | updates priorities and planned starts; a changed work order makes it stale. |
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

## Dated material projection (MRP-001, partial)

`GET /api/larder/planning/materials` is a read-only projection under the same native-session and blind-count guards as other domain reads. It returns the current business `version` and UTC `asOf` day. It never creates drafts, changes reservations or commits a plan; the existing aggregate `shortages` and `plan.draft` retain their compatibility behavior.

`requirements` contains confirmed outstanding sales deliveries, residual weekly forecasts (after actual order consumption) and released work's pinned component quantities less actual issues. Work input dates apply the pinned routing offset to declared `expectedOn` (or `requiredBy` when no completion ETA is recorded); these remain informational full-job dates, never scheduled operation starts. Current physical `safety` rows come first, sorted by item/bin IDs; other rows follow topological item order (parents before shared components), then required date, explicit rank, reference, stable document/line IDs, revision path and supply mode within an item. Quantities are exact base-unit decimals. Each row gives covered/shortage quantities and the stock lot/bin or PO line/reference/date for every allocation. All pools are shared once across these rows.

Existing hard bin reservations are protected before any free allocation, including a later reservation competing with earlier unreserved demand. Within those bins the projection proposes eligible FEFO lots on the requirement date or today, whichever is later; expiry/retest dates are inclusive and customer shelf-life rules apply to physical sales supply. These are indicative sources, never persisted lot reservations or picks. A reservation not provably usable on its date appears in `unverifiedReservations`; its bin quantity stays protected and is never silently freed or moved. After hard commitments, active catalog items protect a current physical floor of max(safetyStock,minStock) in their default bin (or catalog location). Catalog locations naming one item/bin contribute the maximum once. Each `kind: "safety"` row identifies the item as `documentId`, the bin as `lineId` and `locationId`, all contributing `catalogLocationIds`, today as `requiredBy`, and exact quantity/covered/shortage. It consumes only usable physical stock in that bin before free demand; neither held/expired lots nor unreceived POs establish this current floor. Zero floors and archived items add no floor row. These are read-only allocations, not physical reservations or new execution gates. Remaining stock is allocated by FEFO. `unavailableStock` names dated lot failures and quarantine; `excludedStock` lists stock already blocked as of today.

Only outstanding approved, confirmed or partly received PO quantities with an ETA from today through the required date can cover a row. A later ETA appears in `unavailablePurchases`; a past ETA is explicitly overdue/unreceived and supplies no coverage until the ETA or physical receipt is recorded. Partial receipts reduce the outstanding PO pool even if their physical quantity is quarantined. Draft POs and every draft/released work output remain `provisionalSupply`, never proven usable supply. PO dates are declared expectations; actual receipt and quality gates still apply.

A bought-item shortage gets an informational `suggestion` with quantity and required receipt date. Its release date subtracts the preferred supplier/item term's recorded `leadDays` in UTC calendar days (ties use stable term ID). Missing supplier terms leave supplier, lead time and release unknown (`null`); a recorded zero is zero days. `requiresPastRelease` warns when the calculated date precedes today. These suggestions neither spend nor release work. Uncovered make and phantom demand now explodes through today’s effective BOM tree with ENG-001 make/buy/phantom and aggregate upward six-place yield arithmetic. Buy stops expansion; phantom bypasses physical and PO coverage. A `kind: "dependent"` row retains the root `documentId`, `lineId`, `reference`, required day, `supply` mode and ordered `path` of item/BOM/revision IDs. All parents precede a shared component so its dated physical/PO pools are netted once. Component lot eligibility is internal; customer minimum shelf-life applies only to direct sales stock. Recorded manufacturing routings now provide informational full-batch lead offsets: each operation takes setup + queue + run minutes times uncovered good-output base units, starts after all its declared predecessors (legacy order implies the previous operation), and the longest finishing path is rounded upward once to whole UTC calendar days. Minute arithmetic uses the stored decimal representation exactly; independent branches share elapsed time. Transfer-batch overlap, work-center/labor calendars and capacity contention are not applied, so this is not a feasible schedule. Components are due at the parent’s calculated release day; make levels accumulate offsets, while a phantom adds no separate manufacturing operation. Each row/path exposes its timing basis, BOM, receipt/release days and past-release warning; a make shortage with a representable recorded release gets an informational make suggestion. Missing or unrepresentable routing release dates provide timing diagnostics without a make suggestion. A missing/empty routing keeps lead and release unknown and explicitly labels inherited component dates as unoffset; a recorded zero-duration routing is zero days. Released inputs use the full pinned job quantity/routing and declared `expectedOn` completion day, falling back to `requiredBy`, less already-issued component quantities; later BOM edits and partial output never invent remaining operation time. A duration outside the existing four-digit YYYY-MM-DD calendar stays explicitly blocked with unknown release, never crashes the projection or supplies a plausible dated recipe. None of these reads changes promises, reservations, drafts or stock. `manufacturing` and make `suggestion` expose `{bomId, receiptOn, releaseOn, leadDays, requiresPastRelease, basis}`; dependent path entries carry `timing`, and released input rows carry `workTiming`. An item with outstanding draft/released work blocks further make expansion and reports each omitted branch in `blockedExplosions` (root/line, day, quantity, work-order IDs and reason). Its shortage remains explicit, work output remains provisional, and released pinned inputs remain independent demand; no duplicate sales recipe is inferred around unresolved work. Phantom expansion still bypasses that work. Material-feasible WIP and further make explosion around outstanding work, future dated floor replenishment, calendars and stale-safe adoption remain MRP-001 gaps. This endpoint adds no stored records; MOVE-008 complete business exports preserve its existing input records, and the named MRP-001 archive journey reproduces the projection after restore.

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
| `wo.operation.assign` | `operatorId` | Owner/manager records a named active production person’s or operator’s skill authorization for this task’s pinned requirements; this is not certification. |
| `wo.operation.start` | `workCentre` | Requires completed predecessors, acknowledgment and an eligible named station; records operator/time. |
| `wo.operation.complete` | none | The person who started the running operation records completion/time. |

Tasks retain their acknowledgment and execution history in state and the business archive. Stock output/closure for a routing containing instructions, drawings or skill requirements waits for all its operations to complete. Simple existing routings remain usable with the published material/output flow. Setup/run/queue times are declared routing estimates, not actual labor capture (FLOOR-002) or finite calendar bookings (CAP-001/CAP-002/CAP-004). Engineering change proposals and obsolescence remain ENG-005 work.

The `production` and `engineer` roles author routings; `production` and `operator` people operate them. Task acknowledgment, start and completion require current owner/manager/production/operator authority, and an operator acts only on operations assigned to them; agents cannot execute. Skill-required tasks need owner/manager authorization of the exact operator before start, and any assigned task can be started/completed only by that operator (completion also checks the original starter). Authority is rechecked through the same native-session atomic command door.

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

`mps.preview` takes `{reason}` and retains the exact rows/state version. Existing planning roles and planners prepare. `mps.release` takes `{planId, version}`; owner/manager/production/planner approve, with a different preparer except the owner and no agent release. Any business write after preview makes it stale. Release creates linked draft work or purchases for uncovered weekly quantities; bought items require a recorded supplier, and a missing supplier refuses the whole batch. Work release and purchasing approval stay separate. Draft/open supply prevents a second schedule from duplicating the first. Original forecasts, overrides, undo entries and released MPS snapshots are included in the complete archive.

## Catalog bulk edits (ENG-007)

Owner/manager/buyer/production/engineer download `GET /api/larder/catalog.csv`, and prepare `catalog.bulkPreview` with `{file:{name,content}}`. The CSV contains stable `larder_id`, `location_id` and every editable item field, including variants, units/conversions, prices, category, price-list membership, barcode, tracking, preferred supplier terms and per-location reorder/safety/min/max/bin/lead settings. Supplier prices remain per their stated `purchase_unit`. Locations serve as bins. Archived items are excluded from the active export; a retained ID can still be edited explicitly.

Blank cells leave stored values unchanged. `#CLEAR` removes an optional text, JSON or location setting; a leading backslash escapes literal `#CLEAR` (add one backslash before an existing run). Required identifiers and numeric values need explicit values; `0` and `false` are edits. Every nonempty exported text cell carries one reversible leading apostrophe for safe spreadsheet handling, including leading-zero and formula-like identifiers. Import removes exactly that one prefix. Keep it when editing downloaded files; double an intended literal leading apostrophe. Rows without Larder IDs create one item grouped by SKU, with one row per location. Unknown supplied IDs never create records. Global values on repeated location rows must agree, and each invalid row excludes the entire item group.

The preview retains original text, every field's old/new values, file/physical-row/column errors and affected quotes, orders, POs, planning settings/work/forecasts and physical positions for valid and rejected groups. Catalog values apply to future documents; current issued documents, reservations, stock and used units remain unchanged. Location settings configure DEMAND-004's future policy planner and do not silently allocate inventory.

`catalog.bulkApprove` takes `{previewId,version,acceptRejected?:<exact row-error count>}` and applies every valid item group atomically. Owner/manager/buyer/production/engineer approve; a different preparer is required except for the owner, and agents cannot approve or enable tracking. Any intervening business write refuses the stale preview. The original CSV, proposal, approver and resulting item IDs remain in the state/archive.

Tracking is declared configuration. Enabling batch refuses any nonzero position lacking a valid lot, across every location/disposition. Batch physical receipts/output require a lot. Serial configuration refuses existing physical stock and displays “serial policy configured; one serial per unit at every stock door”; TRACE-002's doors then move every unit of a serial item as one named serial. The future GOV-001 engineer inherits these catalog authorities. No serial lifecycle or inventory-policy engine is claimed by this catalog edit.

## Engineering changes (ENG-005)

`engineering.propose` accepts `itemId`, optional exact `sourceBomId`, `reason`, `safety`, UTC `effectiveOn`, full `components`, optional `routing`/`yield`, original-file `attachments`, `substitutes` (`fromItemId,toItemId,reason`), `dispositions` (each entire positive removed-component stock position with `itemId,locationId,lotId,status,quantity,action,reason`), and `workTreatments` (`workOrderId,version,action,reason`). Stock actions are retain/return/rework/scrap instructions, never physical transactions; draft actions are keep/adopt/cancel. Phantom-parent drafts are included. The response retains source/prospective revisions, drawings/digests, all impacted stock/work and the exact business version. No revision is published yet.

`engineering.approve {changeId,version}` is owner/manager only, with a different preparer except owner, and refuses any intervening write. It creates the immutable approved revision, pins the selected prior/new revision on every affected draft or cancels it, and preserves released work. `engineering.decline {changeId,version,reason}` records a manager decision; stale proposals can be declined and resubmitted. Ordinary direct/CSV revisions cannot bypass an open proposal. Safety proposals block direct and flattened-parent work releases.

`engineering.acknowledge {changeId,version,bomId,note}` records the current production person’s reading of the approved change. An affected release needs that person’s acknowledgment; adopting a future revision refuses release until its UTC effective day. Per-job ENG-002 instruction/drawing acknowledgment is still separate. Approved payloads never change; acknowledgments append with optimistic record versions. All engineering records and original files export/restore in the business archive.

## Downtime and operation progress (FLOOR-007)

All commands take `workOrderId,version,sequence`. `wo.operation.pause` also takes `reason` (breakdown/waiting-material/changeover/quality/other), `note`, `escalationOwnerId` and a future ISO UTC `anticipatedResumeAt`. The handler and atomic write both verify an active owner/manager escalation destination. The production or operator starter reports their own operation; owner/manager may report with a reason; agents never do. Pausing records a server-time interval and an in-app notice, not an email. The assigned supervisor or owner acknowledges with `wo.operation.escalationAck {downtimeId,note}`; acknowledgment persists even after resume.

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

`wo.operation.assign {workOrderId,version,sequence,operatorId}` is owner/manager-only and checks an active operator/production/manager/owner target in the handler and atomic transaction. Every new start requires that assignment plus `{workCentre,station,reason}`. Completion requires the same assigned starter and `{reason}`. Existing pause/resume record the task’s station and equipment as well as the named operator/reason. These commands never post stock/output. An older active task without assignment requires an explicit manager assignment to its recorded starter with `reason`; the absent historical station remains not recorded. Native shared-station sign-out revokes the session; the next operator uses their own native sign-in.

## Inventory policies (DEMAND-004)

`inventory.policy {itemId,locationId,previousId?,mode,effectiveOn,batchSize,orderMultiple,reason}` appends an immutable manager/production/planner revision. Modes are `make-to-stock`, `make-to-order`, `assemble-to-order`; order/assembly require a made item. `previousId` names the latest saved revision. The latest effective UTC revision applies; future revisions do not activate early. Current catalog location reorder/safety/min/max/default-bin/lead values remain authoritative. The default bin is the physical stock pool and proposed destination.

`inventory.preview {policyId,orderIds,reason}` retains a read-only exact-state proposal. Existing assigned open demand is always included; explicit selection assigns new demand only at approval. The protected floor is max(safety,min). Common available stock above it follows rank/due order; all prior hard reservations remain intact. Stock mode replenishes toward max(maxStock,floor) at/below reorder, otherwise only a floor shortfall. Customer/assembly modes create separate dated order-line pegs after common allocation. Both batch and order multiples are satisfied by rounding upward to their scaled-integer LCM. Lead days are UTC calendar days. Late starts/supply remain labelled; quantity netting is not capacity feasibility.

Open/draft supply must have an explicit physical bin. `inventory.supplyAssign {policyId,kind:workOrders|purchaseOrders,documentId,lineId?,version,orderId?,orderLineId?,reason}` records an unlocated document’s bin and optional exact customer peg under manager/production/planner authority, without changing terms/quantities. Assigned commitments cannot silently move.

`inventory.approve {planId,version}` is owner/manager/production/planner only, independently from preparation except the owner; agents only prepare. Any intervening write refuses the preview. Approval atomically records line planning bins, reserves the exact reviewed common physical quantities and creates pegged draft work/purchases. Receipt/output, production release and spend retain their existing separate doors. Unlocated supply or missing BOM blocks approval; all prior reviews and policies survive archive restore. Existing shortage/MPS shortcuts refuse configured items and direct the person to this policy preview. Explicit manual drafts remain manual operations.

## Owned exception follow-up (AUTO-001 / LARDER-013)

The owner also holds every manager authority. Assignees are active human write-capable roles; viewers and agents cannot own cases, and viewers retain read-only access. Assignment/escalation validates current targets in both the handler and atomic commit. Updates bind the case version and current caller; identical command identities replay the saved outcome, including after the former target changes role.

Use the state API's stable case key and version. A note, ETA revision, draft purchase/work or retry submission cannot certify physical acceptance, work completion or ledger reconciliation. `status` is recomputed from source evidence as `following up` or `closed`; history and original file digests remain available after closure and through business archive/restore. Date-derived overdue escalation starts on the UTC day after `dueOn` and is a Today notice in this app. Provider-confirmed failed-sync closure is inherited by CONN-001–CONN-015 before those capabilities ship; today's ledger evidence is the accountant's exact issued-line acknowledgment.

## BUY-004 subcontract service and customer custody

`subcontract.draft` takes `{supplierId, vendorLocationId, itemId, customerId?, quantity, serviceRate, expectedDate, operation}`. `subcontract.approve` takes `{orderId, version}`. Drafts: buyer/manager/agent; independent approval: buyer/manager (owner exception).

Every subsequent command takes `orderId, version`. `subcontract.dispatch` takes `lines: [{lotId, locationId, quantity}]`; `subcontract.receive` takes `{good, scrap, lot, locationId, reason, evidence, inputs: [{issuedId, quantity}]}`; `subcontract.return` takes `{issuedId, quantity, locationId, reason}`. Buyer/manager/warehouse record these physical events. `subcontract.bill` takes `{reference, amount, evidence}` and requires accounts/manager; records local reconciliation, never a provider outcome. All quantities use base units and six-decimal strings; service is per good-plus-scrap output unit. Agents never post these effects.

`customerStock.receive` takes `{customerId, itemId, locationId, lot, quantity, evidence}` (buyer/manager/warehouse). It creates customer property with separate `subcontractCustody` events and zero owned value; customer lots cannot enter the owned movement ledger. `subcontractOrders` state includes approved terms, issued lots/consumption/returns, dated receipts with input movement IDs, output lot IDs, yield, material/service/output/scrap costs and bill history. Each finished lot names its service order and receipt, allowing that receipt's exact upstream lots and supplier to be traced. The Make & buy Subcontract screen shows these same quantities, source lots and supplier references, and the separate customer custody ledger.

## Barcode scanning (FLOOR-008, partial)

`GET /api/larder/scan?code=<scanned text>` resolves a code to the item (SKU or barcode; UPC, EAN and GTIN-14 compare as 14 digits), bin, job, sales order, purchase order, lot or serial it names. A GS1 element string, raw (an optional `]C1`, `]d2` or `]Q3` prefix and FNC1 sent as GS) or with parenthesized identifiers, is split into GTIN (01 or 02), lot (10), production (11), best-before (15) and expiry (17) dates, serial (21) and count (30 or 37); a wrong check digit or impossible date is `SCAN_GS1`. Adding `use=receipt|issue|pick&id=<purchase order, job or sales order>` checks the code against that document and returns the matching `lineId`; `use=transfer&id=<bin>` requires the lot or serial to be available in that bin, and `use=output&id=<job>` requires the job's own product and returns the label's serial, batch and expiry: an item not on it is `SCAN_WRONG_ITEM`; a lot under quality hold or recall is `QUALITY_HOLD` or `RECALL_HOLD`, one only in quarantine is `SCAN_HELD`; an expired, used up, shipped or closed code is `SCAN_STALE`; a serial already received or on an open pick is `SCAN_DUPLICATE`. A receipt scan returns the GS1 lot, serial and dates to record. The door never moves stock; the screens post scanned lines through `receipt.create`, `wo.issue`, `shipment.pick` and `transfer.create`. A blind counter never calls this door: the blind workspace lists each counted item's SKU and barcode (identity, never a quantity) and the count screen matches scans in the browser.

## Serial numbers (TRACE-002)

A serial-tracked item moves only as named serials, each a one-unit lot (`serial: true`) that TRACE-001's trace, holds, recalls and the archive already carry. `receipt.create`, `wo.output`, `wo.issue`, `shipment.pick` and `return.receive` take `serials` (a list, or text separated by commas or new lines) with exactly one serial per whole unit. A receipt or output refuses a code the item has used before (`DUPLICATE_SERIAL`), an output report records one serialized unit (`SERIAL_QUANTITY` otherwise) with its exact component allocation, issue and pick name serials in stock at that location (`SERIAL_SHIPPED` or `SERIAL_NOT_IN_STOCK` otherwise, and `SERIAL_PICKED` for one already on an open pick), and a return names serials that left on that order line (`SERIAL_NOT_SHIPPED`). Every other physical door refuses a serial item it cannot name (`SERIAL_REQUIRED`). `serial.service` appends a service, warranty repair or inspection record with the customer then holding the unit.

`GET /api/larder/serials?q=<code>&itemId=<id>` returns up to 50 serials whose code contains `q`, each with its place (in stock, quarantine, assembled or shipped), origin, exact components, the products it went into, customers with shipment, order and tracking, returns, service records and movements. A location-scoped member sees only serials with stock history inside their locations; other records read `restricted record`.

## TRACE-001 genealogy and production allocations

`GET /api/larder/lots/:id/trace?direction=upstream|downstream` returns the selected lot, direction, graph nodes and typed rows; the same route with `trace.csv` downloads those rows. `movement` and `custody` rows occur once and sum to `balance` rows by lot/item/location/status. `relation` and `event` rows describe ancestry, exact batch inputs, recorded output/scrap or WIP responsibility, never another physical posting. Rows retain stable IDs, signed quantities/base units, dates, locations/status, related document/order/party references and reversal identity. Legacy job-level ancestry is explicit.

`wo.output` additionally accepts `allocations: [{movementId, quantity}]` naming the actual component issues used in that output batch. A sole final batch auto-records all unallocated issued inputs when no choice exists; partial/ambiguous batches require actual inputs. Shared split/merge issue pools enforce source non-reuse and the current job's component WIP quota. Final output and closure reconcile all issued material. State `workMaterialPools[workOrderId]` lists available issue IDs/lots, source quantities and job quotas.

`wo.batch.allocate` takes `{workOrderId, version, batchIndex, allocations, reason, evidence}` (production/manager, owner included), recording missing historical allocation once with actor/time/original evidence. It retains original output quantities/movements and refuses ambiguous original output identity. New output or closure cannot bypass unresolved historical batch allocations. The Stock genealogy screen and work-order allocation forms use these same public doors.

## Nonconformance cases (TRACE-005; deviations TRACE-008)

Owner, manager or quality uses `nonconformance.open` with `{lotId, locationId, quantity, complaint, dueOn, evidence: [file]}` to contain available units and own the case. `nonconformance.update` takes `{caseId, version, rootCause, correctiveAction, nextAction, dueOn, supplierId?, reworkOrderId?, evidence: [file]}` and records follow-up in app; it sends nothing and executes no repair. A linked draft quarantined repair acquires the case reference and later consumes its held quantity through the independently approved `rework.execute` door. Case closure waits for that repair’s inspection and release.

Record a scoped result using `quality.inspect` with `{nonconformanceId, quantity, planId, planVersion, samples, evidence?}`. `nonconformance.release` takes `{caseId, version, quantity, inspectionId, reason, evidence: [file]}`; it needs the latest current passing result for exactly those units, every applicable required plan, and a manager or quality-role holder other than the case opener and latest failing inspector (owner exception). All quality/expiry/certificate gates still apply. `nonconformance.reject` uses the same disposition input without inspectionId. `nonconformance.close` takes `{caseId, version, effective: true, check, evidence: [file]}` only after all affected units are disposed and root cause/CAPA/follow-up exists. Case and original files survive archive restore. `nonconformance.return` additionally requires `supplierId` and `supplierReference`, removes held stock with its original cost, and records an in-app physical return rather than provider confirmation. Supplier RMA/credit reconciliation remains BUY-006; `nonconformance.deviation.propose` takes `{caseId, version, quantity, reason, evidence: [file]}` under owner/manager/quality authority. It records an immutable proposal snapshot (case and lot versions, held quantity, lot/location, all linked failing case inspections and plan versions, evidence digests, proposer/time). It requires an open case and at least one failing case result; quantity cannot exceed the remaining hold. Proposing has no approval or stock effect. `nonconformance.deviation.approve` takes `{caseId, version, deviationId, note}` and `nonconformance.deviation.execute` takes `{caseId, version, deviationId}`; only a live quality-role holder or the owner may call either (managers, other roles and agents get `FORBIDDEN`). The approver differs from the proposer (owner included), the case opener and the latest failing case inspector (owner exception for the latter two). Both doors apply recall (`RECALL_HOLD`), quality-hold, expiry/retest (`LOT_BLOCKED`) and certificate (`CERTIFICATE_REQUIRED`) gates and refuse `STALE_INPUTS` when the lot version, held quantity or case inspections changed since the proposal or approval. Execution atomically moves exactly the proposal quantity of case-held quarantine to available at case cost (movement kind `nonconformance-deviation`, reason `Deviation <reference>: …`), never re-reserves, keeps every failed result and records `decision: deviation` labelled `released under deviation; failed results retained, not passed`. The reference appears in `/lots/{id}/trace` JSON/CSV (event kind `deviation release` and both movements) and in later shipment packs of that lot (`trace[].deviations`).

## Recall containment (TRACE-006, partial)

An owner or manager uses `recall.open` with `{lotId, reason, evidence: [file]}` to place an immediate source-lot hold, expanding recorded downstream genealogy in the same atomic command. `recall.expand` with `{recallId, version}` explicitly repeats that expansion and retains each snapshot. Current on-hand available units move to quarantine with their recorded cost; displaced reservations are named. Existing quarantined units and new quarantined returns are also protected from other stock disposition commands. The hold refuses restock, release, rejection, consumption and reversal bypasses. No recall-release command is offered yet. Work that issued affected lots and its split/merge successors refuse operation start and new good output; dispatch shows the same reason and owner.

`GET /api/larder/recalls/<id>.json` uses the normal signed-in read door and downloads `larder-recall-containment-v1`: original evidence and expansion snapshots, current lot/location balances with units, affected shipments/orders/customers, original and net-after-reversal shipped quantities and linked return records. It says `complete: false` and names the missing notice/delivery, acknowledgment, disposition reconciliation and compliance-export work. Quantities from different SKUs/units are never added into one total. Customer-property source/descendant lots are refused with no partial hold. Vendor custody and unlotted legacy reconciliation remain gaps. This API does not send a notice or claim a complete compliance pack.

## Operation dependency and actual handoff rules (CAP-003)

Routing JSON and the routing editor accept `transferBatch` (decimal finished-item base units, default `"0"`), `allowOverlap` (boolean, default false) and `requireMaterials` (boolean, default false). A positive batch requires predecessors; overlap requires a positive batch. Start needs min(batch, job quantity) actually transferred from each predecessor and, without overlap, full predecessor completion. With no batch, full predecessor completion remains the rule. An enabled material gate requires all pinned components fully issued; stock/reservations/progress estimates cannot stand in for issue or handoff. Every current required predecessor inspection must have its latest passing result, and open quality/recall holds still block. Dispatch and start share these live gates with responsible operator IDs.

`wo.operation.transfer {workOrderId,version,sequence,toSequence,quantity,reason}` appends actual additional completed units physically handed from a running/completed assigned source to a direct batch-gated successor. Its assigned starter records the handoff; an inherited completed task must first be assigned by owner/manager and retains its original-work evidence rather than an invented starter/time. Per-edge totals cannot exceed job quantity or the actual quantity received from all the source’s predecessors. Completion of a batch-gated operation needs the full job quantity handed to it. Transfers never post stock, output or cost. Splits/merges allocate only remaining fungible handoffs in the existing WIP proportion (six-place truncation, residue retained on the source), with original events, linked allocation records and predecessor completion evidence retained. Routing revisions, CSV and archives preserve the rules and history. All configured material/batch operations must complete before output/closure; FLOOR-003’s full operation cost/quantity ledger and dated backorders remain separate work.

## Source history and portable tables (MOVE-008)

- `history.preview`: `{file: {name, content}, attachments?: [{name,contentType,base64}]}` — owner, manager or agent; parses the `larder-source-history-v1` format in MOVE-IN.md, retaining the original file and proposed records.
- `history.commit`: `{importId, version}` — owner or manager; publishes the exact reviewed history, rejecting duplicate source/kind/original-ID keys. Agents cannot commit. Both use the ordinary atomic, session/role-checked command door and idempotency rules.
- `GET /api/larder/history?q=<reference>` — authenticated, case-insensitive substring search of source systems, kinds, original IDs/references, summaries, linked references and filenames. Subject to the same blind-count restrictions as other downloads. Returns labeled historical evidence only.
- `GET /api/larder/archive.csv` — owner/manager; lossless `section,index,json` CSV companion to the complete JSON business archive. See MOVE-IN.md for decoding, decimal representations and original-file custody. This is not the installation backup, which has a separate portability policy.


## Drafting a dated suggestion (MRP-006)

Read `/api/larder/planning/materials`, review the returned requirement and its
`suggestion`, then send `plan.draft` with `itemId`, `dated: {version, asOf, key}`
from that projection and a required `reason`. `key` is an opaque requirement
selector. A buy suggestion also requires an explicit decimal `unitPrice`; the
resulting draft shows its exact cash exposure for the existing purchase approval
flow. Make drafts retain `plannedStart` from the informational routing release
and `requiredBy` from receipt. These are UTC dates, not capacity bookings.

The existing plan.draft roles (owner, manager, buyer, production, planner and
agent) may prepare; existing purchase/work approval roles still decide release.
The existing active inventory-policy guard directs those SKUs to the policy
preview instead. The command rechecks the full state version and UTC day inside
the ordinary atomic write; `STALE` means read and review again. Quantity, supplier,
supply mode and dates are derived server-side: supplying `quantity`, `supplierId`,
`supply` or `expectedDate` alongside `dated` is refused. Missing suggestions,
unresolved work/timing blockers, and absent recorded suppliers are refused.

Each draft keeps `datedPlan` with the projection version/day, reviewed requirement
(including its root/revision path) and exact suggestion/timing. Requirements expose
`key` and `linkedSupply` (kind, document ID, reference and status). An open draft,
approved/confirmed/part-received PO or draft/released job linked to that same
root/component branch (conservatively across delivery dates on one line) returns `DRAFT_EXISTS`, including after date or recipe
revision changes. Resolve/reconcile that supply before drafting more. Drafts
remain provisional, never usable material. Once linked supply is fully received
or work is closed, a new current shortage can be reviewed again.

A stable command identity replays its recorded result; changed content is refused.
Preparation creates one ordinary draft and its provenance only: it never buys,
releases work, changes promises, reserves stock, sends anything or adopts a feasible
schedule. Business JSON/CSV archives preserve the draft and provenance, and empty
restore reproduces linked supply without reconnecting or replaying commands.
Material-feasible WIP, future safety floors and supplier calendars remain open.


## Native supplier terms and scheduled purchases (BUY-001)

`GET /api/larder/purchasing/quotes?itemId=<id>&quantity=7&requiredBy=2026-11-15`
compares structured supplier/item quotations without writing. Each quote includes
its reference/version, requested and pack-rounded base quantity, earliest supplier
working date, feasibility against required-by, source price/currency, source
exposure, recorded USD rate and USD exposure. Preferred is a label; it never
makes a late quotation feasible. MOQ and pack multiples apply to the total item
quantity on a PO. Break thresholds and prices use item base units. The highest
qualifying threshold sets price. USD exposure sums base quantity × USD unit price,
with the existing six-place half-away-from-zero rounding at each multiplication.
A buyer-recorded rate is not a live provider rate or accounting reconciliation.

- `supplier.terms`: owner/manager/buyer saves `{id?, version?, partyId, itemId,
  partyCode, preferred?, packQuantity, moq, leadDays, weekdays: [0..6],
  closedDates: [YYYY-MM-DD], price, breaks: [{quantity, price}], currency,
  usdRate, rateOn, rateSource, paymentTerms, freightTerms, note?}`. Currency is
  ISO 4217; USD rate is one. Non-USD rates are positive USD per source unit,
  with a non-future recorded date and source. Quantities and rates are decimal
  strings. Lead days are 0–365 supplier working days after the UTC order day;
  zero lead rolls forward to an open day. Calendar days are UTC, Sunday is 0.
  Every revision retains the prior code, preferred flag and all structured terms.
- `po.selectQuote`: existing purchase drafters send `{partyItemId, version,
  quantity, requiredBy, reason, deliveries?: [{quantity, expectedDate}]}`.
  Recomputes the live quotation and refuses stale or late terms. Delivery dates
  must be open days from earliest arrival through required-by, and quantities
  must sum to the rounded quotation. Blank schedule uses one earliest delivery.
  This prepares a draft; existing human PO approval remains required.
- `po.draft` also accepts `expectedDate` per line. Every existing draft door
  applies configured supplier MOQ/pack, calendar, lead and price constraints;
  callers cannot insert a quoted snapshot or bypass these with a custom price.
  Existing manually priced suppliers without structured terms remain supported.
- `po.approve` refuses changed structured terms and freezes an independent copy
  of supplier identity/basic terms, line quotes, source currencies/rates, USD
  exposure and all delivery dates. Later supplier edits and receipts never
  change that approval.
- `po.confirm` and `po.revise` optionally accept `lineId`; omission explicitly
  revises all outstanding deliveries. Each acknowledgment/revision retains
  complete before/after schedules and actor/time, plus existing reference/note
  and optional acknowledgment evidence. Supplier revisions may be late or on
  closed days: they are recorded facts, never a new feasibility guarantee.

Each line's remaining quantity and current date flow into material projection,
ranked order supply, inventory plans, forecast supply and work shortage screens;
PO-level expected date is the earliest outstanding delivery (or last stored date
when complete). Receipt reversal restores that next-delivery date. Receipt
observations in state `supplierPerformance` retain receipt reference, arrival,
expected date at receipt, original approved date, quantity and accept/quarantine
classification. Counts measure non-reversed receipt-line observations, not
promises or quality acceptance; late means arrival after the expected date.
Older receipts without these snapshots are unmeasured. Terms, history, approvals,
schedules and performance inputs survive business archive/restore.

## Capacity calendars and finite planning (CAP-001, CAP-002, CAP-004)

`capacity.machine` saves `{id?, version?, name, timeZone, effectiveFrom,
effectiveTo, capacity, efficiency, shifts, closedDates?, usHolidays?, exceptions?,
reason}`. Owner/manager/planner can maintain machine calendars. Capacity is 1–20
parallel named slots; efficiency is an integer percentage from 1–100.
`capacity.labor` saves the same calendar fields, without efficiency, plus
`operatorIds` (active native owner/manager/production/operator IDs), `skills`
(exact routing names) and `capacity` (1–10 simultaneous tasks **per person**).
Owner/manager maintains person/team availability and skill authorization, using
ENG-002's supervision authority. A person belongs to one labor calendar.
Every update requires the current row version and a reason and retains prior
calendar definitions with actor/time. No calendar grants native membership,
execution assignment or certification.

A shift is `{weekdays:[0..6], start, end, breaks:[{start,end}]}`. Minutes are
local wall-clock minutes from its starting day's midnight. Start is 0–1439;
end is later than start and at most 1440 minutes later (e.g. 1320–1800 is
22:00–06:00). Breaks use the same anchor. Effective dates include both endpoint
shift-start days. Closed dates and observed US federal holidays close the whole
local date, including an overnight continuation. Real UTC minutes are tested
against each resource's IANA timezone, including daylight-saving transitions.
Exceptions `{startsAt, endsAt, reason}` use offset-bearing timestamps and remove
capacity; a labor exception is vacation/time off for that person/team. Machine
maintenance holds also remove capacity until actual authorized release; an ETA
alone never supplies finite capacity. The original weekday recovery estimate
continues to label after-ETA maintenance recovery as provisional (CAP-009).

`GET /api/larder/scheduling/finite?asOf=<offset-timestamp>&days=14` reads the
current state/version and active native people. Horizon is 1–60 elapsed days.
Each operation names its machine, parallel slot, qualified person, occupied UTC
intervals, remaining effort, setup/run/queue assumptions and dependencies.
Efficiency stretches setup/run occupancy, conservatively rounded to whole
minutes; queue is elapsed wait before occupation. Breaks split occupied intervals.
A draft uses the currently effective recipe; released work keeps its pinned one.
Existing exact execution assignments restrict candidate people. Missing calendars,
qualifications or joint capacity leave explicit unscheduled operations and jobs;
no default machine, person, balance or shift supplies capacity.

The response includes jobs, current-plan late/unscheduled ID lists and counts,
machine-slot and person loads and a bottleneck selected by greatest utilization
(with occupied-minute and stable-ID tie breaks). Due dates end at 23:59:59.999 UTC. Open jobs with every operation completed use
the latest recorded completion time for lateness without inventing future bars;
legacy completion without a dated finish stays explicitly unproven/unscheduled.
Dependency CPM slack uses occupied effort plus queue; due slack compares the
calendar-constrained finish with due. `promises` traces existing MRP demand links
from confirmed delivery lines to work and operation keys; absent links are
explicitly unproven. These links do not assert material/shipping/quantity coverage.
This read creates no bookings, dispatch rights or customer promise changes.
CAP-005–CAP-008, DEMAND-001/005, MRP-004 and AGENT-001 inherit these finite
calendar and explicit-unfeasible obligations before adopting or promising work.

`capacity.rate {laborId, version?, hourlyRate, burdenRate, reason}` maintains
separate USD hourly employment rates under GOV-001's owner/manager/accounts
rate authority. Rates and their history are absent from other roles' state and
finite-plan responses. Operators cannot recover rework hourly-rate fields through
state or a previously authorized command replay; FLOOR-004 retains its explicit
production authoring authority for its manual job-cost records.
`GET /api/larder/scheduling/labor-costs` is owner/manager/accounts only. Completed
operation clocks minus recorded pauses produce exact elapsed-time costing
evidence at the retained rate in force at start, rounded half up to six places.
Missing historical rates remain unknown. It makes no payroll or ledger posting;
FLOOR-002 and COST-001 retain their correction/period-lock and posted-cost duties.

Machine/person calendars, exceptions, skills, rate histories and clock evidence
inherit MOVE-008: complete JSON and lossless CSV business archives preserve them;
empty restore retains unknown native person IDs as inert history, never a new
membership or a replayed command. Edit to an explicitly authorized live person
before those restored calendars can supply labor capacity.

## Reviewing and approving a finite move (CAP-005)

The existing `proposal.prepare` door with `kind: "reschedule"` accepts
`plan: {changes: [{workOrderId, plannedStart, priority}], capacity:
{asOf, days, reason}}`. The Schedule screen offers dragging a pending job onto
another and equivalent keyboard/date/priority controls. Once machine calendars
exist, **every** reschedule proposal uses the finite preview, including callers
that omit `capacity`. An older weekday-only proposal cannot be adopted after
calendar configuration; prepare it again.

Preparation records both full finite projections, displaced jobs' finish/due/risk,
explicit capacity conflicts and linked customer promises. It changes no job or
promise. Existing LARDER-015/GOV-001 reschedule authority applies: people and
agents may prepare under their existing roles; a different live manager,
production person or planner approves (owner exception); agents never approve.
A running/paused job cannot be selected for movement, and active jobs retain
first access to capacity. Approval changes only the reviewed job priorities and
not-before dates and retains the exact versioned named intervals as audit.
Customer promises remain unchanged, with a changed-promise count of zero and
before/after completion risk visible; their amendment remains DEMAND-005 work.

`proposal.approve` rechecks the complete state version, current planning window
and a digest of the finite projection from live native people. Any intervening
shop-floor/calendar/state change, expired window or native revocation requires a
new preview (`STALE`). Selected jobs with no feasible assignment or newly
unscheduled downstream work prevent approval (`CAPACITY`). Destination people
are also checked active/qualified by role in the atomic D1 batch. No conflict
silently adds resource capacity. A stable command identity replays the decision;
changed content is refused. Prepared and approved snapshots/decisions inherit
MOVE-008 JSON/CSV business export and empty restore. CAP-006–CAP-008, MRP-004 and
AGENT-001 inherit the same preview, finite-capacity, authority, stale-input and
archive obligations when they add adoption doors.

## Qualified alternate sequencing (CAP-006)

Routing accepts `setupFamily` and semicolon-editor `requiredTools` (API: name array).
`capacity.sequence` takes `{id, version, tools, initialFamily, changeovers: [{from,to,minutes,cleanupMinutes}], planningHourlyCost, overtimeHourlyCost?, outsourceCost?, outsourceDays?, reason}` for a saved machine calendar (owner/manager/planner). Tariffs are public combined planning estimates, never wages or automatic postings.
A finite `reschedule` proposal change can include `scheduleChoices: {"1": "Qualified center name"}`. The finite snapshot includes per-slot setup transitions, tools, named machine/person minutes, USD estimate and optional overtime/service comparisons. Missing tools/transition/capacity prevents approval. Selection changes no pinned instruction/quality requirement, execution assignment, customer promise, stock or spend. Optional comparisons grant no overtime or outsourcing authority. All definitions/history, job choices and proposal snapshots survive the business archive.

## Durable recovery and outage scenarios (CAP-007 / MRP-004)

`schedule.protect` accepts `{version?, asOf, days, freezeUntil, manualLocks: [{workOrderId,sequence}], automatic:false, reason}`. The owner, manager or planner records the exact frozen and locked feasible intervals. Relevant production progress/pause/resume/completion, maintenance, supplier ETA and priority events record one durable `schedulePlans` reflow per command; without a qualifying bounded grant it stays in review.

`schedule.scenario` accepts `{asOf,days,name,reason,outages?:[{machineId,startsAt,endsAt}],changes?:[finite reschedule change]}` for manager/planner/agent preparation. Each isolated plan retains baseline, changed-job consequences and named finite resources. Sibling comparisons do not mutate live data.

`schedule.adopt` and `schedule.reject` accept `{planId,version,reason}` for independent owner/manager/production/planner approval (owner excepted from preparer separation). Adoption checks all business inputs (including ETA/stock), the UTC day, future window and live people; then atomically retains every approved interval in `scheduleBookings`. This manual door never delegates automation, customer-promise amendment, purchase approval or provider effects. Any conflict or stale input writes no booking. Unavailable protected work stays explicitly unscheduled. Material ETA events use shared named sources and preserve successor buffers; uncovered input remains a conflict. Bounded automatic internal bookings use the separately approved grant below. All new collections/history and decisions are included in complete JSON/CSV export and inert restore.

## Replenishment review (MRP-003)

`supplier.terms` additionally accepts `leadDaysMax` (normal lead days through 365; omitted means normal). Revisions/history retain both bounds.

`replenishment.preview` accepts `{itemIds?, horizonDays, historyDays, confidence, confidenceBasis, reason}` from manager/planner/buyer/agent. It records shared dated buy shortages, safety requirements, shipment history and forecast records. Confidence is the planner’s explicit 0–100 assumption and evidence basis. Supplier alternatives expose rounded quantity, normal/latest calendar arrivals, dated covered/at-risk units, surplus, price-break/currency/rate and USD cash. Safety-stock changes continue through catalog/inventory policy doors.

`replenishment.approve` accepts `{planId,version,decisions:[{itemId,partyItemId:null|id,reason}]}` from an independent buyer/manager (owner exception). Decide each displayed item once: null rejects it with the recorded reason; an eligible supplier approves one PO at the conservative arrival. Late-at-bound selections are refused. Changed business inputs/people/day require a new review. The atomic write records only selected approved purchase orders, without supplier send, stock/reservation or promise effects. Preview/decisions/reasons, term history and pinned quotes survive JSON/CSV archive and inert empty restore.

Scenario assumptions also accept:
- `extraWork: [{itemId,quantity,requiredBy,plannedStart,reason}]`: compares added internal draft demand; explicit adoption creates only those exact drafts, never release or customer demand.
- `inventoryUnavailable: [{itemId,locationId,lotId?,quantity,reason}]`: withholds free physical stock only in the clone; hard reservations are protected. This door never adopts speculative stock; record the physical change through its existing approved door, then compare a fresh scenario.
- `alternateSuppliers: [{partyItemId,quantity,requiredBy}]`: compares structured quote/calendar/uncertain-bound quantity and cash with hypothetical supply, without creating a live PO. Adoption is denied until the spending/supply assumption is realized through existing buyer-approved doors.
- `overtime: [{kind:machine|labor,id,startsAt,endsAt,reason}]`: bounded inside the reviewed horizon. Independent schedule adoption also requires owner/manager for labor overtime or owner/manager/planner for machine overtime and records those exact calendar windows with history. Holidays/closures/time-off/outages and live people still constrain capacity; no payroll or financial action occurs.

Relevant supplier ETA events expose named supply references, new material-not-before dates and dependent buffer displacement. Missing shared allocation remains an explicit conflict, never invented material. New assumptions/history remain in the complete archive. The 22 October ct ruling makes the speculative-stock/supplier refusal permanent. Protection is owner/manager/planner; adoption and decline use CAP-005 independent approvers, with the owner exception and per-piece authority. Only a separately approved bounded grant can delegate automatic internal bookings.

## Audit of production decisions (GOV-004, partial)

Every command that changes records appends one entry per changed record to `larder_audit` in the same atomic batch: actor, role, time, source (`person`, `agent` or `import`), command type and id, area, subject, the changed fields before and after (the whole record on create), the reason the command gave, linked evidence (attachment id, name, size, SHA-256) and every record id the subject links to. Stock postings are entries of their own, and a command that touches more than 40 records of one kind records one `bulk` entry (count, first ids and an ids digest). Approvals keep their exact approved terms.

Areas: `stock`, `revisions`, `time`, `quality`, `schedules`, `roles`, `integrations`, `commercial`, `records`, and `agent` (prepared by an agent).

- `GET /api/larder/audit` — owner and manager only. Filters: `domain`, `actor`, `source`, `kind`, `op`, `type` (a command or its prefix), `ref` (an entry's subject or any record it links to, which follows one record through every domain), `commandId`, `from`, `to`, `q` (text over reason, command, actor, subject and values); `limit` (default 100, at most 500) and `after` (a sequence number) page the list.
- `GET /api/larder/audit.json` and `/audit.csv` — the complete filtered export, with retention stated.
- There is no write door: `audit.*` commands are refused for every role including the owner, `DELETE` is refused, and the database aborts any update or delete of an audit row.

Minimising: a value is never logged when its key names a credential (secret, token, password, API key, authorization and the like) or a document body (content, base64, bytes, message, files); `label: value` text such as `password: …` and credential-shaped tokens are withheld wherever they appear; text over 240 characters or a large list is kept as a digest and length. Retention default: entries are kept for the life of the installation and nothing removes one. A time-limited retention or purge authority is not built and is open with ct.

## Approval policies and delegated authority (GOV-002, partial)

- `approval.policy` (owner only) `{category, thresholdUsd | thresholdPercent, signatures: 1 | 2, expiryMinutes?: 1..43200 (default 1440), enabled?, reason}` sets one policy per category. `spend` gates `po.approve` on the PO's USD exposure; `inventoryAdjustment` gates `count.approve` on the absolute USD value of the adjustment; `margin` (`thresholdPercent`, 0 to 100) is a floor on `so.confirm` and `so.changeApprove`: the order's margin, (revenue − standard cost) ÷ revenue over non-cancelled lines, below the floor needs the signatures, and an order with an item without a standard cost has an unknown margin, which never passes the floor; `quality` gates the USD value a release makes available on `quarantine.decide` (release), `quality.release`, `nonconformance.release` and `nonconformance.deviation.approve`. `schedule` and `ledger` are refused: schedule adoption waits for the CAP-007/MRP-004 ruling and no Larder door posts to a ledger yet.
- At or past the threshold, each door records a signature `{signerId, seat, onBehalfOf, subjectVersion, inputsDigest, terms, permitted, expiresAt}` in `approvalSignatures` and returns it (`remainingAtSigning`, `valueUsd` or `marginPercent`) until the stated number of different people have signed; the last signature performs the decision and spends them. Signers hold the door's own approving roles; the preparer, agents and viewers never sign; one person or one seat signs once.
- A signature counts only while the subject is at the signed version with the signed inputs (PO supplier, lines, prices, dates, exposure; count quantities, cost and unchanged stock at the location; order lines, prices and standard costs; held quantities, inspections and quarantined balances) and the same decision terms (quantity, lot, location, inspection or deviation), it has not expired, and its signer (or, for a deputy, the principal) still holds the authority in their current role. The state lists every signature with its `status`: `valid`, `invalidated`, `expired`, `withdrawn` (authority lost) or `used`.
- `so.changeApprove`: an amendment preview binds the exact records, so it cannot wait for a second signature. Below a two-signature margin floor it answers `APPROVAL_REQUIRED` (`details.marginPercent`) unless the owner approves it with an override; under a one-signature floor a manager approves it.
- `po.amend` `{poId, version, lines: [{lineId, quantity?, unitPrice?}], reason}` changes a draft PO (manager, buyer, agent); it bumps the version, so earlier signatures are invalidated.
- `approval.deputize` `{deputyId, validUntil (within 30 days), categories?, reason}` (anyone holding a category's authority, for the categories they hold) lets another active person (not an agent, viewer or operator) sign the principal's seat while the principal still holds the authority; `approval.revokeDeputy` `{delegationId, reason}` (principal or owner) ends it. A deputy never signs alongside their own principal.
- Owner override: any gated door with `override: {reason, accountableId}` completes a pending dual approval by the owner alone; `accountableId` must be an active owner or manager. Nobody else, and no agent, may override. The override is stored on the signature and the decision.

## Migration rehearsal and cutover (MOVE-007)

- `import.preview` accepts `currency: {code, rateToUsd, recordedOn, source}` for a non-USD source and returns `valuation`: `source` and `larder` totals, `differenceUsd` (to the cent), `matched` (true only at a zero difference), `exceptions` (`not-moved`, `unvalued`, `rounding`) with `reviewCount`, `excluded` rows, `lots` and dated `stockValues`. Moved-in items, opening lines and order lines keep `sourceCurrency`, the source amount and `conversionRate`. Commit re-checks the same valuation through the fingerprint.
- `cutover.plan {label, importIds}` and `cutover.rehearse {cutoverId, version, importIds?}` (manager, agent; a rehearsal maps the staged files again and writes nothing live) · `cutover.compare {cutoverId, version, day, source}` (manager, accounts, agent) with the source system's totals by name: `stockUnits` and `stockValueUsd` as of the day; `reservedUnits`, `activeBoms`, `openWorkOrders`, `wipValueUsd`, `capacityMinutes`, `openSalesOrders`, `openSalesValueUsd`, `openPurchaseOrders` and `openPurchaseValueUsd` on the day itself · `cutover.reconcile {cutoverId, version, importId, differenceUsd, note}` (owner, manager, accounts; never an agent) accepts exactly the current valuation difference · `cutover.approve {cutoverId, version, cutoverAt, openingTotalUsd, acceptDifferences, reason}` (owner only) answers `CUTOVER_BLOCKED` with its `blocking` reasons until every move-in is committed as rehearsed (the last two rehearsals identical), every valuation difference is accepted, the opening total is Larder's exactly and the last comparison's differing metrics are accepted by name · `cutover.route {cutoverId, version, channel, authority: 'larder' | 'source', reason}` and `cutover.cancel` (owner only).
- Channels: `sales-orders` (sales orders, order changes, sales reservations, shipments, returns), `purchase-orders` (purchase orders, receipts), `stock-ledger` (every stock movement) and `accounting-handoff` (handoff batches for the ledger). From the approved cutover time any command whose writes touch a channel routed to `source` answers `AUTHORITY` (`details.channels`) and nothing is saved. The guard reads what a command wrote, not its name, so doors added later are covered.

### Bounded automatic internal-booking grants

`schedule.grant.prepare` accepts `{id?,version?,eventTypes,machineIds,workOrderIds,maxDelayMinutes,maxDisplacementMinutes,expiresAt,reason}` from owner/manager/planner/agent. Events are `progress`, `ETA`, `breakdown`, `priority`; explicitly supply both scope arrays, with at least one named machine or job overall. All events, scope, whole-minute bounds and offset-bearing expiry are required, without defaults. Delay bounds a job’s later finish; displacement bounds its largest operation-start/finish shift. Bounds are 0–86400 minutes and application is confined to the saved planning window. Preparing a replacement immediately stops the previous version.

`schedule.grant.approve` accepts `{grantId,version,reason}` from an independent owner/manager/planner (owner exception). `schedule.grant.revoke` accepts the same shape from owner/manager, preparer or approver. Each human event rechecks the exact grant/protection version, expiry, live authorizer role/membership and named resource people in the same atomic write. An observed expiry, protection change or lost authorizer suspends the grant until freshly prepared and approved, including if the old role later returns. Scope/limit/conflict/new-lateness/new-unscheduled refusal leaves the entire reflow for review and all bookings unchanged.

Automation only replaces unprotected internal machine/person intervals while preserving resources, started work and dependency buffers. It changes none of the scenario assumptions, external dates, stock/reservations, calendar/overtime, maintenance, assignments, priority/rank/not-before, alternate resource choices, release/draft work or messages. Scenarios and agent proposals never apply automatically. The plan’s `autoApplication` and booking retain grant/version, accountable approver, triggering command, before/after slots and displacement once across replay/restart. JSON/CSV include grants, versions/history and applications; every restored grant is a draft with its former approval retained as history, requiring new live approval. GOV-002 schedule thresholds/dual signatures/expiry ceilings, GOV-004 search/retention, OPS-001 job limits and AUTO-002 notifications remain obligations in those clauses.

## Costing and performance reports

Owner, manager and accounts read `/api/larder/costing/margins`, `/variances` and `/performance` (under the same costing prefix); append `.csv` for the exact filtered download, with nested source records in JSON cells. Money is USD with six-place arithmetic and half-away cent presentation. All margin groupings retain estimated, committed and recognized revenue, cost and margin; rounding to cents occurs per line before margin subtraction and group totals. A pre-confirmation charge belongs to the quote estimate; a later charge never changes the pinned quoted margin. Performance ratios include their denominator units, with operation OEE separate from final-job yield. Margin/variance filters are `orderId`, `customerId`, `channel`, `itemId` and (variance) `workOrderId`; performance filters are `from`, `to`, `site` (location id), `center`, `itemId`, `ownerId` with a maximum 61-day UTC window. GOV-001 scopes apply on every read; a restricted monetary input restricts its derived figure.

`costing.policy.prepare {standardLaborRate,machineRate,overheadRate,overtimeAfterHours,overtimeMultiplier,reason}` and `costing.policy.approve {policyId,version,reason}` pin an immutable policy to future releases. `costing.charge.prepare {workOrderId,amount,reference,evidence,reason}` and `.charge.approve {chargeId,version,reason}` record additional service expense. Never enter a service already capitalized in a subcontract input. Policies and charges are prepared by managers/accounts and require the owner to approve explicitly.

Under ct’s 23 October approval, the owner alone applies policy, service-charge, valuation, job-link and commercial-charge decisions, each showing the exact entry it changes; managers/accounts can prepare inert drafts and read their permitted reports. `costing.link {workOrderId,orderId,lineId,quantity,reason}` explicitly allocates matching job and sales-line quantities. `costing.orderCharge {orderId,lineId,kind,amount,refundable,evidence,reason}` records `discount`, `freight-revenue`, `freight-cost` or `fee`; `refundable` must be an explicit boolean. `costing.close {workOrderId,version,reason}` closes a released job and approves its correcting actual valuation in one owner-authorized atomic decision, refusing missing cost evidence or untraceable output. Existing physical closure remains available for legacy jobs, with later explicit valuation review. `costing.valuation.prepare {workOrderId,reason}` requires a closed job, complete costs and exact output lots; `.valuation.approve {valuationId,version,reason}` requires fresh stock/cost state and explicit owner approval. Per-lot rounding residuals conserve the exact approved value through partial issues, transfers, shipments, returns and reversals. It adds an immutable financial valuation and a once-only handoff correction, never changes physical movements or posts journals.

`reports.schedule {filters,consent:true,reason}` saves a daily in-app report with explicit consent from the native owner. Worker cron checks due reports every 15 minutes and records at most one immutable snapshot per UTC day under that owner’s still-live native session. It uses the same command pipeline, exact state version and atomic session and role fence as manual `reports.run {scheduleId,version}`. Each snapshot keeps its owner, time, generation mode, filters and report sources. Sign-out, expiry, session revocation, owner deactivation or owner change stops generation; a later sign-in requires a newly consented schedule. Development and review sessions support manual generation only. The owner cancels consent with `reports.cancel {scheduleId,version,reason}`. There is no HTTP cron endpoint and no external send. Native session references stay in private storage outside business records, audit and archives; restored schedules are paused and cannot run without fresh consent. COST-001’s financial authority and allocation rules are ct-approved: overtime is per entry, machine/overhead use active hours and the displayed good/scrap allocation is equal per unit. Cost-link and commercial-charge recordings are audited immutable entries; a reversal must be a new entry. Costing retains no payroll data beyond the rate used and posts no journals. COST-007 retains branded report documents and authorized external delivery; AUTO-002 retains notification delivery and its stop conditions.

A physical production close alone preserves the existing weighted-average withdrawal basis. Only an explicitly approved actual valuation selects the produced lot’s actual rate; earlier withdrawals stay recorded and their financial correction is shown separately.


## Grouped nesting (CAP-008, partial)

Use the existing command API. Owner, manager, planner and agent may prepare a
group with `nest.prepare`: `{materialItemId, reason, members: [{workOrderId,
version, sequence}]}`. Select two to fifty distinct released jobs before issue,
output or operation execution. Every pinned recipe must contain the material;
selected operations must agree on centers, selected center, setup family, tools
and skills. The group retains original job, demand, BOM and due-date identities.

`nest.import` takes `{groupId, version, file: {name, content}}`. Content is JSON
in this documented interchange format, not a vendor-specific adapter:

```json
{
  "format": "larder-nesting-v1",
  "source": {"itemId": "material-id", "locationId": "bin-id", "lotId": "lot-id", "quantity": "10"},
  "offcut": {"quantity": "2", "code": "recovered-sheet", "locationId": "bin-id"},
  "sharedSetupMinutes": "30",
  "jobs": [
    {"workOrderId": "first-job", "quantity": "1", "materialQuantity": "3", "goodMaterialQuantity": "2.5", "setupMinutes": "15"},
    {"workOrderId": "second-job", "quantity": "1", "materialQuantity": "5", "goodMaterialQuantity": "4", "setupMinutes": "15"}
  ]
}
```

All quantities are decimal strings in the material's base unit. Output quantity
uses each original job's base unit. Every job is listed exactly once; allocated
consumption plus offcut equals input exactly. Good material cannot exceed
consumption, and setup shares sum exactly. Yield is good material divided by
input; scrap is consumption less good material. Weighted-average source cost
prices material shares; the final job receives the six-place rounding residue
so input value equals allocated consumption plus offcut value. Negative residue
is refused. The original UTF-8 file is retained with a digest. Import posts no
movement, reservation, output, booking or promise change.

The owner alone calls `nest.approve` with `{groupId, version, reason}` under the
ct-approved exact physical authority. Any intervening business write or
changed UTC day requires a fresh group and import. The same atomic command
issues the reviewed material to original jobs through `wo.issue`, recovers the
offcut into a new lot with its source dates and value, and records approval and
movement links. A stock, reservation, quality, recall or allocation refusal
posts nothing. Serial-configured, expired and inspection-required or certificate-controlled material is refused. Identical command replay
returns the first result. Each original job keeps its own operation, output,
quality and closing gates; its recorded nesting share follows its eventual lot
trace. Shared setup minutes are observations and never alter finite bookings.

`nest.cancel` takes `{groupId, version, reason}` for an open draft or review;
only its preparer or the owner may cancel it.
All group records, original files, physical links and recorded outcomes survive
the complete JSON and CSV archive and restore; restore never executes them.
Location scope and cost restrictions apply to preparation, results and replay.
Grouping and import page controls ship. Combined finite setup booking, broader batch
stages and quality-controlled source recovery remain CAP-008 gaps. CONN-012 will supply
vendor-specific nesting imports and inherits these review and posting guards.

## Reviewed sales reservation splits (DEMAND-005)

`so.allocationPreview` accepts `{receiptId, itemId, locationId, reason, allocations: [{orderId, lineId, quantity}]}`. Each quantity is the target reservation at that location, including zero to release it. Every named line must be open and confirmed. The preview records both promises, prior and target totals, displaced quantities, ranks, reserved sales values and estimated margins from retained quote costs. Unknown costs stay unknown. It changes no reservation or promise.

`so.allocationApprove` accepts `{previewId, version, reason}`. Approval is atomic and binds the complete business version and UTC day. Targets cannot exceed usable accepted receipt stock, line demand or stock free after the explicitly reviewed releases. All unnamed reservations and picked quantities stay protected. The command changes no movement or customer date. Allocation reviews and approvals survive restart, JSON and CSV export and inert archive restore.

Under ct approval of 23 October 2026, both commands are owner-only, including command replay. A customer date change still uses `so.changePreview` and `so.changeApprove` with recorded customer attestation. That preview includes `impact.changedPromiseCount` (affected customer orders) and `impact.promiseChanges` (each changed line with previous and proposed delivery dates). Each accepted receipt on its purchase-order page offers the owner a two-line split form, the exact review and a reasoned approval; changed business records or UTC day require a fresh review. The existing qualified-alternate API and browser journeys now assert customer-linked outage recovery with sufficient alternate capacity, zero changed promises and unchanged order dates.

Archive restore accepts only an explicit `USD` functional-currency declaration; the owner can first prepare a recorded-rate AUD conversion through the migration route below. Missing, malformed or non-USD declarations answer `CURRENCY_MIGRATION` before any write. This prevents silent relabelling or implicit conversion during restore. Original currencies of source-history evidence remain separate from functional money.


### Optional finite nesting comparison

`nest.import` also accepts `capacity: {asOf, days}` outside the original file.
This is an isolated comparison for compatible single-operation pending jobs,
using the latest material-ready and planned-start dates of all members. It
reserves no live capacity. One virtual operation includes the imported shared
setup exactly once and the full pinned run effort of every original job, on
one named machine slot and one live qualified person. The preview keeps the
original job, revision, demand and due-date links in `review.capacity.allocations`.
It shows separate and combined plans, displacement, explicit infeasibility and
zero changed customer promises. Missing joint capacity yields `feasible: false`.
Existing bookings or protected grouped operations refuse the comparison rather
than releasing them. Broader routings, fractional setup minutes and scoped
whole-shop comparisons are refused. The optional preview, like the original
file and allocations, survives archive restore as inert review evidence.
`bookingEnabled` is always false; the existing ct ruling grants no shared
setup-booking authority. A later booking door must revalidate live people,
calendars, protections and business inputs under its own recorded authority.

USD archive export and restore refuse a conflicting root `currency` or
`functionalCurrency` on native items, sales orders, purchase orders, work
orders, labor rates, job charges, cost links, cost valuations, margin charges
and handoffs before any write or new USD export label. Original source-history
currencies and supplier-quote currencies remain independent and unchanged.
The explicit migration below preserves original AUD amounts alongside the converted functional money; record currency declarations cover native archive amounts.

## Explicit multi-output batches (FLOOR-006)

`batch.plan` takes `{workOrderId, version, reason, outputs}` on a draft work order.
Each output names `itemId`, `kind` (co-product, by-product or recoverable-scrap),
`quantity`, a new `lot` code and `locationId`. The primary item quantity equals
the work order quantity. Plan before release; a planned batch cannot split or merge.

After all component issues and operations, `batch.review` takes the current work
version, `policy`, `reason` and every output with actual `quantity`, allocated
USD `value` and exact `allocations: [{movementId, quantity}]`. The review changes
no stock. Every issued component is consumed exactly once across those outputs.
Total values equal the actual job cost and each unit cost must be exact to six
places. Missing cost evidence refuses review. The work-order page supplies these
controls in the existing Co-products and by-products card.

`batch.post` takes `{workOrderId, version, reviewId, reason}`. Only the owner
approves that exact allocation policy and explicitly posts output and closes
the batch atomically; changed business evidence requires a fresh review. Every
output starts in quarantine. `batch.release` takes the work version, `lotId`,
reason and evidence files; only the owner releases an exact output after current
quality, certificate, date and hold checks. A required inspection records against
the exact output with `quality.inspect` and `lotId`; each output section offers
the existing measurement, result-history and independent hold-release controls. Generic quarantine release cannot
bypass batch release. Managers and accounts prepare inert plans and reviews,
agents cannot use batch commands. Location and cost restrictions apply to replay
and new requests. JSON and CSV archives retain all records; restore posts nothing.
The owner-only batch allocation default awaits ct approval; FLOOR-006 is partial.

Batch allocation reviews use `batch.plan` and `batch.review` for owner, manager, accounts or planner preparation; `batch.post` and `batch.release` remain owner-only. Each six-place rounding residue, bounded by USD 0.000001 per output, is assigned to the final planned output and retained with the rule in the review and valuation. Larger differences and inexact unit costs are refused. Any intervening business write permanently voids a pending review; changing page review inputs removes approval until a fresh review. A void draft cannot be revived by restoring earlier inputs.

## Cited variance explanations (AGENT-003, partial)

The native owner uses the ordinary command transport. `variance.prepare` takes
`{orderId, provider, usdCap, tokenCap, reason}`. `provider` is `anthropic` or
`openrouter`; each review declares the exact destination. Private Worker bindings
supply `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`, never the browser or archive.
The review retains only cited numeric records and identifiers, source counts,
missing evidence and pinned job estimates. Names, customer identities, free text
and evidence files are excluded from the request. The routed destination is
Anthropic Haiku 5.5 only, with fallback disabled, data collection denied and
maximum input and output prices. Each run is bounded by the selected total token
and USD caps, no more than 44000 tokens and USD 0.02.

`variance.consent` takes `{analysisId, version, digest, destination,
acceptProviderRetention:true, reason}` from that exact review. It acknowledges
the selected provider's retention terms. `variance.run` takes
`{analysisId, version, reason}` and requires the consenting owner. It durably
reserves one attempt before sending; repeats, concurrent commands and restarts
never send it twice. A changed source needs a new review. Failed or uncertain
attempts stay visible. `variance.revoke` with the same identity, version and a
reason revokes an unsent review. Every operation is owner-only under the adopted
default pending ct approval.

`GET /api/larder/costing/explanations/<analysisId>/sources/<encoded-source-key>`
opens a cited minimized source snapshot for the owner. All numeric measures use
the existing cost reports; model hypotheses cite their fact IDs and never
establish causality or change a standard. `variance.followup` takes
`{analysisId, version, proposalIndex, changeId, workOrderId, reason}` after a human
has approved a later engineering revision and completed its next job. It retains
the comparison and refuses to claim unchanged history if old cost sources changed.
The business archive includes the review, model result, usage and decisions
without provider credentials. Restore revokes unsent consent and performs no send.

## Computed recovery options (AGENT-001)

Within the explicit schedule-protection window, relevant recorded demand,
material, progress, breakdown and calendar commands retain one review per event.
Each event recomputes material readiness from the current shared allocation.
`schedulePlans[].recoveryOptions` contains up to two feasible qualified alternate
machine plans, with source identities and counts, named machine and person
intervals, sequence, displacement, unchanged linked ship dates, public planning
USD estimates, zero new purchasing cash and explicit uncertainty. Search is
bounded and never claims that an unsearched recovery is impossible.

`schedule.adopt` additionally accepts `optionId` alongside `planId`, `version`
and `reason`. It adopts only the exact retained option under existing independent
CAP-005 authority and GOV-009 signatures. Signatures for different options cannot
combine. All current inputs and live people are rechecked before atomic booking.
A new demand, stock or calendar trigger remains a human review even when an
automatic grant exists; alternate machine choices always require human approval.
Customer promise amendments and spending retain their separate sales and buyer
authorities. JSON and CSV archives retain every option, selection and booking;
restore executes nothing.


### Exact batch variance and pick waves

`batch.review` accepts each output's `standardValue` as an expected USD value at its actual yield. With standards supplied for every output, the server computes standard cost, signed variance and proportional actual values. Values round down to exact six-place unit-cost increments; the final planned output receives the remaining residue, bounded to USD 0.000001 per output. Zero total standards, excess residue or an inexact final unit cost refuse. Fixed reviewed `value` allocation remains available when no standard values are supplied. `batch.post` and `batch.release` retain separate explicit owner decisions, current review and evidenced quality gates.

The owner creates a named site with `site.save {name}`. A location may name its `siteId`, unique `binCode` and nonnegative integer `binSequence`. An assigned bin cannot move to another site. `member.scope` accepts `sites: [siteId]` or null; the current bins in those sites intersect any explicit location scope, including bins added after the scope was saved.

Managers and warehouse staff call `wave.prepare {reason, orders: [{orderId, lines: [{lineId, locationId, quantity, lotId?, serials?}]}]}` for two to thirty distinct orders. It reviews current reservations through the ordinary pick rules, retaining one site-grouped and bin-sequenced list without physical movement or shipment creation. `wave.pick {waveId, version, reason}` confirms the collected quantities sorted to each order and creates the separate order picks atomically. Physical stock and reservations remain until shipment; open picks prevent re-picking those quantities. A business change expires the review. Both doors and replay use current site scope, role and native session authority.

## Retention and contact erasure (GOV-005, partial)

The native owner calls `GET /api/larder/retention/contact?partyId=<id>` to review
eligible fields, legal holds, linked sales and purchase records, retained
categories and search, cache, archive and provider outcomes. The preview is
read-only and carries the exact business `version`.

`retention.hold {kind, recordId, reason}` holds a party, certificate, receipt,
source-history record or handoff. Every business command refuses a change or
deletion of that held record. `retention.release {holdId, version, reason}` is a
separate audited owner decision; a hold never expires automatically.

`erasure.contact {partyId, reviewedVersion, consent: true, reason}` replaces only
the contact's name and email, replaces cached human contact labels in command outcomes
and the audit through the existing audit-erasure mechanism, and retains record
IDs, quantities, prices, movements, documents and their bytes. Personal values in
the decision reason and its audit reason are replaced regardless of capitalization. A stale preview,
a held contact or missing explicit consent refuses the whole transaction. Names
shorter than three characters require a separate field-specific audit review and
are refused by this limited door.
Replaying the same command returns the recorded result. Future JSON and CSV
business archives retain the anonymized contact, hold and decision; restore
preserves them without executing erasure again. Earlier downloaded archives,
other record text and uncontrolled client copies are explicitly retained or
outside control. No provider deletion request is made.

`retention.configure {category, minimumDays, version?, reason}` records owner-only US
minimum preservation floors for contacts, production and financial trace, or documents.
The period is 0 to 36500 whole days from contact creation; a contact review reports
its eligibility timestamp and commands refuse early erasure. An elapsed floor never
executes anything. Production trace, financial evidence and all document bytes stay
indefinitely preserved regardless of their recorded minimum floor. No statutory period,
expiry, purge schedule or legal compliance is supplied by this setting.

Holds can now preserve any native business-record category except retention decisions,
hold metadata, audit erasure requests and live authority metadata. A legal hold
cannot freeze role changes, credential revocation or delegated authority revocation. Native identity tables and attachment bytes
are not independently editable business records; document bytes remain retained.

The owner reviews `GET /api/larder/retention/operator?operatorId=<id>` and submits
`erasure.operator {operatorId, operatorVersion, reviewedVersion, consent: true, reason}`.
Only an inactive identity is eligible, and any active legal hold conservatively refuses
this wider subject decision. The atomic write checks the current native identity version
and status again, replaces its display name and email, invalidates its old version,
replaces cached human labels and reuses the append-only audit replacement boundary.
Movement IDs, quantities, costs, original immutable text and document bytes are unchanged.
Future archives use the anonymized name even for historical people; restore is inert.
Native security records and external identity values remain retained and are explicitly
reported; this is not complete identity erasure. This limited display-label replacement does not establish complete lawful former-operator erasure.

Settings, under Retention and erasure, exposes retention periods, hold creation and explicit release,
current-subject review, retained categories, controlled-copy outcomes and exact consent.
The review is invalidated when business state changes. Provider outcomes explicitly say
not attempted; consent sends no outbound request. Eligible document, message and model
context erasure and complete controlled-copy deletion remain unimplemented. GOV-005
remains partial under the approved indefinite-document policy.

## Versioned integration reads (CONN-014, partial)

Native-session `GET /api/larder/v1/catalog`, `/api/larder/v1/orders`,
`/api/larder/v1/operations` and `/api/larder/v1/trace` return
`{apiVersion: "1", version, data, nextCursor}`. `limit` is 1 to 100 (default 50).
Follow the opaque `cursor` with URL encoding; the next cursor is null at the end.
Records are ordered by ID and use the app's current role, location and cost
filters. A changed business version refuses the next page with `STALE`; restart
at the first page. Invalid cursors and bounds return the ordinary `INPUT` refusal.

The owner can issue `integration.key.issue {name, resources, minutes, consent:
true}` through the native command door. Resources are catalog, orders,
operations and trace; expiry is 1 to 60 minutes. The response returns
`serviceCredential` once. Save it privately: command replay returns metadata
only. Send it as an Authorization Bearer credential on the permitted versioned
GET routes. Every write, broader read, archive and state request is refused.
All credential reads redact costs even when the issuing owner can see them.

`integration.key.revoke {keyId, version, reason}` revokes immediately. Signing
out, session expiry or identity deactivation also stops access. Restart preserves
the bounded grant while its native session remains live. Credential material is
hashed in a separate table and excluded from audit, command outcomes and business
archives; restored grant metadata is revoked and grants no authority.

CT approves the interim policy with riders: owner-only explicit issuance for a named integration or export,
read-only resource scopes, restricted costs and a live native issuing session.
Scoped service writes, other resource families, outbound signed events with
stable identities and durable retries, provider-confirmed follow-up closure and
the draft-only MCP server remain unimplemented. CONN-014 remains partial.

CONN-015 inherits resource scope and revocation at its own connection door; this
read-only slice does not prove its future Zapier draft journey.


## Supplier accounting preparation

All commands below use `poId`, the current PO `version` and a required `reason`.
Every command uses the native session, atomic role and location scope guards,
append-only audit and command replay. Records are nested on the original PO and
included in the existing complete business archive. No command sends a document
or calls a ledger provider. Financial decisions below use an adopted owner-only
default awaiting ct approval; the contract gaps remain partial.

- `po.bill.capture` (accounts) takes `reference`, explicit `currency`, `lines`
  containing `lineId`, `quantity`, `unitPrice`, optional `freight` and `tax`, and
  `evidence`. Supplier invoice references are unique for that supplier.
- `po.bill.resolve` (independent accounts, owner exception) takes `billId` and
  `evidence`, retaining current accepted receipt and prior approved bill quantities.
  Resolve again if another PO change invalidates that decision.
- `po.bill.approve` (owner) takes `billId`; it approves only the resolved version,
  refusing cross-currency approval without a connected ledger conversion. Billing
  quantity states are recorded on the PO; payment stays `not connected`.
- `po.claim.open` (warehouse or manager) takes `receiptId`, original `movementId`,
  `quantity`, `purpose` (`rejected` or `excess`), `supplierRma`, `dueDate`, `evidence`.
  The initiator owns the claim. Claims never exceed that original receipt quantity.
- `po.claim.ship` (owner) takes `claimId`, `quantity`, `stockStatus`, `reference`,
  `evidence`. Rejected units leave quarantine only. Reserved stock, recall and
  nonconformance protections remain enforced. Dispatch is recorded locally.
- `po.claim.replace` (owner) takes `claimId`, `quantity`, `lot`, `reference`,
  `evidence`; replacement is quarantined and linked to the original receipt. For a
  serialized item `lot` names one new unique serial and `quantity` is one.
- `po.claim.credit` (owner) takes `claimId`, `quantity`, `billId`, `amount`,
  `reference`, `evidence`. Credit must match an approved original bill and the
  original receipt cost exactly. Replacement plus credit cannot exceed dispatch.
- `po.claim.close` (owner) takes `claimId`, requiring full dispatch and settlement,
  and matching accountant acknowledgements for every credit. This acknowledges
  recorded ledger references without claiming provider verification.
- `po.landed.prepare` (accounts) takes `kind` (`freight`, `duty`, `insurance`,
  `handling`), `policy` (`quantity`, `value`, `weight`), signed `amount`, `reference`,
  `evidence`, `sources` containing exact receipt `movementId` and a positive
  `weight` for that policy. Negative corrections also name approved `correctsId`.
  Allocation conserves the six-place amount across stock, open WIP and direct COGS;
  completed production or unsupported return attribution refuses with `LANDED_TRACE`.
- `po.landed.approve` (owner) takes `chargeId`, requiring unchanged state since
  preparation. This prepares correction lines without applying valuation changes.

Approved credits and landed charges enter the existing accountant handoff once.
Each line retains `purchasingCorrectionIds` and `sourceMovementIds`; quantities
are zero. Credits correct payables, while dispatch movements account for physical
stock. Landed lines label their destination as stock, WIP or COGS. The CSV and
acknowledgement door retain exact amounts and ledger references.


## Recorded material WIP

`GET /api/larder/costing/wip?from=2026-02-01&to=2026-02-28` and
`GET /api/larder/costing/wip.csv?from=2026-02-01&to=2026-02-28` require a live
owner, manager or accounts session. Both real calendar dates are required and
inclusive in UTC. Optional `workOrderId` selects one document. Location and cost
restrictions apply before results and CSV are returned. This read writes nothing.

Rows retain opening, additions, output transfers, scrap and closing material
values, transaction IDs and aging from the first recorded addition. Transactions
name their original movement IDs. Exact output-batch allocations reduce material
WIP; split and merge responsibility transfers conserve the total. Repair and
received owned subcontract postings retain their recorded input, labor or service,
output and scrap values; unconsumed vendor custody stays inventory and customer
property is excluded from owned WIP. Legacy output without exact allocations is
listed in `missing`, never proportionally guessed.

This is a recorded-material bridge, not complete actual WIP: production labor,
overhead, later valuations, operation allocation, screens and external control
account reconciliation remain COST-002 gaps. The response labels that basis and
its external state as not connected and not reconciled. No journals are posted.

## Costed quote preparation

`so.review` prepares terms on an unconfirmed order (owner, manager or sales,
with unrestricted commercial and location access). Send `orderId`, `version`,
`currency` (USD or CAD), `validUntil`, `paymentTerms`, `discountPercent`,
`freight` and each existing line exactly once as `{lineId, unitPrice, breaks?}`.
A break is `{minimum, unitPrice}`; the greatest qualifying minimum wins. Prices
and freight use customer currency. CAD requires positive `usdRate` (USD per one
CAD), `rateDate` and `rateReference`. Optional `laborCostRate`, `machineCostRate`
and `overheadCostRate` are explicit USD quote tariffs per routing hour, never
employment wages. Missing estimates stay unknown.

Optional `asOf` and `days` select a current or future planning window of 3 to 30
days. The bounded search checks up to seven not-before days and retains at most
three distinct full-batch dates. Ordinary made-item lines only are supported for
finite options. Missing materials, upstream-work supply, overdue purchase supply,
uncertain dated stock, missing skills, maintenance and displacement keep a date
unoffered. Expected receipts still require physical receipt and quality release.

`quoteReview` retains totals, costs, margins, material sources and exact named
machine and person intervals. Its `inputVersion` identifies its business inputs;
any later write requires fresh preparation. It has no acceptance authority and
changes no price on the original USD order. Confirmation refuses while a review
is attached. `so.reviewClear` (`orderId`, `version`, `reason`) retains review
history and reopens the original USD quote without applying reviewed terms.
Native archive and empty restore preserve the review as inert history. Scoped
members cannot prepare or replay reviews; location-scoped state omits them.

Explicit review disposition: editing an existing quote through `so.quote` refuses while a current costed review is attached, even when the edit includes a reason. Use `so.reviewClear` first with the exact current order version and a nonblank reason. Discard retains the complete review with disposition actor, time, reason, order version and review input version. It leaves original USD lines unchanged and creates no reservation or booking. A stale version, missing review, agent or restricted commercial scope refuses discard. Refreshing preparation retains the earlier review as history and keeps the confirmation block. A later edit or confirmation is a separate current-version command under existing authority and margin policy.


Legal holds preserve saved follow-up rows during automatic observation; reads still
show the current overdue condition. Explicit follow-up edits remain refused until
owner release. A hold on an unsent variance analysis never prevents owner withdrawal
of model-disclosure consent. Revocation preserves sources, destination and prior
consent evidence, remains audited, and authorizes no model call or erasure.

CT retains explicit native-owner consent to the exact current contact-erasure review, indefinite preservation of production and financial trace records and documents, and explicit audited owner release of a current legal hold without erasure. Credential replacement, credential revocation and link expiry grant no erasure authority and perform no deletion. Operational staff retain document access under their current native roles. Configurable lawful retention and complete eligible erasure remain required. This ruling adopts no Mallet credential or customer-media policy and accepts no completion.

Gap — GOV-005: configurable US retention periods; lawful subject erasure, including former-operator live anonymization and eligible document, message and model-context erasure; complete legal-hold lifecycle coverage; controlled search, cache and provider deletion outcomes; and the page journey. Actual provider deletion and legal sufficiency of retention remain unestablished.

## US business identity

The owner opens Settings from the account menu. `business.save` takes the current
profile `version` (0 before first save), `legalName`, `einReference`,
`billingAddress` and `shippingAddress` (each `street`, `city`, two-letter US
`state`, `postalCode`, `country: US`), `timeZone` (US IANA identifier),
`workingWeek` (distinct weekday numbers, Sunday 0), and `fiscalYearStart`
(recurring `MM-DD`). Functional currency defaults to USD; another currency is
refused, never used to relabel history. The business calendar describes the
business; existing production calendar definitions and recorded dates stay intact.
The command checks owner authority before replay and again at atomic commit,
refuses stale versions, and records audit history. Only the owner sees the
profile in ordinary state reads; existing authorized business archive access
retains the profile. This is an identity reference, not tax validation.

Customer and supplier `party.save` uses separate `ein` and legacy `abn` fields.
Existing Australian and imported tax identities are retained without reclassification.
An omitted field does not reinterpret an ABN as an EIN.


### Versioned AUD archive migration

`POST /api/larder/archive/migrate-aud` is a native-owner-only, same-origin
preparation door. It writes nothing and makes no external request. Send
`{archive, migration}` with the original checksummed `larder-archive-v1` archive
explicitly declaring AUD. Migration fields are `version: 1`, `consent: true`,
`sourceChecksum`, positive decimal `rateToUsd` (USD per AUD), `recordedOn`,
`source` and `reason`. Missing currencies, conflicting native declarations,
changed checksums, unreviewed fields and unsupported versions are refused.

Legacy core record shapes have built-in amount definitions. Other implemented
collections require explicit `declarations`: one entry for every numeric field,
including numeric elements of arrays, except immutable identifiers and versions.
Each entry has an exact `path` from the archive root, `type: amount` and
`currency: AUD`, or `type: quantity` with a reason for leaving it unchanged.
For example, `['records','costPolicies',0,'standardLaborRate']` is money;
`['records','costPolicies',0,'overtimeAfterHours']` is an unchanged time quantity.
Money cannot be excluded as a quantity; physical quantities, percentages and
operational factors cannot be converted as money. Duplicate, missing and unused
declarations are refused. Source-history records and original evidence files
already carry independent original currencies and remain unchanged.

The response is a USD archive for the existing empty-installation restore door.
Review its `currencyMigration` before restoring: the source checksum, owner and
time, recorded rate and basis, original record currencies, per-field original
AUD and converted USD amounts, per-field totals, original stock quantities and
rates, aggregate expected USD stock value, actual converted stock value and
explicit rounding difference. Conversion uses bigint fixed-point arithmetic,
rounding half away from zero to six places. Accountant cent fields are derived
from the converted full-precision amount and rounded to two places; their
original AUD cent values remain in the receipt. Rates and amounts outside the exact
supported range are refused. A zero rounding difference is reported only when
it is zero. This is a local recording, not ledger, provider or tax confirmation.

Restore validates the receipt's arithmetic and totals and their link to the
original converted records and immutable movements before its guarded batch.
Later native record revisions remain portable without rewriting that receipt.
Original command outcomes retain their AUD currency, identified by the receipt's
`originalCommandIds` and `originalCommandsCurrency`; replay is refused even if
the original owner identity exists in the destination. New native commands use
USD. The receipt is retained in JSON and lossless CSV and survives subsequent
restore. It contains monetary originals and identifiers, without another full
copy of personal data. The complete source archive stays with the owner.

Contract status and acceptance projection: run
`node src/base/contract-docs.mjs write`, then
`node src/base/contract-docs.mjs check`. CONTRACT.md remains the acceptance and
status source; the shared generator updates ACCEPTANCE.md, docs/CLAIMS.md and
the canonical status counts together.

### Warehouse transit, bin rules and property

`bin.rule` is owner-controlled configuration in Settings. Supply `locationId`
(a named site bin), `itemId`, `sourceLocationId`, decimal-string `minimum`,
`target`, `capacity`, optional exact `lotId` and `reason`. Updating the same
item and bin requires the current rule `version`; prior definitions remain in
its history. Capacity is per item in base units and includes quarantined and
third-party property. Minimum is below target, which cannot exceed capacity.

Managers and warehouse members use these commands with their current site
scope, including every named source and destination. Agents cannot post them.

- `transit.dispatch`: `itemId`, `fromLocationId`, `toLocationId`, `quantity`,
  optional `unit` and `lotId`, and `reason`. Dispatch withdraws only released,
  usable, unreserved owned stock and retains exact lot quantities and costs.
  Its transfer stays `in transit` and cannot be reserved, issued or shipped.
- `transit.receive`: `transferId`, current `version`, `reason`. Explicit receipt
  posts the retained sources once at the recorded destination, rechecking its
  current capacity and lot rule and the lot's current quality and date gates.
  An outstanding transit cannot be reversed; receive it before a compensating
  reversal. Corrections must reverse the complete warehouse transfer, preserving
  quantity and value across both locations. No automatic receipt or provider
  confirmation is claimed.
- `putaway.move`: the dispatch payload, with a configured destination bin rule.
  Quality, dates, exact lot restrictions, capacity and site permissions apply.
- `bin.replenish`: the same payload, using the rule's source, only below its
  minimum, for exactly the quantity needed to reach its target. The same
  putaway refusals apply. Existing immediate transfers also enforce bin limits.
- `custody.receive`: `itemId`, `locationId`, `ownerId` (the customer or supplier
  contact), `ownership` (`customer-owned` or `consigned`), a new `lot` reference,
  `quantity`, optional `unit`, `reason` and `evidence` attachment. This records
  separate property, with no owned stock movement or automatic title transfer.
- `custody.move`: `lotId`, `fromLocationId`, `toLocationId`, `quantity`, optional
  `unit` and `reason`. Append-only entries move that owner's exact property,
  checking source quantity, destination capacity, lot and quality, and scope.

State includes `custodyBalances` and `ownershipBalances`, with owned stock on
site, owned stock in transit, total owned stock, customer property and consigned
property kept separate. Property never enters owned availability or valuation.
Derived balances that include locations outside a member's reach read
`restricted (includes other locations)` rather than displaying a partial total.
Rules, transfers, custody entries and original evidence travel in the complete
JSON and CSV business archive. Restore retains them as records, never repeating
a dispatch, receipt, movement or external action.


### Native member scope classification

Only the owner can call `member.scope`. Send `operatorId`, optional `sites`,
`locations`, `costsRestricted` and `reason`; classification labels, confirmations
and other extra fields are refused. Existing role and scope authorization still
applies. Omitted lists mean unrestricted and an omitted cost restriction means
false, as in the existing Settings form.

The returned role and owner state retain the latest `scopeClassification`;
the append-only audit and recorded command outcomes retain prior decisions.
It records `classes: ["access"]`, the applied effect, exact target and actor IDs,
native operator versions and status, the business state version, member and
custom-role versions, and the member and effective restrictions before and after.
These are historical facts at that version, never a new grant or current-session
credential. No personal contact labels or cost amounts are copied into them.

`access.people` counts the one active person whose effective authority changes,
or zero when custom-role limits mask the edit or the person is inactive.
`direction` is widening, narrowing, mixed or unchanged; widening and narrowing
remain separate booleans. Current added and removed location IDs accompany them.
Effective site reach also includes future bins: `effective.futureSites` is null
for unrestricted future sites, an exact site list, or empty when an explicit
member or custom-role location list prevents future reach. Restricting future
reach can narrow access without removing a current bin. Cost and wage visibility
is compared after both member and custom-role restrictions apply.

The atomic command retries against changed business inputs and fences the exact
native target version and status. Replaying a command returns its historical
outcome once, without applying its old restrictions again. Existing scope and
cost redaction still apply; non-owners do not receive scope facts from state,
and restricted members cannot read the audit or business archive. Business
archives retain recorded classification outcomes and unmapped role history as
inert evidence; restoring history executes no scope command or remote action.
This door does not qualify agent execution or provider classifications.
