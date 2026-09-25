# Organization timezone changes and balance rebuilds (#311 / T46)

## Delivery and activation status

Changing the organization timezone now takes exclusive organization configuration
protection. In an organization whose `time_entry_append_control` row is `active`, the zone
commits together with a durable balance-rebuild intent, and the rebuild runs separately.
Every other organization keeps the previous behavior: the zone and a full reset of its
balances in one transaction. That transaction now also runs under the exclusive guard.

Nothing activates in this slice. There is no application setter for the append control,
and the same row gates the other #264 writers. The activation blockers are listed at the end
and move to #327, #329 and #331.

Implementation references: [#311](https://github.com/Umami-Creative-GmbH/z8/issues/311),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697)
(section 5, "Explicit timezone rebuild correction") and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Mutation paths

| Path | Participation |
| --- | --- |
| Settings, `updateOrganizationTimezone` (owner only) | `changeOrganizationTimezone` in `lib/timezone/organization-timezone-change.ts` |
| Better Auth `POST /organization/update` with `data.timezone` (the field is `input: true`) | Refused by `beforeUpdateOrganization` (`lib/auth/organization-timezone-update-guard.ts`). It could not join the protection, and it also bypassed the owner-only rule. Name, slug, logo and metadata updates are unchanged |
| Organization creation (onboarding, Better Auth create) | Not a mutation of existing configuration: a new organization has no employees or submissions. Provisioning is #318 |
| Organization deletion | The intent cascades with the organization. Other cleanup paths are #318 |

No other code path writes `organization.timezone`.

## Writer transaction

`changeOrganizationTimezone` acquires, in the #258 order, and never reaches back:

1. The shared `["completed-work-adoption", organizationId]`, then the append control under it.
2. The exclusive `["work-organization-configuration", organizationId]`. Manual preparation
   holds this guard shared, so a change waits for in-flight submissions, and new submissions
   wait for the change.
3. The actor's shared `["work-user-configuration-access", userId]`.
4. The `organization` row `FOR NO KEY UPDATE`, the mode the previous plain `UPDATE` took.
   `FOR UPDATE` would also block the key-share locks that every insert referencing the
   organization takes. A balance refresh holds its work-balance lock while inserting period
   rows, and the legacy reset waits on that lock, so the stronger mode could deadlock.

Under that protection it revalidates the actor as an approved owner whose employee record,
if any, is active, and it returns `unchanged` when the zone is already set. Otherwise it
updates the zone and, once adopted, inserts one `work_balance_rebuild_intent` row
(`reason = organization_timezone`, `requested_by`, `requested_at`) in the same transaction.
It takes no employee coordination, work-balance or balance-row lock, and it does not
discover the employee scope.

The action checks authorization and zone validity first, as before. After the commit it
runs `processWorkBalanceRebuildIntents({ organizationId })` for that organization. A
failure there is logged and left on the intent: the action still reports the save as
successful. The settings card then says that work balances are being recalculated
(`organization.timezone.balances-recalculating`, all 12 `organization` locales).

## Rebuild execution

`lib/work-balance/rebuild-intents.ts`, `processWorkBalanceRebuildIntents`, handles each
organization with pending intents (oldest first) in its own transaction:

1. It claims the organization's intents with `FOR UPDATE SKIP LOCKED`. A concurrent worker
   skips them and does not rebuild twice.
2. It routes the complete scope at execution: every employee of the organization, sorted by
   ID. Employees created after the change are included. Employees of other organizations,
   including the same user's record elsewhere, are not.
3. For each employee, under the established `work-balance:<org>:<employee>` lock, it applies
   the existing full-rebuild reset (period rows deleted, reset marker written).
4. It re-reads the scope. If the scope changed, it rolls back and restarts, at most three
   times.
5. It deletes the claimed intents. Intents committed after the claim stay pending for the
   next run.

Lock order is the intent rows, then the sorted work-balance locks, then the balance and
period rows. The balance worker takes the same work-balance lock before the same rows.
Writers that mark a balance dirty take only its row. Nothing here takes a configuration,
employee or organization lock.

Process loss rolls the transaction back and leaves the intents pending. On failure the
intent records `attempts`, `last_attempt_at` and the database's own message in
`last_error`, without the failed statement or its parameters. The `cron:work-balance` job
(every three hours) runs `processWorkBalanceRebuildIntents` before selecting its refresh
batch. This recovers failed or lost rebuilds, and the same run then recomputes the reset
balances.

## Consumer freshness

A pending intent means that none of the organization's stored projections is current. The
projections may still look clean, because they were computed in the old zone.

- `getEmployeeWorkBalance` returns `null` and `getEmployeeWorkBalances` returns no entries
  (the intent is checked before the rows are read: a rebuild deletes its intent in the
  transaction that resets the rows, so a later row read is never an old-zone projection)
  for that organization. These are the reads behind the time-tracking summary card, the
  calendar balance and the team list. `null` is the state these consumers already show as
  "Not calculated yet" for reset markers, so a pending rebuild and a completed reset look the
  same until the refresh recomputes the balances.
- `listEmployeesForWorkBalanceBatch` leaves such organizations to the rebuild, so the batch
  does not partially refresh a projection that is about to be reset.

New manual submissions do not use projections. They read the committed zone under the
shared guard as soon as the change commits, even while the rebuild is still pending.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/settings/organizations/organization-timezone.integration.test.ts`.
It is registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real public `updateOrganizationTimezone` and
`createManualTimeEntry` actions, the real balance reads and batch selection, and the real
`runWorkBalanceRefresh` job all run on the label-owned disposable PostgreSQL 16 database.
Only the request/session, SSO session store, billing provisioning, notification delivery
and Next cache are replaced. **14/14.**

- Atomic save: the zone and the intent commit, and the post-commit rebuild resets exactly
  the organization's employees. The same user's employee in another organization is
  untouched.
- Failed intent write (injected trigger): the save fails, the zone is unchanged, and no
  balance changes.
- Failed rebuild (injected trigger): the save is reported as successful and the zone is
  committed. The intent stays pending with `attempts = 1` and the database message. After
  recovery, `runWorkBalanceRefresh` consumes the intent and recomputes every balance in
  the same run.
- An unchanged zone creates no rebuild work. Before adoption, the reset stays inside the
  save, so its failure fails the save.
- Protection: a change waits while shared organization protection is held (an in-flight
  submission). A submission started while the change holds exclusive protection waits for
  it, then gets `reconfirmation_required / zone_changed` for the old zone. A new-zone
  submission commits with the New York offset (`-240`, 08:00 local = 12:00Z) while the
  rebuild is still pending.
- No late or foreign locks: while the employee coordination and work-balance locks are held
  elsewhere, the save still commits; only the separate rebuild waits.
- Lock mode: a save neither waits for nor blocks a key-share lock on the organization row,
  the lock that an insert referencing the organization takes.
- Authorization: a non-owner is refused with no writes. An owner demoted while the change
  waits on the actor's access guard is refused under protection.
- Routed scope: an employee created after the commit and before the rebuild is included.
- Worker process loss: while one worker is parked on a work-balance lock, a concurrent
  worker claims nothing. Terminating the parked backend rolls back its partial resets,
  leaves the intent pending (`attempts = 2`), and the retry completes.
- Stale consumers: with the stored rows still clean, the single and team reads hide them
  and the batch skips the organization, while another organization's balance stays
  visible. After the reset, the reads still show nothing until the refresh.

The whole runner file list passed on the same database: 54 files and 1010 tests after merging dev (with #281 and #310), with the
Chrome-only browser suite skipped.

Mutation checks. Each change failed the named tests:

- No exclusive guard: 2 protection tests.
- No revalidation: the demoted-owner test.
- No freshness check in the single read: the consumer test.
- `FOR UPDATE` without `SKIP LOCKED`: the process-loss test.
- Reset inside the save instead of an intent: 7 tests.
- `FOR UPDATE` instead of `FOR NO KEY UPDATE` on the organization row: the lock-mode test.

### Database-free

- `organizations/actions.test.ts`: the action delegates to the writer, runs the organization's
  rebuild only after the commit and only for intents, keeps the save successful when the
  rebuild reports a failure or throws, maps revoked ownership, and rejects invalid zones and
  non-owners before the writer.
- `lib/work-balance/service.test.ts`: the pending-rebuild freshness of the single and bulk
  reads, and the batch exclusion.
- `lib/jobs/work-balance.test.ts`: intents are recovered before the batch is selected, and a
  rebuild failure fails the job result.
- `lib/auth/organization-timezone-update-guard.test.ts`: timezone updates through Better Auth are
  refused and other fields are admitted. The hook is wired in `auth.ts`.
- `components/organization/organization-timezone-card.test.tsx`: a saved change shows the
  recalculation notice, and a failed save reverts the optimistic zone.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption and drain), #329 (pilot) and #331 (rollback).

- **Old consumers.** Binaries without this slice ignore intents. During a mixed deployment
  they could show an adopted organization's old-zone balances between a change and its
  rebuild. The post-commit rebuild keeps that window short, but old binaries must be
  drained before adoption.
- **Old writers.** An old binary's timezone save takes no configuration guard and resets
  balances inside its transaction. Old binaries must be drained before the guard's
  guarantee holds for adopted organizations.
- **Recovery latency.** A failed post-commit rebuild is retried by `cron:work-balance`, which
  runs every three hours. Balances stay hidden, not wrong, until then. The pilot should
  confirm whether that latency is acceptable, or whether the job should run more often.
- **Persistent rebuild failure.** `attempts` is unbounded and nothing alerts on it. A
  rebuild that keeps failing keeps the organization's balances hidden and out of the
  refresh batch. Operations need an alert on `attempts` / `last_error` before activation.
- **User timezone and multi-organization rebuilds** are #312. It will add a user-scoped
  intent across affected organizations to this lifecycle.
- **Other configuration writers** (membership/roles, projects, categories, holidays, change
  policy, billing, provisioning/cleanup: #313–#318) still do not take exclusive protection.
- **Rollback.** Returning an organization to inactive leaves any pending intent to be
  processed. The consumer check stays correct, because it depends only on the intent. A
  rollback to a binary without the table needs the intent drained first (#331).
- Deployment, the scoped pilot and compatible rollback (#327/#329/#331).
