# Webapp Unfinished Work Fixes Design

## Context

This pass fixes four concrete unfinished items in `apps/webapp`:

- Sidebar surcharge navigation is hidden because `surchargesEnabled` is hardcoded to `false`.
- Calendar sync registers unimplemented `icloud` and `caldav` providers using casted `undefined` placeholders.
- Billing lifecycle Stripe webhook handlers log TODOs instead of sending customer-facing system emails.
- Worker cleanup jobs for old notifications and audit logs are registered but do no cleanup.

The billing email requirement is intentionally platform-scoped. Billing lifecycle emails are system mails, not organization mails, and must be customizable only by platform admins. Delivery uses the system email transport only.

## Goals

- Make the surcharge feature flag reflect the current organization.
- Remove unsafe calendar provider placeholders while keeping unsupported providers explicit.
- Add platform-admin-controlled system email templates for billing lifecycle messages.
- Send billing lifecycle emails through system transport only.
- Make cleanup jobs delete old notification and audit-log records and report deleted counts.
- Preserve organization-level scoping and permissions for tenant data.

## Non-Goals

- Implement iCloud or CalDAV calendar sync.
- Let organization admins customize system billing emails.
- Add platform-admin email transport configuration in this pass.
- Redesign the whole email-template system.
- Change Stripe checkout or payment collection behavior.

## Architecture

Organization-scoped email templates remain unchanged and continue to serve tenant-customizable operational emails. A separate platform-level system email template model will store global templates controlled by platform admins. Billing lifecycle handlers render these platform templates and send them through the system email transport by omitting `organizationId` from `sendEmail`.

The calendar provider registry will only contain implemented providers. `google` and `microsoft365` stay registered. `icloud` and `caldav` remain valid provider enum values, but `getCalendarProvider` will fail clearly because no implementation exists.

Cleanup jobs will delegate to focused cleanup functions. Notifications already have `deleteOldNotifications`; audit logs need a small equivalent helper that deletes records older than the configured retention window using `auditLog.timestamp`.

## Components

### Sidebar Feature Flag

`apps/webapp/src/components/server-app-sidebar.tsx` should set `featureFlags.surchargesEnabled` from `currentOrganization?.surchargesEnabled ?? false`, matching the existing settings page and organization feature-card behavior.

### Calendar Provider Registry

`apps/webapp/src/lib/calendar-sync/providers/index.ts` should use a partial provider registry containing only implemented providers. `isProviderSupported` should return `false` for `icloud` and `caldav` without placeholder implementations. `getSupportedProviders` should continue returning only implemented providers for the UI.

### Cleanup Jobs

`apps/webapp/src/lib/cleanup.ts` should route:

- `expired_exports` to `cleanupExpiredExports()`.
- `old_notifications` to `deleteOldNotifications(90)`.
- `old_audit_logs` to a new audit cleanup helper with a conservative default retention, initially 365 days.

The cleanup functions should return deleted counts and log failures without exposing sensitive record details.

### Platform System Email Templates

Add platform system template keys for these billing lifecycle messages:

- `billing-trial-ending`
- `billing-subscription-paused`
- `billing-subscription-resumed`
- `billing-invoice-ready`
- `billing-payment-failed`

Platform system templates should be stored separately from `organization_email_template` in a new `platform_system_email_template` table. The table should include template key, subject, editor document, HTML, optional plain text, enabled state, editor user IDs, and timestamps. There is no `organizationId` column.

### Platform Admin Editor

Add a platform-admin section for system email templates using existing email-template editor patterns where practical. Access must be limited to platform admins. This page manages only platform system templates and should not show organization email templates.

### Billing Email Sender

Add a billing/system email sender service that:

- Receives a template key, recipient, and template data.
- Loads the platform system template override or a safe default template.
- Renders/interpolates template data.
- Calls the existing email service with no `organizationId`, ensuring system transport only.
- Logs send failures and returns a non-throwing result to webhook handlers.

Recipient resolution should prefer the Stripe customer email from the webhook object when present. If the event only contains a subscription ID, the handler should load the local subscription row, retrieve the Stripe customer when needed, and use that customer email. If no recipient email is available, delivery is skipped with a warning.

## Data Flow

1. Stripe webhook handler receives a lifecycle event.
2. Existing billing logic updates subscription state or metadata.
3. Handler resolves the relevant subscription/customer context and recipient email.
4. Billing email sender selects the platform system template key.
5. Renderer uses platform override or default template content.
6. Email is sent through system transport only.
7. Email failure is logged but does not roll back webhook state updates.

## Error Handling

- Missing recipient email skips delivery and logs a warning.
- Disabled platform system template skips delivery and logs debug metadata.
- Template render/send failures are logged and do not fail Stripe event processing.
- Calendar unsupported-provider errors should be explicit and deterministic.
- Cleanup failures should be logged and return `0` for that cleanup task rather than throwing from the worker entry point.

## Security And Multi-Tenancy

- Platform system templates are not organization-scoped and must be editable only by platform admins.
- Billing system emails use system transport only; organization email configs and organization template overrides are ignored.
- No Stripe secrets or customer payment details are stored in templates or logs.
- Email logs should mask recipient addresses, matching existing email sender behavior.
- Cleanup queries must use Drizzle query builders or parameterized SQL helpers.

## Testing

- Add/update a sidebar test showing `surchargesEnabled: true` is passed through.
- Add calendar registry tests for implemented providers and unsupported `icloud`/`caldav` behavior.
- Add cleanup tests covering notification cleanup and audit-log cleanup routing.
- Add billing email sender tests for template key selection, disabled templates, missing recipients, and system transport usage.
- Add platform-admin permission tests for system email template actions/pages.
- Add migration/schema tests or snapshots if this repo's Drizzle workflow requires them for the new table.

## Rollout Notes

- The platform system email template table requires a Drizzle migration with a journal `when` value later than all prior migrations.
- Default templates should be available in code so billing emails work even before a platform admin customizes them.
- Existing organization email template behavior must remain backward-compatible.
