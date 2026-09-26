# Approval card delivery — #291 / T27, #294 / T30, #293 / T29, #292 / T28

One durable owner sends approval cards and keeps them current. It covers
Telegram cards (#291), review-only Slack cards (#294), Teams cards (#293) and
Discord cards (#292, see its section at the end) for canonical absences, and,
since #296, Telegram cards for legacy-authoritative expense claims and, since
#384, legacy-authoritative absences (see "Legacy lifecycles"). Since #325 it also delivers canonical manual time submissions,
policy clock-outs and time corrections (Telegram verified; see "Time approval
presentation and bound decisions" in [approval evidence](approval-evidence.md)),
and since #432 their legacy-authoritative cycles (see "Submission cycles"). It is **inactive for every organization**: migrations
`0086_approval_delivery.sql`, `0090_approval_delivery_slack.sql`,
`0091_teams_approval_actions.sql`, `0093_legacy_expense_presentation.sql`,
`0094_discord_approval_delivery.sql`, `0108_legacy_absence_presentation.sql` and
`0109_legacy_escalation_replacement_delivery.sql` insert no control rows.

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

Teams adapter (#293)                                    lib/teams/approval-delivery.ts
  bot credentials, active tenant with approvals enabled, recipient's personal
  conversation in that tenant, prepareApprovalPresentation (provider "teams")
  proactive send / update with explicit outcomes   (bot-adapter.ts, delivery-outcome.ts)
```

### Teams specifics (#293)

- Message identity: receiver scope `teams-bot:<app id>:tenant:<tenant id>`,
  destination = the personal conversation ID, remote message = the activity ID
  the connector returned. A send that returns no activity ID is `ambiguous`
  (`no_message_identity`): the message cannot be tracked or retired, and the
  retry may duplicate it.
- A refresh updates the message through the stored reference of its
  conversation (active or not). Another bot or tenant, or an unknown
  conversation, makes the message `gone`.
- Connector failures: 429, 409 and 412 are `retryable`; network errors,
  timeouts (30 s) and 5xx are `ambiguous`; 401 is `unavailable`; 403 and 404
  are `destination_invalid` for a send (blocked, uninstalled, conversation not
  found) and `gone` for an update; other 4xx are `permanent`. No bot
  credentials or no tenant configuration is `unavailable`; an inactive tenant
  or approvals disabled is `suppressed`; a stored conversation from another
  tenant is `destination_invalid`.
- An organization can connect several tenants. A send uses the tenant of the
  recipient's personal conversation; a refresh uses the tenant named in the
  message's receiver scope, never an arbitrary tenant of the organization.
- Destination repair: a personal conversation saved for the recipient (they
  messaged the bot) re-arms their Teams `destination_invalid` work. Repair is
  per provider: a Telegram chat does not re-arm Teams work, and the reverse.
- The existing Teams channel stays silent for an absence with a canonical
  workflow while the Teams owner is active, both for `absence_entry` and for
  `approval_request` notifications of that absence. The old sender
  (`sendApprovalCardToManager`) checks the same condition itself, so the
  legacy Teams escalation checker cannot send a second card either.
- Pressed cards: see "Teams absence cards with reviewed bindings" in
  [approval-evidence.md](approval-evidence.md).

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
  escalation's replacement delivery ([#300](#escalation-replacement-delivery--300--t36)).
  The owner does refresh the messages of the assignment they replaced. So do
  legacy requests that escalation ever transferred
  ([#408](#legacy-escalation-replacement-delivery--408)): the owner plans no
  initial card for them, but refreshes their messages after a decision.

## Legacy lifecycles (#296)

Expense claims have no workflow, so their lifecycle is the claim (a claim
leaves draft once) and its legacy requests stand in for assignments.

- **Intents.** The expense submission and decision owners write an
  `approval_delivery_intent` row (`submitted` or `decided`, naming the claim and
  the legacy request that changed) in the transaction that changes the
  lifecycle, only while a delivery control exists for `(organization,
  travel_expense)`. The owner expands them like outbox rows, only while the kind
  has legacy authority there and only for intents created at or after the
  control's activation.
- **Plan from current state.** One initial card per pending legacy request and
  owned provider (dedupe `legacy-initial:<request>:<provider>`), cancellation of
  initial work whose request is no longer pending, and a refresh of every known
  message whose request is decided and whose version is behind.
- **Version.** One plus the number of the claim's decided legacy requests and
  of its recorded escalation transfers (`transferred` intents, #408).
  Decisions and transfers only move forward, so it only increases; a two-stage
  chain moves 1 → 2 → 3.
- **State.** Before sending, the owner rechecks that the request and claim are
  pending and that the request's approver is still the recipient (otherwise
  `cancelled`, `obsolete`). A refresh reports the recipient's own committed
  legacy decision evidence and the claim's current status.
- **Rows.** Work and messages carry `lifecycle = 'legacy'`, the kind, the source
  and the exact legacy request (by value since #384), never a workflow, stage
  or assignment. A message's review link is its legacy request. Attention
  incidents use the `legacy_assignment` subject.
- A press on a still-pending legacy card that decided nothing becomes a review
  notice in the webhook, as for canonical cards; a decided card is refreshed by
  the owner only.

### Submission cycles (#384)

A source can have several independent submission cycles (a work period's
submission and each correction, #432; legacy absences create one per source). A cycle-keyed legacy lifecycle is one
cycle: `legacy_cycle_id` names the legacy chain instance, or the single legacy
request, that one submission created, on intents, work and messages. Rows
without it keep the source-scoped expense lifecycle above, unchanged.

- **Intents.** Legacy absence submission (`submitted`), decision (`decided`, the
  decided request's cycle) and ordinary cancellation (`withdrawn`, one per
  cycle, written before the pending requests are deleted) write the cycle's
  intents, only while a delivery control exists for `(organization, absence)`.
  Legacy time kinds (#432) do the same: the ordinary (manual submission, policy
  clock-out) and correction submission owners write `submitted`, both decision
  owners (web and card) `decided`, and requester correction cancellation
  `withdrawn`, each keyed by the work period and the cycle, only while a
  delivery control exists for `(organization, kind)`.
- **Membership.** The cycle's live requests are its single request, or the stage
  requests of its chain. Initial cards, cancellation of initial work and
  refreshes are scoped to the cycle's rows.
- **Version.** The number of the cycle's intents. Every lifecycle change writes
  one while a control exists and only the purge deletes them, so the version
  only increases, also across cancellation (which deletes the pending
  requests). A two-stage chain moves 1 → 2 → 3; a withdrawal adds one, and so
  does each escalation transfer (#408). A cycle
  submitted before the control has no `submitted` intent; its first owned
  intent (a decision) makes it version 1. The owner plans only from intents
  created at or after the control's activation, so it never sends that cycle's
  earlier stages, and the version counts only changes it could have delivered.
- **State.** The cycle's status is its chain's, or its single request's; a
  deleted absence or request reads as `cancelled` (the card says the request
  was withdrawn). A time cycle with a `withdrawn` intent reads as `cancelled`:
  cancelling a direct legacy correction keeps its request as a tombstone that
  looks rejected (#301).
- **Surviving cancellation.** Ordinary absence cancellation deletes the absence
  and its pending legacy requests. The delivery rows' request FKs are dropped
  (`0108`), so the cycle's work, messages and intents stay until privileged
  cleanup, and its sent cards are refreshed to "withdrawn".
- **Old path.** `isApprovalNotificationDeliveredByOwner` treats a legacy absence
  cycle as owner-delivered when the owner owns one of its intents (created at
  or after the provider's control activation), so the old path sends neither a
  card nor a message for it. A notification naming an exact request checks
  that request's cycle; one naming only the absence checks any of its cycles.
  A legacy time cycle (#432) likewise, while its kind has legacy authority; a
  notification naming only the work period checks the cycles of its pending
  requests.

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

`deleteApprovalInTransaction` locks the delivery tables, deletes the
lifecycle's delivery work and messages through its verified workflows (or, for
legacy lifecycles, its legacy requests, together with their intents) and
reports them as `delivery.work`, `delivery.messages` and `delivery.intents`
(platform-admin card, CLI and audit). A
send that completes after the purge cannot record its message: the workflow FK
fails and the owner reports `delivered_after_purge`. Legacy rows keep their
request by value (#384), so a legacy message is recorded only while the work
that sent it still exists; the message insert serializes with the purge's
table locks. Legacy cycles are purged through their requests and their cycle
(including requests deleted by cancellation), and an orphaned cycle is
addressable by its cycle ID. Escalation's legacy replacement work and
`transferred` intents (#408) are also purged through their transfer, before
the journal they would otherwise cascade from unreported.

## Activation

Apply `0086` after `0085`. Deploy a release with the owner to every worker and
app instance, then, per organization and after the #290 gates:

```sql
insert into approval_delivery_control (organization_id, workflow_type, provider)
values (:org, 'absence', 'telegram');
-- #294, after 0090:
insert into approval_delivery_control (organization_id, workflow_type, provider)
values (:org, 'absence', 'slack');
-- Teams (#293), after 0091:
insert into approval_delivery_control (organization_id, workflow_type, provider)
values (:org, 'absence', 'teams');
```

Deleting the row stops the owner. Unfinished work stays for recovery, but
canonical absence submissions then send no Telegram card at all.

### Activation blockers (#291, unresolved)

1. Apply `0086` through the authorized deployment. It has run only on the
   disposable PostgreSQL 16 database.
2. **Old binaries.** Instances without this release neither run
   `cron:approval-delivery` nor kick the owner; delivery then waits for an
   upgraded worker. Insert controls only after every instance is upgraded.
3. **Legacy authority.** Legacy expense claims are delivered since #296 and
   legacy absences since #384 (their own blockers are in
   [Approval evidence](approval-evidence.md), "Expense review, decisions and
   cards" and "Legacy absence cards, bound decisions and cycle delivery").
4. **Escalation replacement delivery** is #300 (see below).
5. **In-place material changes** without a workflow transition commit no
   intent, so the card is not refreshed. Pressing it decides nothing.
6. **Untracked duplicates.** A crash between Telegram's acceptance and tracking
   leaves one message without an identity. It keeps its controls, which decide
   only while the assignment is pending.
7. **Activation handover.** Pending workflows whose intents predate
   `activated_at` get no card from the owner (in-flight classification).
   Decided for the pilot (#328, 2026-09-25): web inbox only, no backfill. The
   readiness report counts them; see [Approval card pilots](approval-pilot.md).
8. **Refresh incidents** close through the existing attention recheck once the
   approval is settled. The exhausted work row stays visible.
9. **Ingress.** No durable acceptance before the webhook acknowledgment.
10. Everything in the #290 and canonical evidence blockers (in-flight
   classification, pilot #328/#330; cleanup ordering resolved in #306).
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
of its own. Migration `0094_discord_approval_delivery.sql` only widens the
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

Apply `0094` after `0093`, then per organization, after the #290/#291 gates:
insert `approval_presentation_control (…, 'discord', 'actionable')` under the
rollout lock as for Telegram, and
`approval_delivery_control (:org, 'absence', 'discord')`.

### Activation blockers (#292, unresolved)

1. Apply `0094` through the authorized deployment. It has run only on the
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

- `approval_delivery_work.escalation_transfer_id` (migration `0096`) links work
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
  preference (`enable_escalations` on the Telegram bot, the Slack workspace,
  the Discord bot or any of the organization's Teams tenants) is on at that
  moment. A Teams
  replacement is sent only if the recipient's own tenant has it on.
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
  - the recipient's `approval_request_submitted` preference for the channel is on;
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

1. Apply `0096` after `0095` (#308) through the authorized deployment. It has
   run only on the disposable PostgreSQL 16 database.
2. Everything under the #291, #294 and #292 blockers and "Teams specifics
   (#293)" above, the escalation activation blockers in `escalation-transfer.md`
   (ownership writer, drained cutover) and the pilot gates.
3. ~~**Legacy-authoritative transfers** (#299)~~ — resolved by #408 for
   absences and travel expenses (see
   [Legacy escalation replacement delivery](#legacy-escalation-replacement-delivery--408)),
   and by #470 for legacy time transfers (#439).
4. **Adapter coverage.** All four adapters (Telegram, Slack, Teams, Discord)
   implement the escalation-delivery checks. Slack replacement cards are
   review-only, like every Slack card (#294). The PostgreSQL suite covers
   Telegram only; the Slack, Teams and Discord checks are verified by
   typecheck and shared code.
5. **Old binaries** neither run the replacement pass nor claim by owner. A
   pre-#300 delivery-owner binary (#291, #294, #293, #296 or #292) would claim
   escalation work too: it would cancel a replacement card as `purged` (it has
   no message) and retire former cards with the generic inactive wording,
   which is never corrected afterwards.
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

## Legacy escalation replacement delivery — #408

A committed legacy-authoritative escalation transfer (#299 absences, #326
travel expenses, #439 manual time submissions, policy clock-outs and time
corrections) moves the **same** legacy request to its replacement. Since
#408 (#470 for time kinds), escalation's replacement pass expands its event
into the legacy delivery lifecycle (#296, cycle-keyed for absences since #384
and for time kinds since #432): the
replacement gets its own card, and the former holder's cards are edited into
**Reassigned**. It reuses #300's pass, transport, tracking, leases, retries,
attention and recovery, and it is inactive wherever the kind has no delivery
control (`0109` inserts no control row).

```text
legacy transfer (one transaction, unchanged)                escalation/legacy-transfer.ts
  request.approver_id := replacement · journal row + immutable delivery event
after commit: kickApprovalDelivery (best effort) · cron:approval-delivery (every minute)

processEscalationReplacementDeliveries(org, limit)      escalation/replacement-delivery.ts
  expand pending legacy events (absence / travel_expense / time kinds, kind under legacy authority)
    transferred intent  once per transfer, born expanded  → lifecycle version + 1
    replacement         per frozen channel      dedupe replacement:<transfer>:<provider>
    adoption            old-path cards of the former holder (telegram_approval_message)
    retirement          former holder's messages  dedupe refresh:<message>:<version> (shared)
  cancel legacy replacement work whose request is no longer pending with its recipient
  lease due escalation work → the shared executor (owner.ts)
```

### Representation

- Work and messages carry `lifecycle = 'legacy'`, the kind, the source, the
  exact legacy request and (absences, time kinds) the submission cycle, never a workflow,
  stage or assignment. Replacement work names its transfer
  (`escalation_transfer_id`), and through it the lineage position
  (`legacy_source_sequence`); its recipient is the replacement. A shadow/ready
  observation is never named.
- The replacement card's dedupe key is keyed by the transfer, so it never
  collides with the former holder's `legacy-initial:<request>:<provider>`, and
  a second transfer of the same request gets its own card.
- **Version.** The request stays the same, so a transfer would not change the
  lifecycle's version and the former holder's cards could not be retired
  (their version only increases). The pass records each transfer as an
  `approval_delivery_intent` with event `transferred` and
  `escalation_transfer_id` (unique per transfer; migration `0109`). It is
  inserted already expanded, so the #291 owner never dispatches it; a cycle
  counts it like any intent, and a source-scoped expense lifecycle adds its
  `transferred` intents to its version.
- **Replaced.** A legacy message is the former holder's once a committed
  legacy transfer of its request moved it away from the recipient and no later
  transfer moved it back (`isApprovalDeliveryAssignmentReplaced`). Transfers
  keep the request by value, so this survives cancellation. The request's
  status cannot tell: after the replacement decides, the same request is
  decided.

### Expansion and ownership

- The same rules as #300: channels are frozen at the first expansion
  (controls active at the transfer, escalation delivery enabled now), the
  event stays locked until its work commits, a crash re-expands it, and
  expansion never repeats the transfer. Events that #300 left `pending` expand
  once this ships.
- The pass expands a legacy event only while the kind has legacy authority
  (rollout not `canonical`/`complete`) and only for absence, travel expense
  and (#470) time subjects (`time_entry` with a time kind). Otherwise the event
  waits (`pending`). A time event is delivered in the cycle its request's
  delivery rows recorded, else the request itself: #439 transfers only direct
  requests, never chain stages. Another cycle of the same work period is
  untouched. Without any delivery control
  for the kind the event expands to nothing: no card of the kind is owned and
  nothing could be claimed.
- Transfer-linked work is claimed only by escalation's pass. The #291 owner
  plans no initial card for a request that escalation ever transferred (like
  a replacement assignment), so a request whose first card was never sent does
  not get a second one from the owner. Owner refreshes after a decision still
  cover every card of the lifecycle.
- Human (management) and scheduled legacy transfers kick both passes after
  commit.

### Sending

- The shared executor rechecks right before the send: the kind still has
  legacy authority (otherwise `cancelled`, `authority_changed`), the request is
  pending and its current approver is still the recipient, and no later
  transfer superseded the work (otherwise `cancelled`, `obsolete`: decided,
  withdrawn or transferred again), the
  recipient is an active employee, their preference allows the channel, and
  the adapter's integration and escalation-delivery checks. The shared
  presentation checks membership and entitlement.
- Absence cards are actionable through #384's legacy bindings when its gates
  hold (Telegram only), review-only otherwise; expense cards follow #296's
  legacy binding rules; time cards follow #432's (`prepareBoundLegacyTimeCard`,
  Telegram only). The binding names the replacement, never the former holder.
- Outcomes, retries (1 min, 5 min, 30 min, 2 h, 12 h), `awaiting_repair`,
  exhaustion, **Retry delivery** and destination repair follow the table above.
  Attention uses the `legacy_assignment` subject (request and replacement).
  Obsolete replacement work is cancelled by the pass; its incidents close
  through the attention recheck. Delivery failure never changes legacy
  authority, and delivered work is never resent.

### Former cards

- Every tracked card of the former holder for the request is refreshed into
  #300's **Reassigned** wording (no decision needed or made here, review link
  kept, replacement and outcome never named). This covers owner-delivered
  cards (#296/#384), duplicates and late sends (each keeps its own message
  row), and a card that landed after the transfer (stale on arrival: its
  refresh is planned when it is recorded, or at expansion if it landed first).
- **Old-path cards.** Cards the old notification path sent before the owner
  delivered the kind (`telegram_approval_message`, same request and former
  recipient) are adopted at expansion as legacy messages (status version 0,
  with controls) from every provider that has a delivery control for the kind
  now, and retired like the owner's. The old path records no bot identity: an
  adopted card is addressed through the organization's current bot, and a card
  another bot sent reads as `gone`.
- A press on a former card, bound or unbound (pre-binding callback data),
  decides nothing (#384/#326 revocation) and is acknowledged as **Reassigned**;
  the webhook never edits it.
- Later owner refreshes (after the replacement decides, or after the absence is
  withdrawn) keep former cards **Reassigned** and never restore controls; the
  replacement's own card shows the decision or the withdrawal.
- A second transfer retires the first replacement's cards (including its
  duplicates) and delivers to the new holder. A card of a holder who later got
  the request back (A → B → A) counts as the holder's again.

### Cutover and cleanup

- Legacy replacement and retirement work acts only while the kind has legacy
  authority; canonical escalation work (#300) only while it has canonical
  authority. After a cutover between planning and send the work is cancelled
  (`authority_changed`), so neither authority acts through the other's cards.
- `deleteApprovalInTransaction` removes and reports legacy replacement work,
  retirements, adopted and delivered messages and `transferred` intents through
  the request, the cycle and the transfer. A send completing after the purge
  records nothing (`delivered_after_purge`).

### Activation blockers (#408, unresolved)

1. Apply `0109` after `0108` through the authorized deployment. It has run only
   on the disposable PostgreSQL 16 database.
2. Everything under the #291, #296, #384 and #300 blockers above and in
   [Approval evidence](approval-evidence.md), and the escalation activation
   blockers in `escalation-transfer.md`.
3. **Old binaries.** A pre-#408 delivery owner plans initial cards for
   transferred requests and treats a former holder's legacy card as still
   actionable: an unlinked retirement it claims finishes as `still_actionable`
   without editing the card, which is never corrected afterwards. Deploy to
   every worker and drain old workers before an organization with a delivery
   control for absences or travel expenses lets escalation own transfers. A
   pre-#470 replacement pass leaves legacy time events `pending`, so their
   new holder gets no card until a #470 worker expands them (once). Pre-#432
   binaries are covered by the #432 blockers.
4. **Old-path cards are adopted at expansion only.** An old-path card still in
   flight when the transfer expands, or one sent through a provider without a
   delivery control for the kind, is not adopted: it keeps its controls on
   screen, and a press decides nothing.
5. **Providers.** Telegram is the only provider verified at runtime. Slack
   replacement cards are review-only; Teams and Discord share the code path
   but stay unadmitted for legacy kinds (review-only), with typecheck and
   shared-code evidence only.
6. ~~**Legacy time transfers** (#439)~~: resolved by #470, which depends on
   #432's legacy time cards and must not be deployed without them.
7. **Pilot report.** The readiness report still holds
   `escalation_replacement_unsupported` for legacy absences, and
   `legacy_transfer_without_replacement` for any legacy event still pending;
   revisit them in the pilot (#423). Since #470 legacy time kinds are held
   only by `escalation_delivery_disabled` (frozen channels).
8. A cutover cancels planned work; a later rollback does not re-plan it (the
   former card keeps its last state and decides nothing). A retirement the
   delivery owner planned itself (a former card that landed after the
   expansion) is not transfer-linked and follows the owner's existing legacy
   rules, not escalation's authority recheck.
9. **Untracked duplicates** (#291 blocker 6) apply to replacement cards too.
10. **Cross-tenant evidence.** Every new query filters by organization; the
    suite seeds a second organization but no foreign delivery or transfer rows,
    so tenant isolation is verified by review, not at runtime.

### Verification (#408)

PostgreSQL 16 (`lib/approvals/escalation/legacy-replacement-delivery.integration.test.ts`,
part of `test:approval-workflow-repository:integration`). It drives the real
`requestAbsenceEffect`, the travel expense draft/upload/submit actions,
`processApprovalDeliveries`, `processDueEscalations`, the management transfer
action, `processEscalationReplacementDeliveries`, `handleTelegramUpdate`,
`sendApprovalMessageToManager`, `approveAbsenceEffect`,
`approveTravelExpenseClaim`, `cancelAbsenceRequest`,
`recoverApprovalDeliveryForAttention`, `saveConversation`,
`recheckEscalationAttention` and `deleteApproval`. 21/21 passing:

- Absence and expense: one bound replacement card to the backup and the former
  card edited into Reassigned without controls; the version moves on
  (submitted/claim → transfer); reruns of both passes send nothing more.
- Absence and expense: a press on the former card (before and after its
  retirement) decides nothing and is acknowledged as Reassigned; the
  replacement decides from its card; the owner's refresh shows the decision on
  the replacement's card and keeps the former card Reassigned.
- Absence and expense: an old-path card of the former holder is adopted and
  retired; bound and unbound presses on it decide nothing.
- A former card that landed after the transfer is retired, whether escalation
  expanded before or after it landed. A replacement card that went stale in
  flight (the replacement decided on the web meanwhile) is tracked and shows
  the decision afterwards.
- A replacement superseded by a later transfer back to the same holder
  (A → B → A → B) is cancelled, and only the latest transfer's card is sent.
- A lease-takeover duplicate of the replacement card and a second
  (management) transfer: both duplicates are retired as Reassigned, the new
  holder gets a card and decides; every card ends without controls.
- Recheck failures send nothing: decided and transferred again (`obsolete`),
  recipient inactive, preference off, escalation delivery disabled, not
  entitled; the former card is retired regardless.
- Channels are frozen at the first expansion; expanded work is never claimed
  by the delivery owner; a kind without a delivery control expands to nothing.
- A crash during expansion leaves the event pending; escalation transfers
  nothing more; three concurrent passes expand once and send one card.
- 502 ×6 exhausts with `delivery_exhausted` on the legacy subject, recovery
  sends once through escalation's pass; a permanently failed expense
  replacement is cancelled after the decision and its incident closes on
  recheck. A missing destination raises `delivery_unavailable` and saving the
  chat delivers.
- Review-only presentation gives a review-only replacement card and no binding.
- `shadow` and `ready` absences: the replacement decides from its card; the
  observation never becomes authority and no canonical delivery row exists.
- Cutover: an event waits under canonical authority and expands once back
  under legacy authority; canonical authority between planning and send
  cancels both effects (`authority_changed`). The #300 suite covers the
  opposite direction.
- An absence cancelled after the transfer: the replacement's card says
  withdrawn, the former card stays Reassigned; an unsent replacement is
  cancelled.
- Privileged cleanup reports exactly the lifecycle's work, messages and
  intents and the journal, leaves another lifecycle untouched, and a
  replacement card in flight during the purge records nothing.

Unit seam: `maintenance.test.ts` (legacy replacement work and transfer intents
are deleted through the transfer, before the journal).

### Verification (#470)

Legacy time transfers, in `lib/telegram/legacy-time-bound-approval.integration.test.ts`
(the #432 suite: real time submission actions, the delivery owner,
`processDueEscalations`, `processEscalationReplacementDeliveries`,
`sendApprovalMessageToManager`, `handleTelegramUpdate` and
`cancelMyTimeCorrectionRequest`), 15 cases:

- `legacy`, `shadow` and `ready` × manual submission, policy clock-out and
  correction: after a scheduled transfer, a press on the former holder's card
  decides nothing and is acknowledged as Reassigned. The pass records the
  `transferred` intent in the request's cycle, sends the backup one bound
  actionable card and edits the former card into Reassigned without controls.
  Reruns of both passes send nothing. The backup decides from the card (the
  invocation names the backup), a late former press decides nothing, and the
  owner's refresh shows the decision on the backup's card while the former
  card stays Reassigned. No canonical delivery row is written.
- Each kind: the old path's bound card of the former holder (sent before the
  kind's delivery control) is adopted and retired. Bound and unbound presses
  on it decide nothing.
- Two cycles on one work period: the transferred correction's cards move on
  while the approved manual cycle's card is untouched. The requester's
  withdrawal refreshes the backup's card to withdrawn and keeps the former card
  Reassigned.
- A correction withdrawn before the pass: the replacement is cancelled
  (`obsolete`), nothing is sent, and the former card is still retired.
- Cutover: the event waits under canonical authority and expands once back
  under legacy authority.

The #408 suite adds the expansion gate for a legacy time event committed
before #470 (seeded rows): it expands into its request's cycle under legacy
authority and keeps waiting under canonical authority in the same pass.
Reverting the expansion change makes all 15 time cases fail.
