# sx-larder-c-f611 report

CLAIM SURFACE-009 PARTIAL points=1 tests=tests/api/flows.test.mjs#LARDER-008 partial receipts record supplier lots and quarantine decisions; tests/api/flows.test.mjs#LARDER-009 released work issues materials and records output and scrap; tests/api/quality.test.mjs#TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest; tests/api/flows.test.mjs#LARDER-010 pick, pack and partially ship against reservations; the rest stays committed

GAP SURFACE-009: Point 2 still lacks specialist handoffs and provider-confirmed ledger reconciliation. Company-policy execution, autonomous consequential execution, shared MCP conformance, signed outbound delivery and retries, subscriptions and remaining event vocabulary retain their supplied holds.

Repository: just-every/run-larder. Product branch: cloud/sx-larder-c-f611. Candidate: **c676cb763af64d9cd6a6283bae82904d6a64af09**. Product push succeeded and the remote ref was read back at this exact SHA. No PR was required or created: Verify has a branch-push entry point. No default branch was pushed or advanced by this cloud task.

Counts before and after: **86 DONE, 39 PARTIAL, 39 MISSING**. SURFACE-009 remains PARTIAL. No contract Status, Gap, Evidence, acceptance sentence or summary count was edited. No campaign plan file was changed; the plan return is that the bounded native event slice is implemented and Point 2 retains its external and specialist remainder. The full working plan is in [PLAN.md](PLAN.md).

## Delivered behavior

The predecessor's unfinished changes at a99abda4998359ab358158aa0f7c86f24a685005 were replayed while preserving newer writers. During this run, main landed the base journal and then more precise resource projections. The first product save was ffc339e0b6bebe4a3c1c3d2d3ce8c4a0645e6fce with skip CI. The final candidate merges e9e99660679665048f0b0f8162ac1884056fcac2; published history was never rebased or force-pushed. Main's resource allocation, scope and original-file assertions remain present.

The journal retains stable command-bound IDs, source and related revisions, base-unit quantities, physical movement identities and original evidence digests. It stores applied receipt, work-output, inspection hold, quality release and partial-dispatch facts in the same guarded D1 batch as their business effects. The continuation adds supplier-confirmed and buyer-revised date facts, plus bounded material-usability facts linked to actual positive available movements. Usability checks current dates, recall and quality holds, required inspections and general certificates; it copies their exact revisions and evidence. It does not turn a prediction, passing inspection by itself, pending signature, local handoff acknowledgment or attempted command into physical arrival or accepted books.

Native unscoped owners and managers use the existing audit boundary. Other roles, service credentials, scoped managers, blind counters and revoked sessions are refused. Events omit actor labels, free text, file names, commercial amounts and document bodies. Pinned pagination survives restart and later appends. Both archive formats and the installation commands retain event history without re-emission or restored authority.

The final receipt journey injects a failing journal insert and proves stock, receipts, lot records, files and command effects roll back; the identical command subsequently commits once. The final audit journey revokes a real native writer after validation, before the batch, and proves an AUTH refusal leaves no source record, physical movement, file or event. Newer resource fixtures produce separate one-unit and three-unit output batches; their complete event history is retained and restored.

## Actual validation

- Initial four-file touched run: 75 tests, 72 passed and 3 failed. The source-history expectation omitted main's resource-fixture events; it was corrected to verify both histories. The new failure-injection assertion initially expected HTTP 500; the documented API returns 409 UNCONFIRMED, so that assertion was corrected while retaining unchanged-state checks. A recovery archive restore returned 409 in that initial run; the isolated test passed on declared Node 22 with no product change. The integration overlapped the initial run, and no specific cause of that transient restore refusal is claimed.
- Stable focused rerun on Node 22: **5 passed, 0 failed**, including the corrected source-history and receipt journeys plus the in-flight revocation and affected approval and scope paths.
- Isolated unchanged recovery journey on Node 22: **1 passed, 0 failed**. See recovery-reproduce.log.
- Final merged tree on Node 22: **11 passed, 0 failed**, covering all named native transitions, supplier dates, material usability, exact resource links, journal authority, paging, restoration, handoffs and service-key refusal. See tests-merged.log. No relevant source or test was edited after this run; proof-files.json binds final file digests.
- Final merged production build: exit 0; typecheck: exit 0; first-party check: exit 0; deployment-spec check: exit 0.
- Contract generator write and check: exits 0 and 0; generated views were restored from origin/main and neither was committed. Source lock regeneration and final committed-candidate freshness check: exits 0 and 0.
- Local installation migration ledger: read-only Wrangler query and equality comparison passed; all 28 committed migration files, including 0026 and 0027, match the applied ledger. The actual receipt reports the authoritative count. Public export, reset and import also passed with unchanged retained journal history.
- Setup initially requested MAIL_PROVIDER, then rejected an external answers path. The contained ignored answers file selected development mail; setup completed successfully. The first typecheck lacked the generated route tree; normal setup and build generated it, and both later typechecks passed. No Base pin or workflow change was made.
- No test registration was added or removed. Existing assertions were retained, including main's newer resource, commercial and restoration assertions. No assertion was skipped, narrowed or hidden behind a width or branch condition. Only existing journeys were extended. No UI was changed by this work, so new browser screenshots were not required.

## Frozen rubric and acceptance coverage

Every source reference below points at the pushed candidate. The final Verify is push run **42620476277**, status **in_progress**, conclusion **None**, head **c676cb763af64d9cd6a6283bae82904d6a64af09**. Local tests were run on the final merged source before the commit; the exact-SHA push workflow is the full independent CI gate.

| Item | Outcome and actual proof | Result |
| --- | --- | --- |
| Acceptance sentence 1; R1 receipt | [tests/api/flows.test.mjs:238](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/flows.test.mjs#L238) — LARDER-008 partial receipts record supplier lots and quarantine decisions; exact receipt revision, two held lines, quantities, original file and movements; concurrent retries and fault rollback | MET locally |
| Acceptance sentence 1; R2 output | [tests/api/flows.test.mjs:393](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/flows.test.mjs#L393) — LARDER-009 released work issues materials and records output and scrap; four good, one scrap, exact output revision and input allocations | MET locally |
| Acceptance sentence 1; R3 hold and release | [tests/api/quality.test.mjs:8](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/quality.test.mjs#L8) — TRACE-004 approved inspection plans hold failed work and lots from start, output, pick and ship until an authorized release after a passing retest; paired four-unit movements, current retest and release evidence, pending signature and unsafe-actor refusals | MET locally |
| Acceptance sentence 1; R4 partial dispatch | [tests/api/flows.test.mjs:431](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/flows.test.mjs#L431) — LARDER-010 pick, pack and partially ship against reservations; the rest stays committed; dispatch three of six, remaining three, exact shipment and order revisions; pick and pack emit no event | MET locally |
| R5 atomicity and retry | [tests/api/flows.test.mjs:252](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/flows.test.mjs#L252) and [tests/api/authority.test.mjs:709](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/authority.test.mjs#L709) — failed journal insert and revocation at the batch fence retain no business or journal effect; unchanged retries commit once and conflicting content is refused | MET locally |
| R6 read boundary and stable traversal | [tests/api/authority.test.mjs:646](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/authority.test.mjs#L646) — GOV-004 audit journey reads populated events as owner and manager, checks minimized values, bounds and filters, pins pagination across restart and append, refuses roles, scope, blind counts and revoked sessions | MET locally |
| R7 inert restore | [tests/api/backup.test.mjs:24](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/backup.test.mjs#L24) — LARDER-020 an installation backup restores into a reset installation; [tests/api/backup.test.mjs:207](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/backup.test.mjs#L207) — MOVE-008 source history searches original IDs and files, exports every record and restores without credentials or remote actions; complete event bytes and cursors, original files and exact two-batch history preserved | MET locally |
| Acceptance sentence 2; R8 local supplier date | [tests/api/flows.test.mjs:149](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/flows.test.mjs#L149) — LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded; exact supplier-confirmed versus buyer-revised dates, outstanding quantities, refusal and same-date no-op | MET native portion only |
| Acceptance sentence 2; R8 local material usable | LARDER-008, LARDER-009 and TRACE-004 above; exact available quantity and linked transition, required documents and inspections; expired, held, unchecked and revoked evidence does not fabricate usability | MET native portion only |
| Acceptance sentence 2; R8 specialist and ledger remainder | No receiving specialist journey and no provider-confirmed ledger reconciliation receipt. A local acknowledgment creates no such event: [tests/api/flows.test.mjs:540](https://github.com/just-every/run-larder/blob/c676cb763af64d9cd6a6283bae82904d6a64af09/tests/api/flows.test.mjs#L540) | UNMET under supplied holds; sentence 2 remains unclaimed |
| Inherited BASE-AGENT-010 | SURFACE-009 already cites it in CONTRACT.md. This implements the bounded native journal portion; MCP event discovery, subscriptions and shared qualification remain unproved | PARTIAL; no shared-conformance claim |
| D-2, D-3 and D-4 | Exact base quantities, immutable movements and event revisions; paired status movements yield one transition and historical records are retained through restart and restore | MET for touched native behavior |
| D-5; GOV-014 and GOV-015 | Existing role, location, site, cost and custom-role boundaries remain; populated audit and service-key refusals above, plus current resource and scope journeys in the final 11-test run | MET for touched native behavior |
| D-6, D-7 and D-8 | Applied physical transitions only; no model or provider outcome invented; pending signatures, stale commands, revocation, retries and batch failure prove the safe and refused paths | MET for touched native behavior |

## DONE-RIDERS, all eleven rows

| Row | Result | Evidence or remaining limit |
| --- | --- | --- |
| 1 | PARTIAL for whole clause | Sentence 1 is covered by the receipt, output, quality and dispatch journeys above; sentence 2 retains the named specialist and provider remainder. |
| 2 | MET native slice | Populated public-door assertions check actual committed quantities and records; unsafe commands, failed batch and revoked authority change nothing. |
| 3 | IN_PROGRESS | Exact-SHA push Verify 42620476277: None; all named tests are inside its existing API glob. No earlier SHA is offered as candidate CI proof. |
| 4 | MET local provenance | Final merged-tree run and proof-files.json match the committed candidate; no relevant byte changed after the last proof. |
| 5 | MET citation; duty remains partial | CONTRACT.md cites BASE-AGENT-010. Shared MCP qualification remains held and is not counted. |
| 6 | MET source mechanics | Generator write and check pass; no generated views or judgment cells committed. Counts unchanged. The lander owns any Evidence and Gap judgment update. |
| 7 | MET | No acceptance sentence, obligation, ID or coverage map changed; no ruling was invented. |
| 8 | MET native slice | Authorized inspection and release succeed; denied role, stale input, pending approval, scope loss and in-flight revocation paths refuse without effects. |
| 9 | MET honest boundary | No provider-confirmed reconciliation, external delivery, compliance or specialist qualification is asserted. |
| 10 | MET existing policy | Native unscoped owner and manager audit authority is preserved. No new policy default or authority expansion was adopted. |
| 11 | PENDING LANDER | Main at integration is e9e99660679665048f0b0f8162ac1884056fcac2, not this branch head. Candidate scan and landing are Mac responsibilities; no clause was counted DONE. |

## Pre-ready self-check and publication provenance

1. All named native user-visible outcomes have meaningful public-door assertions. The 11 final merged-tree journeys pass. Whole-clause DONE is not claimed; exact-SHA workflow status is recorded above.
2. No assertion was removed, weakened, skipped or moved behind a condition. Main's newer resource histories and allocations are preserved.
3. Revoked native sessions cannot read the journal or complete an in-flight receipt. Erasure-sensitive values are not copied to the journal. Restore retains inert facts and cannot revive sessions, grants, commands, physical postings or provider actions; the restore journeys compare actual state and outbound counters.
4. No touched UI screen, icon control, typography or Settings flow applies to this native backend slice.
5. Lock and contract mechanics pass. Publication text review found zero added email-shaped strings and zero credential-shaped strings. All candidate commits were inspected, including side-parent ancestry; authors and committers are fleet and there are no co-author trailers. The full publication scan is **not run in cloud** and no complete or zero-finding scan is claimed.

Scan receipt: commit=c676cb763af64d9cd6a6283bae82904d6a64af09; complete=unestablished; historyScanned=unestablished; findings=unestablished. The guarded Mac lander must produce its required COMPLETE full-history scan with zero findings before landing.

Main equality: false at handoff. Integrated main e9e99660679665048f0b0f8162ac1884056fcac2 has green Verify 42619494829 and Run site 42619494706. Candidate push Verify 42620476277 is in_progress, conclusion None, on c676cb763af64d9cd6a6283bae82904d6a64af09. Run site on the candidate is pending landing. No run from another SHA substitutes for candidate proof.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock and check exit=0; views=node src/base/contract-docs.mjs write and check exit=0, generated files restored; ledger=local Wrangler D1 read and applied-file equality exit=0.

PROBE SURFACE-009 receipt: authenticated receipt.create with two eight-unit held lines -> one receipt.recorded event at the exact receipt revision; refused over-receipt and injected batch failure -> no source, stock, file or event effect; recovered command -> once only.

PROBE SURFACE-009 output: authenticated wo.output with four good and one scrap -> one exact work output event and a linked four-unit usable fact, with retained component allocations.

PROBE SURFACE-009 quality: failed measured inspection -> one four-unit hold despite paired movements; pending and unauthorized releases -> none; passing retest plus actual authorized release -> one release and linked usable fact.

PROBE SURFACE-009 shipment: pick and pack -> no dispatch fact; actual three-unit dispatch against six ordered -> one shipment.dispatched event with three remaining and the exact committed source revisions.

PROBE SURFACE-009 journal authority: populated owner and manager read succeeds; restricted, blind-count and revoked reads are denied. Revocation after receipt validation -> AUTH 401 with unchanged business and event history.

PROBE SURFACE-009 restore: public installation export, reset and import plus native archive restore -> original events, IDs, cursors and original-file digests retained without replay or provider business effects.

All supplied holds remain: company-policy and autonomous consequential execution, shared MCP conformance, outbound work queued under CONN-014, subscriptions, specialist handoffs, remaining vocabulary and provider-confirmed reconciliation. The other campaign holds for ambiguous scope, policy approvals, completion review, account and device proof, source export prerequisites, CONN-001-first purchasing and OPEN-001 Base cleanup are unchanged. No next clause was started. No product blocker remains in the delivered native slice.
