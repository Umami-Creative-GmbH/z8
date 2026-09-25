# Provisioning, import, demo and cleanup configuration writers (#318 / T53)

## Delivery and activation status

The remaining inventoried writers of manual dependencies now either take the #264
configuration protection in their original transaction before their first dependent write,
or are retired. These are the provisioning/setup, reviewed-import setup, runtime demo, and
cleanup/cascade owners handed over by #312–#317. A fresh manual submission holds the shared
organization configuration guard (rank 3) and the shared user configuration/access guards of
its actor, target and routed participants (rank 4) while it reads those facts. So none of
these writes can now commit between a submission's validation and its commit.

Nothing activates in this slice. Manual v2 commands still run only in organizations with an
`active` append control row, and nothing in the application sets that. The writers take their
guards in every organization. The guards are transaction-scoped, so an administrator sees
only a short wait behind submissions already in flight. This slice adds no table, evidence
lifecycle or cleanup obligation.

Implementation references: [#318](https://github.com/Umami-Creative-GmbH/z8/issues/318),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
The inventory rows are C02–C05, C09–C11, C16–C19, R14, R15 and W16/W17 in
[the configuration-path audit](audits/265-configuration-paths.md) and its siblings.

User decisions (2026-09-25):

- The disabled direct Clockodo and Clockin orchestrators are **retired** (deleted), not
  migrated.
- Better Auth's organization update **refuses** `ssoRequiresApproval`. The setting has no
  other writer.

## Protocol

This slice adds no new lock. Every writer uses an existing helper:

- `acquireExclusiveOrganizationConfigurationGuard` (rank 3, #315/#316) for
  organization-wide facts: holidays, work categories, sets and their assignments, projects,
  change policies, and whole-organization deletion.
- `acquireExclusiveUserConfigurationAccessGuards` (rank 4, #313) for a user's facts:
  membership, employee existence, activity, role, team placement and grants. These are
  sorted, and are taken after any organization guard and before any identity lock, employee
  key or row lock.
- `withAuthorizationMutation` / `protectAuthorizationMutation` (#313) when the scope comes
  from current rows. The route runs before the guards and again under them. A user who
  appears in between makes the transaction throw `AuthorizationScopeChanged` and restart,
  up to 3 attempts. Nothing ranked earlier is ever locked late.
- `lib/demo/demo-configuration.ts` → `withDemoConfigurationMutation(organizationId, mutation)`
  is the one demo batch protection. It takes the organization guard exclusively, then the
  sorted guards of every employee's user in the organization, and confirms that set under
  protection. `mutation` receives exactly the confirmed employees. A demo writer therefore
  never writes a fact of a user it did not protect, and never an employee of another
  organization.

## Participation register

Each row names the retained entry point, how it participates, and the real acceptance
scenario in `clocking.manual-provisioning-cleanup.integration.test.ts` (**PG**) or in a
database-free test (**unit**).

### Provisioning and setup (C02–C04, C17, C19)

| Entry point → owner | Participation | Acceptance |
| --- | --- | --- |
| Invitation acceptance / member addition after-hooks (`lib/auth.ts`), `POST /api/organizations/switch`, the employee and team settings reconciliation (`ensureEmployeeProfilesForOrganizationMembers`) → `ensureEmployeeForOrganizationMember` | The user guard is the first statement of its transaction, before the identity lock, draft reads, employee create/reactivate/placement and the admin `team_permissions` grant | PG: joining another organization, a user-global change of the target's employees, waits for a parked submission and writes nothing meanwhile. Unit: guard → identity lock → reads → write |
| Invite-code redemption (`useCode`, `processPendingInviteCode`) → `redeemInviteCodeInTransaction`, including auto-approved codes that provision the employee | The user guard comes before the invite-code `FOR UPDATE` row lock and the identity lock | PG: waits for a parked submission while the invite-code row stays unlocked (`for update nowait`), then commits the approved membership and employee. Unit: guard statement precedes the row lock |
| Pending-member approval (`approvePendingMemberAtomically`) | Already under `withAuthorizationMutation` (#313) | #313's suite |
| Pending-member rejection (`reject`, `bulkReject`) → `rejectPendingMemberAtomically` | The user guard now comes before the identity lock and the member row lock. Before this, removal cleanup took it late, after both (a rank inversion) | PG: waits while the member row stays unlocked. Unit: guard → identity lock → member lock |
| Onboarding `updateProfile` and `setWorkSchedule` → employee find-or-create | One transaction under the user's guard. The Better Auth name update runs first; it is not a manual dependency | PG: creating the employee in the active organization waits, and no employee row appears before the guard |
| Demo employee generator → `generateDemoEmployees` | Each user, membership and employee commit together under the demo batch protection plus the new user's guard. Previously a failed insert left an orphaned user | PG: waits for a parked submission |
| SSO provider login → `provisionSsoProviderOrganization` | Already guarded (#314) | #314's suite |
| `ssoRequiresApproval` through Better Auth `/organization/update` | **Refused** in `beforeUpdateOrganization` (`ORGANIZATION_SSO_APPROVAL_PROTECTED`). No z8 writer offers the setting; the value set at creation (default `true`) stays in force | Unit: refused alone and with other fields, other updates admitted, installed in the hook |

### Reviewed imports (C10, C11, C17)

| Entry point → owner | Participation | Acceptance |
| --- | --- | --- |
| Import review commit worker → `commitAcceptedRowsForEntity` for `holiday`, `service` and `work_category` rows | Exclusive organization guard before the row claim, in the setup row's transaction. The #316 note that this committer held only the shared guard referred to the work-row transaction; setup rows held none | PG: a blocking holiday row commits after a parked submission, and a fresh submission is then `holiday_blocked`. The same wait holds for a work-category row. Unit: guard before claim |
| Work rows (`commitReviewedWorkRow`) | Unchanged: shared guards in `withReviewedImportTransaction` (#284). A work import is a work writer, not a configuration writer | #284's suite |

Reviewed setup commits dispatch only `absence`, `team`, `service`/`work_category`, `holiday`
and `surcharge`. `employee`, `work_policy`, `target_hours`, `holiday_quota` and
`absence_category` rows are held for mapping and are never committed.

### Runtime demo (C05, C09, C10, C13, W17, R14)

Every demo configuration writer runs under `withDemoConfigurationMutation`. The step actions
call each generator on its own, so each one participates individually.

| Owner | Writes | Acceptance |
| --- | --- | --- |
| `generateDemoTeams` | teams, employee team placement | PG: waits; never moves another organization's employee. Before this, a foreign `employeeIds` entry was moved into the demo team |
| `generateDemoProjects` | projects | PG: waits |
| `generateDemoWorkCategories` | categories, sets, set contents, organization and team set assignments | PG: waits |
| `generateDemoChangePolicies` | change policies, organization assignment | PG: waits |
| `generateDemoManagerAssignments` | manager relations | PG: waits. The owner is now resolved within the organization; before this, `findFirst` by user alone could pick the owner's employee in another organization |
| `clearOrganizationTimeData` | After the per-employee history deletion (#306, employee keys in their own transactions), one guarded batch deletes categories, sets, assignments, policies, locations, absences and allowances, removes team placement and manager relations, and deletes teams and projects | PG: parked on a demo team row after taking its guards, a fresh submission waits on the organization guard and then commits |
| `deleteNonAdminEmployeesData` | After lifecycles, absences and histories, one guarded batch removes manager relations, detaches audit rows, deletes employees (cascading their assignments), memberships and demo users (cascading their other memberships and settings). The batch acts only on employees in the set confirmed under protection, so a user who left the organization in the meantime is not deleted unguarded | PG: parked on a member row, an owner's submission waits and then commits; the other organization's employees are untouched |

### Cleanup and cascade (C18, R14)

| Entry point → owner | Participation | Acceptance |
| --- | --- | --- |
| `cron:organization-cleanup` → `permanentlyDeleteOrganization` | `withAuthorizationMutation`: exclusive organization guard plus the sorted guards of every member's and employee's user, routed and confirmed under protection, before the first delete. The cascade removes the subscription (#317), holidays, policies, eligibility and every membership | PG: waits for a parked submission, deletes only that organization, and the target user's employee in the other organization survives. **Changed-scope restart:** a user who joins while the cleanup waits makes it restart and wait on the newcomer's guard (held shared by the test) before deleting anything |
| Better Auth `/organization/delete`, member removal, `/organization/leave`, admin `remove-user` | Guarded by #314 | #314's suite |

### Retired: direct Clockodo and Clockin imports (W16)

`lib/clockodo/import-orchestrator.ts`, `lib/clockodo/mapper.ts`,
`lib/clockin/import-orchestrator.ts` and `lib/clockin/duplicate-detection.ts` are deleted,
with their tests. They had no caller: both actions already refused direct imports
("Direct Clockodo imports are disabled…"), and the reviewed-import adapters use only the
clients and types. Their two `SOURCE_WRITE_EXCEPTIONS` registrations are removed. The
helper-scoping scanner test now uses `clocking-core.ts`'s `insertEntry`.
`ImportUserMapping`, the disabled action's parameter type, moved to `lib/clockodo/types.ts`.
The disabled-action tests still pass unchanged. Raw provider payloads already imported stay
as historical evidence; no data changes.

### Reviewed exclusions: not manual dependencies

Manual preparation (#308) reads organization/employee/user timezone, organization holiday
blocking, project and category eligibility, change policies, billing, and the actor's and
target's membership, employee state, roles, team, managers and grants. These writers change
none of those:

- Reviewed-import `team` rows (a team created with no members or assignments), `absence`
  and `surcharge` rows, and `ensureAbsenceCategory`.
- Demo locations, shifts, absences, pending approvals and allowances. Demo time entries and
  corrections are work writers (#285/#301).
- Onboarding: `createOrganization` creates a brand-new organization in which no submission
  can be in flight (#314). Also excluded: holiday presets and their assignments (display
  calendar, #316), work policy templates, vacation allowance defaults, notification
  preferences and `canCreateOrganizations`.
- Platform setup (`setup.service.ts`): creates the first platform administrator with a
  fresh random ID and no organization. No submission can name or hold that user.
- `db/seed` (`work-policy-presets.ts`): global work-policy presets, run by operators only.
- Clockodo `saveUserMappings` (`clockodo_user_mapping`), invitation drafts (consumed by
  provisioning under its guard) and `storePendingInvitation` (`invitedVia`, #314).

### Operator surfaces and trial provisioning (R15, C16)

- `scripts/approval-workflow-rollout.ts` changes approval rollout modes under its own gate,
  and `scripts/approvals.ts` purges approval lifecycles (#306 R13). Neither writes a
  configuration fact that manual preparation reads.
- `scripts/obliterate-job-queue.ts` and `migrate-with-lock.js` write no organization, user
  or employee configuration. Queue obliteration can erase recovery evidence, and that stays
  an operational item for #327.
- `db/seed` writes only global work-policy presets (see above).
- Trial provisioning (C16) belongs to #317: `provisionLocalTrial` takes the exclusive guard
  when it must insert, and every work transaction reads billing without provisioning. The
  subscription row's cascade on organization deletion now runs under the organization
  guard (the cleanup row above).

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.manual-provisioning-cleanup.integration.test.ts`.
It is registered in `scripts/run-approval-workflow-repository-integration.sh` and in the CI
`integration-tests` job, and runs on the label-owned disposable PostgreSQL 16 database. The
real `createManualTimeEntry` action races each real owner. Only the request/session, billing
provisioning and seat sync, notification delivery and Next cache are replaced. Each caller
keeps its own identity through `AsyncLocalStorage`. Every wait is observed in `pg_locks`, on
real PostgreSQL locks. **17/17.**

- **Import, demo and cleanup writers (12 cases)** wait on the exclusive organization guard
  while a parked submission holds it shared. The submission commits on the prior
  configuration, and the writer commits afterwards: an imported blocking holiday then
  blocks a fresh submission. The two demo cleanups delete time history under employee keys
  first, so there the writer is parked on a row lock after taking its guards, and a fresh
  submission waits on the organization guard.
- **Provisioning writers (4 cases)** wait on the target user's guard. The member row and the
  invite-code row stay unlocked while they wait, and no employee row appears before the
  guard is taken (onboarding's former autocommit insert).
- **Tenant scope:** demo team generation leaves another organization's employee alone;
  organization cleanup and non-admin deletion leave the other organization's employees in
  place.
- **Changed-scope restart:** see the organization cleanup row.
- **User-global ordering:** the user guard is global. The provisioning cases run the writer
  in the other organization, and it still waits for a submission in this one.

Mutation runs, one at a time and reverted afterwards:

- Exclusive organization guard made a no-op: 12 fail (`Timed out waiting for …`). The
  provisioning and tenant cases do not depend on it.
- Exclusive user guard made a no-op: 5 fail, the 4 provisioning cases and the restart.
- Scope confirmation in `protectAuthorizationMutation` disabled: only the restart case
  fails.

### Approval write-boundary scanner

The scanner cannot read sources on Windows, so it ran in a Linux `node:24` container:
`approval-write-boundary.test.ts` passes **290/290**. The production inventory is unchanged
apart from the two retired registrations.

The full PostgreSQL runner list (66 files, including this suite) passes **1185 tests**; the 6
skipped are the browser suite.

The full unit suite has the same failure set as a clean `dev` worktree: 139 failures against
141, all of them the known Windows, CRLF and date-dependent set. The one name that differs
is the renamed scanner test, which fails on Windows like every scanner test and passes on
Linux.

### Database-free

- `import-review/committers.setup.test.ts`: work-category setup rows take the guard before
  the claim.
- `auth/organization-member-provisioning.test.ts`: user guard → identity lock → draft and
  employee reads → write.
- `effect/services/invite-code.service.test.ts`: the user-guard statement precedes the
  invite-code row lock.
- `effect/services/pending-member.service.test.ts`: user guard → identity lock → member lock.
- `jobs/organization-cleanup.test.ts`: organization and user guards precede the first delete.
- `auth/organization-sso-approval-update-guard.test.ts`: refusal and hook installation.
- `demo/demo-data.service.test.ts` and `effect/services/onboarding.service.test.ts` run the
  batches on their mocked clients.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption), #329 (pilot) and #331 (rollback).

- **Old binaries and tools.** A deployment still running pre-#318 code writes these facts
  without guards: provisioning, invite codes, onboarding, demo, the cleanup cron and any old
  build that still contains the direct import orchestrators. Drain or disable them before
  activation. Operator seed runs must not target adopted organizations.
- **Organization-wide pauses.** Demo generation and cleanup, and whole-organization
  deletion, hold the organization guard for their batch. The demo employee generator takes
  it once per generated employee, so generating N employees pauses the organization N
  times, each time briefly. Manual submissions in that
  organization wait for the batch, as they already do for #313's organization-wide writers.
  Administrator-facing latency under load is not measured.
- **Restart limit.** A scope that keeps changing fails the demo batch or the organization
  deletion after three attempts. That takes a user joining on every attempt; only the single
  restart is exercised.
- **Not raced on PostgreSQL:** a submission in another organization against the
  cross-organization cascade of a deleted demo user (the global user guard is shown by the
  provisioning cases), `setWorkSchedule` (same guarded pattern as `updateProfile`),
  `bulkReject` (same transaction as `reject`), the reconciliation and switch callers of
  `ensureEmployeeForOrganizationMember` (same owner), and `processPendingInviteCode` (same
  redemption transaction as `useCode`).
- **SSO approval refusal** rejects any update payload that carries the key, even with an
  unchanged value. No z8 caller sends it.
- **Observation, outside manual dependencies:** organization cleanup deletes
  `water_intake_log` and `push_subscription` rows for every employee user of the deleted
  organization (#306), including users who still belong to other organizations.
- The retired orchestrators' `CLOCKODO_IMPORT_QUERY_CHUNK_SIZE` and
  `CLOCKODO_IMPORT_CONCURRENCY` environment settings are now unused. They are left in `env.ts`,
  so that deployment configuration does not have to change together with this slice.
