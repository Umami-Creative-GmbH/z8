# Approval card delivery — #291 / T27, #294 / T30, #293 / T29

One durable owner sends approval cards and keeps them current. It covers
Telegram cards (#291), review-only Slack cards (#294) and Teams cards (#293)
for canonical absences, and, since #296, Telegram cards for legacy-authoritative
expense claims (see "Legacy lifecycles"). It is **inactive for every
organization**: migrations `0086_approval_delivery.sql`,
`0090_approval_delivery_slack.sql`, `0091_teams_approval_actions.sql` and
`0092_legacy_expense_presentation.sql` insert no control rows.

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
  escalation's replacement delivery (#300). The owner does refresh the messages
  of the assignment they replaced.

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
- **Version.** One plus the number of the claim's decided legacy requests.
  Decisions only move forward, so it only increases; a two-stage chain moves 1 →
  2 → 3.
- **State.** Before sending, the owner rechecks that the request and claim are
  pending and that the request's approver is still the recipient (otherwise
  `cancelled`, `obsolete`). A refresh reports the recipient's own committed
  legacy decision evidence and the claim's current status.
- **Rows.** Work and messages carry `lifecycle = 'legacy'`, the kind, the source
  and the exact legacy request (FK to `approval_request`, cascading), never a
  workflow, stage or assignment. A message's review link is its legacy request.
  Attention incidents use the `legacy_assignment` subject.
- A press on a still-pending legacy card that decided nothing becomes a review
  notice in the webhook, as for canonical cards; a decided card is refreshed by
  the owner only.

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
  is saved again, or they link their Slack account, their `destination_invalid`
  work for that provider is re-armed. `unavailable` work (bot missing or token
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
3. **Legacy authority.** Legacy absences are #384. Legacy expense claims are
   delivered since #296 (their own blockers are in
   [Approval evidence](approval-evidence.md), "Expense review, decisions and
   cards").
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
