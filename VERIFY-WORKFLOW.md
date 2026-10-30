# Larder Verify lifecycle

Larder merges Base's `export/verify.yml` lifecycle into its owned Verify
workflow. It keeps the edition's Node 22.20.0, pnpm 10.12.4, frozen dependency
lock and four product partitions. Every job runs on Ubuntu 24.04. Shards retain
their 15-minute limit; planning and proof jobs have one minute, and light
coverage has twelve minutes.

| Entry | Coverage |
| --- | --- |
| Branch push or pull request | Four push partitions, qualified reuse, or reviewed light coverage |
| Monday and Thursday at 03:35 UTC | Four nightly partitions, or qualified nightly reuse |
| Any tag push | All eight push and nightly partitions, always |
| Manual or reusable Verify | The selected `push`, `nightly`, or `all` tier |

The schedule is Base's deterministic seed-name transformation for `larder`:
one static Monday and Thursday minute between 02:00 and 07:59 UTC. Main's
concurrency key contains its run ID, so main runs cannot replace one another.
Other refs cancel superseded runs; event names separate PR planning from its
branch push producer and from scheduled or manual runs.

## Retained product wall

`verification.json` declares the four push partitions and four `nightly-`
equivalents with globally unique names. The nightly names select the same real
commands. Nothing from Larder's existing push wall moves out of push coverage.
The `all` tier runs eight shard jobs.

- `foundation` checks generated contract documents, source-lock freshness and
  first-party composition, then runs `pnpm run verify` with
  `LARDER_VERIFY_PART=foundation`. The adapter retains the production build,
  typecheck and emitted-Worker runtime tests, followed by Base's hosted-output
  and hydration checks.
- `api` runs `pnpm run test:larder`, the complete authenticated HTTP/API suite.
- `browser-1` and `browser-2` run `node tests/browser/run.mjs --shard=1/2` and
  `--shard=2/2`. Together they run every browser test, each with one worker and
  its own real installation, setup, data and `rer dev` process.

Only GitHub CI may select `LARDER_VERIFY_PART=foundation`. Unknown partitions
or local use are refused by the adapter. Ordinary local `rer verify` retains
the complete sequential application target. Static site assertions and the
compiler/cache regression suite remain outside Larder's existing application
target; its retained API and browser journeys cover the product contract.

The workflow executes these product commands directly, preserving the existing
adapter. The manifest's `commands` describe their application work for planning
and reader analysis; the API entry expands the `test:larder` package alias.
The generic `node scripts/verify-ci.mjs NAME` dispatcher is not Larder's shard
entry point: it expects the template's `SEED_VERIFY_SHARD` application adapter.
Use the workflow's tier input to run selected CI coverage. Inspect its planned
names with `node scripts/verify-ci.mjs --matrix push`, `--matrix nightly` or
`--matrix all`.

The foundation builds its production output once. The browser runner clones
tracked source, installs into that owned checkout and exercises real native
setup and dev. Those installations build as part of their own lifecycle;
sharing a foundation artifact would not replace that work. The workflow keeps
those assertions and installation boundaries intact.

## Full, light and reused proof

Base's delivered `verify-ci.mjs`, `verify-app.mjs`, `verify-plan.mjs`,
`verify-evidence.mjs` and `verify-light.mjs` implement planning. A full branch
push emits `full-push-proof` only after all four push partitions pass. Light,
reused, PR, manual, scheduled and tag runs do not produce branch push proof.
The stable final `verify` aggregate requires successful planning and the
selected coverage; failures and cancellations cannot pass it.

Reuse requires the newest eligible same-workflow, same-repository producer's
successful latest attempt, required shard jobs and aggregate. An identical SHA
on another branch may reuse full push proof. A same-repository PR may reuse its
head's full push proof only when the tested merge tree equals the head tree;
its bounded wait otherwise selects full coverage. A single direct parent may
supply proof for an identical Git tree. Missing, ambiguous, incomplete or
inaccessible evidence runs full coverage.

Light coverage requires a direct parent with full push proof and a complete
local Git diff limited to Base's reviewed root contract/status documents,
`sources.lock.json`, or supported evidence files below `evidence/` and
`.artifacts/`. Both sides of renames count. Unknown command readers, unknown
formats, code changes and uncertain comparisons select full coverage.
Larder's API tests and browser runner have reviewed reader declarations in
`verification.json`; seed-specific command forms must also be explicitly
supported by the light helper. A light job checks the edition source lock,
runs `rer check` and selected readers, checks generated contract documents when
a contract document changed, and builds the run site.

Only successful complete nightly coverage on main, from a scheduled or manual
run, saves `nightly-green-<full-sha>`. The immutable cache marker is a lookup
hint: skipping also requires the newest trusted run's `nightly-proof`, every
nightly partition and successful aggregate. A newer failed attempt defeats an
old marker. Tags always run all coverage and bypass reuse.

## Runner setup and adoption

The workflow prepares browser and apt directories under `$RUNNER_TEMP` before
cache restore or sudo, and puts the pnpm store there too. Cache keys include
the frozen package inputs and browser requirement. Old HOME-based cache keys
are not restored.

Browser jobs install Chromium with `playwright install chromium`, then retain
Larder's `scripts/ci/chromium-probe.mjs` launch assertion. Only a launch failure
invokes Base's bounded `scripts/install-chromium-deps.py` helper with the
runner-owned apt archive cache, followed by another probe. Permission errors
fail directly. Browser journeys keep bounded disk reclaim, checking both the
workspace and temporary filesystem before each deletion and stopping once
both have 20 GiB free.

Edition-owned `edition.json`, `sources.lock.json`, `.edition/sources/` and
pinned authoring tools remain in place. The foundation checks the source lock
before installing dependencies whenever either manifest is present; a missing
counterpart fails. CI never rewrites the lock. After intentional source or
workflow edits, stage the intended files, inspect authoring `changes`, regenerate
the lock locally and commit it with the retained snapshots.

Adopt every imported helper through the pinned Base refresh/record protocol,
including the Chromium system-dependencies helper. Preserve seed-owned
adaptations when acknowledging the merged workflow. Validate with `actionlint
.github/workflows/verify.yml` and `node scripts/verify-ci.mjs --check-workflows`.
Every reusable caller must grant `contents: read` and `actions: read` on the
calling job; a called workflow cannot increase its caller's permissions.
