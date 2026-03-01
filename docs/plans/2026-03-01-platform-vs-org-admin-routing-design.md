# Platform vs Org Admin Routing Design

Date: 2026-03-01
Status: Approved
Owner: Platform Team

## Context

The current routing and API naming mixes two different scopes:

- Platform administration (super-admin responsibilities across all organizations)
- Organization administration (tenant-scoped settings and operations)

This overlap has already caused scope drift (for example, worker queue concerns appearing in org admin contexts). We are standardizing route and API namespaces so ownership is explicit and future features are harder to misplace.

## Goals

- Make platform-level and org-level responsibilities unambiguous in URL and API structure.
- Prevent infrastructure/platform features from being added to org-admin surfaces.
- Keep multi-tenant boundaries explicit in implementation and review.

## Non-Goals

- No backward compatibility aliases or redirects.
- No phased migration with dual paths.
- No behavior changes to business logic beyond path, naming, and boundary clarity.

## Selected Approach

Approach 1: Semantic split by scope.

- Platform UI routes: move from `/admin/*` to `/platform-admin/*`.
- Platform APIs: use `/api/platform-admin/*`.
- Org-admin APIs currently under `/api/admin/*`: move to `/api/org-admin/*`.
- Hard cutover: old `/admin/*` and `/api/admin/*` paths are removed.

Rationale:

- Maximizes clarity with bounded scope.
- Aligns path taxonomy to permissions and ownership.
- Reduces chance of future scope confusion compared with partial renames.

## Architecture

### Route Taxonomy

- `platform-admin` means platform/super-admin scope.
- `org-admin` means organization-scoped admin scope.

### UI Surface

- Platform admin pages are served only under `/platform-admin/*`.
- Navigation, internal links, and redirects use `/platform-admin/*` exclusively.
- User-facing wording is updated from generic "Admin" to "Platform Admin" where the intent is platform scope.

### API Surface

- Org settings/admin endpoints move from `/api/admin/*` to `/api/org-admin/*`.
- Platform-level endpoints use `/api/platform-admin/*`.
- `/api/admin/*` is removed.

## Components and Route Map

### Platform Admin App Routes

Update route usage and links in platform admin pages/layout:

- `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- `apps/webapp/src/app/[locale]/(admin)/admin/page.tsx`
- `apps/webapp/src/app/[locale]/(admin)/admin/users/*`
- `apps/webapp/src/app/[locale]/(admin)/admin/organizations/*`
- `apps/webapp/src/app/[locale]/(admin)/admin/billing/*`
- `apps/webapp/src/app/[locale]/(admin)/admin/settings/*`
- `apps/webapp/src/app/[locale]/(admin)/admin/worker-queue/*`

All platform links and redirects should target `/platform-admin/...`.

### Org Admin API Handlers and Callers

Move org-scoped API route handlers currently in:

- `apps/webapp/src/app/api/admin/*`

to:

- `apps/webapp/src/app/api/org-admin/*`

Update callers in org settings components and flows (for example holiday/category/preset dialogs) to use `/api/org-admin/*`.

### Platform API Handlers

Use `/api/platform-admin/*` for platform-scoped endpoints and call sites.

## Data Flow and Permission Boundaries

### Platform Admin

- `/platform-admin/*` pages require platform admin session/role checks.
- `/api/platform-admin/*` endpoints require platform admin authorization before execution.
- Platform data operations may span organizations by design.

### Org Admin

- `/api/org-admin/*` endpoints are tenant-scoped.
- Every read/write operation enforces `organizationId` filtering and org-level permissions.
- No platform infrastructure controls (for example worker queue internals) appear in org-admin endpoints.

### Cache and Revalidation

- Revalidation targets update to new route roots:
  - Platform pages: `/platform-admin/...`
  - Org-admin API driven pages/features: route-specific org locations

## Error Handling

- Unauthorized access to platform-admin routes/endpoints returns the existing denial behavior with updated route targets.
- Old paths (`/admin/*`, `/api/admin/*`) are removed and fail fast.
- Error messages and logs should include explicit scope labels (`platform-admin` vs `org-admin`) where useful.

## Testing Strategy

### Access Control

- Verify platform admins can access `/platform-admin/*`.
- Verify non-platform users are denied/redirected for platform-admin routes/endpoints.

### API Contract

- Verify org settings requests succeed through `/api/org-admin/*`.
- Verify `/api/admin/*` no longer resolves.

### Integration and UX

- Validate settings dialogs and org-admin flows call `/api/org-admin/*`.
- Validate platform console features call `/api/platform-admin/*`.
- Validate labels and copy use "Platform Admin" for platform scope.

### Guardrails

- Add a search-based CI/test guard to flag new accidental usage of `/admin` and `/api/admin` path literals in app code.

## Risks and Mitigations

- Risk: Missed hardcoded path causes runtime failures after cutover.
  - Mitigation: targeted grep, route tests, and integration smoke checks.
- Risk: Hidden external clients depend on `/api/admin/*`.
  - Mitigation: communicate cutover and release notes clearly; monitor 404/4xx after deployment.
- Risk: Scope confusion persists in copy/docs.
  - Mitigation: complete wording update to "Platform Admin" where platform scope is intended.

## Rollout Notes

- This is a hard cutover with no compatibility layer.
- Coordinate deployment with API consumers and internal teams.
- Watch logs/telemetry for unexpected traffic to removed paths.

## Acceptance Criteria

- No platform admin page remains under `/admin/*`.
- No org-admin endpoint remains under `/api/admin/*`.
- Platform endpoints are under `/api/platform-admin/*`.
- Platform wording is updated to "Platform Admin" in UI and docs where applicable.
- Tests pass for access control, route behavior, and endpoint usage.
