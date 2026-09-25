# Project and category eligibility coordination (#315 / T50)

## Delivery and activation status

Settings mutations that change which projects and work categories a manual entry may book now
take **exclusive** organization configuration protection in their own transaction, before
their target validation and first dependent write. Fresh version-2 manual preparation (#308)
already holds the **shared** side of the same key, so each mutation and each submission is
ordered: a submission sees either the whole change or none of it.

The form's project choices and the authoritative check now read one eligibility rule.

Nothing activates in this slice. Fresh manual guarantees still wait for every configuration
writer (#311–#318), the transaction-bound billing recheck (#317) and the all-writer gate in
#327. The activation blockers are listed at the end and move to #327, #329 and #331.

Implementation references: [#315](https://github.com/Umami-Creative-GmbH/z8/issues/315),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697)
(§4 coordination, §5 writer inventory, §6 eligibility),
[#254](https://github.com/Umami-Creative-GmbH/z8/issues/254#issuecomment-5653344746) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
Inventory rows: C09 and C10 in `docs/audits/265-configuration-paths.md`.

## Protocol

`lib/time-tracking/work-transaction.ts`:

- `acquireExclusiveOrganizationConfigurationGuard(tx, organizationId)` (shared with #313) takes
  `pg_advisory_xact_lock` on `["work-organization-configuration", organizationId]`, the key
  whose shared side manual preparation takes at acquisition step 3.
- `withOrganizationConfigurationMutation(db, organizationId, write)` opens the writer's own
  transaction, takes the exclusive guard first, then runs `write`. Validation that decides
  whether the write is allowed runs inside `write`.

A configuration writer takes no adoption gate, approval gate, user guard or employee key, so
it never acquires an earlier-ranked resource late and never upgrades from shared.

## Participating writers

| Writer | Eligibility effect | Inside the protected transaction |
| --- | --- | --- |
| `settings/projects` `updateProject` with `status` (also `archiveProject`) | Bookable lifecycle | Organization-scoped update. Name/description/budget/customer-only updates stay unguarded |
| `addProjectAssignment` (team or employee) | Inserts an assignment that preparation may have found absent | Target team/active employee in the project's organization, duplicate check, insert |
| `removeProjectAssignment` | Revokes an assignment | Organization-scoped delete; a row that is already gone is `Assignment not found` |
| `settings/work-categories` `deleteOrganizationCategory` | Category activation and set contents | Soft delete of the active category and removal from every set, now in **one** transaction |
| `deleteWorkCategorySet` | Set activation, its assignments and contents | Soft delete of the active set, its assignments and contents in one transaction (they used to be three) |
| `updateSetCategories` | Set contents | Active set and categories in the organization, then delete and insert in one transaction (a failed insert used to leave the set empty) |
| `createSetAssignment` | Inserts an effective assignment that preparation may have found absent | Active set in the organization; team/employee in the organization; insert |
| `deleteSetAssignment` | Revokes an effective assignment | Organization-scoped soft delete of the active row |

`createSetAssignment` also rejects, before the transaction, a level that does not name exactly
its own target: an organization default with a team or employee, a team level without a team
or with an employee, and an employee level without an employee or with a team. An empty id
counts as none. Before this slice a set assignment could reference another organization's
team or employee.

Removals report `not found` when the row is already gone or already inactive (a repeated or
concurrent delete); before, they reported success.

Not participating, because they do not change current manual eligibility: `createProject` (a
new project has no assignment), project managers, `createOrganizationCategory` and
`createWorkCategorySet` (unassigned until an assignment or set-content write, which does
participate), `updateOrganizationCategory` (name, description, factor, colour),
`updateWorkCategorySet` (name, description) and `reorderSetCategories` (sort order).

## One eligibility meaning

`lib/time-tracking/project-eligibility.ts` owns the project rule: an active project of the
target's organization in a bookable status (`planned`, `active`, `paused`), assigned **within
that organization** to the target directly or to the target's team. Assignments have no
effective dates and none are invented.

- The form context (`listManualEntryProjectChoices` → `getAssignedProjectsWithHours`) lists
  the rule's projects.
- Authoritative preparation (`validateProjectAssignment`, on the manual transaction) accepts
  exactly what the rule accepts; its other reads only explain a refusal.
- Before, the form listed a project through an assignment row of the organization even when
  the project itself belonged to another organization; preparation refused it.

Categories already shared one rule (`getAvailableCategoriesForEmployee`: the current
effective set at employee → team → organization level, with organization predicates on
assignment, set and category). Preparation evaluates it at the attempt's one instant; the form
evaluates it at read time.

Selections: in a version-2 command `projectId` and `workCategoryId` are required keys. `null`
selects nothing and commits no allocation or category; a missing key is `invalid_command`.

## Committed replay

Replay precedes every fresh check (#308), so later eligibility changes do not reinterpret a
committed submission. The suite revokes both the project and the category after a commit and
replays the exact version-2 command and the exact legacy (unversioned) submission.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.manual-eligibility.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real settings server actions race the real public
`createManualTimeEntry` action on the label-owned disposable PostgreSQL 16 database. Only the
request/session (per call, through `AsyncLocalStorage`), SSO proof, billing provisioning,
notification delivery, audit log and Next cache are replaced. **27/27.**

Each of the ten mutations above (status, assignment removal, team and employee assignment
insertion where none existed, set contents removal and addition, category and set
deactivation, set assignment removal and insertion where none existed) runs in both arrival
orders:

- **Submission first.** The submission holds shared protection and waits on the employee
  key; the writer then waits for it. The submission commits under the old eligibility, the
  writer commits afterwards, and a fresh submission sees the change.
- **Mutation first.** A side connection row-locks what the writer changes, stopping it at its
  first dependent write, inside its transaction. The submission then waits on the guard,
  and after the writer commits it is decided by the new eligibility.

Also verified: foreign team, employee and project in project assignments and foreign team,
employee and set in set assignments are rejected with no rows; level/target mismatches are
rejected; another organization's project or category in a command is ineligible; the form
offers exactly the projects (direct, team, paused; not completed, inactive, unassigned or
foreign through an own-organization assignment row) and categories that submissions accept;
explicit null versus missing selections; version-2 and legacy replay after revocation. The
agreement test covers projects (direct, team, paused, completed, inactive, unassigned, foreign
through an own-organization assignment row) and categories (in the effective set, inactive in
the set, outside the set, foreign linked into the set), for the employee's own entries and for
the owner creating on the employee's behalf.

Mutation evidence: before the writers were changed (the red run of this suite), all 20 race
tests and the set-assignment reference test failed. In a separate mutation run, removing the
guard from the work-category writers failed their 12 race tests, and dropping the project's
organization predicate from the shared rule failed the form/preparation agreement test
(13 failures, nothing else).

The #308 suite (`clocking.manual-command.integration.test.ts`) still passes 27/27 with
preparation on the shared project rule.

### Database-free

- `actions/entry-helpers.test.ts`: `validateProjectAssignment` accepts exactly what the shared
  rule accepts and explains refusals; form choices come from the rule.
- `settings/projects/actions.tenant-security.test.ts`: the shared rule scopes project and
  assignment by organization.
- Existing settings scope tests unchanged.
- The approval write-boundary scanner (`approval-write-boundary.test.ts`) passes 290/290 in a
  Linux `node:24` container; these writes touch no protected approval table.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption), #329 (pilot) and #331 (rollback).

- **Import, demo and cleanup writers** of projects, assignments, categories, sets and set
  assignments (`lib/clockodo/import-orchestrator.ts`, `lib/import-review/committers.ts`
  `commitWorkCategory`, `lib/demo/demo-data.service.ts`, `lib/jobs/organization-cleanup.ts`)
  do not yet take the guard: #318.
- **Indirect eligibility changes**: moving an employee between teams, and deleting a team or
  employee (which cascades their project and set assignments), change eligibility without
  touching these writers. They belong to the organization authorization writers (#313) and
  cascade/cleanup (#318).
- **Other consumers** read the same rule without shared protection: live clock-in/out with a
  project or category, on-behalf clock-out, the HTTP time-entry API and the legacy manual
  path. Only fresh version-2 manual preparation is fenced.
- **Divergent readers not used by manual entry**: the settings action
  `getAvailableCategoriesForEmployee` (clock-out category dropdown) resolves assignments
  without effective dates or organization predicates, and `time-tracking/actions.ts` keeps a
  private copy of `validateProjectAssignment`. Neither decides manual eligibility.
- **Assignment expiry boundary**: category set assignments count as effective while
  `effectiveUntil >= instant` (inclusive); the change-policy resolution in manual preparation
  uses `>`. Unchanged here.
- **Old binaries** of the settings actions write without the guard; drain them before
  activation.
- Deployment, the scoped pilot and compatible rollback (#327/#329/#331). The guard is a
  transaction-scoped advisory lock with no schema change; rollback needs no data repair.
