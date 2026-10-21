# Moving in from Odoo

Larder's first move-in kit reads Odoo 17/18 CSV exports made with **“I want to update data (import-compatible export)”** ticked: technical field names, the External ID in the `id` column, relations as `field/id`, and one2many lines (order lines, BOM lines, operations) on continuation rows whose parent cells are blank. Name each file after its model. Columns other than those below are listed as “not read”.

| File | Required columns | Also read |
| --- | --- | --- |
| `res.partner.csv` | `id, name` | `customer_rank, supplier_rank, email, vat, is_company` |
| `uom.uom.csv` | `id, name, category_id/id, uom_type` | `factor` (smaller units), `factor_inv` (bigger units), `active` |
| `product.product.csv` | `id, default_code, name, uom_id/id` | `type, product_tmpl_id/id, product_template_attribute_value_ids` (“Attribute: Value, …”), `route_ids/id` (manufacture route marks the item as made), `standard_price, list_price, active` |
| `stock.location.csv` | `id, complete_name, usage` | `active` (only `internal` locations hold stock) |
| `mrp.bom.csv` | `id, product_tmpl_id/id, product_qty, product_uom_id/id, bom_line_ids/product_id/id, bom_line_ids/product_qty, bom_line_ids/product_uom_id/id` | `product_id/id, code, type, operation_ids/name, operation_ids/workcenter_id/id, operation_ids/workcenter_id/name` (or `operation_ids/workcenter_id`), `operation_ids/time_cycle_manual` |
| `stock.quant.csv` | `product_id/id, location_id/id, quantity` | `lot_id/name, product_uom_id/id, inventory_date` |
| `sale.order.csv` | `id, name, partner_id/id, state, order_line/product_id/id, order_line/product_uom_qty, order_line/price_unit` | `commitment_date, validity_date, client_order_ref, order_line/qty_delivered, order_line/product_uom/id` |
| `purchase.order.csv` | `id, name, partner_id/id, state, order_line/product_id/id, order_line/product_qty, order_line/price_unit` | `date_planned, partner_ref, order_line/qty_received, order_line/product_uom/id` |

## What happens

1. **Preview (dry run).** Larder parses every file strictly, maps rows and shows counts, every rejected row with its file, line, External ID and reason, the rows skipped on purpose (services, archived records, non-internal locations, closed orders, fully delivered orders) and the columns it did not read. Nothing else is written.
2. **Commit.** A manager commits the exact preview, confirming that the rejected rows stay out. Larder re-maps the same files; if records changed since the preview it asks for a fresh preview. The batch is published through Base's import kit, which journals the job and keeps every original file with its digest. Every created record carries its Odoo External ID.
3. **Undo.** Before live use a manager can undo the whole batch. Once orders, stock movements, reservations or documents depend on it, undo is refused with the list of dependencies; correct with reversals and counts instead.

Rejected on purpose: a unit name used twice in one category with different sizes, conversions that are not exact at six decimal places, repeated External IDs, products without an internal reference, duplicate SKUs or contact names, references to rejected or unknown rows (and everything that depends on them), negative or malformed quantities, open orders without a promise or planned date, and anything already moved in by an earlier batch.

A routing step's work center moves in under its Odoo name when the export carries it (`operation_ids/workcenter_id/name`, or `operation_ids/workcenter_id` as a plain export writes it). With only the External ID, Larder reads a name from it (`__export__.mrp_workcenter_1_bench` becomes “Bench”; an ID ending in Odoo's generated hash becomes “Work center 1”); rename it in the BOM's next revision if needed.

Opening stock comes from `stock.quant.csv` at the product's Odoo standard cost; the preview asks for the count date, who counted and the valuation basis, and the quant file is kept as the count's evidence. Open orders move in with their open quantities (ordered minus delivered or received) and prices per base unit; confirmed sales orders arrive confirmed but unreserved, and confirmed purchase orders arrive approved.

The files in `fixtures/odoo/` were written from Odoo's published import/export guide, not exported from a live database. Acceptance against a real owner's export is still open.

## Source history (MOVE-008)

In More → Move in from Odoo, **Import source history** accepts a source-history
JSON file and up to five original evidence files (each at most 1 MiB). A manager
or agent previews it; the owner or manager commits the exact preview version.
Preview retains the original files and proposed records; only commit publishes
searchable history. Neither step posts stock, creates live jobs/shipments/bills,
sends anything, nor interprets source text as instructions. Original files are
kept byte-for-byte, with SHA-256 digests, including source fields not mapped for
search. This is a documented interchange format; it does not claim a vendor
export adapter or provider verification.

```json
{
  "format": "larder-source-history-v1",
  "source": "Workshop export, December 2025",
  "records": [{
    "kind": "closed-job",
    "originalId": "mrp.production/712",
    "reference": "JOB-712",
    "occurredAt": "2025-12-01T17:30:00-05:00",
    "currency": "USD",
    "sourceStatus": "closed",
    "summary": "Three walnut boards completed",
    "references": ["LOT-WAL-62", "SHIP-241"],
    "quantity": "3",
    "unit": "each",
    "amount": "150.75",
    "attachments": ["job-closed.pdf"]
  }]
}
```

Kinds are `closed-job`, `shipment`, `bill`, `quality`, `lot`; up to 200 records
per file. Source, kind and original ID form the duplicate key. Original ID,
reference, original timestamp with explicit UTC offset or Z, original currency,
source status and summary are required. Missing currency/time-zone information
must be resolved from the source, never inferred from USD or this installation.
Currency is retained as its original three-uppercase-letter declaration, without
conversion or cross-currency aggregation. Optional quantity/amount are signed
exact decimal strings with up to six decimal places and ten whole digits;
quantity requires its original unit. References and filenames are searchable
through the top bar, the source-history screen and `/api/larder/history?q=...`.
The original file also retains any source-only fields and formatting. Historical
amounts and quantities never enter live stock valuations or planning totals.

### Portable business export

`GET /api/larder/archive` downloads `larder-archive-v1` JSON. Its `records` map
contains every implemented Larder collection, including history, settings/policies,
links, approvals, agent proposals/decisions and import outcomes. `movements` and
`reservations` use six-place **scaled integer strings**, while decimal values in
records retain their declared decimal-string representation. `commands` retains
recorded command outcomes and digests; `people` contains original actor ID/name
labels. `attachments` contains original bytes as base64, metadata and SHA-256.
`reconciliation` contains exact stock positions. `checksum` covers the canonical
JSON content excluding `exportedAt`, `checksum` and `ledger`.

`GET /api/larder/archive.csv` is the lossless RFC 4180 tabular companion, also
available from Business archive. Columns are `section,index,json`. A section
`records.<collection>` denotes that collection; every array first has an empty
index row with JSON `[]`, followed by numbered rows in original order. Other
empty-index rows contain scalar metadata. Parse the JSON cells to recover types,
nested links, decimal strings and base64 files. Empty collections are included.
The CSV contains the same archive content; use JSON for the restore screen.
Individual original files also download from `/api/larder/attachments/<id>`.

The business archive deliberately selects domain data and actor labels: it never
exports installation environment bindings, provider credentials, authentication
sessions, sign-in tokens or reusable connection configuration. Original evidence
files remain exactly as supplied. Restore writes records and recorded outcomes,
not commands to execute; it never reconnects a provider or repeats a remote action.
Only an empty installation accepts restore, in one authority- and emptiness-guarded
transaction, with file-digest and stock reconciliation checks. Original role
records whose people do not exist in the destination are retained in
`unmappedRoles` as inert historical evidence; they grant no authority. Original
actor names remain available in subsequent exports. Committed Odoo imports become
`restored` (undo requires the original installation's import journal).

Future record kinds, business settings, provider outcomes and import doors inherit
this export/restore obligation before shipping; see the receiver clauses listed
in MOVE-008. This does not assert implementation of those future capabilities.
