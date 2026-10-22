# People and roles

Invite your team, give each person a role, and let agents prepare work that a person approves.

## Invite someone

Only the owner manages people. On **More → People and roles**, fill in **Invite someone** with their name and email and press **Send invitation**. They receive a sign-in link and join as a viewer until you give them a role under **Set a role**.

## The thirteen roles

| Role | What they can do |
| --- | --- |
| Owner | Everything, including people and roles |
| Manager | Everything day to day, approvals and move-in |
| Sales | Quotes, orders and reservations |
| Planner | Forecasts and the master production schedule, inventory policies, shortage and work drafts, order ranks, reschedules and split/merge; a different person approves what they prepared, and they never release work or buy |
| Buyer | Purchase orders and supplier terms |
| Engineer | BOM and routing revisions with instructions, BOM and catalog CSV edits, and engineering change proposals that a manager approves |
| Production | Bills of materials and work orders |
| Operator | Only the operations assigned to them: acknowledge instructions, start, pause, resume, report progress and complete; no stock postings |
| Warehouse | Receiving, shipping, transfers and counts |
| Quality | Inspection plans and results, quality holds, nonconformance cases and deviations, certificates, expiry decisions and recalls |
| Accounts | Handoff batches and ledger acknowledgements |
| Agent | Prepares drafts and proposals; never approves or posts |
| Viewer | Reads everything, changes nothing |

Every action checks the person's current role at the moment it is written, so a role you change takes effect on their next action.

## Limit what a person sees and does

On **More → People and roles**, **Limit a person** narrows one person (the owner is never limited, and agents only prepare):

- **Locations**: choose the locations they work in. They then see only records whose every location is theirs; a figure that also counts another location reads "restricted (includes other locations)", never a partial total. A command that touches any other location is refused. Trace and recall packs show other locations' records only as "restricted record", and the archive, audit, handoff and import downloads need an unrestricted owner or manager.
- **Costs and wages restricted**: unit costs, prices, values, margins, cash exposure and hourly rates read "restricted" in every screen and download, and the actions that need them (quoting, purchase pricing and approval, rework with a rate, handoffs, imports) are refused. By default managers, accounts and the owner read costs and wages, and a production person reads the rework rate only on the order they entered it.

A **custom role** is a named copy of one role (not owner or agent) that can only be narrowed: by locations, by the costs-and-wages restriction, or by removing approvals such as approving a purchase order. Give it to a person with **Give a person a custom role**; a person holds one role, and choosing a built-in role replaces it. Limits and custom roles are read on every request and again inside the write, so narrowing takes effect on the next action.

## Agents prepare, people approve

An agent signs in like any team member, with the agent role, and works through the same commands. It can prepare:

- an order from a pasted customer enquiry (kept as text, never obeyed as instructions; a missing quantity blocks approval),
- grouped purchase orders for what is short, with the cash exposure,
- a merge of two duplicate items, with what it would affect,
- a reschedule of work orders, with any conflicts,
- a match of a handoff batch to ledger entries.

Each proposal waits on **Today** under **Needs a person**, with **Evidence and exact plan**. A person with the right role, never the one who prepared it and never an agent, presses **Approve** or **Decline** on that exact version; if the records changed since it was prepared, Larder asks for a fresh one. The owner holds every authority and may approve what they prepared themselves. Every decision is recorded under **More → Activity**.
