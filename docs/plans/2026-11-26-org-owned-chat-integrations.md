# Organization-owned chat integrations implementation plan

Give organization admins a guided way to configure, verify, rotate, and replace chat apps in `/settings/notification-channels`. Employees manage their own connections under **Settings → Notifications**. Existing delivery continues until an admin confirms a verified replacement. [Architecture decision](../../apps/webapp/src/lib/notifications/docs/adr/0003-chat-app-replacement-preserves-delivery-origin.md)

## 1. Add installation storage and legacy reads

1. Add organization and provider settings, external identity ownership claims, installations, and credential revision references. Enforce organization ownership and the active installation limit in PostgreSQL. Add installation-scoped conversation and reachability records so a candidate or retiring bot can keep its own provider conversation identifiers.
2. Add verified legacy ownership backfill and an organization-scoped installation resolver. Preserve legacy provider rows, receiver scopes, and effective settings. Make the backfill resumable. Surface duplicate or unknown bot identities for remediation while preserving existing routes. Show every legacy Teams tenant and retain each tenant's effective settings until switch.
3. Make the versioned credential path distinguish missing secrets from an outage in Vault and Scaleway. Cover partial writes, retryable cleanup, recursive organization deletion, and immutable revision references. Keep organization-owned activation disabled during the additive rollout.

**Acceptance.** Database tests verify simultaneous same-organization staging, competing claims from two organizations, duplicate and unknown legacy identities, and independent conversations for a replacement and its predecessor. A mixed-version deployment preserves existing commands, notifications, and approval cards.

## 2. Build the lifecycle and protect delivery during a switch

1. Put credential and lifecycle mutations behind the organization settings access service. Resolve inbound verification by installation, then check the authenticated provider identity. Retire deployment Slack OAuth and old setup mutations, or route supported mutations through the same authorized service. Preserve authenticated inbound callbacks for eligible legacy installations.
2. Implement rotation and atomic activation against reviewed installation and credential revisions. Recheck the current admin and material impact at confirmation. The first Teams switch moves every reviewed live legacy tenant to retirement in one transaction. Keep each tenant's card route. Serialize provider endpoint changes by stable bot identity and fence cleanup with the recorded generation.
3. Thread installation and revision through provider callers. Persist dispatch intent before durable approval, notification, and Telegram digest sends. Permit only confirmed unsent attempts to reroute under existing deduplication. Put uncertain attempts across a switch into reconciliation, outside automatic retry and destination repair. Close unresolved attempts after seven days with an explicit unknown outcome. Apply the active installation to new best-effort sends and future digest runs.
4. Bind card edits and actions to the originating installation and the current decision authority. Evaluate open legacy cards using the status of the underlying request. Retire after the remaining card and delivery work settles or after 30 days. Support immediate local revocation and a verified switch back. Keep pending approvals accessible in the Z8 inbox.

**Acceptance.** Exercise concurrent activation, an in-flight send, worker death after provider acceptance, a late click on an old card, revoked employee and admin access, and switch back. Verify no duplicate dispatch or unauthorized decision. Inject secret-store outages and delayed Telegram cleanup after reactivation, and verify that the actual current endpoint survives.

## 3. Deliver admin and employee settings

1. Keep the four provider tabs and existing deep links. Use the same **Prepare → Test → Switch** structure for all providers. Show current and retiring connections, credential source, last verification, capability readiness, and recovery actions. Keep pending, disconnected, and load-failed states visually distinct. Keep credential fields write-only.
2. Present an impact review with reachable employees, action required, unknown outcomes, old cards, and work in flight. Include the full affected tenant set for legacy Teams. Let the admin proceed with unready employees after acknowledging the impact. Announce a changed impact, move focus to the updated summary, and require fresh confirmation.
3. Put member link and unlink actions in **Settings → Notifications** and share the organization-scoped availability read with the preferences API. Use short-lived, purpose-bound, single-use proof tied to the installation. Recheck current organization membership on redemption. Reuse only verified external identity and check reachability per installation. Link to the new entry point from provider help. Keep account-wide notification preference semantics.
4. Verify current feature support from delivery and approval admission rules. Explain when a provider sends a Z8 review link and when it can handle decisions in chat. Show provider prerequisites and the feature that each test actually verifies.

**Acceptance.** Exercise keyboard-only setup, screen reader announcements, dialog focus, duplicate field IDs, narrow screens, and English and German copy. Walk through failed verification, a changed impact review, a successful switch with unready employees, and employee relinking.

## 4. Verify and release one provider at a time

Start with Slack because its approval cards link to Z8 for review. Follow with Telegram and Discord, which already accept organization-owned credentials. Release Teams after the multi-tenant legacy rehearsal and single-tenant app tests. Enable switches per provider and organization after these checks pass.

| Provider | Setup deliverable | Provider release check |
| --- | --- | --- |
| Slack | Generated manifest, bot token, signing secret, and app and workspace verification | A signed request and private test confirm the same app and workspace. The replacement opens its own DM, and the previous app can still refresh its old review card. |
| Telegram | Bot verification, authenticated webhook, and independently verified commands | Rotate the same bot without transferring its installation identity. Replace it with a new bot and verify a member-initiated chat, an old-card action, and a delayed cleanup job after reactivation. |
| Discord | Verified app and signed interaction endpoint with a separate command registration check | Confirm signed interaction and private delivery. Exercise a privacy-blocked destination and an old-card action after switch. |
| Microsoft Teams | Single-tenant app package, Microsoft admin rollout guide, and private proactive test | Exercise authenticated traffic and personal delivery under the replacement identity. Switch an organization with two live legacy tenants and prove each old tenant can service its own cards. |

Run `pnpm test`, focused `pnpm --filter webapp test:integration` suites, and the CI production build. Record the provider sandbox results and the mixed-version migration rehearsal before enabling each provider. Check redacted diagnostics for credential failures, blocked ownership claims, and in-flight sends requiring reconciliation. [Repository workflow](../refs/agent-workflow.md)
