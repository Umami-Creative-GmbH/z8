# Desktop sign-in migration recovery

Tracked in #780 and PR #790.

## Deployment

The desktop sign-in recovery is a normal Drizzle migration:
`0141_app_auth_code_pkce_recovery`. It adds the nullable PKCE challenge column,
leaves existing rows intact, and accepts databases where the column already exists.

Deploy the matching webapp and migration images from the same release. The production release owner confirmed a dedicated migration worker starts
before other pods. Let that worker complete successfully before routing traffic to the new
webapp. The migration image runs `node ./scripts/migrate-with-lock.js`, which
holds a PostgreSQL advisory lock and invokes Drizzle's journaled migration runner.
No manual column changes or schema push are needed.

The repository's Kubernetes Job has a completion cleanup policy. An absent
migration pod after completion is expected. Helm hook annotations only control
ordering when Helm processes the resource; plain Kubernetes/Kustomize application
does not gain Helm hook ordering from those annotations. The production release
controller must recreate and await the job for each release.

## SQL history audit

| Historical gap | Existing recovery |
| --- | --- |
| `0021_sick_detail` has a timestamp below an earlier journal entry | `0051_sick_detail_recovery` |
| `0027_employee_work_balance` has a timestamp below an earlier journal entry | `0029_employee_work_balance_recovery` |
| `0051_daily_digest_delivery.sql` was never journaled | `0060_approval_workflow_recovery` |
| PKCE challenge declared in the schema but absent from SQL history | `0141_app_auth_code_pkce_recovery` |

Preserve the historical journal entries and SQL files. Changing their timestamps
or replaying old migrations against production can repeat incompatible DDL or
data transformations. Append recovery migrations after the journal's highest
timestamp instead.

The checked-in chain with 0141 supplies all 297 declared tables and their columns,
all 101 declared enum types and values, named indexes, foreign keys with matching
column pairs and delete/update actions, unique keys, and named checks.
This audit detects omitted schema objects; it does not prove identical defaults,
column types, index predicates, or check expressions in a deployed database.
The release owner supplied a read-only production check on 2026-10-09:
140 ledger entries, latest timestamp 1796400000000 (0140), PKCE absent, and sick
detail, work balance, daily digest and approval workflow objects present.
Only 0141 is pending.

Production has no original ledger entries for 0027, 0055 or 0056. Their recoveries,
0029 and 0060, are recorded. The two ledger timestamps not in today's journal,
1785269198390 and 1785269198391, correspond to the former employee clock activity
index and payroll blocker dismissal tags in Git history; those changes were
later renumbered. Preserve these ledger entries.

The upgrade regression recreates this ledger shape using synthetic hashes for
the two historical entries, then runs the unchanged production command twice.
It verifies that only pending migrations are added and prior ledger entries
and the legacy auth-code row remain unchanged.

## Regression checks

From the repository root:

~~~sh
pnpm --filter webapp exec vitest run --project unit src/test/migration-journal.test.ts
pnpm --filter webapp test:integration src/test/migration-schema.integration.test.ts src/test/migration-runner.integration.test.ts src/lib/auth/app-auth-code.integration.test.ts
~~~

These checks create a disposable PostgreSQL database. They audit the fresh SQL
chain, simulate the production ledger through 0140, execute the actual production migration
command twice, verify the ledger and preservation of an existing auth-code row,
and exercise both desktop login handlers with verifier and replay rejection.
No production database is used.