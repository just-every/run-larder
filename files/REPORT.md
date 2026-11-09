# sx-larder-c-f608 actual report

CLAIM SURFACE-009 PARTIAL points=1 tests=tests/api/flows.test.mjs#LARDER-008 partial receipts record supplier lots and quarantine decisions; tests/api/flows.test.mjs#LARDER-009 released work issues materials and records output and scrap; tests/api/flows.test.mjs#LARDER-010 pick, pack and partially ship against reservations; the rest stays committed; tests/api/quality.test.mjs#TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest; tests/api/authority.test.mjs#GOV-004 a changed BOM is followed through scheduling, operator correction, quality release and stock adjustment in a queryable, exportable, append-only audit without planted secrets; tests/api/backup.test.mjs#LARDER-020 an installation backup restores into a reset installation; tests/api/backup.test.mjs#MOVE-008 source history searches original IDs and files, exports every record and restores without credentials or remote actions

GAP SURFACE-009: Point 2 remains unproved: supplier-date, standalone material-usable and provider-confirmed ledger-reconciled handoff events; shared MCP events and subscriptions, specialist handoffs, signed outbound delivery and retries, and the wider event vocabulary remain omitted under the supplied holds. Native local acknowledgments do not establish accepted books.

Candidate: `ce2e72da79743df947b5903ff03382e849c1f9c0`, branch `cloud/sx-larder-c-f608`, repository `just-every/run-larder`.
Baseline main: `171f7266ef82b5973a5d5036a37e60e5f6c6ea43`. Product push succeeded and the named remote ref matches the candidate.
No PR is required by this repository's branch-push Verify entry point; none was created.
Verify run [42594317095](https://github.com/just-every/run-larder/actions/runs/42594317095) is an exact-candidate push run: in_progress, conclusion None.
Main's pre-existing Verify 41252605263 and Run site 41252604855 are successful on the baseline; they are not candidate proof.

## Plan and result

1. Read the current contract, acceptance views, public API, move-in contract and native authority, audit, storage, physical-transition and archive paths. The live contract already marks the target partial. Point 1 lacked a native typed event journal; point 2 includes the retained handoff and provider boundaries.
2. Add a closed five-type vocabulary and append-only D1 journal with one stable command-bound event per applied native transition. Project exact source versions, the committed state version, related record versions, physical quantities, movements and retained file IDs and digests.
3. Generate the event statements only after successful domain handling, inside the existing authority- and state-version-guarded atomic batch. Refusals, pending signatures, attempts, projections and generic audit labels do not emit events. Paired movements remain one business event; concurrent command retry reuses the saved outcome.
4. Expose bounded ascending reads at `GET /api/larder/audit/events`, with validated integer cursors, a pinned upper sequence, exact type and command filters, default 100 and maximum 200 rows. Reuse unscoped native owner and manager audit authority, current sessions, blind-count and scope restrictions. Copy no personal labels, actor names, file names, free text, prices or bodies.
5. Preserve journal entries and their sequences in JSON and CSV business archives and native installation backup. Restore inserts inert retained facts directly and never calls producers. Older archives without events use an empty journal. Package the additive migration through the generated deployment specification.
6. Extend existing receipt, production, shipment, quality, audit-authority and backup journeys; add no test registrations and remove no existing assertions. Verify the typed records and actual file doors, refusal, pending signatures, retry, restart, pagination while later events append, live restrictions and revocation, and both restore paths.
7. Push a first real save (`996f4b9def04f825a3d0d20bc9b473743e61182a`, skip CI), merge updated main, regenerate and check views then restore them from main, regenerate the source lock last, check it, and push the candidate through the fleet guard. Both pushes succeeded on their first attempt with fleet-only identities and no trailers.

Result: point 1 is locally proven. The clause stays PARTIAL because point 2 and the supplied held remainder are not delivered by this round.
Counts from the actual current Status table: **86 done, 39 partial, 39 missing (164 total) → 86 done, 39 partial, 39 missing (164 total)**.
Plan-row return: SURFACE-009 native point 1 complete; retain the held remainder. No lane plan file, Status, Gap, Evidence or acceptance sentence was edited.
No next unblocked target is provided after this target in the extract.

## Frozen proof rubric

| Item | Outcome | Public-door proof | Candidate Verify |
| --- | --- | --- | --- |
| R1a, acceptance 1: receive goods and follow typed event to committed revision | PASS local | `tests/api/flows.test.mjs:166` — LARDER-008 partial receipts record supplier lots and quarantine decisions; lines 174–195 assert concurrent retry, exact receipt and PO revisions, lot quantities, evidence, and restart | 42594317095, push, in_progress, None |
| R1b, acceptance 1: produce goods and follow output revision | PASS local | `tests/api/flows.test.mjs:262` — LARDER-009 released work issues materials and records output and scrap; output batch, good and scrap, exact issues, lot and work revision, refused excess and retry | Same exact candidate run |
| R1c, acceptance 1: hold goods | PASS local | `tests/api/quality.test.mjs:8` — TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest; nonempty held quantities, inspection and plan versions, file digest and paired movement assertions | Same exact candidate run |
| R1d, acceptance 1: release goods | PASS local | Same quality journey; unsafe release and missing evidence refuse, a successful first signature stays pending without an event, the independent completed decision emits one exact release; receipt journey also covers paired quarantine release | Same exact candidate run |
| R1e, acceptance 1: partly ship goods | PASS local | `tests/api/flows.test.mjs:293` — LARDER-010 pick, pack and partially ship against reservations; the rest stays committed; picks, packing and refused shipment emit nothing; dispatched source revision, physical movements, partial flag and exact remaining commitment are checked | Same exact candidate run |
| R2, acceptance 2: supplier-date, material-usable and ledger-reconciled handoff events | UNMET, retained scope boundary | Not implemented or claimed; the provider-confirmed and shared handoff remainder stays named | Not claimed |
| R3, journal authority, minimization and stable bounded read | PASS local | `tests/api/authority.test.mjs:526` — GOV-004 a changed BOM is followed through scheduling, operator correction, quality release and stock adjustment in a queryable, exportable, append-only audit without planted secrets; populated owner and manager reads, one-row cursor traversal, append during traversal, restart, filter, invalid cursor refusal, no personal labels or planted credentials, restricted roles, both location and cost scope, and live revocation | Same exact candidate run |
| R4, restore and replay safety | PASS local | `tests/api/backup.test.mjs:23` — LARDER-020 an installation backup restores into a reset installation; actual export, reset and import commands retain all table rows, IDs, sequences and files, refuse damaged and nonempty imports, require fresh sessions and emit no events or provider effects | Same exact candidate run |
| R5, business archives and inert resource links | PASS local | `tests/api/backup.test.mjs:181` — MOVE-008 source history searches original IDs and files, exports every record and restores without credentials or remote actions; nonempty event history in JSON and decoded CSV, second-install restore, old-session refusal, replay refusal, preserved original file digest, restart and unchanged physical stock | Same exact candidate run |
| I1, inherited BASE-AGENT-010 duty | Native delta PASS local; full inherited surface unestablished | Existing clause cites BASE-AGENT-010. Native manufacturing changes can be followed; shared MCP events, subscriptions and specialist handoffs remain omitted | Full qualification not claimed |

The independent public probe uses a fixed clock and the real Worker and D1 HTTP harness. It observes all five types, follows their committed source revisions and file links, proves refused release and receipt replay append nothing, and checks restart and inert restore. Actual observations are in `RUNTIME-PROBE.json`; source and destination outbound request counts are both zero.

PROBE SURFACE-009 1: authenticated receipt, work output, failed inspection, passing retest with release, and partial shipment, followed by GET audit events and state -> five exact typed events; refused release and receipt retry add none; restart and restore preserve all five with zero provider calls.
PROBE SURFACE-009 2: none, supplied held handoff and provider vocabulary remains outside this bounded native slice.

## Local validation and mechanical receipt

The final local 75-test run is PASS, 75 passed and zero failed on `ce2e72da79743df947b5903ff03382e849c1f9c0`; the full actual output is retained in `TOUCHED-TESTS.log`.
An earlier complete touched-file run also passed all 75. Typecheck, production build, first-party composition and generated deployment-spec checks pass. No screen changed, so no browser screen proof is applicable.
The prescribed toolchain ran tests under Node 24.19.0 (its emitted engine warning is retained); the RER build selected the project's pinned Node 22.20.0. CI uses the project's pinned Node.
Initial noninteractive setup needed the declared local-development mail answer and a contained answer path; the completed setup exited 0. No provider was connected.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node src/base/contract-docs.mjs write then check exit=0, followed by restoring ACCEPTANCE.md and docs/CLAIMS.md from origin/main; ledger=cloud_run node /tmp/larder-migration-probe.mjs exit=0.
The ledger probe invokes the pinned native migration preflight against a real disposable installation and verifies `0026_change_events.sql` is already applied. The public backup journey independently exports and restores that actual migration history.
The contract source is byte-identical to main. Generated views are not committed.
No test registration was added, deleted or skipped. Existing dangerous-path assertions remain in place.
A development-only audit test initially placed its new revocation exercise before an older manager-read assertion; it was moved after that unchanged assertion. The corrected journey and the full touched run pass. There was no CI repair round.

## DONE-RIDERS assessment

No DONE claim is made. These rows distinguish local implementation evidence from pending independent landing gates.

| Row | Assessment | Proof or remaining condition |
| --- | --- | --- |
| 1 | PARTIAL at clause level | R1a–R1e are locally met by the named nonempty public journeys; R2 remains held and unproved |
| 2 | PASS local | Receipt excess, output excess, pick and dispatch refusal, unsafe quality release, pending signature, role and scope refusal, damaged archive and nonempty-destination refusal are exercised with unchanged physical effects or history |
| 3 | PENDING | Exact-SHA Verify 42594317095: in_progress, conclusion None; no earlier-SHA green is substituted |
| 4 | PASS local | Final touched log and runtime and migration probe receipts bind to `ce2e72da79743df947b5903ff03382e849c1f9c0`; no subsequent product change |
| 5 | INSPECTED | SURFACE-009 retains its BASE-AGENT-010 citation; the full inherited MCP duty remains explicitly unestablished |
| 6 | PASS mechanical; judgments unchanged | Contract write and check both exit 0; restore generated views; retain main's Status, Gap and Evidence cells for the lander |
| 7 | PASS | No acceptance, rider, identifier, ruling or coverage rewrite |
| 8 | PASS local | Populated owner and manager reads succeed; other roles, scoped managers, integration credentials and revoked people are refused through HTTP |
| 9 | PASS boundary | No claim of provider receipt, accepted ledger books, outbound delivery, subscriptions, shared MCP qualification or autonomous execution |
| 10 | PASS, no new policy default | The journal reuses the existing native audit authority and minimization boundary |
| 11 | PENDING Mac lander | Candidate remains branch-only; main equality, complete publication scan and exact candidate Run site are unestablished |

## Pre-ready self-check

1. Native point 1 outcomes are asserted on real records through the HTTP door, including the unsafe path; the exact candidate Verify state is reported above.
2. No existing assertion was removed, narrowed, skipped or placed behind a width or branch condition.
3. Current role and scope, session revocation, restored-session refusal and historical-command replay refusal are covered. The journal stores no person labels or actor IDs to resurrect; it keeps source resource IDs and command links. Existing erasure journeys in the touched authority file still pass.
4. Screens, tooltips, typography and Settings placement: not applicable, no UI changed.
5. Source lock fresh; generated-view write and check pass. Added product lines contain zero email-shaped strings and only synthetic fixture values. The two candidate commits have fleet-only authors and committers and no trailers. Exact candidate publication scanning and main-only Run site remain the guarded lander's work.

Exact-SHA scan receipt: commit=ce2e72da79743df947b5903ff03382e849c1f9c0; complete=UNESTABLISHED; historyScanned=UNESTABLISHED; findings=UNESTABLISHED. Cloud did not run a publication scanner and does not claim zero findings.
Main equality: false; reported remote main is `171f7266ef82b5973a5d5036a37e60e5f6c6ea43`. Candidate Run site: not run (main-only). No product blocker is asserted; the supplied omitted obligations keep the claim partial.

## Return and cleanup

Complete relevant reports, actual receipts, public probe source and safe logs are selected explicitly in this packet. No credential file, environment dump, private gate material or symlink is selected.
Evidence is published only to `refs/heads/evidence/sx-larder-c-f608`, independently of product custody. No evidence is committed to the product branch.
After transfer and verification, the owned clone and dependencies are removed as requested. All actual packet files remain under the fleet work directory.
