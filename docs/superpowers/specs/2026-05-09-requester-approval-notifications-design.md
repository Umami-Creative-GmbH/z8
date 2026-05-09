# Requester Approval Notifications Design

## Summary

Add requester-facing notifications after final approval decisions and make the unified approval inbox the primary manager approval surface. Requesters should learn when their own request is approved or rejected, while managers should be guided toward `/approvals/inbox` for all approval triage.

## Goals

- Notify requesters after successful final approval decisions.
- Cover approved and rejected outcomes only.
- Keep notifications organization-scoped and preference-aware through the existing notification service.
- Promote `/approvals/inbox` as the canonical manager-facing approval inbox.
- Preserve source-domain approval rules, side effects, and requester destinations.

## Non-Goals

- No notifications for initial submission, pending state, withdrawal, cancellation, stale state, or conflict state.
- No new notification tables or delivery channels.
- No replacement of source-domain approval handlers with a new workflow engine.
- No cross-organization approval or notification aggregation.

## Approved Direction

Use domain-owned decision notifications plus inbox promotion.

Each approval source remains responsible for triggering requester notifications after its own approve or reject mutation succeeds. The unified approval action layer continues to route decisions to the owning approval handler. The handler or its existing notification trigger creates the requester notification with source-specific copy and a requester-facing `actionUrl`.

The unified approval inbox is promoted in manager-facing routes, links, and copy. Pending approval notifications for managers should link to `/approvals/inbox` instead of older approval routes where applicable.

## Architecture

### Requester Notifications

Approval handlers should create requester notifications only after a successful final decision.

The notification should include:

- `userId` for the requester, not the approver
- active `organizationId`
- an approved or rejected notification type matching the source domain where one already exists
- source entity type and entity id
- requester-facing `actionUrl`, such as `/absences` or `/time-tracking`
- concise title and message naming the decision and approver when available

Existing notification types already cover common approval outcomes, including absence and time-correction decisions. New approval types should add the smallest source-specific notification helper needed rather than introducing a generic notification payload that loses useful copy or routing context.

### Unified Inbox Promotion

The manager approval UX should treat `/approvals/inbox` as the canonical triage surface.

Promotion should happen through focused updates:

- manager pending-approval notification URLs point to `/approvals/inbox`
- approval page copy describes the page as the unified inbox for pending approval work
- manager-facing links that still target legacy approval routes should move to `/approvals/inbox` when they are intended for triage

This does not remove legacy routes unless they are unused and safe to delete in a separate cleanup.

## Data Flow

1. A requester submits an approval-producing item through a source domain.
2. A manager opens `/approvals/inbox` and approves or rejects the item.
3. The unified approval action path delegates to the source-domain handler.
4. The source-domain handler validates authorization, organization scope, and business rules.
5. The source-domain handler commits the decision mutation and any domain side effects.
6. After the mutation succeeds, the handler creates a requester notification through the existing notification service.
7. The notification service applies user preferences and creates in-app, push, email, or configured bot-channel notifications as appropriate.
8. The manager sees existing success or failure feedback in the inbox.
9. The requester sees the final decision notification in their notification bell and `/notifications` inbox.

## Error Handling

- If approval validation fails, no requester notification is created.
- If the approval item is stale, unauthorized, not found, or rejected by source-domain business rules, no requester notification is created.
- Notification delivery failures remain non-blocking and logged, matching the existing notification trigger pattern.
- Bulk decisions should notify only requesters for items that succeeded; failed items must not produce final-decision notifications.

## Authorization And Tenancy

All reads and writes stay scoped to the active organization.

The approval handler must use the requester identity from the organization-scoped source record or unified approval item. The notification service must receive the same organization id used for the approval decision. No approval decision should create notifications for users outside the active organization.

## User Experience

Requesters receive final decision updates in the existing notification surfaces. Notification copy should be short, specific, and actionable: what was decided, what request it was for, and who decided it when available. Clicking the notification should take the requester to the source page where they can understand the request outcome.

Managers continue to work from the unified approval inbox. The inbox should be described as the single place to review pending approval work across absence, time, shift, and travel-expense requests. Pending approval notifications and manager-facing entry points should reinforce that route.

## Testing And Verification

- Unit-test approve and reject paths that create requester notifications after successful decisions.
- Unit-test that failed, stale, or unauthorized decisions do not create requester notifications.
- Test bulk decisions create notifications only for successful per-item outcomes.
- Test manager pending-approval notification action URLs point to `/approvals/inbox`.
- Verify requester notifications appear in the existing `/notifications` inbox without changing notification storage.

## Implementation Boundaries

The first implementation should use existing notification infrastructure and source-domain approval handlers. It should not add schema changes unless a specific approval type lacks a usable notification enum and cannot reuse an existing source-specific type safely.
