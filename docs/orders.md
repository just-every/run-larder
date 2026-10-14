# Take an order

Save a quote, confirm it, reserve its stock, and pick, pack and ship it, all from the order's own page.

## 1. Save a quote

On **Orders**, fill in **New quote**: the customer, the promise date, their reference if they gave one, and a line for each item with its quantity. Leave the unit price blank to use the item's list price. **Save quote** opens the new order, numbered `SO-0001`, `SO-0002` and so on.

A quote holds no stock. Nothing is short until the order is confirmed.

## 2. Confirm and reserve

On the order, **Confirm order and reserve stock** confirms it and reserves whatever free stock covers it. Reserving only ever takes stock that is free: two orders can never claim the same boards, even when two people press the button at the same moment.

Select a line to see its **Selected line availability**:

| Line | What it counts |
| --- | --- |
| On hand | Everything in stock for this item that is not in quarantine |
| Reserved for this order | Held for this order already |
| Reserved for others | Held for other confirmed orders and released work |
| In quarantine | Received but waiting for a quality decision (shown only when there is some) |
| Expected from purchase | Still to arrive on approved purchase orders |
| Expected from work orders | Still to come off released work orders, with each order's BOM revision |
| Available to promise | What you can still promise to a new order |

If stock arrives later, press **Reserve stock** again. If the line is short, **Draft work order for 24 short** (or **Draft purchase order** for a bought item) drafts exactly what is missing; see [Make and buy](make-and-buy.md).

## 3. Pick, pack and ship

**Continue to pick & pack** jumps to **Pick, pack and ship**. Pick only what is reserved; you can pick part of an order and leave the rest reserved.

1. **Pick** the quantities you are taking from each shelf.
2. **Mark packed** with the number of packages and the weight.
3. **Ship** with the carrier and tracking number.

The order shows **Part shipped** until every line has gone, then **Shipped**. Each shipment is a line for your accountant's invoice in the next [handoff batch](handoff.md).

## 4. Changes and returns

Under **Changes and returns** on the order:

- **Cancel open quantity** removes quantity that has not shipped and releases its reservation.
- **Receive a return** brings goods back, either straight to stock or into quarantine for inspection, with the reason.
- **Reverse shipment** is for a shipment recorded by mistake, when the parcel never left. Stock and the reservation come back and the original record stays. If goods from that shipment were already returned, reverse the return first.
