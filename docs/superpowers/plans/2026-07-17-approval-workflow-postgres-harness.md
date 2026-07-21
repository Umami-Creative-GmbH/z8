# Approval Workflow PostgreSQL Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the handwritten approval repository integration schema with a fail-closed, migration-faithful PostgreSQL 16 harness.

**Architecture:** The integration test constructs a standalone `pg` pool only after validating both an explicit sentinel and `current_database()` against the disposable database naming convention. A test-only Docker runner creates the uniquely named, label-owned PostgreSQL 16 container/database, invokes the complete Drizzle chain through `0054`, runs the explicitly gated test, verifies ownership, and cleans up in an EXIT trap. CI performs the same migration/test sequence against its PostgreSQL service database.

**Tech Stack:** Vitest, node-postgres, Drizzle Kit, PostgreSQL 16 catalog queries, Bash, GitHub Actions.

---

### Task 1: Establish Fail-Closed Gate Tests

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`
- Create: `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`

- [ ] Add test-only guard logic that requires `APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL`, `APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test`, and a `current_database()` value matching `approval_workflow_repository_test_[a-z0-9_]+` before any cleanup.
- [ ] Run the focused test without environment variables and verify it skips without opening a pool or truncating tables.
- [ ] Run the focused test with a non-matching database name/sentinel and verify it fails before fixture cleanup.

### Task 2: Replace the Handwritten Schema and Seed Real Parents

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`

- [ ] Remove all application table DDL and drop DDL from the integration test.
- [ ] Add FK-ordered per-test fixture cleanup, guarded by the verified database check.
- [ ] Seed real `organization`, `user`, `member`, and `employee` records using required migrated columns, then seed canonical workflow roots whose composite requester FK resolves to those employees.
- [ ] Run the integration suite against a migrated disposable database and verify repository persistence tests pass.

### Task 3: Add the Real-Schema Catalog Contract

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`

- [ ] Query `pg_type`/`pg_enum` for the exact approval workflow enum names and labels.
- [ ] Query `pg_constraint` and `pg_get_constraintdef` for essential composite workflow, stage, assignment, event, and command FKs and persistence unique indexes/constraints.
- [ ] Assert exact expected type and constraint evidence, so the assertion cannot pass against the former text-column handwritten schema.
- [ ] Verify the catalog test fails against the former handwritten harness and passes against a full-chain migrated database.

### Task 4: Add Disposable Docker Runner and CI Invocation

**Files:**
- Create: `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`
- Modify: `apps/webapp/package.json`
- Modify: `.github/workflows/tests.yml`

- [ ] Implement a strict Bash runner that generates collision-resistant names containing `approval_workflow_repository_test`, starts `postgres:16`, labels it `z8.agent-owned=approval-workflow-repository-test`, waits with `pg_isready`, creates only its generated database, migrates via `pnpm drizzle-kit migrate`, and invokes Vitest with both required variables.
- [ ] In the runner EXIT trap, inspect the exact label, remove only the owned container, and confirm no matching container remains.
- [ ] Add a minimal package script exposing the runner as the documented local contract command.
- [ ] Add a PostgreSQL 16 GitHub Actions service, create the uniquely named service database, run full migration with test-only Drizzle variables, and invoke the integration test with both gates. Keep `pnpm test` unchanged and make the integration invocation non-skippable.

### Task 5: Verify the Approval-Critical Contract

**Files:**
- Modify only files from Tasks 1-4 as necessary for verification fixes.

- [ ] Run the package Docker runner and retain command output for Docker creation/readiness/migration/test/label inspection/removal.
- [ ] Run the focused catalog and repository integration suite, related workflow tests, `pnpm --filter webapp typecheck`, Biome, and inspect the final diff.
- [ ] Parse the CI YAML with an installed validator if present; otherwise inspect the exact service, migration, and invocation configuration.
- [ ] Do not commit, alter non-task files, apply migrations to any configured/shared database, or leave a disposable container behind.
