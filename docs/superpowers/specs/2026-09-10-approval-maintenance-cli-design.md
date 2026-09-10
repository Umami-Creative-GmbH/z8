# Approval Maintenance CLI

## Approved interface

Provide server-operator package commands, callable from the repository root:

```bash
pnpm approvals:list --organization-id <org-id>
pnpm approvals:delete --organization-id <org-id> --id <approval-id>
```

Shell access and the configured database role are the authorization boundary. This is an operator script, available in any environment with the required credentials. Both commands require an organization ID. There is no HTTP or UI entry point.

## Listing

List legacy `approval_request` rows and canonical `approval_workflow` rows directly, without requiring their sources or employees to exist. Include storage type, ID, organization ID, status, source type/ID, and UTC creation time. Do not restrict to pending status. Sort deterministically.

## Force deletion

Locate the exact ID within the organization. Reject missing IDs and IDs ambiguous between the two storage types. Resolve explicitly linked legacy requests, chain instances, and workflows as one approval lifecycle, including multi-stage siblings. Never infer links merely from matching source IDs: different submission cycles must survive.

Perform cleanup atomically. Clear nullable approval references on source records, remove the selected lifecycle's legacy chains and requests, and delete its workflows using existing dependent-row cascades (stages, assignments, events, commands, projections, outbox/deliveries, migration issues). Preserve source rows and their business statuses. Report the deleted approval IDs after commit. Do not call decision handlers or notification dispatchers.

Serialize approval topology changes during this short operator transaction with database table locks. Retain normal foreign-key enforcement; failures roll back the entire operation. All data lookups and mutations explicitly filter the requested organization.

## Implementation and verification

Use a standalone TypeScript CLI and a testable database-operation module under `apps/webapp/scripts`. Parse arguments before loading database configuration, support `--help`, reject unknown/duplicate/missing options, and parameterize all values. Reuse the application's database configuration and close the pool on success or failure.

Review argument validation, tenant scoping, dependent cleanup, unrelated-cycle preservation, and pool lifecycle in code. The user explicitly requested no tests or database verification during implementation because no Z8 database is running. Do not add a new test suite or run existing tests for this change. Keep existing architecture-guard owner-map expectations consistent with the new narrow maintenance capabilities. Real environment operations require credentials supplied by the operator; agents do not run cleanup against application databases.
