# Make and buy

See what is short and why, draft the purchase or work order that covers it, and make to the bill of materials you released.

## What is short, and why

**Make & buy → Shortages** lists every item that confirmed orders and released work need more of than you have, or have coming. Each row shows how many are short, when they are first needed and which documents need them, for example "SO-0001 needs 24 by Oct 28, 2026".

Press **Draft work order** for an item you make, or **Draft purchase order** for one you buy. Larder drafts the quantity that is short, dated for when it is needed, with your preferred supplier and price. A draft purchase order waits on **Today** under **Needs a person** until a manager or buyer approves it; a draft work order waits under **Work orders** until it is released.

## Purchase orders

A purchase order moves through these steps:

1. **Approve purchase order**: a manager or buyer approves the draft and its cash exposure.
2. **Record supplier confirmation**: how it reached you (phone, email, portal, in person), their reference and the delivery date they confirmed. The line keeps the date you asked for beside the date the supplier confirmed; an approved expedite or deferral changes only the date you asked for.
3. **Revise expected delivery** when the date moves; every change is kept with its reason.
4. **Receive delivery**: what actually arrived, into which location, with the supplier's lot. Choose **Accept into stock** or **Hold in quarantine**. Receive part of an order and the rest stays expected; Larder refuses more than was ordered.

After a delivery, **Allocate accepted stock** reserves it to the demand the plan pegs it to. **Allocate to a job** reserves accepted stock by hand to one released job that needs it; damaged and quarantined stock is never allocated, and taking stock reserved to another job needs a manager or the owner and a reason.

An approved order past its expected date appears on **Today** as late.

## Bills of materials

**Bills of materials** lists every revision of each made item: its components per finished unit and its routing steps. **Save new revision** creates the next revision; a saved revision never changes. A released work order keeps the revision it was released with, even after you change the recipe.

## Work orders

1. **Release and reserve materials** pins the work order to the current BOM revision, reserves the components and records a standard cost.
2. **Issue materials** records what was actually used, from which location.
3. **Record output** records the good quantity, anything scrapped with its reason, and an optional batch.
4. **Close work order** releases leftover reservations and records the material cost and the variance against standard.

Finished goods count as on hand the moment they are recorded, and the orders waiting for them can reserve them.

## Configured items and kits

**Configurable items.** An engineer saves configuration rules for a made item under **Make & buy → Bills of materials → Save configuration rules**: choices (such as Size and Finish), dimensions with a range, yes/no options, formulas that derive component quantities, routing minutes and added cost, and combinations to refuse with their reason. Each save is the next revision. On **Orders → Configured quote**, sales choose a configuration for each line, check what it makes and costs (every figure shows its rule and arithmetic), compare lines and save the quote; the resolved configuration is pinned on each line. After the order is confirmed, **Draft work to this configuration** drafts a work order carrying that configuration, and releasing it pins exactly those components, routing and cost. A later rule edit never moves a quote or released work.

**Kits.** Under **Make & buy → Kits**, one person prepares a kit (its components per kit and its policy: assemble the kit when it sells, or pick the components) and a different person approves the policy. **Record a channel sale** names the channel and the channel's own event id: the first sight of an event takes exactly the kit's components from one location (and, for an assembling kit, assembles and sells the kit at their cost), a repeat of the same event returns the first outcome and moves nothing, and a sale larger than the stock behind it is refused before anything posts.
