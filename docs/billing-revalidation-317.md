# Billing revalidation inside the manual work transaction (#317 / T52)

## Delivery and activation status

A strict version-2 manual command (#308) now revalidates billing inside the manual work
transaction. The check is a non-provisioning read through that transaction's client. The
billing writers that can change its outcome take exclusive organization configuration
protection before they write. Trial provisioning keeps running in the public guard before the
transaction, now in its own protected transaction.

The in-transaction read only matters in adopted organizations: legacy manual input,
clock-in/out and every other billing caller keep their existing gates. Writer protection
is live without a flag, however. Billing webhooks and first-time trial provisioning now
wait for in-flight work transactions that hold the shared organization configuration
guard (manual, completed-work, web clock-in/out, import and demo work). These transactions
are short, so the wait is brief. It also covers `GET /api/billing/subscription` for an
organization that has no subscription yet, because that request provisions the trial. When billing is disabled
(`BILLING_ENABLED !== "true"`), the in-transaction read allows access, as the public guard
does. The activation blockers at the end of this record are tracked in #327, #329 and #331.

Implementation references: [#317](https://github.com/Umami-Creative-GmbH/z8/issues/317),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697),
[#254](https://github.com/Umami-Creative-GmbH/z8/issues/254#issuecomment-5653344746) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

```text
lib/time-tracking/organization-configuration-guard.ts      # shared/exclusive organization configuration guard (reused, from dev)
lib/effect/services/billing/billing-configuration.ts       # in-transaction read, protected mutation wrappers, trial provisioning
lib/effect/services/billing/billing-enforcement.service.ts # provisioning path delegates to provisionLocalTrial
lib/effect/services/billing/subscription.service.ts        # create, updateFromStripe, setStripeCustomerId, ensureLocalTrial
lib/effect/services/billing/billing-events.service.ts      # payment succeeded/failed, paused, resumed
app/[locale]/(app)/time-tracking/actions/manual-command-submission.ts  # revalidation before replay
```

## Order of checks for a version-2 manual command

1. Session and the current employee.
2. The public billing guard, `requireBillingForMutation`. It provisions a missing default trial
   and returns `billing_required` with the reason when access is denied. This step is
   unchanged.
3. Command parsing and resolution of the currently authorized target (unchanged).
4. The manual work transaction acquires its guards in the #308 order. After the shared
   `["work-organization-configuration", organizationId]` guard is held,
   `readBillingAccessInTransaction` reads the subscription through the transaction client and
   evaluates access with the shared `evaluateBillingAccess`. A missing row is
   `subscription_required`: this read never inserts. On denial the result is
   `{ success: false, error: "billing_required", code: <reason> }`, the same shape the public
   guard returns. Nothing is replayed or written.
5. Exact receipt replay, adoption gating, preparation and the operation (#308, unchanged).

The revalidation comes before replay. A committed command therefore replays only under
current billing access, as it did behind the public guard. When access returns, the replay
returns the original receipt unchanged. No creator-only restriction is added.

## Exclusive configuration protection for billing writers

Billing writers reuse the shared organization configuration guard module
(`lib/time-tracking/organization-configuration-guard.ts`, introduced by #315/#316):
`withOrganizationConfigurationMutation` for writers that know their organization, and
`acquireExclusiveOrganizationConfigurationGuard` per owning organization for writers addressed
by Stripe subscription id. That guard takes
`pg_advisory_xact_lock(hashtextextended(["work-organization-configuration", organizationId], 0))`,
the exclusive mode of the key work transactions hold shared. It is taken in the writer's own
transaction before the write, so the writer waits for in-flight work transactions, and new
ones wait until the change commits or rolls back. Multiple organizations are locked in sorted
order. A billing writer holds no other protocol resource, so the #258 acquisition order is
unaffected.

| Owner | Change | Protection |
| --- | --- | --- |
| `provisionLocalTrial` (`checkBillingAccess` with `createTrialIfMissing`, `ensureLocalTrial`) | inserts the default 14-day trial | only when no row exists; an existing row is read without protection |
| `SubscriptionService.create` (`checkout.session.completed`) | status, trial, period, Stripe ids | by organization |
| `SubscriptionService.updateFromStripe` (`customer.subscription.created/updated/deleted`) | status, cancellation, period | by Stripe subscription id |
| `invoice.payment_succeeded` / `invoice.payment_failed` | `active` / `past_due` | by Stripe subscription id |
| `customer.subscription.paused` / `resumed` | `paused` / Stripe status | by Stripe subscription id |
| `SubscriptionService.setStripeCustomerId` | may insert an `incomplete` row | by organization |

Writers addressed by Stripe subscription id first resolve the owning organizations, lock
them, and re-read the owners. If ownership moved while they waited, they restart (at most
three attempts). The write is then scoped to the locked organizations. If no local row
exists, nothing is locked or written; before this change, the update matched no row either.

The following writers are left unprotected because they do not change an input of the access
evaluation: `updateSeatCount`, seat delivery, `invoice.finalized` and
`payment_intent.payment_failed` (metadata only), and the Stripe event idempotency rows.

The subscription row is also deleted, unprotected, by the `onDelete: "cascade"` of an
organization deletion. It does not go through a billing owner. It is listed as an activation
blocker below.

Trial provisioning must never run under a shared work guard: a session that holds the shared
key and then requests the exclusive one can deadlock against another such session. The work
transaction therefore only receives the read, typed as `Pick<WorkTransactionClient, "select">`.
The provisioning helper opens its own transaction on the root database.

## External and access requirements

- The evidence uses constructed Stripe event objects fed to the production
  `BillingEventsService.processEvent`. The Stripe API client, seat sync and billing email are
  stubbed. No Stripe account, secret, webhook signature or real billing operation was used or
  read. Signature verification in `app/api/billing/webhook/route.ts` is unchanged.
- Production activation needs Stripe webhook delivery to reach a build that contains these
  writers. Events already processed by an old build are not re-run. Until old webhook workers
  are drained, a status change from an old build can still land without protection (see the
  blockers below).

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.manual-command-billing.integration.test.ts`.
It is registered in `scripts/run-approval-workflow-repository-integration.sh` and in the CI
`integration-tests` job. It runs the real public `createManualTimeEntry` action with the real
billing guard (`BILLING_ENABLED = "true"`), the real subscription service and the real Stripe
event processor on the label-owned disposable PostgreSQL 16 database. Only the session, Stripe
client, seat sync, billing email, notifications and the Next cache are replaced. **16/16.**

- Concurrent change: a `invoice.payment_failed` webhook takes protection and then waits on the
  subscription row. The submission passes the public guard and waits on the shared guard. Once
  the webhook commits, the submission gets `billing_required` / `payment_failed` and nothing is
  written.
- Replay gating: an exact replay behind the same concurrent payment failure is refused. After
  `invoice.payment_succeeded`, the replay returns the original receipt (`disposition:
  "replayed"`) without writes.
- Rollback: a webhook whose update fails after it took protection (injected trigger) rolls
  back and rejects. The waiting submission then commits under the unchanged `active` billing.
- Non-provisioning: while an exclusive writer holds protection, the subscription is removed
  after the public guard passed. The submission is refused with `subscription_required`, and no
  row is created. The test removes the row with a direct `DELETE`, because no application code
  deletes subscriptions (only the organization cascade does).
- Provisioning: an organization without a subscription provisions its trial through the public
  guard, after an in-flight work transaction ends. The submission then commits. Reading an
  existing subscription does not wait for work transactions.
- Owners: each of the nine owners in the table waits for a held shared guard, leaves the status
  unchanged while waiting and then applies its change. `invoice.finalized` does not wait.

Two mutations were checked. Making the exclusive lock a no-op failed 13 tests (every waiting,
concurrent, rollback and provisioning case). Skipping the in-transaction denial failed the 3
cases that depend on it.

Related suites pass in the same run: the #308 manual command suite, the #302 approval-evidence
suite, the #284 reviewed import suite, billable seat count, seat sync ordering and the SCIM
seat-sync outbox (7 files, **91/91**).

### Database-free

The billing service unit tests (`billing-enforcement`, `billing-events`, `subscription`)
now shim `db.transaction` / `db.execute` and keep their existing assertions (52/52).

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption and drain), #329 (pilot) and #331 (rollback).

- **Old webhook and app binaries** write subscriptions without protection. Drain them before
  the manual pilot relies on billing being fenced.
- **Other work transactions** (web clock-in/out, on-behalf clock-out, imports, demo, bots,
  direct HTTP) still check billing only before their transaction. The helper is reusable, but
  adopting it there is outside this ticket.
- **Other configuration writers**: holiday, blocking-category and change-policy writers take
  the same exclusive key since #316. The remaining writers (#318 import, demo and cleanup
  paths, among others) are tracked by their own tickets.
- **Organization deletion** removes the subscription through the foreign-key cascade, without
  protection. Organization deletion and cleanup paths must take exclusive organization
  configuration protection (#258 "cleanup/cascade paths").
- **Provisioning under a shared guard** is prevented only by construction and a comment:
  work transactions receive the read-only helper, and every `requireBillingForMutation` caller
  runs before its transaction. A caller that provisions while holding the shared key would wait
  on its own session until the statement timeout.
- **Rollback**: reverting the build removes the in-transaction read and the writer protection.
  No schema or data changes, so a rollback leaves nothing to clean up.
- **Not verified here:** a real Stripe webhook delivery end to end (signature, retries), which
  needs the Stripe test account and is an owner activity for #329.
