# Approval card delivery — #291 / T27, #292 / T28

One durable owner sends approval cards and keeps them current. It covers
Telegram and Discord cards for canonical absences (Discord: see the #292
section at the end). It is **inactive for every
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
  escalation's replacement delivery (#300). The owner does refresh the messages
  of the assignment they replaced.

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
4. **Escalation replacement delivery** (#300) is not part of this slice.
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

## Discord reviewed decisions and delivery — #292 / T28

Discord uses the same prepared presentation, reviewed bindings, decision owner
and delivery owner as Telegram. It adds no persistence, authority or dispatch
of its own. Migration `0089_discord_approval_delivery.sql` only widens the
provider and scheme CHECKs. It inserts no `approval_presentation_control` and
no `approval_delivery_control` rows, so Discord stays review-only on the
existing path for every organization.

```text
owner (provider "discord")                              lib/discord/approval-delivery.ts
  bot active + approvals enabled; receiver scope discord-app:<application id>
  destination = DM opened from the recipient's active account link   (never a stored channel)
  prepareApprovalPresentation(provider "discord", fits: 2000 chars, labels ≤ 80, url ≤ 512)
  create / edit message with explicit outcomes                        (api.ts, delivery-outcome.ts)

interaction (signature verified by the route)          lib/discord/approval-handler.ts
  custom_id {"a":"ba"|"br","b":<binding>}  → handleBoundApprovalInteraction
    deferred ephemeral acknowledgment (type 5), within 3 s, before any decision
    invocation = discord-app:<application id> + interaction.id  (application must match)
    attemptBoundBotApproval → decideBoundAbsenceInvocation (scheme discord_interaction)
    delivered card: pending and undecided → review notice; otherwise left to the owner
    ephemeral follow-up = committed or verified outcome
  custom_id {"a":"ap"|"rj","id":<request>} → legacy historical-only matching (unchanged)
```

- **Identity.** The invocation is the top-level `interaction.id`, scoped to the
  installation's application ID (#261). The component `custom_id` and the source
  message ID never stand in for it: a new interaction on the same button gets
  fresh checks. The same interaction with the same command replays the original
  result; with another command it is a conflict. Discord has no transport
  delivery ID, so `delivery_id` is empty. An interaction for another
  application, or without a snowflake ID or actor, decides nothing.
- **Acknowledgment.** The deferred acknowledgment is protocol only and proves
  nothing. The follow-up reports the committed outcome. When the outcome is
  unknown (the decision call failed), it says so and claims nothing; the same
  interaction replays if the decision did commit. Discord documents no inbound
  interaction redelivery, so nothing relies on one.
- **Destination.** Cards go only to the recipient's DM, opened through Discord
  from their active `discord_user_mapping` in the organization. The stored
  `discord_conversation` channel may be a server channel and is not used for
  approval cards (legacy path included). No link is `destination_invalid:destination_missing`;
  closed DMs (50007), an unknown channel or user and missing access are
  `destination_invalid`. Any later interaction by the recipient
  (`saveConversation`) re-arms that work.
- **Outcomes.** 429 is `retryable`; 5xx, network errors, timeouts and invalid
  responses are `ambiguous`; 401 is `unavailable`; other 4xx are `permanent`.
  On edits, an unknown message or channel, or a message by another author, is
  `gone`. Only the application that sent a message can edit it; a replaced
  application's messages are `gone`.
- **Rendering.** Card and notice text is markdown-escaped and sent with
  `allowed_mentions: {parse: []}`. A refresh or review notice keeps only the
  review link button, so controls are removed.
- **Cross-platform.** The owner refreshes every tracked message of a lifecycle,
  whatever the provider, so a decision on Telegram, Discord or the web retires
  the cards on the others.
- **Legacy path.** Without a Discord delivery control, `sendDiscordNotification`
  keeps sending, now to the DM and, when admitted, as a bound card. With one,
  it stays silent for absences that have a canonical workflow.

### Activation (#292)

Apply `0089` after `0088`, then per organization, after the #290/#291 gates:
insert `approval_presentation_control (…, 'discord', 'actionable')` under the
rollout lock as for Telegram, and
`approval_delivery_control (:org, 'absence', 'discord')`.

### Activation blockers (#292, unresolved)

1. Apply `0089` through the authorized deployment. It has run only on the
   disposable PostgreSQL 16 database.
2. **Old binaries** do not know the Discord adapter or `discord_interaction`.
   Insert controls only after every worker and app instance is upgraded.
3. **Ingress.** The route answers 202 before any durable acceptance; an
   interaction lost after that is not recovered.
4. **Untracked duplicates** and **in-place material changes**, as for Telegram
   (blockers 5 and 6 above).
5. **Live Discord.** Only the REST transport was replaced in tests; no real
   application, signature or DM was exercised.
6. **Stored server channels.** Other (non-approval) Discord notifications still
   use `discord_conversation`, which slash commands in a server also populate.
7. Everything in the #290 and #291 blockers (legacy authority #384, escalation
   replacement delivery #300, activation handover, pilot).

### Verification (#292)

PostgreSQL 16 (`lib/approvals/delivery/discord-delivery.integration.test.ts`,
part of `test:approval-workflow-repository:integration`), driving the real
`requestAbsenceEffect`, `approveAbsenceEffect`, `processApprovalDeliveries`,
`handleDiscordInteraction`, `handleTelegramUpdate`, `saveConversation`,
`sendDiscordNotification` and `deleteApproval`; only the Discord and Telegram
HTTP transports, vault, session and side channels are replaced. 12/12 passing:

- a real submission sends one bound card to the DM opened from the account
  link (not the stored server channel) with full identity; a rerun sends nothing;
- a press is acknowledged (deferred, ephemeral) while the workflow is still
  pending, decides once with `discord_interaction` / `discord-app:<id>` /
  interaction ID, reports "Request approved", and leaves the card to the owner,
  which retires it at the current version;
- the same interaction replays, a changed command conflicts, and a new
  interaction on the same message and button decides nothing;
- another application's interaction decides nothing;
- a paused press turns the pending card into a review notice;
- legacy `{"a":"ap"}` buttons stay historical-only;
- 429 then 502 ×5 retry after 1m/5m/30m/2h/12h and exhaust with attention;
- no link and closed DMs wait for repair; `saveConversation` re-arms;
- a card that went stale in flight is tracked and retired;
- Telegram and Discord decisions refresh each other's cards;
- without a control the existing path sends to the DM; with one it is silent;
- cleanup removes and reports Discord work, messages and invocations.

Unit seams: `discord/bound-approval.test.ts`, `discord/delivery-outcome.test.ts`,
`discord/approval-card.test.ts`.
