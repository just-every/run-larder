<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Larder homepage claims

A claim is done when every clause behind it is done, missing when every one is missing, and partial otherwise.

| # | Claim | Clauses | Status |
| --- | --- | --- | --- |
| 1 | "Promise dates you can keep." (headline; closing: "Ship on the day you said.") | `DEMAND-001` partial; `CAP-004` done | partial |
| 2 | "plans your materials" | `LARDER-006` partial; `MRP-001` done; `MRP-006` done | partial |
| 3 | "and machines" | `CAP-001` done; `CAP-002` done; `CAP-004` done | done |
| 4 | "runs the shop floor" | `FLOOR-001` done; `LARDER-009` done | done |
| 5 | "traces every lot" | `TRACE-001` done; `LARDER-008` done | done |
| 6 | "costs every job" | `COST-001` done; `LARDER-009` done | done |
| 7 | "keeps QuickBooks in sync" | `CONN-001` missing; `LARDER-012` done | partial |
| 8 | "100% free, open source alternative to Katana, MRPeasy and Fishbowl" | `OPEN-001` partial; `MOVE-001` missing; `MOVE-002` missing; `MOVE-003` missing; `MRP-001` done; `MRP-006` done; `CAP-004` done; `LARDER-008` done; `LARDER-009` done; `CONN-001` missing | partial |
| 9 | "Walnut 8/4 · 1,240 bd ft · reserved" | `LARDER-001` done; `LARDER-005` done | done |
| 10 | "Router 2 down 2 hrs → 3 jobs moved to Router 1 · Nov 6 still on" | `AGENT-001` partial; `CAP-007` done; `CAP-009` done | partial |
| 11 | "QC · fill weight 4.0 oz · passed" | `TRACE-004` done | done |
| 12 | "Order margin 41.6%" | `COST-004` done | done |
| 13 | "Lot BB-1020 · 480 tins · Oct 20 · exp Apr 2028" | `TRACE-001` done; `TRACE-003` partial | partial |
| 14 | "Larder checks walnut, machines and people before it offers a ship date" | `DEMAND-001` partial; `CAP-001` done; `CAP-002` done | partial |
| 15 | "then prices the job to the cent" (Q-0412 lines, $25,010.00) | `LARDER-004` done; `US-001` done; `DEMAND-001` partial | partial |
| 16 | Ship date options (three capable-to-promise dates) | `DEMAND-001` partial | partial |
| 17 | "Sales tax · resale certificate on file" | `US-002` missing | missing |
| 18 | "Est. margin 42.0%" | `DEMAND-001` partial; `COST-004` done | partial |
| 19 | "Confirmed Thu Oct 8 → SO-1184" | `LARDER-004` done | done |
| 20 | "MRP explodes the bill of materials" (multilevel BOM) | `ENG-001` done | done |
| 21 | "nets what you have and drafts what to buy, with dates" (net requirements, PO-5521, PO-5524, MO-2198) | `LARDER-006` partial; `MRP-001` done; `MRP-006` done | partial |
| 22 | "BOM · FW-EG-1218 rev C" | `LARDER-003` done | done |
| 23 | "2 POs approved by Dana W. · 9:31 AM" | `LARDER-007` done | done |
| 24 | "The planning agent reads the supplier’s reply" | `AGENT-002` partial | partial |
| 25 | "and hands Dana a new cut plan that still ships Nov 6" (Approved by Dana W.) | `AGENT-001` partial; `LARDER-015` partial | partial |
| 26 | "ETA Oct 19 → Oct 23" on PO-5521 | `LARDER-007` done | done |
| 27 | "Next chase Oct 21 if no ship notice" | `AGENT-002` partial | partial |
| 28 | "Lots ... are recorded as you make" | `LARDER-008` done; `LARDER-009` done | done |
| 29 | "checks and expiry are recorded as you make" | `TRACE-003` partial; `TRACE-004` done | partial |
| 30 | "Trace any lot forward to every order or back to every input" (genealogy, Trace forward/back, Export trace CSV) | `TRACE-001` done | done |
| 31 | Held lot BW-0911 "held · CoA missing", swapped for BW-0930 | `LARDER-008` done; `TRACE-007` done | done |
| 32 | "Actual $4.18/tin · plan $4.10" | `LARDER-009` done; `COST-003` done | done |
| 33 | "QC · fill weight 4.0 oz · passed", "20 sampled · avg 4.03 oz · limits 3.95–4.15" | `TRACE-004` done | done |
| 34 | Outputs to Shopify (141 orders) and Amazon FBA | `CONN-003` missing; `CONN-005` missing | missing |
| 35 | "Every job lands on a real machine and a real person, inside real shift hours" | `CAP-001` done; `CAP-002` done | done |
| 36 | Finite-capacity Gantt, Today line, "Unscheduled 0 · Late 0 · Bottleneck Sanding" | `CAP-004` done | done |
| 37 | "Operators start and stop work on a tablet" | `FLOOR-001` done; `FLOOR-002` partial | partial |
| 38 | "scan every lot" | `FLOOR-008` done | done |
| 39 | "log good and scrap as they go" (Good 96, Scrap 2) | `LARDER-009` done | done |
| 40 | Phone: held lot LF-0928 refused at issue | `LARDER-008` done | done |
| 41 | Drawing "FW-EG-1218 rev C" on the station | `ENG-002` done | done |
| 42 | "The planning agent lays out two fixes" (Option A/B with dates and overtime) | `AGENT-001` partial; `CAP-007` done | partial |
| 43 | "Dana picks one" (Approved by Dana W. · 1:46 PM) | `LARDER-015` partial; `GOV-002` done | partial |
| 44 | Downtime timeline (spindle fault logged, released, 240/240) | `FLOOR-007` done; `CAP-009` done | done |
| 45 | "Customer dates changed: 0" | `DEMAND-005` done | done |
| 46 | "SO-1184 · 21 cartons · out Fri Nov 6, 3:40 PM" | `LARDER-010` partial | partial |
| 47 | "Wholesale, Shopify and Amazon orders ship from one list" | `LARDER-010` partial; `CONN-003` missing; `CONN-005` missing; `DEMAND-008` missing | partial |
| 48 | "Labels, tracking ... sync as they go" | `CONN-007` missing; `LARDER-010` partial; `AUTO-003` missing | partial |
| 49 | "and invoices sync as they go" | `CONN-001` missing; `DEMAND-007` partial | partial |
| 50 | Materials column (In stock / Gift boxes · PO-5530 Nov 9) | `DEMAND-006` done | done |
| 51 | "ShipStation · 23 labels · tracking live" | `CONN-007` missing; `AUTO-003` missing | missing |
| 52 | "Shopify · stock updated 3:41 PM" | `CONN-003` missing; `AUTO-003` missing | missing |
| 53 | "Amazon · FBA shipment booked" | `CONN-005` missing | missing |
| 54 | "QuickBooks · Invoice 3317 · $25,010.00 · synced" | `CONN-001` missing | missing |
| 55 | "Actual walnut, labor, machine time and tins, costed in dollars" | `COST-001` done | done |
| 56 | "and posted to QuickBooks" (COGS journal synced) | `CONN-001` missing | missing |
| 57 | "Order margin 41.6%" | `COST-004` done | done |
| 58 | "Quoted 42.0% → actual 41.6%", "Variance +$103.20" | `COST-003` done; `COST-004` done | done |
| 59 | "Explained by the planning agent · 2 sources" | `AGENT-003` partial | partial |
| 60 | "Bring your shop from Katana." (Katana import preview) | `MOVE-001` missing | missing |
| 61 | "Items, BOMs, lots, open orders and stock values come across" | `LARDER-016` done; `MOVE-004` partial; `MOVE-007` partial | partial |
| 62 | "MRPeasy, Fishbowl, Odoo, Fulcrum and DOSS too" | `MOVE-002` missing; `MOVE-003` missing; `MOVE-004` partial; `MOVE-005` missing; `MOVE-006` missing | partial |
| 63 | "Stock value $86,412.50 · matched to the cent", "2 rows to review" | `LARDER-016` done; `MOVE-007` partial | partial |
| 64 | `npx -y @runeditrun/rer dev just-every/run-larder` starts Larder on your computer | `OPEN-001` partial | partial |
| 65 | "100% free and open source. MIT licensed." | `OPEN-001` partial | partial |

Claims: 65; 29 done, 28 partial, 8 missing.
