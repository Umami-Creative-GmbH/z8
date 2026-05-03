# Implementation Checklist For New Customers Design

## Purpose

Create a guided implementation checklist for organization admins so new customer organizations can finish rollout setup with confidence during trials. The checklist reduces onboarding friction by showing the core configuration areas Z8 expects before a team starts relying on time tracking, approvals, payroll exports, and integrations.

This feature is separate from the platform-admin setup wizard. It is customer-facing, organization-scoped, and available only to organization admins inside the regular app settings area.

## Scope

Add a new organization-admin settings page at `/settings/implementation-checklist` and list it in the existing settings grid under the Administration group.

The first version is guide-only. It does not embed new setup forms or replace existing settings pages. Each checklist item explains the setup goal, reports current status, and links to the existing configuration page or import flow.

Checklist areas:

1. Organization structure
2. Holidays
3. Work policies
4. Approval rules
5. Payroll export and payroll readiness
6. Integrations
7. Notifications
8. First employee import

Out of scope for this version:

1. Platform-admin setup wizard changes
2. Inline configuration forms inside the checklist
3. Tenant-specific configuration via environment variables
4. New external integration setup flows

## Navigation And Access

The page lives at `/settings/implementation-checklist`. It uses the regular app settings route conventions and must not be reachable from platform-admin navigation.

Access rules:

1. Require an authenticated user.
2. Require an active organization context.
3. Require organization-admin-level settings access.
4. Filter every query by `organizationId`.

If no active organization exists, the page should use the existing empty or access-denied pattern rather than leaking any setup state.

## Status Model

The checklist uses hybrid status tracking.

Automatically detected items are complete when reliable organization-scoped data exists. Initial completion strategy:

1. Organization structure: manual completion, linked to organization/member settings.
2. Holidays: automatic completion when holiday preset assignment, custom holiday, or relevant holiday setup exists for the organization.
3. Work policies: automatic completion when at least one work policy or work policy assignment exists for the organization.
4. Approval rules: manual completion, linked to approval/change-policy settings.
5. Payroll export and payroll readiness: manual completion, linked to payroll readiness and export operation settings.
6. Integrations: automatic completion when at least one organization integration is configured or active.
7. Notifications: automatic completion when notification preferences or channel configuration exists where reliably detectable.
8. First employee import: automatic completion when employee records indicate more than the founding/admin employee, or existing import/manual creation signals show initial employees were added.

Manual checklist state is used for judgement-based items that cannot be inferred reliably, such as approval rules reviewed or payroll export reviewed.

Manual state is stored per organization and item id with:

1. `organizationId`
2. `itemId`
3. `status`, limited to `complete` or `incomplete`
4. `completedAt`
5. `completedByUserId`
6. `updatedAt`

The implementation should validate item ids against a server-side checklist definition before accepting manual updates.

## UI And Interaction

The page follows the existing settings/app visual language: restrained cards, clear status badges, practical copy, and direct actions.

The top summary shows overall progress, for example `5 of 8 setup areas complete`, plus a short operational prompt such as `Finish these setup areas before inviting the full team.`

Each checklist card includes:

1. Title and outcome-focused description
2. Status badge: complete, needs attention, optional/manual, or not started
3. Primary link to the existing settings or import destination
4. Manual `mark complete` or `mark incomplete` control only where manual completion is allowed
5. Helper text describing what Z8 checks for automatic completion

The layout must work on mobile and desktop. Mobile should prioritize the summary followed by a single-column task list. Desktop can use a two-column card layout if it remains readable and consistent with settings patterns.

## Architecture

Keep the feature small and isolated:

1. A checklist definition module describes item ids, labels, target routes, detection strategy, and whether manual completion is allowed.
2. A server-side loader resolves organization context, enforces org-admin access, computes inferred statuses, and merges manual state.
3. Minimal server actions update manual completion for the active organization only.
4. A small client component renders checklist cards and calls the manual completion action.
5. A database table stores manual checklist state by `organizationId` and `itemId`.

The checklist definition is the source of truth for valid item ids. Status detectors should be small functions that return conservative results and never infer completion from another organization.

## Data Flow

1. The settings page loads the current route context and active organization.
2. The server loader queries organization-scoped setup signals for each checklist item.
3. The loader reads manual checklist state for the same organization.
4. The loader merges inferred and manual state into display-ready item statuses.
5. The client component renders the summary and task cards.
6. Manual completion actions validate access, validate the item id, write org-scoped state, and refresh the page state.

Inferred completion takes precedence for auto-detected items. Manual completion is only shown and accepted for items whose definition allows it.

## Error Handling

If one status detector cannot determine completion, it should fail closed for that item as not started or needs attention. It must not mark the item complete.

Manual update errors should return a concise failure message and leave the existing state unchanged. Server actions must reject invalid item ids, missing organization context, and non-admin users.

The UI should avoid exposing internal database or permission details in error messages.

## Testing

Required coverage:

1. Unit tests for status resolution and manual/inferred merge behavior.
2. Access-control coverage for active organization scoping and non-admin rejection.
3. Server action tests for valid item ids, invalid item ids, and organization isolation where existing test patterns support it.
4. UI smoke coverage for complete, manual, and not-started states where practical.

Verification should use `pnpm test` or the narrowest relevant package test command available in the repo.
