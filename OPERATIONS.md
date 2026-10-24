# Foundation operations

Run all first-party operations from the composed, runnable edition checkout
with `rer`. Without it, start with
`npx -y @runeditrun/rer dev just-every/run-larder` (set up only:
`npx -y @runeditrun/rer setup just-every/run-larder`; without Node:
`curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-larder`). `rer dev` alone launches
a fresh checkout for review. The detailed flags and effects are in
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. `dev` prints an `RER_OPEN` link that signs you in as the owner; no
external email is sent. Stop `dev` with
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

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`; local
sign-in is available only on loopback with the checkout's dev key. Any process
with access to the machine can read that key and sign in as the owner. Private settings are
kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. The foundation has no product-domain tables or background jobs; an
edition's archive contains the supported domain tables and resources that its
adapter declares. Owner/auth, bookkeeping, private settings and
transient runtime state are excluded. Import validates and restores atomically
into an empty destination; confirmed reset preserves export archives. Run setup
after restore to establish a fresh owner. Each first-party seed verifies local
export/import/export equivalence across its supported resources. Remote transfer
is available only when the adapter declares complete resource coverage.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Deployment

`rer deploy --dry-run` validates the real owner-account
deployment declaration and builds locally without provider requests. Real
deployment requires privately supplied `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, the declared owner/session/setup secrets, and a real
verified mail sender in `deploy.json`. Follow the owner-account deploy-kit
instructions under `node_modules/@runeditrun/rer/modules/deploy-kit`; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

## Hosted installation

The seed-owned policy in ./packaging.json produces the hosted descriptor and
Managed workflow from the real Worker build. Run `pnpm run build`,
`pnpm delivery:spec` and `pnpm check:deployment-spec` before packaging with
`node scripts/delivery/base/cli.mjs package --config packaging.json --output rer-package`.
The artifact command is `node scripts/delivery/base/cli.mjs artifact --config packaging.json`.
Generated package and artifact folders are disposable and ignored.

The app surface assigns AUTH_ORIGIN. Managed hosting supplies RER mail, its
relay URL and a private installation credential. Assisted hosting offers RER,
Resend, SendGrid and Cloudflare with their required setup fields. Sender and
provider acceptance must be qualified separately before claiming delivery.
Local development continues to suppress outbound mail.

For recovery, pause writes and preserve the exact source, private settings and
applied migration bytes. Export the supported Larder records and attachments,
restore into empty resources, establish a fresh native owner, then re-export
and compare every record and attachment before routing traffic.

The generated private INSTALLATION_KEY seals dependency signing keys. Keep its
private custody with installation recovery settings. Migration
./migrations/core/0019_dependency_keys_sealed.sql upgrades existing dependency
records without changing earlier SQL. Rotate custody through the supported
deploy command and retain the old key until re-sealing is confirmed.
