# Automatic Organization Subdomains Design

## Context

Z8 already supports customer-owned custom domains for organization branding. Custom domains are stored in `organization_domain`, verified through DNS, and resolved at runtime with `getDomainConfig(hostname)`. Auth pages use the resolved domain context for organization-specific branding, auth configuration, social OAuth availability, Turnstile, and cookie consent.

The production app domain is `ui.z8-time.app`. Customers should also receive automatic platform-owned organization URLs without DNS setup. The canonical automatic URL should use the organization slug because `organization.slug` is unique and human-readable. The organization id URL should also work as a stable alias.

## Goal

Support automatic organization URLs in production:

- Canonical: `https://<organization.slug>.ui.z8-time.app`
- Alias: `https://<organization.id>.ui.z8-time.app`

Generated app links should prefer a verified customer custom domain when one exists. Otherwise they should use the canonical slug platform subdomain.

## Non-Goals

- Do not require customer DNS setup for automatic platform subdomains.
- Do not store automatic platform subdomains in `organization_domain`.
- Do not change the existing custom-domain DNS verification workflow.
- Do not add slug alias history when an organization slug changes.
- Do not edit `src/db/auth-schema.ts` directly.

## Recommended Approach

Add derived platform-subdomain resolution separate from verified customer custom-domain resolution.

The resolver should classify request hosts into these cases:

- Main app domain: `ui.z8-time.app` or the configured `MAIN_DOMAIN`.
- Platform organization subdomain: exactly one label before the platform root, such as `acme.ui.z8-time.app`.
- Customer custom domain: any non-main, non-platform host that should continue through `organization_domain` verification.
- Unknown or unsupported host.

For platform organization subdomains, resolve the first label against both `organization.slug` and `organization.id` where needed. Slugs are used for canonical generated URLs, but id aliases must not be shadowed by another organization's slug. If both a slug and an id match different organizations, the id match wins.

## Better Auth Compatibility

Better Auth 1.6.11 does not expose an organization-plugin `customDomains` option in the current docs or installed package. The relevant controls are dynamic `baseURL.allowedHosts` and `trustedOrigins`.

Update Better Auth configuration so platform organization subdomains are accepted by auth endpoints:

- Add `*.ui.z8-time.app` to `baseURL.allowedHosts` so Better Auth derives request-local callback URLs instead of falling back to the main app URL.
- Ensure `trustedOrigins` accepts `https://*.ui.z8-time.app`. The current dynamic function already adds the request host origin, but the wildcard should be explicit so CSRF and redirect validation are stable for platform subdomains.
- Keep verified customer custom domains trusted through the existing `getDomainConfig(normalizedHost)` path.

This prevents Better Auth from redirecting platform organization subdomain requests back to the bare app host and allows cookie-backed auth requests from those origins.

## Runtime Behavior

### Main Domain

Requests to the configured main domain continue using global auth behavior and platform-level settings.

### Platform Organization Subdomain

Requests to `slug.ui.z8-time.app` resolve the organization by slug and create a domain context for auth pages. Auth pages should use organization branding from `organization_branding`, organization-specific social OAuth availability, and default platform auth settings for values that are currently stored only on custom-domain records. Custom-domain-only settings, such as per-domain auth config in `organization_domain.auth_config`, remain limited to verified customer custom domains unless a later feature moves those settings to an organization-level table.

Requests to `orgid.ui.z8-time.app` resolve the organization by id. The id alias is unambiguous: if another organization has a slug equal to this id, the id owner wins. The app accepts aliases without middleware redirects in this implementation to avoid database work in middleware and unsafe method-changing redirects for API/auth requests.

### Customer Custom Domain

Customer-owned domains continue using the existing `organization_domain` lookup and require `domainVerified = true`.

### Unknown Platform Subdomain

Unknown `*.ui.z8-time.app` hosts should not silently behave as the main app domain. Return a clear 404-style response for page requests. Avoid redirecting to sign-in in a way that confirms whether an organization exists.

## URL Generation

`getOrganizationBaseUrl(organizationId)` should return, in order:

1. The verified customer custom domain, when configured.
2. `https://<organization.slug>.ui.z8-time.app`, when the organization can be read and has a slug.
3. The default app URL as a fallback when no organization id is provided or organization lookup fails.

This preserves custom-domain branding while giving every organization a predictable automatic URL.

## Data Model

No database migration is required. The implementation uses existing fields:

- `organization.id`
- `organization.slug`
- `organization_domain.domain`
- `organization_domain.domainVerified`

Automatic platform subdomains are derived from organization records and are not custom-domain records.

## Error Handling

- Treat malformed or multi-level platform subdomains as unsupported unless a future requirement needs them.
- Resolve slug and id matches so id aliases cannot be shadowed by another organization's slug.
- If neither lookup succeeds, return a not-found result.
- If organization lookup fails due to database errors, log the error and fall back only where the caller already has a safe default, such as URL generation.
- If an organization slug changes, the old slug URL stops resolving. The organization id alias remains available.

## Security And Permissions

Host-derived organization context must not grant permissions by itself. Existing session, membership, and organization-scoped authorization checks remain authoritative.

Do not trust client-supplied domain headers. Resolve hosts from the trusted request `Host` header, matching the existing custom-domain anti-spoofing pattern.

Customer custom domains remain gated by DNS verification. Platform organization subdomains are platform-owned and do not need per-organization DNS verification.

## Testing

Add focused coverage for:

- Host classification for main domain, platform organization subdomain, organization-id alias, localhost, arbitrary custom domain, and unknown platform subdomain.
- Platform resolver preference for slug over id.
- `getOrganizationBaseUrl()` returning verified custom domain first, then slug platform URL, then default app URL.
- Better Auth config including `*.ui.z8-time.app` in allowed hosts and trusted origins.
- Auth layout resolving organization context for platform organization subdomains.
- Proxy behavior that does not treat `slug.ui.z8-time.app` as a customer custom domain.

If full server-component tests are brittle, extract host classification and auth-context selection into small pure helpers and test those directly.
