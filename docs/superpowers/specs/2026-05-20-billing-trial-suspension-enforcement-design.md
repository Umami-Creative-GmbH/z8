# Billing Trial Suspension Enforcement Design

## Summary

When `BILLING_ENABLED=true`, each organization gets full product access for a 14-day trial starting at organization creation. After the trial, the organization must have a valid Stripe-backed subscription to continue using the app. Organizations without valid access enter a suspended state that blocks normal org pages and org-scoped mutations while keeping billing recovery available.

When `BILLING_ENABLED` is false or unset, existing self-hosted/default behavior remains unchanged: no trials are created, billing UI remains hidden or disabled, and all product features remain available.

## Goals

- Give each billing-enabled organization 14 days of full access without requiring a credit card.
- Allow admins to enter payment details during the trial through Stripe Checkout.
- Communicate clearly that payment starts after the trial expires.
- Enforce suspension after expired trial, invalid subscription, unpaid subscription, or actual Stripe cancellation.
- Keep billing recovery reachable while preventing normal app usage for suspended organizations.
- Protect org-scoped mutating API routes and server actions from direct bypasses.
- Use localized `t()` strings for all new user-facing UI text.

## Non-Goals

- Do not redesign pricing or plans.
- Do not build an in-app payment form; Stripe Checkout remains the payment flow.
- Do not change default behavior when billing is disabled.
- Do not solve the broader seat-counting mismatch between Better Auth members and active employees unless needed for checkout quantity correctness.
- Do not merge billing suspension with platform-admin manual organization suspension.

## Current Context

Billing is already partly implemented around these modules:

- `apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.ts`
- `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`
- `apps/webapp/src/lib/effect/services/billing/stripe.service.ts`
- `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts`
- `apps/webapp/src/app/api/billing/checkout/route.ts`
- `apps/webapp/src/app/api/billing/webhook/route.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx`
- `apps/webapp/src/components/billing/billing-page-client.tsx`
- `apps/webapp/src/db/schema/billing.ts`

The existing enforcement service can report access state, but enforcement is not broadly wired into app page access or org-scoped mutations. Existing docs describe read-only behavior after subscription failure, but the desired behavior is a hard suspended state with only billing recovery accessible.

## Billing Access Model

`BillingEnforcementService` becomes the single source of truth for billing access. Its result should be derived from the organization-scoped `subscription` row and current time.

Allowed states:

- Billing disabled: always allowed.
- `trialing` with `trialEnd` in the future: allowed.
- `active`: allowed.
- `active` with `cancelAt` or `cancel_at_period_end=true`: allowed until Stripe reports `canceled`.

Suspended states:

- No usable subscription/trial state when billing is enabled.
- `trialing` with expired `trialEnd`.
- `past_due`.
- `unpaid`.
- `incomplete` or `incomplete_expired`.
- `canceled`.
- Unknown subscription status.

The service should expose:

- A read-friendly access check for banners, billing page status, and recovery UI.
- A strict page/access guard for server components.
- A strict mutation guard for API routes and server actions.

All guards must be organization-scoped. They should use the authenticated session's active organization ID or an explicitly authorized organization ID verified through existing membership/CASL patterns. Client-provided organization IDs must not be trusted on their own.

## Trial Lifecycle

When billing is enabled, a new organization starts a 14-day local trial at organization creation. This should not require a Stripe customer, Checkout session, payment method, or subscription.

Existing organizations on deployments that later enable billing should get a lazy 14-day trial on first authenticated organization request if they have no billing record. This avoids immediately locking out existing customers and avoids requiring a one-off backfill before rollout.

Lazy trial creation must be idempotent. If two requests race, only one trial row should be created for the organization. The `subscription.organizationId` unique constraint should remain the database-level protection.

Local trial rows should use the existing `subscription` table with:

- `organizationId` set.
- `status="trialing"`.
- `trialStart` set to the trial start time.
- `trialEnd` set to 14 days after the trial start time.
- `stripeCustomerId` nullable until the organization starts Stripe Checkout.

The existing schema should be migrated so `stripeCustomerId` can be null. A local trial is not a Stripe customer, and trial access should not depend on creating or faking Stripe identifiers.

## Page Enforcement

The `(app)` layout should enforce billing access after session and locale checks. If billing is disabled, it does nothing. If billing is enabled and the active organization is allowed, it renders the normal app shell.

If the active organization is suspended, normal product pages redirect to a billing recovery route. The only app route that remains reachable is billing/upgrade. Auth routes such as sign-out remain usable through existing auth behavior.

Admins and owners can use billing recovery to start Stripe Checkout. Non-admins see a suspended message telling them to contact an organization admin.

The billing route itself must avoid redirect loops. It should be explicitly exempt from the suspended-page redirect while still checking whether the user is allowed to manage billing before showing upgrade actions.

## Mutation Enforcement

Org-scoped mutating API routes and server actions should call a shared billing mutation guard before performing changes. Reads do not need separate API blocking in this design because suspended users cannot browse normal app pages, but mutation endpoints must be protected against direct requests.

Representative examples include time entries, absences, approvals, organization settings, schedules, employee/team management, imports, exports that create records, and other actions that create, update, delete, approve, reject, or submit org data.

Billing APIs required for recovery remain allowed:

- Checkout session creation.
- Customer portal creation where appropriate.
- Subscription status reads.
- Stripe webhook processing.

Mutation guard failures should return a billing-specific forbidden response or typed action error. They should not crash with generic unhandled errors.

## Trial Banner And Recovery UI

The main app layout should show a compact trial banner when all conditions are true:

- Billing is enabled.
- The active organization is in a valid trial.
- The trial has not expired.

The banner should show remaining days and an upgrade button. Its copy should clearly explain that admins can add payment details now and the paid subscription starts after the trial. The banner appears below the main header and above page content.

All new user-facing strings in React UI must use the existing Tolgee `t()` pattern. This includes banner copy, button labels, suspended messages, billing page updates, and UI-surfaced API errors. No new hardcoded English strings should be introduced in React components.

Suspended recovery UI should be focused and hard to bypass:

- Admins/owners see the reason for suspension and a path to billing/Checkout.
- Non-admins see a localized explanation that the organization is suspended and an admin must update billing.
- Normal product navigation should not provide a route around suspension.

## Stripe Checkout Flow

Stripe remains the payment system of record for paid subscriptions. Starting Checkout during trial should:

- Reuse an existing Stripe customer if one exists.
- Create a Stripe customer if needed.
- Attach `organizationId` metadata to the customer, Checkout session, and subscription.
- Create a subscription Checkout session.
- Collect payment details through Stripe Checkout.
- Preserve the remaining local trial duration so paid billing begins after the existing trial expires.

Checkout should not grant a fresh 14-day Stripe trial every time. It should use the remaining local trial duration. If an admin starts Checkout on day 13, Stripe should receive roughly one remaining trial day, not a new 14-day trial.

If Checkout is started after local trial expiry, Stripe should require payment immediately and access should only resume once Stripe reports a valid active subscription.

The z8 billing UI should communicate before redirecting that the trial continues and payment starts after expiry. Stripe-hosted copy may be limited by Stripe Checkout, so the in-app copy is the primary communication point.

## Webhook And Cancellation Handling

Webhook processing continues to verify Stripe signatures and process events idempotently through the existing billing events service.

Access decisions after Stripe events:

- `active`: allowed.
- Valid `trialing`: allowed.
- `past_due`, `unpaid`, `incomplete`, `incomplete_expired`: suspended.
- `canceled`: suspended immediately.
- `cancel_at_period_end=true` while status remains `active`: allowed until Stripe later reports `canceled`.

This means portal cancellation does not suspend at schedule time unless Stripe changes the subscription status to `canceled`. This matches the desired behavior of suspending only when Stripe reports actual cancellation.

Webhook logic should continue to update the existing organization-scoped `subscription` row rather than creating duplicate rows. Metadata from Stripe must be treated as linkage data from server-created Checkout sessions, not as a replacement for organization authorization in app requests.

## Existing Org Rollout

Rollout behavior when `BILLING_ENABLED=true` is turned on:

- Existing org with active/trialing Stripe subscription: access follows Stripe-backed row.
- Existing org with no billing row: create a 14-day local trial lazily on first authenticated org request.
- Existing org with expired trial or invalid subscription: suspended.
- Billing disabled: no trial creation and no enforcement.

Lazy trial creation should be observable in logs so operators can confirm rollout behavior.

## Seat Sync

Current checkout and seat sync count Better Auth `member` rows. Existing docs say each active employee counts as a seat and deactivated employees are excluded. This mismatch is a known gap.

This design keeps seat sync mostly out of scope. The implementation should avoid making the mismatch worse and should preserve current behavior unless checkout quantity requires a minimal correction. A separate design should address canonical seat counting if needed.

## Error Handling

Page-level behavior:

- Trialing and active orgs render normally.
- Suspended normal app pages redirect to billing recovery.
- Billing recovery avoids loops and shows role-appropriate content.

API/action behavior:

- Billing disabled: allow.
- Missing active organization: keep existing no-org behavior.
- Suspended organization: return a billing-specific forbidden result.
- Database or Stripe failures: log with organization ID where safe and return an appropriate generic error to the user.

Webhook behavior:

- Invalid Stripe signature: return `400`.
- Known idempotent duplicate event: return success.
- Processing failure: log and return a retriable failure so Stripe can retry.

## Testing

Unit tests should cover:

- Billing disabled always allows access and does not create trials.
- New billing-enabled org creates a 14-day local trial.
- Existing org without billing row gets a lazy 14-day trial on first request.
- Valid trialing org is allowed.
- Expired trial is suspended.
- Active subscription is allowed.
- Scheduled cancellation while status is active is allowed.
- `canceled` is suspended immediately.
- `past_due`, `unpaid`, `incomplete`, and unknown statuses are suspended.
- Checkout uses remaining trial days instead of resetting to 14 days.

Route and component tests should cover:

- Trial banner appears with remaining days for trialing orgs.
- Trial banner strings use localized translations.
- Normal app pages redirect for suspended orgs.
- Billing route remains reachable for suspended orgs.
- Admins/owners can see upgrade actions.
- Non-admins see contact-admin suspended copy.

API/action tests should cover representative org-scoped mutations returning a billing forbidden result when suspended.

Webhook tests should cover `canceled` suspension, scheduled cancellation staying allowed, and active/trialing updates.

## Documentation Updates

Update billing docs to reflect:

- New organizations get a 14-day full-access trial only when billing is enabled.
- No card is required to start the trial.
- Admins can add payment details during trial through Stripe Checkout.
- Paid subscription begins after the trial expires.
- After expired trial or invalid subscription, the org is suspended rather than read-only.
- Actual Stripe `canceled` status suspends immediately.
- Scheduled cancellation remains active until Stripe reports `canceled`.

## Approval Notes

Approved design decisions:

- Suspended orgs get hard-blocked from normal app access, not read-only mode.
- Trial starts on organization creation only when `BILLING_ENABLED=true`.
- Checkout during trial collects payment details and starts paid billing after trial expiry.
- Cancellation suspends only when Stripe reports status `canceled`.
- Suspended access remains limited to billing/upgrade and sign-out.
- Existing orgs without billing rows get a lazy 14-day trial when billing is enabled.
- Enforcement covers page access plus org-scoped mutating API routes and server actions.
- All new UI strings must use `t()`.
