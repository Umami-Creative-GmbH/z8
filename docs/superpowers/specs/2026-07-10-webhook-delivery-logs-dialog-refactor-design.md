# Webhook Delivery Logs Dialog Refactor Design

## Goal

Split the webhook delivery logs dialog into a focused feature folder without changing its public behavior.

## Structure

Move the dialog to `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/`:

- `index.tsx` renders the action panel and composes the feature pieces.
- `use-webhook-delivery-logs.ts` owns pagination, request lifecycle, stale-response handling, retries, and expanded-row state.
- `delivery-logs-table.tsx` renders the table and maps deliveries to rows.
- `delivery-log-row.tsx` renders an expandable delivery and its request/response details.
- `delivery-status-badge.tsx` maps a delivery status to its translated badge.
- `delivery-logs-pagination.tsx` renders pagination controls and the shown range.

The existing dialog test moves into the feature folder. All imports use the folder entry point; the former standalone component file is removed.

## Data Flow

`index.tsx` supplies the webhook ID and open state to the hook. The hook invokes the existing server action, returns the current deliveries, pagination state, loading/error state, and callbacks. Presentation components receive only the data and callbacks they need. The current request cancellation and sequence checks remain in the hook so stale responses cannot replace the active webhook/page result.

## Behavior And Testing

No translation keys, server actions, data types, UI states, pagination behavior, timezone formatting, retry behavior, or accessibility semantics change. The existing tests remain valid after their import path is updated and continue to cover pagination, stale responses, retryable errors, and pagination reset when the selected webhook changes.
