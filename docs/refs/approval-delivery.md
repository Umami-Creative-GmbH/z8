# Approval card delivery — #291 / T27, #294 / T30, #292 / T28

One durable owner sends approval cards and keeps them current. It covers
Telegram cards (#291), review-only Slack cards (#294) and Discord cards (#292,
see its section at the end) for canonical absences. It is **inactive for every
organization**: migrations `0086_approval_delivery.sql`,
`0090_approval_delivery_slack.sql` and `0091_discord_approval_delivery.sql`
insert no control rows.

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

Slack adapter (review-only)                             lib/slack/approval-delivery.ts
  installation + approvals enabled, recipient's DM (saved, or opened for the linked account)
  prepareApprovalPresentation with a review summary       (approval-card.ts renders it)
  chat.postMessage / chat.update, no client retries       (api.ts, delivery-outcome.ts)
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
  The existing Telegram and Slack channels stay silent for an absence that has
  a canonical workflow while their provider's control exists
  (`isApprovalNotificationDeliveredByOwner`), so the same card is never sent
  twice. A legacy request (for example a policy fallback) keeps the old path.
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

## Slack cards (#294)

Slack has no established per-invocation identity (#261), so Slack cards never
carry approve or reject controls and never issue a binding:

- The initial card shows the facts of the immutable submitted revision (the
  same gates as an actionable card: canonical authority, evidence capture, a
  current revision that still matches the live request) with the hint that the
  request is decided in Z8, and one button that opens the exact item. Every
  value is Block Kit `plain_text`; the notification fallback escapes `&`, `<`
  and `>`, so names cannot mention or link.
- Essential content is never truncated: when the header (150), facts or text
  section (3000), button label (75) or URL (3000) would exceed Slack's limits,
  the recipient gets the shared review notice without facts instead.
- Refreshes use `chat.update` with the same status notices as Telegram,
  including the committed actor and decision time from decision evidence.
  Decisions on the web or on Telegram refresh Slack cards through the same
  lifecycle intents.
- Message identity: receiver scope `slack-team:<team id>`, the DM channel ID
  and the message `ts`. Only the installation that sent a message updates it;
  after a workspace change the message is marked `gone`.
- Presses on legacy Slack cards stay review-only: `attemptBotApproval`
  replays only supported committed history and never decides fresh. No
  `action_ts` composite, card value, payload hash or receive-time ID reaches a
  decision; `action_ts` and `block_id` are modeled for diagnostics only.
- The delivery client makes one attempt per call with a 30 s timeout and
  rejects rate limits instead of waiting them out under a lease.
- Entitlement is checked before the DM: no conversation is opened for a
  recipient who may not see the request.
- Refreshes run even after Slack approvals are disabled for the
  installation: they only remove a card's live content, and a stale card is
  worse than an update. Only the installation that sent it can update it.
- Scope: the owner delivers and refreshes the approver's card only. Decision
  notices to the requester (`approval_request_approved` and similar) keep the
  existing notification path, unchanged by this slice.

## Failures, retries and recovery

| Outcome | Examples | Result |
| --- | --- | --- |
| `retryable` | HTTP 429; Slack `ratelimited` | Retry after 1 min, 5 min, 30 min, 2 h, 12 h, each from the preceding attempt. |
| `ambiguous` | network error, timeout, 5xx, invalid response, internal error after send; Slack `internal_error`, `fatal_error` | Same schedule. A retry can duplicate the message. |
| `destination_invalid` | no private chat, bot blocked, chat not found; Slack no linked account, `channel_not_found`, `is_archived`, `user_not_found`, `user_disabled`, `cannot_dm_bot` | `awaiting_repair`, `delivery_unavailable` attention. |
| `unavailable` | no bot token, 401; Slack `invalid_auth`, `token_revoked`, `account_inactive`, `missing_scope` | `awaiting_repair`, `delivery_unavailable` attention. |
| `permanent` | other 400, no compatibility reference; Slack `invalid_blocks`, `msg_too_long` and any other error | `failed`, attention. |
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
- Destination repair: when the recipient's Telegram private chat or Slack DM
  is saved again, they link their Slack account, or they reach the Discord bot
  again, their `destination_invalid` work for that provider is re-armed. `unavailable` work (bot missing or token
  revoked) waits for explicit recovery after the bot is repaired.
- Delivery incidents are per channel: `delivery_exhausted` and (since #294)
  `delivery_unavailable` include the delivery channel in their identity, so a
  Telegram success does not close an open Slack incident for the same
  assignment.
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
-- #294, after 0090:
insert into approval_delivery_control (organization_id, workflow_type, provider)
values (:org, 'absence', 'slack');
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

### Activation blockers (#294, unresolved)

1. Apply `0090` through the authorized deployment. It has run only on the
   disposable PostgreSQL 16 database.
2. **Old binaries.** A worker without this release that claims Slack work
   cannot load an adapter: the attempt is recorded as `ambiguous:internal_error`
   and retried, so repeated old-worker claims can exhaust it. Insert a Slack
   control only after every worker and app instance runs this release.
3. **Legacy Slack cards** sent before activation are not tracked by the owner
   and are not refreshed; pressing one still decides nothing.
4. **Historical replay wording.** A press on a legacy card whose supported
   history replays (manual time submissions, policy clock-outs) states the
   verified outcome without its original decision time: legacy rejections
   record no decision time, and no render-time time is substituted. The
   Slack rendering is covered by `bot-platform/approval-adapters.test.ts`,
   not by the PostgreSQL suite.
5. **Stale DM after a workspace change.** A saved DM from the previous
   workspace is tried first; Slack answers `channel_not_found`, and the work
   waits for repair until the recipient writes to the new bot or relinks.
6. **Slack identity (#261).** Actions stay review-only until Slack documents a
   per-invocation identity; enabling them needs a new decision.
7. **Live workspace.** Verified against the real Web API client with a
   replaced HTTP transport, not a live Slack workspace.
8. Blockers 3–11 of #291 apply unchanged (legacy authority, escalation
   replacement delivery #300, in-place material changes, untracked
   duplicates, activation handover, ingress, #290 gates, scanner on Windows).

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

## Verification (#294)

PostgreSQL 16 (`lib/approvals/delivery/slack-delivery.integration.test.ts`,
part of `test:approval-workflow-repository:integration`), driving the real
`requestAbsenceEffect`, `approveAbsenceEffect`, `processApprovalDeliveries`,
the Slack Web API client, `handleInteraction`, `claimLinkCode`,
`saveConversation`, `handleTelegramUpdate`, `sendSlackNotification` and
`deleteApproval`. Replaced as in #291, with the HTTP transport (`fetch`)
below both provider clients. 17/17 passing:

- a real submission sends one Slack card with the submitted facts, no
  decision controls and the exact item's review link; its full identity is
  recorded, no binding is issued, and a rerun sends nothing;
- a summary beyond Slack's limits is sent as a review notice without facts;
- a web decision updates the card with the committed actor and time in the
  recipient's zone; a Telegram decision updates the Slack card as well;
- repeated fresh presses on a legacy card, with or without a repeated
  `action_ts`, decide nothing, record no invocation and show review;
- a rate limit and five 503s follow the owner's schedule without client
  retries, exhaust visibly and recover once on request;
- an unlinked recipient waits for repair, a Telegram success for the same
  assignment leaves the Slack incident open, a Telegram chat save does not
  re-arm Slack work, and linking the account delivers through a newly opened DM;
- a closed DM waits for repair and is re-armed when the recipient writes to
  the bot; a revoked token is `unavailable`;
- preference off and approvals disabled are suppressed;
- a card that went stale in flight is tracked and retired; a failing update
  keeps the approved absence and retries; a deleted message and a replaced
  workspace become `gone`;
- three concurrent workers send once;
- without a control the existing Slack path still sends; with one it stays
  silent for the absence and its approval request;
- privileged cleanup removes and reports Slack work and messages.

Unit seams: `slack/delivery-outcome.test.ts`, `slack/approval-card.test.ts`,
`escalation/attention.test.ts`.

## Discord reviewed decisions and delivery — #292 / T28

Discord uses the same prepared presentation, reviewed bindings, decision owner
and delivery owner as Telegram. It adds no persistence, authority or dispatch
of its own. Migration `0091_discord_approval_delivery.sql` only widens the
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
  nothing. If it fails, nothing is decided (Discord shows the press as failed).
  The follow-up reports the committed outcome, even when updating the card
  fails. When the outcome is unknown (the decision call failed), it says so and
  claims nothing; the same interaction replays if the decision did commit. Discord documents no inbound
  interaction redelivery, so nothing relies on one.
- **Destination.** Cards go only to the recipient's DM, opened through Discord
  from their active `discord_user_mapping` in the organization. The stored
  `discord_conversation` channel may be a server channel and is not used for
  approval cards (legacy path included). No link is `destination_invalid:destination_missing`;
  closed DMs (50007), an unknown channel or user and missing access are
  `destination_invalid`. Any later interaction by the recipient with the
  Discord bot (`saveConversation`) re-arms that Discord work only; destination
  repair is scoped to the provider (Telegram's re-arms Telegram work only).
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

Apply `0091` after `0090`, then per organization, after the #290/#291 gates:
insert `approval_presentation_control (…, 'discord', 'actionable')` under the
rollout lock as for Telegram, and
`approval_delivery_control (:org, 'absence', 'discord')`.

### Activation blockers (#292, unresolved)

1. Apply `0091` through the authorized deployment. It has run only on the
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
HTTP transports, vault, session and side channels are replaced. 13/13 passing:

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
- no link and closed DMs wait for repair; `saveConversation` re-arms Discord
  work only, never another provider's;
- a card that went stale in flight is tracked and retired;
- Telegram and Discord decisions refresh each other's cards;
- without a control the existing path sends to the DM; with one it is silent;
- cleanup removes and reports Discord work, messages and invocations.

Unit seams: `discord/bound-approval.test.ts`, `discord/delivery-outcome.test.ts`,
`discord/approval-card.test.ts`.
