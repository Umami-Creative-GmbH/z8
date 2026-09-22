# Client, approval, worker and cleanup inventory — #265

Part of the [activation dossier](265-activation-dossier.md). Same baseline and
evidence limitations apply. Paths are relative to `apps/webapp/src/` unless a
repository-root prefix is stated. O/E/U mean organization/employee/user.

## Runtime and lifecycle register

| ID / source status | Caller, owner and scope | Current evidence/transaction/recovery boundary | Follow-up and acceptance or effective retirement |
| --- | --- | --- | --- |
| R01 — source-reachable web/browser | `lib/query/use-time-clock.ts`, `hooks/use-offline-clock.ts`, `components/offline/sw-update-prompt.tsx`; repo-root `apps/webapp/public/sw.js`, `public/lib/offline-queue-db.js`, `public/lib/sync-service.js`; browser/account/O/E/origin | Online and offline command paths differ; IndexedDB local ID/retries is not server identity; queue lacks full actor/origin binding; sync deletes success/400/409/exhausted records and cleanup uses age. SW interception has less evidence; manual-sync reply/retry and later status are separate failure boundaries | #267 then #279/#266: preserve unresolved original rows, expose failed local persistence, real IndexedDB abort/restart and worker messaging, durable pre-send versioned capture, exact receipt before active removal, dependency/context isolation; verify enforced old-reader update/disable before strict admission |
| R02 — source-reachable desktop, deployed versions unknown | Repo-root `apps/desktop/src/hooks/useClock.ts`, `src/App.tsx` → `src-tauri/src/commands.rs`, `clock.rs`, `offline.rs`; `auth.rs`, `state.rs`, `settings.rs`, `idle.rs`; account/O/E/server/period | SQLite local integer IDs, unversioned rows and failure-time timestamps; no durable captured owner/server/timezone/receipt; ordinary close omits timestamp. Retry exhaustion/malformed payload can leave invisible rows; enqueue/update/delete errors and subsequent status fetch differ from remote commit | #268/#280/#266: retain malformed/exhausted rows and exact bytes, restart-safe upgrade/recovery identity, pre-send capture and negotiated transport, visible inspection/export/archive; local acceptance failure is not successful queueing |
| R03 — source-reachable desktop break | Same Tauri command owner → two HTTP operations in `clock.rs`; `idle.rs` observes return and reconstructs idle start, UI forwards start; O/E/intended period/two endpoints | Close/resume are separate requests without durable substep outcome; confirmation time can differ from detected return; bare legacy timestamps/UTC strings cannot prove event zone or noncommitment | #281: one atomic intended-source close/resume with separate captures, confirmed detected return and observed/estimated provenance, discontinuity review; storage/server failure injection at every stage and evidence-based legacy partial recovery |
| R04 — extension external-unknown | Repo-root `apps/extension` has no tracked app source; server `app/api/extension/projects/route.ts` and direct time-entry APIs are retained | A route, build artifact or optional capture field is not proof of deployed app protocol/account/O/origin binding or queue preservation | #266/#282: identify repository/maintainer/build/release population, exact formats and endpoints, effective update/disable; verify durable capture and crashes against real app before claiming adoption |
| R05 — mobile external-unknown | No tracked application under repo-root `apps/mobile`; `app/api/mobile/time-clock/route.ts` and `shared.ts` are server source | W05 supplies strict captured input server behavior, not app persistence/source/build ownership. Native app versions/capabilities and old-consumer controls unknown | #266/#283/#278: real source/build/transport census and same frozen-command recovery contract; no inferred delayed mode or identity from a local queue ID |
| R06 — four approval adapter entry points, source-reachable | `lib/slack/approval-handler.ts`, `lib/discord/approval-handler.ts`, `lib/telegram/approval-handler.ts`, `lib/teams/approval-handler.ts`; API webhook/event/interaction receivers → shared `lib/bot-platform/approval-decision.ts::attemptBotApproval` → inbox decision; O/receiver/U/request/assignment | Shared attempt scopes compatibility request and inbox decision, while adapters still prepare facts/render/send/track. Existing semantic command fingerprints are not immutable reviewed-binding/invocation evidence; exact outcome and current target can differ | #270 early suppression; #287–#290/#292–#296/#325: transaction-owned per-kind facts, immutable material revision/assignment handles, versioned invocation association through real commit. Telegram/Discord/supported scoped Teams identity only; Slack/missing identity review-only; old unbound cards historical-result-only |
| R07 — source-reachable initial/status routing | `lib/notifications/notification-service.ts`, platform `*-channel.ts`; platform approval handlers and `lib/approvals/server/shared.ts`; workflow outbox/projection writers; O/kind/recipient/channel | Multiple notification, canonical outbox and compatibility effects exist; source presence does not prove one recoverable transport owner or actionable initial routing readiness | #291–#294/#300: trace actual preference/enablement/entitlement route, one effect owner, full actual remote identity, coordinated initial/status/replacement/retirement, lease/fence and crash recovery. Do not enable bypassed interactive initial routing until binding/decision/replay is ready |
| R08 — source-reachable escalation execution | `lib/cron/registry.ts` → `lib/teams/jobs/escalation-checker.ts`, `lib/telegram/jobs/escalation-checker.ts`, `lib/discord/jobs/escalation-checker.ts`, `lib/slack/jobs/escalation-checker.ts`; O/request/assignment/channel | Teams retains approval-request mutation; other adapter delivery/tracking paths are not a shared authority transfer journal. Integration preferences/timeouts and prior escalation flags need evidence classification | #271 execution-time gates first; #297–#300/#326 actual assignment transfer, narrow principal, human management authorization, sibling/lineage/deadline semantics and atomic receipt/journal/shadow. Test scheduled transfer through replacement inbox/decision, not notification count |
| R09 — source-reachable review/submission lifecycle | `app/api/approvals/inbox` single/bulk routes, `lib/approvals/inbox`, workflow domain adapters/server owners; absence, expense, manual/correction actions; `app/api/upload`, `app/api/tus`; O/subject/cycle/receipt/recipient | Authority mode/cutover, source validation and command receipts already have owners; current mutable rows and attachment references are not full immutable submission/result/receipt-content identity | #287–#290/#295/#296/#301/#302/#325: every kind/subtype, exact-item authenticated sign-in return, scope/disclosure/overflow review-only handling, receipt upload/finalization race, private free text in authenticated review; evidence capture failure rolls back submission/finalization |
| R10 — source-reachable export/read workers | `worker.ts::processOneOffJob` handles `payroll-export`, `audit-pack`, `export`, `report`; `lib/jobs/scheduled-exports-processor.ts`, `export-processor.ts`; payroll settings → export-service/data-fetcher; O/job/requester/input scope | Job scope/requester enforcement and retry tracking are separate from immutable work collection; payroll persists filters and rereads when processing; audit/report consumers have distinct assurance requirements | #322/#324: authorized pre-filter blockers + immutable collected work persisted before async delivery, retry uses it, workspace/export minute agreement; preserve finalized historical exports and required audit limitations |
| R11 — source-reachable scheduler/manual/queued execution | `worker.ts::processJob/processCronJob/setupCronJobs`, `lib/cron/registry.ts`, `reconciliation.ts`; administrative cron settings/API triggers and BullMQ queue; global dispatch routed into O scopes | `ENABLE_CRON_JOBS=false` skips scheduler setup only; worker still consumes registered/queued/manual names. Scheduler reconciliation upserts; process exit/graceful close is not fleet-wide drain evidence. Execution completion tracking is distinct from business result | #271/#327: inventory old names/jobs/active binaries, gate handlers before drain, retire scheduler registrations explicitly, retain guarded handler for survivors; test old/manual/queued names and post-commit tracking failures |
| R12 — source/build known, deployment unknown | Repo-root `.github/workflows/publish-images.yml`, `docker/Dockerfile.webapp`, `docker/Dockerfile.worker`, `docker/targets/worker/include.txt`, `deploy/compose/docker-compose.yml`, `deploy/k8s/webapp.yaml`, `worker.yaml`; desktop `package.json`, `src-tauri/tauri.conf.json` | Source packaging and process configuration exist; no observed deployment digest, fleet/version population, operational owner or effective drain/update event. Source worker include coverage is not deployed participation | #266/#327 then #328–#331: accountable source/build/release owners, version/capability matrix, old-client/worker coexistence control, scoped pilot and compatible rollback drill |
| R13 — source-reachable privileged linked approval purge | Repo-root `apps/webapp/scripts/approvals.ts` and `app/[locale]/(admin)/platform-admin/settings/approval-maintenance-actions.ts` → `lib/approvals/maintenance.ts`; O/explicit linked lifecycle | Transaction with table locks, explicit-link traversal across workflow/legacy/chain, clears source references without changing business status; caller owns authorization/audit. Same source ID alone does not identify one cycle | #306: include evidence/handles/invocation associations/receipts/intents/message identities before capture; atomic audit, other cycles/outcomes preserved, no late recreation; reconcile table locks with adoption order |
| R14 — source-reachable whole-org/demo cleanup | `cron:organization-cleanup` → `lib/jobs/organization-cleanup.ts`; demo actions → `lib/demo/demo-data.service.ts`, `delete-non-admin.ts`; O/multiple E/U/config and graph | Explicit deletion plus schema cascades reaches entries/periods/approvals/config/auth; runtime demo cleanup affects retained append descendants. Whole-org transaction currently lacks the future linked evidence inventory | #306/#318/#327: complete scoped gate/lock order and linked cleanup before production capture; preserve other organizations, stop outstanding delivery and stale positions, race cleanup with writers/callbacks/recovery |
| R15 — retained operator/migration surfaces | Repo-root `apps/webapp/scripts/approval-workflow-rollout.ts`, `approvals.ts`, `migrate-with-lock.js`, `obliterate-job-queue.ts`; `src/db/seed/do-seed.ts`; SQL migrations under `apps/webapp/drizzle`; `lib/time-record/migration` read-time repair | Approval rollout has its own gate; migration mutex is not employee/config coordination; queue obliteration can erase recovery evidence. Historical timezone migrations infer unhashed capture metadata; hashes do not prove original capture | #306/#318/#319/#323/#327: inventory authorized invocation/build owners and old tools, separately approve diagnostics/repair/continuation, preserve rollback/replay/evidence; effectively disable incompatible tools. Do not run old backfill/queue obliteration as adoption |

### R16 — expiry and user-visible deletion consumers (source-reachable)

`worker.ts` one-off `cleanup` → `lib/cleanup.ts::runCleanup` dispatches:

- `expired_exports` → `lib/export/export-service.ts::cleanupExpiredExports`;
  storage removal and export-record deletion are separate effects. The retained
  `SET/export/actions.ts` (`SET` = `app/[locale]/(app)/settings`) also calls
  `deleteExportRecord(exportId, organizationId)` for explicit deletion.
- `old_notifications` → `lib/notifications/notification-service.ts::deleteOldNotifications(90)`;
  user notification deletion methods in the same service are additional consumers.
- `old_audit_logs` → `lib/audit/cleanup.ts::deleteOldAuditLogs(365)`.

`cron:execution-cleanup` → `lib/jobs/execution-cleanup.ts` →
`lib/cron/tracking.ts::cleanupOldExecutions` has separately configured retention.
Expiry selectors can span organizations; their present notification/audit/export/
execution rows are not authority-independent operation receipts. Scope is each
selected row's organization/user/package/job plus any future linked evidence.

**#306/#322/#324/#327 acceptance:** explicitly classify which evidence these
consumers may remove before new lifecycle capture; preserve unresolved work,
committed recovery, immutable export input and attention independently of UI
notification or scheduler-log expiry. Test actual dispatch/deletion and failure
between remote object removal and DB update, with scoped audit and no foreign
deletion. Adopt or effectively disable incompatible consumers without inventing
a new global retention policy.

## Exact worker names and surviving invocation paths

`lib/cron/registry.ts` currently registers these affected names:

- `cron:teams-escalation`, `cron:telegram-escalation`,
  `cron:discord-escalation`, `cron:slack-escalation`.
- `cron:teams-daily-digest`, `cron:telegram-daily-digest`,
  `cron:discord-daily-digest`, `cron:slack-daily-digest` (delivery/read consumers).
- `cron:break-enforcement`, `cron:work-balance`.
- `cron:organization-cleanup`, `cron:execution-cleanup`.
- `cron:export`, `cron:scheduled-exports`.
- `cron:billing-seat-reconciliation`, `cron:scim-maintenance`.

The one-off dispatcher includes `import-review-scan`, `import-review-commit`,
`payroll-export`, `audit-pack`, `report`, `export`, `cleanup`,
`organization-deletion-notification`, `email`, `webhook` and `calendar-sync`.
Generic dispatch has concrete source owners: `lib/reports/generator.ts` delegates
to `report-generator.ts::generateEmployeeReport`, `lib/exports/processor.ts`
delegates to `lib/export/export-service.ts::processExport`, and `lib/cleanup.ts`
dispatches the R16 consumers. Their existence is source evidence; actual packaging,
deployed invocations and all affected reader/retention guarantees remain E01/E08
release checks.

Inventory repeat schedulers, waiting/delayed/retrying/active/completed jobs and
manual API calls separately. `worker.close()` on one process waits for that
process's jobs; it cannot prove all older processes have stopped. Do not erase
jobs/receipts to manufacture a drain. `cron:execution-cleanup` retention is not
business-receipt or unresolved-attention retention.

## Preservation and effect ownership acceptance

These requirements attach to each applicable row above:

1. Preserve the exact frozen command, original bytes/omissions/provenance and
   identity through local storage failure, process/tab restart and retry. A
   recovery-record ID is not proof of business identity or noncommitment.
2. Pause on account/organization/server mismatch, unsupported versions and
   uncertain predecessors; never retarget a close to the currently active period.
   Context switching does not cancel a possible remote commitment.
3. Persist committed receipt/resolution before active queue removal. Bounded
   retry exhaustion stops attempts, not retention. Authenticated inspection/export
   and visible archive retain evidence; editing links a new identity only after
   resolving uncertainty or separately authorized reconciliation.
4. One logical delivery effect has one owner. Escalation owns replacement and
   retirement/recovery; initial/status notification ownership coordinates with
   canonical/legacy events. Required work follow-ups likewise have one executor.
5. Transport distinguishes accepted with full identity, unavailable, retryable,
   permanent and ambiguous. Retry at 1 minute, 5 minutes, 30 minutes, 2 hours,
   then 12 hours from the preceding attempt. Fence leases; retain duplicate/late
   identities and retire obsolete controls without reviving them.
6. Delivery failure never undoes committed authority/work. All destinations
   unavailable creates immediate durable attention; partial failure does so at
   exhaustion. Notification delivery does not resolve an incident.
7. Strict admission waits for preservation release and **effective control of
   every affected destructive old consumer**. Optional reload, SW/IndexedDB version,
   cache bump or an upgrade-error response is insufficient.

## Rollback boundary

Per-scope pilot records must prove exclusive ownership before expansion. A
rollback may use a compatible release or pause fresh affected work while keeping
committed authority, evidence, receipts and recovery. Escalation pause stops new
transfers, not delivery recovery or the replacement's existing authority. Never
restore destructive queue consumers or ungated writers against adopted data.
