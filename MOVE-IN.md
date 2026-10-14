# Moving in from Odoo

Larder's first move-in kit reads Odoo 17/18 CSV exports made with **“I want to update data (import-compatible export)”** ticked: technical field names, the External ID in the `id` column, relations as `field/id`, and one2many lines (order lines, BOM lines, operations) on continuation rows whose parent cells are blank. Name each file after its model. Columns other than those below are listed as “not read”.

| File | Required columns | Also read |
| --- | --- | --- |
| `res.partner.csv` | `id, name` | `customer_rank, supplier_rank, email, vat, is_company` |
| `uom.uom.csv` | `id, name, category_id/id, uom_type` | `factor` (smaller units), `factor_inv` (bigger units), `active` |
| `product.product.csv` | `id, default_code, name, uom_id/id` | `type, product_tmpl_id/id, product_template_attribute_value_ids` (“Attribute: Value, …”), `route_ids/id` (manufacture route marks the item as made), `standard_price, list_price, active` |
| `stock.location.csv` | `id, complete_name, usage` | `active` (only `internal` locations hold stock) |
| `mrp.bom.csv` | `id, product_tmpl_id/id, product_qty, product_uom_id/id, bom_line_ids/product_id/id, bom_line_ids/product_qty, bom_line_ids/product_uom_id/id` | `product_id/id, code, type, operation_ids/name, operation_ids/workcenter_id/id, operation_ids/time_cycle_manual` |
| `stock.quant.csv` | `product_id/id, location_id/id, quantity` | `lot_id/name, product_uom_id/id, inventory_date` |
| `sale.order.csv` | `id, name, partner_id/id, state, order_line/product_id/id, order_line/product_uom_qty, order_line/price_unit` | `commitment_date, validity_date, client_order_ref, order_line/qty_delivered, order_line/product_uom/id` |
| `purchase.order.csv` | `id, name, partner_id/id, state, order_line/product_id/id, order_line/product_qty, order_line/price_unit` | `date_planned, partner_ref, order_line/qty_received, order_line/product_uom/id` |

## What happens

1. **Preview (dry run).** Larder parses every file strictly, maps rows and shows counts, every rejected row with its file, line, External ID and reason, the rows skipped on purpose (services, archived records, non-internal locations, closed orders, fully delivered orders) and the columns it did not read. Nothing else is written.
2. **Commit.** A manager commits the exact preview, confirming that the rejected rows stay out. Larder re-maps the same files; if records changed since the preview it asks for a fresh preview. The batch is published through Base's import kit, which journals the job and keeps every original file with its digest. Every created record carries its Odoo External ID.
3. **Undo.** Before live use a manager can undo the whole batch. Once orders, stock movements, reservations or documents depend on it, undo is refused with the list of dependencies; correct with reversals and counts instead.

Rejected on purpose: a unit name used twice in one category with different sizes, conversions that are not exact at six decimal places, repeated External IDs, products without an internal reference, duplicate SKUs or contact names, references to rejected or unknown rows (and everything that depends on them), negative or malformed quantities, open orders without a promise or planned date, and anything already moved in by an earlier batch.

Opening stock comes from `stock.quant.csv` at the product's Odoo standard cost; the preview asks for the count date, who counted and the valuation basis, and the quant file is kept as the count's evidence. Open orders move in with their open quantities (ordered minus delivered or received) and prices per base unit; confirmed sales orders arrive confirmed but unreserved, and confirmed purchase orders arrive approved.

The files in `fixtures/odoo/` were written from Odoo's published import/export guide, not exported from a live database. Acceptance against a real owner's export is still open.
