# Platform Admin Billing Seat Controls Design

## Goal

Expose subscription seat reconciliation details in `/platform-admin/billing` and allow platform admins to sync a single organization's billable seat count to Stripe on demand.

## Table Columns

The billing table will show three seat-related columns per organization:

- `Licensed seats`: the locally stored subscription quantity, `subscription.currentSeats`.
- `Used seats`: approved non-demo members. This matches billable-seat eligibility: `member.status = "approved"` and linked `user.email` does not end with `@demo.invalid`.
- `Demo users`: members whose linked `user.email` ends with `@demo.invalid`.

The existing `Seats` column will be renamed to `Licensed seats` so the distinction is explicit.

## On-Demand Sync

Each subscription row will include a refresh icon button at the end of the row. The button will call a platform-admin-only server action or endpoint that runs `SeatSyncService.syncSeatsForOrganization(organizationId)`.

The action must:

- Require `BILLING_ENABLED=true`.
- Require an authenticated platform admin session.
- Sync only the requested organization.
- Return the synced billable seat count on success.
- Return a safe error message on failure.

The client button will show a pending state while syncing and refresh the page after a successful sync so `Licensed seats` reflects the new local value.

## Architecture

Keep the page server-rendered for the subscription table and add a small client component for the row-level sync button. This preserves the current page structure and limits client-side code to the interactive control.

Seat counts should be queried alongside subscriptions using organization-scoped aggregation. The count definition must match the centralized billing rule introduced for `SeatSyncService`.

## Testing

Tests should cover:

- The billing page source includes translated labels for `Licensed seats`, `Used seats`, and `Demo users`.
- The table renders a sync action column/button.
- The sync action rejects billing-disabled requests.
- The sync action rejects unauthenticated or non-admin requests.
- The sync action calls `SeatSyncService.syncSeatsForOrganization` for the requested organization and returns the new count.

## Scope

This change adds row-level sync only. It does not add a bulk “sync all” button because the periodic worker already reconciles all Stripe-backed subscriptions.
