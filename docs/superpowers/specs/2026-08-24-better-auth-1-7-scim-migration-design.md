# Better Auth 1.7 SCIM Migration Design

## Summary

Z8 will restore SCIM provisioning on Better Auth 1.7 by adopting the plugin-managed connection catalog from `@better-auth/scim`. Each managed connection is permanently bound to one Z8 organization through `provisioningDomainId = organization.id`. Better Auth owns SCIM protocol resources and credential lifecycle; Z8 owns organization membership, employee lifecycle, role-template policy, billing side-effect delivery, and the administrator experience.

This is a fresh Better Auth 1.7 SCIM rollout rather than an in-place data conversion. The confirmed production assumption is that no legacy SCIM rows exist. The database migration must verify that assumption before dropping incompatible storage. Legacy provider IDs, bearer tokens, hashes, and syntax will not be accepted or converted.

## Goals

- Restore `/api/auth/scim/v2` through the existing Better Auth catch-all route.
- Let organization administrators create, rotate, revoke, inspect, and decommission SCIM connections without a deployment.
- Keep all SCIM identity, lifecycle, Group, and role effects organization-scoped.
- Safely create new Better Auth Users and explicitly link existing verified organization members.
- Apply complete, idempotent Group-to-role-template projections, including removal and fallback behavior.
- Make SCIM protocol state and Z8 application state commit or roll back atomically.
- Require new high-entropy credentials and a complete directory reprovisioning cycle.

## Non-Goals

- Converting populated Better Auth 1.6 SCIM tables or credentials.
- Running Better Auth 1.6 and 1.7 SCIM side by side.
- Supporting legacy bearer syntax or token fallback.
- Building an application-owned credential catalog.
- Allowing SCIM from one organization to disable a Better Auth User globally.
- Deriving authorization from mutable Group display names.
- Supporting more than one active SCIM connection per organization in this release.

## Official Requirements

The design follows:

- [Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide#scim)
- [SCIM full reprovisioning sequence](https://better-auth.com/docs/guides/1-7-upgrade-guide#scim-requires-full-reprovisioning)
- [SCIM reference](https://better-auth.com/docs/plugins/scim/reference)
- [Legacy SCIM cutover](https://better-auth.com/docs/plugins/scim/reference#legacy-scim-cutover)
- [Groups and custom roles](https://better-auth.com/docs/plugins/scim/groups-and-roles)

Better Auth 1.7 does not read or convert the 1.6 SCIM models. It requires a supported connection mode, new credentials, native interactive database transactions, explicit identity decisions, and complete User and Group reprovisioning.

## Current Z8 State

The core Better Auth 1.7 migration deliberately left SCIM unavailable:

- `@better-auth/scim` is not installed or registered.
- The Better Auth route therefore does not expose SCIM protocol endpoints.
- Enterprise setup actions authorize and then fail closed with a migration-unavailable error.
- The setup wizard preserves SCIM state but renders unavailable controls.
- `scim_provider` is represented as read-only legacy application schema.
- `scim_provider_config`, provisioning logs, lifecycle models, and role-template mappings remain.
- `SCIMProvisioningServiceLive` is not wired to any protocol path. Its writes are not consistently transactional or idempotent, Group removal does not undo access, role-template lookup is not always organization-qualified, and some fields are global to the User.

The new integration will replace rather than bridge the orphaned provisioning service.

## Architecture

### Better Auth Plugin

Install `@better-auth/scim` at the same `1.7.1` patch as Better Auth, its other plugins, and the auth CLI. Register the plugin with:

- `connections: []`
- `managedConnections`
- `identity` callbacks
- `projection` callbacks
- `compatibility.microsoftEntra.acceptLegacyGroupSchema: true`

The Microsoft compatibility option accepts only the documented input-only legacy Group schema marker and does not weaken canonical persistence or responses.

`managedConnections.credentialHashSecret` comes from a dedicated `SCIM_CREDENTIAL_HASH_SECRET`. Startup must reject a missing value or one shorter than 32 characters. It must not reuse the Better Auth application secret or any legacy SCIM token.

The wrapped Drizzle adapter must preserve native interactive transactions. The SCIM implementation cannot ship until an integration test demonstrates that Better Auth transaction callbacks execute against the PostgreSQL transaction adapter.

### Tenant Boundary

Every connection uses the immutable Z8 `organization.id` as its `provisioningDomainId`. Connection and credential IDs are opaque Better Auth identifiers. Organization slugs, domains, provider names, and active browser state are not durable identity keys.

All control-plane methods derive the organization from the authenticated active session and enforce the existing organization-settings permission. Every managed item lookup supplies both `connectionId` and `provisioningDomainId`. Unknown and cross-organization identifiers return the same not-found behavior.

### Component Ownership

Better Auth owns:

- SCIM HTTP parsing, validation, discovery, filtering, pagination, and error envelopes.
- Canonical SCIM Users, Groups, memberships, subjects, tombstones, and projection grants.
- Managed connection and credential storage, hashing, scopes, expiry, revocation, usage metadata, events, and decommissioning.

Z8 owns:

- Organization-scoped connection policy and setup state.
- Existing-User linking policy.
- Organization membership and employee lifecycle.
- Role-template mappings and effective access application.
- Application lifecycle audit records.
- Durable post-commit billing-seat synchronization.
- Organization-admin controls and documentation.

Callbacks live in a focused SCIM integration module and accept Better Auth's transaction-bound adapter. They must not call the global Drizzle handle for state that must commit with the SCIM request.

## Data Model

### Generated Better Auth Models

Regenerate `src/db/auth-schema.ts`; do not edit it manually. Managed mode adds the seven core models:

- `scimConnectionBinding`
- `scimIdentityTombstone`
- `scimSubject`
- `scimUser`
- `scimGroup`
- `scimGroupMember`
- `scimProjectionGrant`

It also adds:

- `scimManagedConnection`
- `scimManagedCredential`
- `scimManagedConnectionEvent`

### Z8-Owned Configuration

Retain one `scim_provider_config` row per organization, but replace its legacy `providerId` association with the managed `connectionId` and creation correlation required by the control-plane workflow. Keep Z8 policy fields such as auto-activation, deprovision action, and default role template.

The active managed connection ID must be unique. Every lookup must also qualify it by `organizationId`. The selected default role template must be active and either belong to the organization or be an approved global template.

The connection cannot become enabled until the Better Auth connection and Z8 association are both durable.

Add organization-qualified SCIM application lifecycle state for each linked User. It records which membership and employee transitions SCIM owns and the prior values needed to reverse a SCIM deactivation without elevating access. This state is not a second identity catalog; Better Auth subjects and tombstones remain authoritative for identity links.

### Legacy Storage

Before destructive DDL, a migration guard checks for:

- Rows in `scim_provider`.
- Rows in legacy `scim_provider_config`.
- Enterprise setup records that claim an enabled legacy SCIM connection.

Any result aborts migration and requires a separate inventory-based cutover. When all checks are empty, drop `scim_provider` and create the new schema. Do not copy provider IDs or credentials.

### Billing Side Effects

SCIM callbacks do not call Stripe or another external system inside a database transaction. Membership changes write an idempotent, organization-qualified seat-sync outbox record in the SCIM transaction. A new durable consumer invokes the existing billing seat-sync trigger after commit and safely retries. The deduplication key represents the resulting membership revision rather than an individual retrying SCIM request.

## Identity Resolution

Better Auth's native subject and tombstone records handle repeated provisioning after the first successful link. For a first-time SCIM User:

1. Normalize the canonical primary email using Z8's existing email rules.
2. Search for the Better Auth User and membership inside the exact `provisioningDomainId`.
3. If a User has that verified email and is already a member of the target organization, return `action: "link"` with `profile: "preserve"`.
4. If the email exists but is unverified or the User is not already a member of the target organization, reject with a conflict.
5. If no User owns the email, return `action: "create"`.

No callback links by an unqualified email lookup. Existing linked Users preserve their global profile so one organization's directory cannot rewrite shared User fields. A newly created SCIM User may receive the canonical SCIM profile.

SCIM does not create an authentication account. Enterprise SSO remains the sign-in method. Provisioning and authentication identities are related only through the explicit User decision above.

## Organization Lifecycle

The organization-qualified reconciler idempotently ensures a new active SCIM User has the expected `member` and `employee` records. Repeated requests converge without duplicate memberships, employees, audit rows, or billing effects.

Initial activation follows the organization's configured approval policy. A new SCIM-created member is approved and active only when auto-activation is enabled; otherwise it remains pending and inactive. Linking an existing organization member does not elevate its current status. The approved behavior for later lifecycle changes is:

- `active: false` with suspension marks the organization member suspended and employee inactive.
- `active: false` with soft deletion preserves membership but marks the employee inactive.
- Reactivation reverses only a prior SCIM-owned deactivation and restores the recorded pre-deactivation membership and employee state. It cannot turn a previously pending or inactive User into an approved active member.
- SCIM deletion removes the source's organization-local access contribution while retaining Better Auth's identity tombstone behavior.
- No organization-level SCIM event writes a global disabled flag to the Better Auth User.

Better Auth may invalidate sessions when the User's final SCIM identity source becomes inactive. Z8 does not block future authentication globally, so the User can continue using other organizations.

Lifecycle and provisioning audit rows are part of the same database transaction. System-originated events use explicit nullable or system attribution; they must not claim that the affected User performed the action.

## Group And Role Projection

### Mapping

`projection.roles.map` resolves the Group's stable directory `externalId` through `role_template_mapping` with both:

- `organizationId = provisioningDomainId`
- `idpType = "scim"`

The Group display name is informational only. If a directory cannot guarantee stable `externalId` values, that connection cannot use Group authorization until an immutable mapping key is available.

`projection.roles.exists` accepts a template only when it is active and either organization-owned or an approved global template. Foreign, missing, and inactive templates grant nothing.

### Effective Template

Z8 continues to expose one effective role template per User and organization. If several mapped Groups apply, the highest `role_template_mapping.priority` wins. Equal priorities use mapping ID as a stable tie-breaker.

A default role template is mandatory before enabling a SCIM connection. When no mapped Group applies, or the winning Group is removed, the User returns to the default template. This prevents stale access and avoids an undefined no-template state.

### Ownership And Precedence

The reconciler replaces only SCIM-owned assignment state. A current manual, invitation, or SSO assignment takes precedence and is not overwritten. Better Auth's canonical Groups remain the source for the desired SCIM assignment. Removing an override triggers `reconcileSCIMProjection` to restore the current SCIM-derived result.

Template application changes only organization-local fields:

- Employee role.
- Organization-wide team permissions.
- Optional default-team membership.

SCIM projection does not directly write global `user.canUseWebapp`, `user.canUseDesktop`, or `user.canUseMobile` fields based on one tenant's directory.

Group removal, Group deletion, mapping changes, role-catalog changes, and connection decommissioning all execute the same idempotent full-state reconciler. Event-style add-only behavior is removed. Mapping and catalog administration calls trusted `reconcileSCIMProjection({ provisioningDomainId: organizationId })` after a committed change.

## Administrator Control Plane

### Create

Only an authorized organization administrator can create a connection. Z8 permits one active connection per organization.

Creation uses a persisted, globally unique `creationRequestId` reservation:

1. Create or retain the Z8 reservation for the logical operation.
2. Call `createSCIMManagedConnection` with `provisioningDomainId = organizationId`.
3. Persist the returned connection ID into the reserved organization configuration.
4. Return the raw token only after the association is durable.

If the response is lost after Better Auth creates the connection, retry logic lists organization-qualified managed connections and finds the correlation. It adopts the connection, rotates a fresh credential, revokes the potentially lost initial credential, and returns only the replacement. Reusing `creationRequestId` is not treated as Better Auth idempotent replay.

### Credential Policy

The initial credential and rotations receive all four SCIM User and Group read/write scopes. Credentials expire one year after issuance. The UI shows expiry and supports overlap: issue a replacement, update the directory, confirm use, then revoke the retiring credential.

Raw tokens are returned only by create and rotate. They are never persisted, logged, sent to analytics, included in error context, or placed in cacheable responses. The UI makes the one-time nature explicit and cannot retrieve a token later.

### Status And Events

Setup responses contain only organization-qualified connection and credential metadata. A connection is verified only after a managed credential has successfully authenticated a SCIM request. Token creation alone is not verification.

The UI exposes connection state, credential expiry and usage metadata, rotation, revocation, and recent Better Auth managed connection events. Z8's provisioning log remains the application lifecycle audit trail.

### Decommission

Decommissioning is irreversible. The UI disables the connection immediately, then calls Better Auth's managed decommission method. If reconciliation remains in progress, a background job retries at or after `retryAfter` until complete. Only completion clears the active setup association. Canonical Better Auth SCIM history remains retained.

## Error Handling And Security

- Invalid or expired credentials return `401`.
- Authenticated credentials without required scope return `403`.
- Invalid resources and operations return Better Auth SCIM `400` envelopes.
- Identity and uniqueness conflicts return `409`.
- Callback errors roll back SCIM and Z8 writes together.
- Cross-organization and unknown managed identifiers are indistinguishable.
- Logs include safe connection, resource, and request identifiers, never bearer tokens or complete sensitive payloads.
- Mapping lookup failure grants nothing.
- Infrastructure exceptions remain server errors and are not misreported as invalid credentials.
- Control-plane actions authorize before database or Better Auth side effects.

## User Experience And Documentation

Restore enterprise setup controls for:

- Connection creation.
- One-time credential display.
- Verification status.
- Credential expiry.
- Overlapping rotation and revocation.
- Recent connection events.
- Decommissioning state.

Enterprise identity activation may remain independent of SCIM. The SCIM step cannot report enabled until connection creation and Z8 association are durable.

Update all locale catalogs and the administrator SCIM guide in the same release. Remove migration-unavailable copy, stale token-generation descriptions, and obsolete response helpers only after the replacement flow is covered by tests.

## Deployment And Cutover

1. Back up and inventory all legacy SCIM and related setup tables.
2. Confirm the expected zero-row legacy footprint and no enabled legacy setup records.
3. Configure `SCIM_CREDENTIAL_HASH_SECRET` in every environment.
4. Regenerate the Better Auth schema and review the resulting PostgreSQL DDL.
5. Apply the guarded database migration before enabling the plugin.
6. Deploy the Better Auth SCIM plugin, callbacks, control plane, and restored UI together.
7. Create a new managed connection and one-year credential for a test organization.
8. Configure the directory with `/api/auth/scim/v2` and the new credential.
9. Trigger a complete User and Group provisioning cycle.
10. Verify identity links, membership, employee lifecycle, default and mapped roles, billing outbox delivery, rotation, revocation, and decommission retries.
11. Advertise SCIM availability only after production-like PostgreSQL verification passes.

There is no dual-running period and no legacy token acceptance.

## Test Strategy

### Schema And Migration

- Lock the seven core and three managed Better Auth models.
- Verify organization-qualified configuration indexes and foreign keys.
- Verify the migration aborts on every legacy-data guard.
- Verify an empty legacy table is dropped and no compatibility columns remain.
- Verify the generated schema, migration snapshot, and auth configuration agree.

### Identity And Lifecycle

- Create a new User.
- Link only an exact-email, verified member of the target organization.
- Preserve an existing linked User's profile.
- Reject unverified and cross-organization collisions.
- Reuse native subjects and tombstones on repeated provisioning.
- Exercise create, update, deactivate, reactivate, and delete.
- Verify duplicate requests converge.
- Verify callback failure rolls back every related row.
- Verify audit and seat-sync outbox deduplication.

### Projection

- Create, update, and delete Groups and memberships.
- Reject foreign, inactive, and missing templates.
- Verify priority ordering and deterministic ties.
- Verify mandatory default fallback.
- Verify manual, invitation, and SSO precedence.
- Verify Group removal removes stale SCIM-owned access.
- Verify mapping replay and decommission reconciliation.
- Verify SCIM never mutates global application-access flags.

### Managed Control Plane

- Authorize before side effects.
- Enforce one connection per organization.
- Keep raw tokens out of persistence, logs, analytics, and setup responses.
- Recover creation after a lost response using `creationRequestId` correlation.
- Prevent cross-organization listing and mutation.
- Exercise one-time creation, rotation overlap, revocation, expiry, event listing, and resumable decommissioning.

### Protocol And Product

- Exercise discovery and representative User and Group POST, PUT, PATCH, DELETE, filter, and pagination requests.
- Include Microsoft Entra-compatible payloads and expected `400`, `401`, `403`, and `409` envelopes.
- Verify the restored setup UI on desktop and mobile.
- Verify every locale uses restored, accurate SCIM copy.
- Verify the administrator guide matches the actual endpoint and one-time credential flow.

### Completion Checks

Run targeted Vitest suites, webapp typecheck, React diagnostics for changed UI, `CI=true pnpm build`, and a production-like PostgreSQL complete-sync smoke test with a newly issued credential.

## Acceptance Criteria

- An organization administrator can create one organization-bound managed SCIM connection and receive a credential once.
- A directory can complete User and Group reprovisioning against `/api/auth/scim/v2`.
- Existing Users link only under the approved verified organization-member policy.
- Deactivation and role changes affect only the target organization.
- Group removal and mapping changes remove stale SCIM-owned access.
- Manual, invitation, and SSO access remains intact.
- Credential rotation, revocation, expiry, and decommissioning work without legacy fallback.
- All SCIM and Z8 state changes are atomic or delivered through a durable post-commit outbox.
- Cross-organization access tests pass.
- No raw credential is persisted or logged.
- Legacy SCIM tables are removed only after zero-row guards pass.
- Documentation and locale catalogs describe the live Better Auth 1.7 behavior.
