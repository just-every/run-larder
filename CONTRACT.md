# Larder target product contract

Larder is the manufacturing ERP/MRP for a US small discrete manufacturer or maker switching from Katana, MRPeasy, Fishbowl Manufacturing, Odoo Manufacturing, Fulcrum or DOSS. It turns demand into feasible material and capacity plans, executes shop-floor work, traces lots and quality, costs actual production, ships orders and reconciles connected books.

## Product target

| | |
| --- | --- |
| Category | Manufacturing ERP / MRP for small manufacturers and makers |
| Incumbents a buyer switches from | Katana, MRPeasy, Fishbowl Manufacturing, Odoo Manufacturing |
| Up-and-comers it must also beat | Fulcrum, DOSS |
| First buyer | A US owner or operations manager of a 5–50-person discrete manufacturer/maker, operating in USD and a declared US time zone, with shop-floor, warehouse, purchasing and accounts staff; QuickBooks Online or Xero remains the authoritative external ledger. |

The primary journey: bring the workshop’s records across, quote and confirm real demand, plan material and qualified capacity, buy and receive usable lots, execute pinned work, ship and reconcile actual costs with the books.

## How to read this contract

- This follows the RER contract standard.
- Core, Agent surface and Later are reported separately.
- Done means every acceptance point is covered through the product’s doors.
- Field proof stays visible in its non-blocking register.
- ACCEPTANCE.md, docs/CLAIMS.md and summary counts are generated from this file.

## Door rules

- **D-1.** Start empty. No sample business records, synthetic provider outcomes or fallback balances enter a live installation.
- **D-2.** Stock truth. Signed append-only movements separate item, location, status and lot/serial; on-hand, reservations, quarantine, transit and expected supply stay distinct, with no negative positions or overselling and no silent reservation expiry.
- **D-3.** Exact quantities and money. Defined conversions and the documented fixed-point and rounding rules govern quantity/value conservation; used units keep their meaning.
- **D-4.** Pinned work and corrections. Released work keeps its BOM, routing, instructions and cost assumptions; corrections append linked compensations and downstream dependencies prevent unsafe reversal.
- **D-5.** Restricted manufacturing inputs. GOV-014 and GOV-015 apply to every manufacturing scenario, including mixed derived figures, downloads and queued jobs.
- **D-6.** Manufacturing evidence. Physical receipt, production, inspection, dispatch and destruction claims need named human/device evidence; a prediction never creates that physical evidence.
- **D-7.** Provider outcomes. A sandbox or official-schema fake proves the seed’s behavior; a production-connection claim additionally names permitted provider readback in the register. An acknowledgment is not a person’s receipt or physical movement.
- **D-8.** Reviewed manufacturing writes. Atomic decisions bind exact current business inputs and a recorded command identity; unchanged retries replay their result, changed content or stale input is refused without a partial effect.

## Shared duties (Base)

| Base duty | Duty | Delta clauses | Base journey |
| --- | --- | --- | --- |
| BASE-ACCESS-001 | Sign-in | GOV-003 | not run |
| BASE-ACCESS-002 | Sessions | HTTP-001 | not run |
| BASE-ACCESS-003 | Public endpoints | HTTP-001 | not run |
| BASE-ACCESS-004 | Server-side authorisation | GOV-001 | not run |
| BASE-INPUT-001 | Validation | ENG-007, FLOOR-008 | not run |
| BASE-INPUT-002 | HTML | LARDER-015, AGENT-005 | not run |
| BASE-INPUT-003 | Uploads | LARDER-002, LARDER-016, TRACE-007 | not run |
| BASE-SECRET-001 | No leakage | GOV-006 | not run |
| BASE-SECRET-002 | Startup | GOV-006 | not run |
| BASE-DATA-001 | Export and import | LARDER-019, LARDER-013, LARDER-020, LARDER-016, US-001, ENG-004, ENG-005, ENG-007, MRP-006, CAP-001, CAP-009, BUY-001, FLOOR-003, TRACE-001, TRACE-008, TRACE-006, TRACE-007, COST-002, COST-003, COST-006, COST-008, COST-007, CONN-003, CONN-011, CONN-012, CONN-014, MOVE-001, MOVE-002, MOVE-003, MOVE-004, MOVE-005, MOVE-006, MOVE-008, GOV-004, GOV-005, GOV-006, GOV-007, GOV-012, GOV-013, OPS-001 | not run |
| BASE-DATA-002 | Retention | GOV-005, GOV-013 | not run |
| BASE-DATA-003 | Erasure | GOV-005, GOV-013 | not run |
| BASE-DATA-004 | Outbound flows | CONN-001, CONN-002, AGENT-003 | not run |
| BASE-DATA-005 | Independence | OPEN-001 | not run |
| BASE-PUBLIC-001 | Privacy | HTTP-001 | not run |
| BASE-PUBLIC-002 | Origins | HTTP-001 | not run |
| BASE-PUBLIC-003 | Accessibility | MOB-001 | not run |
| BASE-OPS-001 | Health | HTTP-001 | not run |
| BASE-OPS-002 | Migrations | OPEN-001 | not run |
| BASE-OPS-003 | Idempotency | LARDER-005, CONN-014, AUTO-003 | not run |
| BASE-OPS-004 | Failure is visible | AUTO-001, AUTO-003, OPS-001 | not run |
| BASE-OPS-005 | Audit | GOV-004 | not run |
| BASE-ROLE-001 | Roles through every door | LARDER-001, LARDER-002, LARDER-003, LARDER-004, LARDER-005, LARDER-006, LARDER-007, LARDER-008, LARDER-009, LARDER-010, LARDER-011, LARDER-017, LARDER-018, LARDER-019, LARDER-012, LARDER-013, LARDER-020, LARDER-015, LARDER-016, US-001, US-002, US-003, ENG-001, ENG-002, ENG-003, ENG-004, ENG-005, ENG-006, ENG-007, ENG-008, DEMAND-001, DEMAND-002, DEMAND-003, DEMAND-004, DEMAND-005, DEMAND-006, DEMAND-007, DEMAND-008, MRP-001, MRP-006, MRP-002, MRP-007, MRP-003, MRP-004, MRP-005, CAP-001, CAP-002, CAP-003, CAP-004, CAP-005, CAP-006, CAP-007, CAP-008, CAP-009, BUY-001, BUY-002, BUY-003, BUY-004, BUY-005, BUY-006, BUY-007, BUY-008, BUY-009, FLOOR-001, FLOOR-002, FLOOR-003, FLOOR-004, FLOOR-005, FLOOR-006, FLOOR-007, FLOOR-008, FLOOR-009, FLOOR-010, TRACE-001, TRACE-002, TRACE-003, TRACE-004, TRACE-005, TRACE-008, TRACE-006, TRACE-007, STOCK-001, STOCK-002, STOCK-004, COST-001, COST-002, COST-003, COST-004, COST-005, COST-006, COST-008, COST-007, CONN-001, CONN-002, CONN-003, CONN-004, CONN-005, CONN-006, CONN-007, CONN-008, CONN-009, CONN-010, CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, AUTO-001, AUTO-002, AUTO-003, MOVE-001, MOVE-002, MOVE-003, MOVE-004, MOVE-005, MOVE-006, MOVE-007, MOVE-008, GOV-001, GOV-014, GOV-015, GOV-016, GOV-002, GOV-003, GOV-004, GOV-005, GOV-006, GOV-007, GOV-008, GOV-009, GOV-010, GOV-011, GOV-012, GOV-013, HTTP-001, MOB-001, MOB-002, OPS-001, LINK-001, LINK-002, SURFACE-007, AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009 | not run |
| BASE-AUDIT-001 | Searchable, durable audit | BUY-009, FLOOR-002, FLOOR-009, COST-005, CONN-014, MOVE-008, GOV-004, GOV-005, GOV-012, GOV-013 | not run |
| BASE-BACKUP-001 | Independent backup, restore and rollback | GOV-007 | not run |
| BASE-DATA-006 | Erasure respects retention and legal hold | GOV-005, GOV-013 | not run |
| BASE-SIGNIN-001 | Standards-based SSO and lifecycle | GOV-003 | not run |
| BASE-SIGNIN-002 | Native multi-factor authentication | GOV-003 | not run |
| BASE-INSTALL-001 | Free self-host and removal | OPEN-001 | not run |
| BASE-MAIL-001 | Truthful mail outcomes | BUY-007, AUTO-002 | not run |
| BASE-ACCESSIBILITY-001 | One accessibility bar | MOB-001 | not run |
| BASE-DOCS-001 | On-site docs from one contract | HTTP-001 | not run |
| BASE-AGENT-001 | One MCP door per seed | SURFACE-013 | not run |
| BASE-AGENT-002 | The seed's jobs are tools, through the UI's own actions | LARDER-015, SURFACE-001, AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009 | not run |
| BASE-AGENT-003 | Records are resources | SURFACE-004, SURFACE-007 | not run |
| BASE-AGENT-004 | Business identity and short-lived, audience-bound tokens | SURFACE-013 | not run |
| BASE-AGENT-005 | An agent acts as a person in a role, never more | SURFACE-005, AGENT-009 | not run |
| BASE-AGENT-006 | Every action declares its risk class | LARDER-015, CAP-007, BUY-008, FLOOR-002, GOV-002, GOV-006, GOV-008, GOV-009, GOV-010, GOV-011, SURFACE-001, SURFACE-002, SURFACE-003, SURFACE-004, SURFACE-005, SURFACE-006, SURFACE-010, AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009 | not run |
| BASE-AGENT-007 | The company's policy decides, at one chokepoint | LARDER-015, CAP-007, BUY-008, FLOOR-002, GOV-002, GOV-006, GOV-008, GOV-009, GOV-010, GOV-011, SURFACE-003, SURFACE-006, SURFACE-008, AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009 | not run |
| BASE-AGENT-008 | Truthful attribution | LARDER-015, FLOOR-002, GOV-002, GOV-008, GOV-009, GOV-010, GOV-011, SURFACE-008, AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009 | not run |
| BASE-AGENT-009 | Every agent action is audited with its class and decision | SURFACE-013 | not run |
| BASE-AGENT-010 | Agents can follow changes | SURFACE-009, SURFACE-011 | not run |
| BASE-AGENT-011 | Limits are policy, and Pause stops everything | SURFACE-010, SURFACE-012, AGENT-009 | not run |
| BASE-AGENT-012 | Writes are idempotent and conflict-safe | SURFACE-013 | not run |
| BASE-AGENT-013 | Manifest, docs and the conformance journey | SURFACE-001, SURFACE-012, SURFACE-013 | not run |

## Published clauses

- `LARDER-001`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-002`: *Tier:* Core · *Cites:* BASE-INPUT-003, BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-003`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-004`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-005`: *Tier:* Core · *Cites:* BASE-OPS-003, BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-006`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-007`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-008`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-009`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-010`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-011`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-017`: *Tier:* Core · *From:* LARDER-011 · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-018`: *Tier:* Core · *From:* LARDER-011 · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-019`: *Tier:* Core · *From:* LARDER-011 · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-012`: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-013`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-020`: *Tier:* Core · *From:* LARDER-013 · *Cites:* BASE-DATA-001, BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-015`: *Tier:* Core · *Cites:* BASE-INPUT-002, BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8
- `LARDER-016`: *Tier:* Core · *Cites:* BASE-INPUT-003, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

### Published operational foundation

#### LARDER-001 — Items, variants, units and parties

**Requirement.** A person creates items (made or bought), variants of a template with distinct attribute sets, exact unit conversions, customers and suppliers, and each party's own code for an item. Ambiguous conversions, duplicate SKUs or variants, ambiguous party codes and duplicate party names are refused.

**Acceptance.**
1. Through authenticated HTTP create two variants, exact unit conversions and supplier/customer codes; refuse duplicate SKUs, variants, ambiguous codes, undefined or rounding conversions, and edits to used units.

#### LARDER-002 — Opening stock

**Requirement.** A person records a counted opening position by location with its count date, valuation basis (supplier invoices, last purchase, standard cost or owner estimate), unit cost, optional lot and a required evidence file kept with its digest. Opening stock cannot be posted twice for an item and location.

**Acceptance.**
1. Record a counted, costed opening with its evidence attachment; download that attachment, reconcile the position, and refuse a second opening for the same item/location.

#### LARDER-003 — Versioned BOM and routing

**Requirement.** A person saves BOM revisions (components per finished unit, simple routing steps). Releasing work pins the active revision; a later revision does not change released work.

**Acceptance.**
1. Release work on revision 1, save revision 2 and release another job; the first job keeps revision 1 and its original components/routing.

#### LARDER-004 — Quote and confirm

**Requirement.** A person quotes an order and confirms it. For every item Larder shows on hand, reserved, quarantine, expected from purchase, expected from production, unreserved demand and available to promise, each kept separate.

**Acceptance.**
1. Quote and confirm an order through the order screen/API; inspect on-hand, reserved, quarantine, expected purchase/production and unreserved demand as separate figures.

#### LARDER-005 — Atomic reservation

**Requirement.** Confirming or reserving takes only available stock. Concurrent orders cannot both consume the same stock; a retried command returns its first outcome.

**Acceptance.**
1. Race six HTTP reservations for the same stock; total reservations never exceed stock, an identical command replays its first outcome and changed content under its identity is refused.

#### LARDER-006 — Shortages

**Requirement.** Larder computes shortages deterministically from confirmed orders and released work against free stock and open supply, with the date needed and the documents that need it, and drafts a purchase order (preferred supplier and price) or a work order with that required-by date and reason.

**Acceptance.**
1. Confirm an order exceeding free stock, draft its work shortage, release work, and draft the resulting purchased-component shortage; quantities, required dates and source documents agree.

#### LARDER-007 — Purchase approval

**Requirement.** A buyer or manager approves a draft purchase order , records the supplier's confirmation and reference, and revises the expected delivery with history.

**Acceptance.**
1. Draft and approve a PO, confirm supplier reference/date, then revise its ETA; read exact approved terms, cash exposure and every date revision.

#### LARDER-008 — Partial receipt, lots and quarantine

**Requirement.** A warehouse person receives part of a purchase order into a location, records supplier lots and either accepts or holds stock in quarantine; a recorded release or rejection decision moves it on. Over-receipt is refused.

**Acceptance.**
1. Part-receive a PO with supplier lot into quarantine; release part and reject part with reasons; refuse over-receipt and prevent held stock from reservation/picking.

#### LARDER-009 — Production

**Requirement.** Released work reserves its components; materials are issued as actually used (drawn across lots when no lot is named), good output and scrap are recorded against the pinned revision, and closing records material cost and variance.

**Acceptance.**
1. Release work, issue actual components across lots, record good output and scrap, and close; inspect pinned BOM, cost and material variance through the API and work-order screen.

#### LARDER-010 — Pick, pack and partial shipment

**Requirement.** A warehouse person picks only reserved stock, packs, and ships part of an order; shipping consumes those reservations, and the remaining commitments stay reserved or short.

**Acceptance.**
1. Reserve an order, pick only reserved stock, pack and partly ship; read remaining reservations/shortages and refuse an unreserved pick through HTTP.
2. Pack a shipment with its carton count, ship it, and read back that count, actual departure timestamp, carrier and tracking against the sales order through the API.

#### LARDER-011 — Customer returns

**Requirement.** Returns of shipped quantities come back to stock or quarantine, retaining the original shipment link.

**Acceptance.**
1. Receive a shipped return and inspect its stock or quarantine position and retained shipment history.

#### LARDER-017 — Free-stock transfers

**Requirement.** Transfers move only free stock between locations.

**Acceptance.**
1. Transfer free stock and refuse a transfer of stock committed to another order; reconcile both locations.

#### LARDER-018 — Independently approved stock counts

**Requirement.** A count adjustment needs a different person's approval, except that the owner may approve their own count. A changed counted position requires a fresh count.

**Acceptance.**
1. Approve another person’s count and inspect its adjustment; refuse a stale count.

#### LARDER-019 — Compensating corrections

**Requirement.** Reversals restore stock and order state through linked compensating movements, retaining the original. Downstream dependencies block reversal until resolved.

**Acceptance.**
1. Reverse a shipment by compensating movements and inspect the restored order and retained original; refuse a downstream-dependent reversal.

#### LARDER-012 — Accountant handoff

**Requirement.** A manager or accounts person prepares an immutable batch of not-yet-handed-off movements, valued: supplier receipts, customer shipments for invoice preparation (with the order price), production issue and output, adjustments, returns and corrections. The batch downloads as CSV. Acknowledgments record ledger references line by line; differing amounts show as mismatches until corrected; a later reversal appears in the next batch as a correction pointing to the original batch and line.

**Acceptance.**
1. Prepare/download valued handoff CSV, acknowledge ledger references with a mismatch, correct it, reverse an earlier shipment and see its linked correction in the next batch.

#### LARDER-013 — Operational exception queue

**Requirement.** One queue shows shortages, overdue purchases, quarantine, waiting decisions and proposals, unreconciled handoffs and rejected move-in rows. A manager records follow-up notes; AUTO-001 keeps a case visible while its source condition holds.

**Acceptance.**
1. Record a decision and follow-up note; verify that the ongoing exception remains visible and that its note survives restore.

#### LARDER-020 — Reconciled business archive

**Requirement.** The owner or manager exports the manufacturing archive with a checksum. An owner restores it into an empty installation atomically, reconciling every stock position.

**Acceptance.**
1. Export and restore the archive into an empty installation, compare every position and retained exception note, and refuse a damaged archive; round-trip an installation backup after migration/reset.

#### LARDER-015 — Exact-version operational proposals

**Requirement.** Agents prepare exact-version intake, grouped replenishment, item merge, work reschedule and ledger reconciliation proposals from cited business evidence. Intake preserves the inquiry as data and identifies missing quantities; every proposal shows impact, conflicts and cash exposure. Preparation is standard; consequential calls carry their computed money, commitment, external or destructive classes, and the company’s policy decides them. A person’s recorded decision names that person and binds exact inputs.

**Acceptance.**
1. Prepare each of the five proposal kinds; inspect incomplete or stale refusal, exact decisions and the documented independent native-person decision flow.
2. Under the held company policy, approve or decline the consequential calls; under the all-autonomous company policy, complete the same permitted jobs without waiting for a person.

#### LARDER-016 — Odoo kit

**Requirement.** A manager (or an agent, for preparation) previews Odoo import-compatible CSV exports of contacts, units, products and variants, locations, BOMs with routing, on-hand quantities and open sales and purchase orders. The preview is a dry run listing counts, rejected rows with file, line, External ID and reason, deliberate skips and unread columns. Committing publishes through Base's import kit, which journals the job and keeps every original file and digest. Undo before live use removes the whole batch; once later work depends on it, undo is refused and points at the dependency. The documented shape is in [MOVE-IN.md](MOVE-IN.md).

**Acceptance.**
1. Upload Odoo import-compatible CSV via move-in, inspect file/line/External-ID errors, skips/unread columns, commit, inspect retained originals/digests and undo; malformed/replayed inputs and undo after live dependencies are refused.

## Target clauses

### US operating setup

#### US-001 — US business and USD defaults

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8

**Requirement.** A US manufacturer sets legal name, US billing/shipping addresses, EIN reference, USD functional currency, US time zone, working week and fiscal year. Quantities support exact US customary and metric units; customer/supplier tax identities are distinct from Australian ABNs. Money and archives retain their declared currency. MOVE-008 preserves original currencies and migration records. The [operating rules](docs/contract/OPERATING-DETAILS.md#us-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Set up an Ohio workshop in USD, quote in inches and receive in feet with an exact conversion; export and restore the order and verify local dates, currency and identity.
2. Reject an inexact conversion.
3. Each archived monetary amount retains its ISO 4217 currency, either on the amount or through an unambiguous currency declaration for its record; USD is the default for a new US installation.
4. Restore preserves original currencies.
5. Existing AUD data requires an explicit versioned migration with recorded rates and reconciliation, never a USD relabel.
6. Compare a new USD archive and a migrated legacy AUD archive after restore, including all amount currencies and migration totals.

#### US-002 — Sales tax and exemption handoff

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Manufacturing quotes/orders carry ship-to jurisdiction, taxable items, freight, exemption/resale certificates and provider-calculated US sales tax via Avalara AvaTax or TaxJar. Final invoice tax goes to the connected ledger once; expiry or provider failure blocks an unsupported tax assertion. Larder retains the calculation and reversal references.

**Acceptance.**
1. Quote an interstate taxable order and a resale-exempt order through the UI with a tax sandbox; ship/return part and reconcile invoice and tax reversal in QuickBooks Online.

#### US-003 — Guided real-order setup

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Setup guides the owner through units, locations, suppliers, BOMs, calendars, costing and a real order to shipment, showing missing prerequisites and understandable migration diagnostics. It starts empty, and progress resumes without a consulting-only configuration path.

**Acceptance.**
1. In an empty installation complete setup using an actual workshop order; interrupt after BOM setup, resume and reach a feasible plan, production, shipment and reconciled ledger entry.

### Product engineering

#### ENG-001 — Multilevel BOM explosion

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Engineers build multilevel assemblies and phantom subassemblies with per-unit quantities, yields, effective revisions and make/buy choices. MRP recursively explodes them, detects cycles, and pegs component demand without double counting shared subassemblies. Released work remains pinned. Yield is a good-output fraction greater than zero and at most one; each aggregate recipe requirement divides per-unit inputs by yield and rounds upward to six quantity places. Planning and release select the revision effective today in UTC. Make supply nets shared stock/open and draft supply before exploding only uncovered quantity; buy stops explosion; phantom bypasses subassembly stock and expands its recipe. Draft work contributes its inputs once; released work uses its pinned requirements. Pegs retain the root document and revision path. Future effective revisions are also checked for cycles.

**Acceptance.**
1. Create a three-level BOM sharing a component, stock one subassembly, run MRP and inspect net component demand; reject a cycle and preserve released work after revision.

#### ENG-002 — Executable routings and instructions

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A revision includes ordered operations, dependencies, setup/run/queue times, work-center eligibility, labor skills, drawings and step instructions. Operators see the exact approved revision at their task, including a required acknowledgment after an instruction change. The [operating rules](docs/contract/OPERATING-DETAILS.md#eng-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Release a two-operation job, open its tablet task and drawing, then revise instructions; the released job retains its instructions and a new job requires acknowledgment.

#### ENG-003 — Configurable and matrix BOMs

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Sales/engineering choose permitted variant attributes, dimensions and options; rules derive component quantities, routing and cost with explainable formulas. Invalid combinations are refused and the resolved configuration is pinned on quote and work. The [operating rules](docs/contract/OPERATING-DETAILS.md#eng-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Configure two sizes/finishes through the quote form, compare resolved BOM/cost and release both; refuse an invalid combination and keep old work stable after a rule edit.

#### ENG-004 — BOM CSV export and bulk revision

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Engineers export BOMs/routings as CSV and preview batch component substitutions, quantity changes and effective dates with affected SKUs, stock and open-work impact. Approval creates revisions atomically; released work changes only by a separately reviewed change.

**Acceptance.**
1. Export ten BOMs, replace one component through CSV preview, inspect row errors and affected work, approve and re-export; a released job keeps its previous revision.

#### ENG-005 — Engineering change approval and obsolescence

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Engineers propose changes with reason, effectivity, attachments, substitute eligibility and disposition of obsolete stock; authorized managers approve, record acknowledgment and choose treatment of unreleased work. Approved revision history is immutable. The [operating rules](docs/contract/OPERATING-DETAILS.md#eng-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Propose a safety-related component replacement with an attachment and substitute eligibility, deny direct and phantom-parent release before approval and refuse BOM bypass, independently approve on an effective date, acknowledge it and inspect old stock instructions plus keep/adopt/cancel draft outcomes and unchanged released jobs.
2. Refuse premature adoption, stale or self approval; restore the evidence and immutable review history, and require the new job’s pinned instruction acknowledgment.

#### ENG-006 — Kits and sale-triggered assembly

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Sellable kits have versioned component definitions; an authorized sale can trigger policy-approved assembly or component picking. Stock, kit availability and costs reconcile once even when the channel repeats the sale event. The [operating rules](docs/contract/OPERATING-DETAILS.md#eng-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Sell a kit twice via one replayed channel event and a separate second sale; verify two assemblies only, exact component consumption and no oversell.

#### ENG-007 — Catalog export, bulk edit and re-import

*Tier:* Core · *Cites:* BASE-INPUT-001, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An authorized manager, buyer or engineer downloads items and variants as XLSX or CSV with Larder IDs and every editable field, including per-location fields. Re-import matches IDs, creates ID-less rows, preserves blank cells and previews changes, row errors and impacts before an atomic exact-version approval. Saved documents, used units and stock history stay unchanged. The [operating rules](docs/contract/OPERATING-DETAILS.md#eng-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. Export items and variants for two locations, change sales prices, reorder points and default suppliers on several rows, leave other cells blank, and add one bad row (unknown supplier) and one change to a used unit.
2. The preview lists both row errors and each row's impact.
3. Approve, re-export and compare: only the edited fields changed, blank cells kept existing data, used units and stock history are unchanged, and a preview made stale by a concurrent edit is refused.

#### ENG-008 — Tracking policy selection

*Tier:* Core · *From:* ENG-007 · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Tracking selection is a declared catalog policy:  batch requires a valid lot on current physical receipts/output, while serial is labelled “serial policy configured; one serial per unit at every stock door” and every physical movement of a serial item is one named serial unit through TRACE-002's doors; a door that cannot name serials refuses. Enabling batch is refused for any nonzero unlotted position across all locations/dispositions; serial selection is refused while any nonzero physical stock exists. TRACE-002 owns serial-aware execution and must honor the configured serial policy before shipping. The [operating rules](docs/contract/OPERATING-DETAILS.md#eng-008) retain the detailed bounds and record semantics.

**Acceptance.**
1. Select batch tracking only with no nonzero unlotted position; refuse serial selection while physical stock exists.
2. Require named lots for batch receipts/output and exactly one named serial per unit through every physical serial door; an unsupported door refuses rather than creating untracked stock.

### Demand and sales

#### DEMAND-001 — Costed quotes and credible promise dates

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Sales prepares versioned quotes in USD, or in a customer's own currency such as CAD with the recorded rate and USD functional value, including customer-specific prices, quantity breaks, discounts, freight, quote validity and estimated material/labor/overhead margin. Available-to-promise and capable-to-promise dates use dated supply and finite material/labor capacity, exposing assumptions and alternatives. The native decision follows RL-1.

**Acceptance.**
1. Quote a job with scarce material and a busy machine, compare immediate/partial/overtime options and their margin/date, accept one and trace the date to booked supply/capacity; quote a Canadian wholesale customer in CAD and read the order, invoice and margin in CAD with their USD valuation at the recorded rate.
2. Show three feasible ship-date alternatives for an order, each checked against the material, machine and qualified-person calendars before it is offered.
3. Reconcile quoted line extensions and the order total to the cent using the documented fixed-point rounding rules, including a fractional quantity and price.

#### DEMAND-002 — Order changes and cancellations

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Sales versions order quantities, dates, addresses and prices with customer approval history. Changes identify affected reservations, procurement, work and shipped balances; cancellation releases only unconsumed commitments and leaves already incurred costs visible. The [operating rules](docs/contract/OPERATING-DETAILS.md#demand-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Increase, split-date and cancel the unshipped remainder of a partly produced order; inspect reservation/supply changes, retained shipment and incurred cost without deleting history.

#### DEMAND-003 — Master production schedule and forecasts

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners maintain time-bucketed sales forecasts and a master production schedule, import forecast CSV, distinguish actual orders from forecast consumption, and record overrides, seasonality and forecast error. Actual demand consumes forecasts rather than doubling them. The [operating rules](docs/contract/OPERATING-DETAILS.md#demand-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Import a 12-week forecast, confirm overlapping sales orders and release an MPS; compare net demand and forecast error by week, then undo an override with history.

#### DEMAND-004 — Make-to-stock and make-to-order policies

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Each SKU/location selects make-to-stock, make-to-order or assemble-to-order with reorder point, safety stock, min/max, batch size, order multiple and lead time. Customer-specific work stays pegged while common stock supplies approved competing demand. The [operating rules](docs/contract/OPERATING-DETAILS.md#demand-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Run the same demand with stock and order policies, approve the suggested batches and inspect customer pegging, safety stock and unused common inventory.

#### DEMAND-005 — Allocation priority and customer commitments

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners rank open sales and manufacturing orders explicitly (drag in the list or set a rank), and scarce supply is allocated in that rank with due-date and margin consequences. Reallocation shows displaced orders, requires approval and preserves hard-reservation integrity; customers receive only approved promise changes. The native decision follows RL-2. The [operating rules](docs/contract/OPERATING-DETAILS.md#demand-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Allocate one receipt between two orders, preview displacement, approve a split and inspect both promises and reservation totals; re-rank two orders and see the allocation follow the new rank; deny a sales user authority to steal stock.
2. Approve a machine-outage recovery with sufficient alternate capacity that preserves the original promises; read zero changed customer dates and inspect unchanged order dates.
3. A recovery needing changed promises lists their count and old and new dates before the authorized person's approval.

#### DEMAND-006 — Live order material and production status

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Sales and manufacturing order lists show each line’s ingredient and production status, current supply references/dates and rank. They derive current stock, quarantine, reservations and dated purchase/work supply without double allocation; protected hard reservations win. Next reads respond to receipts, ETA changes, ranks, reservations, cancellation and production reports without a planning run, with rank/status sorting and filtering. The [operating rules](docs/contract/OPERATING-DETAILS.md#demand-006) retain make-path and supply-date semantics.

**Acceptance.**
1. With three ranked orders competing for component stock and two POs, part-receive one PO, slip the other ETA and re-rank. After each step, the SO/MO screens at 1440 and 390 and state API show every line’s correct In stock, Expected-with-date/reference or Not available result; quarantine never becomes In stock and expected dates equal current supplying PO/MO dates.
2. Cover a made SO line partly with finished stock and an open MO: count each supply once, inherit that MO’s material coverage and explode only the uncovered quantity through its effective BOM.
3. Re-rank competing demand and inspect protected hard reservations taking precedence.
4. Edit an MO completion date and read it in both lists; an unchanged MO uses its required date.
5. Read every actual supply reference/date and production state: not started, blocked, in progress, done or ready to ship. A declared ETA does not establish finite CAP scheduling.

#### DEMAND-007 — Order invoicing and payment status

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Accounts invoice a sales order from the order or the SO list with *Invoice all* (every packed or delivered line) or *Invoice some…* (chosen packed or delivered quantities only), for one order or in bulk across selected orders, each producing exactly one invoice per order with stable source IDs, the order's prices, discounts, freight and tax, and the invoice's lines linked to their shipments. An optional rule invoices orders automatically when they are packed, shipped or delivered and can send the invoice to the customer by BUY-007. The [operating rules](docs/contract/OPERATING-DETAILS.md#demand-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. In an authorized QuickBooks Online sandbox, (1) partly ship an order and invoice only its shipped lines from the order with *Invoice some…*; invoicing unshipped or already-invoiced quantity is refused. (2) Select two other shipped orders in the SO list and bulk-invoice them, producing exactly one QBO invoice per order, and let the automatic rule invoice a third order on shipment. (3) Record a partial payment and then a full payment against one invoice in QBO.
2. After each step the SO list (screen at 1440 and 390 pixels) and the state API show the correct Not invoiced / Partially invoiced / Invoiced and Unpaid / Partially paid / Paid status for each order, and both columns sort and filter by those values. (4) Replay an invoice command and a bulk request: no second QBO invoice is created.
3. Repeat the payment readback from an authorized Xero test organization.

#### DEMAND-008 — One fulfillment list across sales channels

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Warehouse staff see wholesale, Shopify and Amazon merchant-fulfilled orders in one shipping list, with source channel, order reference, promise date, material/production readiness and remaining shipment quantity. Filtering by channel preserves one demand record per external order. All channels use the same reservation, pick, pack and partial-ship workflow, and route labels/tracking back through their mapped connections; FBA replenishment bookings remain explicitly identified as factory-to-Amazon transfers.

**Acceptance.**
1. Import authorized Shopify and Amazon merchant-fulfilled orders alongside a wholesale order, open the common list at 1440 and 390 pixels, identify each source and pick, pack and partly ship all three.
2. Replay channel events and verify exactly one demand record per order, one physical stock consumption per shipped quantity and the remaining commitments.
3. Read provider-confirmed tracking on each connected order and distinguish an FBA replenishment transfer from a customer shipment.

### Material planning

#### MRP-001 — Time-phased demand netting

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** MRP nets dated sales, forecast, dependent BOM demand and safety stock against usable inventory, reservations, yields, open POs, WIP and lead times. Late, held or expiring supply cannot cover earlier demand. Each informational suggestion explains its quantity, dates, sources and uncertainty without changing commitments. The [operating rules](docs/contract/OPERATING-DETAILS.md#mrp-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Place demand before and after a supplier ETA with held/expiring stock and multilevel WIP; run MRP through the planning API and verify every dated shortage and proposed release/receipt.

#### MRP-006 — Draft from a dated material suggestion

*Tier:* Core · *From:* MRP-001 · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A preparer selects an exact dated material suggestion and its reviewed source path. Current inputs derive shortage quantities, supplier and dates; an entered purchase price and existing inventory-policy authority bind the draft. Preparation changes no stock, reservation, spending approval or customer promise. The [operating rules](docs/contract/OPERATING-DETAILS.md#mrp-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Draft selected buy and make suggestions with their source paths and dates; refuse changed projections, blocked or absent suggestions and already-linked supply, including after a date or revision edit.
2. Read linked drafts, retry without duplication, and restore their provenance without executing a plan.

#### MRP-002 — Demand pegging and supply changes

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A planner follows any component, receipt or work order to the customer demand it supplies, and reverse-pegs affected orders with exact dated quantities and revision paths. Untracked ancestry and unproven work remain explicit; reading pegging changes no commitment. The native decision follows RL-3. The [operating rules](docs/contract/OPERATING-DETAILS.md#mrp-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Follow dated PO lines, received lots and material-feasible work to their customer demand and back; retain quantities, dates, protected commitments and explicit untracked ancestry.

#### MRP-007 — Decide supply-change recommendations

*Tier:* Core · *From:* MRP-002 · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Cancelled, late or excess supply produces expedite, defer or cancel recommendations with affected orders and quantities. The authorized decision binds its exact inputs and day; cancellation conserves protected commitments and uses GOV-002 at the spend threshold. An expedite or deferral records a request; BUY-009 owns supplier-confirmed dates and MRP-005 owns reaching the supplier. The native decision follows RL-3. The [operating rules](docs/contract/OPERATING-DETAILS.md#mrp-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. Delay a component PO and cancel another demand; approve an expedite and a cancellation, inspect affected orders, exact decisions and no orphaned reservation.
2. Read a deferral, refuse stale decisions and route an above-threshold cancellation through the exact spend signatures.

#### MRP-003 — Replenishment forecasts and purchasing constraints

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners review demand history, forecast confidence, supplier calendars, MOQs, packs, price breaks and lead-time variability to set safety stock and suggested orders. The buyer sees coverage and USD cash exposure before converting suggestions. The [operating rules](docs/contract/OPERATING-DETAILS.md#mrp-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Change a vendor MOQ and uncertain lead time, run replenishment and inspect rounded quantities, service coverage and cash; approve only selected suggestions and retain rejected reasons.

#### MRP-004 — Planning scenarios and release fence

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners compare baseline and isolated demand, inventory, overtime, supplier and outage scenarios without changing commitments. Exact adoption preserves frozen/manual work and revalidates every input before booking a feasible plan; hypothetical supplier spending and withheld inventory remain comparisons until their own doors record the real changes. The native decision follows RL-4. The [operating rules](docs/contract/OPERATING-DETAILS.md#mrp-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Compare two outage scenarios, freeze this week and adopt next week's plan; change an ETA before adoption and see stale approval refused without a partial schedule.

#### MRP-005 — Supply-change act leg

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An authorized supply-change decision updates the requested PO line date or quantity and reaches the supplier by mail or portal, retaining the decision and supplier-confirmed result. BUY-001 supplies terms, MRP-007 the exact decision and BUY-007 the communications door. The native decision follows RL-5.

**Acceptance.**
1. Approve one expedite and one cancellation; read the PO line's new promised date and quantity and the supplier's recorded email or portal message carrying the decision.

### Capacity planning

#### CAP-001 — Work-center calendars

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners define machines/work centers, parallel capacity, shifts, breaks, US holidays, maintenance, efficiency and downtime exceptions with time zone and effective dates. Planned operations occupy actual available intervals. Native machine calendars retain versioned IANA time zones, effective shift-start dates, parallel slots, integer efficiency percentages, local shift/break minutes (including overnight continuations), observed US federal holiday closures and offset-bearing downtime exceptions. Owner/manager/planner maintains machines through the ordinary atomic command door. Every occupied UTC minute is inside the named slot’s availability; efficiency stretches setup/run effort and breaks split occupied intervals. Unreleased maintenance supplies no finite capacity until actual authorized release; CAP-009’s separately labelled weekday recovery estimate remains provisional after ETA. Calendar definitions/history and exceptions inherit MOVE-008 JSON/CSV export and empty restore, asserted in the named journey.

**Acceptance.**
1. Schedule across a US holiday and overnight shift, add a machine outage and verify no job occupies unavailable machine capacity.
2. Inspect every scheduled operation's named machine and verify its occupied intervals fall within that machine's available shifts.

#### CAP-002 — Labor calendars and skills

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Supervisors schedule employees/teams by shift, availability, time off, skills and simultaneous-task limits, independent of machine availability. Wage/burden rates are restricted to accounts/authorized managers; time capture feeds costing rather than payroll. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Give two machines one qualified operator, book vacation and run scheduling; inspect feasible assignments and deny operator access to wage rates.
2. Inspect every scheduled operation's named qualified person and verify the assignment lies within that person's available shifts and simultaneous-task limit.

#### CAP-003 — Operation dependencies and blocked work

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Operations obey predecessor completion, transfer batches, overlap rules, material availability and quality gates. A blocked task shows its exact reason and owner, and becomes dispatchable only after the dependency is satisfied. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Try starting coating before machining or QC release through tablet/API; inspect refusal, complete the dependency and start without bypassing it.

#### CAP-004 — Finite-capacity Gantt and bottlenecks

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A production Gantt and load view place jobs in finite machine and labor capacity with due dates, setup/run durations, slack, critical path and bottlenecks. Unscheduled/unfeasible jobs remain explicit; the planner can trace each promised date to scheduled operations. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Schedule competing multistep orders on constrained machine/labor calendars; inspect Gantt/load/critical path and infeasible work, with no simultaneous use beyond capacity.
2. Inspect the current-day marker and derived late and unscheduled job counts; drill each count to its jobs and reconcile the named bottleneck with machine and labor load.
3. Counts of zero require no late or unscheduled jobs in the underlying plan.

#### CAP-005 — Drag and drop rescheduling

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners drag jobs or operations in the Gantt or use keyboard/date controls; preview downstream moves, displaced orders, capacity conflicts and promise changes, then approve a versioned schedule. A conflict cannot silently overload capacity. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Move an urgent job ahead of another using mouse and keyboard; compare preview and approved sequence, and reject a stale change after a shop-floor update.

#### CAP-006 — Alternate centers and sequence-dependent setups

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Scheduling chooses qualified alternate work centers and tools, accounts for setup families, changeover/cleanup times and minimum transfer quantities, and compares outsourcing/overtime where allowed. A chosen alternate preserves required quality/instructions. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Remove a primary machine, compare two eligible alternates with different changeovers, approve one and verify setup, labor, delivery and cost consequences.

#### CAP-007 — Live dependency-preserving reflow

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Recorded progress, ETA, breakdown and priority changes can reflow internal sequencing within explicit protection, scope, displacement, delay and expiry limits. Frozen work and manual overrides stay protected; exact-version adoption refuses any newly infeasible or out-of-scope booking atomically. For agent calls, reversible internal sequencing is standard, outside promises add external and commitment, and spending adds money; the company’s policy decides each class. The native decision follows RL-6. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. Stop a machine mid-job, restart the scheduler and inspect one reflow; preserve the frozen horizon and manual lock, refuse an unapproved customer promise change and show displaced work.

#### CAP-008 — Grouped jobs and nesting

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners group compatible operations or batches and import nesting results with material yield, offcuts, setup sharing and per-job quantity and cost allocation. Groups retain each customer and job identity, required revision and due date. The native decision follows RL-7. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-008) retain the detailed bounds and record semantics.

**Acceptance.**
1. Group three sheet-metal jobs, import a nesting output, approve consumption and recoverable offcuts; trace each output and allocated cost to its original job.

#### CAP-009 — Maintenance and downtime planning

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Supervisors schedule preventive maintenance and log unplanned breakdowns with owner, expected return and repair evidence; equipment stays unavailable until authorized release. Maintenance changes feed production recovery, while specialist CMMS records can link by ID. The [operating rules](docs/contract/OPERATING-DETAILS.md#cap-009) retain the detailed bounds and record semantics.

**Acceptance.**
1. At 1440/390 schedule preventive maintenance and log a breakdown, assign repair/ETA/CMMS ID, inspect affected and following work rescheduled with explicit provisional labels, revise owner/ETA and release after recorded repair; inspect the recovered plan, downloadable evidence/digest and full downtime trail after reload and archive restore.
2. Assert start/resume/completion refusal while unavailable including past ETA, pre-start release refusal, unauthorized/revoked-role and stale/changed-replay refusal, idempotent replay, and unchanged stock/output/promises.

### Purchasing and suppliers

#### BUY-001 — Supplier contracts and delivery rules

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Buyers maintain supplier/item codes, prices/breaks, currency, payment/freight terms, lead times, MOQs, calendars, preferred/alternate vendors and performance history. POs snapshot terms, USD exposure and delivery schedules; acknowledgments preserve supplier revisions. Native supplier quotes round total base quantity to MOQ and pack multiples, apply supplier working weekdays/closed dates and working-day lead times, and pin dated buyer-recorded currency rates with source prices and USD exposure. Approval freezes the reviewed terms and per-line delivery schedule; later acknowledgments keep complete before/after schedules. Receipt observations retain arrival, expected and original approved dates with acceptance/quarantine distinct; terms, decisions and schedules survive business archive/restore.

**Acceptance.**
1. Create two vendors with different packs/lead times, select a feasible quote, approve a PO and revise the supplier date; old approved terms remain recoverable.

#### BUY-002 — Receiving against production demand

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Receivers handle partial deliveries, tolerances, damage, supplier documents, lots and inspection, then allocate accepted receipts to pegged work and sales commitments. A short delivery updates the remaining PO and downstream plan. The native decision follows RL-8. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Receive a short delivery for two pegged jobs, quarantine damaged units and allocate the accepted quantity; inspect open PO, work shortages and proposed date changes.

#### BUY-003 — Purchasing approvals and three-way match

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Amount and category rules route PO and change approvals to authorized people with separation of duties. Supplier bills match PO, accepted receipts, freight and tax; quantity, price and currency differences wait for accounts approval before ledger posting. The native decision follows RL-9. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Approve a PO below and above a threshold, upload a mismatching supplier invoice and part receipt; resolve the variance, post one bill and deny self-approval under the configured rule.
2. The PO list and state API show the PO as Partially billed, then Billed after the second bill, and its payment state after the bills are paid in the connected books; filter the PO list by billing status.

#### BUY-004 — Subcontract and free-issue production

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Buyers issue components to subcontractors, track stock at their location, place subcontract operations/POs and receive finished work with service costs, yield and lot links. Co-manufacturing tracks customer-owned materials separately without valuing them as owned inventory. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Send two material lots to an outside finisher, part-receive finished goods and scrap, reconcile remaining free-issue stock and service bill, and trace the finished lot.

#### BUY-005 — Landed costs

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Accounts allocates freight, duty, insurance and handling across receipts by explicit weight, value or quantity policy, supports later supplier charges and approved cost corrections, and reconciles stock, consumed COGS and WIP without rewriting prior movements. CT approves the interim policy with riders, 26 October 2026. The native decision follows RL-10. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Allocate a late freight bill across partly consumed receipts, review stock, COGS and WIP adjustments and send approved correcting journals to the ledger.

#### BUY-006 — Supplier returns and credits

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Receivers initiate supplier RMAs for rejected or excess material with lot, serial and quantity evidence, ship only eligible stock and match replacement or vendor credit to the original receipt and bill. Open claims have owner and due date. The native decision follows RL-11. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Reject a received lot, ship a partial supplier return, receive a replacement and match the remaining credit; verify stock, trace and purchasing and accounting balances.

#### BUY-007 — Supplier and customer communications

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Larder sends approved POs, acknowledgments, RFQs, supplier ETA chases, customer quotes, sales-order confirmations, packing slips, invoices and promise notices by Base mail through Microsoft 365/Gmail or the configured delivery provider, each as the branded COST-007 document attached to the record. Threaded inbound replies and attachments are untrusted evidence, with delivery/failure/unknown outcomes and visible follow-up.

**Acceptance.**
1. Approve/send a PO, receive an ETA reply, preview its plan impact and approve an updated promise notice; email a quote, the order confirmation and a packing slip to the customer and read them on the order; a timeout remains uncertain and never becomes a false confirmation.

#### BUY-008 — Allocation of accepted receipts to make-path demand

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Accepted receipt stock needed through a make path can be reserved explicitly to the released job making the product, retaining receipt, component, quantity, allocator and reason. Only accepted unreserved stock qualifies; taking an existing reservation needs the documented manager/owner decision, and held, draft, closed or overfilled jobs refuse. A reservation carries standard for agent calls, decided by the company’s policy. The native decision follows RL-12. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-008) retain the detailed bounds and record semantics.

**Acceptance.**
1. Receive a component used only by a made product on a confirmed order, allocate it to the job that makes the product and read the reservation, its receipt and the allocator.

#### BUY-009 — Requested and supplier-confirmed dates on a PO line

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A PO line retains its requested date separately from the supplier-confirmed date. A buyer records an outside confirmation with its source, reference and original evidence; inbound mail fills the same confirmation record. The screen and audit show both dates without treating a request as supplier agreement. The native decision follows RL-13. The [operating rules](docs/contract/OPERATING-DETAILS.md#buy-009) retain the detailed bounds and record semantics.

**Acceptance.**
1. Approve a deferral on a PO line and read its requested date with the supplier's date unchanged; as a buyer record the supplier's phone confirmation with its reference, and read the supplier-confirmed date beside the requested date and the promised date, with the audit entrya confirmation without a source are refused.

### Shop-floor execution

#### FLOOR-001 — Tablet and phone dispatch

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An operator sees assigned ready/blocked operations, priority, drawings, BOM revision, quantities and safety/quality checks on a shop-floor tablet or phone. Start, pause, resume and complete record named operator, station and reason; gloves/large targets and shared-station reauthentication are supported. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. At 1440 and 390 widths dispatch two real jobs, attempt blocked work, sign out a shared station and complete one operation; task state survives reload and another operator sees the update.

#### FLOOR-002 — Actual labor and operation time

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Operators clock setup and run time, pauses and crew work against their assigned operation, retaining actual worked time once for costing rather than payroll. Under RL-102, accounts or owner controls periods and a different manager decides reasoned corrections, with the recorded owner exception. Entries are nonoverlapping bounded operational segments; start-time rates are retained, an unsupported fallback is labelled a costing assumption, and refused long spans remain recoverable as actual worked segments. GOV-015 protects wage data. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-002) retain the detailed bounds and record semantics. Native-person signatures remain exact; an equivalent agent action carries standard and sensitive under the company’s policy.

**Acceptance.**
1. Clock a setup and run, pause for breakdown, correct a missed stop and approve it; verify cost and audit while a duplicate tap and overlapping shift cannot double labor.

#### FLOOR-003 — WIP and manufacturing backorders

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Supervisors see quantities and actual costs waiting, running, completed, held and scrapped by operation. Partial completion transfers only permitted quantity to downstream work, and uncompleted demand remains a dated manufacturing backorder with material/capacity commitments. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Complete six of ten units at operation one, transfer four downstream, hold two and backorder four; inspect WIP, reservations and remaining dates/costs.
2. **Exact rules:** Quantities are finished-item base units at six decimals.
3. Each operation’s units are in exactly one of upstream (not yet received from every predecessor), waiting (received, operation not started), running, backordered, completed (finished here, neither held nor handed on), handed on (the furthest cumulative CAP-003 handoff to any successor), held or scrapped, so the columns always sum to the job quantity.
4. Record evidenced holds and dated manufacturing backorders, release or resume under the documented native authority, and inspect quantities, retained costs, reservations, required dates and capacity consequences without completing unfinished work.
5. Read the operation ledger after restart and restore and refuse split/merge while reported, held or backordered quantities make the transfer ambiguous.

#### FLOOR-004 — Rework repair and unbuild

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Dedicated rework/unbuild orders cite original lot/job, disposition and authorized instructions, recover usable components, capture extra material/labor and segregate rejected stock. Rework never creates free inventory or loses genealogy. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Return a defective assembly, unbuild recoverable parts, rework the rest and ship an approved repair; trace extra cost, recovered stock and original lot.

#### FLOOR-005 — Split and merge manufacturing orders

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Planners split or merge compatible unreleased/released work under explicit material/WIP rules, retaining original demand, lots, recorded time and costs. Incompatible revisions, already shipped outputs and duplicate quantities block merging. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Split a partly completed job for two centers, merge compatible remaining work, then try incompatible revisions; quantities, time and source-order links reconcile.

#### FLOOR-006 — Co-products and by-products

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A manufacturing order records multiple planned outputs, by-products and recoverable scrap with exact yield and approved cost-allocation policy. Each output has its own lot, quality disposition and stock destination. The native decision follows RL-14. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Produce two co-products and a reusable by-product from one batch, inspect lot links and cost allocations, and verify total output value equals approved actual cost.

#### FLOOR-007 — Downtime reasons and production progress

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Operators report breakdown, waiting material, changeover, quality and other lost-time reasons with start/stop and escalation owner. Supervisors see live operation progress and revised remaining effort; reported delay updates planning without inventing completion. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. Pause a running operation for a broken tool, notify and acknowledge its supervisor in app, revise remaining effort and inspect lost-time report and the affected plan dates at 1440/390.
2. Assert all reason categories, real start/stop duration, stale/duplicate/unauthorized and overlapping-pause refusal, progress history and bounds, supervisor revocation, zero-effort non-completion and unchanged stock/output/promises.

#### FLOOR-008 — Barcode scanning workflows

*Tier:* Core · *Cites:* BASE-INPUT-001, BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-9

**Requirement.** USB or Bluetooth scanners and phone or tablet cameras scan item, bin, job, lot and serial codes for receiving, issue, count, transfer, pick and output. GS1 data separates identifier, lot and expiry; wrong, stale or held codes are refused with a recoverable reason. The [operating rules](docs/contract/OPERATING-DETAILS.md#floor-008) retain the detailed bounds and record semantics.

**Acceptance.**
1. Scan a receipt and issue or pick it through the shop-floor UI using a hardware scanner and camera; reject a wrong item, held lot and duplicate scan without an extra movement.

#### FLOOR-009 — Zebra and printable labels

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-9

**Requirement.** Operators print Zebra ZPL and PDF labels for bins, items, lots, serials, WIP travelers and packages with buyer templates and reprint audit. Codes resolve to authorized live records; label printing alone never posts stock or a shipment.

**Acceptance.**
1. Generate/read back a Zebra lot label and PDF traveler, reprint with reason and scan the rendered label on another station fixture; verify no stock change until its authorized movement.

#### FLOOR-010 — Standard-cost and variance allocation

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Compare standard cost with actual batch cost, compute the variance and allocate it by a stated rule. The exact review shows standard cost, actual cost, variance, allocation rule and allocated values before the owner approves; nothing posts automatically. Posting, quarantine and separate evidenced release inherit FLOOR-006’s owner approval and release gates. The exact review records expected standard output values at actual yield. Actual cost is allocated in proportion to those reviewed standard values; each value rounds down to an exact six-place unit-cost increment and the final planned output receives the remaining residue (at most USD 0.000001 per output), shown on review and posted result. Total standard cost must be positive; a negative variance is retained, and an inexact final unit cost is refused. Changed inputs void the draft and require fresh owner approval.

**Acceptance.**
1. Review a batch with different standard and actual costs, inspect the computed variance and its allocation by the stated rule, verify no automatic posting, then explicitly approve as owner and verify quarantined outputs and separate evidenced release under FLOOR-006.

### Stock trace and quality

#### TRACE-001 — Lot and batch genealogy

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** From any receipt, output or shipment lot, buyers trace upstream inputs and suppliers and downstream split and merged batches, subcontract work, rework, shipments and customers with quantities and dates. Searches handle a lot spread across locations and consumption across multiple input lots. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Make one batch from two input lots, split it across shipments and rework one return; query both forward and backward trace and reconcile every quantity.
2. From either forward or backward trace, download CSV retaining the selected lot, linked input/output lots, production and shipment/order references, quantities and dates; reconcile every exported row with the displayed trace and physical movements.

#### TRACE-002 — Serial-number lifecycle

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Items can require unique serials at receipt/output, issue, assembly, shipment, service and return. Serial-to-assembly/component relationships and warranty/customer history are searchable; duplicate serials and impossible serial quantities are refused. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Assemble serialized components into two serialized products, ship and return one; trace the exact customer/component and refuse a duplicate or previously shipped serial.

#### TRACE-003 — Expiry and FEFO

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Food, cosmetic and supplement makers record manufacture, expiry/retest and supplier shelf-life dates, storage conditions and customer minimum remaining shelf life. FEFO proposes eligible lots and blocks expired/held stock unless a qualified documented disposition permits it. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Receive two dated lots, plan and pick FEFO for a customer shelf-life rule, advance past expiry and inspect blocked stock, alerts and an authorized disposition.

#### TRACE-004 — Quality checkpoints and measurements

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Quality staff define receipt, in-process and final inspection plans by SKU and revision with sample size, measurements, tolerance, attachments and qualified signoff. Required failures hold related stock and operations and prevent shipment until authorized release. Before any new operation material/quality gate ships, expose its exact live blocked reason in FLOOR-001 dispatch and enforce the same condition at operation start. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Fail a dimensional in-process check, attach measurements, attempt a downstream start or shipment and see refusal; record an authorized retest and release and preserve both results.
2. During production record a fill-weight inspection with target, unit, limits and individual samples; display actual sample count, calculated mean and pass/fail against the approved sampling rule on the batch, retaining qualified signoff and prior results.
3. Verify both a passing sample set and a failure that holds the lot.
4. Inspect the documented sampling, plan-version and independent release rules through a required failed inspection, its held quantities, a later passing retest and an evidenced release; earlier results and displaced reservations remain explicit.

#### TRACE-005 — Nonconformance and disposition

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Quality owns quantity-scoped nonconformances with root cause, supplier/customer complaint, corrective action, owner, due date and disposition. Closure verifies effectiveness and retains evidence. Passing-unit release, case-linked repair and recorded supplier returns keep their own evidenced authority; BUY-006 owns remote supplier settlement. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Open a nonconformance on part of a lot, route rework and supplier action, approve release of only passing units and close after a recorded effectiveness check.

#### TRACE-008 — Evidenced use-as-is deviation

*Tier:* Core · *From:* TRACE-005 · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A versioned use-as-is proposal identifies exact held lot units and their failing inspections. Independent quality authority binds the reviewed evidence and current gates; execution releases only those units under deviation, retains their failed result and never labels them passed. Trace and later shipment packs retain the decision. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-008) retain the detailed bounds and record semantics.

**Acceptance.**
1. Propose, independently decide and execute an exact deviation; refuse stale quantities, changed inspections, unauthorised actors and blocking recall, quality, expiry or certificate conditions without stock effects.
2. Read proposer, decision-maker, executor, reasons, evidence and failed-result labels in trace JSON, CSV, the screen and a later frozen shipment packet; replay, restart and restore retain them.

#### TRACE-006 — Recall execution and reconciliation

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Quality can place an immediate scoped hold, expand it using genealogy, identify affected customers/shipments and generate/send approved recall notices with response tracking. Returned, destroyed, unrecovered and cleared quantities reconcile; US food/cosmetic/supplement trace records export for the responsible compliance team. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Recall one contaminated ingredient spanning two batches/customers; hold unsent goods, send approved notices, record acknowledgments/returns/destruction and export a complete quantity-balanced recall pack.

#### TRACE-007 — Certificates and controlled release records

*Tier:* Core · *Cites:* BASE-INPUT-003, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Receipts and finished lots retain supplier CoAs, SDSs, test reports, specifications and certificates of conformance with versions, digest and expiry. Customer-required certificates accompany approved shipments, and missing required evidence blocks release. The [operating rules](docs/contract/OPERATING-DETAILS.md#trace-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. At 1440/390 require a CoA and final CoC on one SKU, upload a mismatched lot document and refuse approval/release; approve correct records, release, ship and export the exact versions and original files with trace after reload and archive restore.
2. Assert controlled receipts/finished output are quarantined, additive customer requirements block unsupported dispatch without stock mutation, expired and wrong-lot approval refusal, inclusive expiry metadata, all five document types/digests, independent approval, unauthorized/revoked-role and stale refusal, shipment replay and unchanged historical packets after newer approval/revocation.

### Warehouse operations

#### STOCK-001 — Bins sites and replenishment

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A manufacturer manages multiple US sites, warehouses/bins, transit and third-party locations with owned/customer-owned/consigned stock separated. Bin putaway and replenishment rules respect quality, lot, capacity and site permissions; in-transit goods are unavailable until received. Batch and wave picking of several reserved orders is STOCK-004 . GOV-001 site scope: a site is a named group of locations, including ones added later; this clause carries a member's site scope through its own sites, transit, putaway and consignment doors and proves it in its own acceptance. The native decision follows RL-15. See GOV-001 and MOVE-008.

**Acceptance.**
1. Transfer a lot between two sites with an intermediate transit state, put it away by bin rule and reconcile owned versus consigned balances.
2. Confirm the in-transit quantity is unavailable until it is received; replenish a bin by its rule; see a putaway that breaks a quality, lot, capacity or site-permission rule refused; keep customer-owned stock separate from owned and consigned balances; and restrict a member to one site, including a location added to it later, and prove that scope through the sites, transit, putaway and consignment doors.

#### STOCK-002 — Cycle counts and stocktake

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Warehouse teams schedule blind cycle counts by value/risk/bin, freeze or reconcile intervening movements, recount exceptions and obtain independent approval. By risk means the manager records a risk classification for the selected item or bin in the scheduled session; by value filters and sorts actual position values. A blind count retains validated observed serial IDs, unique and matching the physical count, as count evidence against the existing item/location/lot ledger. Count variances retain counted basis, time, person, lot/serial evidence and approved financial adjustments, with independent approval. Serial count observations are evidence; TRACE-002 owns serial lifecycle execution. The [operating rules](docs/contract/OPERATING-DETAILS.md#stock-002) retain the detailed bounds and record semantics.

**Acceptance.**
1. Count a busy bin blind while a receipt occurs, reject a stale result, recount and approve a variance; inspect quantity/value reconciliation and independent approval.
2. Schedule by value and verify filtering and sorting use actual position values; schedule by risk and inspect the manager's recorded classification for the selected item or bin.
3. Retain unique observed serial IDs matching the physical count against the existing item/location/lot ledger, refuse duplicate IDs or a mismatch with the physical count, and inspect counted basis, time, person, lot/serial evidence and independently approved financial adjustments.

#### STOCK-004 — Batch and wave picking

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Warehouse staff batch- or wave-pick several reserved orders in one bin-sequenced pick list and sort the picked stock back to each order. Managers and warehouse staff review exact reserved quantities, collect the displayed bin list and explicitly confirm sorting; one atomic confirmation creates separate picked shipments for the orders, without consuming physical stock or releasing reservations before shipment. The native decision follows RL-16. The [operating rules](docs/contract/OPERATING-DETAILS.md#stock-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Wave-pick three reserved orders in one list, sort to each order and confirm each order's picked quantity and remaining reservation.

### Actual costs and reporting

#### COST-001 — Actual job costing

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Each job accumulates actual material, approved labor, machine/service and overhead costs under versioned allocation rules in USD. Cost roll-up follows multilevel/subcontract production and partial good output/scrap; closing posts transparent correcting valuations rather than rewriting stock history. GOV-015 protects this capability’s costs and mixed derived values. The native decision follows RL-17. The [operating rules](docs/contract/OPERATING-DETAILS.md#cost-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Finish a job with extra material, labor overtime, subcontract service and scrap; compare calculated unit/job totals with movements/time/service charges and approved valuation adjustments.
2. Inspect immutable allocation versions, retained labor/burden and overtime, machine/service/overhead sources, equal-unit good/scrap allocation and unfinished WIP under the documented costing rules.
3. As native owner, decide exact evidenced service, cost-link, charge and closed-job valuation records; preparation by managers/accounts changes no approved value. Refuse stale or unsupported valuations.
4. Inspect separate correcting financial values across stock, consumed and downstream output, unchanged physical movements and once-only handoff; refuse unsupported legacy unlotted valuation and exclude payroll and journal posting.

#### COST-002 — WIP valuation and aging

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Accounts sees opening WIP, additions, transfers to finished goods, scrap and closing WIP by job/operation/period with aging. Part completion, rework and subcontract balances reconcile to the inventory subledger and external WIP control accounts. GOV-015 protects this capability’s costs and mixed derived values.

**Acceptance.**
1. Run a month spanning partial completion and rework, export WIP roll-forward, drill to transactions and reconcile opening plus additions less transfers/write-offs to closing.

#### COST-003 — Estimate to actual variance

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Managers compare quoted and pinned standard material, labor, setup, overhead, yield and subcontract cost to actual by job/SKU/revision/customer. Variances separate price, usage, efficiency, volume, scrap and downtime, with source drill-through and export. GOV-015 protects this capability’s costs and mixed derived values. The [operating rules](docs/contract/OPERATING-DETAILS.md#cost-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Close two jobs with known price/usage/time/scrap differences, open variance report and drill/export every component back to recorded quantities and rates.
2. For one sales order spanning multiple production jobs, compare its pinned quoted and actual margin percentages and USD cost variance to the cent, using COST-004's revenue and cost allocations; drill the difference to the source quantities, time, rates and recognized revenue.
3. Component price and usage variances retain movement quantities and pinned rates; labor sources keep phase, elapsed hours, retained wage/burden and explicit overtime premium, with separate price/efficiency, overhead, volume and scrap figures.
4. Reports retain linked job allocations and issued revenue sources; exports contain the same filtered drill.

#### COST-004 — Order and customer margins

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Authorized accounts/managers see estimated, committed and actual gross margin by sales order, line, product, customer and channel, including discounts, returns, freight, fees and allocated production costs. Partial shipments do not recognize all remaining costs/revenue prematurely. GOV-015 protects this capability’s costs and mixed derived values. The [operating rules](docs/contract/OPERATING-DETAILS.md#cost-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Partly ship an order then return one unit; compare USD margin by channel/customer with actual job costs, recognized shipment quantities and remaining commitments, denying an operator access.
2. Current reports use each issued shipment movement and its retained price, exact returns/reversals and approved output valuations.
3. Quote estimates are pinned per line; a missing historical estimate stays unknown.
4. Explicit job-to-line allocations conserve both planned quantities.
5. Discounts and freight revenue change revenue; fees and freight costs change cost.
6. Charges prorate by line units and a return refunds them only when explicitly marked refundable; returned units do not create replacement demand.
7. Order, line, SKU, customer and channel reports and CSV share the same filters.

#### COST-005 — Inventory valuation and close controls

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Accounts chooses documented weighted-average or FIFO policy with explicit cutover, landed-cost treatment and opening reconciliation. Period close locks cost changes, reconciles inventory/WIP/COGS to books and routes late entries to approved current-period corrections or audited reopen. GOV-015 protects this capability’s costs and mixed derived values.

**Acceptance.**
1. Close a month with WIP and finished stock, post a late receipt charge and reversal, and reconcile valuation/subledger/journals; refuse a warehouse user's backdated change.

#### COST-006 — Production and supplier performance

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Managers filter performance reports by site, center, SKU, period and owner for on-time delivery, schedule adherence, utilization, OEE, downtime, yield, supplier OTIF and forecast error. Each metric shows its denominator, missing data and source records; exports retain the filters. The native decision follows RL-18. The [operating rules](docs/contract/OPERATING-DETAILS.md#cost-006) retain the detailed bounds and record semantics.

**Acceptance.**
1. Run jobs and receipts with known late, downtime and reject events; inspect each metric, drill to records and export the same filters without converting missing time into perfect OEE.

#### COST-008 — Session-bound report snapshots

*Tier:* Core · *From:* COST-006 · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** A native owner explicitly binds a daily in-app report to their live native session and saved filters. Generation stops on sign-out, expiry, revocation, deactivation, owner change or restore; restored schedules are paused. Each immutable snapshot names its owner; the screen discloses the sign-out stop. External delivery belongs to COST-007 and AUTO-002. The native decision follows RL-18. The [operating rules](docs/contract/OPERATING-DETAILS.md#cost-008) retain the detailed bounds and record semantics.

**Acceptance.**
1. Consent to a daily in-app report and inspect due snapshots with their saved filters and attribution; sign out and verify generation stops.
2. Inspect paused restored schedules without a session reference or authority, and verify that development/review generation is manual and no report is sent outside.

#### COST-007 — Custom reports and documents

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-5, D-2, D-3, D-4, D-6, D-8

**Requirement.** Buyers save report layouts, columns, filters and permitted calculations; personalize quotes, sales-order confirmations, POs, travelers, pick lists, packing slips and invoices with branding and US addresses. CSV/PDF exports and scheduled delivery honor the viewer's role and redact restricted cost/rate fields. GOV-015 protects this capability’s costs and mixed derived values. The [operating rules](docs/contract/OPERATING-DETAILS.md#cost-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. Create a margin layout and a branded PO, order confirmation and packing slip, schedule the layout to accounts, then open as warehouse; totals match source records and restricted data never appears in screen/export/email.

### Connected operations

#### CONN-001 — QuickBooks Online live sync

*Tier:* Core · *Cites:* BASE-DATA-004, BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-2

**Requirement.** Connect a US QuickBooks Online company with scoped OAuth, reviewed item/customer/vendor/tax/account mappings and opening reconciliation. Post bills/invoices/credits and inventory, COGS and WIP journals from approved operations with stable source IDs, linked receipts and visible sync state; external books remain authoritative. Each DEMAND-007 invoice becomes exactly one QBO invoice; QBO payments, partial payments, credits and voids are read back on a schedule and on webhook so every order shows its payment status and outstanding amount, and every bill's billed/paid state reaches its PO (BUY-003). Customers and vendors created in QBO after go-live are offered for import or matching to existing Larder parties, never silently duplicated.

**Acceptance.**
1. Connect an authorized QBO sandbox, receive, produce, partly ship and return; inspect one bill/invoice/credit and balanced mapped journals with remote IDs.
2. Replay/loss/reconnect never duplicates a posting.
3. Run the DEMAND-007 journey in the same sandbox: invoice only the shipped lines of a partly shipped order (unshipped quantity refused), bulk-invoice two orders into one QBO invoice each, record a partial and then a full payment in QBO, and after each step read the correct Not/Partially/Invoiced and Unpaid/Partially paid/Paid status in the SO list and state API, both filterable; a replayed invoice command creates no second QBO invoice.
4. Pay one supplier bill partly in QBO and read Partially billed / Paid on its PO; create a new customer and vendor in QBO and see them offered for import and mapping.
5. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-002 — Xero live sync

*Tier:* Core · *Cites:* BASE-DATA-004, BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-2

**Requirement.** Connect a US Xero organization with scoped OAuth and reviewed accounts/tax/contact mappings. Approved bills, invoices, credits and inventory/COGS/WIP journals sync with two-way settlement/document status, provider restrictions made visible and all source-to-ledger balances reconciled. DEMAND-007 invoices sync one-to-one, Xero payments drive the order's Unpaid/Partially paid/Paid status, bill payments drive the PO billing status (BUY-003), and new Xero contacts are offered for import or matching.

**Acceptance.**
1. Repeat the receive/make/ship/return journey in an authorized Xero test organization, inspect its accepted documents/journals, then edit a remote mapping and resolve the visible conflict without duplicate posting.
2. Invoice a partly shipped order and bulk-invoice two more under DEMAND-007, record partial and full payments in Xero and read the order payment status and PO billing status after each.
3. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-003 — Shopify orders and stock

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8 · *Register:* R-3

**Requirement.** A Shopify app connects one or more Shopify stores to one installation, mapping each store's locations to Larder sites. It imports orders, line options, customer/address/tax/shipping data, edits, cancellations, refunds and fulfillment state. SKU/location mapping exports only sellable availability per store and location, preserving channel buffers and idempotent order/fulfillment references; historic orders can be backfilled before cutover.

**Acceptance.**
1. Install in two authorized development stores with two locations, sell a made item in each, replay an order webhook, change/cancel part and fulfill part from Larder; stock, demand and Shopify tracking/refunds reconcile once per store and location.
2. Ship from the DEMAND-008 common list and read the resulting sellable-stock update back from Shopify, with its last provider-confirmed successful update time; a pending, failed or uncertain update remains visible rather than showing a successful sync.
3. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-004 — WooCommerce orders and stock

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-3

**Requirement.** Connect WooCommerce REST/webhooks for orders, variations, taxes, shipping, edits, cancellations/refunds and fulfillments. Mapped available stock refreshes on events and at least hourly reconciliation; outages show the last successful sync and unresolved differences.

**Acceptance.**
1. Order a variation in a test store, interrupt webhooks, change stock and recover by hourly reconciliation; fulfill/return it and compare one order and correct availability in both systems.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-005 — Amazon demand and fulfillment

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-3

**Requirement.** An authorized Amazon Selling Partner API connection imports merchant-fulfilled orders/changes, SKU/ASIN mapping and shipment confirmation, fees and returns; FBA inventory and fulfillment reconcile separately from factory stock with transfer/receipt differences visible. Provider app approval is delivery work.

**Acceptance.**
1. Authorize a permitted Amazon test/seller environment, ingest/replay an MFN order and confirm its tracking; reconcile an FBA transfer, fee and returned unit without double-counting factory inventory.
2. Approve and book an inbound FBA shipment through the authorized Amazon connection; read back its accepted shipment ID and booking state, then reconcile factory dispatch and Amazon receipt without duplicate factory consumption.
3. An uncertain booking remains pending until provider readback resolves it.
4. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-006 — BigCommerce and eBay orders and stock

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-3

**Requirement.** Connect BigCommerce and eBay orders, variants/listings, addresses, tax/shipping, edits/refunds and shipment state with reviewed SKU/location mapping, sellable stock and historic backfill. Events and periodic reconciliation use the same stable source identity.

**Acceptance.**
1. In an authorized BigCommerce test store and an eBay sandbox, order a variant, replay delivery, change quantity and partly ship/refund; verify one demand record per order and matching available stock/shipment references on both channels.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-007 — ShipStation and Shippo labels and tracking

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-3

**Requirement.** ShipStation, Shippo or 2Ship receives approved packages/addresses/service choices and returns US carrier rates, purchased labels, void/refund outcomes and tracking for USPS, UPS and FedEx. Partial/multi-package shipments and delivery exceptions retain job/order/lot links; an uncertain label purchase is reconciled before retry.

**Acceptance.**
1. Rate and buy a label in authorized ShipStation and Shippo test accounts, read it back, print it and receive tracking; simulate a lost purchase response, void a second label and verify one charge/shipment and visible exception; repeat a purchase and tracking readback through 2Ship.
2. Ship from the DEMAND-008 common list, receive a subsequent carrier tracking event and read updated tracking on the order with its provider-confirmed success time; pending, failed or uncertain sync remains visible.
3. Reconcile the multi-package label count with the approved packages.
4. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-008 — HubSpot, Salesforce and Pipedrive deal-to-order

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-4

**Requirement.** A HubSpot app  creates exactly one linked Larder sales order when a deal enters a mapped Closed Won stage, mapping line items to SKUs by product SKU/ID, companies and contacts to customers, and amounts to the order currency. A later amendment to the won deal becomes a versioned order change under DEMAND-002, never a second order. Larder writes back to the deal its order reference, promise date, DEMAND-006 status, and shipment and tracking status. Won Salesforce opportunities and Pipedrive deals map the same way. Fields the CRM user's mapped role may not see, such as wage rates, labor cost and margin, never leave Larder. The CRM remains the sales pipeline authority.

**Acceptance.**
1. In an authorized HubSpot developer test portal, close-win a deal with two line items, replay its webhook, then amend a quantity.
2. Exactly one linked Larder order exists and the amendment is a versioned change; the deal shows the order reference, promise date and later shipment/tracking status, and no wage-rate or restricted-cost property is written.
3. Repeat conversion and amendment from authorized Salesforce and Pipedrive sandboxes.
4. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-009 — SPS Commerce EDI

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-4

**Requirement.** Use SPS Commerce for customer purchase orders, acknowledgments, changes, ASNs and invoices with partner mappings, control numbers and acknowledgments. Validation failures route to an owner; accepted/rejected network messages remain distinct from shipped goods or paid invoices.

**Acceptance.**
1. Exchange an authorized partner test 850, 855, 860, 856 and 810, replay a control number and reject a malformed ASN; inspect one mapped order and an actionable acknowledgment trail.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-010 — Third-party warehouse reconciliation

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-4

**Requirement.** Named adapters for ShipBob, ShipHero, Mintsoft and Amazon Multi-Channel Fulfillment exchange fulfillment requests, receipts, transfers, lot inventory, tracking and returns. Mismatched 3PL quantities/costs open reconciliation cases; external stock is not inferred from an unacknowledged request.

**Acceptance.**
1. Send a split fulfillment to each authorized 3PL test edge, receive partial confirmation/return and a stock discrepancy; reconcile by lot and cost and verify the request timeout did not become a phantom shipment.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-011 — SolidWorks BOM and drawing intake

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8 · *Register:* R-4

**Requirement.** Import SolidWorks exported BOM CSV/XLSX with drawing/revision references and optional PDM integration, mapping parts, quantities, units and configurations into reviewed Larder revisions. CAD remains authoritative for geometry; ambiguous units/parts require engineering resolution.

**Acceptance.**
1. Upload an actual supported SolidWorks BOM/drawing export, preview mapping/errors, approve a revision and release work; a geometry/revision change cannot silently alter existing jobs.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-012 — ProNest and TruTops nesting intake

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8 · *Register:* R-4

**Requirement.** Import ProNest and TRUMPF TruTops Boost nesting reports/PDFs and supported structured exports, preserving source files and extracting material, sheet, part counts, offcuts, setup/run estimates and job mappings. A person verifies extraction before consumption or schedule changes.

**Acceptance.**
1. Import one real report from each tool with a mixed-job nest, correct an ambiguous part and approve allocations; verify material/yield and per-job costs with no automatic physical stock posting.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-013 — Datanomix machine observations

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-4

**Requirement.** Consume Datanomix machine cycle/utilization events with machine/time/job mapping, duplicate detection and gap/clock warnings. Observed time suggests progress/downtime and costing corrections; a supervisor confirms unmatched jobs and physical output.

**Acceptance.**
1. Replay a permitted Datanomix capture including duplicate and missing cycles, map a machine/job and approve observations; inspect utilization while no unconfirmed output enters stock.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-014 — Versioned public API and webhooks

*Tier:* Core · *Cites:* BASE-OPS-003, BASE-ROLE-001, BASE-DATA-001, BASE-AUDIT-001 · *Rules:* D-6, D-8

**Requirement.** Document a versioned, paginated API for catalog, planning, operations, trace, costs and migration with scoped service credentials, idempotent writes and optimistic concurrency. Signed outbound events have stable IDs, retry and backoff, replay and delivery inspection; failed automation stays visible. The native decision follows RL-19. The [operating rules](docs/contract/OPERATING-DETAILS.md#conn-014) retain the detailed bounds and record semantics.

**Acceptance.**
1. Use a scoped integration credential to create/read an order and consume a signed production event; refuse an out-of-scope cost read and replay/restart without duplicate effects. Through MCP as a warehouse sponsor, read status and prepare a draft; role limits refuse wage reads, and the company’s policy decides commitment calls.
2. Verify owner-only explicit issuance, selected read resources, withheld costs and wages, show-once and hash-only custody, expiry within 60 minutes, live-session termination, revocation, credential-free audit and archives, and revoked restored metadata.
3. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due date and next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

#### CONN-015 — Zapier workflow integration

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** A published Zapier integration offers authenticated triggers for new/late orders, shortages, QC holds, job completion and shipment, and scoped actions to draft orders/POs and update approved metadata. Zapier never bypasses stock, spend or approval controls.

**Acceptance.**
1. Connect Zapier, trigger a shortage and create a draft PO from the Zap; replay delivery, revoke the token and verify no duplicate draft or unauthorized stock posting.
2. Before this capability ships, its failed or uncertain sync outcomes must satisfy AUTO-001 ownership, due/next action, evidence, escalation and provider-confirmed closure; replay submission alone cannot close a case.

### Follow-up and automation

#### AUTO-001 — Owned exception follow-up

*Tier:* Core · *Cites:* BASE-OPS-004, BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Shortage, late supplier, blocked work, QC hold, missed promise, invoice difference and failed sync cases have named owner, due/next action, evidence, escalation and closure criteria. Resolution follows accepted material, completed work and reconciled books; a note cannot hide an ongoing derived failure. The [operating rules](docs/contract/OPERATING-DETAILS.md#auto-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Create one late PO that blocks two orders, assign/escalate its case, receive/inspect/produce/ship and reconcile; restart during follow-up and verify only the satisfied cases close.

#### AUTO-002 — Scheduled alerts and action policies

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Managers configure low-stock, expiry, overdue PO/job, quality and integration notifications with recipient/role, US working hours, escalation, snooze and stop condition. Durable jobs prepare replenishment and rescheduling under explicit policy; sends report accepted/failed/uncertain and never imply human receipt.

**Acceptance.**
1. Run a clock across low-stock and overdue thresholds, snooze one case, restart before escalation and resolve another; inspect one due notification per policy and stopped follow-up after resolution.
2. AUTO-002 inherits notification delivery and its stop conditions from COST-008; in-app snapshots supply no external delivery authority.

#### AUTO-003 — Integration repair queue

*Tier:* Core · *Cites:* BASE-OPS-003, BASE-OPS-004, BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Every connector exposes last success, lag, credentials/scopes, pending work, rate limits and per-record error. A repair queue supports remapping and safe replay with external readback; disconnect stops new work, and reconnect reconciles missing events before declaring current.

**Acceptance.**
1. Expire a token and lose a posting response, rotate credentials, repair one mapping and reconnect; inspect a deduplicated catch-up and unchanged unresolved uncertainty until remote readback.

### Migration and cutover

#### MOVE-001 — Katana move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Import Katana downloaded CSV/XLSX product/material/variant, recipe/BOM, stock and order tables plus authorized JSON API captures for locations, batches, manufacturing operations and open orders not covered by exports. Preserve source IDs, costs, BOM versions, lots, committed quantities and attachments; take recipe units from item cards, include archived records explicitly and reconcile recipes omitted by export eligibility rules. Unsupported fields are explicit exceptions.

**Acceptance.**
1. Preview real Katana XLSX/API captures, reconcile items/BOMs/lot balances and open sales/PO/MO quantities, approve cutover and run one migrated job to shipment; rerun without duplicating stock.

#### MOVE-002 — MRPeasy move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Import MRPeasy CSV exports of articles, BOMs, routings, stock lots, customers/vendors and orders, supplemented by authorized REST JSON captures for detailed open work, operation state/time and reservations. Preserve IDs/relations and source history; clear active export filters and capture API v1/v2 coverage explicitly. The required API plan/access and unavailable fields are named before cutover.

**Acceptance.**
1. Load a verified source-format fixture of the MRPeasy CSV/JSON package with a partly finished MO, reconcile material, operation/time, cost and sales/PO commitments, then complete and ship without reissuing already consumed material.

#### MOVE-003 — Fishbowl Manufacturing move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Import Fishbowl CSV exports using each export type's actual header layout for parts/products, BOMs, inventory, customers/vendors and orders, plus authorized API/report captures of work/manufacture orders and history. Preserve part/product distinction, UOM, tracking fields, BOM stages and open balances; source version is recorded, and current-cost allocation reports are not accepted as historical WIP valuation.

**Acceptance.**
1. Preview a verified source-format fixture of the Fishbowl package including tracked inventory and partial work/shipment, reconcile part/product mappings and actual quantities/costs, then complete the migrated job without duplicate receipts.

#### MOVE-004 — Complete Odoo Manufacturing move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Extend the published import-compatible Odoo CSV kit to nested BOMs, work centers/calendars, work orders, stock moves/reservations, lot/serial/expiry, QC records, actual times and WIP costs using relational External IDs and authorized JSON API/report supplements. Distinguish kits/subcontract BOMs, inspect unrestricted export fields as well as import-compatible columns and preserve open manufacturing state. Discover installed models/custom fields; use the documented API for that source version (including JSON-2 for Odoo 19) and identify required API access.

**Acceptance.**
1. Load a verified source-format fixture of the Odoo CSV/API export with partial work and delivery, reconcile External-ID relationships, inventory/WIP and open commitments, then finish work and shipment after cutover.

#### MOVE-005 — Fulcrum move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Move Fulcrum customer/vendor, item/BOM/routing, inventory, job/operation, time, quote/order and cost records from authorized API JSON exports and available report CSV downloads. Keep source jobs/revisions and job-specific routing snapshots, tracking timers and operation progress; documented POST search endpoints are permitted read captures. Enumerate unavailable fields and obtain owner-approved supplementary exports rather than inventing them.

**Acceptance.**
1. Preview a verified source-format fixture of the Fulcrum API/report package, reconcile open operation quantities/time, lot stock, job costs and customer due dates, approve mappings and continue one job without resetting progress.

#### MOVE-006 — DOSS move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Move DOSS inventory, procurement, order, co-manufacturing and workflow records from owner-generated table exports in their actual supplied format, plus authorized API JSON where an outbound API is provisioned. Capture table/column definitions, data types and relationship keys before mapping; public documentation confirms table export but does not establish its file schema or outbound API, so the importer must implement the verified supplied schema rather than assume CSV/XLSX. Map custom object relationships, external ledger/3PL IDs, owned versus third-party stock, open commitments and source history explicitly.

**Acceptance.**
1. Preview a verified source-format fixture of the DOSS export/API package with custom links and subcontract stock, map references, reconcile ledger-linked inventory/open orders and continue one manufacturing fulfillment after cutover.

#### MOVE-007 — Migration rehearsal and parallel cutover

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-1

**Requirement.** Every named importer stages originals/digests, source schema/version, row errors/skips and relationship maps without live effects. A parallel run compares dated stock, reservations, BOMs, capacity, open work, WIP and order totals; owner chooses cutover boundary and write authority per channel/ledger. Undo before dependence remains atomic; afterward use reviewed corrections. The [operating rules](docs/contract/OPERATING-DETAILS.md#move-007) retain the detailed bounds and record semantics.

**Acceptance.**
1. Rehearse a migration twice, compare a day's source/Larder outcomes, approve opening totals and one cutover time, route live orders to one system and inspect refused undo after a real shipment.
2. For every named importer preview items, BOMs, lots, open orders and dated stock values; show source and proposed Larder stock valuation totals, their USD difference to the cent and row-level exceptions with a review count.
3. Show matched only when the valuation difference is zero; a nonzero difference blocks cutover until reconciled and approved.
4. Preserve source currencies and the recorded conversion rates for any non-USD amounts.
5. Compare dated stock, same-day reservations, active BOMs, open work, WIP, capacity and order quantities and values; bind the opening total, cutover time and channel routing, then refuse a write still routed to the source.

#### MOVE-008 — History attachments and portable exports

*Tier:* Core · *Cites:* BASE-DATA-001, BASE-ROLE-001, BASE-AUDIT-001 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Moved-in closed jobs, shipments, bills, quality records and attachments remain labelled source history with original IDs, times, currencies and searchable references. The [operating rules](docs/contract/OPERATING-DETAILS.md#move-008) retain source-record shapes, lossless CSV/JSON interchange, original-file custody and inert unmapped identities; the shared export/restore duty covers completeness.

**Acceptance.**
1. Import history, search a closed lot/job, export and restore to an empty installation, then compare records/files/totals and confirm no live provider credential or duplicate remote action.

### Roles security and ownership

#### OPEN-001 — Free MIT-licensed software, run by one command

*Tier:* Core · *Cites:* BASE-DATA-005, BASE-OPS-002, BASE-INSTALL-001 · *Rules:* D-6, D-8

**Requirement.** Larder is MIT-licensed; anyone may run, modify and redistribute its complete source. Its manufacturing capabilities have no seat limit, paid feature tier or upgrade fee; the license and published run page agree. The named incumbent move-in and manufacturing journeys define the promised alternative.

**Acceptance.**
1. Read the MIT license and published run page, follow its documented command from a clean directory to an empty manufacturing setup, and inspect the manufacturing feature availability and connection fee disclosures.

#### GOV-001 — Manufacturing roles and permissions

*Tier:* Core · *Cites:* BASE-ACCESS-004, BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** The manufacturing role matrix gives owner, manager, sales, planner, buyer, engineer, operator, warehouse, quality, accounts and viewer their stated jobs and separation of duties. Planners manage forecasts, policies and schedules; engineers control revisions; operators execute assigned tasks; quality controls inspection and disposition; accounts controls rates, costs and journals. The documented role matrix retains every allowed and refused manufacturing action. The native decision follows RL-20. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Invite each manufacturing role, execute its permitted flow and call a forbidden command or download; revoke membership mid-task and verify the manufacturing boundaries.

#### GOV-014 — Site and location scope

*Tier:* Core · *From:* GOV-001 · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** The owner scopes a member to named site groups, including locations added later, intersected with any explicit location restriction. A record and any derived figure require all source locations in scope; trace and recall packets disclose restricted records without out-of-scope totals, identities or counts. Exact writes require both preparer and decision-maker reach. The native decision follows RL-20. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-014) retain the detailed bounds and record semantics.

**Acceptance.**
1. Restrict a member to one site, exercise reads, commands, trace, recall and downloads, add a bin and narrow scope; inspect refusals and redaction, including a saved outcome replay and a mid-task revocation.

#### GOV-015 — Costs and wages scope

*Tier:* Core · *From:* GOV-001 · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** The owner can restrict costs and wages, including prices, rates, value, WIP, variance, margin, cash exposure and any mixed derived figure. A door needing a restricted value refuses without revealing it. Existing rework-rate authorship remains the disclosed production-person exception. The native decision follows RL-20. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-015) retain the detailed bounds and record semantics.

**Acceptance.**
1. Restrict wages and costs and inspect state, screens, API, files and saved outcomes; verify that neither a direct field nor a derived total reveals the restricted value.

#### GOV-016 — Narrow custom manufacturing roles

*Tier:* Core · *From:* GOV-001 · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** An owner-named custom role copies one non-owner, non-agent built-in role and only narrows it through site/location reach, costs-and-wages restrictions or removed decision doors. A member holds one role; removed authority cannot be recovered through delegation. The native decision follows RL-20. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-016) retain the detailed bounds and record semantics.

**Acceptance.**
1. Create and narrow a custom role, exercise an allowed flow and a removed door, then change the role and inspect the next request and delegated decision.

#### GOV-002 — Approval policies and delegated authority

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-6, D-8

**Requirement.** Owner sets spend, margin, count inventory adjustment and quarantine quality-release approval thresholds, dual approval, deputies and expiry. Exact inputs and separation of duties bind decisions; changed/stale inputs invalidate approval and every emergency override names its accountable human. The quality-hold/nonconformance/deviation release journeys (GOV-008), schedule thresholds (GOV-009), the ledger threshold (GOV-010) and the inventory-adjustment threshold on non-count write-offs (GOV-011) use this engine and its signature, deputy, expiry and override rules. The native decision follows RL-21. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-002) retain the detailed bounds and record semantics. Native-person signatures remain exact; an equivalent agent action carries money, commitment or destructive under the company’s policy.

**Acceptance.**
1. Route a high-value PO and stock write-off through dual approval with a deputy, change the input after one signature and inspect invalidation; log an owner override; confirm a below-floor (or unknown-margin) sales order and a high-value quarantine release need the policy signatures on exact terms and a below-floor amendment needs the owner override.
2. Inspect exact signatures, current authority, expiry, one person per seat, bounded revocable deputies and the recorded owner override; a policy edit governs the next decision and does not rewrite an existing exact decision.

#### GOV-003 — Single sign-on and strong authentication

*Tier:* Core · *Cites:* BASE-ACCESS-001, BASE-SIGNIN-001, BASE-SIGNIN-002, BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-5

**Requirement.** Manufacturing planners can use Microsoft Entra ID, Google Workspace or Auth identity, with privileged step-up before journals, roles and credentials. Standards identity, MFA and lifecycle use the shared duties; actual vendor-tenant proof is in the register.

**Acceptance.**
1. Through run-auth, sign in a planner, apply the privileged step-up rule, provision/deprovision the planner and revoke a tablet; inspect refusal of its next manufacturing read, write and download.

#### GOV-004 — Auditable production decisions

*Tier:* Core · *Cites:* BASE-OPS-005, BASE-AUDIT-001, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8

**Requirement.** A changed manufacturing decision can be followed across BOMs, schedules, time corrections, quality and stock, retaining its exact inputs, reasons and linked evidence. GOV-012 adds ledger adjustments and GOV-013 defines manufacturing retention. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-004) retain the detailed bounds and record semantics.

**Acceptance.**
1. Follow a changed BOM through scheduling, operator correction, quality release and a stock adjustment; query/export its audit, deny unauthorized deletion and confirm planted secrets are absent.

#### GOV-005 — Erasure and retention

*Tier:* Core · *Cites:* BASE-DATA-002, BASE-DATA-003, BASE-DATA-006, BASE-ROLE-001, BASE-DATA-001, BASE-AUDIT-001 · *Rules:* D-6, D-8

**Requirement.** US retention and legal holds preserve production and financial trace while eligible contacts, documents, messages and model context are erased lawfully. Former-operator anonymization leaves stock history intact; controlled search, cache and provider outcomes are read back. Native-owner exact-review consent and explicit audited hold release retain the ruled production/document preservation boundary; credentials and link expiry grant no erasure authority. The native decision follows RL-22. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-005) retain the detailed bounds and record semantics.

**Acceptance.**
1. Erase a former employee or contact with linked lots and financial records, retain a legal-held CoA, and inspect archive, search and provider deletion outcomes and intact anonymized stock history.
2. Verify exact current-review owner consent, refusal of stale or held erasure, retained categories and reasons, explicit audited owner hold release without deletion, future archive outcomes and inert restore.

#### GOV-006 — Provider and model secret custody

*Tier:* Core · *Cites:* BASE-SECRET-001, BASE-SECRET-002, BASE-ROLE-001, BASE-DATA-001, BASE-AGENT-006, BASE-AGENT-007 · *Rules:* D-6, D-8

**Requirement.** Ledger, mail and model connections keep installation-owned encrypted, least-scoped credential custody with rotation/revocation without source edits. Destination and data-scope configuration carries security and access; the company’s policy decides corresponding agent calls.

**Acceptance.**
1. Connect and rotate ledger/mail/model credentials, provoke an error and export the installation; inspect redacted UI/logs/archive and denied use of revoked scopes.

#### GOV-007 — Backup restore and recovery

*Tier:* Core · *Cites:* BASE-DATA-001, BASE-BACKUP-001, BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Recovery reconciles a partial manufacturing job, shipment, WIP, trace and files in an isolated installation. Remote effects remain pending readback so recovery cannot ship, pay or post a journal twice.

**Acceptance.**
1. Back up during a partial production/shipment, restore into an empty installation and reconcile balances/files; connect in recovery mode and confirm no second provider effect.

#### GOV-008 — Quality-release approval journeys

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-6, D-8

**Requirement.** Quality hold, nonconformance and use-as-is release honor the owner’s quality-value threshold and exact native signature rules. Changed held quantities or results invalidate signatures, and an owner override names its accountable person; the documented quality-role and failure-recorder separation remains specific to each release. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-008) retain the detailed bounds and record semantics. Native-person signatures remain exact; an equivalent agent action carries commitment under the company’s policy.

**Acceptance.**
1. With a two-signature quality threshold, release a high-value quality hold, a nonconformance and a deviation; change the held quantity after one signature and inspect invalidation; log an owner override.

#### GOV-009 — Schedule approval thresholds

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-6, D-8

**Requirement.** The owner’s schedule-delay threshold, signature count and lifetime bound exact schedule decisions and internal automatic-booking grants. Delay and displacement use the largest per-job change; a grant’s scope, cap, expiry and live signers bind each application, with no authority for customer dates, spending or physical stock. The native decision follows RL-23. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-009) retain the detailed bounds and record semantics. Native-person signatures remain exact; an equivalent agent action carries standard, access or commitment under the company’s policy.

**Acceptance.**
1. Set a two-signature schedule threshold; route an above-threshold reschedule adoption and a grant through dual approval with a deputy; change the plan after one signature and inspect invalidation; refuse a grant exceeding the cap; log an owner override.

#### GOV-010 — Ledger approval threshold

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-6, D-8

**Requirement.** Every ledger posting or journal adjustment at or above the owner's USD ledger threshold needs the policy signatures on its exact lines, with deputies, expiry, invalidation and the named owner override; CONN-001, CONN-002 and AGENT-004 post only through it. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-010) retain the detailed bounds and record semantics. Native-person signatures remain exact; an equivalent agent action carries money and commitment under the company’s policy.

**Acceptance.**
1. Through the first ledger door, route an above-threshold journal adjustment through dual approval with a deputy, change one line after one signature and inspect invalidation; log an owner override.

#### GOV-011 — Inventory-adjustment threshold on every write-off

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-6, D-8

**Requirement.** Non-count write-offs use the inventory-adjustment threshold on the USD value and exact item, lot, location and quantity disposed. Changed balances or case quantities invalidate the decision; supplier credits and reversing an already authorized document remain distinct operations. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-011) retain the detailed bounds and record semantics. Native-person signatures remain exact; an equivalent agent action carries destructive and commitment under the company’s policy.

**Acceptance.**
1. Scrap a high-value expired lot under a two-signature policy with a deputy; move stock at that location after one signature and inspect invalidation; log an owner override.

#### GOV-012 — Auditable journal adjustments

*Tier:* Core · *Cites:* BASE-AUDIT-001, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8

**Requirement.** A ledger adjustment stays linked to the manufacturing source decision and its exact before/after lines, reason and evidence.

**Acceptance.**
1. Extend the GOV-004 changed-BOM thread with a journal adjustment through the first ledger door; query it by record link, export JSON/CSV, refuse its deletion and confirm a planted provider token is absent.

#### GOV-013 — Audit retention and purge authority

*Tier:* Core · *Cites:* BASE-DATA-002, BASE-DATA-003, BASE-AUDIT-001, BASE-DATA-006, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8

**Requirement.** Manufacturing audit entries remain for the installation’s life with no purge authority, including for the owner. The sole exception replaces a subject’s personal values with a tombstone through the erasure door, retaining entry identity, actor ID, time, command, record links, the request without erased values and an audit of replacement. A sole owner can be the subject. GOV-005 owns erasure outside the audit. The native decision follows RL-24. The [operating rules](docs/contract/OPERATING-DETAILS.md#gov-013) retain the detailed bounds and record semantics.

**Acceptance.**
1. Export the audit and read its retention period and purge authority; attempt a purge as every role, the owner included, and inspect refusal at the command, HTTP and database doors; pass an erasure request and confirm the entry stays with the personal values replaced and an audit of the replacement.

#### HTTP-001 — Preserve Base public and private paths

*Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-ACCESS-003, BASE-PUBLIC-001, BASE-OPS-001, BASE-ROLE-001, BASE-DOCS-001, BASE-PUBLIC-002 · *Rules:* D-6, D-8

**Requirement.** The manufacturing Lobby, health and on-site documentation are public while the app, manufacturing records and archives stay private. Larder owns its domain dispatch and manufacturing authorization.

**Acceptance.**
1. Open Lobby/health/docs signed out, request app/state/archive without a session and a nonexistent route, then sign in and use domain commands; verify privacy, real 404 and origin enforcement.

### Mobile accessibility and operations

#### MOB-001 — Responsive accessible manufacturing

*Tier:* Core · *Cites:* BASE-PUBLIC-003, BASE-ACCESSIBILITY-001, BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-6, R-7

**Requirement.** Planning, purchasing, trace, costing and administration remain usable on desktop and phone, including recoverable focus/errors, zoom and table/Gantt alternatives. The shared accessibility bar governs these manufacturing scenarios.

**Acceptance.**
1. At 1440 and 390 run quote-to-plan, scan/produce, inspect a hold, ship and reconcile with the shared keyboard and accessibility-tree checks; no required column or action is hidden.

#### MOB-002 — iOS and Android shop-floor apps

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8 · *Register:* R-8

**Requirement.** Native iOS/Android apps provide secure dispatch, camera/barcode capture, documents, time/quantity reporting and assigned alerts with device/session revocation. Offline captured work is visibly pending and version-checked on reconnect; it cannot claim posted stock, shipment or approval before server acceptance.

**Acceptance.**
1. On iOS/Android emulator fixtures execute a shift, lose connectivity while reporting time/quantity, change the job elsewhere and reconnect; resolve conflict once and revoke the lost device.

#### OPS-001 — Durable scheduling and sync jobs

*Tier:* Core · *Cites:* BASE-OPS-004, BASE-ROLE-001, BASE-DATA-001 · *Rules:* D-6, D-8

**Requirement.** MRP, scheduling, large imports, reports, connector reconciliation and follow-up run as durable bounded jobs with progress, cancellation, restart recovery and measured limits. Size is defined by the Larder reference manufacturer dataset, produced by a deterministic documented generator kept with the tests (test data only): 3 US sites with 250 bins; 4,000 items ; 600 active BOMs up to 5 levels deep, averaging 12 and at most 80 lines, with shared subassemblies; 20 work centers (35 machines) and 45 operators on two shifts, routings averaging 5 operations; 800 open SOs (3,500 lines), 300 open MOs (1,500 operations, 120 in progress) and 400 open POs (1,600 lines); 24 months of history (250,000 stock movements, 30,000 closed SO lines, 6,000 closed MOs, 40,000 time entries, 15,000 lots/serials); and 30 concurrent users including 12 shop-floor tablets. The [operating rules](docs/contract/OPERATING-DETAILS.md#ops-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Generate the reference dataset into an empty installation; run MRP, finite scheduling, one day's Shopify/QBO catch-up and a full export within the stated budgets while 30 simulated users read and command; stop the worker mid-MRP and mid-sync and verify each resumes from its checkpoint with no duplicate posting or partial plan adoption; cancel a report; exhaust a configured USD budget; compare the measured-limits report with the budgets stated here.

### Neighboring products

#### LINK-001 — General ledger and wholesale boundaries

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Larder owns factory planning/execution/trace/cost; Pantry remains a separate general ledger and Pier remains the separate finished-goods wholesale/distribution product. Optional versioned links send approved operational journals to Pantry and factory availability/jobs/shipments to Pier without sharing product authority or duplicating a physical stock movement.

**Acceptance.**
1. Connect separate Larder/Pantry/Pier test installations, fulfill a Pier demand in Larder and sync its cost; inspect one stock authority and one reconciled journal with explicit failure/replay handling.

#### LINK-002 — CRM identity and workflow boundaries

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Rules:* D-6, D-8

**Requirement.** Orbit remains the CRM, Auth the identity provider, Crank workflow automation, Nook team chat and Chest document storage. Larder links approved demand, alerts and document IDs through scoped adapters; none becomes an embedded replacement of that sibling.

**Acceptance.**
1. Send approved Orbit demand, notify Nook of a delayed job through Crank and attach a Chest drawing; revoke one integration and verify a visible pending link without loss of manufacturing records.

### Agent surface

**Specialist: manufacturing planner.** It keeps a small maker’s demand, material, shop-floor work, trace and costs connected from order to shipment.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company’s policy decides every call.

**How Larder computes each class.**

- **standard:** a reversible internal draft, reservation, schedule or compensating record, measured in records/items.
- **external:** a send or newly exposed record outside the business, with recipient count and known/new/public counterparty; supplier/customer identity comes from retained party records.
- **money:** an actual charge, purchase, refund or ledger value, with amount, currency and counterparty; a planning estimate alone moves no money.
- **commitment:** a binding quote, customer promise, revision or quality sign-off, with exact version, value and counterparty.
- **accounts:** an account or paid resource created at a named provider.
- **gated:** the named provider keeps its consent, verification, personal terms or hosted card-entry step for a person.
- **access:** changed people, devices, roles or grants, with count and widening/narrowing direction.
- **security:** protective settings or credential handling, naming the affected setting.
- **destructive:** irreversible physical disposal or eligible erasure, with item/record count; an internal compensating correction alone is standard.
- **sensitive:** regulated identity or payroll data, with record count and kind, adding external when disclosed outside.
- **live:** a change to a running connector’s behavior, naming its service.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `larder.operations.manage_items_variants_units_and_parties` | Items, variants, units and parties | LARDER-001 | standard | native browser/API action |
| `larder.operations.manage_opening_stock` | Opening stock | LARDER-002 | standard | native browser/API action |
| `larder.operations.manage_versioned_bom_and_routing` | Versioned BOM and routing | LARDER-003 | standard or commitment | native browser/API action |
| `larder.operations.manage_quote_and_confirm` | Quote and confirm | LARDER-004 | standard or commitment | native browser/API action |
| `larder.operations.manage_atomic_reservation` | Atomic reservation | LARDER-005 | standard | native browser/API action |
| `larder.operations.manage_shortages` | Shortages | LARDER-006 | standard | native browser/API action |
| `larder.operations.manage_purchase_approval` | Purchase approval | LARDER-007 | money · commitment | native browser/API action |
| `larder.operations.manage_partial_receipt_lots_and_quarantine` | Partial receipt, lots and quarantine | LARDER-008 | standard or commitment (+ destructive) | native browser/API action |
| `larder.operations.manage_production` | Production | LARDER-009 | standard (+ destructive) | native browser/API action |
| `larder.operations.manage_pick_pack_and_partial_shipment` | Pick, pack and partial shipment | LARDER-010 | standard (+ external) | native browser/API action |
| `larder.operations.manage_customer_returns` | Customer returns | LARDER-011 | standard | native browser/API action |
| `larder.operations.manage_free_stock_transfers` | Free-stock transfers | LARDER-017 | standard | native browser/API action |
| `larder.operations.manage_independently_approved_stock_counts` | Independently approved stock counts | LARDER-018 | standard or commitment | native browser/API action |
| `larder.operations.manage_compensating_corrections` | Compensating corrections | LARDER-019 | standard | native browser/API action |
| `larder.operations.manage_accountant_handoff` | Accountant handoff | LARDER-012 | standard or commitment | native browser/API action |
| `larder.operations.manage_operational_exception_queue` | Operational exception queue | LARDER-013 | standard | native browser/API action |
| `larder.operations.manage_reconciled_business_archive` | Reconciled business archive | LARDER-020 | security | native browser/API action |
| `larder.operations.manage_exact_version_operational_proposals` | Exact-version operational proposals | LARDER-015 | standard (+ money · commitment · external · destructive) | native browser/API action |
| `larder.business.manage_us_business_and_usd_defaults` | US business and USD defaults | US-001 | standard (+ sensitive) | native browser/API action |
| `larder.business.manage_sales_tax_and_exemption_handoff` | Sales tax and exemption handoff | US-002 | money · commitment · external | not implemented |
| `larder.business.manage_guided_real_order_setup` | Guided real-order setup | US-003 | standard | not implemented |
| `larder.engineering.manage_multilevel_bom_explosion` | Multilevel BOM explosion | ENG-001 | standard or commitment | native browser/API action |
| `larder.engineering.manage_executable_routings_and_instructions` | Executable routings and instructions | ENG-002 | standard or commitment | native browser/API action |
| `larder.engineering.manage_configurable_and_matrix_boms` | Configurable and matrix BOMs | ENG-003 | standard or commitment | native browser/API action |
| `larder.engineering.manage_bom_csv_export_and_bulk_revision` | BOM CSV export and bulk revision | ENG-004 | standard or commitment | native browser/API action |
| `larder.engineering.manage_engineering_change_approval_and_obsolescence` | Engineering change approval and obsolescence | ENG-005 | standard or commitment | native browser/API action |
| `larder.engineering.manage_kits_and_sale_triggered_assembly` | Kits and sale-triggered assembly | ENG-006 | standard or commitment | native browser/API action |
| `larder.engineering.manage_catalog_export_bulk_edit_and_re_import` | Catalog export, bulk edit and re-import | ENG-007 | standard (+ money · commitment) | native browser/API action |
| `larder.engineering.manage_tracking_policy_selection` | Tracking policy selection | ENG-008 | standard or commitment | native browser/API action |
| `larder.orders.manage_costed_quotes_and_credible_promise_dates` | Costed quotes and credible promise dates | DEMAND-001 | standard or commitment | native browser/API action |
| `larder.orders.manage_order_changes_and_cancellations` | Order changes and cancellations | DEMAND-002 | money · commitment | native browser/API action |
| `larder.orders.manage_master_production_schedule_and_forecasts` | Master production schedule and forecasts | DEMAND-003 | standard or commitment | native browser/API action |
| `larder.orders.manage_make_to_stock_and_make_to_order_policies` | Make-to-stock and make-to-order policies | DEMAND-004 | standard or commitment | native browser/API action |
| `larder.orders.manage_allocation_priority_and_customer_commitments` | Allocation priority and customer commitments | DEMAND-005 | standard | native browser/API action |
| `larder.orders.manage_live_order_material_and_production_status` | Live order material and production status | DEMAND-006 | standard | native browser/API action |
| `larder.orders.manage_order_invoicing_and_payment_status` | Order invoicing and payment status | DEMAND-007 | money · commitment (+ external) | native browser/API action |
| `larder.orders.manage_one_fulfillment_list_across_sales_channels` | One fulfillment list across sales channels | DEMAND-008 | standard (+ external) | not implemented |
| `larder.materials.manage_time_phased_demand_netting` | Time-phased demand netting | MRP-001 | standard | native browser/API action |
| `larder.materials.manage_draft_from_a_dated_material_suggestion` | Draft from a dated material suggestion | MRP-006 | standard | native browser/API action |
| `larder.materials.manage_demand_pegging_and_supply_changes` | Demand pegging and supply changes | MRP-002 | standard | native browser/API action |
| `larder.materials.manage_decide_supply_change_recommendations` | Decide supply-change recommendations | MRP-007 | money · commitment | native browser/API action |
| `larder.materials.manage_replenishment_forecasts_and_purchasing_constraints` | Replenishment forecasts and purchasing constraints | MRP-003 | money · commitment | native browser/API action |
| `larder.materials.manage_planning_scenarios_and_release_fence` | Planning scenarios and release fence | MRP-004 | standard or commitment | native browser/API action |
| `larder.materials.manage_supply_change_act_leg` | Supply-change act leg | MRP-005 | money · commitment · external | not implemented |
| `larder.schedule.manage_work_center_calendars` | Work-center calendars | CAP-001 | standard | native browser/API action |
| `larder.schedule.manage_labor_calendars_and_skills` | Labor calendars and skills | CAP-002 | standard (+ sensitive) | native browser/API action |
| `larder.schedule.manage_operation_dependencies_and_blocked_work` | Operation dependencies and blocked work | CAP-003 | standard | native browser/API action |
| `larder.schedule.manage_finite_capacity_gantt_and_bottlenecks` | Finite-capacity Gantt and bottlenecks | CAP-004 | standard | native browser/API action |
| `larder.schedule.manage_drag_and_drop_rescheduling` | Drag and drop rescheduling | CAP-005 | standard or commitment | native browser/API action |
| `larder.schedule.manage_alternate_centers_and_sequence_dependent_setups` | Alternate centers and sequence-dependent setups | CAP-006 | standard or commitment | native browser/API action |
| `larder.schedule.manage_live_dependency_preserving_reflow` | Live dependency-preserving reflow | CAP-007 | standard or commitment | native browser/API action |
| `larder.schedule.manage_grouped_jobs_and_nesting` | Grouped jobs and nesting | CAP-008 | standard or commitment | native browser/API action |
| `larder.schedule.manage_maintenance_and_downtime_planning` | Maintenance and downtime planning | CAP-009 | standard or commitment | native browser/API action |
| `larder.purchasing.manage_supplier_contracts_and_delivery_rules` | Supplier contracts and delivery rules | BUY-001 | standard or commitment | native browser/API action |
| `larder.purchasing.manage_receiving_against_production_demand` | Receiving against production demand | BUY-002 | standard or commitment (+ destructive) | native browser/API action |
| `larder.purchasing.manage_purchasing_approvals_and_three_way_match` | Purchasing approvals and three-way match | BUY-003 | money · commitment | native browser/API action |
| `larder.purchasing.manage_subcontract_and_free_issue_production` | Subcontract and free-issue production | BUY-004 | money · commitment (+ external) | native browser/API action |
| `larder.purchasing.manage_landed_costs` | Landed costs | BUY-005 | money · commitment | native browser/API action |
| `larder.purchasing.manage_supplier_returns_and_credits` | Supplier returns and credits | BUY-006 | money · commitment (+ external) | native browser/API action |
| `larder.purchasing.manage_supplier_and_customer_communications` | Supplier and customer communications | BUY-007 | external (+ commitment · money) | not implemented |
| `larder.purchasing.manage_allocation_of_accepted_receipts_to_make_path_demand` | Allocation of accepted receipts to make-path demand | BUY-008 | standard | native browser/API action |
| `larder.purchasing.manage_requested_and_supplier_confirmed_dates_on_a_po_line` | Requested and supplier-confirmed dates on a PO line | BUY-009 | commitment | native browser/API action |
| `larder.shopfloor.manage_tablet_and_phone_dispatch` | Tablet and phone dispatch | FLOOR-001 | standard | native browser/API action |
| `larder.shopfloor.manage_actual_labor_and_operation_time` | Actual labor and operation time | FLOOR-002 | standard (+ sensitive) | native browser/API action |
| `larder.shopfloor.manage_wip_and_manufacturing_backorders` | WIP and manufacturing backorders | FLOOR-003 | standard or commitment (+ destructive) | native browser/API action |
| `larder.shopfloor.manage_rework_repair_and_unbuild` | Rework repair and unbuild | FLOOR-004 | standard or commitment (+ destructive) | native browser/API action |
| `larder.shopfloor.manage_split_and_merge_manufacturing_orders` | Split and merge manufacturing orders | FLOOR-005 | standard | native browser/API action |
| `larder.shopfloor.manage_co_products_and_by_products` | Co-products and by-products | FLOOR-006 | standard or commitment | native browser/API action |
| `larder.shopfloor.manage_downtime_reasons_and_production_progress` | Downtime reasons and production progress | FLOOR-007 | standard | native browser/API action |
| `larder.shopfloor.manage_standard_cost_and_variance_allocation` | Standard-cost and variance allocation | FLOOR-010 | standard or commitment | native browser/API action |
| `larder.quality.manage_lot_and_batch_genealogy` | Lot and batch genealogy | TRACE-001 | standard | native browser/API action |
| `larder.quality.manage_serial_number_lifecycle` | Serial-number lifecycle | TRACE-002 | standard | native browser/API action |
| `larder.quality.manage_expiry_and_fefo` | Expiry and FEFO | TRACE-003 | standard or commitment (+ destructive) | native browser/API action |
| `larder.quality.manage_quality_checkpoints_and_measurements` | Quality checkpoints and measurements | TRACE-004 | standard or commitment | native browser/API action |
| `larder.quality.manage_nonconformance_and_disposition` | Nonconformance and disposition | TRACE-005 | standard or commitment (+ destructive) | native browser/API action |
| `larder.quality.manage_evidenced_use_as_is_deviation` | Evidenced use-as-is deviation | TRACE-008 | commitment | native browser/API action |
| `larder.quality.manage_recall_execution_and_reconciliation` | Recall execution and reconciliation | TRACE-006 | standard or commitment (+ external · destructive) | native browser/API action |
| `larder.quality.manage_certificates_and_controlled_release_records` | Certificates and controlled release records | TRACE-007 | standard or commitment | native browser/API action |
| `larder.warehouse.manage_bins_sites_and_replenishment` | Bins sites and replenishment | STOCK-001 | standard (+ external) | native browser/API action |
| `larder.warehouse.manage_cycle_counts_and_stocktake` | Cycle counts and stocktake | STOCK-002 | standard or commitment | native browser/API action |
| `larder.warehouse.manage_batch_and_wave_picking` | Batch and wave picking | STOCK-004 | standard | native browser/API action |
| `larder.costing.manage_actual_job_costing` | Actual job costing | COST-001 | standard or commitment (+ sensitive) | native browser/API action |
| `larder.costing.manage_wip_valuation_and_aging` | WIP valuation and aging | COST-002 | standard (+ sensitive) | native browser/API action |
| `larder.costing.manage_estimate_to_actual_variance` | Estimate to actual variance | COST-003 | standard (+ sensitive) | native browser/API action |
| `larder.costing.manage_order_and_customer_margins` | Order and customer margins | COST-004 | standard (+ sensitive) | native browser/API action |
| `larder.costing.manage_inventory_valuation_and_close_controls` | Inventory valuation and close controls | COST-005 | money · commitment (+ sensitive) | native browser/API action |
| `larder.costing.manage_production_and_supplier_performance` | Production and supplier performance | COST-006 | standard (+ sensitive) | native browser/API action |
| `larder.costing.manage_session_bound_report_snapshots` | Session-bound report snapshots | COST-008 | standard | native browser/API action |
| `larder.costing.manage_custom_reports_and_documents` | Custom reports and documents | COST-007 | standard (+ external · sensitive) | not implemented |
| `larder.integrations.manage_versioned_public_api_and_webhooks` | Versioned public API and webhooks | CONN-014 | security · access | native browser/API action |
| `larder.followup.manage_owned_exception_follow_up` | Owned exception follow-up | AUTO-001 | standard | native browser/API action |
| `larder.followup.manage_scheduled_alerts_and_action_policies` | Scheduled alerts and action policies | AUTO-002 | external (+ money) | not implemented |
| `larder.followup.manage_integration_repair_queue` | Integration repair queue | AUTO-003 | standard (+ money · commitment · external) | not implemented |
| `larder.governance.manage_manufacturing_roles_and_permissions` | Manufacturing roles and permissions | GOV-001 | access | native browser/API action |
| `larder.governance.manage_site_and_location_scope` | Site and location scope | GOV-014 | access | native browser/API action |
| `larder.governance.manage_costs_and_wages_scope` | Costs and wages scope | GOV-015 | access | native browser/API action |
| `larder.governance.manage_narrow_custom_manufacturing_roles` | Narrow custom manufacturing roles | GOV-016 | access | native browser/API action |
| `larder.governance.manage_approval_policies_and_delegated_authority` | Approval policies and delegated authority | GOV-002 | security · access · commitment | native browser/API action |
| `larder.governance.manage_single_sign_on_and_strong_authentication` | Single sign-on and strong authentication | GOV-003 | access · security (+ gated) | native browser/API action |
| `larder.governance.manage_auditable_production_decisions` | Auditable production decisions | GOV-004 | standard | native browser/API action |
| `larder.governance.manage_erasure_and_retention` | Erasure and retention | GOV-005 | destructive · sensitive | native browser/API action |
| `larder.governance.manage_provider_and_model_secret_custody` | Provider and model secret custody | GOV-006 | security · access (+ gated) | not implemented |
| `larder.governance.manage_backup_restore_and_recovery` | Backup restore and recovery | GOV-007 | security · destructive | native browser/API action |
| `larder.governance.manage_quality_release_approval_journeys` | Quality-release approval journeys | GOV-008 | commitment | native browser/API action |
| `larder.governance.manage_schedule_approval_thresholds` | Schedule approval thresholds | GOV-009 | access · commitment | native browser/API action |
| `larder.governance.manage_ledger_approval_threshold` | Ledger approval threshold | GOV-010 | money · commitment | not implemented |
| `larder.governance.manage_inventory_adjustment_threshold_on_every_write_off` | Inventory-adjustment threshold on every write-off | GOV-011 | destructive · commitment | native browser/API action |
| `larder.governance.manage_auditable_journal_adjustments` | Auditable journal adjustments | GOV-012 | money · commitment | not implemented |
| `larder.governance.manage_audit_retention_and_purge_authority` | Audit retention and purge authority | GOV-013 | destructive · sensitive | native browser/API action |
| `larder.ops.manage_durable_scheduling_and_sync_jobs` | Durable scheduling and sync jobs | OPS-001 | standard (+ money · commitment · external · sensitive) | not implemented |
| `larder.handoffs.manage_general_ledger_and_wholesale_boundaries` | General ledger and wholesale boundaries | LINK-001 | external (+ money · commitment) | not implemented |
| `larder.handoffs.manage_crm_identity_and_workflow_boundaries` | CRM identity and workflow boundaries | LINK-002 | external (+ commitment) | not implemented |
| `larder.specialist.manage_maintain_a_feasible_recovery_plan` | Maintain a feasible recovery plan | AGENT-001 | standard (+ money · commitment · external) | native browser/API action |
| `larder.specialist.manage_chase_supply_to_usable_material` | Chase supply to usable material | AGENT-002 | standard (+ money · commitment · external) | native browser/API action |
| `larder.specialist.manage_reconcile_actual_cost_against_the_plan` | Reconcile actual cost against the plan | AGENT-003 | standard (+ external · sensitive · money) | native browser/API action |
| `larder.specialist.manage_close_the_production_to_books_loop` | Close the production to books loop | AGENT-004 | money · commitment (+ external) | native browser/API action |
| `larder.specialist.manage_engineering_intake_from_documents` | Engineering intake from documents | AGENT-005 | standard (+ external · money · commitment) | not implemented |
| `larder.specialist.manage_cited_shop_data_answers` | Cited shop-data answers | AGENT-006 | standard (+ sensitive) | not implemented |
| `larder.specialist.manage_forecast_and_inventory_policy_improvement` | Forecast and inventory policy improvement | AGENT-007 | standard (+ money · commitment) | not implemented |
| `larder.specialist.manage_recall_and_quality_investigation` | Recall and quality investigation | AGENT-008 | standard (+ commitment · external · destructive) | not implemented |
| `larder.specialist.manage_controlled_agent_execution_and_cost` | Controlled agent execution and cost | AGENT-009 | standard (+ security · sensitive) | not implemented |
| `larder.connections.manage_configure` | Configure the named external connections | CONN-001, CONN-002, CONN-003, CONN-004, CONN-005, CONN-006, CONN-007, CONN-008, CONN-009, CONN-010, CONN-011, CONN-012, CONN-013, CONN-015 | accounts · security · live (+ gated · access) | not implemented |

**Resources.** `larder://items/{id}`, `larder://parties/{id}`, `larder://orders/{id}`, `larder://purchases/{id}`, `larder://jobs/{id}`, `larder://operations/{id}`, `larder://lots/{id}`, `larder://inspections/{id}`, `larder://cases/{id}`, `larder://valuations/{id}`, `larder://history/{id}`.

**Events.** `order.changed`, `purchase.date_changed`, `receipt.recorded`, `material.usable`, `work.changed`, `quality.held`, `quality.released`, `stock.changed`, `shipment.dispatched`, `ledger.reconciled`.

**Prompts.** Order-to-shipment (DEMAND-001, MRP-001, CAP-004, LARDER-009, LARDER-010); supplier follow-up (AGENT-002); cost investigation (AGENT-003, COST-003); quality investigation (AGENT-008, TRACE-006).

**Not tools, and why.** LARDER-016: the existing import door owns source-package staging and cutover; MOVE-001: the existing import door owns source-package staging and cutover; MOVE-002: the existing import door owns source-package staging and cutover; MOVE-003: the existing import door owns source-package staging and cutover; MOVE-004: the existing import door owns source-package staging and cutover; MOVE-005: the existing import door owns source-package staging and cutover; MOVE-006: the existing import door owns source-package staging and cutover; MOVE-007: the existing import door owns source-package staging and cutover; MOVE-008: the existing import door owns source-package staging and cutover; OPEN-001: an installation and licensing fact; HTTP-001: an installation dispatch boundary; MOB-001: a person’s responsive and accessible screen; MOB-002: device-only native capture and offline reconciliation; FLOOR-008: device-only hardware/camera capture; the stock actions have their own tools; FLOOR-009: device-only printer output; printable document generation belongs to the document tool; CONN-001: a connector owns the provider transport; connection configuration is offered below; CONN-002: a connector owns the provider transport; connection configuration is offered below; CONN-003: a connector owns the provider transport; connection configuration is offered below; CONN-004: a connector owns the provider transport; connection configuration is offered below; CONN-005: a connector owns the provider transport; connection configuration is offered below; CONN-006: a connector owns the provider transport; connection configuration is offered below; CONN-007: a connector owns the provider transport; connection configuration is offered below; CONN-008: a connector owns the provider transport; connection configuration is offered below; CONN-009: a connector owns the provider transport; connection configuration is offered below; CONN-010: a connector owns the provider transport; connection configuration is offered below; CONN-011: a connector owns the provider transport; connection configuration is offered below; CONN-012: a connector owns the provider transport; connection configuration is offered below; CONN-013: a connector owns the provider transport; connection configuration is offered below; CONN-015: a connector owns the provider transport; connection configuration is offered below.

**Limits.** The operating-rules document retains import/body/byte bounds and bounded planning searches. Business thresholds and provider spend are the company’s policy.

**Handoffs.** Listens for approved demand, supplier-date and accounting-readback events; emits material-usable, shipment and ledger-reconciled events with manufacturing resource links for Pantry, Pier, Orbit, Nook and Chest specialists.


#### SURFACE-001 — Manufacturing registry

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** The manufacturing action registry equals the tool table and its non-tool reasons, and the shared conformance harness exercises it on Larder records.

**Acceptance.**
1. Compare the registry with every Core job in the table, including the documented device, connector, import and installation boundaries; a missing manufacturing job fails conformance.
2. Run the shared harness against the manufacturing fixtures with results matching the corresponding native manufacturing actions.

#### SURFACE-002 — Physical stock classes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** A reversible internal reservation, transfer, receipt or compensating correction is standard. Actual irreversible destruction adds destructive, measured in the exact item/lot units disposed, while a quality release or recorded sign-off also carries commitment.

**Acceptance.**
1. Compare reversible internal moves with actual scrap and a binding lot-release decision; inspect standard, destructive and commitment with item, lot and quantity facts.
2. A mere model prediction never supplies the physical receipt, inspection or disposal evidence required by those calls.

#### SURFACE-003 — Commercial and outside consequences

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006, BASE-AGENT-007

**Requirement.** Purchase terms, charges, refunds and ledger postings carry money with amount, currency and counterparty. A binding quote, promise, signature or quality sign-off adds commitment. Sending a document or changing what a supplier, customer or public reader can see adds external.

**Acceptance.**
1. Compare a draft purchase, an approved purchase charge and a changed customer promise; inspect the money amount/currency and commitment value/counterparty.
2. Compare an internal document with a known customer, a new supplier and public exposure; inspect external recipient count and known, new or public counterparty facts.

#### SURFACE-004 — Protected manufacturing data

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-006

**Requirement.** Reading or disclosing regulated identity or payroll records adds sensitive, measured by record count and data kind; GOV-014 and GOV-015 still bound the manufacturing sources. Cost-analysis disclosure uses AGENT-003 once.

**Acceptance.**
1. Read a permitted regulated identity/payroll fixture and a non-sensitive production record; inspect sensitive only for the former, with record count and kind.
2. Attempt the same restricted-rate and mixed-location queries as a limited operator; no derived cost or cross-site fact escapes.

#### SURFACE-005 — Authority and provider classes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-005, BASE-AGENT-006

**Requirement.** Manufacturing membership, site/custom-role changes, devices and grants carry access with people count and widening/narrowing direction. Protective configuration or credential handling carries security. Creating an outside account or paid resource carries accounts. Provider-retained consent, verification, personal terms or hosted card-entry steps are gated. Changing running connector behavior carries live.

**Acceptance.**
1. Change another member’s manufacturing scope and inspect access people/direction; rotate a permitted connection credential and inspect security setting facts.
2. Create an outside resource and inspect accounts with provider; inspect gated with provider and exact step when its provider keeps consent, verification or hosted checkout for a person.
3. Change a running connector and inspect live with the affected service; supplying an agent’s own confirmation changes none of those computed classes.

#### SURFACE-006 — Planning uncertainty and execution

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006, BASE-AGENT-007

**Requirement.** Planning tools distinguish an informational dated projection, a feasible finite option and an actual adopted booking. Search limits, missing capacity and unproven supply remain visible; the company’s policy decides each computed class.

**Acceptance.**
1. Run dated netting, alternate-machine comparison and recovery adoption, retaining pegs, original promises, scope and uncertainty; no informational result is labelled an adopted schedule.
2. Run the same internal standard action under the held and all-autonomous company policies and inspect the different decisions with identical manufacturing invariants.

#### SURFACE-007 — Manufacturing resource projections

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-ROLE-001

**Requirement.** Manufacturing resources expose exact item, party, order, purchase, job, operation, lot, inspection, case, valuation and source-history records within GOV-014 and GOV-015.

**Acceptance.**
1. Follow the resource links from a partial receipt, work output and shipment to their exact lots, pegs, costs and retained files.
2. Read the same records as accounts and a site/cost-restricted operator; reconcile the resource projection with each actor’s manufacturing screen.

#### SURFACE-008 — Evidence-bearing quality and engineering

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-007, BASE-AGENT-008

**Requirement.** Engineering revision and quality disposition calls carry commitment; physical and inspection evidence remains linked to exact versions, including a failed result released under deviation. The company’s policy decides the agent’s consequential call.

**Acceptance.**
1. Complete an engineering change and a use-as-is deviation with original files and exact versions; read the decision and its attribution on the revision, lot and shipment pack.
2. Under the held policy, a signed-in person takes the policy’s decision step; under the all-autonomous policy, the agent’s equivalent act is truthfully attributed and never recorded as that person’s signature.

#### SURFACE-009 — Manufacturing change events

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-010

**Requirement.** The manufacturing event vocabulary identifies orders, purchases, receipts, work, quality, stock and reconciliation transitions and their resource links.

**Acceptance.**
1. Receive, produce, hold, release and partly ship seeded goods; follow the corresponding typed manufacturing events back to the same record revisions.
2. Observe supplier-date, material-usable and ledger-reconciled events in the handoffs below without inventing physical arrival or accepted books.

#### SURFACE-010 — Bounded cost-analysis tool

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006, BASE-AGENT-011

**Requirement.** The cost-analysis tool follows AGENT-003’s exact minimized disclosure and route boundary. It reports the selected token/USD estimate before the company-policy decision, retaining cited hypotheses and separate future revision authority.

**Acceptance.**
1. Run exact allowed and over-cap snapshots, source/destination changes and an unsent revocation; inspect refusal or the single permitted send without history changes.
2. Under both company policies, inspect external, sensitive and any money facts and the company’s decision; direct and routed providers remain distinct evidence routes.

#### SURFACE-011 — Manufacturing specialist handoffs

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-010

**Requirement.** The specialist listens for approved demand and supplier dates and emits material-usable, shipment and reconciliation events for linked specialists. Pantry owns books, Pier wholesale, Orbit CRM, Nook messages and Chest source documents.

**Acceptance.**
1. Follow approved demand through a late supplier, usable receipt, job completion and shipment, linking each receiving specialist to manufacturing evidence.
2. A failed or uncertain ledger readback leaves its owned follow-up case open; a retried submission alone closes nothing.

#### SURFACE-012 — Manufacturing prompts and capacity limits

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-011, BASE-AGENT-013

**Requirement.** Registry-derived prompts offer order-to-shipment planning, supplier follow-up, cost investigation and quality investigation. Capacity bounds are the documented installation rate/body/byte limits; business thresholds and provider spend are company policy.

**Acceptance.**
1. Discover each named manufacturing job and follow its clauses, resource templates, events and documented capacity limits from the agent documentation.
2. Inspect an oversized import or model snapshot and a bounded planning search, retaining explicit recoverable limits rather than an invented business-volume cap.

#### SURFACE-013 — A seeded manufacturing week through MCP

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-001, BASE-AGENT-004, BASE-AGENT-009, BASE-AGENT-012, BASE-AGENT-013 · *Register:* R-10

**Requirement.** A stranger manufacturing planner given only the installation URL completes a seeded week through MCP under two company policies, including one autonomous for every class.

**Acceptance.**
1. Discover the specialist, plan a quoted job, handle a supplier slip, receive usable lots, recover production, inspect actual costs and partly ship with all source and trace links.
2. Under the all-autonomous company policy, complete the permitted tool calls without a person’s policy decision step; under the held company policy, complete the same work after the named person takes the returned decision steps.
3. Exercise declared access/security/provider and destruction fixtures within the week, retain their class facts and truthful physical evidence, and reconcile the class overview with the week’s actions.
4. Recover an interrupted call and refuse unsafe changed inputs without duplicate stock, money or customer commitments.

## Push further

### Push further

#### AGENT-001 — Maintain a feasible recovery plan

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A planning agent continuously reads demand, supplier ETAs, reservations, progress and machine/labor calendars, and offers feasible recovery options with displaced jobs, dates, capacity, USD cost/cash and uncertainty. Internal reversible sequencing is standard; changed customer commitments carry commitment and external, and changed purchasing carries money. The company’s policy decides those calls; the documented protection and exact-input rules still bind each selected option. Under the held company policy, a person takes the decision steps in the journey below. The [operating rules](docs/contract/OPERATING-DETAILS.md#agent-001) retain the detailed bounds and record semantics.

**Acceptance.**
1. Delay a supplier and stop a machine; inspect two feasible recovery options, approve one across the responsible roles and follow it through revised work/customer promises.
2. Change an input before approval and refuse stale execution.
3. With sufficient eligible alternate capacity, recover from a supplier slip or machine outage while preserving the original customer ship date: show the affected jobs moved to an eligible alternate machine, their new sequence and the still-feasible unchanged promise before approval, then verify the adopted plan retains it.

#### AGENT-002 — Chase supply to usable material

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** From PO, supplier-thread, receipt and quality evidence, an agent follows supply to usable material, retains cited ETA commitments and next actions, and tracks downstream changes. Outside chases carry external, customer or supplier commitments add commitment, and purchasing changes add money; the company’s policy decides each call. A supplier statement never invents physical receipt or a passing inspection. Under the held company policy, a person takes the decision steps in the journey below.

**Acceptance.**
1. Run a late PO through a supplier reply, failed delivery, partial receipt and inspection hold; approve messages/date changes and verify the agent keeps follow-up open until a quality person releases usable quantity.
2. Show the next chase date and triggering condition on the PO.
3. At that date, absence of a ship notice produces an external chase decided by the company’s policy; a received ship notice updates the next action without treating it as physical receipt.
4. Retain the cited supplier reply, extracted old/new ETA and authorized change.

#### AGENT-003 — Reconcile actual cost against the plan

*Tier:* Core · *Cites:* BASE-DATA-004, BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8 · *Register:* R-11

**Requirement.** An agent compares pinned estimates with actual material, labor, overhead, downtime, scrap and subcontract bills, cites repeat causes and proposes future experiments. Under RL-101, one explicitly consented minimized snapshot goes only to its exact declared processor route, selected token/USD ceilings and disclosed retention terms; source or destination changes require fresh review. The native analysis screen returns a hypothesis for a separate future engineering decision and never changes historical actuals; a native person’s approval binds that person’s exact revision. For an agent’s disclosure call, external and sensitive apply, adding money for provider spend; the company’s policy decides the call. Native-owner consent records remain exact and attributable; future revision calls carry commitment under that same company policy. Under the held company policy, a person takes the decision steps in the journey below. The [operating rules](docs/contract/OPERATING-DETAILS.md#agent-003) retain the detailed bounds and record semantics.

**Acceptance.**
1. Produce repeated high-scrap/overtime jobs, inspect cited cause/cost analysis, approve a future BOM/routing/rate revision and compare next-job results while historical variances remain unchanged.
2. Open the agent explanation for one order's quoted-to-actual result; verify its arithmetic and links to the material and time records supporting each stated cause, with missing evidence identified and the displayed source count equal to the distinct cited records.

#### AGENT-004 — Close the production to books loop

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An agent compares production, stock and financial sources to QBO, Xero and Pantry records, investigates missing or duplicate amounts and prepares exact corrections with period/cash consequences. Corrections carry money and commitment and the company’s policy decides them; closure requires accepted remote IDs and reconciled totals. Under the held company policy, a person takes the decision steps in the journey below.

**Acceptance.**
1. Lose a journal response and import a mismatched supplier bill, inspect the agent's source-to-ledger explanation, approve one correction and verify accepted remote IDs and balanced period totals with no duplicate.

#### AGENT-005 — Engineering intake from documents

*Tier:* Core · *Cites:* BASE-INPUT-002, BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An agent extracts BOMs, routings, quote needs and quality tolerances from authorized drawings, CSV, XLSX, PDF and supplier documents with page/cell citations and uncertainty. Filing the interpretation is standard and adopting a binding revision is commitment; the company’s policy decides each call. ENG-002 and ENG-005 retain pinned instructions and change outcomes. Under the held company policy, a person takes the decision steps in the journey below.

**Acceptance.**
1. Upload a real drawing/BOM with ambiguous units and malicious instruction text; inspect citations/questions, resolve and approve as engineer, then release a pinned job with no unapproved item/stock changes.

#### AGENT-006 — Cited shop-data answers

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** Staff ask why an order is late, what can be promised, where a lot went or why margin changed. Answers retain as-of time, calculations, links and explicit missing data; GOV-014 and GOV-015 govern source reach. Reversible drafts are standard, changed promises are commitment and external, and protected payroll/identity reads are sensitive; the company’s policy decides them. Model disclosure follows AGENT-003. Under the held company policy, a person takes the decision steps in the journey below.

**Acceptance.**
1. Ask the same margin/trace question as accounts and a restricted operator, inspect citations/calculation and denied rate disclosure; a follow-up request to expedite creates a standard draft, with any commitment decided by the company’s policy.

#### AGENT-007 — Forecast and inventory policy improvement

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An agent compares demand, forecast errors, lead times and yields to propose effective-dated inventory policies, backtests service/cash effects and follows observed results without rewriting forecasts. Reversible internal policy preparation is standard; purchasing consequences add money and commitment, decided by the company’s policy. Under the held company policy, a person takes the decision steps in the journey below.

**Acceptance.**
1. Backtest two policies on actual demand/receipts, review service/cash outcomes, approve one for next month and inspect observed results without modifying past forecasts.

#### AGENT-008 — Recall and quality investigation

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** An agent assembles cited genealogy, inspection/certificate evidence, affected customers and recurring defects into a containment, recall or CAPA investigation and tracks quantity reconciliation. A binding quality disposition carries commitment, outside notices external and irreversible disposal destructive; the company’s policy decides each call. Records never claim regulatory certification. Under the held company policy, a person takes the decision steps in the journey below.

**Acceptance.**
1. Introduce a failed ingredient test, inspect the proposed impacted lots/customers, approve a hold and recall notice and follow responses/returns to a quantity-balanced investigation pack.

#### AGENT-009 — Controlled agent execution and cost

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AGENT-005, BASE-AGENT-011 · *Rules:* D-2, D-3, D-4, D-6, D-8

**Requirement.** A manufacturing planning run retains its shop-record sources, selected model destination, proposed/executed manufacturing steps and outcomes; cancellation leaves pending manufacturing drafts identifiable. AGENT-003 owns bounded cost-analysis disclosure once. Under the held company policy, a person takes any decision step the planning journey returns; the equivalent agent action carries the tool table’s computed classes under the company’s policy.

**Acceptance.**
1. Run a planning task with a constrained model budget and restricted customer documents, cancel mid-run and inspect charged usage/sources and pending drafts; reject prompt injection and forbidden direct stock/role writes.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | Real-owner parallel migration/cutover and current source-export provenance from all six named incumbents | MOVE-001, MOVE-002, MOVE-003, MOVE-004, MOVE-005, MOVE-006, MOVE-007 | not run | | |
| R-2 | Production QBO/Xero organization acceptance and permitted live readback | CONN-001, CONN-002 | not run | | |
| R-3 | Live commerce, marketplace and shipping-provider accounts/app approvals | CONN-003, CONN-004, CONN-005, CONN-006, CONN-007 | not run | | |
| R-4 | Licensed vendor tenants and real CAD/nesting/machine/EDI/3PL access | CONN-008, CONN-009, CONN-010, CONN-011, CONN-012, CONN-013 | not run | | |
| R-5 | Microsoft Entra ID and Google Workspace vendor-tenant conformance receipts | GOV-003 | not run | | |
| R-6 | Human screen-reader pass | MOB-001 | not run | | |
| R-7 | VPAT | MOB-001 | not run | | |
| R-8 | iOS and Android store listings and physical-device shift observation | MOB-002 | not run | | |
| R-9 | Physical Zebra printing and hardware-scanner observation | FLOOR-008, FLOOR-009 | not run | | |
| R-10 | Claude, ChatGPT, Codex and Copilot client receipts | SURFACE-013 | not run | | |
| R-11 | Direct and separately selected routed model-provider production acceptance | AGENT-003 | not run | | |

## Boundaries

Larder is a separate manufacturing product. [Pier](https://github.com/just-every/run-pier) owns broader wholesale/distribution, [Pantry](https://github.com/just-every/run-pantry) statutory books, [Orbit](https://github.com/just-every/run-orbit) CRM, [Auth](https://github.com/just-every/run-auth) identity, [Crank](https://github.com/just-every/run-crank) cross-tool automation, [Nook](https://github.com/just-every/run-nook) team chat and [Chest](https://github.com/just-every/run-chest) document storage. LINK-001/LINK-002 and CONN-008/GOV-003 provide handoffs; shared code does not combine their products. Unowned categories are not absorbed.

QuickBooks Online, Xero or Pantry remain the general ledger and tax/financial statement authority. Payroll ([Envelope](https://github.com/just-every/run-envelope)), W-2/1099 processing, banking, ACH/card collection and supplier finance belong to Gusto/ADP, the ledger and buyer-authorized payment providers; Larder supplies approved time/cost and bill/invoice references, not a payment institution. US sales tax calculation/exemption integration is US-002; filing/remittance stays with the tax provider/accountant.

Larder does not operate machines, certify safety, grant FDA/GMP approval or replace qualified food/cosmetic/supplement quality staff. TRACE-003 through TRACE-007 deliver expiry, controlled quality records and recalls; deployment-specific electronic-record/signature validation, retention agreements and specialist eQMS/lab connections are implementation work, not grounds to omit these workflows. Supplier/lab documents and qualified decisions remain evidence.

SolidWorks and CAD/CAM tools own geometry/toolpaths; ProNest/TruTops own nesting engines and Datanomix machine observation. CONN-011 through CONN-013 and CAP-008 integrate them. Continuous-process plant control and enterprise chemical formulation are outside the chosen discrete/batch-maker category; batch recipes, yields, co-products, shelf life and trace for the chosen makers are inside it. ShipStation, SPS Commerce and 3PLs operate carrier/EDI/warehouse networks; Larder owns their manufacturing handoffs and reconciliation.

Schedules must be feasible with visible uncertainty, never described as mathematically optimal without evidence. Physical receipt, production, inspection, dispatch and destruction need named human/device evidence; a restore cannot undo a dispatched parcel, supplier order, tax commitment or external journal. US-first does not preclude foreign-currency supplier costs or customer quotes/orders (DEMAND-001): preserve original currency/rate and USD valuation, while statutory multi-entity/global consolidation belongs to external books.

Actual vendor, physical-device and human-review receipts are field proof. Standards providers, sandboxes, official-schema fakes and the seeded reference scale remain acceptance work.

## Homepage claims

| # | Claim | Clauses |
| --- | --- | --- |
| 1 | "Promise dates you can keep." (headline; closing: "Ship on the day you said.") | `DEMAND-001`, `CAP-004` |
| 2 | "plans your materials" | `LARDER-006`, `MRP-001`, `MRP-006` |
| 3 | "and machines" | `CAP-001`, `CAP-002`, `CAP-004` |
| 4 | "runs the shop floor" | `FLOOR-001`, `LARDER-009` |
| 5 | "traces every lot" | `TRACE-001`, `LARDER-008` |
| 6 | "costs every job" | `COST-001`, `LARDER-009` |
| 7 | "keeps QuickBooks in sync" | `CONN-001`, `LARDER-012` |
| 8 | "100% free, open source alternative to Katana, MRPeasy and Fishbowl" | `OPEN-001`, `MOVE-001`, `MOVE-002`, `MOVE-003`, `MRP-001`, `MRP-006`, `CAP-004`, `LARDER-008`, `LARDER-009`, `CONN-001` |
| 9 | "Walnut 8/4 · 1,240 bd ft · reserved" | `LARDER-001`, `LARDER-005` |
| 10 | "Router 2 down 2 hrs → 3 jobs moved to Router 1 · Nov 6 still on" | `AGENT-001`, `CAP-007`, `CAP-009` |
| 11 | "QC · fill weight 4.0 oz · passed" | `TRACE-004` |
| 12 | "Order margin 41.6%" | `COST-004` |
| 13 | "Lot BB-1020 · 480 tins · Oct 20 · exp Apr 2028" | `TRACE-001`, `TRACE-003` |
| 14 | "Larder checks walnut, machines and people before it offers a ship date" | `DEMAND-001`, `CAP-001`, `CAP-002` |
| 15 | "then prices the job to the cent" (Q-0412 lines, $25,010.00) | `LARDER-004`, `US-001`, `DEMAND-001` |
| 16 | Ship date options (three capable-to-promise dates) | `DEMAND-001` |
| 17 | "Sales tax · resale certificate on file" | `US-002` |
| 18 | "Est. margin 42.0%" | `DEMAND-001`, `COST-004` |
| 19 | "Confirmed Thu Oct 8 → SO-1184" | `LARDER-004` |
| 20 | "MRP explodes the bill of materials" (multilevel BOM) | `ENG-001` |
| 21 | "nets what you have and drafts what to buy, with dates" (net requirements, PO-5521, PO-5524, MO-2198) | `LARDER-006`, `MRP-001`, `MRP-006` |
| 22 | "BOM · FW-EG-1218 rev C" | `LARDER-003` |
| 23 | "2 POs approved by Dana W. · 9:31 AM" | `LARDER-007` |
| 24 | "The planning agent reads the supplier’s reply" | `AGENT-002` |
| 25 | "and hands Dana a new cut plan that still ships Nov 6" (Approved by Dana W.) | `AGENT-001`, `LARDER-015` |
| 26 | "ETA Oct 19 → Oct 23" on PO-5521 | `LARDER-007` |
| 27 | "Next chase Oct 21 if no ship notice" | `AGENT-002` |
| 28 | "Lots ... are recorded as you make" | `LARDER-008`, `LARDER-009` |
| 29 | "checks and expiry are recorded as you make" | `TRACE-003`, `TRACE-004` |
| 30 | "Trace any lot forward to every order or back to every input" (genealogy, Trace forward/back, Export trace CSV) | `TRACE-001` |
| 31 | Held lot BW-0911 "held · CoA missing", swapped for BW-0930 | `LARDER-008`, `TRACE-007` |
| 32 | "Actual $4.18/tin · plan $4.10" | `LARDER-009`, `COST-003` |
| 33 | "QC · fill weight 4.0 oz · passed", "20 sampled · avg 4.03 oz · limits 3.95–4.15" | `TRACE-004` |
| 34 | Outputs to Shopify (141 orders) and Amazon FBA | `CONN-003`, `CONN-005` |
| 35 | "Every job lands on a real machine and a real person, inside real shift hours" | `CAP-001`, `CAP-002` |
| 36 | Finite-capacity Gantt, Today line, "Unscheduled 0 · Late 0 · Bottleneck Sanding" | `CAP-004` |
| 37 | "Operators start and stop work on a tablet" | `FLOOR-001`, `FLOOR-002` |
| 38 | "scan every lot" | `FLOOR-008` |
| 39 | "log good and scrap as they go" (Good 96, Scrap 2) | `LARDER-009` |
| 40 | Phone: held lot LF-0928 refused at issue | `LARDER-008` |
| 41 | Drawing "FW-EG-1218 rev C" on the station | `ENG-002` |
| 42 | "The planning agent lays out two fixes" (Option A/B with dates and overtime) | `AGENT-001`, `CAP-007` |
| 43 | "Dana picks one" (Approved by Dana W. · 1:46 PM) | `LARDER-015`, `GOV-002` |
| 44 | Downtime timeline (spindle fault logged, released, 240/240) | `FLOOR-007`, `CAP-009` |
| 45 | "Customer dates changed: 0" | `DEMAND-005` |
| 46 | "SO-1184 · 21 cartons · out Fri Nov 6, 3:40 PM" | `LARDER-010` |
| 47 | "Wholesale, Shopify and Amazon orders ship from one list" | `LARDER-010`, `CONN-003`, `CONN-005`, `DEMAND-008` |
| 48 | "Labels, tracking ... sync as they go" | `CONN-007`, `LARDER-010`, `AUTO-003` |
| 49 | "and invoices sync as they go" | `CONN-001`, `DEMAND-007` |
| 50 | Materials column (In stock / Gift boxes · PO-5530 Nov 9) | `DEMAND-006` |
| 51 | "ShipStation · 23 labels · tracking live" | `CONN-007`, `AUTO-003` |
| 52 | "Shopify · stock updated 3:41 PM" | `CONN-003`, `AUTO-003` |
| 53 | "Amazon · FBA shipment booked" | `CONN-005` |
| 54 | "QuickBooks · Invoice 3317 · $25,010.00 · synced" | `CONN-001` |
| 55 | "Actual walnut, labor, machine time and tins, costed in dollars" | `COST-001` |
| 56 | "and posted to QuickBooks" (COGS journal synced) | `CONN-001` |
| 57 | "Order margin 41.6%" | `COST-004` |
| 58 | "Quoted 42.0% → actual 41.6%", "Variance +$103.20" | `COST-003`, `COST-004` |
| 59 | "Explained by the planning agent · 2 sources" | `AGENT-003` |
| 60 | "Bring your shop from Katana." (Katana import preview) | `MOVE-001` |
| 61 | "Items, BOMs, lots, open orders and stock values come across" | `LARDER-016`, `MOVE-004`, `MOVE-007` |
| 62 | "MRPeasy, Fishbowl, Odoo, Fulcrum and DOSS too" | `MOVE-002`, `MOVE-003`, `MOVE-004`, `MOVE-005`, `MOVE-006` |
| 63 | "Stock value $86,412.50 · matched to the cent", "2 rows to review" | `LARDER-016`, `MOVE-007` |
| 64 | `npx -y @runeditrun/rer dev just-every/run-larder` starts Larder on your computer | `OPEN-001` |
| 65 | "100% free and open source. MIT licensed." | `OPEN-001` |

## Retired clauses

| ID | Now | Reason |
| --- | --- | --- |
| LARDER-014 | moved to Base BASE-ACCESS-002; moved to Base BASE-ROLE-001; moved to Base BASE-PUBLIC-002 | Session, current-role and origin enforcement are shared duties; GOV-001 retains the manufacturing role matrix and HTTP-001 exercises its domain origin boundary. |

## Status

Judged from the code and tests at commit `c6413fa79c3368a2e4548858ef72318fb6c67613` (28 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 17 | 2 | 0 | 19 |
| Target and push further | 66 | 25 | 53 | 144 |
| All | 83 | 27 | 53 | 163 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `LARDER-001` | Items, variants, units and parties | published | done | `tests/api/flows.test.mjs` — “LARDER-001 items, variants, units and parties; ambiguous conversions are refused” |  |
| `LARDER-002` | Opening stock | published | done | `tests/api/flows.test.mjs` — “LARDER-002 opening stock by location with date, valuation basis and evidence” |  |
| `LARDER-003` | Versioned BOM and routing | published | done | `tests/api/flows.test.mjs` — “LARDER-003 versioned BOM and routing; released work keeps its revision” |  |
| `LARDER-004` | Quote and confirm | published | done | `tests/api/flows.test.mjs` — “LARDER-004 quote and confirm an order; physical, reserved and expected stock stay separate”; `tests/api/flows.test.mjs` — “LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded”; `tests/api/flows.test.mjs` — “LARDER-008 partial receipts record supplier lots and quarantine decisions”; `tests/api/flows.test.mjs` — “LARDER-009 released work issues materials and records output and scrap” |  |
| `LARDER-005` | Atomic reservation | published | done | `tests/api/flows.test.mjs` — “LARDER-005 reservations are atomic: competing orders never consume the same stock” |  |
| `LARDER-006` | Shortages | published | done | `tests/api/flows.test.mjs` — “LARDER-006 shortages are reviewed and drafted into purchase and work orders with dates and reasons” |  |
| `LARDER-007` | Purchase approval | published | done | `tests/api/flows.test.mjs` — “LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded” |  |
| `LARDER-008` | Partial receipt, lots and quarantine | published | done | `tests/api/flows.test.mjs` — “LARDER-008 partial receipts record supplier lots and quarantine decisions” |  |
| `LARDER-009` | Production | published | done | `tests/api/flows.test.mjs` — “LARDER-009 released work issues materials and records output and scrap” |  |
| `LARDER-010` | Pick, pack and partial shipment | published | done | `tests/api/flows.test.mjs` — “LARDER-010 pick, pack and partially ship against reservations; the rest stays committed” |  |
| `LARDER-011` | Customer returns | published | done | `tests/api/flows.test.mjs` — “LARDER-011 LARDER-017 LARDER-018 LARDER-019 returns, transfers and approved counts; corrections reverse, never edit” |  |
| `LARDER-017` | Free-stock transfers | published | done | `tests/api/flows.test.mjs` — “LARDER-011 LARDER-017 LARDER-018 LARDER-019 returns, transfers and approved counts; corrections reverse, never edit” |  |
| `LARDER-018` | Independently approved stock counts | published | done | `tests/api/flows.test.mjs` — “LARDER-011 LARDER-017 LARDER-018 LARDER-019 returns, transfers and approved counts; corrections reverse, never edit” |  |
| `LARDER-019` | Compensating corrections | published | done | `tests/api/flows.test.mjs` — “LARDER-011 LARDER-017 LARDER-018 LARDER-019 returns, transfers and approved counts; corrections reverse, never edit” |  |
| `LARDER-012` | Accountant handoff | published | done | `tests/api/flows.test.mjs` — “LARDER-012 handoff exports costs and invoice preparation; acknowledgements and corrections reconcile” |  |
| `LARDER-013` | Operational exception queue | published | done | `tests/api/flows.test.mjs` — “LARDER-013 LARDER-020 and AUTO-001 notes retain ongoing exceptions and the complete archive restores into an empty installation” |  |
| `LARDER-020` | Reconciled business archive | published | partial | `tests/api/flows.test.mjs` — “LARDER-013 LARDER-020 and AUTO-001 notes retain ongoing exceptions and the complete archive restores into an empty installation”; `tests/api/backup.test.mjs` — “LARDER-020 an installation backup restores into a reset installation” | The cited HTTP archive journey restores records, balances and attachments and refuses a second restore. The installation-backup journey invokes portability libraries directly. Missing: a covering export/reset/import journey through the public installation commands. |
| `LARDER-015` | Exact-version operational proposals | published | partial | `tests/api/authority.test.mjs` — “LARDER-015 agents prepare intake, replenishment, merges, reschedules and reconciliations; people approve” | The cited native proposal journey prepares and independently approves exact intake, replenishment, merge, reschedule and reconciliation records. Missing: corresponding server-computed risk classes and company-policy decisions through the agent door, including execution under an all-autonomous company policy. |
| `LARDER-016` | Odoo kit | published | done | `tests/api/move-in.test.mjs` — “LARDER-016 Odoo move-in: preview rejects with source IDs, commit journals originals, undo is dependency-safe” |  |
| `US-001` | US business and USD defaults | target | done | `tests/api/backup.test.mjs` — “US business settings retain Ohio identity, local dates and per-record currencies through restart and restore”; `tests/api/backup.test.mjs` — “AUD archive migration records exact rates, original money and stock reconciliation through restart and restore”; `tests/api/backup.test.mjs` — “AUD migration refuses missing consent, guessed rates, incompatible records and non-owner or revoked authority”; `tests/browser/journey.spec.ts` — “US business settings save Ohio identity and retain distinct EIN fields at both widths” |  |
| `US-002` | Sales tax and exemption handoff | target | missing |  | Sales tax and exemption handoff workflow and its acceptance journey are not implemented. |
| `US-003` | Guided real-order setup | target | missing |  | Guided real-order setup workflow and its acceptance journey are not implemented. |
| `ENG-001` | Multilevel BOM explosion | target | done | `tests/api/multilevel.test.mjs` — “ENG-001 three-level shared netting, stocked subassembly, phantom/yield/make-buy choices, effective cycles and immutable released recipes”; `tests/browser/multilevel.spec.ts` — “ENG-001 edit phantom/yield recipes, inspect three-level pegged shortages and pinned work at 1440/390” |  |
| `ENG-002` | Executable routings and instructions | target | done | `tests/api/routing.test.mjs` — “ENG-002 routing definitions fail atomically; pinned execution, drawings, acknowledgment, skills and predecessors survive revisions and restore”; `tests/browser/routing.spec.ts` — “ENG-002 author routing, open tablet tasks/drawing, execute dependencies and retain instructions after revision at 1440/390” |  |
| `ENG-003` | Configurable and matrix BOMs | target | done | `tests/api/engineering.test.mjs` — “ENG-003 configure two sizes and finishes through the quote, compare the resolved BOM and cost, release both, refuse an invalid choice and keep old work stable after a rule edit”; `tests/browser/engineering.spec.ts` — “ENG-003 configure two sizes and finishes on the quote, compare the resolved BOM and cost, refuse an invalid choice and draft work to both through quote and work screens” |  |
| `ENG-004` | BOM CSV export and bulk revision | target | done | `tests/api/bom-bulk.test.mjs` — “ENG-004 export ten BOMs and routings, preview CSV substitutions and dated quantities, approve atomically and keep released work pinned” |  |
| `ENG-005` | Engineering change approval and obsolescence | target | done | `tests/api/engineering.test.mjs` — “ENG-005 safety replacement review, eligibility/evidence, effectivity, stock disposition, draft treatment, acknowledgment and immutable released revisions”; `tests/browser/engineering.spec.ts` — “ENG-005 review a safety replacement, evidence and stock/work dispositions, approve effectivity, acknowledge and release at 1440/390” |  |
| `ENG-006` | Kits and sale-triggered assembly | target | done | `tests/api/engineering.test.mjs` — “ENG-006 a kit sold twice through one replayed channel event and a separate second sale assembles twice only, consumes exact components and never oversells”; `tests/browser/engineering.spec.ts` — “ENG-006 prepare and approve a kit, then record a channel sale twice with one event id and once more, and see two assemblies and no oversell at 1440/390” |  |
| `ENG-007` | Catalog export, bulk edit and re-import | target | done | `tests/api/catalog.test.mjs` — “ENG-007 export/edit catalog by Larder ID at two locations, preview all field/record impacts and errors, approve valid groups atomically and preserve blanks, units, history and stale protection”; `tests/browser/catalog.spec.ts` — “ENG-007 real catalog export/edit/preview/approve/re-export with two locations, errors, preserved history and stale refusal at 1440/390” |  |
| `ENG-008` | Tracking policy selection | target | done | `tests/api/catalog.test.mjs` — “ENG-008 approved catalog batch and serial policies govern receipt, issue, output and shipment without unsafe stock changes”; `tests/browser/catalog.spec.ts` — “ENG-007 real catalog export/edit/preview/approve/re-export with two locations, errors, preserved history and stale refusal at 1440/390” |  |
| `DEMAND-001` | Costed quotes and credible promise dates | target | partial | `tests/api/flows.test.mjs`; `tests/browser/order-amendments.spec.ts` | The cited costed-quote journeys cover configured items, fractional currency arithmetic and reasoned review disposition through the page. Missing: immediate/partial/overtime alternatives with distinct cost, margin and date outcomes; exact acceptance with current material, machine, qualified-person and upstream/quality checks; once-only supply and capacity bookings; customer-currency confirmation/invoice and complete preparation audit/export/restore. Unsupported alternatives remain explicit. |
| `DEMAND-002` | Order changes and cancellations | target | done | `tests/api/order-amendments.test.mjs` — “DEMAND-002 approved amendments split promises, preserve issued terms and production costs, cancel only unconsumed commitments, and reject stale or unsafe changes”; `tests/api/order-amendments.test.mjs` — “DEMAND-002 dated quantities net once, stale review is refused, and unpick resolves a blocked cancellation without posting stock”; `tests/browser/order-amendments.spec.ts` — “DEMAND-002 customer-approved split dates, prospective prices and cancellation retain shipments and incurred work at 1440/390” |  |
| `DEMAND-003` | Master production schedule and forecasts | target | done | `tests/api/forecast.test.mjs` — “DEMAND-003 DEMAND-004 twelve-week CSV forecast, order consumption, seasonal overrides/undo, error, approved stale-safe MPS and real supply linkage”; `tests/browser/forecast.spec.ts` — “DEMAND-003 DEMAND-004 import twelve weeks, consume real orders, adjust and undo forecasts, review and release linked MPS at 1440/390” |  |
| `DEMAND-004` | Make-to-stock and make-to-order policies | target | done | `tests/api/inventory.test.mjs` — “DEMAND-004 stock/order/assembly policies, catalog location settings, reviewed common stock and exact customer-pegged batches”; `tests/api/inventory.test.mjs` — “DEMAND-004 approve stock batches, retain unused common inventory and locate late/open supply without duplicating it”; `tests/api/forecast.test.mjs` — “DEMAND-003 DEMAND-004 twelve-week CSV forecast, order consumption, seasonal overrides/undo, error, approved stale-safe MPS and real supply linkage”; `tests/browser/inventory.spec.ts` — “DEMAND-004 compare same demand under stock/order policies, approve exact batches, inspect customer pegs and inventory floors at 1440/390”; `tests/browser/forecast.spec.ts` — “DEMAND-003 DEMAND-004 import twelve weeks, consume real orders, adjust and undo forecasts, review and release linked MPS at 1440/390” |  |
| `DEMAND-005` | Allocation priority and customer commitments | target | done | `tests/api/flows.test.mjs` — “DEMAND-005 reviewed receipt split shows displacement, both promises and estimated margins, then atomically reserves exact totals without stock or promise changes”; `tests/api/flows.test.mjs` — “DEMAND-005 stale, overallocated, duplicated and picked receipt splits refuse without changing hard reservations”; `tests/api/flows.test.mjs` — “DEMAND-005 sales, planners, managers and agents cannot take reservation approval authority through the command API”; `tests/browser/order-amendments.spec.ts` — “DEMAND-005 owner reviews and approves an exact receipt reservation split at 1440/390” |  |
| `DEMAND-006` | Live order material and production status | target | done | `tests/api/order-status.test.mjs` — “DEMAND-006 next-read ranked SO/MO status recomputes receipts, quarantine, current ETAs, rank, reservations, cancellations and production without planning”; `tests/browser/order-status.spec.ts` — “DEMAND-006 both ranked lists update material and production status after receipt, ETA and re-rank at 1440/390” |  |
| `DEMAND-007` | Order invoicing and payment status | target | partial | `src/larder/handoff.ts`; `src/larder/sales.ts`; `tests/api/flows.test.mjs` | Shipment-driven invoice preparation lines valued at the order price, with ledger acknowledgment and linked corrections for reversed shipments, ship in the accountant handoff; invoice records per order, Invoice all/some, bulk and automatic invoicing, refusal of unshipped quantity, invoice and payment status columns with filters, provider payment readback and the overdue release check are absent. |
| `DEMAND-008` | One fulfillment list across sales channels | target | missing |  | The common wholesale/Shopify/Amazon fulfillment list, channel identity, channel import and connected shipment journeys are not implemented. |
| `MRP-001` | Time-phased demand netting | target | done | `tests/api/mrp-feasibility.test.mjs` — “MRP-001 released work nets demand on its completion day only while every pinned input is covered, explodes only the remainder and recovers when a PO lands before its inputs are needed”; `tests/api/mrp-feasibility.test.mjs` — “MRP-001 proven work chains through multilevel jobs and is followed to the demand it supplies”; `tests/api/mrp-feasibility.test.mjs` — “MRP-001 bought suggestions follow the supplier calendar, lead working days, MOQ and pack, and restore an uncovered floor from dated supply”; `tests/api/multilevel.test.mjs` — “MRP-001 dated physical and PO pools never cover earlier demand with late, held, expired, overdue or draft supply”; `tests/api/multilevel.test.mjs` — “MRP-001 protects each reservation bin on its demand date, pins released inputs and restores the read-only projection without treating unproven WIP as feasible supply”; `tests/api/multilevel.test.mjs` — “MRP-001 current safety floors share bins once, follow catalog edits, protect hard commitments and never treat expected or held stock as physical cover”; `tests/api/multilevel.test.mjs` — “MRP-001 dated multilevel pegs share stock and ETA pools, honor make/buy/phantom and aggregate yields, and disclose unresolved work without duplicate explosion”; `tests/api/multilevel.test.mjs` — “MRP-001 manufacturing offsets reject completion-day material, follow multilevel full-batch routing and keep released timing pinned across edits and restore”; `tests/browser/journey.spec.ts` — “HTTP-001 MRP-001 public Lobby, health and docs stay separate from private app and exports” |  |
| `MRP-006` | Draft from a dated material suggestion | target | done | `tests/api/multilevel.test.mjs` — “MRP-006 dated drafts preserve reviewed quantities, release dates and source paths with stale, duplicate, policy and live-authority guards across restart and restore” |  |
| `MRP-002` | Demand pegging and supply changes | target | done | `tests/api/multilevel.test.mjs` — “MRP-002 follows shared dated supply to customer demand and back through PO lines and received lots without changing commitments” |  |
| `MRP-007` | Decide supply-change recommendations | target | done | `tests/api/supply-changes.test.mjs` — “MRP-007 a delayed component PO recommends an expedite naming the orders it hurts, cancelling a demand turns surplus into a cancel only a manager approves, and no reservation is orphaned”; `tests/api/supply-changes.test.mjs` — “MRP-007 supply that lands weeks before its demand recommends a deferral to the day it is first needed and an approved deferral is only a recorded request, and the supplier's confirmation lands beside it as its own date, audited”; `tests/api/supply-changes.test.mjs` — “MRP-007 a cancel worth at least the PO spend threshold needs the policy signatures on the exact cancellation, a smaller one keeps the manager alone, and the owner decides too” |  |
| `MRP-003` | Replenishment forecasts and purchasing constraints | target | done | `tests/api/flows.test.mjs` — “Replenishment revises MOQ and uncertain lead bounds, explains dated coverage and USD cash, approves selected suggestions and retains rejected reasons”; `tests/browser/maintenance.spec.ts` — “Replenishment reviews revised MOQ and uncertain coverage/cash, selectively approves and retains rejected reasons at 1440/390” |  |
| `MRP-004` | Planning scenarios and release fence | target | done | `tests/api/flows.test.mjs` — “Isolated outage scenarios protect this week and manual locks, atomically book next week and reject an ETA-stale adoption without a partial schedule”; `tests/browser/maintenance.spec.ts` — “Frozen recovery and isolated outage scenarios retain locks, show displacement and reject stale adoption at 1440/390” |  |
| `MRP-005` | Supply-change act leg | target | missing |  | Updating the PO line's promised date or quantity from an approved supply change and reaching the supplier by email or portal is not implemented; it depends on BUY-001 and BUY-007. |
| `CAP-001` | Work-center calendars | target | done | `tests/api/flows.test.mjs` — “CAP-001 persisted overnight holiday calendars, breaks, outages, efficiency and parallel named machine intervals survive archive restore”; `tests/browser/maintenance.spec.ts` — “CAP calendars and finite planning: named intervals, holiday outage and vacation, rates, critical path and count drilldowns at 1440/390” |  |
| `CAP-002` | Labor calendars and skills | target | done | `tests/api/flows.test.mjs` — “CAP-002 one qualified person constrains two machines independently, vacation and task limits hold, rates are restricted and revocation blocks replay”; `tests/browser/maintenance.spec.ts` — “CAP calendars and finite planning: named intervals, holiday outage and vacation, rates, critical path and count drilldowns at 1440/390” |  |
| `CAP-003` | Operation dependencies and blocked work | target | done | `tests/api/dispatch.test.mjs` — “CAP-003 pinned material, predecessor, overlap, actual transfer-batch and QC gates agree at dispatch/start and survive restart/restore”; `tests/browser/dispatch.spec.ts` — “CAP-003 configure and execute material, transfer, overlap and QC dependencies through tablet dispatch at 1440/390” |  |
| `CAP-004` | Finite-capacity Gantt and bottlenecks | target | done | `tests/api/flows.test.mjs` — “CAP-004 finite multistep plan exposes critical path, load and truthful late/unscheduled drilldowns without overbooking or changing promises”; `tests/browser/maintenance.spec.ts` — “CAP calendars and finite planning: named intervals, holiday outage and vacation, rates, critical path and count drilldowns at 1440/390” |  |
| `CAP-005` | Drag and drop rescheduling | target | done | `tests/api/flows.test.mjs` — “CAP-005 finite reschedule previews displacement and unchanged promises, requires independent approval and rejects shop-floor stale inputs or capacity conflicts”; `tests/browser/maintenance.spec.ts` — “CAP calendars and finite planning: named intervals, holiday outage and vacation, rates, critical path and count drilldowns at 1440/390” |  |
| `CAP-006` | Alternate centers and sequence-dependent setups | target | done | `tests/api/flows.test.mjs` — “Qualified alternate comparison keeps pinned instructions, setup transitions, tools, labor, delivery and USD estimates through approval and restore”; `tests/browser/maintenance.spec.ts` — “Qualified alternates compare setup, tools, labor, delivery and cost before human approval at 1440/390” |  |
| `CAP-007` | Live dependency-preserving reflow | target | done | `tests/api/flows.test.mjs` — “Event recovery persists once after restart, preserves frozen and manual work, exposes displacement and refuses automatic or external authority”; `tests/api/flows.test.mjs` — “Bounded grants independently authorize one internal reflow, stop at limits or lost authority, and restore inactive without replay”; `tests/browser/maintenance.spec.ts` — “Frozen recovery and isolated outage scenarios retain locks, show displacement and reject stale adoption at 1440/390” |  |
| `CAP-008` | Grouped jobs and nesting | target | partial | `tests/api/flows.test.mjs`; `tests/browser/work-transfers.spec.ts` | Pending unissued released jobs and one owned source material lot are supported through the command API. Shared setup observations now support an optional isolated single-operation finite comparison with one shared setup, original-job links, displacement and explicit infeasibility. It does not book capacity. Combined finite setup booking, broader batch stages and quality-controlled source recovery remain. Grouping, original-file import, exact allocation review, owner approval and cancellation now have work-order page controls. Recovered offcuts retain the source lot dates, including expiry and retest, through archive restore; the owner-approved nesting HTTP journey asserts the actual nested dates. Owner-only exact audited physical nesting approval is approved by ct; changed nests need fresh approval, with no shared setup-booking authority. Combined finite setup booking and the remaining batch and quality behavior are unproved. |
| `CAP-009` | Maintenance and downtime planning | target | done | `tests/api/maintenance.test.mjs` — “CAP-009 preventive maintenance and breakdowns retain repair/CMMS evidence, block equipment beyond ETA and release with authority”; `tests/browser/maintenance.spec.ts` — “CAP-009 schedule maintenance, log breakdown, assign repair/ETA, inspect recovery, evidence-backed release and retained trail at 1440/390” |  |
| `BUY-001` | Supplier contracts and delivery rules | target | done | `tests/api/flows.test.mjs` — “BUY-001 supplier constraints, feasible quote and scheduled approval survive supplier revisions and restore”; `tests/browser/journey.spec.ts` — “BUY-001 buyers maintain two suppliers, select feasible scheduled terms and recover approval history at 1440/390” |  |
| `BUY-002` | Receiving against production demand | target | done | `tests/api/receiving.test.mjs` — “BUY-002 a short delivery for two pegged jobs quarantines the damaged units, keeps supplier documents, allocates only the accepted stock to the jobs and shows the late remainder as an expedite”; `tests/api/receiving.test.mjs` — “BUY-002 a line tolerance accepts a small over-delivery, refuses more, and a delivery within it offers the manager a close of the remainder”; `tests/api/receiving.test.mjs` — “BUY-002 the buyer sets a line tolerance up to 20 percent with the setting audited, above 10 percent on a PO at or above the spend threshold it needs the policy signatures, and damaged units never reopen a received PO”; `tests/api/receiving.test.mjs` — “BUY-002 accepted stock needed only through a make path is listed as skipped and reserved for nobody, and allocation stays a person's act” |  |
| `BUY-003` | Purchasing approvals and three-way match | target | partial | `src/larder/purchasing.ts`; `src/larder/roles.ts`; `tests/api/authority.test.mjs`; `tests/api/flows.test.mjs`; `src/ui/purchase-accounting.tsx`; `src/larder/trace-graph.ts`; `tests/browser/receiving.spec.ts` | Native capture, independent resolution, local owner handoff and billing displays ship. Missing journey: supplier-category routing, quantity/currency variance decisions and all exact CT decision-input riders, authoritative bill posting, ledger conversion and QBO/Xero payment readback. |
| `BUY-004` | Subcontract and free-issue production | target | done | `tests/api/subcontract.test.mjs` — “TRACE-001 / BUY-004 two-lot free issue, partial good/scrap, service bill, customer ownership and finished-lot genealogy” |  |
| `BUY-005` | Landed costs | target | partial | `src/larder/purchasing.ts`; `src/larder/handoff.ts`; `tests/api/flows.test.mjs`; `tests/browser/receiving.spec.ts`; `tests/api/flows.test.mjs`; `src/ui/purchase-accounting.tsx`; `src/larder/trace-graph.ts`; `tests/browser/receiving.spec.ts` | Native quantity/value/weight allocations and exact once-only handoff corrections ship. Missing journey: completed-production and return attribution, valuation-subledger correction, all CT decision-input riders and correcting QBO/Xero journals with reconciliation/readback. |
| `BUY-006` | Supplier returns and credits | target | partial | `src/larder/purchasing.ts`; `src/larder/handoff.ts`; `tests/api/flows.test.mjs`; `tests/browser/receiving.spec.ts`; `tests/api/flows.test.mjs`; `src/ui/purchase-accounting.tsx`; `src/larder/trace-graph.ts`; `tests/browser/receiving.spec.ts` | Native claims, dispatched quantities, quarantined replacement genealogy and local credit closure ship. Missing journey: authoritative supplier credit matching/reconciliation/readback and all CT decision-input riders. |
| `BUY-007` | Supplier and customer communications | target | missing |  | Supplier and customer communications workflow and its acceptance journey are not implemented. |
| `BUY-008` | Allocation of accepted receipts to make-path demand | target | done | `tests/api/receiving.test.mjs` — “BUY-008 accepted receipt stock is allocated by hand to a released job that makes the product, never to draft, held or closed jobs, never quarantined stock, and reserved stock only by a manager or the owner with a reason” |  |
| `BUY-009` | Requested and supplier-confirmed dates on a PO line | target | done | `tests/api/supply-changes.test.mjs` — “MRP-007 supply that lands weeks before its demand recommends a deferral to the day it is first needed and an approved deferral is only a recorded request, and the supplier's confirmation lands beside it as its own date, audited” |  |
| `FLOOR-001` | Tablet and phone dispatch | target | done | `tests/api/dispatch.test.mjs` — “FLOOR-001 assigned dispatch gates, station/reason history, authority, replay and legacy migration through public doors”; `tests/browser/dispatch.spec.ts` — “FLOOR-001 dispatch two jobs, deny blocked work, execute named station reasons and reauthenticate a shared station at 1440/390” |  |
| `FLOOR-002` | Actual labor and operation time | target | partial | `src/larder/time-entries.ts`; `src/larder/scheduling/labor-costs.ts`; `src/larder/api.ts`; `src/ui/time-clock.tsx`; `src/ui/work-operations.tsx`; `tests/api/downtime.test.mjs`; `tests/browser/downtime.spec.ts` | The cited clock/correction journeys show setup, run, pauses, period locks and retained costing. Missing journey: identify a fallback as an assumption where historical rate authority is absent and recover an overlong refused span as complete actual worked segments under RL-102; no payroll posting. |
| `FLOOR-003` | WIP and manufacturing backorders | target | done | `tests/api/wip.test.mjs` — “FLOOR-003 six of ten complete at operation one, four handed on, two held, four backordered with dated commitments, through public doors”; `tests/browser/wip.spec.ts` — “FLOOR-003 six of ten complete, four handed on, two held and four backordered, inspected at 1440/390” |  |
| `FLOOR-004` | Rework repair and unbuild | target | done | `tests/api/rework.test.mjs` — “TRACE-001 / FLOOR-004 return defective assemblies, unbuild recovered parts, repair the rest with extra material/labor and ship approved output preserving cost and genealogy”; `tests/browser/rework.spec.ts` — “FLOOR-004 return defective assemblies, authorize unbuild and repair, recover parts, add material/labor and ship approved repair at 1440/390” |  |
| `FLOOR-005` | Split and merge manufacturing orders | target | done | `tests/api/work-transfers.test.mjs` — “TRACE-001 / FLOOR-005 split partly completed work between centers and merge compatible remaining WIP without duplicating quantities, demand, lots, time, costs or reservations”; `tests/browser/work-transfers.spec.ts` — “FLOOR-005 split partly completed work across two centers, merge remaining WIP and reconcile original demand, lots, time and costs at 1440/390” |  |
| `FLOOR-006` | Co-products and by-products | target | partial | `tests/api/work-transfers.test.mjs`; `tests/browser/work-transfers.spec.ts` | Implemented: planned and actual yields, separate lot dispositions and destinations, exact component-lot links and cost allocation, six-place total output value equal to actual cost, evidenced release and by-product reuse, trace and archive. ct APPROVED 25 October: owner approves exact six-decimal values and explicitly posts; managers, accounts and the GOV-001 planner prepare inert drafts; no automatic posting. Rounding residue up to USD 0.000001 per output goes to the final planned output and is shown on review and posted result; larger differences or inexact unit costs refuse. Any changed business records permanently void the draft; edited review inputs require fresh review and owner approval. FLOOR-010 supplies standard-cost and variance allocation; FLOOR-006 stays partial pending its separate completion review. Named page journey proves planned outputs, exact reviewed inputs and values, explicit owner posting, per-output inspection and evidenced by-product release at 1440 and 390. |
| `FLOOR-007` | Downtime reasons and production progress | target | done | `tests/api/downtime.test.mjs` — “FLOOR-007 broken-tool pause, supervisor notice/ack, real intervals, progress history and unchanged physical completion”; `tests/browser/downtime.spec.ts` — “FLOOR-007 pause for broken tool, notify supervisor in app, revise effort, inspect lost time and changed plan at 1440 with both-width proof” |  |
| `FLOOR-008` | Barcode scanning workflows | target | done | `tests/api/receiving.test.mjs` — “FLOOR-008 scanned GS1 codes resolve item, lot, expiry and serial for receipt, issue and pick; wrong, held, stale and duplicate scans are refused without a movement”; `tests/browser/receiving.spec.ts` — “FLOOR-008 hardware and camera receipt, issue and pick refuse wrong, held, stale and duplicate scans without an extra movement at 1440/390” |  |
| `FLOOR-009` | Zebra and printable labels | target | missing |  | Zebra and printable labels workflow and its acceptance journey are not implemented. |
| `FLOOR-010` | Standard-cost and variance allocation | target | done | `tests/api/work-transfers.test.mjs` — “FLOOR-006 exact multiple-output batch values, lot consumption, quality release and reusable by-product survive archive restore”; `tests/api/work-transfers.test.mjs` — “FLOOR-006 refuses unauthorized, stale, nonconserving and reused input allocations without physical posting”; `tests/browser/work-transfers.spec.ts` — “FLOOR-006 plan, review and approve two co-products and a reusable by-product at both widths” |  |
| `TRACE-001` | Lot and batch genealogy | target | done | `tests/api/subcontract.test.mjs` — “TRACE-001 / BUY-004 two-lot free issue, partial good/scrap, service bill, customer ownership and finished-lot genealogy”; `tests/api/trace.test.mjs` — “TRACE-001 exact batch allocations isolate forward/backward recall and refuse incomplete or reused component lots”; `tests/api/work-transfers.test.mjs` — “TRACE-001 / FLOOR-005 split partly completed work between centers and merge compatible remaining WIP without duplicating quantities, demand, lots, time, costs or reservations”; `tests/api/rework.test.mjs` — “TRACE-001 / FLOOR-004 return defective assemblies, unbuild recovered parts, repair the rest with extra material/labor and ship approved output preserving cost and genealogy”; `tests/browser/trace.spec.ts` — “TRACE-001 legacy disclosure, evidenced allocation and exact continuation at 1440/390”; `tests/browser/trace.spec.ts` — “TRACE-001 upstream/downstream trace and matching physical CSV at 1440/390” |  |
| `TRACE-002` | Serial-number lifecycle | target | done | `tests/api/trace.test.mjs` — “TRACE-002 serialized components assemble into two serialized products; one ships and returns with exact customer and component history; duplicate and shipped serials are refused”; `tests/browser/trace.spec.ts` — “TRACE-002 receive, assemble, ship, return and service serials with exact customer and component history at 1440/390” |  |
| `TRACE-003` | Expiry and FEFO | target | partial | `tests/api/expiry.test.mjs` — “TRACE-003 dated lots plan and pick FEFO for a customer shelf-life rule; expired and retest-due stock stays blocked until a documented disposition”; `tests/browser/expiry.spec.ts` — “TRACE-003 receive dated lots, pick FEFO for a customer shelf-life rule and dispose of an expired lot at 1440/390” | The cited expiry journeys pick FEFO, refuse already-expired/retest-due stock and inspect alerts and evidenced disposition. Missing: advance a previously usable lot past its expiry and then read its blocked stock and alert before disposition. |
| `TRACE-004` | Quality checkpoints and measurements | target | done | `tests/api/quality.test.mjs` — “TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest”; `tests/browser/quality.spec.ts` — “TRACE-004 define and approve a fill-weight plan, record passing and failing batches, see the dispatch hold, retest and release at 1440/390” |  |
| `TRACE-005` | Nonconformance and disposition | target | done | `tests/api/authority.test.mjs` — “GOV-001 TRACE-005 quality role inherits TRACE-003/004/006/007 authority with independence and live revocation, and nothing outside quality”; `tests/api/quality.test.mjs` — “TRACE-005 quantity-scoped cases retain complaints, CAPA, supplier/rework routing, passing-only independent release and evidenced effectiveness across restart and restore”; `tests/browser/quality.spec.ts` — “TRACE-005 contain part of a lot, record CAPA and supplier action, release only inspected units and close with effectiveness at 1440/390” |  |
| `TRACE-008` | Evidenced use-as-is deviation | target | done | `tests/api/quality.test.mjs` — “TRACE-008 quality-role deviations: exact proposals, independent approval and gated atomic execution release only held units under deviation, with trace, shipment pack, restart and archive restore”; `tests/browser/quality.spec.ts` — “TRACE-008 owner proposes a deviation; an independent quality-role holder approves and releases only held units under deviation, with trace and reload at 1440/390” |  |
| `TRACE-006` | Recall execution and reconciliation | target | partial | `src/larder/recall.ts`; `src/larder/recall-policy.ts`; `src/larder/stock.ts`; `tests/api/quality.test.mjs`; `tests/browser/quality.spec.ts` | Public API source-lot containment, genealogy expansion, two-customer exposure download, protected stock/WIP and matching dispatch/start gates with restart/archive restore ship. Approved notices and real delivery, acknowledgments, returned/destroyed/unrecovered/cleared reconciliation, customer-property/vendor custody, unlotted legacy reconciliation, recall management screens and final complete compliance pack remain unimplemented. |
| `TRACE-007` | Certificates and controlled release records | target | done | `tests/api/certificates.test.mjs` — “TRACE-007 controlled receipt and finished lots require exact approved certificates; shipment export pins original versions and trace”; `tests/browser/certificates.spec.ts` — “TRACE-007 require CoA and CoC, refuse a mismatched lot, approve exact records, release/ship and download pinned versions at 1440/390” |  |
| `STOCK-001` | Bins sites and replenishment | target | done | `tests/api/flows.test.mjs` — “STOCK-001 transit receipt and ruled putaway conserve lots, refuse unsafe bins and replenish exactly within current site scope” (two-site transfer, unavailable transit, exact one-time receipt, lot and quality and capacity refusals, exact replenishment, live scope including later-added bins and narrowed replay, rule and transit archive restore, outstanding transit after restart and inert restore, explicit one-time receipt after restore and changed-content refusal); “STOCK-001 customer-owned and consigned custody stays separate from owned availability, honors capacity and live site scope and survives restore” (separate owner balances, no owned movement or availability, capacity, all custody doors and site configuration refusals, restricted cross-site derived totals, narrowed replay, original custody records restored); `tests/browser/work-transfers.spec.ts` — “STOCK-001 receive unavailable transit, put away and replenish by rule and reconcile separate property through the warehouse screens” (Settings rules, transit and received states, putaway and capacity refusal, replenishment and separate ownership reconciliation at 1440; browser proof at 1440 and 390) | |
| `STOCK-002` | Cycle counts and stocktake | target | done | `tests/api/counts.test.mjs` — “STOCK-002 blind busy-bin stocktake rejects stale counts, retains recounts and independently approves exact quantity/value adjustments”; `tests/browser/counts.spec.ts` — “STOCK-002 schedule, blind count, busy-bin stale refusal, recount and independent valued approval at 1440/390” |  |
| `STOCK-004` | Batch and wave picking | target | done | `tests/api/flows.test.mjs` — “STOCK-004 exact bin-sequenced wave sorts three orders and carries current site scope”; `tests/browser/work-transfers.spec.ts` — “STOCK-004 review a bin-sequenced three-order wave and sort exact picks at both widths” |  |
| `COST-001` | Actual job costing | target | done | `tests/api/flows.test.mjs` — “COST-001 approved time overtime and service costs roll through scrap and downstream work as correcting valuations”; `tests/api/flows.test.mjs` — “COST-001 unvalued production lots keep weighted average until an actual valuation is approved”; `tests/browser/journey.spec.ts` — “COST reports retain shipment margins, job source drills and missing performance evidence at 1440/390” |  |
| `COST-002` | WIP valuation and aging | target | partial | `src/larder/costing/wip.ts`; `tests/api/wip.test.mjs` | Recorded material WIP now has explicit-period opening, additions, output transfers, scrap, closing, source transactions, aging, exact partial-batch allocations, atomic repair and owned subcontract receipts through the report API and CSV. Remaining: production labor and overhead, later valuation corrections, operation-level allocation, WIP screens, and inventory and external WIP control-account reconciliation. Historical output without exact component allocations stays explicitly unresolved; no account balance is inferred. |
| `COST-003` | Estimate to actual variance | target | done | `tests/api/flows.test.mjs` — “COST-003 component usage and price variances reconcile two jobs to one order and export their sources”; `tests/browser/journey.spec.ts` — “COST reports retain shipment margins, job source drills and missing performance evidence at 1440/390” |  |
| `COST-004` | Order and customer margins | target | done | `tests/api/flows.test.mjs` — “COST-004 shipment and return margins keep open commitments, channel/customer totals and costs scope”; `tests/browser/journey.spec.ts` — “COST reports retain shipment margins, job source drills and missing performance evidence at 1440/390” |  |
| `COST-005` | Inventory valuation and close controls | target | partial | `src/larder/stock.ts`; `src/larder/handoff.ts`; `tests/api/flows.test.mjs` | Weighted-average cost and valued movements/CSV corrections ship; FIFO, close locks and live-ledger tie-out are absent. |
| `COST-006` | Production and supplier performance | target | done | `tests/api/flows.test.mjs` — “COST-006 COST-008 filtered performance retains denominators and missing clocks, receipt rejects and in-app scheduled snapshots”; `tests/browser/journey.spec.ts` — “COST reports retain shipment margins, job source drills and missing performance evidence at 1440/390” |  |
| `COST-008` | Session-bound report snapshots | target | done | `tests/api/flows.test.mjs` — “COST-006 COST-008 filtered performance retains denominators and missing clocks, receipt rejects and in-app scheduled snapshots”; `tests/browser/journey.spec.ts` — “COST reports retain shipment margins, job source drills and missing performance evidence at 1440/390” |  |
| `COST-007` | Custom reports and documents | target | missing |  | Custom reports and documents workflow and its acceptance journey are not implemented. |
| `CONN-001` | QuickBooks Online live sync | target | missing |  | QuickBooks Online live sync workflow and its acceptance journey are not implemented. |
| `CONN-002` | Xero live sync | target | missing |  | Xero live sync workflow and its acceptance journey are not implemented. |
| `CONN-003` | Shopify orders and stock | target | missing |  | Shopify orders and stock workflow and its acceptance journey are not implemented. |
| `CONN-004` | WooCommerce orders and stock | target | missing |  | WooCommerce orders and stock workflow and its acceptance journey are not implemented. |
| `CONN-005` | Amazon demand and fulfillment | target | missing |  | Amazon demand and fulfillment workflow and its acceptance journey are not implemented. |
| `CONN-006` | BigCommerce and eBay orders and stock | target | missing |  | BigCommerce and eBay orders and stock workflow and its acceptance journey are not implemented. |
| `CONN-007` | ShipStation and Shippo labels and tracking | target | missing |  | ShipStation and Shippo labels and tracking workflow and its acceptance journey are not implemented. |
| `CONN-008` | HubSpot, Salesforce and Pipedrive deal-to-order | target | missing |  | HubSpot, Salesforce and Pipedrive deal-to-order workflow and its acceptance journey are not implemented. |
| `CONN-009` | SPS Commerce EDI | target | missing |  | SPS Commerce EDI workflow and its acceptance journey are not implemented. |
| `CONN-010` | Third-party warehouse reconciliation | target | missing |  | Third-party warehouse reconciliation workflow and its acceptance journey are not implemented. |
| `CONN-011` | SolidWorks BOM and drawing intake | target | missing |  | SolidWorks BOM and drawing intake workflow and its acceptance journey are not implemented. |
| `CONN-012` | ProNest and TruTops nesting intake | target | missing |  | ProNest and TruTops nesting intake workflow and its acceptance journey are not implemented. |
| `CONN-013` | Datanomix machine observations | target | missing |  | Datanomix machine observations workflow and its acceptance journey are not implemented. |
| `CONN-014` | Versioned public API and webhooks | target | partial | `src/larder/public-api.ts`; `src/larder/service-keys.ts`; `API.md`; `tests/api/authority.test.mjs` | Versioned resource reads and exact native-owner bounded read credentials ship. Missing journeys: scoped service writes, remaining planning/cost/migration resources, signed durable outbound events and owned failure follow-up, and the policy-governed MCP door. |
| `CONN-015` | Zapier workflow integration | target | missing |  | Zapier workflow integration workflow and its acceptance journey are not implemented. |
| `AUTO-001` | Owned exception follow-up | target | done | `tests/api/follow-up.test.mjs` — “AUTO-001 and LARDER-013 owned cases survive restart and close only after accepted material, completed work, shipment and exact ledger reconciliation”; `tests/api/flows.test.mjs` — “LARDER-013 LARDER-020 and AUTO-001 notes retain ongoing exceptions and the complete archive restores into an empty installation”; `tests/browser/follow-up.spec.ts` — “AUTO-001 LARDER-013 assign, evidence, in-app escalation and source-cleared history at 1440/390” |  |
| `AUTO-002` | Scheduled alerts and action policies | target | missing |  | Scheduled alerts and action policies workflow and its acceptance journey are not implemented. |
| `AUTO-003` | Integration repair queue | target | missing |  | Integration repair queue workflow and its acceptance journey are not implemented. |
| `MOVE-001` | Katana move-in | target | missing |  | Katana move-in workflow and its acceptance journey are not implemented. |
| `MOVE-002` | MRPeasy move-in | target | missing |  | MRPeasy move-in workflow and its acceptance journey are not implemented. |
| `MOVE-003` | Fishbowl Manufacturing move-in | target | missing |  | Fishbowl Manufacturing move-in workflow and its acceptance journey are not implemented. |
| `MOVE-004` | Complete Odoo Manufacturing move-in | target | partial | `src/larder/odoo/map.ts`; `src/larder/odoo/imports.ts`; `MOVE-IN.md`; `tests/api/move-in.test.mjs` | Basic Odoo CSV kit is tested; manufacturing state, work centers, QC, expiry, actual time and full WIP migration are absent. |
| `MOVE-005` | Fulcrum move-in | target | missing |  | Fulcrum move-in workflow and its acceptance journey are not implemented. |
| `MOVE-006` | DOSS move-in | target | missing |  | DOSS move-in workflow and its acceptance journey are not implemented. |
| `MOVE-007` | Migration rehearsal and parallel cutover | target | partial | `tests/api/move-in.test.mjs` — “MOVE-007 rehearsed Odoo move-in reconciles stock value to the cent, blocks cutover until a difference is accepted, then routes live orders to one system”; `tests/browser/cutover.spec.ts` — “MOVE-007 preview shows the stock valuation to the cent and the cutover is rehearsed twice at 1440/390” | The cited Odoo migration journey previews, rehearses twice, reconciles valuation, compares the day, routes cutover and refuses undo after shipment. Missing: equivalent staging/valuation/cutover journeys for every other named importer; these source-format workflows remain required, with real-owner cutover receipts recorded separately. |
| `MOVE-008` | History attachments and portable exports | target | done | `tests/api/backup.test.mjs` — “MOVE-008 source history searches original IDs/files, exports every record and restores without credentials or remote actions”; `tests/browser/history.spec.ts` — “MOVE-008 preview and commit source history, find closed job/lot, download original and portable exports at 1440/390” |  |
| `OPEN-001` | Free MIT-licensed software, run by one command | target | partial | `LICENSE`; `rer-project.json`; `src/site/run.json`; `rer-setup.json`; `scripts/installer/local.mjs`; `tests/browser/journey.spec.ts` | MIT source and the published command ship. Mail and identity setup disclose provider-plan charges; owner-account deployment discloses Cloudflare usage charges before provider work. Clean-directory execution is unproved: pinned rer 0.2.80 completes the native owner claim but its owned-process cleanup fails during setup. Under the Base hold, no pin change is made. Complete launch and mail and hosting connection-door proof remain pending; future CONN-001 through CONN-015 inherit pre-connection provider-fee disclosure. |
| `GOV-001` | Manufacturing roles and permissions | target | done | `tests/api/authority.test.mjs` — “GOV-001 roles and sessions are checked on every command and read”; `tests/api/authority.test.mjs` — “GOV-001 TRACE-005 quality role inherits TRACE-003/004/006/007 authority with independence and live revocation, and nothing outside quality”; `tests/api/authority.test.mjs` — “GOV-001 planner role inherits DEMAND-003 forecast/MPS, DEMAND-004 policy and FLOOR-005 split/merge authority with independent approval, and nothing outside planning”; `tests/api/authority.test.mjs` — “GOV-001 engineer role inherits ENG-007 catalog export, preparation and independent approval and controls ENG-002/004/005 revisions, never change approval or anything outside engineering”; `tests/api/authority.test.mjs` — “GOV-001 operator role executes only their own assigned FLOOR-001/FLOOR-007 operations, posts no stock and loses access when revoked” |  |
| `GOV-014` | Site and location scope | target | partial | `tests/api/authority.test.mjs` — “GOV-014 location scope: a scoped member sees, changes and downloads nothing outside their locations, and narrowing, approvals and revocation take effect live” | The cited scope journeys cover explicit location restrictions, derived-value redaction, preparer/approver checks, replay and revocation. Missing: named site-group scope including a location added after the grant. The site-group journey in tests/api/flows.test.mjs is outside GOV-001’s old evidence set. |
| `GOV-015` | Costs and wages scope | target | done | `tests/api/authority.test.mjs` — “GOV-015 GOV-016 costs-and-wages scope and custom roles: a restricted member never recovers a cost or wage, a custom role only narrows its base, and changes bind live”; `tests/api/rework.test.mjs` — “a person without wage authority reads no rework labor cost, total, output value or valued movement that the hourly rate follows from” |  |
| `GOV-016` | Narrow custom manufacturing roles | target | done | `tests/api/authority.test.mjs` — “GOV-015 GOV-016 costs-and-wages scope and custom roles: a restricted member never recovers a cost or wage, a custom role only narrows its base, and changes bind live”; `tests/api/authority.test.mjs` — “a deputy holds a delegated approval only while the principal's custom role still includes it” |  |
| `GOV-002` | Approval policies and delegated authority | target | done | `tests/api/authority.test.mjs` — “GOV-002 high-value PO and stock write-off need two signatures, a deputy signs a principal's seat, changed inputs invalidate, agents are denied and an owner override names its accountable human”; `tests/api/authority.test.mjs` — “GOV-002 orders below the margin floor and high-value quarantine releases need the policy signatures on exact terms; a sub-floor amendment needs the owner override”; `tests/browser/approvals.spec.ts` — “GOV-002 the owner sets a two-signature policy, a signature is given and then invalidated by a changed input at 1440/390” |  |
| `GOV-003` | Single sign-on and strong authentication | target | partial | `src/auth.server.ts`; `src/modules/operator-auth/index.mjs`; `tests/api/authority.test.mjs` | Native session authentication/revocation ships; these IdP connections, enforced MFA/step-up and SCIM are not product-wired. |
| `GOV-004` | Auditable production decisions | target | done | `tests/api/authority.test.mjs` — “GOV-004 a changed BOM is followed through scheduling, operator correction, quality release and stock adjustment in a queryable, exportable, append-only audit without planted secrets”; `tests/browser/audit.spec.ts` — “GOV-004 and GOV-005 owner audit and exact retention decisions preserve history” |  |
| `GOV-005` | Erasure and retention | target | partial | `src/larder/retention.ts`; `tests/api/audit-retention.test.mjs`; `tests/api/audit-retention.test.mjs`; `tests/browser/audit.spec.ts`; `tests/api/flows.test.mjs` | The bounded native flows preserve US production/document records, legal holds and prior model-consent evidence while anonymizing reviewed contacts. Missing: configurable lawful retention, complete eligible subject/document/message/model-context erasure, every controlled search/cache/provider copy, complete hold lifecycle and page journey. Legal sufficiency and actual provider deletion remain field proof. |
| `GOV-006` | Provider and model secret custody | target | missing |  | Provider and model secret custody workflow and its acceptance journey are not implemented. |
| `GOV-007` | Backup restore and recovery | target | partial | `src/larder/archive.ts`; `scripts/installer/portability-policy.mjs`; `tests/api/backup.test.mjs` | Manual checked domain/installation archive restore ships; scheduled encryption/retention drills and remote-effect recovery controls are absent. |
| `GOV-008` | Quality-release approval journeys | target | done | `tests/api/quality-approval.test.mjs` — “GOV-008 quality-hold, nonconformance and deviation releases under a two-signature quality threshold need independent signatures on exact terms, invalidate when the held quantity changes and take the named owner override”; `tests/browser/approvals.spec.ts` — “GOV-008 a quality-hold release under a two-signature quality threshold is signed once and then invalidated by a changed held quantity at 1440/390” |  |
| `GOV-009` | Schedule approval thresholds | target | done | `tests/api/schedule-approval.test.mjs` — “GOV-009 a two-signature schedule threshold gates an above-threshold plan adoption and a grant with a deputy, invalidates on changed inputs, caps every grant, denies agents and takes the named owner override”; `tests/api/schedule-approval.test.mjs` — “GOV-009 a reschedule proposal delaying a job past the schedule threshold needs two signatures, a deputy and an unchanged finite preview”; `tests/browser/approvals.spec.ts` — “GOV-009 a reschedule under a two-signature schedule threshold is signed once and then invalidated by a changed work order at 1440/390” |  |
| `GOV-010` | Ledger approval threshold | target | missing |  | No Larder door posts to a ledger. |
| `GOV-011` | Inventory-adjustment threshold on every write-off | target | done | `tests/api/expiry.test.mjs` — “GOV-011 expiry scrap and quarantine and nonconformance rejections honour the inventory-adjustment threshold: two signatures on the exact lot, location and quantity, a deputy, invalidation when stock moves, agents denied and a named owner override”; `tests/browser/approvals.spec.ts` — “GOV-011 an expired-lot write-off under a two-signature inventory-adjustment threshold is signed once and then invalidated by a stock movement at 1440/390” |  |
| `GOV-012` | Auditable journal adjustments | target | missing |  | No ledger door exists to audit. |
| `GOV-013` | Audit retention and purge authority | target | done | `tests/api/audit-retention.test.mjs` — “GOV-013 the export states the life-of-installation period and no purge authority, every role is refused at command, HTTP and database, and an erasure replaces personal values and leaves the entry and an audit of the replacement”; `tests/api/audit-retention.test.mjs` — “GOV-013 a sole owner who is the data subject still runs the erasure, it is audited, and they are addressable only by id afterwards” |  |
| `HTTP-001` | Preserve Base public and private paths | target | done | `tests/browser/journey.spec.ts` — “HTTP-001 MRP-001 public Lobby, health and docs stay separate from private app and exports” |  |
| `MOB-001` | Responsive accessible manufacturing | target | partial | `src/ui/make.tsx`; `tests/browser/journey.spec.ts` | Current order/stock/material/shipment journeys run at both widths; new target screens and full accessibility acceptance are absent. |
| `MOB-002` | iOS and Android shop-floor apps | target | missing |  | iOS and Android shop-floor apps workflow and its acceptance journey are not implemented. |
| `OPS-001` | Durable scheduling and sync jobs | target | missing |  | No reference dataset generator, durable job runner, measured-limits report or restart/cancel/budget controls exist. |
| `LINK-001` | General ledger and wholesale boundaries | target | missing |  | General ledger and wholesale boundaries workflow and its acceptance journey are not implemented. |
| `LINK-002` | CRM identity and workflow boundaries | target | missing |  | CRM identity and workflow boundaries workflow and its acceptance journey are not implemented. |
| `AGENT-001` | Maintain a feasible recovery plan | push-further | partial | `tests/api/schedule-approval.test.mjs` — “AGENT-001 supplier slip and breakdown continuously compute two material-feasible alternate plans, bind human selection, preserve the ship date and restore inert evidence”; `tests/api/flows.test.mjs` — “Qualified alternate comparison keeps pinned instructions, setup transitions, tools, labor, delivery and USD estimates through approval and restore”; `tests/api/flows.test.mjs` — “Event recovery persists once after restart, preserves frozen and manual work, exposes displacement and refuses automatic or external authority” | The cited recovery journeys compare feasible alternatives, preserve ship dates and exercise exact native approvals and stale refusals. Missing: server-computed risk classes and equivalent execution decided by two company policies, including all-autonomous agent execution. |
| `AGENT-002` | Chase supply to usable material | push-further | partial | `src/larder/purchasing.ts`; `src/larder/exceptions.ts` | Supplier confirmation/date history and holds exist; agent messaging, chasing and verified downstream closure are absent. Conditional dated chases on missing ship notices and cited reply extraction are absent. |
| `AGENT-003` | Reconcile actual cost against the plan | push-further | partial | `tests/api/flows.test.mjs`; `tests/browser/journey.spec.ts`; `scripts/live-variance.mjs` | The cited native journeys show exact bounded disclosure, cited arithmetic, repeat-cause hypotheses and future-revision follow-through. Missing journeys: server-computed classes and both company policies for the corresponding agent calls. Direct Anthropic integration requires the declared workspace configuration; the separately selected routed success proves only that route (RL-101). |
| `AGENT-004` | Close the production to books loop | push-further | partial | `src/larder/handoff.ts`; `src/larder/proposals.ts`; `tests/api/authority.test.mjs` | CSV line acknowledgments and reviewed reconciliation proposals exist; connected investigation and corrected-total verification are absent. |
| `AGENT-005` | Engineering intake from documents | push-further | missing |  | Engineering intake from documents workflow and its acceptance journey are not implemented. |
| `AGENT-006` | Cited shop-data answers | push-further | missing |  | Cited shop-data answers workflow and its acceptance journey are not implemented. |
| `AGENT-007` | Forecast and inventory policy improvement | push-further | missing |  | Forecast and inventory policy improvement workflow and its acceptance journey are not implemented. |
| `AGENT-008` | Recall and quality investigation | push-further | missing |  | Recall and quality investigation workflow and its acceptance journey are not implemented. |
| `AGENT-009` | Controlled agent execution and cost | push-further | missing |  | Controlled agent execution and cost workflow and its acceptance journey are not implemented. |
| `SURFACE-001` | Manufacturing registry | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-002` | Physical stock classes | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-003` | Commercial and outside consequences | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-004` | Protected manufacturing data | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-005` | Authority and provider classes | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-006` | Planning uncertainty and execution | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-007` | Manufacturing resource projections | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-008` | Evidence-bearing quality and engineering | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-009` | Manufacturing change events | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-010` | Bounded cost-analysis tool | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-011` | Manufacturing specialist handoffs | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-012` | Manufacturing prompts and capacity limits | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
| `SURFACE-013` | A seeded manufacturing week through MCP | target | missing |  | No Larder MCP registry, computed-class/company-policy implementation or conformance journey proves this delta. |
