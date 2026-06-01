# Billing Seat Reconciliation Design

## Goal

Keep Stripe subscription quantities aligned with Z8 billable seats, including cases where members are created outside Better Auth hooks such as demo data generation, imports, scripts, or future direct database paths.

## Billable Seat Definition

A billable seat is an organization member that meets both conditions:

- The member is approved: `member.status = "approved"`.
- The linked user is not demo data: `user.email` does not end with `@demo.invalid`.

Pending, unapproved, and demo users do not count toward Stripe quantity.

## Architecture

Seat counting should be centralized in `SeatSyncService`. Both real-time hooks and periodic reconciliation must call the same service method so there is only one billing definition.

`SeatSyncService.syncSeatsForOrganization` and `SeatSyncService.getCurrentSeatCount` will use a joined `member` and `user` query that counts approved non-demo members for the target organization. This keeps existing hook-based updates correct without adding separate filtering logic in each member-creation path.

## Reconciliation Job

Add a worker cron job named `cron:billing-seat-reconciliation`.

The worker must only run billing reconciliation when `BILLING_ENABLED=true`. In environments where billing is disabled, the job should not update subscription rows or call Stripe.

The job will:

- Find organizations with subscription rows that have a real `stripeSubscriptionId`.
- Run `SeatSyncService.syncSeatsForOrganization` for each organization.
- Continue processing other organizations if one sync fails.
- Return a summary with processed count, synced count, skipped count, and per-organization errors.
- Return a skipped result when billing is disabled.

The job should run hourly with low operational priority. Real-time hooks remain the primary update path; the cron job is a safety net for drift caused by direct database writes or missed hook execution.

## Data Flow

1. A member is created, removed, approved, or otherwise changed.
2. Existing real-time sync paths call `SeatSyncService` when available.
3. `SeatSyncService` computes the current billable count using the centralized eligibility query.
4. The local subscription row is updated with the billable count.
5. If Stripe billing is enabled and the organization has a Stripe subscription, Stripe subscription quantity is updated.
6. The hourly reconciliation job repeats the same sync for all Stripe-backed subscriptions to correct drift.

## Error Handling

Real-time member hooks keep non-blocking behavior: billing sync failures are logged but do not prevent member provisioning.

The reconciliation job records each failed organization in its result and continues processing the rest. A failed cron execution should be visible through the existing cron execution tracking if the entire job crashes before returning a result.

## Testing

Tests should cover:

- Approved non-demo members count as billable.
- Pending members do not count.
- Demo users with `@demo.invalid` emails do not count.
- `syncSeatsForOrganization` uses the billable count when updating local and Stripe quantities.
- The reconciliation job syncs only subscriptions with `stripeSubscriptionId` and continues after per-organization failures.
- The reconciliation job skips all work when `BILLING_ENABLED` is not `true`.
- The cron registry includes `cron:billing-seat-reconciliation` with the expected schedule and processor.

## Scope

This design does not add a UI control for manual reconciliation. Existing cron execution tracking and logs are sufficient for this change.
