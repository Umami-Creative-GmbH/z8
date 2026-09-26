# Approval card pilots — #328 / T63, #330 / T65

The limited organization pilots of approval cards: absence and expense cards
(#328), which run independently of timekeeping work, legacy absence cards (#384,
see [Legacy absence cards](#legacy-absence-cards-384--459)), and time approval
cards and their escalation (#330, see
[Time approval cards](#time-approval-cards-330--t65)).
This page covers the readiness report,
the order of the operator steps, the in-flight decision and the evidence each
step needs. The activation SQL itself lives with each slice:
[Approval evidence](approval-evidence.md) (#287, #290, #293, #296, #325, #384),
[Approval card delivery](approval-delivery.md) (#291–#294, #300),
[Escalation transfer](escalation-transfer.md) (#326) and
[Legacy escalation fencing](legacy-escalation-fencing.md) (#271).

Nothing here activates anything. Every control change stays with the
authorized adoption writer, under the exclusive rollout lock where the slice
says so.

## Readiness report

```bash
pnpm approvals:pilot-readiness --organization-id <org-id>
pnpm approvals:pilot-readiness --organization-id <org-id> --json
```

It uses the same database configuration and operator access as
[Approval maintenance](approval-maintenance.md). The report is one
`repeatable read`, `read only` transaction scoped to the organization. It
changes nothing, and an unknown organization ID is an error, not an empty
report. `--json` prints the full report for the evidence record. The owner is
`assessApprovalPilotReadiness` in `apps/webapp/src/lib/approvals/pilot/readiness.ts`.

The report classifies three things separately.

**Kinds** (`absence`, `travel_expense`, `manual_time_submission`,
`policy_clock_out`, `time_correction`): the authority deciding the kind now
(the rollout's `lifecycle_mode`), the evidence mode, and every pending
lifecycle by its submitted evidence. The same review preparation that the inbox
and the decision owner use does the classification, so a held lifecycle here
is exactly one that cannot be decided from a card. Absences are classified
against the revision of the authority deciding them now: the #288 legacy owner
binds only a legacy revision, the canonical owner only a canonical one. For the time kinds the
lifecycles are the pending canonical workflows, the only ones a time card
represents, checked with the time card's own revision and fact gates
(`classifyCanonicalTimeCard` in `presentation/time-card.ts`, which the card
path itself uses). Legacy time requests are
classified by the [time pilot report](time-pilot.md) (#329):

| Class | Meaning |
| --- | --- |
| `current` | Evidenced and still matching; decidable from a bound card. |
| `notCaptured` | No submitted revision (e.g. submitted before capture). Held while capture is on. |
| `materialChange` | Live facts changed after submission. Held until a supported resubmission. |
| `authorityChange` | Evidence of another authority (a legacy revision under canonical authority, or a canonical revision under legacy authority after a rollback, which the legacy owner holds as evidence required). Held. For time kinds: a workflow without its own canonical revision whose mirrored request has a legacy capture, e.g. a request submitted under `shadow` before the cutover. |
| `reviewOnly` | Time kinds only: current evidence the card cannot state (no employee name captured, an unnamed or deleted category, a change the mask names but the proposal lacks). The card is review-only; the web inbox still decides. Not held. |

**Card combinations** (kind × Telegram, Teams, Slack, Discord): whether the
delivery owner owns the combination (`approval_delivery_control` and its
`activated_at`), its delivery work by status, and findings.

The report does not classify committed invocations, decision receipts or
evidence history: they are immutable, keep replaying after any pause, and are
only removed by privileged cleanup. Nor does it see legacy expense
reassignments, which get no replacement card (#296 blocker 5).

**Escalation** (organization-wide): the owner in `approval_escalation_control`
(`legacy` when no row exists), pause, `escalation_owned_since`, the migrated
policy, the committed transfer journal and open administrative-attention
incidents by reason.

Each combination and the escalation section get a verdict: `blocked` when any
finding is a blocker, `hold` when there are only holds, `ready` otherwise. A
hold needs an explicit operator decision (usually: accept, or wait until it
drains). It is never cleared by the report.

### Findings

| Code | Severity | Meaning and action |
| --- | --- | --- |
| `authority_not_canonical` | blocker | Time cards need canonical authority: legacy time approvals stay review-only on bots (#432). Absences are admitted under both authorities (legacy since #384, see [Legacy absence cards](#legacy-absence-cards-384--459)). |
| `authority_complete_unsupported` | blocker | Absence and time kinds in `complete` mode: presentation starts from the stage's compatibility request, which `complete` no longer writes, so the owner's work becomes `unsupported_route` attention instead of a card (#325 blocker 2). |
| `authority_not_legacy` | blocker | Expense cards exist only under legacy authority (#296); a canonical expense rollout has no card path. |
| `evidence_capture_inactive` | blocker | Turn on `approval_evidence_control` first (#287, #295). |
| `presentation_not_actionable` | blocker | Actionable providers need `approval_presentation_control = actionable` (#290, #293, #292, #296, #325). Slack needs none: it is always review-only. |
| `combination_unverified` | blocker | Pilot decision: expense delivery is admitted on Telegram only, the one verified path (#296). #296 forbids only the actionable Teams row; Discord and Slack expense cards would be review-only but have never been exercised, so the pilot does not activate them either. Time cards are admitted on Telegram, plus the Slack review-only summary; Teams and Discord share the bound path but were never exercised for time kinds (#325 blocker 3). Legacy absence cards are admitted on Telegram only (#384 blocker 7): the owner would deliver a legacy cycle to Teams, Discord and Slack too, but those cards were never exercised under legacy authority. |
| `presentation_actionable_unverified` | blocker | An `actionable` row on an unverified combination (expense on Teams, Slack or Discord; a time kind on Teams or Discord) would make unverified cards actionable. Remove it. Not raised for legacy absences: their Teams and Discord cards stay review-only in code whatever the row says (`LEGACY_ABSENCE_ACTIONABLE_PROVIDERS`), and the row belongs to canonical absence cards, which it admits after the cutover. |
| `provider_not_configured` | blocker | No active integration with approvals enabled (for Teams: no such tenant). |
| `escalation_delivery_disabled` | hold | Absence and time kinds under canonical authority (the canonical kinds escalation transfers, #326), while escalation owns transfers (owner `escalation`, not paused, policy enabled): the integration has `enable_escalations` off (Teams: on for no tenant). Channels are frozen when a transfer is expanded (#300), so a backup gets no replacement card here, only the web inbox. |
| `escalation_replacement_unsupported` | hold | Legacy absences while escalation owns transfers (owner `escalation`, not paused, policy enabled), on every configured provider: a legacy transfer sends the new holder no card and leaves the former holder's card unrefreshed; that card decides nothing (#384 blocker 5, #408). The backup decides in the web inbox. |
| `legacy_chain_mode_unverified` | hold | Legacy absences in `shadow` or `ready` mode. Chain submissions work there since #453, but chain cards were verified in `legacy` mode only (#384 blocker 4). The count, when present, is the number of pending chain cycles; zero pending chains does not mean none will be submitted, so check whether the organization's absence policies route to chains before accepting. |
| `evidence_held` | hold | Pending lifecycles held for evidence (count = `notCaptured` + `materialChange` + `authorityChange`), now or, while capture is still off, as soon as it is turned on. A held lifecycle is refused for approve and reject everywhere, the web inbox included. Absences leave the hold by cancellation and resubmission; held expense claims have no cancellation path and raise no attention record (#296 blocker 4), so they are not in `attention_open`. Otherwise drain them, or record reconstructed revisions through a separately authorized step (not implemented). Nothing backfills them. |
| `card_review_only` | hold | Time kinds: pending lifecycles counted as `reviewOnly`. Their approvers get a review-only card and decide in the web inbox. |
| `in_flight_before_activation` | hold | Pending lifecycles without a lifecycle intent at or after `activated_at` (or, before activation, every pending lifecycle). The owner never sends them a card. Legacy absences count by submission cycle (the chain instance, or the single request): a cycle whose next stage was decided after activation has an owned intent and is carded from then on. See [In-flight decision](#in-flight-decision). |
| `legacy_cards_historical_only` | hold | Unanswered cards of the pre-owner path (`telegram_approval_message`, `teams_approval_card`, `slack_approval_message`, `discord_approval_message`) on pending approvals. They are not refreshed. A press revalidates at commit and decides nothing on its own. A time card counts under the kind of the canonical workflow whose stage mirrors its request. A card on a legacy time request without a mirroring workflow (submitted under `legacy`, before `shadow`) has no kind and is **not counted anywhere**; check `telegram_approval_message` and the other card tables directly if such requests are still pending (the time pilot report lists them as pending legacy approvals). |
| `delivery_awaiting_repair` | hold | Work waiting for a destination (unlinked recipient, closed DMs, stale workspace DM). It re-arms when the recipient reaches the bot. |
| `delivery_exhausted` | hold | Retries exhausted; an escalation incident exists. Use **Retry delivery** on the escalation page once the cause is fixed. |
| `delivery_failed` | hold | Work that failed permanently. Investigate before expanding. |
| `delivery_lease_expired` | hold | Claimed work whose lease ran out. The next owner pass recovers it. A persistent count means no upgraded worker runs `cron:approval-delivery` (#291 blocker 2). |
| `escalation_legacy_owner` | hold | Legacy escalation jobs still own the organization; there is no replacement delivery. Switch only after the drain below. |
| `escalation_owner_unrecognized` | blocker | Unknown `owner` value; legacy execution is suppressed and nothing transfers. |
| `escalation_paused` | hold | `automation_paused`: no new transfers; assignments and delivery recovery are kept. |
| `escalation_policy_missing` | blocker | Prepare the migrated policy (#297) before the ownership switch. |
| `escalation_policy_conflicts_unreviewed` | blocker | Review the policy migration conflicts on the escalation page first. |
| `legacy_transfer_without_replacement` | hold | Legacy transfer events stay `pending`: no replacement card and no former-card retirement (#408). The backup uses the web inbox. |
| `attention_open` | hold | Open administrative-attention incidents (all reasons, listed in `openAttention`). |

## In-flight decision

Decided on 2026-09-25 (#328): **web inbox only, no backfill.** A pending
lifecycle whose intents all predate the control's `activated_at` gets no card
from the owner. Its approvers decide it in the web inbox, or it drains. The
report counts these lifecycles per combination (`in_flight_before_activation`)
so that pilot admins can tell the affected approvers. A later transition of
the same lifecycle (e.g. the next chain stage) writes a new intent and is
carded normally. This resolves #291 blocker 7 and applies to Slack, Teams and
Discord too. Nothing is written for these lifecycles; any future backfill
would need its own authorized preparation step.

## Pilot sequence

For each pilot organization, record the report (`--json`) before and after
every step.

1. **Deploy.** Apply every migration through `0096` (through `0108` for
   legacy absence cards) through the authorized deployment. Deploy one release to every worker and app instance. Record the
   deployed versions: the report cannot see them.
2. **Drain.** Confirm that no pre-gate binary and no active legacy escalation
   job remains (#271 items 1–2). Set `RETIRE_LEGACY_ESCALATION_SCHEDULERS=true`
   consistently on every process that reconciles schedules. Keep the guarded
   job names; they are still needed for queued or manual jobs.
3. **Evidence capture.** Turn on `approval_evidence_control` for the kinds
   under the exclusive rollout lock (absence `:7:absence`, expense
   `:14:travel_expense`). Re-run the report: `evidence_held` counts the pending
   lifecycles that can no longer be decided until they drain or are
   resubmitted.
4. **Presentation.** Insert the `actionable` rows: absences on Telegram, Teams
   and Discord (legacy absences: **Telegram only**); expenses on **Telegram
   only**.
5. **Escalation.** Prepare the policy and review its conflicts. Then, after
   step 2, switch the owner exclusively: `owner = 'escalation'` and
   `escalation_owned_since`. No application endpoint does this. Legacy-authority
   organizations get no replacement cards (#408); decide whether the pilot
   admits them.
6. **Delivery.** Insert `approval_delivery_control` per combination. Tell the
   approvers of the `in_flight_before_activation` lifecycles to use the web
   inbox.
7. **Observe.** Re-run the report during the pilot. Delivery holds must drain
   or be explained, and `attention_open` incidents must be resolved. Run the
   live click-throughs listed in the #328 comments for every activated
   provider. Neither the report nor the PostgreSQL suites replace them.

The report shows a combination as `ready` only when every gate it can see
holds. Steps 1, 2 and 7 (deployment, drain, scheduler retirement, live
provider behavior, hosted Tolgee sync) are invisible to it. Record their
evidence separately; a `ready` verdict never implies them.

## Pause and rollback

- **Cards:** set the presentation row to `review_only`. Sent cards stop
  deciding at the next press (the admission is reread under the rollout gate);
  committed invocations keep replaying.
- **Delivery:** delete the `approval_delivery_control` row. The owner stops
  planning new work for that combination; unfinished work and tracked messages
  stay for recovery. Canonical submissions then send no card on that provider
  at all.
- **Escalation:** set `automation_paused = true`. No new transfers happen;
  assignments, receipts and delivery recovery are kept. Never hand ownership
  back to legacy jobs against adopted data.
- **Evidence capture** stays on: turning it off does not invalidate committed
  evidence, but new submissions would then be held once capture is back.

Re-run the report after a pause: it must show the combination inactive
(or not actionable) while the kinds' committed history is unchanged.

## Verification (#328)

`apps/webapp/src/lib/approvals/pilot/readiness.integration.test.ts` runs
against the disposable PostgreSQL 16 database. Absences are submitted through
the real canonical submission caller (`requestAbsenceEffect`); controls, bots,
expense claims, delivery work, transfers and attention are seeded the way the
documented SQL and the owners write them. It covers:

- an unprepared organization (every missing gate named) and a prepared one
  (`ready`, Slack without a presentation row);
- in-flight classification before and after activation, at full timestamp
  precision in SQL;
- evidence classification: not captured, material change, current;
- expense admission (Telegram only; unverified Teams, Slack and Discord; a
  forbidden actionable Teams row) and legacy intents after activation;
- canonical expense authority;
- delivery work health per provider;
- old-path cards on pending approvals;
- organization isolation and an unknown organization;
- escalation ownership, policy conflicts, legacy transfer events and open
  attention;
- absence combinations whose integration does not deliver escalations once
  escalation owns transfers.

`readiness-cli.test.ts` covers argument parsing, help without a database, the
required environment, the text and JSON output, and pool cleanup on failure.

Not verified here: any real organization's data, deployed versions, worker
drain, scheduler retirement, live providers and the pilot itself. Those remain
the open items on #328 (now #423).

## Legacy absence cards (#384 / #459)

Organizations whose absences are decided by legacy authority (rollout `legacy`,
`shadow`, `ready`, or no rollout row) get Telegram cards bound to the exact
legacy request and its legacy submitted revision (#384; design and activation
SQL in [Approval evidence](approval-evidence.md#legacy-absence-cards-bound-decisions-and-cycle-delivery-384)).
Since #459 the report admits them under exactly the #384 gates. Before #459 it
blocked them with `authority_not_canonical`.

| Gate | Report |
| --- | --- |
| Rollout not `canonical`/`complete` | `authority` is `legacy` |
| `approval_evidence_control = capture` | `evidence_capture_inactive` |
| Telegram `approval_presentation_control = actionable` (shared with canonical absence cards) | `presentation_not_actionable` |
| Active Telegram bot with approvals enabled | `provider_not_configured` |
| Teams, Discord and Slack **not** admitted (#384 blocker 7) | `combination_unverified` |
| Chains verified in `legacy` mode only (#384 blocker 4) | `legacy_chain_mode_unverified` |
| No replacement cards after legacy transfers (#384 blocker 5, #408) | `escalation_replacement_unsupported` |
| Held evidence: no revision, a material change (#384 blocker 6), or a canonical revision after a rollback | `evidence_held` |
| Cycles submitted before the delivery control (#384 blocker 3) | `in_flight_before_activation` |

Pending legacy absences are classified like legacy expense claims: against the
legacy revision the #288 owner binds. A shadow observation is never consulted.
The in-flight count is the legacy counterpart of the expense one, keyed like
the owner's lifecycles: pending cycles of pending absences without an intent of
that cycle created at or after the Telegram control's `activated_at`. Old-path
cards of pending legacy requests are counted as `legacy_cards_historical_only`,
as before.

The report cannot see the remaining #384 blockers: the `0108` deployment, the
drain of old binaries (they decide and cancel without intents and route a
legacy binding to the expense owner), ingress durability, and the scanner gap.
Record their evidence separately. The cutover to `canonical` hands the same
Telegram presentation and delivery controls to canonical absence cards; the
report then applies the canonical absence admission.

### Verification (#459)

`readiness.integration.test.ts`, PostgreSQL 16, with absences submitted through
the real `requestAbsenceEffect` legacy branch and a stage decided through the
real `approveAbsenceEffect`:

- an unprepared organization with no rollout row is legacy-authoritative and
  names only the missing #384 gates;
- a prepared `legacy` organization is `ready` on Telegram; Teams, Discord and
  Slack are `combination_unverified`, with no `presentation_actionable_unverified`
  for a Teams row left from canonical authority; `shadow` and `ready` hold
  `legacy_chain_mode_unverified`; after the cutover the canonical admission
  applies;
- evidence: not captured (submitted before capture), current (`legacy` and
  `shadow` submissions), material change, and a canonical submission after a
  rollback to legacy (`authorityChange`);
- in flight: a single request and a two-stage chain submitted before
  activation count; a chain submitted after activation does not (its intent
  is keyed by the chain instance); deciding stage one on the web writes the
  cycle's `decided` intent and removes it from the count; `shadow` counts the
  pending chains;
- once escalation owns transfers: `escalation_replacement_unsupported` instead
  of `escalation_delivery_disabled`.

Absences have one cycle per source, so the cycle key is not distinguished from
the source here (#384 verified several cycles with a seeded second cycle).
Card sending, pressing, replay, refresh and cleanup were verified by the #384
suite and are not repeated.

## Time approval cards (#330 / T65)

Cards for manual time submissions, policy clock-outs and time corrections
(#325), and their escalation (#326), use the same report. Everything stays
**inactive for every organization**. Scope decided on 2026-09-26: the code part
of #330 is the time kinds in this report plus this section. #330 closes on
implementation. Its operational items (the #325 activation comment and the
checks below) are tracked in
[#448](https://github.com/Umami-Creative-GmbH/z8/issues/448), together with the
time pilot.

### Admission

A time kind's combination is `ready` only when every gate the report sees
holds:

| Gate | Where it comes from |
| --- | --- |
| Rollout `canonical` (not `legacy`, `shadow`, `ready` or `complete`) | #325; legacy authority → #432, `complete` → blocker 2 |
| `approval_evidence_control = capture` | #301/#302 (transaction-owned submitted and resulting evidence) |
| Telegram `approval_presentation_control = actionable`; Slack none | #325 activation SQL |
| Teams and Discord **not** admitted | #325 blocker 3 (`combination_unverified`) |
| Active Telegram (or Slack) integration with approvals enabled | integration settings |
| No held or in-flight lifecycle, or an explicit operator decision | `evidence_held`, `in_flight_before_activation` |

The report does not see the writer and worker gates for time: the append
admission, the drain of old binaries, and deployment. Those are in the
[time pilot report](time-pilot.md) and [#447](https://github.com/Umami-Creative-GmbH/z8/issues/447).
Run both reports for a time-card pilot organization. The time pilot report must
not be `blocked`.

### Sequence

Run it after the time pilot's own adoption steps ([time pilot](time-pilot.md#pilot-sequence)):

1. **Evidence capture** for the three kinds, under each kind's exclusive
   rollout lock (`:22:manual_time_submission`, `:16:policy_clock_out`,
   `:15:time_correction`). Re-run the report. A request submitted before capture
   is `notCaptured` and held (`evidence_required`): it cannot be decided
   anywhere, the web inbox included (see [Known holds](#known-holds-and-open-decisions)).
2. **Presentation**: insert `approval_presentation_control (org, kind,
   'telegram', 'actionable')` under the same lock (SQL in
   [Approval evidence](approval-evidence.md#time-approval-presentation-and-bound-decisions-325--t60)). Do not insert Teams
   or Discord rows for time kinds.
3. **Escalation**: if escalation owns transfers, enable escalations on the
   Telegram bot, otherwise `escalation_delivery_disabled` holds: a backup gets
   only the web inbox.
4. **Delivery**: insert `approval_delivery_control (org, kind, 'telegram')`
   (and `'slack'` for review-only summaries). Tell approvers of the
   `in_flight_before_activation` lifecycles to use the web inbox. The
   [in-flight decision](#in-flight-decision) applies unchanged.
5. **Observe** with the live checks below, and re-run the report.

### Live checks (not provable by the report or the PostgreSQL suites)

With a real bot and tenant:

- the card text is in the recipient's locale and hour cycle, the endpoints are
  in their captured offsets, and no reason text is shown;
- one press makes one decision, and a redelivered press replays it;
- the owner refreshes the card after a web decision;
- an intermediate chain step shows "Approval recorded";
- a press after the entry changed decides nothing;
- the pause (`review_only`) stops sent cards from deciding;
- a scheduled transfer delivers the replacement card and retires the former
  card, and only the replacement's press decides (#326);
- the Slack summary has no controls.

### Known holds and open decisions

- **Policy clock-out cards** only arise for requests submitted before live
  clock-out approval was retired (#361). Those stay decidable, replayable and
  finalizable; no new ones are created.
- **Held requests** (material change, or no revision) have no durable
  administrative attention, and manual and policy clock-out approvals have no
  user cancel or resubmit path (#302 blockers). They count under
  `evidence_held`; nothing reconstructs or repairs them.
- **Category names** on correction cards are current names. Decide before the
  pilot whether request-time labels must be captured (#325 blocker 4).
- **Ingress**: nothing is stored durably before the webhook acknowledgment
  (as for #290).
- **`complete` mode** is now a blocker for absences too
  (`authority_complete_unsupported`). The owner's missing-compatibility path is
  kind-independent, so the #328 verdicts under `complete` were too optimistic.
- **Legacy time authority** (every organization today) stays review-only on
  bots and is held by escalation (`legacy_time_authority`, #439). Bound legacy
  cards and cycle-keyed delivery are #432.

### Pause and rollback

As [above](#pause-and-rollback): `review_only` stops sent time cards at the next
press, and deleting the delivery control stops new cards. Committed invocations,
decision evidence and transfer receipts keep replaying, and historical-only
access to old cards is unchanged by any admission change.

### Verification (#330)

PostgreSQL 16, both suites in `test:approval-workflow-repository:integration`:

- `lib/approvals/pilot/readiness.integration.test.ts`:
  - Telegram and Slack are admitted for all three time kinds;
  - Teams and Discord are `combination_unverified`, and an actionable Teams
    row is flagged;
  - legacy authority is `authority_not_canonical`;
  - `complete` mode is `authority_complete_unsupported`, for time kinds and
    absences;
  - time kinds get `escalation_delivery_disabled` once escalation owns
    transfers.
- `time-tracking/actions/clocking.time-presentation.integration.test.ts`, with
  requests submitted through the real `createManualTimeEntry`,
  `clockIn`/`clockOut` and `requestTimeCorrection`:
  - `notCaptured` (submitted before capture), `current`, `materialChange`
    (a corrected entry changed after submission) and `reviewOnly` (a policy
    clock-out captured without the employee's name);
  - an old-path Telegram card counted under its mirroring kind;
  - in-flight lifecycles after a late activation;
  - a request submitted under `shadow` is `authorityChange` both before and
    after the cutover to `canonical`.

Card sending, pressing, replay, refresh, escalation transfer and replacement
delivery for time kinds were already verified by the #325 and #326 suites.
They are not repeated here. Nothing in these suites proves a real provider,
deployed build or pilot organization.
