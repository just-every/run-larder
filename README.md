# Larder

Larder runs a small maker's operations: what can be promised, what must be bought or made, what actually moved, and what needs a person today. It takes one confirmed order through available to promise, atomic reservation, a purchase or a version-pinned work order, partial receipt with lots and quarantine, material issue and scrap, partial shipment, and a reconciled handoff to the accountant's own ledger. Agents prepare orders, purchases, merges, reschedules and reconciliations; people approve them. The first move-in kit reads Odoo exports.

The first buyer is an Australian, single-entity, non-regulated maker of 5–50 people with external books. Larder never posts journals, files tax or claims regulated traceability. Scope, defaults and exclusions are in [CONTRACT.md](CONTRACT.md); what is proven is in [ACCEPTANCE.md](ACCEPTANCE.md); the API agents use is in [API.md](API.md); the Odoo kit is in [MOVE-IN.md](MOVE-IN.md). Source code: [just-every/run-larder](https://github.com/just-every/run-larder).

## Where things are

- `src/larder/` — the operational domain: catalogue, stock movements and reservations, BOMs, sales, purchasing, production, planning, reversals, handoff, exceptions, agent proposals, the archive, and `odoo/` (the move-in kit). `api.ts` is the only HTTP door (`/api/larder/*`).
- `src/ui/` — the app at `/app`, in the risograph style picked with 12ui.
- `docs/` — the owner guides published at `/docs` on the run site.
- `migrations/core/0013_larder.sql` — the ledger schema with its append-only and oversell triggers; `0014_import_kit.sql` is Base's import-kit journal.
- `src/modules/import-kit/` — Base's import kit, copied from Base `79f61fa`.
- `tests/api/` — one Worker/D1 flow test per first-release clause; `tests/browser/` — the owner's journeys at 1440 and 390 pixels after a real setup.
- `fixtures/odoo/` — Odoo export-shaped CSV files written from Odoo's documentation, including rows Larder must refuse.

Tests: `pnpm run test:larder` (API flows) and `node tests/browser/run.mjs` (browser journeys). `rer verify` runs both with the build, typecheck and runtime checks.

## Run it locally

Install the `rer` command once with `npx -y @runeditrun/rer cli install`, or the
installer script on the RER site (`curl -fsSL https://runeditrun.com/install.sh | sh`).
This edition is runnable after composition. From the composed edition's
checkout root, `rer dev` alone launches it for review: it installs pinned
dependencies, sets up a local owner on a free port, starts the real app and
prints `RER_READY` and a sign-in link. To install for a real owner, run the
verbs yourself:

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Commands that run project work select the exact Node version declared by the
project. They use an exact matching installed runtime or a checksum-verified
copy cached at `~/.rer/node/node-vVERSION-PLATFORM-ARCH/`; when needed on
supported platforms, the runner retrieves the official Node release and checks
its SHA-256 against `SHASUMS256.txt`. It does not change global Node installations.
Set `RER_NODE_AUTO=0` to disable automatic selection. If selection is disabled
or acquisition fails, the command reports a repair invocation in this form:
`npm exec --yes --package=node@VERSION -- node SCRIPT VERB --cwd PROJECT`.
Help, check, describe, doctor and stop do not select or acquire Node.

After `RER_READY`, `dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`.
Open that URL on this computer: the app opens signed in as the owner and
finishes first-run setup at `/setup`. Treat the line as a credential.
`dev --as PERSONA` starts as a persona or signed out; `dev --login` prints
the outbox instead: follow its newest ordinary sign-in link. Until first-run
completion is stored durably, app routes send the signed-in owner to `/setup`;
signed-out visitors sign in and return there. Once complete, `/setup` opens the
app or settings. The local outbox sends no external email.

The saved local port is used; a first setup saves the first free port from 8787. Explicit ports are decimal
integers from 1 through 65535 and must be free; a busy requested port fails
instead of silently moving. Only `127.0.0.1`, `localhost` and `::1` are allowed.
Dev applies the selected host and port to both the listener and runtime bindings;
readiness is bounded and failure stops the owned processes.

Missing non-interactive setup answers exit 3 and name the manifest fields.
Read `rer-setup.json` and pass a private, mode-0600 JSON object keyed by those
names using `rer setup --answers PATH --non-interactive`,
for example `{"OWNER_EMAIL":"owner@example.com"}`. Secret values stay in
private inputs and never go in command arguments. A setup rerun with the saved
owner and origin preserves existing owner/data and exact private settings.
Conflicting saved identity or origin reports an actionable recovery path.
Review reset's exact removal inventory before confirmation; export domain data
first if it should be restored, and import only into an empty destination.

Queue waits report immediately with a reason and numeric one-based position,
then refresh about every 15 seconds while waiting. Package mode has no queue status command; a waiting command reports its live position.

Use the setup prompt instead of `--owner-email` when entering the real owner
mailbox. Open the `RER_OPEN` URL printed by `dev` on this computer; the app opens
signed in as the owner. With `dev --login`, open the outbox it prints, choose
the newest ordinary sign-in message and follow its link. No external email is
sent. `dev` serves
live editing with HMR and stays in the foreground on its first invocation; a
compatible repeated invocation reuses the server and exits. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

`verify` ends by loading each public page of the production build in Chromium to
prove its sections hydrate as separate units (`src/base/hydration/README.md`); run
`pnpm exec playwright install chromium` once on a new machine.

Reset is destructive local cleanup. Import requires an empty destination and
explicit confirmation. Use `rer describe` to inspect the
checkout's actual commands and flags. The maintained pins are Node 22.20.0 and
pnpm 10.12.4. Read `RUN-LOCALLY.md` for data custody, deploy requirements and
remote-transfer support.

## Built on Base

Larder was composed from Base's foundation at `79f61faef682f9d6cdb64e843cfbd3cf02887982` and runs Base's commands from the pinned `@runeditrun/rer` package. It includes Hono,
TanStack Start, Vite, React, Cloudflare, D1 and real owner/operator
authentication, with no precreated owner or sample business data.
The edition owns its complete product experience and may change its source,
schema, UI, framework, infrastructure and integration method.

Private HTTP routes and Start functions must authorize native sessions inside
every server function, including direct transport calls. Route guards alone are
insufficient. Keep server-only modules and secrets out of client bundles.
Unknown documents and missing assets return real 404s. Keep Queue/Cron handlers
and named Worker exports in `src/server.ts`; the dispatcher only selects HTTP
ownership.

The edition has two homepages. An installed instance's `/` is the Lobby, served
by `src/server.ts` from `src/base/lobby.ts` with `GET /setup/state`: Sign in, or
Finish setup until the owner confirms first-run setup. `src/identity.ts` holds
its edition identity (the name from `src/branding.json`, its purpose, tagline,
sign-in route and run site origin). The run site (`src/site/pages.tsx`; the
landing in `src/site/landing/`, the guides rendered from `docs/*.md` and
`docs/site.json`, every Run page string in `src/site/run.json`, the domain in
`deploy-site.json`) is the landing whose action is Run <name>, `/run`, `/docs`
and a not-found page: `rer build --site` writes it to `dist/site`, `rer dev`
serves it as `RER_SITE`, and `rer deploy --site` publishes it (`--dry-run`
prints the plan; `.github/workflows/run-site.yml` deploys it from main to
https://run-larder.com once `RUN_SITE_DEPLOY` is set). The look (tokens, fonts, mark, riso goods) is in
`public/rer-theme.css`, `public/fonts/` and `public/brand/`.

The edition owns `rer-setup.json`, application branding and its installer
adapter. Keep one setup manifest and declare actual answers, defaults, managed
secrets, migrations, build targets, health checks and owner behavior there and
in the adapter. Setup must preserve existing local owner/data and exact private
settings on reruns. Never create a second owner or rotate secrets implicitly.

Local durable data lives in `.wrangler/state`; private settings default to
`.dev.vars` with mode 0600. Local export/import covers declared supported
resources and excludes owner/auth, outbox, private settings and transient
runtime state. Every first-party seed verifies local export/import/export
equivalence across its supported resources. Preserve applied migration history
and require forward migrations for schema changes. Remote transfer is supported
only when the adapter covers all required resources.

`deploy --dry-run` builds and validates locally without provider requests. Real
deployment uses the owner-account procedure and requires its private account
credentials, declared migrations and a real verified mail configuration. Local
verification does not establish hosted acceptance, remote health or mail
delivery. See `OPERATIONS.md`, `ONBOARDING.md`, `SEED-COMMAND-CONTRACT.md` and
`RUN-LOCALLY.md` for the implemented requirements.
