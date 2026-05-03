# SSO + SCIM Setup Wizard Design

## Context

Z8 already has the foundations for enterprise identity management:

- Better Auth SSO is enabled with OIDC and SAML support, strict SAML validation, domain verification, and organization provisioning.
- Better Auth SCIM is enabled with encrypted token storage and organization-scoped token generation hooks.
- Enterprise settings already expose custom domains, branding, social OAuth, and basic SSO provider management.
- SCIM has backend schema and provisioning services, but the docs explicitly state that no self-serve SCIM setup page exists today.

The product gap is a guided, resumable setup experience that lets organization owners/admins configure enterprise identity without stitching together separate settings pages or requiring managed rollout for every organization.

## Goals

- Provide one end-to-end wizard for enterprise identity setup.
- Support Okta, Microsoft Entra ID, Google Workspace, and generic SAML/OIDC provider presets.
- Configure SSO first, then offer optional SCIM provisioning in the same workflow.
- Verify SSO with a live test user before enabling enforcement controls.
- Show SCIM endpoint and bearer token setup instructions, then verify SCIM through refreshed connection status and provisioning logs after the IdP pushes data.
- Keep domain restrictions and invite policy enforcement saved as ready-but-disabled until explicit activation.
- Assign a default role template for SSO/SCIM-created users, falling back to the built-in employee role when no template is selected.
- Preserve organization scoping and owner/admin-only access.

## Non-Goals

- Building a separate identity system outside Better Auth.
- Automatically enabling domain or invite enforcement immediately after configuration.
- Showing SCIM bearer tokens after the initial generation event.
- Adding tenant-specific identity configuration through environment variables.
- Implementing a break-glass access model unless one already exists elsewhere in the app.

## Recommended Approach

Build a unified SSO + optional SCIM wizard under enterprise settings. This is preferable to separate SSO and SCIM wizards because admins think about identity provider rollout as one operational workflow: domain ownership, SSO sign-in, user provisioning, invite behavior, and role assignment all affect the same launch decision.

A lightweight checklist around existing forms would be smaller, but it would leave the main gap unresolved: admins would still need to infer safe rollout order and SCIM behavior. The unified wizard should guide the order, persist progress, and surface readiness without activating risky controls by default.

## Architecture

The wizard should live in enterprise settings as a new org-scoped setup surface at `/settings/enterprise/identity-setup`. The existing Domain & Branding/SSO area should link to this route when admins want guided setup instead of direct provider management.

Access should use the same org-admin settings helpers already used by enterprise actions. Organization owners and admins can configure the wizard. Employee role checks should not be used for this surface.

The wizard should reuse Better Auth instead of duplicating identity behavior:

- SSO provider creation calls Better Auth `registerSSOProvider`, extending the current Z8 wrapper to support both OIDC and SAML inputs.
- Domain verification uses the existing Better Auth SSO domain verification path.
- SCIM token generation calls Better Auth `generateSCIMToken` with `providerId` and the active `organizationId`.
- Z8-specific SCIM preferences continue to live in `scim_provider_config`.

Add a Z8-owned `enterprise_identity_setup` table to track product workflow state that Better Auth does not own: selected preset, selected protocol, current step, last SSO test result, SCIM setup status, pending policy settings, and activation state. This keeps workflow metadata separate from Better Auth provider tables and lets admins resume setup without exposing secrets.

## Wizard Flow

### 1. Provider

Admins choose Okta, Microsoft Entra ID, Google Workspace, or generic SAML/OIDC. Presets provide labels, setup copy, protocol support, default scopes/mappings, and generated callback or metadata URLs. Admins can still choose protocol explicitly where a preset supports more than one option.

### 2. Domain

Admins enter the corporate email domain and generate DNS verification. The wizard shows the TXT token and supports retrying verification. Domain enforcement remains unavailable until verification succeeds.

### 3. SSO Configuration

For OIDC, collect issuer, client ID, and client secret. Better Auth OIDC discovery should hydrate authorization, token, JWKS, user info, discovery, and token-authentication endpoints when available.

For SAML, v1 should prioritize IdP metadata XML upload/paste and expose SP metadata and ACS values for the selected provider. Explicit entry point/certificate fields can be supported as an advanced fallback only when metadata is unavailable. SAML defaults should align with the existing strict server settings: signed logout support, InResponseTo validation, timestamp requirements, deprecated algorithm rejection, and payload size limits.

OIDC client secrets and any supported SAML secrets must be handled as one-way inputs. The UI should never re-display stored secrets.

### 4. Test User

The wizard runs a live SSO test for the configured provider. It records pass/fail, timestamp, test email, provider ID, and a safe error summary. A successful test unlocks final enforcement controls but does not automatically enable enforcement.

### 5. SCIM Provisioning

SCIM is optional. When enabled, the wizard generates one organization-scoped SCIM connection and shows:

- SCIM base URL, such as `/api/auth/scim/v2` under the app's public base URL.
- Bearer token, shown only once.
- Provider ID.
- IdP-specific setup hints for the selected preset.

Admins can configure auto-activation, deprovision action, and default role template. Verification is based on refreshing SCIM connection status and provisioning logs after the IdP performs its test push. The wizard should not pretend to verify SCIM locally without inbound IdP activity.

### 6. Access Policy

Admins configure rollout policy before activation:

- Invite policy intent for the verified domain.
- Domain restriction intent.
- Whether SSO should be required for the verified domain.
- Default role template for SSO/SCIM-created users.

These settings save as ready-but-disabled. If no role template is selected, new provisioned users fall back to the built-in employee role.

### 7. Review & Activate

The final step shows a summary of provider, domain, SSO test status, SCIM status, and pending enforcement choices. Activation requires explicit confirmation and should warn when any prerequisite is missing.

The wizard must avoid locking out the current admin session. Requiring SSO for a domain should require a verified domain and successful SSO test for that provider. If the current admin email is in the affected domain, the warning should be prominent.

## Data Flow

Client components submit step data through narrowly scoped server actions. Sensitive operations stay on the server:

- Register or update SSO provider.
- Request and verify domain ownership.
- Record SSO test state.
- Generate, rotate, list, or delete SCIM provider connections.
- Update Z8 SCIM provider configuration.
- Save pending invite/domain/default-role policy.
- Activate enforcement.

Every server action must derive the active organization from the authenticated session and filter all reads/writes by `organizationId`. Returned provider data must mask secrets. SCIM tokens are returned only at creation or rotation time.

Provider presets are static product metadata in code. Organization-specific setup choices are stored in the database, not environment variables.

## Better Auth Capability Notes

Better Auth SSO supports OIDC, OAuth2 providers, and SAML 2.0. OIDC registration supports discovery from `{issuer}/.well-known/openid-configuration` and returns structured discovery errors such as issuer mismatch, incomplete discovery metadata, untrusted origin, timeout, unsupported token auth method, invalid URL, and invalid JSON.

Better Auth SAML supports provider registration, SP metadata retrieval, IdP-initiated SSO handling, InResponseTo validation, assertion replay protection, timestamp validation, algorithm validation, and payload size limits.

Better Auth SCIM exposes a SCIM 2.0 server, organization-scoped token generation, connection listing/details/deletion, user create/update/patch/delete endpoints, service provider config, schemas, and resource type metadata. Organization-scoped SCIM management defaults to admin and owner-like roles, matching the desired owner/admin access policy.

## Error Handling

Treat setup as recoverable. Each step should support saving progress and retrying external checks.

Field validation should catch missing domains, malformed URLs, invalid provider IDs, missing secrets, and malformed SAML metadata before submission where feasible.

External checks should produce actionable messages:

- DNS token missing or not propagated.
- OIDC discovery issuer mismatch.
- OIDC discovery incomplete metadata.
- OIDC discovery untrusted origin.
- OIDC discovery timeout.
- Unsupported token authentication method.
- Invalid SAML metadata or certificate.
- SSO test failure.
- SCIM token generation failure.
- SCIM connection has no observed provisioning activity yet.

Activation is conservative. Domain restrictions, invite restrictions, and required SSO remain unavailable or disabled until prerequisites pass. If SCIM token generation succeeds but the admin leaves the page, the recovery path is token rotation, not re-showing the original token.

## Testing

Implementation should include server/action tests for:

- Owner/admin access and rejection for unauthorized users.
- Organization scoping on all wizard reads/writes.
- SSO provider secret masking.
- OIDC and SAML input validation.
- Better Auth error mapping.
- SCIM token show-once behavior.
- SCIM config persistence.
- Activation guardrails.

Component tests should cover:

- Stepper progression and resume behavior.
- Provider preset rendering.
- Validation and disabled activation states.
- Token creation and rotation UI behavior.
- Mobile layout constraints.
- Recovery from failed DNS, SSO, and SCIM checks.

Route/access regression tests should extend existing settings route tests so `/settings/enterprise/identity-setup` follows org-admin settings access and does not depend on employee-role-only checks.

Manual verification should cover OIDC happy path, SAML metadata happy path, DNS pending/success states, SSO test failure messaging, SCIM token generation, SCIM log refresh after IdP test push, and final activation with ready-but-disabled defaults.

## Implementation Constraints

- Setup state belongs in a new Z8-owned `enterprise_identity_setup` table and must not be stored in Better Auth generated schema.
- SAML is included in v1, with metadata XML as the primary configuration path and manual fields as an advanced fallback.
- SCIM verification should use real connection/log state only; avoid mock verification buttons that imply provisioning succeeded without inbound IdP activity.
