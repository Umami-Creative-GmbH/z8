# Organization authorization mutations under configuration/access protection (#313 / T48)

## Delivery and activation status

Manual creation (#308) reads the actor's membership, employee role and access, direct reports,
team permissions and custom roles, plus the target's active and team state, while it holds the
shared organization configuration guard and the shared user configuration/access guards of the
actor and target. Until this slice, the settings writers of those facts took no guard. A
revocation could therefore commit between a submission's protected validation and its commit.
A multi-statement grant could also be half-visible to a submission.

Every application writer of those facts now takes the exclusive counterpart in its original
transaction, before its first dependent write. This participation is deployed unconditionally,
because the #264 activation gate for manual adoption requires it to be in place first. It
changes no outcome; it only orders a writer relative to in-flight submissions. Manual
adoption itself stays gated by `time_entry_append_control`, as in #308.

Implementation references: [#313](https://github.com/Umami-Creative-GmbH/z8/issues/313),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145). The
writer inventory follows rows C03–C06 of [the #265 audit](audits/265-configuration-paths.md).

## Protocol

`lib/authorization/authorization-mutation.ts` owns writer participation:

- `withAuthorizationMutation(scope, mutation, database)` opens one transaction, protects the
  scope, then runs the mutation in that same transaction.
- `protectAuthorizationMutation(tx, scope)` protects inside a transaction that the caller
  already owns (employee lifecycle).

The scope names the organization and the changed facts:

| Scope | Guard (exclusive) | Used for |
| --- | --- | --- |
| `organizationWide: true` | `["work-organization-configuration", organizationId]` | Custom-role permission replacement and deactivation, team deletion (cascades into employee teams and team permissions) |
| `employeeIds` / `userIds` | `["work-user-configuration-access", userId]`, sorted | Everything that changes one person's facts |
| `route(tx)` | Scope derived from current rows | Available for discovered scope; no adopted writer currently needs it |

The keys and hash seed are the ones `acquireOrganizationConfigurationGuard` and
`acquireUserConfigurationAccessGuards` take shared (`lib/time-tracking/work-transaction.ts`).
The exclusive counterparts `acquireExclusiveOrganizationConfigurationGuard` (shared with the
#311 timezone writer) and `acquireExclusiveUserConfigurationAccessGuards` live beside them, so
both sides build the key in one place.

Acquisition order matches #264 ranks 3–4: routing reads, then the organization guard, then the
sorted user guards, then routing runs again. Employee IDs resolve to users inside the
organization only. If the confirmed scope contains a user who was not protected, the
transaction rolls back and restarts, at most three attempts. A writer never locks that user
late. A scope that shrank while waiting is accepted, because extra protection is harmless.

Writers take nothing earlier-ranked afterwards. Protection comes before any lock a writer
already took:

- Employee lifecycle (`lockLifecycleScope`): user guard, then the employee coordination key,
  then the organization row. Before this slice, lifecycle took the employee key first. Adding
  the guard after it would have deadlocked against a submission, which holds the guard shared
  and waits on the employee key.
- Activation/deactivation (`setEmployeeLifecycleState`): user guard, then the organization row
  `FOR UPDATE`.
- Pending-member approval: member's user guard, then the employee identity lock.
- Team permissions: grantee's user guard, then the existing per-scope permission lock.

## Adopted writers

| Fact | Writer | Protection |
| --- | --- | --- |
| Direct reports (`employee_managers`) | `ManagerService.assignManager`, `removeManager` (settings `assignManagersAction`) | Employee and manager users. Removal now checks "last manager" inside the protected transaction. Both methods now derive and apply the organization. |
| Employee row (role, team, active) | `createEmployeeAction` (absent-row insert), `updateEmployeeAction` | New user / target employee's user |
| Target team | `addTeamMember`, `removeTeamMember` | Target employee's user. The membership and compatibility `employee.teamId` now commit together; removal re-reads the current team under protection. |
| Team existence | `deleteTeam` | Organization-wide. The "no members" check runs inside the protected transaction. |
| Active state | `deactivateEmployeeAction`, `reactivateEmployeeAction` | Target employee's user, before the organization row lock |
| Access, employment, managers on rehire | Departure schedule/revise/cancel/execute, due-departure materialization, rehire (all via `lockLifecycleScope`) | Target employee's user, before the employee key |
| Team permission flags | `PermissionsService.grantPermissions`, `revokePermissions` | Grantee's user |
| Custom-role assignment | `CustomRoleService.assignRole`, `unassignRole` | Holder's user |
| Custom-role grants | `CustomRoleService.setPermissions` (delete + insert, now atomic), `deleteRole` | Organization-wide |
| Employee role + org-wide flags from a template | `RoleTemplateService.applyTemplateToUser` | User. Role and flags now commit together. |
| Membership approval | `PendingMemberService` approval (`approvePendingMember`) | Member's user |

## Reviewed exclusions

These writers do not change a fact that manual creation reads, so they take no guard:

- `CustomRoleService.createRole`: a new role has no holders or grants.
- `CustomRoleService.updateRole`: name, description, colour and `baseTier`. `defineAbilityFor`
  does not consume `baseTier`. If a future ability rule does, this writer must join.
- Pending-member rejection: a pending membership grants nothing.
- Employment history, rate and own-profile updates: contract type, rate and personal fields
  only.

These writers change consumed facts but belong to sibling slices:

- **#314 (Better Auth and SCIM):** `auth.api.updateMemberRole` and `removeMember`, including
  `removeEmployeeAccessAction` and organization member management; SSO provisioning roles; SCIM
  lifecycle and projection reconciliation.
- **#318 (provisioning, import, demo and cleanup):** invite-code joins and auto-approval,
  onboarding, `organization-member-provisioning`, the demo employee generator and
  `delete-non-admin`, organization cleanup, and Clockodo import.
- **#312 (user-global access):** `user.role`, `banned` and `banExpires`, which
  `loadPrincipal` also reads.

## Scope preservation

Nothing in this slice changes who may create. `defineAbilityFor` is unchanged. The suite
re-proves the following:

- Organization owners and admins keep creation authority whatever their employee role.
- Managers keep direct-report scope only. Sharing a team grants nothing.
- An ordinary colleague is refused.
- A custom role cannot widen a manager's or employee's reach past the object guardrails.

## Verification

### PostgreSQL (2026-09-25)

`src/app/[locale]/(app)/time-tracking/actions/clocking.manual-authorization.integration.test.ts`
is registered in the runner script and in `tests.yml`. It drives the real
`createManualTimeEntry` against the real settings actions and departure commands on a
disposable PostgreSQL 16 database. Only the session (including SSO session admission), billing
provisioning, notification delivery and Next cache boundaries are replaced.

Each race pauses one side on a lock it takes after its protection. It then proves that the
other side waits on the exact guard key: the `pg_locks` classid/objid of that key's
`hashtextextended` value. Waiting on some other lock does not count.

| Race | Result |
| --- | --- |
| Manager-link revocation while an on-behalf submission is in flight | Revocation waits. The submission commits under the authority it validated. |
| Submission while a revocation is in flight | Submission waits, then is refused (`target_not_authorized`) with nothing written |
| Absent manager-link insertion while a submission for its target is in flight | Insertion waits (no row exists to lock). The new manager can create afterwards. |
| Team join for a non-report | Waits on the target's guard; the manager is still refused afterwards |
| Actor role demotion in flight | Submission waits, then is refused |
| Owner's employee-role change | Waits; the owner keeps authority; a colleague is refused |
| Target deactivation | Waits for the in-flight submission |
| Departure scheduling (`createProductionDepartureCommands`) | Waits on the target's guard, not the employee key |
| Custom-role permission replacement and deletion | Wait on the organization guard |
| Custom-role assignment and team-permission grant | Both wait on the holder's guard |
| Team deletion | Waits on the organization guard |

All 11 failed before the writers were adopted: no transaction ever waited on the guard. All
11 pass after. The full runner list then passed on the same database: 53 files and 969
tests, with 1 file skipped (the browser suite, which needs `Z8_TEST_CHROME_PATH` and is also
skipped in CI). That includes #308's manual-command suite and the employee lifecycle suites,
whose lock order changed.

### Database-free

- `lib/authorization/authorization-mutation.test.ts` (8) covers acquisition order, sorted
  guards, confirmation routing, restart and the attempt limit.
- Service and action unit fakes run protection as a pass-through and assert the requested
  scope: manager, permissions, lifecycle action and employee creation.
- Unit failures in the affected directories match a clean `dev` baseline exactly (17
  pre-existing, 0 new).

## Remaining activation blockers

1. Better Auth and SCIM membership, role and removal writers (#314) do not yet participate.
2. Provisioning, invite-code, onboarding, demo, cleanup and import writers (#318) do not yet
   participate.
3. User-global `role`, `banned` and `banExpires` writers: the platform-admin ban and unban
   participate since #312 ([record](user-configuration-access-312.md)); Better Auth's admin
   plugin endpoints are #314.
4. Old deployed binaries write these facts without protection. They must be drained or
   disabled before manual adoption activates (#327). New guards cannot fence old code.
5. `employeeHasOrganizationAccess()` evaluates a departure cutoff at database `now()`, not at
   the manual evaluation instant. A cutoff that passes between validation and commit is time,
   not a mutation, and no guard orders it. This needs an explicit decision in the manual pilot
   (#329).
6. `assignManagersAction` still applies a manager set as several protected transactions, one
   per link. Each transaction is atomic, but the set as a whole is not. A submission can
   observe an intermediate set, which mixes links from the old and the new selection.
7. Organization-wide protection (custom-role grants, team deletion) briefly pauses manual
   submissions across the organization. Production lock-wait observation belongs to the
   coordination verification in #327.
