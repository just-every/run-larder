# Stock and counts

Record opening stock, move it between shelves, count it, and correct mistakes without losing the original record.

## How Larder counts stock

Every quantity on **Stock** is the sum of its recorded movements: receipts, shipments, issues, output, transfers, counts and corrections. Nothing is typed over. Stock is kept by item, location, lot and status (available or quarantine), and the database refuses any movement that would take a shelf below zero or leave reserved stock larger than what is there.

**By item** shows each item's on hand, reserved, available, quarantine, expected and still-to-promise figures. **By location** shows what sits on each shelf, by lot.

## Opening stock

Record each location's opening count once, before other movements there: the date it was counted, who counted it, how it was valued (supplier invoices, last purchase price, standard cost or your own estimate) and the count sheet or photo. Each line is an item, its quantity, unit cost and lot if it has one. Later differences are counts, not new opening stock.

## Transfers and counts

**Transfer** moves free stock between locations with a reason. Reserved stock cannot be moved.

**Record count** compares a counted quantity with the records. If they differ, the count waits on **Today** for a manager to **Approve adjustment** or **Ask for a recount**; stock changes only when it is approved. The owner holds every authority and may approve their own count, so a one-person workshop can keep its stock right.

## Quality decisions

Stock received or returned into quarantine cannot be promised or picked. Under **Quality decisions**, **Release to stock** or **Reject (return or scrap)** each quantity with a reason.

## Lot dates, expiry and FEFO

When you receive, count or make a named lot you can record its manufacture, expiry and retest dates, the supplier's shelf life and storage conditions. Dates are UTC days, and a lot is usable through its expiry and retest dates. Give a customer a minimum shelf life on arrival under **Customers and suppliers**; picks for that customer take only lots with enough shelf life left on the promised ship day, earliest expiry first. **Lot dates and expiry** on Stock shows each dated lot, and Today lists lots expiring within 30 days and lots already expired or due for retest. Expired and retest-due stock stays on hand but cannot be reserved, picked, issued or transferred until an owner or manager records a documented disposition: extend it after a passed retest, or scrap it.

## Correcting a mistake

**Correct a recorded movement** reverses a receipt, transfer, opening count, count adjustment or return by posting its exact opposite, pointing back to the original. The original stays in the record. If later work already uses that stock (it was shipped, issued or reserved), the reversal is refused: reverse the later work first, newest first.
