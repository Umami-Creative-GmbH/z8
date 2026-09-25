# Holiday and change-policy mutation coordination (#316 / T51)

## Delivery and activation status

Every writer of the organization holiday, blocking-category and change-policy facts that
manual preparation (#308) reads now takes the organization configuration guard
**exclusively** before its first read or write, and holds it until its transaction
commits. A fresh manual submission holds the same guard **shared** while it reads those
facts, so a configuration change can no longer commit between a submission's validation
and its commit.

Nothing activates in this slice. Manual v2 commands still run only in organizations with
an `active` append control row, and there is no application setter for it. The writers
take the guard in every organization. The guard is transaction-scoped, so the only
behavioral change for an administrator is a brief wait behind in-flight submissions.
There is no new table, evidence lifecycle or cleanup obligation.

Implementation references: [#316](https://github.com/Umami-Creative-GmbH/z8/issues/316),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#254](https://github.com/Umami-Creative-GmbH/z8/issues/254#issuecomment-5653344746),
[#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
The inventory rows are C11–C13 in [the configuration-path audit](audits/265-configuration-paths.md).

## Protocol

`lib/time-tracking/organization-configuration-guard.ts` owns the rank-3 key
`["work-organization-configuration", organizationId]`:

- `acquireExclusiveOrganizationConfigurationGuard(tx, organizationId)` takes
  `pg_advisory_xact_lock(hashtextextended(key, 0))`.
- `mutateOrganizationConfiguration(client, organizationId, mutation)` opens the writer's
  transaction, takes the exclusive guard first, then runs the mutation on that
  transaction.

`work-transaction.ts` takes the shared guard with the same key. Configuration writers take
nothing ranked earlier (no adoption or approval gate), so the #258 order holds: they never
upgrade from shared to exclusive and never acquire an earlier-ranked resource late.

## Participating mutation owners

| Owner | Mutation | Now |
| --- | --- | --- |
| `POST /api/org-admin/holidays` | Insert holiday | Category check and insert under the guard |
| `PATCH /api/org-admin/holidays/[id]` | Dates, category, recurrence, activation | Existence, category check and update under the guard |
| `DELETE /api/org-admin/holidays/[id]` | Soft delete | Guarded update; `returning` decides 404 |
| `POST /api/org-admin/holidays/import` | Insert holidays, possibly a new "Public Holidays" category | Guard replaces the route's own `holiday-import:<org>` lock, which it subsumes |
| `settings/holidays` `deleteHoliday`, `bulkDeleteHolidays` | Hard delete | Guarded delete; `returning` decides not-found |
| `settings/holidays` `deleteCategory` | Soft delete when unused | Existence, in-use check and update in one guarded transaction; the in-use read and the update gained their missing organization predicates |
| `POST /api/org-admin/holiday-categories` | Insert category | Guarded insert |
| `PATCH /api/org-admin/holiday-categories/[id]` | `blocksTimeEntry`, activation and other fields | Guarded update; `returning` decides 404 |
| `DELETE /api/org-admin/holiday-categories/[id]` | Soft delete | Guarded update; `returning` decides 404 |
| `settings/change-policies` `createChangePolicy`, `updateChangePolicy`, `deleteChangePolicy` | Policy values and activation | Guarded insert/update |
| `settings/change-policies` `createChangePolicyAssignment` | Effective assignment insertion, with `effectiveFrom`/`effectiveUntil` | Guarded insert. The policy must now be an active policy of the organization, and a team or employee target must belong to it (`ValidationError` otherwise) |
| `settings/change-policies` `deleteChangePolicyAssignment` | Assignment deactivation | Guarded update |

**Retired:** `ChangePolicyService.createPolicy`, `updatePolicy`, `deletePolicy`,
`assignPolicy` and `unassignPolicy` in `lib/effect/services/change-policy.service.ts` had
no caller. They are removed with their input types, so the service only reads.

**Not in scope, because manual preparation does not read them:** holiday presets
(`preset-actions.ts`, `/api/org-admin/holiday-presets`) and holiday/category
assignments. These are the employee/team-assigned calendar semantics, which manual blocking
deliberately does not substitute for the organization-level check.

**Handed to other slices:**

- #318: the retained Clockodo import (`lib/clockodo/import-orchestrator.ts`, holiday and
  category inserts), the reviewed-import holiday committer (`lib/import-review/committers.ts`),
  demo policy setup and cleanup (`lib/demo/demo-data.service.ts`), and whole-organization
  cleanup (`lib/jobs/organization-cleanup.ts`).
- #313 (team facts) and #318 (cascades): `settings/teams` `deleteTeam` cascade-deletes a
  team-level assignment and sets `employee.team_id` to null. The action refuses a team that
  still has members, so in consistent data no employee resolves a policy through a deleted
  team.
- Employee hard deletion cascades employee-level assignments, but only demo and cleanup
  paths do it (#318).

## Preserved semantics

Manual preparation is unchanged. This slice verifies it against the real writers:

- Organization-level blocking: active holidays in active, blocking categories of the
  organization. Occupied local dates in the effective zone are half-open, so an end at
  local midnight does not occupy the next date.
- Change policy: organization-scoped and active, with the assignment effective and not
  yet expired at the one evaluation instant (`effectiveFrom <= at < effectiveUntil`).
  Precedence is employee, then team, then organization. More than one candidate at the
  deciding level fails as `policy_ambiguous`.
- Inclusive calendar-day age at the same instant in the effective zone. Only the
  manual-only age-based `forbidden` is converted into approval. The generic change-policy
  service is unchanged.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.manual-holiday-policy.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. It runs on the label-owned disposable PostgreSQL 16 database.

The real `createManualTimeEntry` action races the real route handlers and settings
actions. Only the request/session, billing provisioning, notification delivery and Next
cache are replaced. Each concurrent caller keeps its own identity through
`AsyncLocalStorage`. Writers and submissions are paused with real PostgreSQL locks, not
mocked transactions. **24/24.**

- **Every mutation owner waits for in-flight submissions (15 cases).** A submission is
  parked on its employee key while it holds the shared guard. The writer must then wait on
  the exclusive guard (observed in `pg_locks`). The submission commits on the prior
  configuration, the writer commits afterwards, and a fresh submission sees the change.
  - Holiday outcomes: created or moved to the date → blocked; soft/hard deleted →
    unblocked; imported → blocked; category made blocking → blocked; category
    deactivated → unblocked.
  - Policy outcomes: trust updated to strict → approval; the employee's trust policy
    deactivated so the organization's strict policy decides → approval; organization
    assignment inserted → approval; employee assignment deleted → approval.
- **A submission arriving during a mutation waits and reads the commit.** A created
  blocking holiday, an inserted employee assignment and a deleted assignment. Each writer
  is parked on a row lock after taking the guard; the submission waits on the guard and
  then reflects the committed change.
- **Fresh restart:** a submission needs approval on the strict policy and restarts to
  route participants. A policy change queued behind it commits before the second attempt
  can take the shared guard. The second attempt evaluates freshly and executes directly,
  with no approval request.
- **Committed replay:** after a holiday blocks the date, or after the policy stops
  requiring approval, an exact retry returns the original committed result
  (`disposition: replayed`, including the original approval participation) without
  writes. A fresh command gets the new outcome.
- **One evaluation instant:** an employee assignment created through the real action
  with `effectiveFrom` at Berlin midnight does not apply at 23:59:59.999, when the entry is
  from today. At 00:00 it applies, and the same instant makes the entry one day old. An
  `effectiveUntil` at midnight applies until 23:59:59.999 and not at 00:00.
- **Organization scope:** assignment creation refuses another organization's policy,
  another organization's employee and an inactive policy, and writes nothing.

Mutation: with the exclusive guard made a no-op, all 19 coordination tests fail
(`Timed out waiting for …`). The 5 replay, instant and scope tests do not depend on the
guard.

### Database-free

- `app/api/org-admin/holidays/route.test.ts` and `[id]/route.test.ts`: the guard runs
  first, inside the writer's transaction.
- `app/api/org-admin/holidays/import/route.test.ts`: imports serialize per organization on
  the guard key, and different organizations proceed independently.
- `settings/holidays/actions.behavior.test.ts` and `settings/change-policies/actions.scope.test.ts`:
  deletes and policy creation take the guard.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption), #329 (pilot) and #331 (rollback).

- **Other configuration writers** (#311–#315, #317, #318) must participate before the
  manual guarantees hold against every fact preparation reads. For this slice's facts that
  means the import, demo and cleanup writers listed above (#318).
- **Old binaries:** a deployment still running pre-#316 code writes holidays and policies
  without the guard. Drain them before activation.
- **Policy ambiguity** still cannot be produced in the database: the partial unique
  indexes allow one active assignment per organization default, team and employee. The
  explicit `policy_ambiguous` failure is covered by construction only.
- **Not verified here:** administrator-facing latency under a long queue of submissions.
  The guard is held only for the length of a submission transaction.
