# Approval card delivery — #291 / T27

One durable owner sends approval cards and keeps them current. It covers
Telegram cards for canonical absences. It is **inactive for every
organization**: migration `0086_approval_delivery.sql` inserts no control rows.

```text
canonical submission / decision / cancellation (one transaction)
  workflow transition → approval_outbox rows (the lifecycle intents)
after commit: kickApprovalDelivery (best effort) · cron:approval-delivery (every minute)

processApprovalDeliveries(organization, limit)          lib/approvals/delivery/owner.ts
  expand pending intents → plan from current workflow state   (store.ts)
    initial   one per pending assignment × owned provider   dedupe initial:<assignment>:<provider>
    cancel    initial work whose assignment is no longer pending
    refresh   one per tracked message that no longer matches  dedupe refresh:<message>:<version>
  lease due work (pending and due, or processing with an expired lease)
  initial: recheck assignment, recipient, preference, then the adapter
           → record the actual message → fenced completion → retire it if it went stale
  refresh: status notice from current state → edit → retire (version only increases)

Telegram adapter                                        lib/telegram/approval-delivery.ts
  bot + approvals enabled, recipient's private chat, prepareApprovalPresentation (#290)
  sendMessage / editMessageText with explicit outcomes   (api.ts, delivery-outcome.ts)
```

## Ownership and routing

- `approval_delivery_control (organization, workflow_type, provider,
  activated_at)` switches a provider's cards to the owner. The owner acts only
  while the kind has canonical authority there (rollout `canonical` or
  `complete`), and only on intents created at or after `activated_at`.
- The intents are the workflow's own outbox rows, written atomically with each
  transition. The owner marks them `expanded` once the work they imply has
  committed. Their `disposition` is unchanged. The frozen expansion schema
  (`approval_outbox_delivery`) is not used.
- Canonical absence submissions send no manager notification through the
  existing notification path. With a control, the owner is their initial route.
  The existing Telegram channel stays silent for an absence that has a canonical
  workflow, so the same card is never sent twice. A legacy request (for example
  a policy fallback) keeps the old path.
- Replacement assignments (`reassigned_from_assignment_id`) belong to
  escalation's replacement delivery ([#300](#escalation-replacement-delivery--300--t36)).
  The owner does refresh the messages of the assignment they replaced.

## Sending and refreshing

- Before any fresh details leave, the owner rechecks that the assignment and
  request are still pending, the recipient is an active employee, and the
  recipient's `approval_request_submitted` Telegram preference is on. The
  adapter checks that the bot is active and has approvals enabled, and that the
  recipient has a private chat. The shared presentation checks membership and
  entitlement, and decides between an actionable or review-only card.
- Every actual message gets its own `approval_delivery_message` row:
  recipient, bot scope (`telegram-bot:<id>`), chat, message ID, binding, the
  work that produced it and the workflow version its content reflects.
  Duplicates and late sends are recorded as well. The legacy
  `telegram_approval_message` is not written by the owner.
- A refresh edits the message into a status notice without the request's
  facts. A decided assignment shows its own committed outcome, with a later
  request result stated separately. A withdrawn request says so. Anything else
  says only that the card is no longer actionable. A recipient who is no longer
  an active employee gets that generic notice as well.
- Refresh never renders controls, only an initial send does, and a message's
  `status_version` only increases. At most one refresh per message is in flight,
  and its content is computed at send time. A stale refresh therefore cannot
  bring controls back or overwrite newer content.
- A card pressed on Telegram: the callback acknowledgment reports the
  attempt's outcome. A card whose assignment or request is no longer pending
  (the one just decided, too) has one writer, the owner, which refreshes it and
  every other message of the lifecycle from the decision's intent. A card that
  is still pending but decided nothing (paused, stale revision, not current)
  becomes a review notice in the webhook; the owner does not refresh pending
  cards.

## Failures, retries and recovery

| Outcome | Examples | Result |
| --- | --- | --- |
| `retryable` | HTTP 429 | Retry after 1 min, 5 min, 30 min, 2 h, 12 h, each from the preceding attempt. |
| `ambiguous` | network error, timeout, 5xx, invalid response, internal error after send | Same schedule. A retry can duplicate the message. |
| `destination_invalid` | no private chat, bot blocked, chat not found | `awaiting_repair`, `delivery_unavailable` attention. |
| `unavailable` | no bot token, 401 | `awaiting_repair`, `delivery_unavailable` attention. |
| `permanent` | other 400, no compatibility reference | `failed`, attention. |
| exhausted | sixth failed attempt | `exhausted`, `delivery_exhausted` attention (per channel). |
| suppressed | preference off, bot inactive, approvals disabled, not entitled | `suppressed`, nothing sent. |
| obsolete | assignment decided or request withdrawn before sending | `cancelled`. |

- Leases last two minutes; Telegram calls time out after 30 seconds. Right
  before each provider call the worker renews its lease and gives up if it no
  longer holds it (for example behind slow calls earlier in its batch), so a
  taken-over item is not sent twice. A worker completes work only while its
  lease token holds. If a lease expired during the call itself and another
  worker took over, the late worker's message is still recorded. Retry times
  are measured from the actual attempt.
- Explicit recovery (**Retry delivery** on the escalation management page,
  `recoverApprovalDeliveryForAttention`) re-arms exhausted, failed or
  repair-waiting work with a fresh schedule. Delivered, suppressed and cancelled
  work is never resent. The incident closes only when a delivery succeeds.
- Destination repair: when the recipient's private chat is saved again, their
  `destination_invalid` work is re-armed. `unavailable` work (bot missing or
  token revoked) waits for explicit recovery after the bot is repaired.
- Delivery never changes a committed decision. A failed refresh leaves the
  decision as committed and retries on the schedule.
- Guarantees begin when the intent commits. After a crash between commit and
  send, the next pass sends. After a crash between Telegram's acceptance and
  tracking, the retry sends a second message and only that one is tracked
  (Telegram has no idempotency key). Callbacks lost after the webhook
  acknowledgment are not recovered.

## Cleanup

`deleteApprovalInTransaction` locks both tables, deletes the lifecycle's
delivery work and messages through its verified workflows and reports them as
`delivery.work` and `delivery.messages` (platform-admin card, CLI and audit). A
send that completes after the purge cannot record its message: the workflow FK
fails and the owner reports `delivered_after_purge`.

## Activation

Apply `0086` after `0085`. Deploy a release with the owner to every worker and
app instance, then, per organization and after the #290 gates:

```sql
insert into approval_delivery_control (organization_id, workflow_type, provider)
values (:org, 'absence', 'telegram');
```

Deleting the row stops the owner. Unfinished work stays for recovery, but
canonical absence submissions then send no Telegram card at all.

### Activation blockers (#291, unresolved)

1. Apply `0086` through the authorized deployment. It has run only on the
   disposable PostgreSQL 16 database.
2. **Old binaries.** Instances without this release neither run
   `cron:approval-delivery` nor kick the owner; delivery then waits for an
   upgraded worker. Insert controls only after every instance is upgraded.
3. **Legacy authority** (#384). The owner delivers canonical absences only.
4. **Escalation replacement delivery** is #300 (see below).
5. **In-place material changes** without a workflow transition commit no
   intent, so the card is not refreshed. Pressing it decides nothing.
6. **Untracked duplicates.** A crash between Telegram's acceptance and tracking
   leaves one message without an identity. It keeps its controls, which decide
   only while the assignment is pending.
7. **Activation handover.** Pending workflows whose intents predate
   `activated_at` get no card from the owner (in-flight classification).
8. **Refresh incidents** close through the existing attention recheck once the
   approval is settled. The exhausted work row stays visible.
9. **Ingress.** No durable acceptance before the webhook acknowledgment.
10. Everything in the #290 and canonical evidence blockers (in-flight
   classification, #306 cleanup ordering, pilot #328/#330).
11. The approval write-boundary scanner cannot read sources on Windows. The new
    owners are registered but were not scanned.

## Verification (#291)

PostgreSQL 16 (`lib/approvals/delivery/telegram-delivery.integration.test.ts`,
part of `test:approval-workflow-repository:integration`), driving the real
`requestAbsenceEffect`, `approveAbsenceEffect`, `handleTelegramUpdate`,
`processApprovalDeliveries`, `saveConversation`, `sendTelegramNotification`
and `deleteApproval`. Replaced: session, billing guard, e-mail and notification
fan-out, calendar queue, work-balance marking, the vault, the post-commit fast
path (recorded, so each test runs the owner explicitly) and the Telegram HTTP
transport (`fetch`). 17/17 passing:

- a real submission commits pending intents and sends nothing until the owner
  runs; the owner then sends one bound card and records its full identity and
  binding; a rerun sends nothing;
- a web decision refreshes the card to "Request approved" without controls, and
  controls never return; a Telegram decision acknowledges "Request approved",
  leaves the card to the owner, which then retires it at the current version;
- a press on a paused, still-pending card decides nothing and turns the card
  into a review notice, which the owner leaves alone;
- a worker whose lease was taken over cannot renew it, so it never reaches the
  provider;
- retries are due exactly 1 min, 5 min, 30 min, 2 h and 12 h after the
  preceding attempt and not a second earlier; the sixth failure is exhausted
  with an open `delivery_exhausted` incident; explicit recovery sends once and
  closes it; recovery cannot resend delivered work;
- a missing chat waits for repair without spending retries; saving the chat
  re-arms and delivers; a blocked bot is an invalid destination;
- preference off and approvals disabled are suppressed;
- a decision before the first send cancels the initial card;
- a card that went stale in flight is tracked and then retired;
- an expired lease is taken over: two messages are recorded, the work is
  delivered once, the late worker loses its fence, and both messages are
  refreshed after a decision;
- an injected tracking failure after Telegram accepted leads to a scheduled
  ambiguous retry, a second send and one tracked message;
- three concurrent workers send once;
- a failing refresh leaves the approved absence approved and retries;
- without a control nothing is expanded and the existing channel still sends;
  with a control the existing channel stays silent;
- privileged cleanup removes and reports work and messages; a late tracking
  write reports the purge.

Unit seams: `delivery/schedule.test.ts`, `telegram/delivery-outcome.test.ts`,
`bot-platform/approval-status-notice.test.ts`, `maintenance.test.ts`.

## Escalation replacement delivery — #300 / T36

A committed escalation transfer (#298) gets its replacement card and the
retirement of the former assignment's cards from escalation's own delivery
pass. The pass reuses this owner's transport, message tracking, leases, retry
schedule and attention. It is inactive wherever no delivery control exists.

```text
scheduled/human transfer (one transaction)                  escalation/transfer.ts
  workflow escalate → journal row + immutable delivery event
after commit: kickApprovalDelivery (best effort) · cron:approval-delivery (every minute)

processEscalationReplacementDeliveries(org, limit)      escalation/replacement-delivery.ts
  expand pending canonical events (row-locked until their work commits)
    channels  = delivery controls active at the transfer ∩ escalation delivery enabled now
    replacement  one per channel             dedupe replacement:<transfer>:<provider>
    retirement   per tracked former message  dedupe refresh:<message>:<version>  (shared)
  cancel replacement work whose assignment is no longer pending
  lease due escalation work → the shared executor (owner.ts)
```

### Ownership

- `approval_delivery_work.escalation_transfer_id` (migration `0089`) links work
  to the transfer whose delivery owns it. Escalation claims only linked work,
  and the delivery owner claims only unlinked work. Both claim under the same
  organization lock, and at most one refresh per message is in flight.
- Effect `replacement` sends the replacement assignment's card. A CHECK ties
  it to a transfer; `initial` work never carries one.
- A refresh has the same dedupe identity whichever owner plans it. The
  retirement that escalation plans at expansion and the refresh that the
  delivery owner plans from the transition's outbox row are one row with one
  executor. If the delivery owner planned it first, escalation adopts it while
  it is still `pending` (unclaimed); a row a worker already claimed stays with
  that worker. Later status refreshes (after the replacement or anyone else
  decides) come from the delivery owner as before, for former and replacement
  cards alike.
- Pausing escalation automation stops new transfers only. Committed transfers
  keep their delivery and recovery.

### Expansion and frozen channels

- Each event is expanded exactly once. The intended channels are frozen at
  that expansion. They are the providers whose delivery control for the kind
  was activated at or before the transfer, and whose escalation-delivery
  preference (`telegram_bot_config.enable_escalations`) is on at that moment.
  Enabling escalations later adds no channel to an expanded transfer. A
  delivery control activated after the transfer committed does not count,
  matching the #291 rule that intents before `activated_at` are not the
  owner's (in-flight classification).
- A crash during expansion rolls it back. The event stays `pending` and the
  next pass expands it. Expansion never repeats the transfer.
- The former assignment's tracked cards are retired whatever the channels,
  including when no replacement channel is intended.

### Sending

- Before sending, the shared executor rechecks:
  - the replacement assignment is still pending (authority did not move on);
  - the recipient is an active employee;
  - the `approval_request_submitted` Telegram preference is on;
  - the bot is active and has approvals enabled;
  - for replacements only, the current escalation-delivery preference
    (`escalations_disabled` → `suppressed`).

  The shared presentation checks membership and entitlement and binds the
  card to the replacement assignment.
- Outcomes, retries (1 min, 5 min, 30 min, 2 h, 12 h), `awaiting_repair`,
  exhaustion and explicit recovery (**Retry delivery**, destination repair)
  follow the table above. Attention is raised on the replacement assignment.
  Recovery kicks both passes. Delivered work is never resent.
- Replacement work is cancelled as `obsolete` if, before sending, its
  assignment is decided or transferred again, or the request settles. A
  replacement card that went stale while in flight is tracked, and escalation
  schedules its retirement.
- Duplicate and late sends (lease takeover) keep their own message rows, so
  every known card is refreshed later. After a crash between Telegram's
  acceptance and tracking the card is sent again; only the second identity is
  known.

### Former cards

A former assignee's card is edited into **Reassigned**. It says the approval
was reassigned and that no decision is needed or was made here, and keeps the
review link. It never names the replacement or the outcome. A recipient who is
no longer an active member gets the generic inactive notice. Either owner uses
this wording for any replaced assignment (escalation or reassignment), because
it is equally true for both. A press on a former card that is still on screen
decides nothing and is acknowledged as **Reassigned**; the owner then edits the
card itself with the review link. The replacement decides through its own
bound card.

### Activation blockers (#300, unresolved)

1. Apply `0089` after `0088` through the authorized deployment. It has run only
   on the disposable PostgreSQL 16 database.
2. Everything under the #291 blockers above, the escalation activation blockers
   in `escalation-transfer.md` (ownership writer, drained cutover) and the
   pilot gates.
3. **Legacy-authoritative transfers** (#299) cannot be named by the shared
   delivery tables, because they have no workflow. Their events stay `pending`
   (recoverable, never marked delivered) and raise no attention. No ticket
   covers legacy replacement delivery yet; #384 covers legacy bound cards,
   which it needs. The replacement finds the request in the web inbox.
4. **Telegram only.** Slack, Discord and Teams have no delivery adapter. Their
   old escalation checkers stay execution-gated.
5. **Old binaries** neither run the replacement pass nor claim by owner. A #291
   delivery-owner binary would claim escalation work too: it would cancel a
   replacement card as `purged` (it has no message) and retire former cards
   with the generic inactive wording, which is never corrected afterwards.
   Deploy to every worker and drain old delivery-owner workers before any
   organization with a delivery control switches escalation ownership.
6. **Untracked duplicates** (#291 blocker 6) apply to replacement cards too.
7. Obsolete replacement work is cancelled in bulk; a `delivery_exhausted`
   incident on its assignment closes through the attention recheck once the
   approval settles, like #291 refresh incidents.

### Verification (#300)

PostgreSQL 16 (`lib/approvals/escalation/replacement-delivery.integration.test.ts`,
part of `test:approval-workflow-repository:integration`). It drives the real
`requestAbsenceEffect`, `processApprovalDeliveries`, `processDueEscalations`,
`processEscalationReplacementDeliveries`, `approveAbsenceEffect`,
`handleTelegramUpdate`, `saveConversation`, `recoverApprovalDeliveryForAttention`
and `deleteApproval`. It replaces the same dependencies as the #291 suite.
15/15 passing:

- A transfer commits its event and sends nothing. The pass, with automation
  paused, sends one bound replacement card to the backup and edits the former
  card into "Reassigned" without controls. The delivery owner's pass then plans
  and executes nothing more, and reruns send nothing.
- A press on the former card decides nothing and is acknowledged as
  "Reassigned". The replacement approves from its card. Afterwards every card
  shows the current version without controls, and the former card still says
  "Reassigned".
- When the delivery owner planned the former card's retirement first,
  escalation adopts and executes that one row.
- Escalations disabled at expansion: no replacement work, the former card is
  retired, and enabling escalations later adds none. Enabled at expansion but
  disabled before the send: `suppressed`.
- A crash during expansion leaves the event pending. A rerun of the scheduled
  escalation transfers nothing more, and the next pass delivers.
- A decision before the send cancels the replacement card. A decision while
  the card is in flight leaves it tracked, and it is retired afterwards.
- 502 ×6: due exactly after 1 min, 5 min, 30 min, 2 h and 12 h, then exhausted
  with a `delivery_exhausted` incident on the replacement assignment. The
  assignment stays pending and no second transfer happens. Recovery sends once
  through escalation's pass (not the delivery owner's) and never again.
- A failed tracking write after acceptance sends again and keeps one identity.
  A lease takeover keeps both identities, and both are retired after the
  decision.
- A missing destination raises `delivery_unavailable` at once without spending
  retries; saving the chat delivers.
- A permanent send failure (400) is `failed` with a `delivery_exhausted`
  incident and never retried; authority and the journal are unchanged. A
  retirement that failed on the network is retried and succeeds.
- The replacement's preference off → `suppressed`; lost organization
  membership → `suppressed` (`not_entitled`), nothing sent.
- Three concurrent passes send one card.
- Privileged cleanup removes and reports the initial, replacement and
  retirement work, both messages and the journal row.

Unit seams: `bot-platform/approval-status-notice.test.ts` (reassigned wording)
and `maintenance.test.ts` (delivery work is deleted before the journal it
cascades from).
