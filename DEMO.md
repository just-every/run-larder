# Larder demo

`rer demo` opens a fresh, signed-in **Larder Demo**. Stop it with
`rer demo --stop`. Each start uses `.rer/demo/` and deletes it on stop;
the owner's `.wrangler/state` stays separate.

The workshop is adapted from Larder's API journey fixtures: walnut serving
boards, oak pizza paddles and coaster sets, with customers, suppliers, counted
stock, bills of materials, orders, purchasing, production, a partial shipment,
quarantine and an accountant handoff. Dates follow the current day. The hook
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

`deploy-demo.json` declares the public host at `demo.run-larder.com`, with
one isolated Container per visitor. Its plain `MAIL_FROM` demo setting supplies
the sender address that auth requires before the suppressed send. The existing `/auth/owner-claim` accepts
Base's signed owner claim when its public-key settings are configured.

The **Run demo** workflow reads the `run-demo` GitHub environment and runs
only by explicit dispatch.
`test_only` selects `demo.test.run-larder.com` and Cloudflare's published
Turnstile test keys; production uses the real widget. Dispatch with both
`test_only` and `remove` to remove the test host and read back its absence.
Do not automate the production widget.
