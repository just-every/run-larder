# sx-larder-c-f609 — native manufacturing change events

Repository: just-every/run-larder. Product branch: cloud/sx-larder-c-f609.
Candidate: a99abda4998359ab358158aa0f7c86f24a685005.
Base main: 171f7266ef82b5973a5d5036a37e60e5f6c6ea43.
Prior continuation retained: 996f4b9def04f825a3d0d20bc9b473743e61182a and ce2e72da79743df947b5903ff03382e849c1f9c0.
Save published: 06c833f5b54c5e8f7d132dc164fe1b3d3f8f4fb3.

SURFACE-009 remains PARTIAL. Point 1 is implemented and covered through authenticated HTTP. This continuation also implements the native supplier-date and material-usable portions of point 2. The complete second point still requires linked specialist handoffs and provider-confirmed ledger reconciliation. Local acknowledgments neither confirm accepted books nor emit a reconciliation event.

Counts before and after: 86 done, 39 partial, 39 missing, 164 total. No contract Status, Gap or Evidence cell changed. No acceptance sentence changed. No plan file was edited; the cloud handoff lists SURFACE-009's native gap reduction only. All supplied holds remain, including company-policy execution, autonomous consequential execution, shared MCP qualification, signed outbound delivery and retry under CONN-014, MCP subscriptions, specialist handoffs, additional event vocabulary and provider-confirmed books. No account, provider, Base or rer pin change was attempted.

## Changes and boundaries

The retained journal from the previous continuation atomically records receipts, output, quality holds, releases and dispatched partial shipments, with command-bound identities, exact record revisions, quantities, physical movements and original evidence links. This continuation adds:

- `supplier.date-recorded`: applied supplier confirmation and buyer delivery-date changes, preserving the distinction between supplier-confirmed dates and buyer estimates, exact changed lines, outstanding base-unit quantities, original supplier evidence and purchase revisions. First confirmation can establish a date that matches an estimate. Same-date edits emit no new date fact. Partial receipts reduce the quantity subsequently described as expected; they never relabel it as arrival.
- `material.usable`: one linked projection per supported physical receipt, ordinary output or release transition, with only positive available-status quantities passing current dates, open quality and recall holds, general certificate requirements and required inspections. Its source event ID prevents treating the projection as another receipt. The exact certificate policies, approved documents, inspection plans, results and original files are retained as links. Missing or revoked evidence, unchecked output, quarantined or expired stock, pending signatures and releases without eligible physical quantities do not establish usability.
- An additive schema upgrade expands the type constraint without changing old event bytes, IDs, sequences or sequence high-water marks. Append-only triggers remain enforced. A separate probe on the actual D1 runtime retained populated legacy rows, preserved the high-water mark 31 and assigned the next new event sequence 32; d1-upgrade.log records the exact candidate and result. Deployment migration delivery was regenerated from the source migration; historical migration bytes were preserved.

Usability is historical physical eligibility on the captured day. It is not a free-stock balance, a reservation, customer-specific shelf-life or certificate approval, a later eligibility promise, outside delivery or an adopted planning result. Inspection-only passes, date extensions, other stock doors and wider vocabulary are explicitly omitted by this bounded slice. No additional write authority or personal values are added. Read authority remains the existing unscoped native owner or manager boundary, with service credentials, current scopes, blind counts and revocation enforced.

## Acceptance and frozen proof rows

All referenced tests use the real Worker, authenticated HTTP and D1 migrations. Their final exact-candidate invocation and actual results are in CHECKS.json and touched-api.log. Push Verify event and status are in CI.json; no earlier SHA's success is claimed for the candidate.

| Row | Contract outcome or supplied POINT | Proof on candidate | Result |
| --- | --- | --- | --- |
| A1 | Receive and follow typed events to exact receipt revisions, quantities and original evidence | tests/api/flows.test.mjs, “LARDER-008 partial receipts record supplier lots and quarantine decisions”, lines 211–347; tests/api/change-event-proof.mjs, followEvent | Native covered |
| A2 | Produce and follow typed output to the exact work revision, good and scrap, output lot and actual allocations | tests/api/flows.test.mjs, “LARDER-009 released work issues materials and records output and scrap”, lines 350–383 | Native covered |
| A3 | Hold and release seeded goods and follow exact hold, inspection, plan and evidence revisions | tests/api/quality.test.mjs, “TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest”, lines 8–146 | Native covered |
| A4 | Partly ship and follow actual dispatched quantity and remaining commitments | tests/api/flows.test.mjs, “LARDER-010 pick, pack and partially ship against reservations; the rest stays committed”, lines 386–431 | Native covered |
| A5 | Supplier dates, usable material and ledger-reconciled events in linked handoffs without invented outcomes | tests/api/flows.test.mjs, “LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded”, lines 148–208; LARDER-008, lines 310–347; LARDER-009, lines 368–375; TRACE-004, lines 108–132; “LARDER-012 handoff exports costs and invoice preparation; acknowledgements and corrections reconcile”, lines 478 onward | Native dates and usability covered; specialist delivery and provider ledger readback remain unproved |
| P1 | No event on refusal; unchanged retry replays without duplication; paired movements do not multiply one transition | LARDER-007 unauthorized and stale dates; LARDER-008 competing identical receipts and missing or revoked certificates; LARDER-009 over-output; LARDER-010 refused dispatch; TRACE-004 missing retest, unauthorized release and pending signatures | Covered |
| P2 | Bounded native read, stable pinned pagination and restart, no restricted read or unnecessary personal values | tests/api/authority.test.mjs, “GOV-004 a changed BOM is followed through scheduling, operator correction, quality release and stock adjustment in a queryable, exportable, append-only audit without planted secrets”, lines 526–673; same file service-credential journey, lines 1353 onward | Covered |
| P3 | Restore original history without event re-emission, physical duplication or provider effects | tests/api/backup.test.mjs, “LARDER-020 an installation backup restores into a reset installation”, lines 23–180; “MOVE-008 source history searches original IDs and files, exports every record and restores without credentials or remote actions”, lines 182 onward | Covered |
| I1 | BASE-AGENT-010 inheritance and door rules D-2, D-3, D-6, D-8 | CONTRACT.md lines 1718–1728 cites BASE-AGENT-010; storage.commit guard and journal insertion use one atomic batch; authenticated public-door tests above prove local effects only | Native duty inspected and covered; shared MCP remains held |

## DONE-RIDERS review

This is a PARTIAL claim. No row below asserts that an external or landing duty has already passed.

| Rider | Result | Evidence or limit |
| --- | --- | --- |
| 1 | PARTIAL overall | A1–A4 cover point 1. A5 names every omitted point-2 outcome; no specialist or accepted-books claim is made. |
| 2 | PASS for native slice | Nonempty seeded records are followed to state and file doors; stale, unauthorized, missing-evidence and pending-signature paths are refused or produce no applied transition. |
| 3 | PASS | Push Verify 42599138928 completed success on a99abda4998359ab358158aa0f7c86f24a685005. Its existing API glob runs all four changed API files. No screen changed. |
| 4 | PASS local proof binding | CHECKS.json records exact candidate HEAD; no relevant source or test bytes changed afterward. |
| 5 | PASS placement | SURFACE-009 already cites BASE-AGENT-010. No acceptance or inheritance rewrite was needed. |
| 6 | PASS mechanical; judgment deferred | Generator write and check pass with zero errors. Generated views are restored from main and uncommitted. No builder status, gap, evidence or count edits. |
| 7 | PASS | CONTRACT.md has zero diff from main. No acceptance points, ID mapping or coverage obligations changed. |
| 8 | PASS native authority | GOV-004 reads as owner and unscoped manager, denies other roles, explicit locations, sites, cost restrictions and a blind count after promotion; role change and deactivation deny subsequent reads. Service credentials cannot use the journal. |
| 9 | PASS honest boundary | API.md and this report retain missing provider and specialist qualification. LARDER-012 proves local ledger IDs and corrected acknowledgments create no provider-reconciled event or provider readback. |
| 10 | Not applicable | Existing authority and approval rules are reused. No new custody, spending, consent or delegated policy default was adopted. |
| 11 | Pending guarded lander | Main equality, candidate Run site and complete full-history publication scan remain the fleet lander's work. No cloud landing or count change is claimed. |

## Pre-ready review

1. Named native behaviors have integration assertions on seeded data through the ordinary command and read doors. Push Verify 42599138928 completed success on the exact candidate; CI.json retains its event, status, conclusion and URL. The unproved remainder keeps the clause PARTIAL.
2. No test registration, existing user-visible assertion or guard was removed, skipped, narrowed or moved behind a width or branch condition. The existing purchase journey now has two lines and still asserts its exact exposure. The fixed-clock receipt journey sorts approval rows before checking the same complete decisions, quantities, reasons and actor IDs because persistence does not order equal timestamps. Zero registrations were added.
3. Current scope, role, credential and session fences remain active for journal reads and retries. Events copy no actor names, labels, free text, file names, contact names or addresses. Existing former-operator erasure and replay journeys remain in the touched authority file. Restore preserves history but cannot revive live authority or execute producers.
4. No UI or screen was touched; browser screenshots, visual design and tooltip work are not applicable.
5. Source lock and deployment specification checks pass. Publication scan and landing receipts are not available in cloud and are not fabricated. The candidate diff contains zero new email-shaped strings or bare prose repository tokens.

## Runtime probes

PROBE SURFACE-009 1: authenticated receipt.create, wo.output, quality.inspect, quality.release and shipment.ship followed by GET /api/larder/audit/events and state or evidence-file reads -> exact committed record revisions and quantities, refused and pending attempts absent, retries stable.

PROBE SURFACE-009 2: authenticated po.confirm and line-specific po.revise, accepted and mixed-disposition receipt.create, evidenced quality and quarantine release -> retained confirmed and revised dates, outstanding quantity 15 after a receipt of 5 from 20, eligible quantity 2 with held and expired quantities omitted; local handoff.acknowledge -> unchanged journal and no provider request. Linked specialist delivery and actual ledger readback were not attempted.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node src/base/contract-docs.mjs write then check exit=0; ledger=no standalone seed command; migration delivery check and retained-history upgrade probe exit=0.

## Gates and custody

Local exact-SHA checks: see CHECKS.json for commands, exits, start and end times and actual output files. Setup succeeded with the existing local development mail choice and supplied fleet identity. No outbound mail or provider connection was configured. Production build uses the unchanged project runtime and rer pin. No PR is needed: the repository's Verify workflow accepts branch pushes directly.

Main's existing push Verify 41252605263 and Run site 41252604855 were success on 171f7266ef82b5973a5d5036a37e60e5f6c6ea43. They are baseline information only, not candidate proof. Candidate CI, product publication and evidence transfer are recorded separately. Full history is retained; the product branch contains both previous continuation commits and this run's new commits. Before the final commit, main was fetched and merged without drift. Candidate commit identities and trailers are checked across every parent before every push.

publication_scan commit=a99abda4998359ab358158aa0f7c86f24a685005 complete=NOT_RUN historyScanned=NOT_ESTABLISHED findings=NOT_ESTABLISHED; cloud product push is exempt and the Mac lander owns the complete scan.

CLAIM SURFACE-009 PARTIAL points=1 tests=tests/api/flows.test.mjs#LARDER-008 partial receipts record supplier lots and quarantine decisions; tests/api/flows.test.mjs#LARDER-009 released work issues materials and records output and scrap; tests/api/quality.test.mjs#TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest; tests/api/flows.test.mjs#LARDER-010 pick, pack and partially ship against reservations; the rest stays committed

GAP SURFACE-009: Point 2's linked specialist handoffs and provider-confirmed ledger reconciliation remain unproved; native supplier-date and material-usable events now ship. MCP subscriptions, signed outbound delivery and retry, broader vocabulary, company-policy execution and shared conformance remain held as supplied.

Final local results: 75 of 75 touched API tests passed on a99abda4998359ab358158aa0f7c86f24a685005, with zero failures and zero skipped tests. Typecheck, first-party composition, production build, deployment migration delivery and source-lock freshness all exit 0 on that exact SHA.



Final CI: push Verify 42599138928 completed success on a99abda4998359ab358158aa0f7c86f24a685005, observed by REST at 2026-11-09T10:27:12Z. Six of the ten permitted GitHub calls were used. No workflow dispatch, rerun or PR was created. Candidate Run site, main equality and full-history publication scanning remain guarded landing obligations.

Product custody: remote refs/heads/cloud/sx-larder-c-f609 was verified at a99abda4998359ab358158aa0f7c86f24a685005. The separately published report packet was fetched back and all 17 selected file hashes verified before its final CI update. The final evidence publication contains that update; its exact ref and head are returned in the terminal EVIDENCE line.
