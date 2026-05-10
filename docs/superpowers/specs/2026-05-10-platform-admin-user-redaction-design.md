# Platform Admin User Redaction Design

Date: 2026-05-10
Status: Approved
Owner: Platform Team

## Context

The platform admin users page at `/platform-admin/users` currently lists cross-tenant accounts and renders each user's full name, email address, profile image, role, status, creation date, and user actions. The backing `PlatformAdminService.listUsers` query selects full names and profile image URLs and supports searching by both name and email.

For DSGVO/GDPR-aligned data minimization, platform operators should not see full user names by default in this cross-tenant surface. The first pass focuses on default redaction without adding a reveal workflow or role hierarchy.

## Goals

- Redact full names by default in the platform-admin users view.
- Prevent full names from being selected and returned by the users list service.
- Remove name-based search from the platform-admin users list.
- Preserve existing operational workflows for searching by email, banning or unbanning users, and inspecting sessions.
- Document the privacy behavior in the platform admin guide.

## Non-Goals

- No reveal-full-name workflow.
- No role-based privacy hierarchy.
- No redaction of email addresses in this first pass.
- No redaction of session IP addresses, user agents, or session timestamps in this first pass.
- No organization-scoped behavior changes.

## Selected Approach

Use service-level minimization plus UI fallback.

`PlatformAdminService.listUsers` should stop selecting and returning raw `name` and `image` fields. The UI should render a non-identifying label derived from the user ID, such as `User 8f3a2c`, wherever the users list currently shows a full name. This keeps personal names out of the browser response and React Query cache, rather than relying on presentation-only masking.

## Architecture

### Service Contract

The `PlatformUser` list contract should represent only fields needed by the platform-admin users page:

- `id`
- `email`
- `emailVerified`
- `role`
- `banned`
- `banReason`
- `banExpires`
- `createdAt`

The list contract should not expose `name` or `image`. If a future workflow needs names, it must be designed as an explicit, audited access path rather than reusing the default list response.

### Users Page

The users table should keep the existing layout and actions. The user cell should display a deterministic redacted label and the existing email address. The avatar area should use the neutral fallback icon instead of loading profile images, because images are not required for account operations and can identify a person.

The ban dialog, toast messages, session action panel, and session revocation flows can continue to use email addresses and stable IDs. The selected scope is names-only redaction, so session metadata remains unchanged.

## Data Flow

1. `listUsersAction` verifies the requester is a platform admin through the existing `requirePlatformAdmin()` check.
2. `PlatformAdminService.listUsers` applies status filtering and email-only search.
3. The service selects only the minimized user fields.
4. The client renders redacted labels from stable IDs and never receives full names from this list action.

## Search Behavior

Platform-admin users search should match email addresses only. The service should remove `ilike(user.name, ...)` from the search predicate and keep `ilike(user.email, ...)`.

This prevents full names from being indirectly exposed through hidden search behavior, while preserving account lookup by email for support and operational workflows.

## Error Handling

No new user-facing error state is required. Existing authorization and database error behavior remains unchanged:

- Unauthorized requesters receive the existing platform-admin access failure.
- Database failures continue to return the existing `Failed to list users` error path.
- Empty search results continue to render the existing no-users-found state.

## Security And Privacy Notes

- Authorization remains mandatory before any platform-admin read.
- Queries continue to use Drizzle query builders rather than string-concatenated SQL.
- The implementation must not log full names or add full names to server action responses.
- The privacy improvement should happen at the service boundary, not only in JSX.
- No secrets or environment variables are involved.

## Testing Strategy

### UI Behavior

- Verify the users page renders a redacted user label such as `User abc123`.
- Verify a provided full name is not rendered in the users table.
- Verify the existing email value remains visible.

### Service Guardrails

- Verify `PlatformAdminService.listUsers` no longer selects `user.name` or `user.image` for the list response.
- Verify the search predicate no longer includes `user.name`.
- Verify platform-admin authorization remains in `listUsersAction` before listing users.

### Documentation

- Update the platform admin guide to state that user names are redacted by default in the cross-tenant users view for data-protection compliance.

## Acceptance Criteria

- `/platform-admin/users` does not display full user names.
- The users list server action does not return full user names.
- The users list service does not search by full name.
- Email-based search, status filtering, pagination, ban/unban, and session inspection continue to work.
- The platform admin documentation mentions default name redaction.
