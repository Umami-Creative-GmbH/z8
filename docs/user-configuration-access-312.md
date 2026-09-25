# User timezone, settings rows and global access under user protection (#312 / T47)

## Delivery and activation status

Manual creation (#308) reads the target's user settings (the timezone, with the organization
zone as fallback) and the actor's global `user.banned`, `banExpires` and `role` while it holds
the shared `["work-user-configuration-access", userId]` guard of the actor and the target. These
facts are user-global: one user's settings and ban apply in every organization where that user
has an employee record, so no organization key can protect them.

Every application writer of those facts now takes the user's exclusive guard in its original
transaction, before its first dependent write. Like #313, this participation is deployed
unconditionally. It changes no outcome; it only orders a writer relative to in-flight
submissions of that user in any organization. A user timezone change additionally commits a
durable, user-scoped balance-rebuild intent in each organization whose
`time_entry_append_control` is `active`, extending the #311 lifecycle. Every other organization
keeps the previous in-transaction balance reset. Nothing activates in this slice. The
activation blockers are listed at the end and move to #327, #329 and #331.

Implementation references: [#312](https://github.com/Umami-Creative-GmbH/z8/issues/312),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), the canonical resolutions
of [#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697)
(sections 4 and 5) and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145),
and rows C02 and C07 of [the #265 audit](audits/265-configuration-paths.md). The organization
side is [#311](organization-timezone-rebuild-311.md); organization authorization writers are
[#313](organization-authorization-mutations-313.md).

## Mutation paths

### User timezone (C02)

| Path | Participation |
| --- | --- |
| Profile settings, `updateTimezone` | `changeUserTimezone` in `lib/timezone/user-timezone-change.ts` |

No other application path writes `user_settings.timezone`. `writeUserSettings` does not accept
a timezone, so a preference writer cannot change it without the rebuild.

### First settings row and other preferences (C02)

`user_settings.timezone` is `NOT NULL DEFAULT 'UTC'`. A user without a row resolves to the
organization zone; the first row for any other purpose replaces that fallback with UTC. Every
insert or upsert of the row therefore goes through `writeUserSettings`
(`lib/user-preferences/user-settings-mutation.ts`), which opens a transaction, takes the user's
exclusive guard and then upserts. The guard is a user key, not a row lock, so an absent row is
covered.

| Entry point | Writer |
| --- | --- |
| Profile: product-improvement consent (`updateProfileDetails`), `updateWeekStartDay`, `updateTimeFormat` | `writeUserSettings` |
| Onboarding service: all 21 step, profile-preference and wellness upserts (welcome, profile, organization, holiday, work-template, wellness, notification and completion steps) | `writeUserSettings` |
| Wellness settings (`updateWaterReminderSettings`) and wellness mutations (`upsertWaterReminderSettings`) | `writeUserSettings` |
| Dashboard layout (`updateWidgetOrder`). The former update-then-insert pair is now one upsert | `writeUserSettings` |
| Locale from the Telegram bot and the language switcher (`setUserLocale`). The former read-then-insert pair is now one upsert | `writeUserSettings` |

Deletion: no application path deletes a settings row on its own. The row cascades with its
user. User deletion runs through Better Auth's admin `remove-user` endpoint (#314) and the demo
`delete-non-admin` cleanup (#318). Once the user row is gone, a waiting or later submission
finds no principal and is refused. Those deleters do not yet take the guard; see the blockers.

### Global access (C07)

| Fact | Writer | Participation |
| --- | --- | --- |
| `banned`, `banReason`, `banExpires` | Platform admin `banUserAction` / `unbanUserAction` → `PlatformAdminService.banUser` / `unbanUser` | The existence check and the update run in one transaction under the user's exclusive guard. Session revocation and the audit record still run after the commit, in the previous order, so a revocation failure still reports the ban as not completed while leaving it committed. |
| `role` (platform admin) | None in the application. Only Better Auth's admin plugin endpoints (`set-role`, `create-user`) write it | #314 |
| `banned` via Better Auth's admin plugin (`ban-user`, `unban-user`) | Better Auth | #314 |

Other `user` columns that application code writes (`canCreateOrganizations`, `invitedVia`,
onboarding fields and names) are not read by manual preparation, so they take no guard.

## Timezone writer transaction

`changeUserTimezone` acquires, in the #258 order, and never reaches back:

1. Routing reads the organizations where the user has an employee record, sorted.
2. For each of them, the shared `["completed-work-adoption", organizationId]` gate, then its
   append control under it.
3. The exclusive `["work-user-configuration-access", userId]` guard. It takes no organization
   configuration guard: the fact is not organization configuration.
4. Routing runs again. If an organization appeared or disappeared while the writer waited,
   the attempt rolls back and restarts with the new scope, at most three attempts. The writer
   never gates an organization late.

Under that protection it reads the current row. If the row already holds the requested zone,
it returns `unchanged`: no write and no rebuild work. An absent row is always a change, even
when the requested zone is UTC, because the absent row resolved to the organization zone.
Otherwise it upserts the zone and, in the same transaction:

- for each adopted organization, inserts one `work_balance_rebuild_intent` row with
  `reason = user_timezone`, `user_id`, `requested_by` and `requested_at`;
- for each organization that has not adopted, applies the established full reset to the user's
  employees there, sorted by ID, under their `work-balance` locks. Before this slice, the reset
  covered every organization of the user, in parallel and unsorted.

It takes no employee coordination lock and no work-balance lock for adopted organizations.

The action validates the zone first, as before. After the commit it runs
`processWorkBalanceRebuildIntents({ organizationId })` for each adopted organization, one after
another. A failure is logged and left on the intent; the action still reports the save as
successful, and the other organizations still run. A failure before the commit is reported as
`Failed to update timezone`, without the database message.

## Rebuild representation and execution

Migration `0100_user_timezone_rebuild_intent` adds the nullable `user_id` column (FK to `user`,
cascade), widens the reason check to `('organization_timezone', 'user_timezone')`, and adds
`work_balance_rebuild_intent_scope_check`: `reason = 'user_timezone'` exactly when `user_id` is
set. Existing organization intents satisfy it unchanged.

`processWorkBalanceRebuildIntents` still handles one organization per transaction. It claims the
organization's intents with `FOR UPDATE SKIP LOCKED`. If any claimed intent is organization-wide,
the scope is every employee of the organization, as in #311. Otherwise the scope is the
employees in that organization of the claimed intents' users. The scope is routed at execution,
reset under the sorted work-balance locks, revalidated (a change restarts, at most three
times), and the claimed intents are deleted. Recovery, failure recording and the
`cron:work-balance` retry are the #311 ones.

## Consumer freshness

A pending user intent means that user's projections in that organization were computed in the
old zone. Other employees of the organization are unaffected.

- `getEmployeeWorkBalance` reads the organization's pending intents first. It returns `null` if
  one is organization-wide or names the employee's user.
- `getEmployeeWorkBalances` drops the employees whose user has a pending intent, before reading
  rows, and returns nothing if an organization-wide intent is pending.
- `listEmployeesForWorkBalanceBatch` skips an employee when its organization has an
  organization-wide intent or an intent for its user.

New manual submissions do not use projections. Once the change commits, they read the new zone
under the shared user guard, even while the rebuild is still pending.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/settings/profile/user-configuration-access.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real public `updateTimezone`, `updateWeekStartDay`,
`startOnboarding`, `banUserAction` / `unbanUserAction` and `createManualTimeEntry` actions,
the real `setUserLocale`, the real balance reads and batch selection, and the real
`runWorkBalanceRefresh` job all run on the label-owned disposable PostgreSQL 16 database. The
user has an employee record in two adopted organizations. Only the request/session, SSO session
store, Better Auth session revocation, billing provisioning, notification delivery and Next
cache are replaced.

Each race pauses one side on a lock it takes after its protection: a submission on its identity
key, a writer on the user row (a settings insert's foreign-key check, an existing row's upsert,
a ban's update). It then proves that the other side waits on the exact guard key, by the
`pg_locks` classid/objid of its `hashtextextended` value.

**19/19**, together with the #311 suite (14/14) on the same database.

| Scenario | Result |
| --- | --- |
| Change in two adopted organizations | Zone and both user intents commit together; the post-commit rebuild resets only the user's two employees, not a colleague |
| Intent write fails in the second organization (injected trigger) | The whole save rolls back: no row, no intent, no reset in either organization |
| Rebuild fails after commit (injected trigger) | Saved; both intents stay pending with `attempts = 1` and the database message; `runWorkBalanceRefresh` consumes both and recomputes |
| Unchanged zone | No intent and no reset |
| One organization not adopted | Its reset stays inside the save, so its failure fails the save; after recovery, intents for none and resets for both |
| Submission in flight in organization B | The change waits on the user guard, then commits |
| Change in flight | Submissions in organizations A and B both wait on the user guard, then get `reconfirmation_required / zone_changed` (New York); a new-zone submission commits with offset `-240` while the rebuild state is committed |
| Same-zone source change (organization Berlin → user Berlin) | A waiting Berlin submission commits without reconfirmation |
| First row via `updateWeekStartDay` | Waits for an in-flight submission; when the row wins, a waiting organization-zone submission must reconfirm to UTC |
| First row via `setUserLocale` and `startOnboarding` | Each waits for an in-flight submission |
| Organization C gains the user's employee while the change waits | The change restarts and records an intent for C too; the rebuild resets all three employees |
| Ban with a submission in flight | The ban waits; afterwards a new submission is refused with nothing written |
| Ban in flight | Submissions in both organizations wait, then are refused (`target_not_authorized`) with nothing written; after an unban a submission commits |
| Unban while a submission holds shared protection | The unban waits |
| Consumers while a user rebuild is pending | The user's single, team and batch projections are hidden in both organizations; the colleague's stay visible and batched |
| Organization intent plus user intent in one organization | The executor widens to the whole organization; the other organization's user intent stays pending and scoped |
| Reason/scope mismatch | Rejected by `work_balance_rebuild_intent_scope_check` in both directions |

Mutation checks. Each change failed the named tests and nothing else:

- No guard in `changeUserTimezone`: the 4 timezone protection and restart tests.
- No routing re-check: the restart test.
- No guard in `writeUserSettings`: the 4 first-row tests.
- No guard in ban/unban: the 3 ban tests.
- Freshness ignores user intents: the consumer test.
- Executor always organization-wide: 4 tests (colleague reset).
- Reset inline instead of intents: 7 tests.

FULL_RUNNER_PLACEHOLDER

### Database-free

- `lib/user-preferences/user-settings-mutation.test.ts`: guard before the upsert in one
  transaction; nothing is written when the guard fails.
- `settings/profile/actions.test.ts`: the timezone action delegates to the writer, runs each
  adopted organization's rebuild only after the commit, keeps the save successful when a
  rebuild fails or throws, creates no rebuild work for an unchanged zone, hides the database
  message on rollback, and rejects invalid zones before the writer. The preference actions use
  `writeUserSettings`.
- `lib/work-balance/service.test.ts`: user-scoped freshness of the single and bulk reads, and
  the batch predicate.
- `lib/effect/services/platform-admin-ban.test.ts`: ban and unban take the guard inside their
  transaction, before the update; revocation runs after the commit.
- `lib/effect/services/onboarding.service.test.ts`: onboarding writes go through the
  protected writer, and are skipped on refusal.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327 (all-writer
adoption and drain), #329 (pilot) and #331 (rollback).

- **Better Auth admin plugin (#314).** `set-role`, `ban-user`, `unban-user`, `remove-user` and
  `create-user` change `role`, ban state or delete the user (cascading the settings row) without
  the guard. #314 owns their original-transaction participation. Until then, these endpoints
  must stay unused for adopted organizations' users or be refused.
- **Demo cleanup and provisioning (#318).** `delete-non-admin` deletes users, and provisioning
  can add a user's employee record in a new organization without the guard. The timezone
  writer's restart covers an organization that appears while it waits, but not one added after
  its re-check. That window closes only when those writers take the user guard.
- **Fallback semantics.** A first settings row for any purpose changes a user's manual zone
  from the organization zone to UTC, because of the column default. The row is now ordered
  against submissions, and a waiting submission is asked to reconfirm. The fallback change
  itself is existing behavior. Whether the default should be nullable (so that preferences do
  not change the zone) is a product decision for the manual pilot (#329). The balance batch
  already treats a `UTC` setting as absent, so manual interpretation and balance cutoffs
  disagree for such users.
- **Old writers and consumers.** Old binaries write settings and bans without the guard, reset
  balances inline across organizations, and ignore user intents. They must be drained before
  adoption (#327).
- **Recovery latency and alerting** are the #311 items: a failed user rebuild waits up to three
  hours for `cron:work-balance`, and nothing alerts on `attempts` / `last_error`.
- **Rollback.** A rollback to a binary without `user_id` needs pending user intents drained
  first: an older executor would treat them as organization-wide, which is safe but broad, and
  the migration's scope check would still hold (#331).
- Deployment, the scoped pilot and compatible rollback (#327/#329/#331).
