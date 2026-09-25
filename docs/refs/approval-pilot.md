# Non-time approval pilot — #328 / T63

The limited organization pilot of absence and expense approval cards. It runs
independently of timekeeping work. This page covers the readiness report,
the order of the operator steps, the in-flight decision and the evidence each
step needs. The activation SQL itself lives with each slice:
[Approval evidence](approval-evidence.md) (#287, #290, #293, #296),
[Approval card delivery](approval-delivery.md) (#291–#294, #300) and
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

**Kinds** (`absence`, `travel_expense`): the authority deciding the kind now
(the rollout's `lifecycle_mode`), the evidence mode, and every pending
lifecycle by its submitted evidence. The same review preparation that the inbox
and the decision owner use does the classification, so a held lifecycle here
is exactly one that cannot be decided from a card:

| Class | Meaning |
| --- | --- |
| `current` | Evidenced and still matching; decidable from a bound card. |
| `notCaptured` | No submitted revision (e.g. submitted before capture). Held while capture is on. |
| `materialChange` | Live facts changed after submission. Held until a supported resubmission. |
| `authorityChange` | Evidence of another authority (legacy revision under canonical authority). Held. |

**Card combinations** (kind × Telegram, Teams, Slack, Discord): whether the
delivery owner owns the combination (`approval_delivery_control` and its
`activated_at`), its delivery work by status, and findings.

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
| `authority_not_canonical` | blocker | Absence cards need canonical authority; legacy absences are #384. |
| `authority_not_legacy` | blocker | Expense cards exist only under legacy authority (#296); a canonical expense rollout has no card path. |
| `evidence_capture_inactive` | blocker | Turn on `approval_evidence_control` first (#287, #295). |
| `presentation_not_actionable` | blocker | Actionable providers need `approval_presentation_control = actionable` (#290, #293, #292, #296). Slack needs none: it is always review-only. |
| `combination_unverified` | blocker | Expense cards are admitted on Telegram only. Do not activate expense delivery on Teams, Slack or Discord. |
| `presentation_actionable_unverified` | blocker | An `actionable` expense row on Teams, Slack or Discord would make unverified cards actionable. Remove it. |
| `provider_not_configured` | blocker | No active integration with approvals enabled (for Teams: no such tenant). |
| `evidence_held` | hold | Pending lifecycles held for evidence (count = `notCaptured` + `materialChange` + `authorityChange`). They are decided in the web inbox after resubmission. Nothing backfills them. |
| `in_flight_before_activation` | hold | Pending lifecycles without a lifecycle intent at or after `activated_at` (or, before activation, every pending lifecycle). The owner never sends them a card. See [In-flight decision](#in-flight-decision). |
| `legacy_cards_historical_only` | hold | Unanswered cards of the pre-owner path (`telegram_approval_message`, `teams_approval_card`, `slack_approval_message`, `discord_approval_message`) on pending approvals. They are not refreshed. A press revalidates at commit and decides nothing on its own. |
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

1. **Deploy.** Apply every migration through `0096` through the authorized
   deployment. Deploy one release to every worker and app instance. Record the
   deployed versions: the report cannot see them.
2. **Drain.** Confirm that no pre-gate binary and no active legacy escalation
   job remains (#271 items 1–2). Set `RETIRE_LEGACY_ESCALATION_SCHEDULERS=true`
   consistently on every process that reconciles schedules. Keep the guarded
   job names; they are still needed for queued or manual jobs.
3. **Evidence capture.** Turn on `approval_evidence_control` for the kinds
   under the exclusive rollout lock (absence `:7:absence`, expense
   `:14:travel_expense`). Re-run the report: `evidence_held` lists what will be
   decided in the web inbox.
4. **Presentation.** Insert the `actionable` rows: absences on Telegram, Teams
   and Discord; expenses on **Telegram only**.
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
  attention.

`readiness-cli.test.ts` covers argument parsing, help without a database, the
required environment, the text and JSON output, and pool cleanup on failure.

Not verified here: any real organization's data, deployed versions, worker
drain, scheduler retirement, live providers and the pilot itself. Those remain
the open items on #328.
