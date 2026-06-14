# Suspended Employee Seat Billing Design

## Goal

Suspended employees should stop counting as paid seats while their historical records remain available to authorized admins and managers.

This extends the employee suspension/reactivation behavior with consistent billing semantics across local subscription state, Stripe subscription quantities, checkout quantities, reconciliation jobs, and billing display.

## Current Context

- `SeatSyncService` currently counts approved Better Auth organization members, excluding demo users.
- `SubscriptionService` has a separate member-counting query with the same approved-member semantics.
- The current suspension behavior sets `employee.isActive = false` and revokes app access, but it does not remove Better Auth organization membership.
- Because seats are counted from approved members today, a suspended employee still counts as billable.
- Stripe subscription quantity is updated through `SeatSyncService.syncSeatsForOrganization` with `proration_behavior: "create_prorations"`.
- Billing code is guarded by `BILLING_ENABLED`; local seat state should still remain coherent when Stripe is disabled.

## Billing Policy

A billable seat is an approved, non-demo organization member whose user has an active employee profile in the same organization.

In query terms, a user counts as billable when all of these are true:

- `member.organizationId` matches the organization.
- `member.status = "approved"`.
- `user.email` does not match `%@demo.invalid`.
- An `employee` row exists with matching `employee.userId`, matching `employee.organizationId`, and `employee.isActive = true`.

Suspended employees do not count as billable seats. Reactivated employees count again once `employee.isActive = true`.

## Architecture

Create one shared billing-seat counting helper and use it from both seat sync and subscription reads. This prevents drift between checkout/trial quantities, displayed `currentSeats`, scheduled reconciliation, and Stripe updates.

The helper should live in billing code, not employee settings code, and should expose a focused function such as `countBillableSeats(organizationId: string)`. It should be organization-scoped and should not include inactive employee records.

Update these consumers to use the helper:

- `SeatSyncService.syncSeatsForOrganization`.
- `SeatSyncService.getCurrentSeatCount`.
- `SubscriptionService.getByOrganization`.
- `SubscriptionService.ensureLocalTrial`.

Any other subscription creation or checkout path that computes initial seats should continue to flow through `SubscriptionService` or the shared helper.

## Suspension And Reactivation Flow

After a successful suspension or reactivation, employee lifecycle actions should trigger seat synchronization for the organization.

Suspension flow:

1. Require org-admin employee settings access.
2. Set `employee.isActive = false` with an organization-scoped update.
3. Revoke app access through `AppAccessService`.
4. Revalidate employee caches.
5. Trigger billing seat sync for the organization.

Reactivation flow:

1. Require org-admin employee settings access.
2. Set `employee.isActive = true` with an organization-scoped update.
3. Restore web app access through `AppAccessService`.
4. Revalidate employee caches.
5. Trigger billing seat sync for the organization.

If billing is disabled or Stripe is not configured, the lifecycle action should not fail only because external Stripe sync is unavailable. Local seat count should still be updated where the existing billing services support it. Stripe reporting should continue to follow existing `SeatSyncService` behavior.

## Stripe Behavior

Seat changes should keep using Stripe Billing subscription quantities. No new Stripe API surface is needed.

When billing and Stripe are enabled, suspension decreases the subscription item quantity and reactivation increases it. Existing `proration_behavior: "create_prorations"` remains the default so customers receive Stripe's normal proration handling.

No payment method, Checkout, or Customer Portal behavior changes are required.

## Audit And Reconciliation

Seat audit records should include lifecycle-driven changes. The existing audit actions are member-focused, so add explicit lifecycle action names or otherwise distinguish suspension/reactivation from Better Auth member add/remove events.

Recommended audit actions:

- `employee_suspended`
- `employee_reactivated`

The scheduled billing seat reconciliation job should naturally converge Stripe and local state because it calls `SeatSyncService.syncSeatsForOrganization`, which will use the active-employee seat definition.

## UI

The employee lifecycle UI should communicate the billing effect:

- Suspension confirmation copy should mention that the employee stops consuming a paid seat.
- Reactivation copy should mention that the employee will count as a paid seat again.

The billing page does not need a new control. Existing seat counts should update through query invalidation or normal refresh after lifecycle mutations.

## Error Handling

- Employee lifecycle state changes must not be partially blocked by a transient Stripe failure after the employee has already been suspended or reactivated.
- Billing sync failures should be logged with `organizationId`, target `employeeId`, lifecycle action, and whether Stripe reporting was attempted.
- If local seat count update fails, return an action error only if the employee lifecycle update has not yet been committed. Avoid presenting the employee as suspended while billing-local state is known to be inconsistent unless there is a clear recovery path.
- Scheduled reconciliation remains the recovery mechanism for Stripe quantity drift.

## Testing

Add or update tests for:

- Billable seat counting excludes inactive employees.
- Billable seat counting still excludes demo users and non-approved members.
- `SubscriptionService` and `SeatSyncService` use the same active-employee definition.
- Suspension triggers seat sync with an `employee_suspended` audit entry.
- Reactivation triggers seat sync with an `employee_reactivated` audit entry.
- Stripe quantity updates use the new seat count when billing is enabled.
- Lifecycle actions still succeed when billing is disabled.
- UI copy mentions paid-seat impact in suspend/reactivate states.

## Out Of Scope

- Removing Better Auth organization membership on suspension.
- Adding a separate billable-seat override flag.
- Changing Stripe prices, Checkout setup, Customer Portal setup, or tax settings.
- Introducing usage-based billing or Metronome.
- Backfilling historical invoices or issuing manual credits beyond Stripe's normal proration behavior.
