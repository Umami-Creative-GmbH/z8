# Bot approval consolidation verification — #245

Date: 2026-09-13. Ticket: [#245](https://github.com/Umami-Creative-GmbH/z8/issues/245).
Parent: [#240](https://github.com/Umami-Creative-GmbH/z8/issues/240).
Baseline: `2e1483239233a80316e2c1d86753a0edbd9f768d`.

## Caller and deletion audit

All paths below are relative to `apps/webapp/src`.

- `lib/slack/approval-handler.ts`, `lib/discord/approval-handler.ts`,
  `lib/telegram/approval-handler.ts`, and `lib/teams/approval-handler.ts` each
  dynamically import and call `attemptBotApproval` with the resolved actor,
  trusted organization, action, request ID, and platform.
- The common attempt owns the organization-scoped compatibility-request gate,
  inbox target discovery, eligibility-before-assignee ordering, assigned-approver
  comparison, and dispatch through the public single-item inbox decision API.
  Each adapter interprets semantic exits and retains its own presentation and
  delivery behavior. Approval-request queries remaining in adapter sending
  functions prepare messages; they do not reconstruct decision orchestration.
- A repository-wide caller search found no caller for
  `loadBotApprovalDecisionTarget`. `canAttemptBotApprovalDecision` was called
  only by `lib/bot-platform/approval-decision.test.ts`. Both forwarding functions
  have been deleted.
- `decideBotApproval` was called only by the common attempt and that forwarding
  test. It is now private: adapters have one public attempt entry point.
- The deleted test substituted inbox dispatch and reimplemented eligibility in
  its mock. Its useful assertions (scope, eligibility, exact platform rejection
  attribution) are covered by the retained composed handler tests.
- Inbox functions remain reusable authorities. Single-item approve/reject API
  routes use target loading, eligibility, and public decisions;
  `lib/approvals/application/bulk-approval.service.ts` uses eligibility and the
  lower-level decision interface. None of those interfaces was removed.
- Deletion test: removing the common attempt would force compatibility gating,
  target discovery, ordered eligibility/assignment checks, and public inbox
  dispatch back into four adapters. The shared module hides that sequence,
  rather than just forwarding each individual step.

## Retained behavioral evidence

Each platform's `approval-handler.test.ts` runs real common-attempt and inbox
loading, classification, eligibility, authorization, registry lookup, and Effect
dispatch. Persistence and remote messaging are controlled effects. The ordinary
domain suite separately verifies exact/conflicting replay and post-commit effects;
the adapter doubles do not claim to prove domain idempotency themselves.

| Requirement | Evidence in the four handler suites |
| --- | --- |
| Pending approve/reject and attribution | Committed decision plus resolved presentation/tracking; literal `Rejected via Slack`, `Discord`, `Telegram`, and `Teams` reasons |
| Identity first | Unlinked actors exit before approval reads; Teams also exercises its outer caller |
| Organization and assignee boundaries | Foreign organization/ID, wrong assignee, later scoped target/reload, changed authoritative assignee/status |
| Compatibility gate | No attempt even when a canonical assignment exists without a compatibility request |
| Initial absence versus later failure | Initial semantic not-found remains distinct from target/reload exceptions |
| Eligibility precedence | Terminal correction, unclassified, and unsupported statuses remain ineligible, including linked non-approvers |
| Ordinary replay | Approved/rejected manual submissions and policy clock-outs reach the owner and retain success presentation |
| Original request handoff | Authoritative target drives dispatch while original requester/request data drives presentation |
| Decision failure/conflict | No success presentation or response tracking after owner failure |
| Post-commit delivery failure | Slack/Discord/Telegram swallow/log thrown delivery failures and skip tracking; Teams card-update failure still permits tracking and confirmation |
| Acknowledgements and fallbacks | Discord interaction responses, Telegram outer-dispatcher acknowledgement, Teams invoke responses/confirmation, Slack's existing silent exits and message/tracking fallbacks |

The existing `lib/approvals/inbox/decision-service.test.ts` and
`lib/approvals/server/work-period-approvals.test.ts` run alongside these handler
tests. Authoritative authorization, fail-closed target discovery, exact/conflicting
ordinary replay, and domain-owned side effects remain covered by their owners.

## Import-safety regression

The existing four escalation-processor imports already passed with a throwing
`server-only` mock, modeling the plain-Node worker restriction. Added a direct
`@/lib/bot-platform` barrel import to that same public import seam.

The new test initially failed: the barrel imports the command registry, whose
clock commands eagerly loaded `clocking-service`, `validation`, and the
time-tracking server actions. Deferring those imports until command execution
made the shared barrel and all four processors pass. Command registration stays
synchronous; only dependency loading moved. The approval-attempt dependency
remains lazily imported by the four adapters and is not re-exported by the barrel.

Under full-suite contention the new cold barrel import exceeded Vitest's default
5-second timeout. It now has a local 30-second import allowance. This checks import
compatibility, not an import-latency budget; the throwing server-only guard remains
active. The focused combined suite passed again after this adjustment.

## Executed checks

Commands run from the repository root unless stated otherwise.

1. `pnpm --filter webapp typecheck` — passed before changes, after implementation,
   and after the full-suite follow-up. Includes `next typegen` and the production,
   workflow-contract, and smoke TypeScript projects.
2. `pnpm --filter webapp test src/lib/slack/approval-handler.test.ts` — 35 passed
   before removing forwarding.
3. `pnpm --filter webapp test src/lib/cron/escalation-worker-imports.test.ts` —
   red twice while tracing the eager clock-command dependencies, then 5 passed.
4. Combined acceptance run:

   ```bash
   pnpm --filter webapp test src/lib/slack/approval-handler.test.ts src/lib/discord/approval-handler.test.ts src/lib/telegram/approval-handler.test.ts src/lib/teams/approval-handler.test.ts src/lib/approvals/inbox/decision-service.test.ts src/lib/approvals/server/work-period-approvals.test.ts src/lib/cron/escalation-worker-imports.test.ts
   ```

   7 files, 342 tests passed.
5. `pnpm --filter webapp test src/lib/teams/commands/clock-out.test.ts` — 6 passed.
   This is the existing source-level clock-out check, supplementary to the real
   import and composed approval tests, not evidence of end-to-end clocking.
6. Final focused follow-up after the full-suite import timeout adjustment:

   ```bash
   pnpm --filter webapp test src/lib/slack/approval-handler.test.ts src/lib/discord/approval-handler.test.ts src/lib/telegram/approval-handler.test.ts src/lib/teams/approval-handler.test.ts src/lib/approvals/inbox/decision-service.test.ts src/lib/approvals/server/work-period-approvals.test.ts src/lib/cron/escalation-worker-imports.test.ts src/lib/teams/commands/clock-out.test.ts
   ```

   8 files, 348 tests passed.
7. `pnpm test` — 29 Docker tracer tests passed. Turbo then failed to launch
   `webapp#test`: `Exec format error (os error 8)`. The root command did not pass.
8. `pnpm --filter webapp test` — full webapp suite executed once directly after
   the Turbo launcher failure: 997 files passed, 3 failed, 5 skipped; 11,055 tests
   passed, 67 failed, 283 skipped. Failure breakdown:
   - 65 organization invitation/settings failures in
     `src/app/[locale]/(app)/settings/organizations/actions.test.ts`, outside this
     change, chiefly authorization expectations returning `AuthorizationError`.
   - 1 `src/env-usage.test.ts` failure for `lib/setup/startup.ts`, outside this change.
   - 1 new shared-barrel import timeout, addressed and followed by check 6.
   The full suite was not rerun after the timeout adjustment and is not claimed green.
9. `pnpm --filter webapp exec biome check src/lib/bot-platform/approval-decision.ts src/lib/cron/escalation-worker-imports.test.ts src/lib/teams/commands/clock-in.ts src/lib/teams/commands/clock-out.ts`
   — reported formatting differences in the two clock-command files. Newly added
   lines were formatted; existing unrelated line wrapping was retained.
10. `pnpm --filter webapp exec biome check --formatter-enabled=false src/lib/bot-platform/approval-decision.ts src/lib/cron/escalation-worker-imports.test.ts src/lib/teams/commands/clock-in.ts src/lib/teams/commands/clock-out.ts`
    — passed lint/import checks for all four remaining changed TypeScript files.
11. `pnpm --filter webapp exec biome check src/lib/bot-platform/approval-decision.ts src/lib/cron/escalation-worker-imports.test.ts`
    — passed full lint/import/format check for the approval module and import
    regression after formatting the timeout adjustment.
12. `git diff --check` — passed.

The required React-performance, composition, and web-interface guidelines were
reviewed for applicability. Conditional dependency loading applies here and is
preserved; there are no changed React components, forms, UI markup, or date/time
business rules to assess under the UI-specific rules.

## Environment-limited verification

- Live PostgreSQL approval integration was not run: the disposable runner's
  `APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL` and
  `APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL` are unavailable. The non-live suites
  ran; skipped integration cases are not represented as passed database checks.
- Production build and live platform messaging were not run because Phase-managed
  service credentials/environment variables are unavailable to agents.

## Code review

Two independent read-only reviews examined the working-tree diff against the
pinned baseline and this report before commit:

- **Standards:** 0 documented-standard violations and 0 actionable smell findings.
- **Spec:** 0 actionable findings against #245 and #240. The reviewers confirmed
  that the clock-command import change serves the shared-export worker-safety
  requirement and that the deleted test's useful assertions remain covered.

Both reviews acknowledged the disclosed verification limitations. The reviewers
inspected code and coverage; they did not independently rerun the test suites.
