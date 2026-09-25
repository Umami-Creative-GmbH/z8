# Bot clocking through the shared clock commands (#277 / T13)

## Delivery and activation status

Slack, Telegram, Discord and Teams reach one pair of shared bot commands
(`lib/teams/commands/clock-in.ts`, `clock-out.ts`, registered in
`lib/bot-platform/command-registry.ts`). Those commands no longer call the raw
clocking service. They call the web's live clock core, `clockInAs` and
`clockOutAs` in `app/[locale]/(app)/time-tracking/actions/clocking.ts`. The web
action, the mobile route and the bots therefore run the same code:

- clock-in: the coordinated `withWebClockInTransaction` and the organization's
  append admission (#273);
- clock-out: the replay order, then the completed-work operation
  (`close-active-work.ts`, #274) in adopted organizations, or the coordinated #272
  closure in the others.

Nothing activates in this slice. Adopted behavior still depends on an
organization's `time_entry_append_control` row, and production has no setter.
Before activation, bot clock-outs now take the coordinated legacy closure, which
writes the canonical record. That is the only change bots see until then. The
remaining activation blockers are listed at the end and are tracked in #327,
#329 and #331.

References: [#277](https://github.com/Umami-Creative-GmbH/z8/issues/277),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), the canonical
resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145),
and the [#274 operation doc](web-clock-out-operation-274.md).

## What changed

### One core for every adapter

`clockIn`/`clockOut` (the web actions) now resolve the session and employee, then
call `clockInAs`/`clockOutAs` with a `ClockActor` (`userId`, the employee row, and
a lazy timezone lookup). The web wire shape is unchanged: `toActionResult` drops the
adapter-only outcome detail. The web unit suite fails the same 5 date-dependent
tests as clean `dev`, and no others.

The core returns a typed `failure` reason next to the existing error text, so each
adapter can word the outcome itself:

| Reason | Meaning |
| --- | --- |
| `not_clocked_in`, `already_clocked_in`, `rejected`, `billing_required`, `approval_required`, `approval_unavailable`, `append_review_required`, `collision` | Known outcome. Nothing was written. |
| `failed` | This attempt wrote nothing (the read-only replay step failed). |
| `unconfirmed` | Unexpected failure while the closure's transaction was open or committing. The work may or may not be saved. |

A clock-out that has committed is never reported as unsaved. If anything after
the commit throws, the core logs it and returns the committed result. Before this
change the web action returned "Failed to clock out" in that case.

### Bot actor and authorization

Provider authentication (signatures, webhook secrets, Bot Framework) and
provider-user resolution are unchanged. Before any clock write,
`resolveBotClockActor` (`lib/bot-platform/clock-actor.ts`) re-checks, in the bot's own organization, that the resolved
user is an approved member (`resolveCommandActorEmployee`) and that their active
employee record is the one the adapter resolved. A Slack mapping into another
organization therefore clocks nobody. The core and the operation re-check
membership and the departure gate inside the transaction, as they do for the web.

### Identity and replay

Bot requests carry no client identity. Each clock-out generates a server UUID. It
names the operation: the clock-out entry ID, the receipt ID and
`command.operationId`. It is **not** retry identity. Repeating the command is a
new command with fresh checks: it gets "You are not currently clocked in" and
writes nothing. The shared replay step still runs first, but it can only match its
own ID. Provider invocation IDs (Telegram update, Discord interaction, Teams
activity) are not used as clock identity. Adopting them would need their own
scoping and limits (#261), and Slack has no usable ID.

The receipt's command records `deviceInfo: "<platform>-bot"`,
`requestedInstant: null` (the server sampled the instant) and
`browserTimezone: null`. Bot receipts use the writer `bot_clock_out` (migration
`0084`; `writer_version` 1). The platform is in the command, and replay compares
both the writer and the command.

### Complete work invariant

Every bot clock-out now writes the canonical record, work detail and any allocation
with the period's single derived duration. That holds in both modes: in the
operation, and in the coordinated #272 closure before adoption. The old bot path
closed the period through the raw closer and wrote **no canonical record at all**.
Adopted closures also write the append linkage, the position advance, the graph
revision, the committed balance-refresh intent and the receipt, all in one
transaction.

Attribution is omitted, so the operation preserves the period's project and
category. The legacy closure keeps its #272 behavior (omission clears).
Compliance, break enforcement, surcharge reconciliation and the budget warning now
run in the shared post-commit owner, as they do for the web. The bot no longer
runs them itself.

### Approval

Approval-routed live clock-out stays unsupported from bots, as before (`3c123396`).
The core evaluates the same policy check as the web and, when called with
`refuseApprovalRouting`, returns `approval_required` before any write. No new
live-clock-out approval policy is introduced.

### Replies and transport

- Success replies use the committed entry timestamp and the stored minutes, not
  the time the bot received the message. A formatting failure after commit falls
  back to "Clocked out." / "Clocked in.", never to an error.
- `unconfirmed` is worded as "could not be confirmed. Check your status before
  trying again". It does not invite a blind retry.
- Discord and Teams no longer answer a failed reply delivery with the generic
  "something went wrong, please try again". The command has already run. They
  log the delivery failure and send the translated `bot.static.replyUndelivered`
  notice ("Your command was processed, but its reply could not be shown…") as a
  best effort. Telegram only logs a failed send, and
  Slack returns the reply in its HTTP response, so neither implied failure.
- New bot strings (`bot.cmd.clockin.*`, `bot.cmd.clockout.*`,
  `bot.static.replyUndelivered`) are translated in all 12 bot locales. The old
  fallback that reused `alreadyIn` with unfilled placeholders is replaced by
  `alreadyInNow`.

### Timezone capture

The bots keep their existing capture evidence. The zone is the bot temporal
context's effective zone (Telegram: user setting, then organization; the others:
the bot's digest zone), with source `user_setting`. Entries keep
`ip_address = "bot"` and `device_info = "<platform>-bot"`. Correcting the capture
provenance for Slack, Discord and Teams belongs to the #254/#258 zone matrix, not
to this slice.

## Linked cleanup

Bot receipts share the `completed_work_operation` table, so the #274 cleanup
applies to them too: organization and employee deletion cascade, and
`clearOrganizationTimeData`, `deleteNonAdminEmployeesData` and permanent
organization deletion delete them. No new evidence lifecycle is added.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/lib/bot-platform/clock-commands.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real Slack slash-command handler, the Telegram update
handler, the Discord interaction handler and the Teams activity handler run the
shared registry, the bot commands and the shared core against the gated,
label-owned disposable PostgreSQL 16 database. Real provider-user resolution
(seeded mapping rows) and real translations are used. Only the provider HTTP
transport, conversation bookkeeping, the Teams tenant lookup, billing
provisioning, the Next request/cache boundaries and the clock are replaced.

Verified (123 tests). "Each adapter" means Slack, Telegram, Discord and Teams,
through their real handlers. "Both modes" means an adopted organization and one
before adoption.

- For **each** adapter in an adopted organization: clock-in, then clock-out at
  60m40s. The period and the canonical record both store 61 minutes with the same
  endpoints, and `origin = clock`. The requester is the canonical creator and the
  entry actor. The clock-out entry has `device_info = <platform>-bot`,
  `ip_address = bot` and an explicit predecessor. The position is at version 2
  (`live_clock_out`), the balance is dirty from the work date, and the receipt
  (`bot_clock_out`) has exactly the expected command and segment. The reply reads
  "Clocked out at 09:00. Duration: 1h 1m."
- For **each** adapter before adoption: the same closure writes the canonical
  record with the period's 61 minutes, and no receipt or revision.
- Organization rejection, for **each** adapter in **both** modes, for clock-in and
  for clock-out: the platform mapping is moved into another organization where the
  same user is also an employee. Slack and Teams resolve that organization's
  employee and the command refuses it ("Employee profile not found."). Telegram
  and Discord find no mapping in the bot's organization ("not linked"). Neither
  organization has any row changes.
- Partial minutes, for **each** adapter in **both** modes: 29 s stores 0 minutes
  and 30 s stores 1, in both representations and in the reply.
- Equal endpoints (each adapter) are rejected with no changes.
- A repeated unkeyed clock-out (each adapter, both modes) is a fresh command: "not
  clocked in", no changes, and one receipt.
- Rollback, for **each** adapter, by injecting a failure at every write the
  transaction makes. Adopted closure: canonical record, work detail, allocation
  (attributed period), clock-out entry, position update, period update (which also
  advances the graph revision), balance intent and receipt. Pre-adoption closure:
  canonical record, work detail, clock-out entry and period update. Clock-in:
  entry, position insert (adopted) and period insert. Each rolls back everything
  (two-organization snapshot equality), and the reply is the "could not be
  confirmed" wording.
- Approval-routed clock-out is refused with no changes.
- Changed adopted history (a tampered hash) holds both clock-out and the next
  clock-in for review, for each adapter, with no changes.
- A Discord reply that fails after a committed clock-out leaves the work committed
  (one receipt), and the user gets the truthful delivery message.

The first version of this suite (20 tests) was run with the old bot commands and
handlers swapped back in, and 19 of the 20 failed. Old bot closures wrote no
canonical record and no receipt, ignored changed adopted history, answered
failures with the generic "please try again", and Discord reported a
delivered-late command as failed. (The approval case also fails there, but only
because the old command read the policy through a different module than the one
the suite forces. It proves nothing about the old code.)

The full runner (`bash apps/webapp/scripts/run-approval-workflow-repository-integration.sh`:
fresh container, migration recovery check and full chain including `0084`) passed
**38 files / 724 tests**, including the #272, #273 and #274 clocking suites against
the refactored web core. The label-owned containers were verified and removed.

### Database-free

- `lib/teams/commands/clock-commands.test.ts` (replaces the static source checks in
  `clock-out.test.ts`): the actor passed to the core, omitted attribution, a
  distinct operation ID per invocation, `refuseApprovalRouting`, the wording of every
  outcome, committed replies surviving a formatting failure, and org-scoped actor
  refusal.
- `lib/bot-platform/command-reply-delivery.test.ts`: Discord and Teams reply
  delivery failures. Both fail on clean `dev`.
- `lib/time-tracking/clocking-writers.test.ts` now requires the bots to use the
  shared core instead of the raw service. The static web slices in
  `actions.atomicity.test.ts` and `actions.billing-guard.test.ts` now read
  `clockInAs`/`clockOutAs`, where the guards and writes now live. The bot's static
  `billing-guard.test.ts` is removed: the billing guard now runs in the shared
  core, and the bots' wording of `billing_required` is covered by the behavior
  suite above.
- `actions/clocking.test.ts`: a new test covers work that is saved before a
  post-commit step throws. The action reports success and logs the error; disabling
  the guard fails the test. Otherwise the file has the 5 date-dependent failures
  that also fail on clean `dev`, and no others. One receipt fixture gained the `segment` every
  version-1 receipt carries.
- Full webapp suite: 141 failures, none new. Clean `dev` in a separate worktree:
  145 failures. The 4 that fail only on `dev` are demo and Telegram digest tests
  this change does not touch. `pnpm run typecheck` passed.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates, tracked
in #327 (all-writer adoption), #329 (pilot) and #331 (rollback).

- Other competing writers of the same employee graph must still participate or be
  drained: direct HTTP (#275), on-behalf (#276), manual (#308), active breaks and
  splits (#304), corrections (#301/#286), imports (#284), demo (#285), and
  ordinary, cron and terminal breaks (#303/#305).
- Deployed bot workers and route handlers: deployment and in-flight inventory, and
  the old-writer drain. An old binary still runs the raw closer against adopted
  data (#327/#329).
- Bot retry identity: unkeyed bot commands cannot establish replay. Using
  provider invocation IDs for clock commands would need its own decision within
  the #261 limits.
- Slack's 3-second slash-command deadline: a slow commit can time out at Slack
  after the work is saved. The user then sees Slack's own error. The work is
  correct, but the reply is lost. Deferred responses belong to the transport
  work (#261).
- Bot capture provenance for Slack, Discord and Teams (digest zone labeled
  `user_setting`), under the zone matrix (#254/#258).
- Approval-routed clock-out from bots stays refused until a presentation and
  decision path exists for it.
