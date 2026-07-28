# Employee Invitation And Lifecycle Integrity Design

## Summary

The employee directory currently treats an invitation attempt as an employee draft. Resending an expired invitation cancels the old Better Auth invitation, creates a new invitation, and creates another draft. Better Auth retains canceled invitations, and the directory intentionally lists drafts for every invitation status, so invitation history appears as duplicate employees.

This design makes a draft represent one future employee within one organization, independent of how many invitation emails are sent. It also defines safe draft deletion, organization-scoped employee suspension, and history-preserving removal of organization access.

## Goals

- Show at most one row for a person in an organization's employee directory: one pending draft or one real employee.
- Preserve draft edits across expired invitation resends.
- Consume the draft after successful employee provisioning.
- Repair existing duplicate and stale drafts safely.
- Let owners and admins delete drafts that have not produced employees.
- Let owners and admins deactivate and reactivate employees explicitly.
- Let owners remove organization access while preserving all employee history.
- Revoke organization access reliably without affecting the user's other organizations.
- Enforce organization scoping and approved-member permissions for every lifecycle action.

## Non-Goals

- Do not hard-delete active or historical employee records.
- Do not delete global Better Auth users when organization access is removed.
- Do not remove invitation history from Better Auth.
- Do not affect memberships or access in other organizations.
- Do not redesign the full employee or member management experience.

## Root Cause

`employee_invitation_draft` is unique only by `invitationId`. The resend UI first cancels an invitation and then calls the normal invitation creation action. Better Auth cancellation changes the invitation status to `canceled` but does not delete the row, so the draft's cascade-delete foreign key does not run. A replacement invitation receives a new ID and therefore a new draft.

The employee directory then joins and returns every organization draft without filtering invitation status, expiration, duplicate email, or an existing employee. Invitation acceptance copies draft data into an employee but deliberately retains the accepted draft. Three invitation attempts can consequently produce three draft rows plus one active employee row.

Employee deactivation has separate integrity problems. It currently changes only `employee.isActive`, leaves organization-active sessions alive, and does not prevent all membership-based settings access. Routine organization switching can call provisioning that reactivates an inactive employee, so deactivation is not durable.

## Core Invariants

1. An organization has at most one invitation draft for a normalized invitee email.
2. A directory identity is represented by either a pending draft or an employee, never both.
3. Invitation history is not employee history and does not appear as employee rows.
4. Resending an invitation does not reset prepared employee data.
5. Only explicit acceptance/re-addition or an authorized reactivation action may reactivate an inactive employee. Routine reads, reconciliation, and organization switching may not.
6. Employee removal preserves business and audit history.
7. Every lifecycle lookup and mutation includes `organizationId` and verifies the actor's approved organization membership and permission.

## Draft Identity And Schema

Add a normalized invitee email field to `employee_invitation_draft`. Normalize with trimmed lowercase email semantics at the server boundary and during migration. Add a database unique constraint on `(organizationId, normalizedEmail)` while retaining the unique invitation relationship.

The draft remains linked to the current Better Auth invitation for acceptance and status checks. When Better Auth issues a replacement invitation ID, the existing draft is relinked rather than copied. The draft ID remains stable so existing detail URLs continue to work.

The normalized email is app-owned identity data, while the current display email and invitation status continue to come from Better Auth's invitation row.

## Invitation Creation And Resend

Invitation creation resolves the organization and normalized email before creating the invitation. After Better Auth returns the current invitation, the action upserts the draft by `(organizationId, normalizedEmail)` and attaches that invitation ID.

For an existing draft, resend must preserve all prepared employee fields. Only invitation-controlled defaults that were never edited may be initialized. Resend uses Better Auth's `resend: true` behavior instead of the UI's cancel-then-create sequence. If Better Auth reuses the invitation, the draft link stays unchanged. If an expired invitation causes Better Auth to create a replacement, the same draft is relinked to the replacement invitation.

The server owns this flow. The client invokes one resend action and does not independently cancel an invitation. This avoids partial client-side sequencing and allows semantic errors to be handled consistently.

Invitation lookup semantics must match Better Auth: a pending invitation is actionable only while `expiresAt` is in the future. Expired rows whose database status remains `pending` do not block replacement invitations.

## Directory And Draft Editing

The employee directory returns drafts only when their current invitation is pending, unexpired, and no real employee exists for the same normalized organization email. Canceled, rejected, accepted, and expired invitation records remain available in invitation management but never appear as employees.

Draft update and detail actions apply the same eligibility checks. A stale or consumed draft is not editable. Queries retain defense-in-depth filters even after the database uniqueness constraint is added.

Managers continue to see only real employees. Draft visibility and mutation remain restricted to the organization-admin settings access tier.

## Invitation Acceptance

After Better Auth accepts an invitation and creates the organization member, provisioning loads the organization-scoped draft through the accepted invitation and normalized identity. It creates or explicitly reactivates exactly one employee and applies the prepared fields.

After the employee exists, the draft is deleted. Invitation history remains intact. If draft deletion fails after successful provisioning, the accepted draft is hidden by query rules and can be removed by an idempotent cleanup retry. Acceptance must not create a second employee when provisioning is retried.

Routine member reconciliation may create a missing employee profile but must not reactivate an existing inactive profile. Organization switching must use this non-reactivating behavior. Reactivation during invitation acceptance is permitted because acceptance or re-addition is an explicit lifecycle event.

## Existing Data Repair

The migration repairs drafts organization-by-organization before adding the unique constraint.

For each normalized organization email:

- If a real employee already exists for that email, delete all matching drafts.
- If one or more actionable pending invitations exist and no employee exists, retain one draft.
- Choose the most recently edited draft as the source of prepared employee fields.
- Link the retained draft to the newest actionable pending invitation.
- Delete all other drafts for that organization/email.
- If no actionable pending invitation exists, delete the stale drafts.

The migration must be deterministic and idempotent. It must not edit the generated `auth-schema.ts` file. A new Drizzle migration receives a journal timestamp greater than every existing migration.

## Draft Deletion

Owners and admins can permanently delete a draft because no employee history exists yet.

The server action:

1. Resolves the actor's approved active-organization membership and permission.
2. Loads the draft and invitation with `organizationId` in the predicates.
3. If the current invitation is actionable, cancels it through Better Auth.
4. Deletes the organization-scoped draft only after cancellation succeeds.
5. Invalidates employee and invitation queries.

If cancellation fails, the draft is retained and the action returns a user-safe error. Stale non-actionable drafts can be deleted directly. A draft that has already produced an employee is treated as consumed and cannot delete or alter the employee.

## Employee Deactivation And Reactivation

Deactivation is an organization-scoped suspension that retains membership. Owners and admins may deactivate employees, subject to self-protection and owner safety rules.

Deactivation:

- Sets the organization-scoped employee to inactive.
- Revokes sessions whose active organization is the affected organization.
- Prevents the employee from switching into or using that organization while inactive.
- Prevents membership-only settings access in that organization while inactive.
- Writes the existing durable employee-deactivation audit event.
- Does not alter global app-access flags because those affect other organizations.
- Does not change billing membership unless billing policy is separately changed.

Reactivation is explicit, permission-checked, organization-scoped, and audited. It restores organization access without creating another employee record.

## Remove Organization Access

"Remove access" is the safe employee deletion/offboarding operation selected for employees with historical data. Only owners may perform it.

The action passes the actual Better Auth member ID, not the user ID, to `removeMember`. Better Auth removes the membership and enforces final-owner protection. The organization hook marks matching employee records inactive, revokes organization-active sessions, and synchronizes billing seats. Time entries, absences, balances, approvals, employment history, and audit records remain intact.

The action does not delete or disable the global user and does not affect other organization memberships. Re-inviting and accepting later may explicitly reactivate the preserved employee record and apply the current draft.

## Authorization And Safety

- All reads and writes include `organizationId`, including final update/delete predicates.
- Actor membership must have `status = approved`.
- Existing CASL/settings-access helpers are preferred over new ad hoc role checks.
- Owners can remove organization access and manage lifecycle state.
- Admins can manage draft and employee active state but cannot remove members or change ownership.
- Users cannot remove or deactivate themselves through these controls.
- The last owner cannot be removed or demoted.
- Invitation and draft operations validate that the invitation belongs to the same organization.
- Server errors do not expose internal database or authentication details.

## UI Behavior

Employee directory and detail views expose context-appropriate actions:

- Pending draft: edit, resend invitation, or delete draft.
- Active employee: deactivate or remove access when authorized.
- Inactive employee with membership: reactivate or remove access when authorized.
- Inactive employee without membership: retain historical details; re-invitation is the path to restore membership.

Destructive or access-changing actions use confirmation dialogs with explicit wording. The UI says "Remove access" rather than "Delete employee" for historical employees. Draft deletion explains that the pending invitation will be canceled.

The Members view calls the same lifecycle actions as the employee views. Mutations roll back optimistic state for both thrown errors and resolved `{ success: false }` results. Successful actions invalidate member, employee-list, employee-detail, invitation, and other lifecycle-dependent query caches as applicable.

## Error Handling And Recovery

- Invitation draft upserts are idempotent by organization and normalized email.
- A failed app-owned draft update after Better Auth invitation creation is logged with organization and invitation IDs but no sensitive data; a subsequent list/send operation can repair the link.
- A failed invitation cancellation does not delete its draft.
- Provisioning retries return the existing organization employee rather than inserting another.
- A failed post-provisioning draft cleanup cannot expose a duplicate because accepted drafts are excluded from employee queries.
- Session revocation and removal hooks remain idempotent so partial failures can be retried safely.

## Testing Strategy

Implementation follows test-driven development. Regression tests first reproduce each broken behavior.

Server and data tests cover:

- Three expired/resend cycles produce one stable draft.
- Edited draft fields survive resends and replacement invitation IDs.
- Invitation creation and resend normalize email consistently.
- The database rejects a second draft for the same organization/email.
- Different organizations may invite the same email independently.
- Accepted, canceled, rejected, and expired drafts do not appear in the employee directory.
- Acceptance creates or explicitly reactivates one employee and consumes the draft.
- Provisioning and reconciliation retries do not duplicate or implicitly reactivate employees.
- Existing duplicate migration fixtures retain the correct draft data and remove stale rows.
- Draft deletion is organization-scoped, permission-checked, and cancellation-first.
- Employee deactivation revokes organization-active sessions and survives organization switching.
- Explicit reactivation restores organization access.
- Remove access passes a member ID, preserves employee history, and revokes organization membership.
- Approved membership, self-protection, and final-owner rules are enforced.
- Audit and billing side effects occur only for the corresponding lifecycle operations.

UI tests cover:

- Correct actions and labels for pending drafts, active employees, and inactive employees.
- Confirmation dialog behavior.
- Optimistic rollback on semantic and thrown failures.
- Correct cache invalidation after successful lifecycle changes.
- Owner/admin capability differences and current-user protections.

## Success Criteria

- Repeated invitation expiry and resend never creates duplicate employee-directory rows.
- An accepted invitee appears exactly once as an active employee.
- Existing duplicate drafts are repaired without losing the selected canonical prepared data.
- Authorized users can delete drafts, suspend/reactivate employees, and remove organization access.
- Deactivated employees cannot regain access through organization switching or reconciliation.
- Removed employees lose organization access while all historical records remain available to authorized administrators.
