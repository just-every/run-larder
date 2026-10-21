# Move in from Odoo

Preview your Odoo export, see every rejected row, commit what is right, and undo before you go live.

## 1. Export from Odoo

In Odoo, export each model as CSV with **I want to update data (import-compatible export)** ticked, and name each file after its model:

| File | What it brings |
| --- | --- |
| `res.partner.csv` | Customers and suppliers |
| `uom.uom.csv` | Units of measure and their sizes |
| `product.product.csv` | Items, with SKU, unit, variant, cost and list price |
| `stock.location.csv` | Internal locations |
| `mrp.bom.csv` | Bills of materials and routing steps |
| `stock.quant.csv` | Opening stock on hand, by location and lot |
| `sale.order.csv` | Open sales orders |
| `purchase.order.csv` | Open purchase orders |

## 2. Preview

On **More → Move in from Odoo**, give the move-in a label, choose the files and, when `stock.quant.csv` is included, the count date, who counted and the valuation basis. **Preview move-in** changes nothing: it shows how many contacts, items, locations, bills of materials, opening lines and orders would come in, and every row it rejected, with its file, line, External ID and reason.

Rows are rejected on purpose when they would make the records wrong: a unit defined twice with different sizes, a conversion that is not exact, a repeated External ID, a product without an internal reference, a duplicate SKU, a malformed quantity, an open order without a promise date, a row that depends on a rejected one, or anything an earlier move-in already brought.

## 3. Commit

A manager presses **Commit, leaving N rejected rows out** (N is the number of rejected rows), confirming those rows stay out. If anything changed since the preview, Larder asks for a fresh preview. Every record keeps its Odoo External ID, and the original files are kept with the batch.

Confirmed sales orders arrive confirmed but unreserved, so reserve them when you are ready. Confirmed purchase orders arrive approved.

## 4. Undo before you go live

**Undo move-in** removes everything the batch created. It is refused once live work depends on the batch: a reservation, a later stock movement, a changed record, or a handoff batch that already gave the moved-in stock to your accountant. Then correct with reversals and counts instead; see [Stock and counts](stock.md).

## Try it beside what you have

Move in a copy of your Odoo export on your own computer and run this week's orders through both. Nothing in Larder writes back to Odoo.

## Keep closed source history

On this same screen, **Import source history** previews a JSON interchange file
plus original evidence attachments; the owner or a manager then commits it.
Supported history kinds are closed jobs, shipments, bills, quality records and
lots. Each needs its original ID/reference, timestamp with time-zone offset,
currency, source status and summary. Quantity, amount, linked references and
original filenames remain searchable. The exact schema and portable CSV/JSON
export format are documented in the repository's [MOVE-IN.md](https://github.com/just-every/run-larder/blob/main/MOVE-IN.md#source-history-move-008).

Search original lot/job references or filenames in **Search source history** or
the top bar. Records are labeled **Source history** and retain their original
files with digests. They never post stock, create live shipments, or send anything.
From **More → Business archive**, download JSON for restore or its lossless CSV
companion. Restore into an empty installation preserves history/files without
reconnecting providers or replaying their actions.
