# Scope expansion and compatible rollback — #331 / T66

This page is the rollback runbook for the #264 programme. It gathers every rollback
requirement that the closed slices moved to #331, together with the read-only report
that shows what an organization's rollback must drain, pause or accept first.

Spec #264 §11 sets the rule. A rollback either moves to a **compatible release** or
**pauses fresh affected work**, and it keeps committed authority, evidence, receipts
and recovery. It never restores a destructive queue consumer, or an ungated writer,
against adopted data. Pausing escalation stops new transfers and keeps assignments
and delivery recovery.

Nothing here activates, pauses or deploys anything. Every switch below is a separately
authorized operator step. Record its evidence on the T66 operations tracker (see
[Verification](#verification-331)).

## Readiness report

```bash
pnpm rollout:rollback-readiness --organization-id <org-id> [--json]
```

The report reads one repeatable-read, read-only snapshot, and it needs the server's
database credentials. It covers exactly one organization and writes nothing. Use
`--json` for recorded evidence. The code is in `apps/webapp/src/lib/rollout/rollback/`:
`readiness.ts` is the pure classifier and `readiness-reader.ts` the snapshot reader.

Each section returns `ready`, `hold` (it needs an explicit operator decision that
accepts a known gap) or `blocked` (something must be drained, decided or resolved
first, or no compatible rollback exists). The overall verdict is the worst section.

| Section | Reads |
| --- | --- |
| Append adoption | The append control mode and its activation, and the employee positions by admission |
| Approval cards | Delivery controls, presentation controls, open delivery work by provider and effect |
| Escalation | Ownership, whether automation is paused, and pending time/expense approvals with a committed transfer |
| Durable work | Balance rebuild intents, break adjustment intents, payroll jobs in flight with stored input, held import rows |
| Floors | Committed rows that pin the oldest schema a rollback may keep, and the rows that also pin the oldest code it may target |

### Findings

| Code | Severity | Meaning and required action |
| --- | --- | --- |
| `append_pause_unavailable` | blocker | Append admission is active, and there is no compatible pause for it (see [Append adoption has no pause](#append-adoption-has-no-pause)). |
| `adopted_history_unfenced` | blocker | The organization was adopted and then returned to inactive. Legacy writers now commit against the kept positions, and re-activation holds the affected employees for review. This is also the state that #276 and #277 require before their code rollbacks, so such an organization never reports `ready`. That follows from the [append blocker](#append-adoption-has-no-pause). |
| `continuation_positions` | hold | Positions admitted by an authorized continuation (#323). An older release holds these employees' appends, which is safe. Never drop the position, because that loses its provenance. |
| `delivery_pause_gap` | hold | Delivery controls whose deletion leaves no card at all: expenses (#296) and absences under canonical authority (#291, #292, #293, #294). Accept and communicate the gap, or keep the owner running. Time kinds (#325) and legacy-authority absences (#384) fall back to the existing notification path and are not counted. |
| `presentation_actionable` | hold | Sent cards still decide. Set `review_only` before a binary rollback, so older binaries show review notices instead of failures (#325, #384). |
| `replacement_work_pending` | blocker | Unfinished replacement work on a provider that still has a delivery control. A pre-#300 worker cancels replacement cards as `purged`. Let the work finish, or delete the delivery controls; either clears the finding. |
| `delivery_work_pending` | hold | Unfinished Slack, Teams or Discord work on a provider that still has a delivery control. An older worker without that adapter exhausts it (`ambiguous:internal_error`). Delete the controls first, or accept the exhausted incidents. Telegram has had an adapter since #291. |
| `escalation_automation_running` | hold | Escalation owns the organization and automation runs. Pause it before a code rollback (#300, #326, #439). |
| `legacy_transfers_pending` | blocker | Pending legacy-authority time approvals with a committed transfer. Pre-#439 decision owners reject the transfer lineage, so after a code rollback the replacement could no longer decide. Let the replacements decide them first. |
| `canonical_transfers_pending` | hold | Pending canonical time or expense approvals with a committed transfer. Pre-#326 owners lack the revocation checks, so a former holder who is still an eligible manager could decide again. Let them be decided, or accept that exposure explicitly (#326). |
| `rebuild_intents_pending` | blocker | Balance rebuild intents. Pre-#421 binaries ignore them, and pre-#428 binaries widen user intents. Drain them (`processWorkBalanceRebuildIntents`). |
| `payroll_jobs_in_flight` | blocker | Export jobs not yet finished that have stored input. A release without #322 ignores stored inputs, so a retry would reread work. Drain or complete them. |
| `break_adjustments_pending` | hold | Automatic break adjustment intents. A binary without #441 ignores them, and they stay inert until re-adoption. |
| `import_rows_held` | hold | Import rows held by the reviewed-import commit. Older code neither clears nor re-commits them. Never reset them by hand (#284). |

### Schema and release floors

Every committed value that a migration admitted pins that migration:

- receipt kinds and writers;
- delivery messages and invocations by provider;
- legacy card lifecycles (0093), replacement work (0096) and cycle-keyed legacy delivery (0108);
- rebuild intents (0099, 0101), the historical repair control (0102), payroll inputs and control (0104), proposals and continuation positions (0105), and break adjustment intents (0106).

`floor.schema` is the newest pinned migration. Never narrow a CHECK or drop a column or
table below it: the rows would be rejected, or lose the remote identities and replay
evidence they hold.

`floor.release` is the newest pin that also limits the code a rollback may target
(`limits: "release"`):

- receipt kinds and writers, because older code cannot replay committed receipts it
  does not know (#275, #281);
- cycle-keyed legacy delivery, because binaries below #384 plan cycle rows source-wide;
- any value this release does not know, which a newer release committed. It pins as
  `unknown (newer than this release)`.

The other pins are rows that earlier releases ignore safely (#296, #305, #311, #320,
#322, #323). They limit only the schema. Pins are constraints on the target, not
findings: they never change the verdict.

### Not visible to the report

The report cannot see:

- deployed builds and their migrations;
- old clients and their device queues (browser IndexedDB, the desktop store, the retired extension and mobile readers);
- BullMQ queues;
- cards already sent to providers;
- the code-only behaviour changes listed under [Code rollback](#code-rollback).

Record those separately. A `ready` verdict never implies them.

## Expanding verified scopes

Expansion stays per combination and uses the existing pilot reports:

- `pnpm approvals:pilot-readiness` for card combinations by kind, authority and
  provider ([approval-pilot.md](approval-pilot.md));
- `pnpm time:pilot-readiness` for append adoption, time approvals, imports and
  follow-up work ([time-pilot.md](time-pilot.md)).

Expand only a combination that both reports show as `ready` and whose deployment,
drain, old-consumer and live-provider evidence is recorded (steps that neither report
can see). Before each expansion, run this report for the organization and record both
floors. The release floor is the oldest code you could still roll back to without
losing replay. An expansion that raises it narrows the compatible rollback targets, so
record that too.

## Pauses (no code change)

| Switch | Effect | Keeps |
| --- | --- | --- |
| `approval_presentation_control.mode = 'review_only'` | Sent cards stop deciding at the next press, which becomes a review notice. Slack is always review-only. | Committed invocations replay exactly (#292, #293, #296, #325, #384). |
| Delete `approval_delivery_control (org, kind, provider)` | The owner stops planning new work for that combination. Time kinds resume the existing notification path for new cycles (#325). Legacy absence cycles fall back to it with review-only cards (#384). | Unfinished work and tracked messages stay for recovery. **Gap:** canonical absence submissions and expenses get no card on that provider. |
| `approval_escalation_control.automation_paused = true` | No new transfers of any kind. | Committed transfers, journal rows, assignments and replacement delivery (#255 §7). |
| `approval_evidence_control` back to `inactive` | Stops new capture and the `evidence_required` hold. Lifecycles that already have a revision stay enforced (material-change hold), and their decisions still work (#302). Expense bound cards stop being issued (#296). The pilot runbooks keep capture on during a pause ([approval-pilot.md](approval-pilot.md#pause-and-rollback)). | Committed evidence rows, which are immutable. |
| Delete `payroll_work_collection_control` | Restores the legacy workspace and export reads. | Jobs created under the control keep their stored input (#322). |
| Delete `historical_work_repair_control` | Stops further repair and proposal application. | Applied repairs are receipted values and are never reverted automatically (#320, #323). |
| `DISABLE_ORGANIZATION_CREATION` | Pauses organization creation for a code rollback window (#359). | The 0107 rollout rows (`legacy`/`legacy`). Do not delete them. |
| Pause `cron:organization-cleanup` | Stops further tenant deletions without a revert (#306). | Tenants already deleted stay deleted. |

After a pause, re-run this report and the pilot report for the affected combination.
The paused findings must be gone, and the schema floor must be unchanged.

### Append adoption has no pause

**This is an unresolved, scoped blocker.** Every organization whose append control is
`active` reports `append_pause_unavailable`. Resolving it needs a focused decision
(spec #264 §11): add a durable paused admission, or accept that append adoption rolls
back only by moving forward.

- There is no paused state. Setting the control back to `inactive` is not a pause.
  Legacy head selection resumes, and legacy clock-outs commit work with no receipt
  and no position advance. When the control becomes active again, each affected
  position's entry count and tip no longer match the history, so continuity reports
  `interrupted` and fresh writes hold for review (#285, #329). The #331 suite
  verifies this sequence.
- The inactive state keeps receipt replay and lookup for committed work in every mode
  (#275, #276, #277, #279, #281, #301, #308, #310): fresh v2 commands return
  `not_adopted` and clients keep them queued. It does not stop the legacy writers
  themselves.
- Several code rollbacks demand the organization be inactive first:
  - bots (#277) and on-behalf clock-out (#276) fall back to raw, uncoordinated closers;
  - automatic break adjustment (#305) needs adoption paused first.

  So a code rollback below those releases is not compatible for an adopted organization.
- Continuation positions (#323) and the kept positions must never be dropped.

Until that decision exists, the only compatible rollback for an adopted organization
is a release at or above the report's release floor that still contains every writer
participating in adoption.

## Code rollback

Before rolling any binary back:

1. Run the report. Resolve every blocker: drain rebuild intents and in-flight payroll
   jobs, let replacement work finish, and let the replacements decide transferred
   approvals.
2. Set every actionable presentation control to `review_only`. Delete the delivery
   controls of every provider or kind the target lacks: Slack before #294, Teams
   before #293, Discord before #292, `travel_expense` before #296, and legacy absence
   (both controls) before #384.
3. Pause escalation automation.
4. Choose a code target at or above the release floor. For adopted organizations, also
   stay at or above every writer they use (see above). Keep the schema at or above the
   schema floor.
5. Never narrow a provider, scheme, receipt kind or writer CHECK, and never drop a
   table or column, while rows use the value:
   - approval delivery providers `('telegram', 'teams', 'slack', 'discord')`, as one union;
   - invocation schemes;
   - receipt kinds and writers from 0083 onwards;
   - `approval_delivery_intent` and the legacy delivery columns (#296);
   - `escalation_transfer_id` (#300).

   0108 is not a plain revert. It dropped the `*_legacy_request_fk` cascades, so:
   - purge delivery rows of cancelled cycles first;
   - drop `legacy_cycle_id` only after a binary without cycle support drains;
   - `withdrawn` intents violate the old CHECK.
6. Make pages reload onto the rolled-back bundle before users retry stored entries.
   Server action IDs change between builds (#310).

### Clients

- **Browser.** Since #279 the worker upgrades `z8-offline-queue` to version 2 one-way. A
  version-1 worker cannot open it, and fails closed: nothing is read or deleted, and
  capture reports "could not save". Ship a rollback worker that opens version 2
  read-only, or accept the gap. Never ship a pre-#267 worker (#266, #267).
- **Desktop.** Older binaries ignore the `clock_command` tables. A #280 binary cannot
  parse a saved `break` row and pauses clock actions until upgraded. The rollback
  release must read them, or they must drain first (#280, #281). The endpoint v2
  marker survives a rollback on purpose, so expect "connect once" refusals.
- **Extension (retired).** Every target must keep the `legacy-extension-queue`
  400 → 409 fence (#266, #282).
- **Mobile (retired).** The legacy `/api/mobile/*` routes keep their current behaviour,
  including the committed clock-out replay fix (#283, #400).

### Further per-slice consequences

- **#284:** an old worker locks the import-only key again, which no longer serializes
  with live clocking. An older `clearOrganizationTimeData` leaves canonical records of
  removed periods orphaned. Held rows stay `blocked`; never reset them by hand.
- **#285:** after a rollback to inactive, demo cleanup leaves balances to the existing
  refresh paths. A legacy demo write holds the next adopted write on
  `unexpected_history_change` until an authorized continuation (#323).
- **#292:** the old path sends approval notices to the stored `discord_conversation`
  channel again, which can be a server channel.
- **#294:** `delivery_unavailable` incidents include the delivery channel in their
  dedupe key. After a rollback, old code neither resolves nor deduplicates them.
- **#300:** after a roll-forward, cancelled replacement work is not re-armed. **Retry
  delivery** only re-arms `awaiting_repair`, `exhausted` and `failed` work, so
  `cancelled` work needs a new decision.
- **#301:** a pre-#422 binary brings back the four legacy correction defects and late
  approval-gate acquisition.
- **#302:** a binary without #391 submits and decides without evidence, ignores
  existing revisions, and writes no legacy receipt row for those decisions. Prove how a
  later roll-forward treats lifecycles decided that way.
- **#325:** rolled-back binaries write raw command fingerprints (with reason text) into
  canonical time-kind decision evidence again; #433 writes a digest. Both stay readable.

### Behaviour that a code rollback reverts

These changes went live ungated. Reverting their release restores the older
behaviour, so confirm it is acceptable for the rollback window.

| Slice | Reverted by a rollback |
| --- | --- |
| #306 | Cleanup fails again for organizations with recorded work, and the purged-correction fence is gone. Deleted tenants stay deleted. |
| #308 | The blocking holiday category check is no longer organization-scoped. |
| #311 | The exclusive organization configuration guard, `FOR NO KEY UPDATE` on the organization row, and the Better Auth `timezone` refusal (security-relevant). |
| #312 | The user guard on `user_settings`, timezone and ban writes, and the per-organization rerouting of user timezone changes. |
| #313, #316, #317, #318 | Transaction-scoped fencing of authorization, holiday, change policy, billing, provisioning, demo and cleanup writers, plus their atomicity and organization-scoping fixes. Must not coexist with an activated manual scope (#447 drain). |
| #314 | Coordinated Better Auth membership, role and admin writes, and z8-owned SSO membership (the plugin's provisioning comes back). |
| #315 | The exclusive project/category guard and atomic settings mutations. Check for foreign set assignments afterwards. |
| #319 | The diagnostics route, the page and its navigation entry. No data to clean up. |
| #324 | The `verify` response order, the digest order and the scoped manager check (an authorization fix). |
| #359 | Organization creation goes back to running uncoordinated over HTTP (it reopens the #314 escape). |
| #429 | Per-callback SCIM guards come back, with multi-user SCIM changes able to deadlock against manual submissions. |

## Moved items

Each #331 comment below holds the source slice's full rollback checklist. These
comments move verbatim to the T66 operations tracker when #331 closes.

| Slice | Area | Comment |
| --- | --- | --- |
| #266, #267 | Browser/extension queue readers | [5829210707](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5829210707) |
| #324 | Audit assurance, verify API | [5829809359](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5829809359) |
| #285 | Runtime demo work | [5831298153](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5831298153) |
| #291 | Telegram delivery owner | [5831308744](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5831308744) |
| #284 | Reviewed import | [5831314606](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5831314606) |
| #275 | Direct-HTTP v2 clock commands | [5831318321](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5831318321) |
| #302 | Manual/policy approval evidence | [5831320365](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5831320365) |
| #277 | Bot clocking | [5832153601](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5832153601) |
| #282 | Extension retired | [5832340738](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5832340738) |
| #283, #278 | Mobile retired | [5832543382](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5832543382) |
| #294 | Slack delivery | [5832846341](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5832846341) |
| #293 | Teams actions and delivery | [5832881729](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5832881729) |
| #276 | On-behalf clock-out | [5832964128](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5832964128) |
| #279 | Browser frozen commands | [5833038044](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5833038044) |
| #300 | Escalation replacement delivery | [5833106120](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5833106120) |
| #292 | Discord decisions and delivery | [5833130153](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5833130153) |
| #280 | Desktop frozen commands | [5833153149](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5833153149) |
| #296 | Expense review and cards | [5833300344](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5833300344) |
| #308 | Manual commands | [5833351894](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5833351894) |
| #315 | Project/category eligibility | [5834868515](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5834868515) |
| #281 | Desktop break close/resume | [5834983532](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5834983532) |
| #301 | Correction lifecycle | [5835334939](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835334939) |
| #310 | Manual command recovery | [5835425731](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835425731) |
| #311 | Organization timezone rebuild | [5835520452](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835520452) |
| #313 | Authorization mutations | [5835642563](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835642563) |
| #316 | Holiday/change-policy coordination | [5835820832](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835820832) |
| #317 | Billing revalidation | [5835903554](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835903554) |
| #319 | Historical work diagnostics | [5835969436](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5835969436) |
| #306 | Privileged and tenant cleanup | [5837229665](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5837229665) |
| #320 | Historical gap repair | [5837235668](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5837235668) |
| #312 | User configuration/access | [5837236423](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5837236423) |
| #314 | Auth/SCIM coordination | [5837239998](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5837239998) |
| #318 | Provisioning/cleanup coordination | [5838504502](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5838504502) |
| #322 | Payroll work collection | [5838902284](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5838902284) |
| #323 | Repair and continuation proposals | [5839282280](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5839282280) |
| #325 | Time card presentation | [5839360867](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5839360867) |
| #305 | Automatic break adjustment | [5840028186](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5840028186) |
| #326 | Escalation of time kinds and expenses | [5840064783](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5840064783) |
| #359 | Organization rollout pre-create | [5844862812](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5844862812) |
| #384 | Legacy absence cards and cycles | [5845072882](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5845072882) |
| #429 | SCIM sorted guards | [5845241915](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5845241915) |
| #439 | Legacy/shadow time escalation | [5845582249](https://github.com/Umami-Creative-GmbH/z8/issues/331#issuecomment-5845582249) |

## Verification (#331)

`apps/webapp/src/lib/rollout/rollback/readiness.integration.test.ts` runs against the
disposable PostgreSQL 16 database. It belongs to
`test:approval-workflow-repository:integration`.

Real callers write the work:

- `clockIn` and `clockOut`, both before adoption and after it;
- the strict version-2 `createManualTimeEntry`, under a real change policy that requires approval;
- `processDueEscalations`;
- the inbox approve route, with the real CASL abilities;
- `changeOrganizationTimezone`;
- `processWorkBalanceRebuildIntents`.

Controls are inserted and changed by operator SQL, because production has no setter.
Every report call asserts that no row of the tables it reads changed.

The suite verifies:

- An organization that never adopted anything reports `ready`, with no schema floor.
  Legacy clock-outs commit no receipt. Another organization's controls, intents and
  escalation never count, and an unknown organization is refused.
- An adopted organization reports `append_pause_unavailable`. Its position pins the
  schema at 0079, and its clock-out receipts pin the release at 0083.
- Returning append to `inactive` removes no committed row, and a committed clock-out
  still replays exactly with nothing written. The legacy writer then commits work
  without a receipt or a position advance. After re-activation, the time pilot report
  shows `continuity_interrupted`. This is the evidence for the scoped blocker.
- The documented card and escalation pauses (`review_only`, deleting the delivery
  controls, `automation_paused`) clear `delivery_pause_gap`,
  `presentation_actionable` and `escalation_automation_running`. The pause gap counts
  the canonical absence controls and not the time-kind control. The committed
  receipts, positions and work stay row-for-row identical, and both floors are
  unchanged. That test commits no approval, delivery or transfer rows; the next case
  covers the transfer journal.
- A legacy manual time approval transferred at its deadline reports
  `legacy_transfers_pending`. Pausing automation stops the next due transfer
  and keeps the journal. The former holder can no longer approve. Once the
  replacement approves, the section is `ready`.
- A real organization timezone change under adoption leaves a rebuild intent, which
  reports `rebuild_intents_pending` and pins 0099. The real consumer drains it, the
  finding clears, and the other organization's intent is untouched.

Unit tests (`readiness.test.ts`, `readiness-cli.test.ts`) cover every finding, the
pin-to-migration map, the schema floor and the CLI. They also cover the findings that
the PostgreSQL suite does not produce through callers:

- replacement and provider delivery work, and how deleting the controls clears it;
- the pause-gap scoping by kind and authority;
- canonical transfers;
- values committed by a newer release;
- legacy and cycle card lifecycles;
- continuation positions;
- payroll jobs in flight;
- break adjustments;
- held import rows.

### Not proven here (operations)

The following remain operational and are tracked on the T66 operations tracker:

- The mixed-version rehearsal: an older release against a database with these
  migrations and rows, for each rollback target (#300, #326, #359 and others).
- The browser, desktop and provider behaviour after a rollback.
- The live expansion of each combination.
- The focused decision on an append pause.

Mocked or source-only review does not prove any of them.
