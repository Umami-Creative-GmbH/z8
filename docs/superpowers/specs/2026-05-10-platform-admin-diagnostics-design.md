# Platform Admin Diagnostics Design

Date: 2026-05-10
Status: Approved for planning
Owner: Platform Team

## Context

The platform-admin console currently includes overview, users, organizations, settings, worker queue, and optional billing pages. Settings manages global cookie consent and documents Turnstile environment variables. Worker queue exposes queue and cron execution diagnostics, but there is no single place for platform operators to verify safe deployment configuration and app-level service health.

Platform administrators need a read-only diagnostics surface that answers basic deployment questions without exposing secrets or crossing into Kubernetes cluster inspection.

## Goals

- Add a dedicated `/platform-admin/diagnostics` page.
- Show safe deployment configuration states without revealing secret values.
- Show app-only health checks for database, queue/Valkey, worker queue signal, and billing readiness.
- Provide a manual refresh button that re-checks diagnostics without a full page navigation.
- Keep the feature platform-scoped and available only to platform administrators.

## Non-Goals

- No Kubernetes pod, image, rollout, ingress, or cert-manager inspection.
- No direct deployment controls, restarts, scaling, or mutation actions.
- No editable platform settings beyond existing settings surfaces.
- No secret display, secret export, or raw environment dump.
- No replacement for the existing worker queue page.

## Selected Approach

Use a server-rendered diagnostics page with a small refresh client island.

The initial page load renders a diagnostics snapshot on the server. A client component receives that snapshot and exposes a manual refresh action. Refresh calls a server action that re-runs the same diagnostics collector and updates the visible snapshot in place.

This keeps sensitive checks server-side, minimizes client code, and gives operators a practical way to re-check state after deployment/configuration changes.

## Architecture

### Route Structure

- `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx` renders the page shell and initial snapshot.
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts` exposes `refreshPlatformDiagnosticsAction()`.
- A small client component owns the refresh button, pending state, last refreshed display, and refresh error presentation.

The diagnostics page is linked from platform-admin navigation and from the overview quick actions area.

### Authorization

The existing `(admin)` layout continues to restrict all platform-admin routes to `session.user.role === "admin"`. The refresh server action must also call `PlatformAdminService.requirePlatformAdmin()` before collecting diagnostics. This defense-in-depth prevents direct action invocation by non-platform users.

### Diagnostics Collector

Add a focused server-side collector, such as `collectPlatformDiagnostics()`, under a platform diagnostics module or colocated route helper. It returns serializable, typed data instead of JSX.

The collector should gather independent checks in parallel where safe. Individual optional checks should return item-level `healthy`, `warning`, or `error` statuses instead of causing the whole snapshot to fail. Required failures, such as database failure, can drive the overall snapshot to `error`.

## Diagnostics Content

### Configuration Overview

Report safe configuration states only:

- Billing: `BILLING_ENABLED` as enabled or disabled.
- Turnstile site key: configured or missing.
- Turnstile secret key: configured or missing, never displaying the value.
- Cookie consent script: configured or not configured, with a link to `/platform-admin/settings`.
- Deployment ID: present or missing from `system_config`; show the value because it is a non-secret telemetry identifier.
- Runtime: `NODE_ENV`, app/runtime label when available, and request timestamp.

### Service Health

Report app-only health:

- Database: a lightweight query against `system_config` or another safe source.
- Queue/Valkey: reuse existing `isQueueHealthy()`.
- Worker queue signal: if queue is connected, include a compact summary such as waiting, active, failed, and delayed counts.
- Billing readiness: if billing is enabled, report whether `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY_ID`, and `STRIPE_PRICE_YEARLY_ID` are present; if disabled, mark billing as disabled rather than unhealthy.

### Overall Status

Compute a top-level status from item statuses:

- `healthy`: required checks pass and no warnings are present.
- `warning`: required checks pass but optional configuration or service checks need attention.
- `error`: a required check fails or diagnostics cannot be collected.

## UI Design

The page should follow the existing platform-admin visual language: restrained cards, clear status badges, tabular values, and concise operational copy.

Sections:

- Summary card: overall status, fetched time, and manual refresh button.
- Platform Configuration: table or card list of safe configuration states.
- Service Health: table or card list of database, queue, worker queue, and billing readiness.
- Recommended Actions: shown only when warnings or errors exist, with short operator-facing guidance.

Manual refresh behavior:

- Refresh button shows a pending state while the server action runs.
- Successful refresh replaces the current snapshot and updates the displayed fetched time.
- Failed refresh keeps the previous snapshot visible and shows an error message.

## Data Shape

Use simple serializable structures:

```ts
type DiagnosticsStatus = "healthy" | "warning" | "error" | "disabled";

interface DiagnosticsItem {
	title: string;
	status: DiagnosticsStatus;
	value: string;
	description?: string;
	actionHref?: string;
	actionLabel?: string;
}

interface PlatformDiagnosticsSnapshot {
	fetchedAt: string;
	overallStatus: Exclude<DiagnosticsStatus, "disabled">;
	configuration: DiagnosticsItem[];
	health: DiagnosticsItem[];
	recommendedActions: string[];
}
```

The implementation can refine names, but it should preserve these boundaries: diagnostics data is collected server-side, serialized safely, and rendered consistently by the UI.

## Error Handling

- Unauthorized refresh attempts return the existing safe server-action error shape.
- Database check failure marks the database item and overall status as `error`.
- Queue/Valkey failure marks queue-related items as `warning` unless product behavior depends on queue availability in a way that should be treated as `error`.
- Billing readiness warnings apply only when billing is enabled.
- Missing optional config should produce targeted recommendations, not generic failure messages.

## Security And Privacy

- Never include raw secret values in diagnostics responses.
- Never return a raw dump of `process.env`.
- Only report booleans, labels, or explicitly non-secret identifiers.
- Keep diagnostics behind platform-admin authorization on both page access and refresh action.
- Do not expose tenant-specific organization settings in this platform diagnostics surface.

## Testing Strategy

- Unit-test the diagnostics collector with mocked environment/config and health-check functions where feasible.
- Verify sensitive environment values are not present in returned diagnostics data.
- Verify billing readiness is disabled, healthy, or warning based on `BILLING_ENABLED` and required Stripe env presence.
- Verify queue failures produce safe item-level status instead of crashing the whole snapshot.
- Add or update source-level route/navigation tests similar to the existing platform-admin layout tests so the diagnostics link remains in platform-admin navigation.

## Acceptance Criteria

- `/platform-admin/diagnostics` exists and is reachable from platform-admin navigation.
- The platform overview includes a quick action for diagnostics.
- Initial diagnostics render server-side.
- Manual refresh re-runs diagnostics through a platform-admin-protected server action.
- Configuration overview shows safe status only and never reveals secrets.
- Service health includes database and queue/Valkey checks.
- Recommended actions appear when warnings or errors exist.
- Tests cover collector behavior and sensitive-value redaction.
