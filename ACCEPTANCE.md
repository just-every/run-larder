# Larder acceptance record

Each first-release clause in [CONTRACT.md](CONTRACT.md) has one flow test through a public door: authenticated HTTP to the real Worker with D1 and the committed migrations (`tests/api/*.test.mjs`, run by `pnpm run test:larder`), and the owner's journeys through the built app in a real browser after a real `rer setup` and `rer dev` at 1440 and 390 pixels wide (`tests/browser/journey.spec.ts`, run by `node tests/browser/run.mjs`). Both run inside `rer verify`.

Status **LOCAL PROVEN** means the named test passes in `rer verify`. It does not claim hosted operation, provider behaviour, a real owner's export, physical stock accuracy or legal clearance.

| # | What a person can do | Test | Status |
| --- | --- | --- | --- |
| LARDER-001 | Create items, variants, exact units and parties; ambiguous or rounding conversions, duplicates and ambiguous codes are refused; used units stay fixed | `flows.test.mjs` › LARDER-001 | LOCAL PROVEN |
| LARDER-002 | Record counted opening stock by location with date, valuation basis, cost, lot and evidence file; no second opening | `flows.test.mjs` › LARDER-002 | LOCAL PROVEN |
| LARDER-003 | Save BOM revisions with routing; released work keeps its pinned revision after a new one | `flows.test.mjs` › LARDER-003 | LOCAL PROVEN |
| LARDER-004 | Quote and confirm; see on hand, reserved, expected purchase and production, unreserved demand and available to promise separately | `flows.test.mjs` › LARDER-004 | LOCAL PROVEN |
| LARDER-005 | Six concurrent reservations of the same stock never reserve more than exists; a retry returns its recorded outcome; reuse with other content is refused | `flows.test.mjs` › LARDER-005 | LOCAL PROVEN |
| LARDER-006 | Review deterministic shortages with dates and reasons; draft the work order and the purchase order they call for | `flows.test.mjs` › LARDER-006 | LOCAL PROVEN |
| LARDER-007 | Approve a purchase order (terms and exposure recorded), record supplier confirmation, revise delivery with history | `flows.test.mjs` › LARDER-007 | LOCAL PROVEN |
| LARDER-008 | Receive part of a purchase with a supplier lot into quarantine, then release and reject with recorded decisions; over-receipt refused | `flows.test.mjs` › LARDER-008 | LOCAL PROVEN |
| LARDER-009 | Release work, issue actual materials, record output and scrap, close with material cost and variance | `flows.test.mjs` › LARDER-009; browser journey (issue drawn across a lot-tracked opening) | LOCAL PROVEN |
| LARDER-010 | Pick only reserved stock, pack and ship part of an order; the rest stays committed | `flows.test.mjs` › LARDER-010; both browser journeys | LOCAL PROVEN |
| LARDER-011 | Receive a return, transfer free stock, count with another person's approval, reverse a shipment by compensating movements; a reversal with downstream use is refused | `flows.test.mjs` › LARDER-011 | LOCAL PROVEN |
| LARDER-012 | Prepare an immutable valued handoff batch and CSV; record ledger acknowledgements; mismatches surface until corrected; a later reversal arrives as a correction to the earlier batch line | `flows.test.mjs` › LARDER-012; browser journey | LOCAL PROVEN |
| LARDER-013 | Resolve a decision exception with a note; export the complete archive; a damaged archive is refused; restore into an empty installation reconciles every position and keeps working | `flows.test.mjs` › LARDER-013 | LOCAL PROVEN |
| LARDER-014 | Roles and sessions are enforced in every handler and inside every write; role loss and sign-out take effect immediately; cross-site commands refused | `authority.test.mjs` › LARDER-014 | LOCAL PROVEN |
| LARDER-015 | Agents prepare order intake, replenishment, an item merge, a reschedule and a reconciliation; people approve or decline exact versions; agents and preparers cannot approve; stale proposals refused; decisions recorded | `authority.test.mjs` › LARDER-015 | LOCAL PROVEN |
| LARDER-016 | Preview an Odoo export (dry run) with rejected rows and External IDs, commit through the import kit with originals kept, undo, refuse malformed files and repeats, refuse undo after live work | `move-in.test.mjs` › LARDER-016; browser journey (move-in through the screen) | LOCAL PROVEN |

## Evidence

`rer verify` runs every clause's flow test and the browser journeys at both widths on each push in the Verify workflow. The Odoo fixtures in `fixtures/odoo/` were written from Odoo's published import/export documentation; they are not a real owner's export, so Odoo move-in acceptance with a real owner remains open.

## Not yet accepted

- A real owner's Odoo export and a parallel run against their current system.
- Hosted deployment, mail delivery and any provider integration.
- Physical-count accuracy, and accountant acceptance of the handoff format with a real ledger.
- The Katana BOM kit (second move-in) and live model execution for the agent workflows.
