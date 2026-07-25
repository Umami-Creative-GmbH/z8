# Explicit-Organization Authorization Audit

Scope: privileged settings server actions and organization-related API routes that accept or recover an explicit organization ID.

## Guarded Paths

- `settings/organizations/actions.ts`: already used `requireActiveOrganizationActionActor` for organization and membership mutations.
- `settings/organizations/invite-code-actions.ts`: invite-code create/update/delete and pending-member approve/reject/bulk mutations now require an active approved admin/owner actor.
- `settings/enterprise/api-keys/actions.ts`: the shared permission gate for list/create/update/delete now requires an active approved admin/owner actor.
- `settings/webhooks/actions.ts`: create/update/delete, secret regeneration, and test delivery retain owner-only semantics and now reject inactive or unapproved owners.
- `settings/clockodo-import/actions.ts`: the shared import-admin gate now validates approved membership, tokenized admin/owner capability, and employee activity before credential access, mappings, or imports.
- `settings/import/clockin-actions.ts`: the Clockin credential/preview gate uses the same lifecycle-aware import-admin policy.
- `settings/import/review-actions.ts`: scan, review decisions, exports, and commit enqueueing use the lifecycle-aware import-admin policy before side effects.
- `settings/telegram/actions.ts`: the shared integration-admin gate now protects bot setup, settings changes, disconnect, and privileged reads.
- `api/slack/setup/route.ts`: disconnect is guarded before Vault or database mutation.
- `api/slack/oauth/authorize/route.ts`: OAuth state creation is guarded.
- `api/slack/oauth/callback/route.ts`: the state-bound actor is revalidated before consuming state, exchanging the code, or storing credentials.
- `api/discord/setup/route.ts`: setup and disconnect are guarded before external, Vault, or database mutation.
- `api/telegram/setup/route.ts`: setup and disconnect are guarded before external, Vault, or database mutation.
- `api/teams/setup/route.ts`: setup and disconnect retain active-organization and CASL checks and additionally reject inactive or unapproved actors.

## Audited Without Change

- `api/slack/link/route.ts`, `api/discord/link/route.ts`, and Telegram user-link actions are self-link/unlink operations, not privileged organization configuration mutations. They bind the operation to the authenticated user; Discord additionally verifies membership.
- Slack/Discord/Telegram inbound event, interaction, command, and webhook routes authenticate provider signatures or opaque webhook tokens and do not authorize a browser actor from an explicit organization ID.
- `api/slack/oauth/callback/route.ts` does not trust an organization ID from the callback. It uses a short-lived database state record and now also revalidates that state record's actor.
- `settings/clockodo-import/actions.ts#importClockodoData` is a disabled compatibility endpoint and performs no mutation.
- Public invite-code validation/redemption and pending-invite processing are join lifecycle operations, not privileged organization administration. They authorize through invite-code ownership/validity rather than an existing admin membership.
- Platform-admin organization routes use platform authorization, not organization membership roles, and are outside this organization-actor guard.
