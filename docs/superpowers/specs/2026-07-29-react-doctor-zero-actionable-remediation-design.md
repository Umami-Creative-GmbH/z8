# React Doctor Zero-Actionable Remediation

## Goal

Resolve every actionable diagnostic in the React Doctor branch scan without weakening transaction semantics, lifecycle behavior, tenant isolation, or domain correctness. Validated false positives and intentionally ordered operations may remain in the raw scanner output, but each remaining occurrence must have concrete evidence showing why changing it would be incorrect or cosmetic.

The work uses React Doctor's working-tree mode. All implementation changes remain unstaged and uncommitted for review.

## Current State

The initial branch scan reported 22 diagnostics in the webapp. The final branch-diff scan reports 12 raw diagnostics:

- 2 `effect-needs-cleanup` errors;
- 1 `no-array-index-as-key` warning;
- 2 `server-sequential-independent-await` warnings;
- 6 `async-await-in-loop` warnings;
- 1 `no-prevent-default` warning.

The final branch-diff score is 76/100. Canonical filtering leaves zero actionable diagnostics.

Canonical rule validation shows that the two reported errors and two UI warnings are false positives. Most loop warnings protect deliberate transaction ordering. A smaller set represents real independent work or avoidable per-row database round trips.

## Principles

1. Preserve correctness ahead of the raw scanner score.
2. Do not parallelize operations that acquire locks, maintain hash chains, perform ordered compare-and-swap transitions, or establish write-then-read causality.
3. Prefer set-based SQL over concurrent statements on one transaction connection.
4. Validate exact affected row identities after set-based mutations; counts alone are insufficient.
5. Preserve organization scoping in every query and mutation.
6. Keep failure behavior atomic and fail closed on partial mutations.
7. Do not add React Doctor configuration, inline suppressions, or false-positive files.
8. Leave all implementation edits unstaged and uncommitted.

## Validated False Positives

### Service Worker Cleanup

`SWUpdatePrompt` already removes every listener it registers using the same handler references. It also checks its mounted flag before an asynchronous service-worker readiness callback registers a listener. Existing tests verify cleanup for `updatefound`, `statechange`, `controllerchange`, and `message`.

No production change is required.

### Persistent Push Subscription

`pushManager.subscribe` runs inside a user-triggered hook action, not an effect. A successful browser push subscription is intentionally persisted and must outlive the rendering component. Failed server persistence rolls the subscription back, and explicit user-driven unsubscription owns normal cleanup.

Unmount cleanup would create inconsistent browser/server state, so no production change is required.

### Wellness Placeholder Keys

The droplets are identical decorative placeholders generated from `Array.from({ length })`. They contain no state, input, or domain identity and only append or truncate at the end. An ordinal string key would disguise the same identity without changing behavior.

No production change is required.

### TanStack Profile Form Submission

The profile editor intentionally intercepts native submission and delegates to TanStack Form for client validation, invalid-field focusing, typed payload transformation, upload coordination, and imperative server-action invocation. Removing `preventDefault` would perform both native and client submissions. A progressive-enhancement rewrite would be a separate product and form architecture change.

No production change is required.

## Safe Independent Reads

### Invite-Code Employee Provisioning

The existing employee lookup and organization-scoped default-team lookup are independent plain reads after identity serialization is established. Start them together with `Promise.all`, then preserve the existing update, reactivation, and insertion branches.

Add a deferred-promise test proving both reads start before either resolves. Retain all organization-isolation and idempotency tests.

### Pending-Member Approval

After the guarded `pending -> approved` member transition succeeds, the approval audit insert and existing-employee lookup are independent within the same transaction. Start them together, then provision or reactivate the employee only after both complete.

Add deferred-start coverage and retain rollback, race-loss, tenant-isolation, and billing-order tests.

## Set-Based Transaction Mutations

### Time-Correction Cancellation

Replace the bounded per-correction delete loop with one set-based delete after all relevant rows have been locked and validated. Preserve organization, employee, type, supersession, and replacement-lineage predicates. Return deleted IDs and compare the exact returned set with the expected correction IDs. Any mismatch aborts the transaction.

### Absence Legacy Cancellation

Preserve the required phases:

1. Flatten and clear every pending stage row across all affected chains.
2. Cancel every parent chain only after all stage links are cleared.
3. Delete active approval requests only after all chain roots are cancelled.

Within phase one, update the global expected stage set in one mutation and verify exact returned IDs. Keep all parent-chain updates behind that global barrier, update the expected chain-root set in one mutation, and verify exact returned IDs. Keep all request deletes behind the chain-root barrier. Delete eligible approval requests set-wise, grouping by expected status if necessary, and verify exact returned IDs. Historical requests not linked to active stages remain untouched.

### Compatibility Legacy Cancellation

Replace per-stage cancellation writes with one set-based update scoped by organization, chain, stage identity, pending status, and expected nullable request linkage. Verify the exact returned stage set before cancelling the chain root.

## Intentionally Sequential Approval Operations

Keep these operations sequential because ordering is part of their contract:

- historical correction rollback and modern correction activation/supersession pairs;
- reverse-order replay cleanup for hash-linked correction entries;
- projection and outbox writes before command receipt completion;
- compatibility and workflow-start outbox persistence where tests require deterministic fail-fast order;
- transaction row locks acquired in a stable order;
- telemetry insert-if-absent followed by the winner read.

These occurrences receive no cosmetic restructuring. Existing ordering tests remain the evidence that the diagnostics are non-actionable.

## Clockodo Import Refactor

### Teams

Do not parallelize the current check-then-insert loop because team names are not unique per organization. Instead:

1. Group source records by the exact existing name semantics while preserving first occurrence order.
2. Fetch existing organization teams for relevant names in bounded chunks.
3. Insert one representative for each missing name in bounded bulk statements and return each inserted row's ID and name.
4. Build a name-to-team-ID map.
5. Populate every source team mapping in original input order.
6. Derive imported, skipped, and error results deterministically.

No organization-wide team-name uniqueness constraint is introduced.
The import deduplicates one source payload only. Preventing duplicates across concurrent imports requires a separate data audit and database or serialization design and is outside this remediation.

### Holiday Quotas

Do not parallelize the current employee/year check-then-insert loop. Instead:

1. Collect mapped employee IDs from the import context, then resolve them through bounded employee queries filtered by the active `organizationId`; reject missing or foreign-organization mappings.
2. Group quotas by employee and year, retaining first-wins behavior.
3. Fetch existing allowance keys with bounded employee/year queries and retain only exact requested pairs.
4. Insert missing representative rows in bounded bulk statements and return their employee/year identities for exact result accounting.
5. Preserve deterministic counts and input-order errors.

No new uniqueness constraint is introduced without a separate data audit and migration design.
The import deduplicates one source payload only and does not add a cross-import concurrency guarantee.

All provider-sized Clockodo reads and writes use chunks of at most 500 source keys or rows. A local bounded promise executor runs at most four independent database statements concurrently. Exact returned-identity validation and result accounting operate across the flattened payload-wide result, so chunk boundaries do not change first-wins behavior, counts, mappings, or error order.

Each team or holiday-quota database phase is all-or-nothing. The bounded executor waits for every statement in the active window to settle before surfacing the first failure. Reads and writes run through one phase transaction, and in-memory mappings/counts are published only after commit. Any failed chunk rolls back earlier and sibling writes from that phase; the orchestrator never reports zero imports for rows that remained persisted.

## Pending-Member Rejection Integrity

Better Auth treats any row in its live `member` table as organization membership and does not apply Z8's custom status field to organization-plugin authorization. A rejected member therefore cannot remain in that table. Rejection must preserve history independently while removing every authorization-bearing row and access path.

Under the organization and normalized-identity advisory lock, one transaction writes an organization-scoped durable `audit_log` rejection record, including invite, user, member, actor, and rejection-note identity; deletes the guarded pending member; revokes organization-active database sessions; and deactivates the employee only when no approved replacement membership exists. Any database cleanup failure rolls back the audit and deletion so rejection remains retryable. Secondary-session invalidation and billing reconciliation run only after commit through the shared member-removal cleanup primitives.

Invite-code redemption classifies durable rejection history before enterprise enforcement or pending-code clearing. Reusing an invite code for the same organization fails explicitly without creating membership, usage, approval, employee, counter, or billing side effects. Usage statistics read surviving usage and durable rejection audits from one organization-scoped repeatable-read snapshot and tolerate malformed historical audit metadata.

Because invite-code text is unique only within an organization, both direct and pending redemption resolve at most two matches. Zero or multiple matches are invalid or ambiguous and never select an arbitrary tenant. The uniquely resolved invite row is locked and revalidated in the redemption transaction; guarded usage increments prevent concurrent `maxUses` overrun.

Pending-code processing must never clear a newer user selection. Every clear compares both the user ID and the exact pending code read at the start, returning the affected user ID as CAS evidence. A lost CAS means the operation is stale and returns `null` without redemption or billing. For valid non-rejected redemption, the compare-and-clear runs inside the same transaction before lifecycle writes. Rejected membership is classified before clearing. Missing, expired, and blocked codes clear only the expected code, so a concurrently selected replacement remains intact.

Add tests proving:

- no rejected row remains in Better Auth's authorization-bearing `member` table;
- rejection identity and notes remain in independent durable audit history after member-linked rows cascade;
- database sessions and employee access are revoked atomically unless an approved replacement membership exists;
- secondary sessions and billing reconciliation run only after commit;
- usage statistics classify the rejection correctly;
- a competing state transition creates no audit record;
- cross-organization rejection remains impossible;
- bulk duplicate rejection remains idempotent.
- invite-code reuse by a rejected member fails without side effects and is never reported as approved.

If the existing fake database cannot model cascading foreign keys, add the narrowest integration coverage available rather than assuming cascade behavior from the mock.

## Error Handling

- Every set-based mutation validates exact returned identities, rejects duplicate or unexpected returned rows, and throws on any mismatch.
- Transaction failures roll back all related lifecycle, audit, and projection changes.
- Import grouping preserves deterministic first-wins behavior and ordered error reporting.
- Parallel read groups retain fail-fast behavior through `Promise.all`.
- No operation is parallelized when it shares mutable iteration state, requires API throttling, or participates in explicit lock/write ordering.
- Generated output is restored only when pre-command worktree evidence proves the current session changed it; concurrent changes are never discarded.

## Testing Strategy

Use red-green testing for each behavioral change:

1. Add deferred-start tests before parallelizing independent reads.
2. Add multi-row and partial-CAS tests before set-based transaction mutations.
3. Add duplicate-source and existing-row tests before Clockodo import refactors.
4. Add persistence, race, and rejected-code-reuse tests before changing pending-member rejection.
5. Add cross-organization employee-mapping and bounded-batch tests before changing holiday-quota imports.
6. Add 501-row write tests and 2,001-key active-query instrumentation before introducing bounded Clockodo execution; prove writes split into two chunks, the fifth read waits for the first four, and no more than four reads or writes are active.
7. Add a pending-code replacement race and a clear-CAS-loss test proving a newer code is retained with no lifecycle or billing effects.
8. Add delayed-sibling and later-window Clockodo failure tests proving all active statements settle and every phase write rolls back.
9. Run focused tests after each domain change.
10. Run webapp typecheck after each error-severity remediation and after the warning batch.
11. Run repository tests, Temporal timezone smoke tests when time-related approval code changes, and the production build.
12. Re-run the repository-pinned React Doctor with documented changed-file and untracked-file flags, apply canonical filtering, and confirm zero actionable diagnostics without a score regression.

## Success Criteria

- Every remaining raw diagnostic is backed by documented code evidence or a test proving required behavior.
- All safe independent awaits are parallelized.
- Safe per-row database loops are replaced with set-based operations and exact CAS validation.
- Clockodo imports preserve first-wins and tenant-safe behavior without unsafe concurrency.
- Clockodo duplicate prevention is explicitly limited to one import payload; cross-import concurrency behavior is unchanged.
- Rejected pending-member history is persisted independently while live Better Auth membership and database access are removed atomically.
- Rejected members cannot reuse an invite code or be misreported as approved.
- Typecheck, focused tests, full tests, relevant timezone smoke tests, and production build pass.
- React Doctor has zero actionable errors or warnings after canonical validation.
- The working tree contains only unstaged remediation and design/plan changes for user review.
