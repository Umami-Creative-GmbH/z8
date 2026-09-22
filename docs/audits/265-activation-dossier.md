# Approval and completed-work activation dossier — #265

Date: 2026-09-13. Implementation ticket: [#265](https://github.com/Umami-Creative-GmbH/z8/issues/265).
Parent: [#264](https://github.com/Umami-Creative-GmbH/z8/issues/264).
Source baseline: `35fa37b438c99a473596dfac2a861a79fdfd538d`.

**Status: source inventory delivered; affected activation remains blocked.**
This dossier records source-observed entry points, current ownership and
coordination, required acceptance evidence, and follow-up owners. It is not a
production census, proof of runtime atomicity, or permission to repair or activate.
The session scope is #265, not completion of the parent program.

## Inventory

| Register | Contents |
| --- | --- |
| [Work paths](265-work-paths.md) | W01–W23: creators, open appenders, completion, corrections, splits, attribution, imports, demo, repair and payroll/audit consumers |
| [Configuration and access paths](265-configuration-paths.md) | C01–C19: actual settings, HTTP, auth/SSO/SCIM, provisioning, eligibility, billing and cleanup mutation owners |
| [Runtime and lifecycle paths](265-runtime-paths.md) | R01–R16: browser/desktop/mobile/extension, all four bots, routing, workers, deployment, privileged/whole-tenant cleanup and expiry consumers |

Each row records the caller, affected scope, current transaction/evidence owner,
and either the acceptance check or the effective retirement needed. Ticket
numbers in owner columns refer to native children of #264; they are responsibility
assignments, not assertions that those tickets are implemented or staffed.

### Evidence vocabulary

- **Source-reachable**: a retained application route/action, registered worker,
  or runtime caller reaches the path. Actual deployed use is unknown.
- **Retained-disabled**: an inspected user entry point rejects execution. This
  does not prove old binaries, direct imports or operator invocation are disabled.
- **Candidate**: a retained insertion/mutation surface without a found production
  caller. Keep it in disposition work; do not label it a proven active bypass.
- **External-unknown**: tracked source or operational evidence is insufficient.
- **Not demonstrated**: the required guarantee has not been verified. Existing
  transactions, allowlists, receipts and tests are recorded without upgrading them
  to the parent contract.

All deployed participation, historical prevalence and pilot status are **unknown**
unless an evidence record below is explicitly completed. Rows grouped under a
service family include its create/update/delete and absent-row insertion paths;
they do not mean every function uses one transaction today.

## Binding contracts

The parent acceptance matrices remain binding. This inventory does not replace
their detailed semantics:

- [#259 adoption order and final handoff](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
- [#256 completed-work ownership and receipts](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538).
- [#258 manual preparation and configuration protection](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697).
- [#262 append lineage, retention and continuation](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073).
- [#263 durable clock commands and preservation-first adoption](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636).
- [Timekeeping reference](../refs/timekeeping.md), [project conventions](../refs/project-conventions.md), and [agent workflow](../refs/agent-workflow.md).

## Scope and activation decision

An activation record must identify organization, approval kind, authority mode,
provider/receiver, work-writing channels, affected employees, writer/client
versions and evidence references. A channel gate cannot admit an unadopted writer
against an employee graph shared with an adopted channel.

| Scope | Blocking dossier rows and evidence | Responsible follow-up |
| --- | --- | --- |
| Fresh live/completed work and append continuity | W01–W19 and shared canonical lifecycle W22, C03–C19 as applicable, R01–R05/R10–R16; every competing writer participates or is effectively drained/disabled; compatible readers and retained history precede capture | #272–#286, #301–#306, #327, pilot #329 |
| Fresh manual work | W07 plus the same employee's competing writers; C01–C19 for actual dependencies; R01/R13–R16; new command, target context, protected interpretation, tab recovery, non-provisioning billing and rebuild freshness | #307, #308, #310–#318, #327, #329 |
| Strict immediate/delayed clock admission | Additive server recovery, W01–W06, R01–R05; verified old-consumer control and preservation release before stricter admission | #266–#268, #275, #278–#283, #329 |
| Non-time approval authority/presentation | R06–R09/R11/R13–R16, C03–C08/C16/C19; per-kind immutable evidence, reviewed binding/invocation and actual replacement inbox/decision/delivery | #270, #271, #287–#300, #306, pilot #328 |
| Time approval presentation/escalation | Non-time infrastructure plus W07/W11–W13 and complete transaction-owned submission/result segments; no early interactive routing | #301–#306, #325–#327, pilot #330 |
| Payroll-ready collection and repair/continuation | W16–W23, C01/C02/C16, R10/R13–R16; authorized evidence collection, preserving proposals, pre-filter blockers, snapshot and persisted input recovery | #319–#324, #327, #329; expansion/rollback #331 |

No scope is certified active by this document. Ready non-time combinations may
proceed independently of timekeeping only with all of their own evidence gates.
Deployment of additive support and inactive gates is distinct from activation.

## Concrete coordination register

The required **outer transaction** acquisition order is:

1. Sorted organization adoption gates.
2. Relevant approval cutover gates in deterministic order.
3. Sorted organization manual-configuration guards.
4. Sorted required user-global configuration/access guards.
5. Sorted complete employee coordination set, reusing
   `pg_advisory_xact_lock(hashtextextended(employeeId, 0))`.
6. Deterministic operation/source identity locks, receipt/staging/bootstrap claims,
   then authoritative rows in a documented table/ID order.
7. Remaining workflow decision/CAS/mirror work.

This is the adopted target, not the current implementation. Routing reads may
discover scope; a changed protected scope requires rollback/restart. Earlier
resources cannot first be acquired in a late finalizer. Multi-transaction adoption
needs durable paused/adopting state; a transaction lock cannot span commits.

Paths in this table are relative to `apps/webapp/src/`.

| Existing acquisition/effect boundary | Source evidence | Required reconciliation and verification |
| --- | --- | --- |
| Shared live clocking | `lib/time-tracking/clocking-service.ts:174–198,366–399`: employee advisory lock, then scoped employee/replay reads; optional caller transaction and completion callbacks | #272/#274 move the complete protocol to the outer owner; preserve scoped matching; prove empty-history/occupancy races with real PostgreSQL |
| Reviewed import | `lib/import-review/committers.ts:287–295,574–580`: staging row UPDATE claim first, then `${organizationId}:${employeeId}` advisory key | #284 acquire complete employee scope before staging claim using the shared key; exercise import/live/manual in both arrival orders |
| Workflow command | `lib/approvals/workflow/transition-engine.ts:449–513`: actor/source routing, approval gate, command claim, completed replay before fresh version/authorization checks | Preserve receipt-before-fresh semantics while composing upstream work/configuration protection; #274/#287/#301/#302; never equate a new invocation with an old semantic receipt |
| Correction cancellation | `lib/approvals/server/time-correction-cancellation.ts:76–147`: transaction source lock before cutover gate | #301 move first acquisition outward; race cancellation/submission/terminal decisions and preserve committed predecessor evidence |
| Policy terminal break | `lib/approvals/server/work-period-approvals.ts:1743–1827` changes period/canonical state before calling `lib/time-tracking/policy-clock-out-terminal-break.ts:202–217`, which acquires employee and ownership locks | #303 establish earlier-ranked protection before graph mutation; exact resolving cycle exemption, all segments and receipt atomicity |
| Surcharge snapshot | `lib/time-tracking/policy-clock-out-surcharge-snapshot.ts:437–505` locks organization, employee and eligible assignment rows; subsequent model/rule reads also lock | #272/#274/#303/#327 document row order against configuration writers, break snapshot and finalization; keep event-end evaluation semantics distinct from fresh manual evaluation |
| Balance projection | `lib/work-balance/service.ts:39–42,615–739`: `work-balance:${organizationId}:${employeeId}` locks, reset/rebuild rows; user timezone reset discovers multiple organizations | #311/#312 move rebuild to durable separately coordinated intent; sorted complete cross-org scope, rollback/restart and stale-projection consumer checks |
| Privileged linked purge | `lib/approvals/maintenance.ts:150–164`: table-level SHARE ROW EXCLUSIVE locks before linked lifecycle traversal/source detachment | #306/#327 reconcile table locks with gates/rows and audit in the same transaction; race purge with capture, dispatch and late callbacks |
| Auth/SCIM | `lib/auth.ts:455–458` enables adapter transactions; `lib/scim/auth-configuration.ts:195–216` passes the provider transaction to lifecycle/projection; ordinary membership hooks at `618–688` use separate DB work | #314 instrument the original mutation transaction, including plugin-managed mutations; adapter transaction support/after-hooks alone does not prove the new guards |
| Organization cleanup | `lib/jobs/organization-cleanup.ts:161–438`: deletion transaction over entries, periods, approvals, eligibility/configuration and auth rows | #306/#318/#327 establish the complete gate/user/employee set before deletes/cascades; verify actual FK and auxiliary-lock order |

For each adopted operation, attach an ordered trace naming concrete tables and
IDs, implicit FK locks, surcharge/balance effects, authorization rows and cleanup
interactions. Required evidence includes both arrival orders, absent rows,
changed-scope restart, independent employees and failure at each graph/evidence/
receipt/intent/position write. Advisory-lock mocks do not discharge this gate.

## Mandatory operational and historical investigations

These are assigned evidence obligations, not assumed failures in production.

| ID | Unknown / required output | Scope held and owner |
| --- | --- | --- |
| E01 | Running web/worker/admin/migration/demo binaries, image digests and process owners; old transaction/queued/manual-job inventory; documented drain or effective disable with observed completion | Every affected writer/worker scope; #327 with #271/#306/#318; pilot #328–#330 |
| E02 | Extension/mobile source repository, build provenance, accountable maintainer, distributed versions, server endpoints, exact command/queue formats and enforced update/disable capability | Those client scopes and any stricter admission their consumers can reach; #266, #282/#283 |
| E03 | Desktop release provenance/version population and browser active service workers/tabs; proof destructive readers cannot process affected records, including interrupted upgrades | Browser/desktop strict admission; #266–#268, #279–#281, #329 |
| E04 | Authorized scoped inventory of pre-existing and in-flight operations, original command versions and writer/adoption provenance; distinguish historical gaps, uncertain provenance and post-adoption incidents | Work/append/clock scopes; #319/#327; do not classify from event date |
| E05 | Separate assignment/transfer/actionable-time/lineage and immutable card-history classification; migrated escalation policy provenance/conflict review and old-card historical-only disposition | Per organization/kind/authority/provider; #287/#288/#295/#297–#300/#325/#326 |
| E06 | Graph evidence: IDs/hashes, missing versus conflicting values, hash families/original provider bytes, inactive/deleted predecessors, canonical-native work, historical minutes/actors/captures/approvals/allocations | Employee append and conservatively relevant payroll scope; #319/#320/#323/#324; continuation does not certify payroll readiness |
| E07 | Separately authorized expected-state proposal, exact before/after/evidence/uncertainty, approving actor, executing actor and stale revalidation for repair/continuation | Only affected records/employee; #320/#323. Existing read-time backfill is not the executor |
| E08 | Real PostgreSQL, client storage/crash, provider transport and composed-interface acceptance reports at exact revisions; access must be restored for environment-dependent checks | Applicable scope; each implementation owner and #327. Unit/source checks remain supplementary |
| E09 | Evidence of exclusive ownership switch, limited organization pilot observations, compatible rollback/paused-fresh-work drill and expansion authorization | #328–#331; never restore destructive consumers or ungated writers |

Production-data, provider credentials, database and deployed-process evidence are
not available to this session. Repository rules require skipping work needing
Phase-provided environment variables. No production diagnostics, database
operations, repairs, continuation, deployment or activation were performed.

### Evidence record to complete before activation

For each applicable E-row, record: organization/employee/kind/provider scope;
source/build/deployed version; collector and collection time; authorized evidence
location; observed result; unresolved limitations; responsible ticket/person;
acceptance check and result; effective disable/drain if used; approving actor.
Keep sensitive row-level exports in the authorized evidence store, not this repo.
An unfilled record is unknown, never an implicit pass.

## Source-audit method and coverage maintenance

1. Re-read the five binding resolutions, then trace their named entry points at
   the baseline above. Root/context glossary and ADR files were absent.
2. Search tracked application, worker, scripts and schema sources for Drizzle
   `insert/update/delete` calls, raw SQL table writes/locks, generic auth adapter
   writes, and caller imports. Follow wrappers through the actual mutation owner.
3. Cross-check `lib/approvals/approval-write-boundary.ts` canonical owners and
   legacy/source exceptions, including raw-SQL maintenance and terminal breaks.
   That allowlist protects a narrower approval boundary; it does not inventory
   all work/configuration writers or prove transaction participation.
4. Inspect source/build manifests and `git ls-files apps/extension apps/mobile
   apps/desktop`. No extension/mobile application source was tracked; desktop
   was tracked. Server routes and untracked compiled artifacts do not establish
   deployed application coverage.
5. Classify each mutation family below. A candidate/new caller must be assigned
   to a row and adoption/retirement owner before the all-writer gate is satisfied.
   Re-run this audit against the intended release, including aliases/raw SQL,
   newly added routes, auth plugins, scripts, migrations and FK cascades.

The configuration register explicitly distinguishes neighboring data such as
hydration/display preferences from actual manual dependencies. This avoids
inventing a location-timezone or global holiday mutex. It still includes shared
table insertions and deletions that change fallback/access facts indirectly.

## Verification record

This change is an inspectable documentation deliverable. No new behavioral
interface or test seam was introduced, so no implementation-mirroring tests were
added. The pre-agreed runtime seams remain acceptance obligations for their
implementation tickets.

- `pnpm --filter webapp typecheck` — passed during source inventory and again
  after review corrections, including Next route generation and the
  production/workflow-contract/smoke TS projects.
- `pnpm --filter webapp test src/lib/approvals/approval-write-boundary.test.ts` —
  initial isolated run exceeded the 120-second tool timeout. The file subsequently
  passed as part of the full webapp suite below; no isolated pass claimed.
- `pnpm test` — 29 Docker runtime/tracer tests passed; Turbo then failed to launch
  `webapp#test` with `Exec format error (os error 8)`. The root command did not pass.
- `pnpm --filter webapp test` — full webapp suite ran once directly after the
  launcher failure: **1,000 files passed, 5 skipped; 11,127 tests passed, 283 skipped**
  (189.83 seconds). Skipped checks are not passing runtime/activation evidence.
- `git diff --check` and `git diff --cached --check` — passed after corrections.
  Relative dossier/reference links and the added source traces were inspected.
- Repository-required React performance, composition and UI guideline applicability
  was checked: this diff adds Markdown inventory only, with no React/UI changes.

### Standards review

Independent `code-review` Standards axis against the four added dossier files:
**0 documented-standard violations; 0 applicable heuristic smells**. Source
spot-checks included transaction/queue/SCIM/maintenance boundaries and deployment
paths. No current-runtime guarantee was inferred from source.

### Spec review

Independent `code-review` Spec axis against #265: **2 inventory omissions found
and resolved**. Added the distinct SSO provisioning path (C19) and audit-package
verification owner/callers (W23). Follow-up source review confirmed both fixes
and the concrete expiry/cleanup register (R16), with no new factual errors found.
No outstanding review findings remain. Review compared the staged additions to
the source baseline, then checked the corrected worktree before commit.

These checks validate the source-inventory delivery, not the future #264 runtime
contract. E01–E09 remain explicit pre-activation obligations; database-dependent
acceptance, deployed-client/worker control, repair and pilots await the required
access and separate authorization.
