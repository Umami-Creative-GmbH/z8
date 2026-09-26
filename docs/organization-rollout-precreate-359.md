# Coordinated organization creation with pre-created rollout rows (#359)

## What changed

- **Organization creation is one coordinated auth transaction.** Both production entry
  points run Better Auth's `/organization/create` inside `runCoordinatedAuthMutation`:
  - the create-organization dialog, over HTTP, through `handleCoordinatedAuthRequest`
    (`/organization/create` is in `COORDINATED_AUTH_MUTATION_PATHS`, derived from
    `organization().endpoints.createOrganization.path`);
  - onboarding, whose `OnboardingService.createOrganization` wraps `auth.api.createOrganization`
    in `runAuthMutation`.

  The organization row, the owner membership (with its #314 guard taken in
  `beforeAddMember`), the session's active organization and one rollout row per
  `APPROVAL_WORKFLOW_TYPES` entry commit together. If any step fails, none of them remains.
- **Hooks.** `createCoordinatedOrganizationHooks` now has `beforeCreateOrganization`, which
  refuses an uncoordinated creation before the organization row is written, and
  `afterCreateOrganization`, which writes the rollout rows on the coordinated transaction.
  Both fail closed through `requireAuthTransaction`.
- **Rollout writer.** `lib/approvals/workflow/organization-rollout.ts`
  (`createOrganizationApprovalRollouts`) inserts `legacy`/`legacy` rows with
  `on conflict (organization_id, workflow_type) do nothing`. It is registered in
  `CANONICAL_WRITE_OWNERS` for `approval_workflow_rollout: ["insert"]`.
- **Backfill.** Migration `0107_approval_workflow_rollout_precreate` inserts the missing rows
  for every organization × workflow type (`legacy`/`legacy`, `on conflict do nothing`). It never
  changes an existing row or its modes, and re-running it inserts nothing.
  `drizzle-migrations.test.ts` keeps its workflow-type list equal to `APPROVAL_WORKFLOW_TYPES`.
- **Write gate unchanged.** `acquireApprovalWriteGate` keeps its insert as the fail-safe for a
  missing row. No lock, mode or activation path was added. No database trigger was added.

## Defect found and fixed: HTTP writes escaped the coordinated transaction

Better Auth's `auth.handler` runs each request under `runWithAdapter(baseAdapter)`. This
resets its adapter context, so under `handleCoordinatedAuthRequest`:

- Better Auth's own writes went through the base adapter on the pool and committed on their
  own. Only the hooks wrote in the coordinated transaction. Over HTTP, a failed creation left
  the organization and its owner behind.
- An endpoint that opens its own `runWithTransaction` opened a second, independent
  transaction.
- `queueAfterTransactionHook` saw no active transaction and ran queued work at once, before
  the commit.

This affected every coordinated HTTP path from #314, not only creation. #314's HTTP evidence
did not catch it, because each of its Better Auth writes ran after the guard wait.

The fix is in `lib/auth/auth-transaction.ts`:

- While a coordinated transaction is published, the captured drizzle client given to
  `drizzleAdapter` runs every query on that transaction. A transaction opened on it joins it.
- `queueAfterAuthTransactionCommit` queues work on the outermost captured transaction. The
  work runs after that transaction commits and is dropped on rollback. The coordination hooks
  use it instead of Better Auth's `queueAfterTransactionHook`.

## Organization creation inventory

| Path | Inserts `organization` | Rollout rows |
| --- | --- | --- |
| Create-organization dialog → `authClient.organization.create` → `/api/auth/organization/create` | yes | `afterCreateOrganization`, same transaction |
| Onboarding → `OnboardingService.createOrganization` → `auth.api.createOrganization` | yes | `afterCreateOrganization`, same transaction |
| Any other `auth.api.createOrganization` caller | refused (`UncoordinatedAuthMutationError`) before the insert | none |
| SCIM | no | none |
| SSO `organizationProvisioning` | disabled (#314) | none |
| Seed | no | none |
| PostgreSQL test fixtures | direct SQL | each fixture inserts its own rows; otherwise the write gate's fail-safe creates them |
| Organizations existing before 0107 | none | migration 0107 |

## Evidence

- New suite `lib/auth/organization-creation.integration.test.ts` (9 tests; registered in the
  runner and `tests.yml`). It uses a real Better Auth instance with the production
  coordination hooks. Like the #314 suite, it builds that instance in the test rather than
  loading `@/lib/auth`: the production-only plugins (Turnstile, SCIM, admin, SSO) and the
  email-lookup adapter wrapper are absent, and onboarding's `runAuthMutation` is the same
  one-line `runCoordinatedAuthMutation` over the test instance.
  - Over HTTP, the organization, the owner and the 7 `legacy`/`legacy` rows commit together.
    While the owner's guard is held, the uncommitted organization is not visible.
  - Onboarding creates the same row set.
  - A failure injected into the rollout-row write or the owner's member guard leaves no
    organization, member, rollout row, session change or after-commit provisioning. This holds
    over HTTP and, for the rollout failure, through onboarding.
  - An uncoordinated `auth.api.createOrganization` is refused before any write.
  - Rollout rows cascade-delete with the organization.
  - The 0107 SQL, run twice in a rolled-back transaction, adds only the missing rows and keeps
    an existing `canonical` row untouched.
  - With the transaction rerouting removed, the three atomicity tests fail.
- `clocking.web-clock-out.integration.test.ts`: the pinning test became "does not serialize a
  distinct employee behind the organization's first clock-out once its rollout rows exist",
  plus "still bootstraps a missing rollout row in the write gate".
- `clocking.manual-auth-scim.integration.test.ts`: new HTTP `/organization/remove-member`
  rollback test.
- `verify-approval-migration-recovery.ts` passes on the fresh chain including 0107.
- The #272 dossier and the #314 record are updated.
