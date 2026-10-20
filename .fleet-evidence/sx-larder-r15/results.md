# sx-larder-r15 results

Baseline: 079dc1c720d81f0420cecb9fb8ce09a452bccd3a.
Baseline exact-SHA Verify 39401608768 and Run site 39401608742: completed/success.
Counts before and after: 38 done / 32 partial / 58 missing.
Clause changes: none. OPEN-001 partial -> partial.
Branch: cloud/sx-larder-r15. Main is never pushed by this run. No PR created.

## Work and proof

- Read launcher AGENTS.md, seed AGENTS.md, CONTRACT.md, ACCEPTANCE.md, API.md, MOVE-IN.md and supplied references. docs/CLAIMS.md is absent.
- Reclassified every unfinished Status row in plan.md: 42 account-blocked, 48 hard, zero cheap.
- Built the public run site: 13 pages, 68 files.
- Exercised the exact published command, npx -y @runeditrun/rer dev just-every/run-larder, from an empty directory with the declared Node 22.20.0 and pnpm 10.12.4.
- The command cloned main, installed, built, migrated and claimed the first owner, but failed before RER_READY/RER_OPEN. No browser proof or empty-data completion is claimed.
- A temporary diagnostic in the disposable installed dependency reproduced the setup failure: Error: Owned processes remain after cancellation (last observed child processes: zombie), from onboarding/process-cleanup.mjs stopOwnedGroup, via onboarding/commands.mjs. The diagnostic is not in the seed branch.
- OPEN-001 stays partial: no test, status or homepage claim was weakened.
- Read Base main modules/import-kit/src/door/ADOPTING.md. A 0.2.74 pin refresh to fix launch would require full import-door adoption. No refresh/adoption made; preserve that as a dedicated follow-up.
- Added Envelope payroll sibling links in CAP-002 and Honest boundaries, as the brief requires. Links only; no capability or status claim.
- Initial typecheck needed the generated route tree. After a normal Vite build generated it, typecheck and first-party contract check passed.
- No product screens changed, so changed-screen 1440/390 browser proof does not apply. The failed dev session is reported, not presented as browser proof.
- Exact-tree publication scan and branch CI results are recorded in separate safe evidence files.

## Follow-up

OPEN-001: conditionally refresh rer to 0.2.74 and adopt the complete Base import door; prove the exact published launch from an empty directory, then setup empty state and product use at 1440/390, and prove every available provider fee disclosure. Keep it partial until every acceptance point is named by real public-door proof.
All other unfinished clauses retain the remaining work and files listed individually in plan.md.
