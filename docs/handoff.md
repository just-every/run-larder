# The accountant handoff

Hand your accountant a valued batch of what moved, and match it line by line to their ledger.

Larder prepares operational costs, receipts and invoice lines for your accountant's ledger. It posts no journals; the ledger stays the authority.

## Prepare a batch

**Handoff → Ready to hand off** counts the movements not yet in a batch. A manager or your accounts person writes a note for the accountant and presses **Prepare handoff batch**. The batch is numbered `HO-0001`, `HO-0002` and so on, and never changes once prepared.

Each line carries its date, type, document, party and their reference, item, quantity and amount:

- **Supplier receipt**: goods received, at the purchase price.
- **Customer shipment (invoice preparation)**: goods shipped, at the order price, with the customer's reference, ready for the invoice.
- **Production material issue** and **Production output**: materials used and goods made, at cost.
- **Opening stock**, **Count adjustment** and **Customer return**, at cost.
- **Correction (reversal)**: a reversed movement from an earlier batch, pointing back to the line it corrects. A reversed shipment is valued at the order price, so it offsets its invoice line exactly.

**Download CSV** gives the accountant the same lines, with a `line` column that identifies each one.

## Record the acknowledgement

When the accountant has entered the batch, paste their reply under **Record the accountant's acknowledgement**, one line per entry:

```text
line from the CSV,INV-1043,178.00
```

Larder records each ledger reference against its line. A line whose amount differs from Larder's is flagged as a mismatch, and the batch shows **Mismatch** on **Today** until a later entry for the same line corrects it. When every line matches, the batch is **Acknowledged**.
