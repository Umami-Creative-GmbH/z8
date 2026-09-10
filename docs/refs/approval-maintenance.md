# Approval Maintenance CLI

Server operators can list approvals and permanently remove a broken approval lifecycle using package scripts. Run these from the repository root with the target environment's usual Phase-provided configuration.

## Commands

```bash
# List every approval in one organization, including completed and orphaned entries.
pnpm approvals:list --organization-id <org-id>

# Delete a legacy approval request or canonical workflow by its listed ID.
pnpm approvals:delete --organization-id <org-id> --id <approval-id>

# Show usage without database credentials or a database connection.
pnpm approvals:delete --help
```

The same commands are available from `apps/webapp`. Listing includes storage type (`legacy` or `workflow`), approval ID, organization ID, status, source type/ID, and UTC creation time. It reads approval tables directly, so missing source records do not hide orphaned approvals.

## Access and configuration

These are standalone server maintenance scripts. Authorization comes from server shell access and the configured PostgreSQL role, rather than an application session. They do not require the operating-system UID to be root. The database role must be permitted to read, update, delete, and acquire table locks for the affected tables. The commands are available in development and production.

Both commands require `--organization-id`. The CLI uses the existing application database configuration (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and the existing SSL options). Run against an up-to-date migrated database.

## Deletion scope

Deletion bypasses approve/deny logic and works even if the source record is missing or malformed. It removes:

- The selected approval.
- Explicitly linked legacy requests, approval chains, and canonical workflows for that approval lifecycle, including multi-stage siblings.
- Dependent approval stages, assignments, events, commands, projections, outbox/delivery records, migration issues, and legacy integration records through database cascades.

Time records, absences, shifts, expenses, and compliance source records remain. Only their nullable references to deleted approvals are cleared; their business statuses and approval outcomes are not changed. Deletion is cleanup, not approval or rejection, and does not send decision notifications. Already-sent external messages are not retracted.

Other submission cycles are not selected merely because they share the same source ID. Every lookup and mutation is scoped to the specified organization.

Cleanup uses one transaction with foreign-key checks enabled. Short-lived table locks prevent approval topology from changing during cleanup; lock waits are limited to 10 seconds and individual statements to 30 seconds. A missing/ambiguous ID, unexpected dependency, or database failure causes an error and rollback. Successful output lists the approval and chain IDs actually removed after commit.
