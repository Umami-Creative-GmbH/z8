# Import Quality Review Design

## Goal

Add a mandatory review gate for Clockodo and Clockin imports so imported data is staged, checked, reviewed, and explicitly committed before it reaches production tables.

The review experience must support duplicate clusters, suspicious gaps, unmatched employees and projects, rollback by discarding staged batches, and export of rejected or problematic rows. It must also scale to large imports such as 3 years of data for 500 employees by using automatic internal batching and worker jobs.

## Current State

- The shared import hub lives at `apps/webapp/src/components/settings/import/import-hub.tsx` and exposes Clockodo and Clockin tabs.
- Clockodo import logic writes production records directly through `apps/webapp/src/lib/clockodo/import-orchestrator.ts` after the wizard selection step.
- Clockin import logic writes production time and absence records directly through `apps/webapp/src/lib/clockin/import-orchestrator.ts` after the wizard selection step.
- Clockin currently has duplicate detection for workdays and absences, but results are summarized only as imported, skipped, and errors.
- The existing flows do not persist staged rows, issue clusters, review decisions, commit checkpoints, or exportable rejected rows.

## Chosen Approach

Use a provider-neutral staged import review pipeline with worker-driven scan and commit jobs.

The UI starts one logical import batch. The backend splits it into automatic worker partitions by provider, entity type, date window, and employee range. Workers stage normalized rows and issue records without writing production tables. Admins review the consolidated batch, resolve blockers, reject rows, export rejected rows, and then commit accepted rows through a second worker-driven phase.

This is the safest option for compliance-sensitive time tracking because rollback before commit is simply discarding a staged batch, while production tables remain untouched until approval.

## Alternatives Considered

### Synchronous staging with mandatory review

A server action could fetch provider data, stage rows, and route to review in one request.

This is simpler, but it does not scale safely for large imports. Provider calls, duplicate checks, and staging writes can exceed request limits or exhaust memory for multi-year imports with hundreds of employees.

### Immediate import with rollback and rejection tools

The current direct-write import path could remain, with a post-write review page and rollback/export actions added afterward.

This is faster to bolt on, but it makes rollback difficult for time entry hash chains, work periods, absences, payroll/reporting side effects, and audit records. It also weakens user trust because bad rows reach production before review.

## Architecture

Add a provider-neutral review layer beneath the existing Clockodo and Clockin UI while keeping provider fetch and mapping logic provider-specific.

Core units:

- `importBatch`: one admin-started logical import for one organization, provider, date range, and selection set.
- `importBatchJob`: worker partition for scanning or committing a slice of the batch.
- `importStagedRow`: normalized staged row with provider source ID, entity type, source payload hash, normalized payload, matching target, issue status, review decision, and commit status.
- `importIssue`: row-level or cluster-level finding such as a duplicate cluster, suspicious gap, unmatched employee, unmatched project/service, validation error, or dependency blocker.
- Provider adapters: Clockodo and Clockin modules that convert upstream data into staged rows and issue candidates without writing production tables.
- Committers: per-entity writers that convert accepted staged rows into production records only after approval.

Batch states:

- `draft`
- `scanning`
- `needs_review`
- `committing`
- `completed`
- `scan_failed`
- `commit_failed`
- `cancelled`

Row states:

- `staged`
- `accepted`
- `rejected`
- `blocked`
- `needs_mapping`
- `committing`
- `committed`
- `commit_failed`

Existing wizard steps should evolve from `preview -> selection -> import now` into `preview -> scope -> start scan -> review -> commit`.

## Data Flow

1. Admin connects Clockodo or Clockin and chooses import scope.
2. Server creates an `importBatch` in the active `organizationId`.
3. Provider credentials are passed to scan jobs through an encrypted, expiring job-secret mechanism. They are not stored as tenant settings.
4. Worker jobs partition the scan automatically by provider, entity type, date window, and employee range.
5. Each scan job fetches provider data, maps it into staged rows, detects issues, and writes bounded chunks to staging tables.
6. The review page loads batch progress and summary counts while scanning continues.
7. When all required scan jobs finish, the batch enters `needs_review`.
8. Admin reviews issue groups, resolves mappings, rejects bad rows, and exports rejected or problematic rows as needed.
9. Admin clicks `Commit accepted rows`.
10. Commit workers process accepted rows in dependency order, write production tables, record commit target references on staged rows, and move the batch to `completed` or `commit_failed`.

Commit dependency order:

1. Identity and setup records: users/employees, teams, projects/services, work categories, absence categories.
2. Policy and reference records: target hours, work policies, holiday quotas, non-business days, surcharges.
3. Operational records: absences, time entries, work periods.

Rows with unresolved dependencies remain `blocked` or `needs_mapping` and cannot commit until resolved or rejected.

## Review UX

The import hub should add a review-oriented flow after provider selection:

1. `Connect`: provider credential flow.
2. `Scope`: choose entities, date range, and start scan.
3. `Scanning`: show progress by entity, processed rows, issue counts, and worker status.
4. `Review`: consolidated batch review page.
5. `Commit`: show commit progress and final summary.

The review page should prioritize decisions over raw volume:

- Top summary cards for total staged, accepted, rejected, blocked, issue count, and estimated committable rows.
- Filters for duplicates, suspicious gaps, unmatched employees, unmatched projects/services, validation errors, and dependency blockers.
- Duplicate cluster views that show source rows, matched Z8 candidates, and a default action.
- Suspicious gap views that show employee, date, and affected time windows.
- Mapping workflows for unmatched employees and projects/services, including map existing, create new, or reject.
- Clean rows collapsed into counts with paginated drill-down.
- Bulk actions for accepting clean rows, rejecting selected issue groups, applying mappings, and exporting rejected rows.
- A commit button disabled while unresolved blockers remain.

Rollback and export behavior:

- Before commit, rollback means cancelling or discarding the staged batch.
- After commit, v1 does not provide broad destructive rollback. Staged rows keep links to production row IDs for audit and future targeted remediation.
- Rejected rows remain exportable before and after commit.

## Detection Rules

Issue detection runs incrementally inside scan jobs and writes reusable issue records.

V1 issue types:

- Duplicate clusters: incoming rows matching existing Z8 rows or other staged rows by provider source ID, employee, date/time window, and entity-specific natural keys.
- Suspicious gaps: time data with unusually long gaps, overlapping periods, missing clock-out, negative or zero duration, or workday spans that cross expected boundaries.
- Unmatched employees: provider user or employee cannot be mapped confidently to a Z8 employee.
- Unmatched projects/services: provider project, service, or category cannot be mapped confidently to a Z8 work category or project concept.
- Validation errors: malformed dates, missing required fields, unsupported categories, or invalid dependency references.
- Dependency blockers: an operational row depends on a setup row that is rejected or unresolved.

Detection should distinguish severity so the UI can default low-risk rows to accepted while requiring explicit action for blockers.

## Scaling Requirements

Large imports must be handled as one logical batch with automatic internal partitioning.

Scaling rules:

- Provider reads use pagination where APIs support it.
- Staged row inserts use bounded chunks rather than one giant transaction.
- Duplicate checks use organization, entity, employee, and date indexes with set-based queries.
- Large date ranges are split internally, for example by month or quarter, without requiring admins to create separate batches.
- Review endpoints return summaries and paginated row details with filters.
- Commit jobs are checkpointed and idempotent so retries do not duplicate production rows.
- The user can leave and return while scan or commit jobs continue.

For a 3-year import with 500 employees, the expected behavior is that the admin starts one batch, monitors progress, returns later if needed, reviews issue summaries, resolves blockers, and commits accepted rows.

## Error Handling

- Provider authentication errors fail the affected scan jobs and surface actionable messages on the batch.
- Rate limits pause and retry jobs with backoff instead of immediately failing the whole batch.
- Partial scan failures leave the batch in a resumable `scan_failed` state with a retry action for failed jobs.
- Commit failures leave already committed rows linked to staged rows and keep uncommitted rows retryable.
- Rows with unresolved mapping, validation, or dependency issues cannot commit.
- Rejected rows never commit.
- If accepted clean rows exist alongside blocked rows, the admin can resolve blockers or commit accepted rows only.

## Auditability And Security

Every batch, job, issue, decision, and commit attempt must be organization-scoped and tied to the acting user where applicable.

Audit metadata:

- Batch: provider, organization, selected scope, date range, started by, reviewed by, committed by, timestamps.
- Job: type, partition key, status, retry count, error summary.
- Row: provider source ID, source payload hash, normalized payload, review decision, decision actor and time, commit target table and ID.
- Issue: issue type, severity, row IDs or cluster key, detection rule version.
- Export: exported row scope, exported by, and exported at.

Security rules:

- All batch, row, issue, and commit queries filter by `organizationId`.
- Server actions validate owner or admin access.
- Committers re-check that referenced employees, projects, categories, and policies belong to the same organization.
- Provider credentials are not persisted as organization settings. If the current worker system cannot safely hand off expiring encrypted credentials, implementation must add that before scan jobs are enabled.

## Testing And Verification

Test the feature at four levels:

- Import review domain tests for state transitions, issue classification, duplicate clustering, suspicious gap detection, blocker resolution, and row decision rules.
- Provider adapter tests for Clockodo and Clockin staging output, ensuring adapters produce staged rows and issues without writing production tables.
- Worker and job tests for chunking, checkpointing, retry behavior, idempotent staging, and idempotent commit.
- UI and server action tests for starting scans, loading progress, filtering issue groups, applying mappings, rejecting and exporting rows, disabled commit states, and final summaries.

Critical regression checks:

- Existing Clockodo and Clockin entry points no longer bypass review.
- No production tables are written during scan.
- Accepted rows commit in dependency order.
- Rejected and blocked rows do not commit.
- Every query and mutation is organization-scoped.
- Large batches use paginated and chunked endpoints rather than loading all staged rows in one request.

Recommended project-level checks after implementation:

- Targeted Vitest suites for import review, adapters, workers, and UI.
- `pnpm test`
- `pnpm build`

## Non-Goals

- Broad destructive rollback after commit in v1.
- A fully generic importer framework that erases provider-specific behavior.
- Persisting provider API credentials as tenant settings.
- Rendering all staged rows at once in the review UI.
- Requiring admins to manually split large imports into smaller date ranges.
