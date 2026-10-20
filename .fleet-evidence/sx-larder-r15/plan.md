# sx-larder-r15 plan

Baseline 079dc1c720d81f0420cecb9fb8ce09a452bccd3a; counts {'done': 38, 'partial': 32, 'missing': 58}

All 90 unfinished clauses remain 42 account-blocked and 48 hard; none is proven cheap. Investigated OPEN-001 first: the exact published command fails on rer 0.2.62 during setup cleanup because cancelled zombie children remain. Completing it needs the permitted conditional 0.2.74 pin refresh plus full single-pipeline import-door adoption, including native mappings, operator/grant mounts, settings, custody, erasure and public HTTP proof. That exceeds this one-clause proof gap; leave partial. No Base refresh unless required; no new authority policy. One clause scope.

ID | status | bucket | remaining work | files to inspect/touch
US-001 | partial | hard | Exact decimals/units ship; src/larder/archive.ts declares USD and restore neither validates nor migrates currency. US business configuration, configurable currency defaults, per-record ISO currency declarations and a versioned AUD migration with recorded rates/reconciliation are absent. | `src/larder/decimal.ts`; `src/larder/catalogue.ts`; `src/larder/archive.ts`; `tests/api/flows.test.mjs`
US-002 | missing | account-blocked | Sales tax and exemption handoff workflow and its acceptance journey are not implemented. | 
US-003 | missing | account-blocked | Guided real-order setup workflow and its acceptance journey are not implemented. | 
ENG-003 | missing | hard | Configurable and matrix BOMs workflow and its acceptance journey are not implemented. | 
ENG-006 | missing | hard | Kits and sale-triggered assembly workflow and its acceptance journey are not implemented. | 
DEMAND-001 | partial | hard | Quotes/prices and separate stock figures ship; capacity-feasible dates, labor/overhead estimates, quote terms/options and customer-currency quotes are absent. Three feasible alternatives checked against material, named machine and person calendars are not offered. | `src/larder/sales.ts`; `src/larder/availability.ts`; `tests/api/flows.test.mjs`
DEMAND-005 | partial | hard | Explicit SO/MO ranks and indicative shared-supply allocation ship in DEMAND-006 with protected reservations. Displacement preview/approval, margin and due-date consequences, approved promise-change counts and alternate-capacity promise-preserving recovery remain absent. | `src/larder/stock.ts`; `src/larder/sales.ts`; `tests/api/flows.test.mjs`
DEMAND-007 | partial | account-blocked | Shipment-driven invoice preparation lines valued at the order price, with ledger acknowledgment and linked corrections for reversed shipments, ship in the accountant handoff; invoice records per order, Invoice all/some, bulk and automatic invoicing, refusal of unshipped quantity, invoice and payment status columns with filters, provider payment readback and the overdue release check are absent. | `src/larder/handoff.ts`; `src/larder/sales.ts`; `tests/api/flows.test.mjs`
DEMAND-008 | missing | account-blocked | The common wholesale/Shopify/Amazon fulfillment list, channel identity, channel import and connected shipment journeys are not implemented. | 
MRP-001 | partial | hard | Aggregate deterministic shortages exist; current netting counts open supply without time-phased multilevel feasibility. | `src/larder/planning.ts`; `tests/api/flows.test.mjs`
MRP-002 | partial | hard | Shortage reasons and ETA history exist; full supply/demand pegging and change recommendations are absent. | `src/larder/planning.ts`; `src/larder/purchasing.ts`
MRP-003 | missing | hard | Replenishment forecasts and purchasing constraints workflow and its acceptance journey are not implemented. | 
MRP-004 | missing | hard | Planning scenarios and release fence workflow and its acceptance journey are not implemented. | 
CAP-001 | missing | hard | Work-center calendars workflow and its acceptance journey are not implemented. | 
CAP-002 | missing | hard | Labor calendars and skills workflow and its acceptance journey are not implemented. | 
CAP-003 | partial | hard | Component reservation/issue integrity and ENG-002 task state/predecessors exist; transfer-batch/overlap rules and material operation gates remain absent; TRACE-004 quality holds already gate operation starts. | `src/larder/production.ts`; `src/larder/stock.ts`
CAP-004 | missing | hard | Finite-capacity Gantt and bottlenecks workflow and its acceptance journey are not implemented. | 
CAP-005 | missing | hard | Drag and drop rescheduling workflow and its acceptance journey are not implemented. | 
CAP-006 | missing | hard | Alternate centers and sequence-dependent setups workflow and its acceptance journey are not implemented. | 
CAP-007 | missing | hard | Live dependency-preserving reflow workflow and its acceptance journey are not implemented. | 
CAP-008 | missing | hard | Grouped jobs and nesting workflow and its acceptance journey are not implemented. | 
BUY-001 | partial | hard | Supplier prices/codes, basic terms and PO date history exist; structured vendor constraints, scheduled lines and performance do not. | `src/larder/catalogue.ts`; `src/larder/purchasing.ts`; `tests/api/flows.test.mjs`
BUY-002 | partial | hard | Partial receipt/quarantine and shortage reasons ship; demand pegging, tolerances and downstream receipt allocation are absent. | `src/larder/purchasing.ts`; `src/larder/planning.ts`; `tests/api/flows.test.mjs`
BUY-003 | partial | account-blocked | Role-gated exact PO approvals ship; thresholds, invoice capture, three-way matching and PO billing/payment status in the PO list are absent. | `src/larder/purchasing.ts`; `src/larder/roles.ts`; `tests/api/flows.test.mjs`
BUY-005 | missing | account-blocked | Landed costs workflow and its acceptance journey are not implemented. | 
BUY-006 | missing | account-blocked | Supplier returns and credits workflow and its acceptance journey are not implemented. | 
BUY-007 | missing | account-blocked | Supplier and customer communications workflow and its acceptance journey are not implemented. | 
FLOOR-002 | missing | hard | Actual labor and operation time workflow and its acceptance journey are not implemented. | 
FLOOR-003 | partial | hard | Released work and remaining output exist; operation WIP, transfer batches and explicit manufacturing backorders are absent. | `src/larder/production.ts`; `tests/api/flows.test.mjs`
FLOOR-006 | missing | hard | Co-products and by-products workflow and its acceptance journey are not implemented. | 
FLOOR-008 | missing | hard | Barcode scanning workflows workflow and its acceptance journey are not implemented. | 
FLOOR-009 | missing | hard | Zebra and printable labels workflow and its acceptance journey are not implemented. | 
TRACE-002 | missing | hard | Serial-number lifecycle workflow and its acceptance journey are not implemented. | 
TRACE-005 | partial | hard | Quarantine release/rejection and returns exist; nonconformance cases, CAPA and rework disposition are absent. | `src/larder/purchasing.ts`; `src/larder/warehouse.ts`
TRACE-006 | missing | hard | Recall execution and reconciliation workflow and its acceptance journey are not implemented. | 
STOCK-001 | partial | hard | Locations/free-stock transfers exist; sites/bins, in-transit receipt, ownership, putaway policies and multi-order batch/wave picking are absent. | `src/larder/warehouse.ts`; `src/larder/availability.ts`; `tests/api/flows.test.mjs`
COST-001 | partial | hard | Actual material cost and pinned standard output value ship; labor, overhead, subcontract roll-up and actual output revaluation are absent. | `src/larder/production.ts`; `src/larder/stock.ts`; `tests/api/flows.test.mjs`
COST-002 | partial | account-blocked | Work/material costs and valued movements exist; ongoing WIP valuation/aging and period roll-forward do not. | `src/larder/production.ts`; `src/larder/handoff.ts`
COST-003 | partial | hard | Closed jobs report material standard/actual variance; full component variance reports and labor/overhead analysis are absent. Sales-order quoted/actual margin and cost-variance reconciliation across jobs is absent. | `src/larder/production.ts`; `tests/api/flows.test.mjs`
COST-004 | missing | hard | Order and customer margins workflow and its acceptance journey are not implemented. | 
COST-005 | partial | account-blocked | Weighted-average cost and valued movements/CSV corrections ship; FIFO, close locks and live-ledger tie-out are absent. | `src/larder/stock.ts`; `src/larder/handoff.ts`; `tests/api/flows.test.mjs`
COST-006 | missing | hard | Production and supplier performance workflow and its acceptance journey are not implemented. | 
COST-007 | missing | account-blocked | Custom reports and documents workflow and its acceptance journey are not implemented. | 
CONN-001 | missing | account-blocked | QuickBooks Online live sync workflow and its acceptance journey are not implemented. | 
CONN-002 | missing | account-blocked | Xero live sync workflow and its acceptance journey are not implemented. | 
CONN-003 | missing | account-blocked | Shopify orders and stock workflow and its acceptance journey are not implemented. | 
CONN-004 | missing | account-blocked | WooCommerce orders and stock workflow and its acceptance journey are not implemented. | 
CONN-005 | missing | account-blocked | Amazon demand and fulfillment workflow and its acceptance journey are not implemented. | 
CONN-006 | missing | account-blocked | BigCommerce and eBay orders and stock workflow and its acceptance journey are not implemented. | 
CONN-007 | missing | account-blocked | ShipStation and Shippo labels and tracking workflow and its acceptance journey are not implemented. | 
CONN-008 | missing | account-blocked | HubSpot, Salesforce and Pipedrive deal-to-order workflow and its acceptance journey are not implemented. | 
CONN-009 | missing | account-blocked | SPS Commerce EDI workflow and its acceptance journey are not implemented. | 
CONN-010 | missing | account-blocked | Third-party warehouse reconciliation workflow and its acceptance journey are not implemented. | 
CONN-011 | missing | hard | SolidWorks BOM and drawing intake workflow and its acceptance journey are not implemented. | 
CONN-012 | missing | hard | ProNest and TruTops nesting intake workflow and its acceptance journey are not implemented. | 
CONN-013 | missing | account-blocked | Datanomix machine observations workflow and its acceptance journey are not implemented. | 
CONN-014 | partial | hard | Session-authenticated command/state API ships; service tokens, pagination, versions, outbound signed webhooks and the MCP server are absent. | `src/larder/api.ts`; `API.md`; `tests/api/authority.test.mjs`
CONN-015 | missing | account-blocked | Zapier workflow integration workflow and its acceptance journey are not implemented. | 
AUTO-002 | missing | account-blocked | Scheduled alerts and action policies workflow and its acceptance journey are not implemented. | 
AUTO-003 | missing | account-blocked | Integration repair queue workflow and its acceptance journey are not implemented. | 
MOVE-001 | missing | hard | Katana move-in workflow and its acceptance journey are not implemented. | 
MOVE-002 | missing | hard | MRPeasy move-in workflow and its acceptance journey are not implemented. | 
MOVE-003 | missing | hard | Fishbowl Manufacturing move-in workflow and its acceptance journey are not implemented. | 
MOVE-004 | partial | hard | Basic Odoo CSV kit is tested; manufacturing state, work centers, QC, expiry, actual time and full WIP migration are absent. | `src/larder/odoo/map.ts`; `src/larder/odoo/imports.ts`; `MOVE-IN.md`; `tests/api/move-in.test.mjs`
MOVE-005 | missing | hard | Fulcrum move-in workflow and its acceptance journey are not implemented. | 
MOVE-006 | missing | hard | DOSS move-in workflow and its acceptance journey are not implemented. | 
MOVE-007 | partial | hard | Odoo staged originals, preview, replay and dependent-undo protection ship; all-source parallel reconciliation and cross-provider cutover do not. Source-versus-Larder stock-value reconciliation to the cent, review counts and a valuation cutover block are absent. | `src/larder/odoo/imports.ts`; `src/modules/import-kit/src/d1/index.ts`; `tests/api/move-in.test.mjs`
MOVE-008 | partial | hard | Complete current-domain archive exists; expanded source history, all target record types and documented tabular exports are absent. | `src/larder/archive.ts`; `tests/api/flows.test.mjs`; `tests/api/backup.test.mjs`
OPEN-001 | partial | hard | MIT source and the published launch/installer path ship; clean-directory execution of the published repository command and fee disclosure before each target provider connection are not yet proven. | `LICENSE`; `rer-project.json`; `src/site/run.json`; `scripts/installer/local.mjs`
GOV-001 | partial | hard | Nine broad roles and atomic enforcement ship; planner, engineer, quality and operator/site/field scopes and custom roles are absent. | `src/larder/roles.ts`; `src/larder/api.ts`; `tests/api/authority.test.mjs`
GOV-002 | partial | hard | Exact proposals, preparer separation and owner override ship; configurable thresholds, dual approval/deputies and expiry do not. | `src/larder/roles.ts`; `src/larder/proposals.ts`; `tests/api/authority.test.mjs`
GOV-003 | partial | account-blocked | Native session authentication/revocation ships; these IdP connections, enforced MFA/step-up and SCIM are not product-wired. | `src/auth.server.ts`; `src/modules/operator-auth/index.mjs`; `tests/api/authority.test.mjs`
GOV-004 | partial | hard | Movement/command/approval histories exist; complete before/after target-domain audit, search and retention controls are absent. | `src/larder/storage.ts`; `src/larder/proposals.ts`; `src/larder/view.ts`; `tests/api/authority.test.mjs`
GOV-005 | missing | account-blocked | Erasure and retention workflow and its acceptance journey are not implemented. | 
GOV-006 | missing | account-blocked | Provider and model secret custody workflow and its acceptance journey are not implemented. | 
GOV-007 | partial | account-blocked | Manual checked domain/installation archive restore ships; scheduled encryption/retention drills and remote-effect recovery controls are absent. | `src/larder/archive.ts`; `scripts/installer/portability-policy.mjs`; `tests/api/backup.test.mjs`
MOB-001 | partial | hard | Current order/stock/material/shipment journeys run at both widths; new target screens and full accessibility acceptance are absent. | `src/ui/make.tsx`; `tests/browser/journey.spec.ts`
MOB-002 | missing | account-blocked | iOS and Android shop-floor apps workflow and its acceptance journey are not implemented. | 
OPS-001 | missing | account-blocked | No reference dataset generator, durable job runner, measured-limits report or restart/cancel/budget controls exist. | 
LINK-001 | missing | account-blocked | General ledger and wholesale boundaries workflow and its acceptance journey are not implemented. | 
LINK-002 | missing | account-blocked | CRM identity and workflow boundaries workflow and its acceptance journey are not implemented. | 
AGENT-001 | partial | account-blocked | Shortages and reviewed manual reschedule proposals exist; continuous feasible recovery, simulation and cross-role execution are absent. Computed alternate-machine recovery preserving the original ship date is absent. | `src/larder/planning.ts`; `src/larder/proposals.ts`; `tests/api/authority.test.mjs`
AGENT-002 | partial | account-blocked | Supplier confirmation/date history and holds exist; agent messaging, chasing and verified downstream closure are absent. Conditional dated chases on missing ship notices and cited reply extraction are absent. | `src/larder/purchasing.ts`; `src/larder/exceptions.ts`
AGENT-003 | partial | account-blocked | Material variance and new revisions exist; recurring-cause agent analysis, labor/overhead evidence and improvement follow-through are absent. A cited single-order variance explanation with source counts is absent. | `src/larder/production.ts`; `src/larder/bom.ts`
AGENT-004 | partial | account-blocked | CSV line acknowledgments and reviewed reconciliation proposals exist; connected investigation and corrected-total verification are absent. | `src/larder/handoff.ts`; `src/larder/proposals.ts`; `tests/api/authority.test.mjs`
AGENT-005 | missing | account-blocked | Engineering intake from documents workflow and its acceptance journey are not implemented. | 
AGENT-006 | missing | account-blocked | Cited shop-data answers workflow and its acceptance journey are not implemented. | 
AGENT-007 | missing | account-blocked | Forecast and inventory policy improvement workflow and its acceptance journey are not implemented. | 
AGENT-008 | missing | account-blocked | Recall and quality investigation workflow and its acceptance journey are not implemented. | 
AGENT-009 | missing | account-blocked | Controlled agent execution and cost workflow and its acceptance journey are not implemented. | 

## Result

No clause status changes: 38 done / 32 partial / 58 missing. OPEN-001 remains partial. Required Envelope links added to CAP-002 and Honest boundaries; no capability claim. No homepage copy, Base copies, pin, import door, identity or access-policy changes. No PR requested or created; only cloud/sx-larder-r15 will be pushed for Mac landing after exact-SHA Verify.
