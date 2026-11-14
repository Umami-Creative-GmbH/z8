# Employee Joining

Spec #1664, delivered in #1665–#1671. Read [Employee Offboarding](employee-offboarding.md)
for the way out and **Joining** in `apps/webapp/src/lib/organization/CONTEXT.md` for the term.

## Model in one paragraph

**Joining** starts at "this user now holds an approved membership in this organization" and owns
everything that follows: a new employee, a reactivation of one who was switched off, or nothing.
Each path still produces the member row its own way (Better Auth writes it for invitations and
organization creation), then calls joining **in the transaction that approves the membership**. A
failed joining rolls the membership back, so no member is committed without an employee. Joining
hands back an outcome and one after-commit step that the caller runs once its transaction committed.

## Where it lives

`apps/webapp/src/lib/employee-lifecycle/joining/`, beside deactivation and reactivation.

| File | What it holds |
| --- | --- |
| `joining.ts` | `joinOrganization(tx, input)`, the outcome, the after-commit step, `acquireJoiningLocks` |
| `invitation-draft.ts` | Loading the invitation draft, applying its values, first terms and personnel number, and the draft clean-up |
| `member-without-employee.ts` | `joinMemberWithoutEmployee`: joins a member with no employee row, never touches one who has a row |
| `backfill.ts` | The one-time backfill of members without an employee (#1671) |

The paths that join: invitation acceptance and organization creation (`lib/auth/organization-joining-hooks.ts`),
invite codes (`invite-code.service.ts`), pending-member approval (`pending-member.service.ts`), both SSO
sign-ins (`lib/auth/sso-organization-provisioning.ts`) and kiosk-only employees
(`lib/time-tracking/kiosk/kiosk-only-employee.ts`). `lib/auth` keeps only the hooks.

## Input

`joinOrganization(tx, input)` runs in the caller's transaction and never opens or commits one.

- `organizationId`, `userId` and the `membership` (`id` and Better Auth `role`).
- `teamId` (optional): the team to place a new or reactivated employee in when no invitation draft names one.
- `invitation` (optional): the invitation the membership comes from, for its draft. `{ id: null }` (a direct
  member add) finds the draft by the user's email. Absent: no draft.
- `actorUserId` (optional): the admin who brought the person in or back. A reactivation defaults to the user.

## Outcome

| Outcome | When | What joining writes |
| --- | --- | --- |
| `joined` | The user has no employee in the organization | A new employee, team placement, first terms and personnel number from the draft, the organization-wide team permissions for an owner or admin membership |
| `reactivated` | The employee was switched off and is back on the current roster after `reactivateOnReturn` | The draft's values (or the admin role for an owner or admin membership), placement, first terms, team permissions |
| `already_current` | The employee is on the current roster | Nothing: not the role, the team or permissions |
| `membership_only` | A former employee whose departure took effect | Nothing else. The draft is discarded with an audit entry saying it was not applied. Only a rehire brings them back |

The role rule: a new employee takes the draft's role when there is a draft, otherwise admin for an owner
or admin membership, otherwise employee. A reactivated employee takes the draft's values when there is a
draft, otherwise admin for an owner or admin membership, otherwise keeps the old role.

## After-commit step

`afterCommit.run()` runs once the caller's transaction committed:

1. forwards the audit entries joining recorded to the external audit service,
2. consumes the invitation draft (`draftCleanup`),
3. sends the seat signal (`syncBillingSeatsAfterMemberChange`, best effort; the hourly seat
   reconciliation is the safety net).

`run({ seatSignal: false })` skips the seat signal for an older membership, where no seat changed now.
The backfill and the switch-route net (`joinMemberWithoutEmployee`) both pass it: the member already
held the approved membership, and `countBillableSeats` already counts a member without an employee
while `EMPLOYEE_OFFBOARDING_RELEASE_READY` is off, so creating the missing employee row changes no
seat. Once the release requires an employee profile per seat, the hourly seat reconciliation picks up
the difference.
A failed after-commit step must not fail a committed sign-in or acceptance; callers log it.

## Locks

The order is the user guard, then the employee identity lock, then rows
(`docs/provisioning-cleanup-coordination-318.md`). `acquireJoiningLocks` takes both; they are
transaction-scoped advisory locks and re-entrant, so a caller that already holds them may call joining.

## Members without an employee

Before every path joined in the membership's transaction, the Better Auth paths could leave a member
without an employee, and three reads repaired them. Those repairs, the onboarding inserts and the
uncalled `employees.create` action are gone (#1671).

- **Backfill, once after the release:** `pnpm --dir apps/webapp employees:backfill-joining
  [--apply] [--organization-id <org-id>] [--json]` (`apps/webapp/scripts/backfill-member-employees.ts`).
  A dry run by default; it reports per organization the members it would join, or joined with `--apply`.
  It joins every approved member without an employee row, never touches an existing employee (so
  nobody deactivated is switched back on), applies no invitation draft and sends no seat signal. Each
  member joins in their own transaction; a second run joins nobody. See `deploy/README.md`.
- **The one remaining net:** `POST /api/organizations/switch` still joins a member who has no employee
  row, for one release, and logs the warning *Organization switch joined an approved member without an
  employee* whenever it creates one. Once that log stays silent, delete the net (follow-up ticket #1688).

## Who may create an employee row

`src/lib/employee-lifecycle/joining/employee-writers.test.ts` sweeps `src/` and `scripts/` and fails when
a file outside the allowed writers inserts into `employee` (Drizzle `.insert(employee)`, raw SQL or the
Better Auth adapter, also when the formatter splits the call across lines). Tests and their fixtures are
not scanned. The allowed writers, each with its reason in the test:

| Path | Why it may insert into `employee` |
| --- | --- |
| `src/lib/employee-lifecycle/joining/` | Joining owns what follows an approved membership. |
| `src/lib/employee-lifecycle/commands.ts` | Rehire brings a former employee back on a new employment period; it is not joining. Kept on the list as #1671 asks, so a rehire that writes the row needs no new exemption. |
| `src/lib/scim/` | SCIM is a second writer on purpose: the identity provider owns those employees (Organization ADR 0012). |
| `src/lib/demo/` | Demo seeding writes a sample organization's employees without real memberships. |
| `scripts/performance-fixture.ts` | Seeds a disposable performance-test database, never a tenant's data. |

A new path that gives a user a membership joins through `joinOrganization` instead of writing the row.

## Tests

- `joining.integration.test.ts`: the state matrix at the interface (no employee, current, deactivated,
  follow-up deactivation pending, departed), crossed with member role, team and draft.
- `backfill.integration.test.ts` and `backfill-cli.test.ts`: the backfill and its runner.
- `reactivation-paths.integration.test.ts` and each path's own suite: the path joins in its own transaction.
