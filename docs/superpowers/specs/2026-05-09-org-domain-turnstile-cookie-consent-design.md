# Organization Domain Turnstile And Cookie Consent Design

## Context

Platform administrators can already configure a global cookie consent script at `/platform-admin/settings`. The same page documents global Cloudflare Turnstile through deployment environment variables. Organization custom domains are managed at `/settings/enterprise/domains`, where each organization is limited to one custom domain and already has per-domain authentication configuration.

Custom domains currently support per-domain Turnstile site keys in `organizationDomain.authConfig`, with the Turnstile secret stored in the organization's Vault namespace. Auth pages resolve custom-domain settings through `getDomainConfig(hostname)`. The auth layout currently injects the global platform cookie consent script for all auth pages, including custom domains.

## Goal

Allow organization admins to configure Turnstile and cookie consent for their connected custom domain from `/settings/enterprise/domains`, without relying on platform-admin settings for custom-domain behavior.

## Non-Goals

- Do not change global platform-admin Turnstile environment-variable behavior.
- Do not add support for multiple custom domains per organization.
- Do not store Turnstile secret keys in the database.
- Do not inject the platform global cookie script on custom domains when no organization script is configured.

## Recommended Approach

Extend the existing per-domain auth configuration instead of adding a new table. Add an optional `cookieConsentScript` field to the `AuthConfig` type, stored in the existing `organization_domain.auth_config` JSON payload alongside `turnstileSiteKey`.

This keeps auth-page domain behavior in one request-scoped configuration object and follows the existing save path used by `DomainAuthConfigDialog`, `updateDomainAuthConfigAction`, and `updateDomainAuthConfig`.

## Data Model

`AuthConfig` gains:

```ts
cookieConsentScript?: string;
```

The field is optional. Missing or empty values mean no organization-specific cookie consent script is injected for that custom domain.

Existing `auth_config` records remain valid because the new field is optional and JSON parsing already tolerates partial records.

## UI

The existing domain authentication settings action panel remains the setup surface. It should include:

- The current Cloudflare Turnstile site-key and secret-key fields.
- A new cookie consent script textarea with copy explaining that it is injected only on this custom domain's auth pages.
- Save behavior that updates both fields through the existing domain auth config action.

The domain card summary should show lightweight status badges for Turnstile and cookie consent so admins can see whether each custom-domain protection/compliance setting is configured without opening the panel.

## Runtime Behavior

Main app/auth domain:

- Continue using `getCookieConsentScript()` from platform settings.
- Continue using global Turnstile environment variables.

Verified custom domain:

- Resolve domain config with `getDomainConfig(customDomain)`.
- Use the per-domain Turnstile site key from `authConfig.turnstileSiteKey`.
- Inject `authConfig.cookieConsentScript` only when it is present and non-empty.
- Do not fall back to the platform global cookie consent script.

Unresolved or unverified custom domain:

- Preserve current behavior where no domain context is returned.
- Do not introduce a new cookie-consent fallback for this case.

## Security And Permissions

Only enterprise organization admins can update custom-domain auth configuration. Server actions must continue to call `requireEnterpriseOrgAdmin()` and `requireOrganizationDomain(domainId, organizationId)` before updating domain configuration.

Turnstile secret handling remains unchanged: the secret is stored through `storeOrgSecret(organizationId, "turnstile/secret_key", secretKey)` and is not returned to the client.

Cookie consent script content is executable HTML/script, matching the existing platform-admin behavior. The implementation should avoid exposing this setting outside authorized org-admin paths and should only inject it on auth pages for the matching verified custom domain.

## Cache And Revalidation

Updating domain auth config should continue invalidating the custom-domain cache through `updateDomainAuthConfig`, because cookie consent script selection becomes part of the resolved domain auth context. Server actions should continue revalidating `/settings/enterprise/domains` after saving.

## Testing

Add or update focused coverage where practical for:

- `AuthConfig` handling with an optional `cookieConsentScript` field.
- Custom-domain auth layout script selection: custom domains use only their own script.
- Main-domain auth layout script selection: main domain continues using platform settings.
- Domain settings UI save payload preserving existing auth fields while adding the cookie script.

If auth layout coverage is difficult because of Next.js server component boundaries, extract script-selection logic into a small helper and cover that helper directly.
