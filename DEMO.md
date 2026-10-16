# Larder demo

`rer demo` opens a fresh, signed-in **Larder Demo**. Stop it with
`rer demo --stop`. Each start uses `.rer/demo/` and deletes it on stop;
the owner's `.wrangler/state` stays separate.

The workshop is adapted from Larder's API journey fixtures: walnut serving
boards, oak pizza paddles and coaster sets, with customers, suppliers, counted
stock, bills of materials, orders, purchasing, production, a partial shipment,
quarantine and an accountant handoff. Each step runs as the teammate whose
Larder role does that work and is recorded as their command, so Activity shows
the team's week. Dates follow the current day. The hook
uses real domain operations and saves fixed IDs atomically and idempotently.
Ordinary installations still start empty.

Base's v2 `withDemo` runs before other Worker imports. Public reads run for
real; third-party writes return mocked success. Larder phase one has no
external probes, carrier booking, supplier sending, payment or ledger posting.
Shipping and handoffs record operations locally; downloads remain usable.
Invitations and sign-in links use Base's development mail provider, which
validates each message and sends nothing; Base auth reports that as success in
a demo. There is no demo bar, timer, outbox or captured-send screen. `data-rer-name` gives the app its
Demo name and Base adds the document title suffix.

`deploy-demo.json` declares the public host at `demo.run-larder.com`. Turnstile
admits each visitor into their own native Worker Loader isolate, with Larder's
D1 database as a private SQLite facet seeded on start. Static files are served
at the edge. A copy ends after 60 minutes or 15 idle minutes, and its storage is
erased. Its `ownerEmail` signs each visitor in as the workshop's owner, Alex
Morgan (`alex@walnut-workshop.example`). Its plain `MAIL_FROM` demo setting
supplies the sender address that auth requires before the suppressed send. The
existing `/auth/owner-claim` accepts Base's signed owner claim when its
public-key settings are configured.

The **Run demo** workflow reads the `run-demo` GitHub environment (the
`CLOUDFLARE_ACCOUNT_ID` variable plus the deploy token and Turnstile secrets)
and runs by explicit dispatch, or on pushes to main when `RUN_DEMO_DEPLOY` is
`true`. `test_only` selects `demo.test.run-larder.com` and Cloudflare's
published Turnstile test keys; starts there need the private
`RER_DEMO_MEASUREMENT_TOKEN`, sent as the `rer_demo_measure` cookie. Production
uses the real widget. Dispatch with both `test_only` and `remove` to remove the
test host and read back its absence. Do not automate the production widget.
