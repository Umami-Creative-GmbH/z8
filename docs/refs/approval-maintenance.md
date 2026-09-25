# Approval Maintenance

Server operators can list approvals and permanently remove a broken approval lifecycle using package scripts. Run these from the repository root with the target environment's usual Phase-provided configuration.

## Platform-admin settings

Platform administrators can also use **Platform Admin → Settings → Force delete approval**. Enter the organization ID and approval ID, then select **Force delete**. The card displays the approval and chain IDs removed, or an error if deletion cannot be completed.

The server action checks the authenticated user's platform-admin role and banned status on every request. Organization-admin access alone does not authorize this operation. Deletion and a `force_delete_approval` platform-admin audit entry are committed in the same transaction; an audit-write failure rolls back deletion. The audit entry records the acting admin, organization, requested approval ID, and removed request/workflow/chain and evidence IDs.

The UI and CLI share the cleanup implementation in `apps/webapp/src/lib/approvals/maintenance.ts` and use the deletion scope below.

## Commands

```bash
# List every approval in one organization, including completed and orphaned entries.
pnpm approvals:list --organization-id <org-id>

# Delete a legacy approval request or canonical workflow by its listed ID.
pnpm approvals:delete --organization-id <org-id> --id <approval-id>

# Show usage without database credentials or a database connection.
pnpm approvals:delete --help
```

The same commands are available from `apps/webapp`. Listing includes storage type (`legacy`, `workflow`, `legacy_evidence` for a legacy-authority submitted revision, or `legacy_transfer` for a legacy escalation transfer; both stay listed after cancellation deletes their pending request), approval ID, organization ID, status, source type/ID, and UTC creation time. It reads approval tables directly, so missing source records do not hide orphaned approvals.

## Access and configuration

These are standalone server maintenance scripts. Authorization comes from server shell access and the configured PostgreSQL role, rather than an application session. They do not require the operating-system UID to be root. The database role must be permitted to read, update, delete, and acquire table locks for the affected tables. The commands are available in development and production.

Both commands require `--organization-id`. The CLI uses the existing application database configuration (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and the existing SSL options). Run against an up-to-date migrated database.

## Deletion scope

Deletion bypasses approve/deny logic and works even if the source record is missing or malformed. It removes:

- The selected approval.
- Explicitly linked legacy requests, approval chains, and canonical workflows for that approval lifecycle, including multi-stage siblings.
- Dependent approval stages, assignments, events, commands, projections, outbox/delivery records, migration issues, and legacy integration records through database cascades.
- Immutable approval evidence linked to the lifecycle's canonical workflows (submitted revisions, decision evidence, review bindings and bot invocation associations). These are deleted explicitly and their IDs are returned and written to the platform-admin audit entry. See [Approval evidence](approval-evidence.md).
- Legacy-authority evidence linked to the lifecycle through the legacy request, chain or observed shadow workflow it recorded, including legacy review bindings and bot invocation associations of card decisions (#296). A legacy submitted revision ID can also be passed directly, which removes that revision, its decision evidence and any still-linked approval rows.
- Escalation transfer journal entries: canonical ones through the lifecycle's workflows, legacy ones (#299) through the legacy request or observed shadow workflow they recorded. Their delivery events cascade, and their IDs are returned as `escalationTransfers`. A legacy transfer ID can also be passed directly. See [Escalation transfer](escalation-transfer.md).
- Approval-card delivery work and every tracked remote message of the lifecycle's canonical workflows or, for legacy lifecycles such as expense claims (#296), of its legacy requests, returned as `delivery.work` and `delivery.messages`, and the legacy lifecycle intents, returned as `delivery.intents`. See [Approval card delivery](approval-delivery.md).

Time records, absences, shifts, expenses, and compliance source records remain. Only their nullable references to deleted approvals are cleared; their business statuses and approval outcomes are not changed. Deletion is cleanup, not approval or rejection, and does not send decision notifications. Already-sent external messages are not retracted.

Other submission cycles are not selected merely because they share the same source ID. Every lookup and mutation is scoped to the specified organization.

Manual time submission and policy clock-out evidence (#302) follows the same lifecycle rules. In addition, the whole-history deletes (`clearOrganizationTimeData`, `deleteNonAdminEmployeesData` and organization cleanup) remove that evidence together with the work history it describes, through `deleteWorkPeriodApprovalEvidence`.

Cleanup uses one transaction with foreign-key checks enabled. Short-lived table locks prevent approval topology from changing during cleanup; lock waits are limited to 10 seconds and individual statements to 30 seconds. A missing/ambiguous ID, unexpected dependency, or database failure causes an error and rollback. Successful output lists the approval and chain IDs actually removed after commit.
