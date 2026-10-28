# Agent access

Larder currently exposes its native authenticated HTTP API, described in
[API.md](../API.md). A native account with the `agent` role can prepare the
supported operational proposals. Authorized people approve their exact versions.
Native session admission, location and cost restrictions, independent approval
rules and the atomic command fence remain authoritative.

The shared agent-door and Business settings source is retained at Base commit
`d555e789cffb744a9f83d76ebe42a2e3bdd7a055`, with additive schema migrations and
copy provenance. These dependencies are not mounted by the production Worker.
Their presence does not enable MCP, Business sponsorship, company policy,
resources, subscriptions, approval pages or automatic manufacturing actions.
There is no declared Larder MCP registry or conformance journey yet.

An agent write needs a supported execution authorization handle that Larder's
atomic command commit can validate together with the current native person,
role, location/cost scope and state version. The retained public `ToolContext`
provides the person, agent and named approvers, but does not expose the verified
consent or execution reference for that fence. Activation must preserve native
transaction checks and truthful preparer/approver attribution; it must not borrow
an existing person's session, manufacture a session or accept caller-supplied
authority. Copying the runtime alone does not establish these properties.

The native cited variance workflow separately requires exact owner consent,
a configured Anthropic or OpenRouter destination and its existing bounded,
once-only send. No company-policy spend enforcement or provider capability is
claimed by retaining the shared runtime.
