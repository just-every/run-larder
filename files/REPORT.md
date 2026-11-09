# sx-larder-c-f604 actual results

The bounded native commercial classification slice is implemented and locally proven. SURFACE-003 remains PARTIAL: no provider charge, external send, recipient-count qualification or wider company-policy agent execution is claimed. No contract status, Gap, Evidence or acceptance text was edited. The plan row to update is SURFACE-003's native commercial slice; all other plan holds remain unchanged. No plan was rebuilt.

Repository: just-every/run-larder. Branch: cloud/sx-larder-c-f604. Full candidate: `f0bcac8c7aaede63a22bef7767be70191ec5f676`. Tree: `e3e073b8fe940979016dbaf73e288e00e5498d00`. No PR was created; Verify has a branch-push entry point. The branch push succeeded and the remote ref was read back at that exact head. Main remains `171f7266ef82b5973a5d5036a37e60e5f6c6ea43`. Counts before and after: **86 done, 39 partial, 39 missing, 164 total**. Clause status before and after: PARTIAL. There are zero new or removed test registrations, and no existing assertion was removed or weakened.

## Plan and implementation

The complete execution plan is in PLAN.md. The implementation adds a small server classification helper and applies it only to existing direct purchase preparation and approval, and amendment preview and approval. Records, audit and replay retain the same computed facts in the existing guarded D1 batch. The atomic session, role and business-version fences in storage remain intact; concurrency tests exercise their recomputation and rollback.

Preparation and a pending purchase signature carry standard. Applied purchase approval carries money and commitment with normalized stored lines, exact amount, currency and supplier snapshot. Applied amendment carries commitment with customer, reviewed preview and order versions, commercial revisions, local attestation and exact promises before and after approval. Amendment values count only the still-open dated promises: a partially shipped order moves from USD 534 to USD 990 in open promises, while its issued shipment retains its original price. A separate CAD journey retains CAD 48 and CAD 396 rather than substituting USD.

Classification retains the real actor's ID, role, source, command and input version. A deputy remains the actual signer. Caller-supplied classification and attribution fields are refused. Existing spend signatures keep their original format and policy semantics; the pre-existing exact subject version and input digest bind the terms. Old unclassified amendment previews require new preparation. No approval or local customer attestation asserts provider charge, payment, provider acceptance, outbound delivery or changed audience.

Existing scope filters and recursive cost redaction cover the new snapshots without introducing a new authorization path. Audit retention preserves exact nested terms and dated promises while retaining credential and document scrubbing. No schema migration, Base pin, workflow, homepage, branding or UI source changed. Browser proof and icon-control checks are not applicable to this backend-only slice.

## Acceptance and inherited-duty map

| Item | Result on this candidate | Public-door proof |
| --- | --- | --- |
| Acceptance 1: draft purchase compared with approved purchase charge and changed promise | Native preparation, authorized purchase terms and changed promises PASS; a provider charge is not qualified. No whole acceptance point is asserted beyond that native boundary. | `tests/api/flows.test.mjs:147` — LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded; `tests/api/authority.test.mjs:611` — GOV-002 high-value PO and stock write-off need two signatures, a deputy signs a principal's seat, changed inputs invalidate, agents are denied and an owner override names its accountable human; `tests/api/order-amendments.test.mjs:19` — DEMAND-002 approved amendments split promises, preserve issued terms and production costs, cancel only unconsumed commitments, and reject stale or unsafe changes |
| Acceptance 2: internal document compared with known customer, new supplier and public exposure | HELD by the brief. No send or audience door was added and no recipient count is invented. | Probe and native journeys assert all outside-effect flags are false; this is not external qualification. |
| BASE-AGENT-006: computed action class and exact consequence facts | PASS for the bounded native doors only. Broader agent declarations and execution remain held. | The same purchase and amendment journeys, plus PROBE.json |
| BASE-AGENT-007: policy at the decision chokepoint | Existing native spend and margin authority preserved and tested; company-policy execution remains held. | `tests/api/authority.test.mjs:611` — GOV-002 high-value PO and stock write-off need two signatures, a deputy signs a principal's seat, changed inputs invalidate, agents are denied and an owner override names its accountable human; the recorded GOV-002 margin-floor journey |
| D-3 and D-8: exact numbers, fresh inputs and once-only decisions | PASS for changed doors. Fractional values, stale and forged refusal, real competing HTTP writes and replay are exercised. | `tests/api/authority.test.mjs:611` — GOV-002 high-value PO and stock write-off need two signatures, a deputy signs a principal's seat, changed inputs invalidate, agents are denied and an owner override names its accountable human; `tests/api/order-amendments.test.mjs:19` — DEMAND-002 approved amendments split promises, preserve issued terms and production costs, cancel only unconsumed commitments, and reject stale or unsafe changes; PROBE.json |
| D-5, GOV-014 and GOV-015: current scope and cost restrictions | PASS. Restricted nested values stay redacted, hidden amendment links disappear, and old replay cannot regain visibility or revoked authority. | `tests/api/authority.test.mjs:1131` — GOV-015 GOV-016 costs-and-wages scope and custom roles: a restricted member never recovers a cost or wage, a custom role only narrows its base, and changes bind live; `tests/api/order-amendments.test.mjs:19` — DEMAND-002 approved amendments split promises, preserve issued terms and production costs, cancel only unconsumed commitments, and reject stale or unsafe changes; the recorded GOV-014 journey |
| D-7: truthful provider boundary | PASS as a boundary, not provider proof. No money movement or outbound result is fabricated. | `tests/api/flows.test.mjs:147` — LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded; `tests/api/order-amendments.test.mjs:19` — DEMAND-002 approved amendments split promises, preserve issued terms and production costs, cancel only unconsumed commitments, and reject stale or unsafe changes; PROBE.json |
| Inert recovery and attribution | PASS. The actual export, reset and import subprocesses retain classification and original decision makers; pending records remain pending and old sessions are refused. | `tests/api/backup.test.mjs:22` — LARDER-020 an installation backup restores into a reset installation |

## Runtime probes

The eight complete observed public-door inputs and outputs are retained in PROBE.json and probe.log, with an executable probe source in native-commercial-probe.mjs. They ran on `f0bcac8c7aaede63a22bef7767be70191ec5f676`.

PROBE SURFACE-003 native preparation: authenticated po.draft, quantity 3.125 at 9.876543 -> standard; exact stored USD 30.864197 and supplier retained.
PROBE SURFACE-003 pending signature: authenticated manager po.approve -> standard, effect pending, purchase remains draft; later owner approval -> money and commitment, effect applied.
PROBE SURFACE-003 forged and unauthorized refusal: supplied classes, actionClasses, classification and signer ID -> INPUT; preparer approval -> FORBIDDEN; archive unchanged.
PROBE SURFACE-003 customer promise: authenticated CAD amendment -> commitment, CAD 74.875 to 97.265625, revision 1 to 2 and exact dated schedules; actual salesperson retained.
PROBE SURFACE-003 provider boundary: local draft and applied decisions -> providerCharge, paymentPosted, providerAcceptance, externalDelivery and audienceChanged all false; no extra outbound request.
PROBE SURFACE-003 stale decision: intervening real location command -> STALE; archive unchanged.
PROBE SURFACE-003 replay and visibility: same command -> original outcome without another effect; current cost restriction -> restricted nested values.
PROBE SURFACE-003 restore: restart and authenticated archive restore -> original classifications and people retained, pending preview stays preview, zero outbound requests.
PROBE SURFACE-003 atomic recomputation: the exact-SHA GOV-002 journey interleaves real HTTP writes -> two attempts, facts bound to the committed source version; an intervening PO edit -> STALE with no approval, signature, movement or audit effect.
PROBE SURFACE-003 revoked and erased actor: the exact-SHA amendment journey narrows, deactivates and anonymizes its salesperson -> historical replay AUTH and unchanged business state.

## Validation receipts

The final candidate's nine affected HTTP journeys passed, with zero failures or skips. Typecheck, production build, first-party check, eight public probe observations, contract write and check, and source-lock regeneration and check all passed. The earlier broad run passed all 73 tests in the four touched files on its recorded intermediate tree. It is not substituted for exact-SHA proof of the final corrections. All long-lived application commands used the cloud subreaper. No browser was started.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock and check exit=0; views=node src/base/contract-docs.mjs write and check exit=0, generated files restored from origin/main; ledger=none exit=0.

CI: Verify 42597236581, event push, queued, conclusion pending, https://github.com/just-every/run-larder/actions/runs/42597236581

Prior main evidence, separate from this candidate: push Verify 41252605263 and Run site 41252604855 succeeded on `171f7266ef82b5973a5d5036a37e60e5f6c6ea43`. The complete REST response is in main-ci.json. Candidate CI status is in candidate-ci.json. There was no workflow edit, dispatch or rerun when this report was first assembled.

Publication scan: commit=f0bcac8c7aaede63a22bef7767be70191ec5f676; complete=NOT RUN IN CLOUD; historyScanned=NOT RUN IN CLOUD; findings=NOT ESTABLISHED. Full history is present and the local changed-line identity and email checks passed, but they are not a Base publication scan. The maintained Mac lander owns the exact-tree full-history scan, exact-SHA workflow requirements, generated status views and landing. Main equality is false until landing; candidate Run site is not claimed.

## DONE-RIDERS and pre-ready checks

| Rider | Result | Evidence or retained limit |
| --- | --- | --- |
| 1 | PARTIAL for the whole clause | Native outcomes are covered above; provider charge and external-exposure qualification remain omitted. |
| 2 | PASS for native slice | Seeded money and amendment paths complete; forged, stale and unauthorized calls refuse without effects in the named HTTP journeys. |
| 3 | PENDING on the recorded exact-SHA Verify | All four files are in the existing push API test glob. Verify 42597236581, event push, queued, conclusion pending, https://github.com/just-every/run-larder/actions/runs/42597236581 |
| 4 | PASS for local native proof | Final nine journeys and public probe ran on `f0bcac8c7aaede63a22bef7767be70191ec5f676`. The older 73-test tree is separately identified. |
| 5 | PASS | SURFACE-003 already cites BASE-AGENT-006 and BASE-AGENT-007; no inheritance claim was added by prose. |
| 6 | PASS for builder mechanics | Contract write and check passed; status and generated views were preserved from main; source lock is fresh. |
| 7 | PASS | No acceptance point, coverage rewrite or status cell changed. |
| 8 | PASS for native authority | Spend, delegation, owner override, margin floor, scope, revocation, erasure and replay journeys run both permitted and refused paths. |
| 9 | PASS as an honest boundary | All provider and outside-effect flags are false; omitted provider and audience qualification is named. |
| 10 | PASS, no new policy default | Existing native role, threshold, independence and override rules are retained, including signature compatibility. |
| 11 | PENDING LANDER | Branch only; exact-main equality, full-history COMPLETE scan and final Run site belong to guarded landing. No DONE count is claimed. |

Pre-ready: native changed behaviors have public-door assertions; no pre-existing assertion was removed, narrowed or hidden behind a branch or width condition; revoked and erased identities cannot revive authority through replay; no UI source or controls changed; local source lock and generation passed; candidate CI and publication status are reported without borrowing another SHA's success. Added literal email-shaped fixture lines: zero. Commit identities and trailers passed for every candidate commit, including side parents. No Co-Authored-By trailer exists.

GAP SURFACE-003: Provider charges, refunds and ledger postings, actual sends and known, new and public recipient counts, remaining commercial doors, company-policy execution, autonomous consequential execution and shared MCP qualification remain omitted. AGENT-001's customer-commitment and purchasing-execution hold and all other supplied holds remain unchanged. There is no blocker to the bounded native change; the full clause is not DONE.

CLAIM SURFACE-003 PARTIAL points=none tests=tests/api/flows.test.mjs#LARDER-007 purchase approval, supplier confirmation and revised delivery are recorded; tests/api/order-amendments.test.mjs#DEMAND-002 approved amendments split promises, preserve issued terms and production costs, cancel only unconsumed commitments, and reject stale or unsafe changes; tests/api/authority.test.mjs#GOV-002 high-value PO and stock write-off need two signatures, a deputy signs a principal's seat, changed inputs invalidate, agents are denied and an owner override names its accountable human; tests/api/backup.test.mjs#LARDER-020 an installation backup restores into a reset installation
