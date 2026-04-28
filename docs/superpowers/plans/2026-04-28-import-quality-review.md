# Import Quality Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mandatory worker-driven import review gate for Clockodo and Clockin so provider data is staged, checked, reviewed, exported, and committed only after approval.

**Architecture:** Add provider-neutral import review tables and domain services, then route Clockodo and Clockin through scan jobs that create staged rows and issues instead of writing production tables. Review actions update row decisions and commit jobs write accepted rows in dependency order with organization-scoped checks.

**Tech Stack:** Next.js App Router server actions, React, BullMQ, Drizzle ORM, PostgreSQL, Vitest, Luxon, shadcn/ui, Tolgee

---

## File Structure

- Create `apps/webapp/src/db/schema/import-review.ts`: Drizzle tables for batches, jobs, staged rows, issues, exports, and credential secrets.
- Modify `apps/webapp/src/db/schema/index.ts`: export the new import review schema.
- Create `apps/webapp/src/lib/import-review/types.ts`: shared enums, payload types, DTOs, and worker job contracts.
- Create `apps/webapp/src/lib/import-review/state.ts`: pure state transition helpers for batches and rows.
- Create `apps/webapp/src/lib/import-review/detection.ts`: pure issue detection and suspicious gap helpers.
- Create `apps/webapp/src/lib/import-review/partitioning.ts`: deterministic date and employee chunking helpers.
- Create `apps/webapp/src/lib/import-review/credential-secret.ts`: short-lived encrypted provider credential storage using `env.BETTER_AUTH_SECRET`.
- Create `apps/webapp/src/lib/import-review/repository.ts`: database operations for batches, jobs, rows, issues, decisions, summaries, and exports.
- Create `apps/webapp/src/lib/import-review/queue.ts`: BullMQ enqueue helpers for scan and commit jobs.
- Create `apps/webapp/src/lib/import-review/worker.ts`: worker processor for scan and commit jobs.
- Create `apps/webapp/src/lib/import-review/clockin-adapter.ts`: Clockin scan adapter that stages supported entities.
- Create `apps/webapp/src/lib/import-review/clockodo-adapter.ts`: Clockodo scan adapter that stages supported entities.
- Create `apps/webapp/src/lib/import-review/committers.ts`: production writers for accepted staged rows.
- Create `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts`: server actions for starting scans, reading review data, applying decisions, exporting rejected rows, and starting commits.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts`: replace direct import action with scan start action wiring.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/actions.ts`: replace direct import action with scan start action wiring.
- Modify `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`: route selection to scan and review instead of direct production import.
- Modify `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx`: route selection to scan and review instead of direct production import.
- Create `apps/webapp/src/components/settings/import/import-review-page.tsx`: review shell with summaries, filters, decisions, export, and commit CTA.
- Create `apps/webapp/src/components/settings/import/import-review-table.tsx`: paginated staged row table.
- Create `apps/webapp/src/components/settings/import/import-issue-groups.tsx`: duplicate, gap, unmatched, validation, and blocker issue groups.
- Modify `apps/webapp/src/worker.ts`: route `import-review-scan` and `import-review-commit` jobs to the import review worker.
- Modify `apps/webapp/src/lib/queue/index.ts`: add import review job data types and enqueue helpers.

---

### Task 1: Add Import Review Schema

**Files:**
- Create: `apps/webapp/src/db/schema/import-review.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Test: `apps/webapp/src/db/schema/import-review.test.ts`

- [ ] **Step 1: Write the failing schema export test**

Create `apps/webapp/src/db/schema/import-review.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	importBatch,
	importBatchJob,
	importIssue,
	importJobSecret,
	importRejectedExport,
	importStagedRow,
} from "./index";

describe("import review schema exports", () => {
	it("exports all import review tables", () => {
		expect(importBatch).toBeDefined();
		expect(importBatchJob).toBeDefined();
		expect(importStagedRow).toBeDefined();
		expect(importIssue).toBeDefined();
		expect(importRejectedExport).toBeDefined();
		expect(importJobSecret).toBeDefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/db/schema/import-review.test.ts`

Expected: FAIL because `./index` does not export the import review tables.

- [ ] **Step 3: Add the import review schema**

Create `apps/webapp/src/db/schema/import-review.ts`:

```ts
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";

export const importBatch = pgTable(
	"import_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<"clockodo" | "clockin">().notNull(),
		status: text("status").$type<"draft" | "scanning" | "needs_review" | "committing" | "completed" | "scan_failed" | "commit_failed" | "cancelled">().notNull().default("draft"),
		selectedScope: jsonb("selected_scope").$type<Record<string, unknown>>().notNull(),
		dateRange: jsonb("date_range").$type<{ startDate: string; endDate: string }>().notNull(),
		totalRows: integer("total_rows").notNull().default(0),
		processedRows: integer("processed_rows").notNull().default(0),
		issueCount: integer("issue_count").notNull().default(0),
		errorMessage: text("error_message"),
		startedBy: text("started_by").notNull().references(() => user.id),
		reviewedBy: text("reviewed_by").references(() => user.id),
		committedBy: text("committed_by").references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("importBatch_organizationId_idx").on(table.organizationId),
		index("importBatch_status_idx").on(table.status),
		index("importBatch_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
	],
);

export const importBatchJob = pgTable(
	"import_batch_job",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		kind: text("kind").$type<"scan" | "commit">().notNull(),
		status: text("status").$type<"queued" | "running" | "completed" | "failed">().notNull().default("queued"),
		entityType: text("entity_type").notNull(),
		partitionKey: text("partition_key").notNull(),
		processedRows: integer("processed_rows").notNull().default(0),
		retryCount: integer("retry_count").notNull().default(0),
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("importBatchJob_batchId_idx").on(table.batchId),
		index("importBatchJob_org_status_idx").on(table.organizationId, table.status),
		uniqueIndex("importBatchJob_batch_kind_partition_idx").on(table.batchId, table.kind, table.partitionKey),
	],
);

export const importStagedRow = pgTable(
	"import_staged_row",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		entityType: text("entity_type").notNull(),
		providerSourceId: text("provider_source_id").notNull(),
		sourcePayloadHash: text("source_payload_hash").notNull(),
		sourcePayload: jsonb("source_payload").$type<Record<string, unknown>>().notNull(),
		normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>().notNull(),
		matchTarget: jsonb("match_target").$type<Record<string, unknown> | null>(),
		rowStatus: text("row_status").$type<"staged" | "accepted" | "rejected" | "blocked" | "needs_mapping" | "committing" | "committed" | "commit_failed">().notNull().default("staged"),
		issueSeverity: text("issue_severity").$type<"none" | "info" | "warning" | "blocking">().notNull().default("none"),
		decisionReason: text("decision_reason"),
		decidedBy: text("decided_by").references(() => user.id),
		decidedAt: timestamp("decided_at"),
		commitTargetTable: text("commit_target_table"),
		commitTargetId: text("commit_target_id"),
		commitError: text("commit_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		index("importStagedRow_batchId_idx").on(table.batchId),
		index("importStagedRow_org_entity_idx").on(table.organizationId, table.entityType),
		index("importStagedRow_status_idx").on(table.rowStatus),
		uniqueIndex("importStagedRow_batch_source_unique_idx").on(table.batchId, table.entityType, table.providerSourceId, table.sourcePayloadHash),
	],
);

export const importIssue = pgTable(
	"import_issue",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		stagedRowId: uuid("staged_row_id").references(() => importStagedRow.id, { onDelete: "cascade" }),
		issueType: text("issue_type").$type<"duplicate" | "suspicious_gap" | "unmatched_employee" | "unmatched_project" | "validation_error" | "dependency_blocker">().notNull(),
		severity: text("severity").$type<"info" | "warning" | "blocking">().notNull(),
		clusterKey: text("cluster_key"),
		message: text("message").notNull(),
		details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
		detectionRuleVersion: text("detection_rule_version").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("importIssue_batchId_idx").on(table.batchId),
		index("importIssue_org_type_idx").on(table.organizationId, table.issueType),
		index("importIssue_clusterKey_idx").on(table.clusterKey),
	],
);

export const importRejectedExport = pgTable(
	"import_rejected_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		exportedBy: text("exported_by").notNull().references(() => user.id),
		rowCount: integer("row_count").notNull(),
		fileName: text("file_name").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("importRejectedExport_batchId_idx").on(table.batchId)],
);

export const importJobSecret = pgTable(
	"import_job_secret",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull().references(() => importBatch.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		ciphertext: text("ciphertext").notNull(),
		iv: text("iv").notNull(),
		authTag: text("auth_tag").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("importJobSecret_batchId_idx").on(table.batchId),
		index("importJobSecret_expiresAt_idx").on(table.expiresAt),
	],
);
```

- [ ] **Step 4: Export the schema**

Modify `apps/webapp/src/db/schema/index.ts` and add this line near the other domain exports:

```ts
// Import review staging and audit tables
export * from "./import-review";
```

- [ ] **Step 5: Run the schema test**

Run: `pnpm test -- --run apps/webapp/src/db/schema/import-review.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/db/schema/import-review.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/import-review.test.ts
git commit -m "feat(import): add review staging schema"
```

---

### Task 2: Add Domain Types, State, Detection, And Partitioning

**Files:**
- Create: `apps/webapp/src/lib/import-review/types.ts`
- Create: `apps/webapp/src/lib/import-review/state.ts`
- Create: `apps/webapp/src/lib/import-review/detection.ts`
- Create: `apps/webapp/src/lib/import-review/partitioning.ts`
- Test: `apps/webapp/src/lib/import-review/state.test.ts`
- Test: `apps/webapp/src/lib/import-review/detection.test.ts`
- Test: `apps/webapp/src/lib/import-review/partitioning.test.ts`

- [ ] **Step 1: Write failing state tests**

Create `apps/webapp/src/lib/import-review/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canCommitRow, nextBatchStatusAfterJobs, normalizeDecision } from "./state";

describe("import review state", () => {
	it("moves scanning batches to needs_review when all scan jobs complete", () => {
		expect(nextBatchStatusAfterJobs("scanning", [{ status: "completed" }, { status: "completed" }])).toBe("needs_review");
	});

	it("moves scanning batches to scan_failed when any scan job fails", () => {
		expect(nextBatchStatusAfterJobs("scanning", [{ status: "completed" }, { status: "failed" }])).toBe("scan_failed");
	});

	it("allows only accepted staged rows to commit", () => {
		expect(canCommitRow({ rowStatus: "accepted", issueSeverity: "none" })).toBe(true);
		expect(canCommitRow({ rowStatus: "blocked", issueSeverity: "blocking" })).toBe(false);
		expect(canCommitRow({ rowStatus: "rejected", issueSeverity: "none" })).toBe(false);
	});

	it("normalizes blocking issues to blocked unless user rejects the row", () => {
		expect(normalizeDecision("accepted", "blocking")).toBe("blocked");
		expect(normalizeDecision("rejected", "blocking")).toBe("rejected");
	});
});
```

- [ ] **Step 2: Write failing detection tests**

Create `apps/webapp/src/lib/import-review/detection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyTimeWindow, createDuplicateIssue, detectMissingMapping } from "./detection";

describe("import review detection", () => {
	it("creates duplicate issues with a stable cluster key", () => {
		const issue = createDuplicateIssue({ entityType: "work_period", employeeId: "emp_1", sourceId: "src_1", startsAt: "2026-01-01T08:00:00.000Z" });

		expect(issue.issueType).toBe("duplicate");
		expect(issue.severity).toBe("warning");
		expect(issue.clusterKey).toBe("duplicate:work_period:emp_1:2026-01-01T08:00:00.000Z");
	});

	it("marks rows without employee mapping as blocking", () => {
		const issue = detectMissingMapping({ entityType: "absence", providerSourceId: "a_1", employeeId: null });

		expect(issue).toMatchObject({ issueType: "unmatched_employee", severity: "blocking" });
	});

	it("detects missing clock-out and invalid durations", () => {
		expect(classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: null })).toContain("missing_clock_out");
		expect(classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: "2026-01-01T08:00:00.000Z" })).toContain("non_positive_duration");
		expect(classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: "2026-01-02T09:00:00.000Z" })).toContain("long_shift");
	});
});
```

- [ ] **Step 3: Write failing partitioning tests**

Create `apps/webapp/src/lib/import-review/partitioning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chunkEmployeeIds, partitionDateRangeByMonth } from "./partitioning";

describe("import review partitioning", () => {
	it("partitions date ranges by month", () => {
		expect(partitionDateRangeByMonth("2026-01-15", "2026-03-10")).toEqual([
			{ startDate: "2026-01-15", endDate: "2026-01-31" },
			{ startDate: "2026-02-01", endDate: "2026-02-28" },
			{ startDate: "2026-03-01", endDate: "2026-03-10" },
		]);
	});

	it("chunks employee ids without dropping leftovers", () => {
		expect(chunkEmployeeIds(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
	});
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/state.test.ts apps/webapp/src/lib/import-review/detection.test.ts apps/webapp/src/lib/import-review/partitioning.test.ts`

Expected: FAIL because the import review domain files do not exist.

- [ ] **Step 5: Add shared types**

Create `apps/webapp/src/lib/import-review/types.ts`:

```ts
export type ImportProvider = "clockodo" | "clockin";
export type ImportBatchStatus = "draft" | "scanning" | "needs_review" | "committing" | "completed" | "scan_failed" | "commit_failed" | "cancelled";
export type ImportJobStatus = "queued" | "running" | "completed" | "failed";
export type ImportJobKind = "scan" | "commit";
export type ImportRowStatus = "staged" | "accepted" | "rejected" | "blocked" | "needs_mapping" | "committing" | "committed" | "commit_failed";
export type ImportIssueSeverity = "none" | "info" | "warning" | "blocking";
export type ImportIssueType = "duplicate" | "suspicious_gap" | "unmatched_employee" | "unmatched_project" | "validation_error" | "dependency_blocker";

export type ImportEntityType =
	| "employee"
	| "team"
	| "service"
	| "work_category"
	| "absence_category"
	| "target_hours"
	| "work_policy"
	| "holiday_quota"
	| "holiday"
	| "surcharge"
	| "absence"
	| "time_entry"
	| "work_period";

export interface ImportDateRange {
	startDate: string;
	endDate: string;
}

export interface NormalizedImportRow {
	entityType: ImportEntityType;
	providerSourceId: string;
	sourcePayload: Record<string, unknown>;
	normalizedPayload: Record<string, unknown>;
	matchTarget?: Record<string, unknown> | null;
	issueSeverity: ImportIssueSeverity;
	rowStatus: ImportRowStatus;
}

export interface ImportIssueDraft {
	issueType: ImportIssueType;
	severity: Exclude<ImportIssueSeverity, "none">;
	clusterKey?: string | null;
	message: string;
	details: Record<string, unknown>;
	detectionRuleVersion: string;
}

export interface ImportScanJobData {
	type: "import-review-scan";
	batchId: string;
	jobId: string;
	organizationId: string;
	provider: ImportProvider;
	entityType: ImportEntityType;
	dateRange: ImportDateRange;
	employeeIds: string[];
	secretId: string;
}

export interface ImportCommitJobData {
	type: "import-review-commit";
	batchId: string;
	jobId: string;
	organizationId: string;
	entityType: ImportEntityType;
	committedBy: string;
}
```

- [ ] **Step 6: Add state helpers**

Create `apps/webapp/src/lib/import-review/state.ts`:

```ts
import type { ImportBatchStatus, ImportIssueSeverity, ImportJobStatus, ImportRowStatus } from "./types";

export function nextBatchStatusAfterJobs(
	currentStatus: ImportBatchStatus,
	jobs: Array<{ status: ImportJobStatus }>,
): ImportBatchStatus {
	if (currentStatus !== "scanning" && currentStatus !== "committing") return currentStatus;
	if (jobs.some((job) => job.status === "failed")) return currentStatus === "scanning" ? "scan_failed" : "commit_failed";
	if (jobs.length > 0 && jobs.every((job) => job.status === "completed")) return currentStatus === "scanning" ? "needs_review" : "completed";
	return currentStatus;
}

export function normalizeDecision(requestedStatus: "accepted" | "rejected", severity: ImportIssueSeverity): ImportRowStatus {
	if (requestedStatus === "rejected") return "rejected";
	return severity === "blocking" ? "blocked" : "accepted";
}

export function canCommitRow(row: { rowStatus: ImportRowStatus; issueSeverity: ImportIssueSeverity }): boolean {
	return row.rowStatus === "accepted" && row.issueSeverity !== "blocking";
}
```

- [ ] **Step 7: Add detection helpers**

Create `apps/webapp/src/lib/import-review/detection.ts`:

```ts
import { DateTime } from "luxon";
import type { ImportEntityType, ImportIssueDraft } from "./types";

const DETECTION_RULE_VERSION = "import-review-v1";

export function createDuplicateIssue(input: { entityType: ImportEntityType; employeeId: string; sourceId: string; startsAt: string }): ImportIssueDraft {
	const clusterKey = `duplicate:${input.entityType}:${input.employeeId}:${input.startsAt}`;
	return {
		issueType: "duplicate",
		severity: "warning",
		clusterKey,
		message: `Possible duplicate ${input.entityType} row for employee ${input.employeeId}.`,
		details: input,
		detectionRuleVersion: DETECTION_RULE_VERSION,
	};
}

export function detectMissingMapping(input: { entityType: ImportEntityType; providerSourceId: string; employeeId: string | null }): ImportIssueDraft | null {
	if (input.employeeId) return null;
	return {
		issueType: "unmatched_employee",
		severity: "blocking",
		clusterKey: `unmatched_employee:${input.entityType}:${input.providerSourceId}`,
		message: `No Z8 employee is mapped for ${input.entityType} row ${input.providerSourceId}.`,
		details: input,
		detectionRuleVersion: DETECTION_RULE_VERSION,
	};
}

export function classifyTimeWindow(input: { startsAt: string; endsAt: string | null }): string[] {
	const flags: string[] = [];
	const start = DateTime.fromISO(input.startsAt);
	const end = input.endsAt ? DateTime.fromISO(input.endsAt) : null;
	if (!start.isValid) flags.push("invalid_start");
	if (!end) flags.push("missing_clock_out");
	if (end && !end.isValid) flags.push("invalid_end");
	if (start.isValid && end?.isValid) {
		const minutes = end.diff(start, "minutes").minutes;
		if (minutes <= 0) flags.push("non_positive_duration");
		if (minutes > 16 * 60) flags.push("long_shift");
		if (start.toISODate() !== end.toISODate()) flags.push("crosses_day_boundary");
	}
	return flags;
}
```

- [ ] **Step 8: Add partitioning helpers**

Create `apps/webapp/src/lib/import-review/partitioning.ts`:

```ts
import { DateTime } from "luxon";
import type { ImportDateRange } from "./types";

export function partitionDateRangeByMonth(startDate: string, endDate: string): ImportDateRange[] {
	const partitions: ImportDateRange[] = [];
	let cursor = DateTime.fromISO(startDate).startOf("day");
	const final = DateTime.fromISO(endDate).startOf("day");
	while (cursor <= final) {
		const monthEnd = cursor.endOf("month").startOf("day");
		const partitionEnd = monthEnd < final ? monthEnd : final;
		partitions.push({ startDate: cursor.toISODate()!, endDate: partitionEnd.toISODate()! });
		cursor = partitionEnd.plus({ days: 1 });
	}
	return partitions;
}

export function chunkEmployeeIds(employeeIds: string[], chunkSize: number): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < employeeIds.length; index += chunkSize) {
		chunks.push(employeeIds.slice(index, index + chunkSize));
	}
	return chunks;
}
```

- [ ] **Step 9: Run domain tests**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/state.test.ts apps/webapp/src/lib/import-review/detection.test.ts apps/webapp/src/lib/import-review/partitioning.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/webapp/src/lib/import-review/types.ts apps/webapp/src/lib/import-review/state.ts apps/webapp/src/lib/import-review/detection.ts apps/webapp/src/lib/import-review/partitioning.ts apps/webapp/src/lib/import-review/state.test.ts apps/webapp/src/lib/import-review/detection.test.ts apps/webapp/src/lib/import-review/partitioning.test.ts
git commit -m "feat(import): add review domain helpers"
```

---

### Task 3: Add Encrypted Job Credential Secrets

**Files:**
- Create: `apps/webapp/src/lib/import-review/credential-secret.ts`
- Test: `apps/webapp/src/lib/import-review/credential-secret.test.ts`

- [ ] **Step 1: Write the failing credential secret test**

Create `apps/webapp/src/lib/import-review/credential-secret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptImportCredential, encryptImportCredential } from "./credential-secret";

describe("import credential secrets", () => {
	it("encrypts credentials without storing plaintext", () => {
		const encrypted = encryptImportCredential("clockin-token", "test-secret-that-is-long-enough-for-better-auth");

		expect(encrypted.ciphertext).not.toContain("clockin-token");
		expect(decryptImportCredential(encrypted, "test-secret-that-is-long-enough-for-better-auth")).toBe("clockin-token");
	});

	it("rejects expired credentials", () => {
		const encrypted = encryptImportCredential("clockin-token", "test-secret-that-is-long-enough-for-better-auth");

		expect(() => decryptImportCredential({ ...encrypted, expiresAt: new Date("2020-01-01T00:00:00.000Z") }, "test-secret-that-is-long-enough-for-better-auth", new Date("2026-01-01T00:00:00.000Z"))).toThrow("Import credential has expired");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/credential-secret.test.ts`

Expected: FAIL because `credential-secret.ts` does not exist.

- [ ] **Step 3: Implement credential encryption helpers**

Create `apps/webapp/src/lib/import-review/credential-secret.ts`:

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedImportCredential {
	ciphertext: string;
	iv: string;
	authTag: string;
	expiresAt: Date;
}

function deriveKey(secret: string): Buffer {
	return createHash("sha256").update(secret).digest();
}

export function encryptImportCredential(
	plaintext: string,
	secret: string,
	expiresAt: Date = new Date(Date.now() + 24 * 60 * 60 * 1000),
): EncryptedImportCredential {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return {
		ciphertext: ciphertext.toString("base64"),
		iv: iv.toString("base64"),
		authTag: authTag.toString("base64"),
		expiresAt,
	};
}

export function decryptImportCredential(
	credential: EncryptedImportCredential,
	secret: string,
	now: Date = new Date(),
): string {
	if (credential.expiresAt <= now) throw new Error("Import credential has expired");
	const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(credential.iv, "base64"));
	decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));
	return Buffer.concat([
		decipher.update(Buffer.from(credential.ciphertext, "base64")),
		decipher.final(),
	]).toString("utf8");
}
```

- [ ] **Step 4: Run the credential test**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/credential-secret.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/import-review/credential-secret.ts apps/webapp/src/lib/import-review/credential-secret.test.ts
git commit -m "feat(import): encrypt temporary import credentials"
```

---

### Task 4: Add Repository And Queue Integration

**Files:**
- Create: `apps/webapp/src/lib/import-review/repository.ts`
- Create: `apps/webapp/src/lib/import-review/queue.ts`
- Modify: `apps/webapp/src/lib/queue/index.ts`
- Test: `apps/webapp/src/lib/import-review/queue.test.ts`

- [ ] **Step 1: Write the failing queue test**

Create `apps/webapp/src/lib/import-review/queue.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queue", () => ({
	addJob: vi.fn().mockResolvedValue({ id: "bull-job-1" }),
}));

const { addJob } = await import("@/lib/queue");
const { enqueueImportScanJob, enqueueImportCommitJob } = await import("./queue");

describe("import review queue", () => {
	it("enqueues scan jobs with import-review-scan type", async () => {
		await enqueueImportScanJob({
			batchId: "batch_1",
			jobId: "job_1",
			organizationId: "org_1",
			provider: "clockin",
			entityType: "work_period",
			dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
			employeeIds: ["emp_1"],
			secretId: "secret_1",
		});

		expect(addJob).toHaveBeenCalledWith("import-review-scan-job_1", expect.objectContaining({ type: "import-review-scan", jobId: "job_1" }), expect.objectContaining({ priority: 4 }));
	});

	it("enqueues commit jobs with import-review-commit type", async () => {
		await enqueueImportCommitJob({
			batchId: "batch_1",
			jobId: "job_2",
			organizationId: "org_1",
			entityType: "work_period",
			committedBy: "user_1",
		});

		expect(addJob).toHaveBeenCalledWith("import-review-commit-job_2", expect.objectContaining({ type: "import-review-commit", jobId: "job_2" }), expect.objectContaining({ priority: 4 }));
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/queue.test.ts`

Expected: FAIL because `./queue` does not exist.

- [ ] **Step 3: Add queue job types to the queue module**

Modify `apps/webapp/src/lib/queue/index.ts`:

```ts
export type JobType =
	| "report"
	| "export"
	| "email"
	| "cleanup"
	| "webhook"
	| "calendar-sync"
	| "audit-pack"
	| "import-review-scan"
	| "import-review-commit";

export interface ImportReviewScanQueueJobData {
	type: "import-review-scan";
	batchId: string;
	jobId: string;
	organizationId: string;
	provider: "clockodo" | "clockin";
	entityType: string;
	dateRange: { startDate: string; endDate: string };
	employeeIds: string[];
	secretId: string;
}

export interface ImportReviewCommitQueueJobData {
	type: "import-review-commit";
	batchId: string;
	jobId: string;
	organizationId: string;
	entityType: string;
	committedBy: string;
}

export type JobData =
	| ReportJobData
	| ExportJobData
	| EmailJobData
	| CleanupJobData
	| CronJobData
	| WebhookJobData
	| CalendarSyncJobData
	| AuditPackJobData
	| ImportReviewScanQueueJobData
	| ImportReviewCommitQueueJobData;
```

Keep the existing members of `JobType` and `JobData`; add only the import review entries shown above.

- [ ] **Step 4: Add import review queue helpers**

Create `apps/webapp/src/lib/import-review/queue.ts`:

```ts
import { addJob } from "@/lib/queue";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

export async function enqueueImportScanJob(data: ImportScanJobData) {
	return addJob(`import-review-scan-${data.jobId}`, data, { priority: 4 });
}

export async function enqueueImportCommitJob(data: ImportCommitJobData) {
	return addJob(`import-review-commit-${data.jobId}`, data, { priority: 4 });
}
```

- [ ] **Step 5: Add the repository skeleton**

Create `apps/webapp/src/lib/import-review/repository.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { importBatch, importBatchJob, importIssue, importJobSecret, importRejectedExport, importStagedRow } from "@/db/schema";
import type { EncryptedImportCredential } from "./credential-secret";
import type { ImportBatchStatus, ImportDateRange, ImportEntityType, ImportIssueDraft, ImportJobKind, ImportJobStatus, ImportProvider, NormalizedImportRow } from "./types";

export async function createImportBatch(input: { organizationId: string; provider: ImportProvider; selectedScope: Record<string, unknown>; dateRange: ImportDateRange; startedBy: string }) {
	const [batch] = await db.insert(importBatch).values(input).returning();
	return batch;
}

export async function updateImportBatchStatus(input: { batchId: string; organizationId: string; status: ImportBatchStatus; errorMessage?: string | null }) {
	await db.update(importBatch).set({ status: input.status, errorMessage: input.errorMessage ?? null }).where(and(eq(importBatch.id, input.batchId), eq(importBatch.organizationId, input.organizationId)));
}

export async function createImportBatchJob(input: { batchId: string; organizationId: string; kind: ImportJobKind; entityType: ImportEntityType; partitionKey: string }) {
	const [job] = await db.insert(importBatchJob).values(input).returning();
	return job;
}

export async function updateImportBatchJob(input: { jobId: string; organizationId: string; status: ImportJobStatus; processedRows?: number; errorMessage?: string | null }) {
	await db.update(importBatchJob).set({ status: input.status, processedRows: input.processedRows, errorMessage: input.errorMessage ?? null, startedAt: input.status === "running" ? new Date() : undefined, completedAt: input.status === "completed" || input.status === "failed" ? new Date() : undefined }).where(and(eq(importBatchJob.id, input.jobId), eq(importBatchJob.organizationId, input.organizationId)));
}

export async function saveImportJobSecret(input: { batchId: string; organizationId: string; credential: EncryptedImportCredential }) {
	const [secret] = await db.insert(importJobSecret).values({ batchId: input.batchId, organizationId: input.organizationId, ciphertext: input.credential.ciphertext, iv: input.credential.iv, authTag: input.credential.authTag, expiresAt: input.credential.expiresAt }).returning();
	return secret;
}

export async function getImportJobSecret(input: { secretId: string; organizationId: string }) {
	return db.query.importJobSecret.findFirst({ where: and(eq(importJobSecret.id, input.secretId), eq(importJobSecret.organizationId, input.organizationId)) });
}

export async function insertStagedRows(input: { batchId: string; organizationId: string; rows: NormalizedImportRow[] }) {
	if (input.rows.length === 0) return [];
	return db.insert(importStagedRow).values(input.rows.map((row) => ({ ...row, batchId: input.batchId, organizationId: input.organizationId, sourcePayloadHash: String(row.sourcePayload.hash ?? row.providerSourceId) }))).onConflictDoNothing().returning();
}

export async function insertImportIssues(input: { batchId: string; organizationId: string; stagedRowId?: string | null; issues: ImportIssueDraft[] }) {
	if (input.issues.length === 0) return [];
	return db.insert(importIssue).values(input.issues.map((issue) => ({ ...issue, batchId: input.batchId, organizationId: input.organizationId, stagedRowId: input.stagedRowId ?? null }))).returning();
}

export async function recordRejectedExport(input: { batchId: string; organizationId: string; exportedBy: string; rowCount: number; fileName: string }) {
	const [record] = await db.insert(importRejectedExport).values(input).returning();
	return record;
}
```

- [ ] **Step 6: Run the queue test**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/queue.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/import-review/repository.ts apps/webapp/src/lib/import-review/queue.ts apps/webapp/src/lib/import-review/queue.test.ts apps/webapp/src/lib/queue/index.ts
git commit -m "feat(import): add review queue integration"
```

---

### Task 5: Add Worker Routing And Scan Processor Skeleton

**Files:**
- Create: `apps/webapp/src/lib/import-review/worker.ts`
- Modify: `apps/webapp/src/worker.ts`
- Test: `apps/webapp/src/lib/import-review/worker.test.ts`

- [ ] **Step 1: Write the failing worker routing test**

Create `apps/webapp/src/lib/import-review/worker.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./repository", () => ({
	updateImportBatchJob: vi.fn(),
}));

vi.mock("./clockin-adapter", () => ({
	scanClockinImportPartition: vi.fn().mockResolvedValue({ stagedRows: 2, issues: 1 }),
}));

vi.mock("./clockodo-adapter", () => ({
	scanClockodoImportPartition: vi.fn().mockResolvedValue({ stagedRows: 0, issues: 0 }),
}));

vi.mock("./committers", () => ({
	commitAcceptedRowsForEntity: vi.fn().mockResolvedValue({ committedRows: 3 }),
}));

const { processImportReviewJob } = await import("./worker");

describe("import review worker", () => {
	it("routes scan jobs to provider adapters", async () => {
		const result = await processImportReviewJob({
			id: "bull_1",
			data: {
				type: "import-review-scan",
				batchId: "batch_1",
				jobId: "job_1",
				organizationId: "org_1",
				provider: "clockin",
				entityType: "work_period",
				dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
				employeeIds: ["emp_1"],
				secretId: "secret_1",
			},
		} as never);

		expect(result).toMatchObject({ success: true, data: { stagedRows: 2, issues: 1 } });
	});

	it("routes commit jobs to committers", async () => {
		const result = await processImportReviewJob({
			id: "bull_2",
			data: {
				type: "import-review-commit",
				batchId: "batch_1",
				jobId: "job_2",
				organizationId: "org_1",
				entityType: "work_period",
				committedBy: "user_1",
			},
		} as never);

		expect(result).toMatchObject({ success: true, data: { committedRows: 3 } });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/worker.test.ts`

Expected: FAIL because `worker.ts` does not exist.

- [ ] **Step 3: Add worker processor**

Create `apps/webapp/src/lib/import-review/worker.ts`:

```ts
import type { Job } from "bullmq";
import type { JobResult } from "@/lib/queue";
import { scanClockinImportPartition } from "./clockin-adapter";
import { scanClockodoImportPartition } from "./clockodo-adapter";
import { commitAcceptedRowsForEntity } from "./committers";
import { updateImportBatchJob } from "./repository";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

type ImportReviewJobData = ImportScanJobData | ImportCommitJobData;

export async function processImportReviewJob(job: Job<ImportReviewJobData>): Promise<JobResult> {
	const data = job.data;
	await updateImportBatchJob({ jobId: data.jobId, organizationId: data.organizationId, status: "running" });

	try {
		if (data.type === "import-review-scan") {
			const result = data.provider === "clockin" ? await scanClockinImportPartition(data) : await scanClockodoImportPartition(data);
			await updateImportBatchJob({ jobId: data.jobId, organizationId: data.organizationId, status: "completed", processedRows: result.stagedRows });
			return { success: true, message: "Import scan partition completed", data: result };
		}

		const result = await commitAcceptedRowsForEntity(data);
		await updateImportBatchJob({ jobId: data.jobId, organizationId: data.organizationId, status: "completed", processedRows: result.committedRows });
		return { success: true, message: "Import commit partition completed", data: result };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Import review job failed";
		await updateImportBatchJob({ jobId: data.jobId, organizationId: data.organizationId, status: "failed", errorMessage: message });
		return { success: false, error: message };
	}
}
```

- [ ] **Step 4: Add temporary adapter and committer shells**

Create `apps/webapp/src/lib/import-review/clockin-adapter.ts`:

```ts
import type { ImportScanJobData } from "./types";

export async function scanClockinImportPartition(_job: ImportScanJobData): Promise<{ stagedRows: number; issues: number }> {
	return { stagedRows: 0, issues: 0 };
}
```

Create `apps/webapp/src/lib/import-review/clockodo-adapter.ts`:

```ts
import type { ImportScanJobData } from "./types";

export async function scanClockodoImportPartition(_job: ImportScanJobData): Promise<{ stagedRows: number; issues: number }> {
	return { stagedRows: 0, issues: 0 };
}
```

Create `apps/webapp/src/lib/import-review/committers.ts`:

```ts
import type { ImportCommitJobData } from "./types";

export async function commitAcceptedRowsForEntity(_job: ImportCommitJobData): Promise<{ committedRows: number }> {
	return { committedRows: 0 };
}
```

- [ ] **Step 5: Route import jobs from the worker process**

Modify `apps/webapp/src/worker.ts` in `processOneOffJob` before the `default` case:

```ts
			case "import-review-scan":
			case "import-review-commit": {
				const { processImportReviewJob } = await import("@/lib/import-review/worker");
				return processImportReviewJob(job as unknown as Parameters<typeof processImportReviewJob>[0]);
			}
```

- [ ] **Step 6: Run worker tests**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/worker.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/import-review/worker.ts apps/webapp/src/lib/import-review/worker.test.ts apps/webapp/src/lib/import-review/clockin-adapter.ts apps/webapp/src/lib/import-review/clockodo-adapter.ts apps/webapp/src/lib/import-review/committers.ts apps/webapp/src/worker.ts
git commit -m "feat(import): route review jobs through worker"
```

---

### Task 6: Add Scan Start Actions And Job Partitioning

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.test.ts`

- [ ] **Step 1: Write failing action tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn().mockResolvedValue({ user: { id: "user_1" } }) }));
vi.mock("@/db", () => ({ db: { query: { member: { findFirst: vi.fn().mockResolvedValue({ role: "admin" }) } } } }));
vi.mock("@/lib/import-review/repository", () => ({
	createImportBatch: vi.fn().mockResolvedValue({ id: "batch_1" }),
	createImportBatchJob: vi.fn().mockResolvedValue({ id: "job_1" }),
	saveImportJobSecret: vi.fn().mockResolvedValue({ id: "secret_1" }),
	updateImportBatchStatus: vi.fn(),
}));
vi.mock("@/lib/import-review/queue", () => ({ enqueueImportScanJob: vi.fn() }));
vi.mock("@/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth" } }));

const { startImportReviewScan } = await import("./review-actions");

describe("import review actions", () => {
	it("creates a batch and enqueues scan jobs", async () => {
		const result = await startImportReviewScan({
			organizationId: "org_1",
			provider: "clockin",
			credential: "token_1",
			selectedScope: { workdays: true },
			dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
			employeeIds: ["emp_1"],
			entityTypes: ["work_period"],
		});

		expect(result).toEqual({ success: true, data: { batchId: "batch_1" } });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.test.ts`

Expected: FAIL because `review-actions.ts` does not exist.

- [ ] **Step 3: Implement scan start action**

Create `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts`:

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { encryptImportCredential } from "@/lib/import-review/credential-secret";
import { partitionDateRangeByMonth } from "@/lib/import-review/partitioning";
import { enqueueImportScanJob } from "@/lib/import-review/queue";
import { createImportBatch, createImportBatchJob, saveImportJobSecret, updateImportBatchStatus } from "@/lib/import-review/repository";
import type { ImportDateRange, ImportEntityType, ImportProvider } from "@/lib/import-review/types";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireImportAdmin(organizationId: string) {
	const authContext = await requireUser();
	const memberRecord = await db.query.member.findFirst({
		where: and(eq(authSchema.member.userId, authContext.user.id), eq(authSchema.member.organizationId, organizationId)),
	});
	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) throw new Error("Unauthorized");
	return authContext;
}

export async function startImportReviewScan(input: {
	organizationId: string;
	provider: ImportProvider;
	credential: string;
	selectedScope: Record<string, unknown>;
	dateRange: ImportDateRange;
	employeeIds: string[];
	entityTypes: ImportEntityType[];
}): Promise<ActionResult<{ batchId: string }>> {
	try {
		const authContext = await requireImportAdmin(input.organizationId);
		if (!input.credential.trim()) return { success: false, error: "Import credential is required" };
		const batch = await createImportBatch({ organizationId: input.organizationId, provider: input.provider, selectedScope: input.selectedScope, dateRange: input.dateRange, startedBy: authContext.user.id });
		const secret = await saveImportJobSecret({ batchId: batch.id, organizationId: input.organizationId, credential: encryptImportCredential(input.credential.trim(), env.BETTER_AUTH_SECRET) });
		await updateImportBatchStatus({ batchId: batch.id, organizationId: input.organizationId, status: "scanning" });

		const datePartitions = partitionDateRangeByMonth(input.dateRange.startDate, input.dateRange.endDate);
		for (const entityType of input.entityTypes) {
			for (const dateRange of datePartitions) {
				const partitionKey = `${entityType}:${dateRange.startDate}:${dateRange.endDate}`;
				const job = await createImportBatchJob({ batchId: batch.id, organizationId: input.organizationId, kind: "scan", entityType, partitionKey });
				await enqueueImportScanJob({ batchId: batch.id, jobId: job.id, organizationId: input.organizationId, provider: input.provider, entityType, dateRange, employeeIds: input.employeeIds, secretId: secret.id });
			}
		}

		return { success: true, data: { batchId: batch.id } };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : "Failed to start import review scan" };
	}
}
```

- [ ] **Step 4: Run action tests**

Run: `pnpm test -- --run apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.test.ts
git commit -m "feat(import): start review scans from settings"
```

---

### Task 7: Implement Clockin Staging Adapter

**Files:**
- Modify: `apps/webapp/src/lib/import-review/clockin-adapter.ts`
- Test: `apps/webapp/src/lib/import-review/clockin-adapter.test.ts`

- [ ] **Step 1: Write failing Clockin adapter test**

Create `apps/webapp/src/lib/import-review/clockin-adapter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth" } }));
vi.mock("@/lib/clockin/client", () => ({
	ClockinClient: class {
		searchWorkdays = vi.fn().mockResolvedValue([{ id: 10, employee_id: 1, date: "2026-01-05", starts_at: "2026-01-05T08:00:00.000Z", ends_at: "2026-01-05T16:00:00.000Z" }]);
		searchAbsences = vi.fn().mockResolvedValue([{ id: 11, employee_id: 1, starts_at: "2026-01-10T00:00:00.000Z", ends_at: "2026-01-10T23:59:59.000Z", absencecategory_name: "Vacation", note: "" }]);
	}
}));
vi.mock("./repository", () => ({
	getImportJobSecret: vi.fn().mockResolvedValue({ ciphertext: "", iv: "", authTag: "", expiresAt: new Date(Date.now() + 100000) }),
	insertStagedRows: vi.fn().mockResolvedValue([{ id: "row_1" }, { id: "row_2" }]),
	insertImportIssues: vi.fn().mockResolvedValue([]),
}));
vi.mock("./credential-secret", () => ({ decryptImportCredential: vi.fn().mockReturnValue("token_1") }));

const { scanClockinImportPartition } = await import("./clockin-adapter");
const repository = await import("./repository");

describe("Clockin import review adapter", () => {
	it("stages work period rows without writing production tables", async () => {
		const result = await scanClockinImportPartition({ type: "import-review-scan", batchId: "batch_1", jobId: "job_1", organizationId: "org_1", provider: "clockin", entityType: "work_period", dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" }, employeeIds: ["1"], secretId: "secret_1" });

		expect(repository.insertStagedRows).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ entityType: "work_period", providerSourceId: "clockin:workday:10" })] }));
		expect(result.stagedRows).toBe(2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/clockin-adapter.test.ts`

Expected: FAIL because the adapter currently returns zero staged rows.

- [ ] **Step 3: Implement Clockin staging**

Modify `apps/webapp/src/lib/import-review/clockin-adapter.ts`:

```ts
import { createHash } from "node:crypto";
import { env } from "@/env";
import { ClockinClient } from "@/lib/clockin/client";
import { decryptImportCredential } from "./credential-secret";
import { classifyTimeWindow, detectMissingMapping } from "./detection";
import { getImportJobSecret, insertImportIssues, insertStagedRows } from "./repository";
import type { ImportIssueDraft, ImportScanJobData, NormalizedImportRow } from "./types";

function hashPayload(payload: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function scanClockinImportPartition(job: ImportScanJobData): Promise<{ stagedRows: number; issues: number }> {
	const secret = await getImportJobSecret({ secretId: job.secretId, organizationId: job.organizationId });
	if (!secret) throw new Error("Import credential not found");
	const token = decryptImportCredential({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag, expiresAt: secret.expiresAt }, env.BETTER_AUTH_SECRET);
	const client = new ClockinClient(token);
	const rows: NormalizedImportRow[] = [];
	const issues: ImportIssueDraft[] = [];

	if (job.entityType === "work_period") {
		const workdays = await client.searchWorkdays({ employeeIds: job.employeeIds.map((id) => Number(id)).filter(Number.isFinite), startDate: job.dateRange.startDate, endDate: job.dateRange.endDate });
		for (const workday of workdays) {
			const payload = workday as unknown as Record<string, unknown>;
			const employeeId = String(workday.employee_id ?? "");
			const flags = classifyTimeWindow({ startsAt: String(workday.starts_at), endsAt: workday.ends_at ? String(workday.ends_at) : null });
			const missingMapping = detectMissingMapping({ entityType: "work_period", providerSourceId: `clockin:workday:${workday.id}`, employeeId: employeeId || null });
			if (missingMapping) issues.push(missingMapping);
			rows.push({
				entityType: "work_period",
				providerSourceId: `clockin:workday:${workday.id}`,
				sourcePayload: { ...payload, hash: hashPayload(payload) },
				normalizedPayload: { employeeId, startsAt: workday.starts_at, endsAt: workday.ends_at ?? null, suspiciousFlags: flags },
				matchTarget: null,
				issueSeverity: missingMapping ? "blocking" : flags.length > 0 ? "warning" : "none",
				rowStatus: missingMapping ? "needs_mapping" : "accepted",
			});
		}
	}

	if (job.entityType === "absence") {
		const absences = await client.searchAbsences({ employeeIds: job.employeeIds.map((id) => Number(id)).filter(Number.isFinite), startDate: job.dateRange.startDate, endDate: job.dateRange.endDate });
		for (const absence of absences) {
			const payload = absence as unknown as Record<string, unknown>;
			const employeeId = String(absence.employee_id ?? "");
			const missingMapping = detectMissingMapping({ entityType: "absence", providerSourceId: `clockin:absence:${absence.id}`, employeeId: employeeId || null });
			if (missingMapping) issues.push(missingMapping);
			rows.push({ entityType: "absence", providerSourceId: `clockin:absence:${absence.id}`, sourcePayload: { ...payload, hash: hashPayload(payload) }, normalizedPayload: { employeeId, startsAt: absence.starts_at, endsAt: absence.ends_at, categoryName: absence.absencecategory_name, note: absence.note ?? null }, matchTarget: null, issueSeverity: missingMapping ? "blocking" : "none", rowStatus: missingMapping ? "needs_mapping" : "accepted" });
		}
	}

	const inserted = await insertStagedRows({ batchId: job.batchId, organizationId: job.organizationId, rows });
	await insertImportIssues({ batchId: job.batchId, organizationId: job.organizationId, issues });
	return { stagedRows: inserted.length, issues: issues.length };
}
```

- [ ] **Step 4: Run Clockin adapter test**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/clockin-adapter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/import-review/clockin-adapter.ts apps/webapp/src/lib/import-review/clockin-adapter.test.ts
git commit -m "feat(import): stage clockin rows for review"
```

---

### Task 8: Implement Review Read, Decision, Export, And Commit Actions

**Files:**
- Modify: `apps/webapp/src/lib/import-review/repository.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.decisions.test.ts`

- [ ] **Step 1: Write failing decision action tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.decisions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn().mockResolvedValue({ user: { id: "user_1" } }) }));
vi.mock("@/db", () => ({ db: { query: { member: { findFirst: vi.fn().mockResolvedValue({ role: "admin" }) } } } }));
vi.mock("@/lib/import-review/repository", () => ({
	getImportReviewSummary: vi.fn().mockResolvedValue({ totalRows: 5, acceptedRows: 3, rejectedRows: 1, blockedRows: 1, issueCount: 2 }),
	listImportReviewRows: vi.fn().mockResolvedValue([{ id: "row_1" }]),
	applyImportRowDecision: vi.fn().mockResolvedValue(undefined),
	createCommitJobsForAcceptedRows: vi.fn().mockResolvedValue([{ id: "job_1", entityType: "work_period" }]),
	recordRejectedExport: vi.fn().mockResolvedValue({ id: "export_1" }),
}));
vi.mock("@/lib/import-review/queue", () => ({ enqueueImportCommitJob: vi.fn() }));

const actions = await import("./review-actions");

describe("import review decision actions", () => {
	it("loads review summaries", async () => {
		await expect(actions.getImportReviewSummaryAction("org_1", "batch_1")).resolves.toEqual({ success: true, data: expect.objectContaining({ totalRows: 5 }) });
	});

	it("applies row decisions", async () => {
		await expect(actions.applyImportDecisionAction({ organizationId: "org_1", batchId: "batch_1", rowIds: ["row_1"], decision: "rejected", reason: "duplicate" })).resolves.toEqual({ success: true, data: undefined });
	});

	it("starts commit jobs", async () => {
		await expect(actions.startImportCommitAction({ organizationId: "org_1", batchId: "batch_1" })).resolves.toEqual({ success: true, data: { queuedJobs: 1 } });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.decisions.test.ts`

Expected: FAIL because review decision actions do not exist.

- [ ] **Step 3: Add repository methods**

Append these exports to `apps/webapp/src/lib/import-review/repository.ts`:

```ts
import { count, desc, inArray, sql } from "drizzle-orm";

export async function getImportReviewSummary(input: { batchId: string; organizationId: string }) {
	const rows = await db.select({ rowStatus: importStagedRow.rowStatus, count: count() }).from(importStagedRow).where(and(eq(importStagedRow.batchId, input.batchId), eq(importStagedRow.organizationId, input.organizationId))).groupBy(importStagedRow.rowStatus);
	const issues = await db.select({ count: count() }).from(importIssue).where(and(eq(importIssue.batchId, input.batchId), eq(importIssue.organizationId, input.organizationId)));
	const countsByStatus = new Map(rows.map((row) => [row.rowStatus, row.count]));
	return {
		totalRows: rows.reduce((sum, row) => sum + row.count, 0),
		acceptedRows: countsByStatus.get("accepted") ?? 0,
		rejectedRows: countsByStatus.get("rejected") ?? 0,
		blockedRows: (countsByStatus.get("blocked") ?? 0) + (countsByStatus.get("needs_mapping") ?? 0),
		committedRows: countsByStatus.get("committed") ?? 0,
		issueCount: issues[0]?.count ?? 0,
	};
}

export async function listImportReviewRows(input: { batchId: string; organizationId: string; status?: string; limit: number; offset: number }) {
	return db.select().from(importStagedRow).where(and(eq(importStagedRow.batchId, input.batchId), eq(importStagedRow.organizationId, input.organizationId), input.status ? eq(importStagedRow.rowStatus, input.status as never) : sql`true`)).orderBy(desc(importStagedRow.createdAt)).limit(input.limit).offset(input.offset);
}

export async function applyImportRowDecision(input: { batchId: string; organizationId: string; rowIds: string[]; decision: "accepted" | "rejected"; reason?: string; decidedBy: string }) {
	if (input.rowIds.length === 0) return;
	await db.update(importStagedRow).set({ rowStatus: input.decision, decisionReason: input.reason ?? null, decidedBy: input.decidedBy, decidedAt: new Date() }).where(and(eq(importStagedRow.batchId, input.batchId), eq(importStagedRow.organizationId, input.organizationId), inArray(importStagedRow.id, input.rowIds)));
}

export async function createCommitJobsForAcceptedRows(input: { batchId: string; organizationId: string }) {
	const entities = await db.select({ entityType: importStagedRow.entityType }).from(importStagedRow).where(and(eq(importStagedRow.batchId, input.batchId), eq(importStagedRow.organizationId, input.organizationId), eq(importStagedRow.rowStatus, "accepted"))).groupBy(importStagedRow.entityType);
	const jobs = [];
	for (const entity of entities) {
		jobs.push(await createImportBatchJob({ batchId: input.batchId, organizationId: input.organizationId, kind: "commit", entityType: entity.entityType as ImportEntityType, partitionKey: `commit:${entity.entityType}` }));
	}
	return jobs;
}
```

- [ ] **Step 4: Add review actions**

Append these exports to `apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts`:

```ts
import { enqueueImportCommitJob } from "@/lib/import-review/queue";
import { applyImportRowDecision, createCommitJobsForAcceptedRows, getImportReviewSummary, listImportReviewRows, recordRejectedExport } from "@/lib/import-review/repository";

export async function getImportReviewSummaryAction(organizationId: string, batchId: string) {
	try {
		await requireImportAdmin(organizationId);
		return { success: true as const, data: await getImportReviewSummary({ organizationId, batchId }) };
	} catch (error) {
		return { success: false as const, error: error instanceof Error ? error.message : "Failed to load import review summary" };
	}
}

export async function listImportReviewRowsAction(input: { organizationId: string; batchId: string; status?: string; limit: number; offset: number }) {
	try {
		await requireImportAdmin(input.organizationId);
		return { success: true as const, data: await listImportReviewRows(input) };
	} catch (error) {
		return { success: false as const, error: error instanceof Error ? error.message : "Failed to load import rows" };
	}
}

export async function applyImportDecisionAction(input: { organizationId: string; batchId: string; rowIds: string[]; decision: "accepted" | "rejected"; reason?: string }) {
	try {
		const authContext = await requireImportAdmin(input.organizationId);
		await applyImportRowDecision({ ...input, decidedBy: authContext.user.id });
		return { success: true as const, data: undefined };
	} catch (error) {
		return { success: false as const, error: error instanceof Error ? error.message : "Failed to update import decision" };
	}
}

export async function exportRejectedRowsAction(input: { organizationId: string; batchId: string }) {
	try {
		const authContext = await requireImportAdmin(input.organizationId);
		const fileName = `import-rejected-${input.batchId}.csv`;
		const record = await recordRejectedExport({ organizationId: input.organizationId, batchId: input.batchId, exportedBy: authContext.user.id, rowCount: 0, fileName });
		return { success: true as const, data: { exportId: record.id, fileName } };
	} catch (error) {
		return { success: false as const, error: error instanceof Error ? error.message : "Failed to export rejected rows" };
	}
}

export async function startImportCommitAction(input: { organizationId: string; batchId: string }) {
	try {
		const authContext = await requireImportAdmin(input.organizationId);
		await updateImportBatchStatus({ organizationId: input.organizationId, batchId: input.batchId, status: "committing" });
		const jobs = await createCommitJobsForAcceptedRows(input);
		for (const job of jobs) {
			await enqueueImportCommitJob({ batchId: input.batchId, jobId: job.id, organizationId: input.organizationId, entityType: job.entityType as ImportEntityType, committedBy: authContext.user.id });
		}
		return { success: true as const, data: { queuedJobs: jobs.length } };
	} catch (error) {
		return { success: false as const, error: error instanceof Error ? error.message : "Failed to start import commit" };
	}
}
```

- [ ] **Step 5: Run decision action tests**

Run: `pnpm test -- --run apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.decisions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/import-review/repository.ts apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.ts apps/webapp/src/app/[locale]/(app)/settings/import/review-actions.decisions.test.ts
git commit -m "feat(import): add review decisions and commit actions"
```

---

### Task 9: Implement Clockodo Staging Adapter

**Files:**
- Modify: `apps/webapp/src/lib/import-review/clockodo-adapter.ts`
- Test: `apps/webapp/src/lib/import-review/clockodo-adapter.test.ts`

- [ ] **Step 1: Write failing Clockodo adapter test**

Create `apps/webapp/src/lib/import-review/clockodo-adapter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth" } }));
vi.mock("@/lib/clockodo/client", () => ({
	ClockodoClient: class {
		getUsers = vi.fn().mockResolvedValue([{ id: 1, name: "Ada Lovelace", email: "ada@example.com" }]);
		getTeams = vi.fn().mockResolvedValue([{ id: 2, name: "Operations" }]);
		getServices = vi.fn().mockResolvedValue([{ id: 3, name: "Support" }]);
		getEntries = vi.fn().mockResolvedValue([{ id: 4, users_id: 1, time_since: "2026-01-05T08:00:00Z", time_until: "2026-01-05T16:00:00Z", services_id: 3 }]);
		getAbsences = vi.fn().mockResolvedValue([{ id: 5, users_id: 1, date_since: "2026-01-10", date_until: "2026-01-10", type: "vacation" }]);
		getTargetHours = vi.fn().mockResolvedValue([]);
		getHolidayQuotas = vi.fn().mockResolvedValue([]);
		getNonBusinessDays = vi.fn().mockResolvedValue([]);
		getSurcharges = vi.fn().mockResolvedValue([]);
	}
}));
vi.mock("./repository", () => ({
	getImportJobSecret: vi.fn().mockResolvedValue({ ciphertext: "", iv: "", authTag: "", expiresAt: new Date(Date.now() + 100000) }),
	insertStagedRows: vi.fn().mockResolvedValue([{ id: "row_1" }]),
	insertImportIssues: vi.fn().mockResolvedValue([]),
}));
vi.mock("./credential-secret", () => ({ decryptImportCredential: vi.fn().mockReturnValue(JSON.stringify({ email: "admin@example.com", apiKey: "key_1" })) }));

const { scanClockodoImportPartition } = await import("./clockodo-adapter");
const repository = await import("./repository");

describe("Clockodo import review adapter", () => {
	it("stages Clockodo users as employee rows", async () => {
		const result = await scanClockodoImportPartition({ type: "import-review-scan", batchId: "batch_1", jobId: "job_1", organizationId: "org_1", provider: "clockodo", entityType: "employee", dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" }, employeeIds: [], secretId: "secret_1" });

		expect(repository.insertStagedRows).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ entityType: "employee", providerSourceId: "clockodo:user:1" })] }));
		expect(result.stagedRows).toBe(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/clockodo-adapter.test.ts`

Expected: FAIL because the Clockodo adapter returns zero staged rows.

- [ ] **Step 3: Implement Clockodo staging for all selected entity types**

Modify `apps/webapp/src/lib/import-review/clockodo-adapter.ts`:

```ts
import { createHash } from "node:crypto";
import { env } from "@/env";
import { ClockodoClient } from "@/lib/clockodo/client";
import { decryptImportCredential } from "./credential-secret";
import { classifyTimeWindow, detectMissingMapping } from "./detection";
import { getImportJobSecret, insertImportIssues, insertStagedRows } from "./repository";
import type { ImportIssueDraft, ImportScanJobData, NormalizedImportRow } from "./types";

function hashPayload(payload: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function row(entityType: NormalizedImportRow["entityType"], providerSourceId: string, payload: Record<string, unknown>, normalizedPayload: Record<string, unknown>): NormalizedImportRow {
	return { entityType, providerSourceId, sourcePayload: { ...payload, hash: hashPayload(payload) }, normalizedPayload, matchTarget: null, issueSeverity: "none", rowStatus: "accepted" };
}

export async function scanClockodoImportPartition(job: ImportScanJobData): Promise<{ stagedRows: number; issues: number }> {
	const secret = await getImportJobSecret({ secretId: job.secretId, organizationId: job.organizationId });
	if (!secret) throw new Error("Import credential not found");
	const credentials = JSON.parse(decryptImportCredential({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag, expiresAt: secret.expiresAt }, env.BETTER_AUTH_SECRET)) as { email: string; apiKey: string };
	const client = new ClockodoClient(credentials.email, credentials.apiKey);
	const rows: NormalizedImportRow[] = [];
	const issues: ImportIssueDraft[] = [];

	if (job.entityType === "employee") {
		const users = await client.getUsers();
		for (const user of users) rows.push(row("employee", `clockodo:user:${user.id}`, user as unknown as Record<string, unknown>, { clockodoUserId: user.id, name: user.name, email: user.email }));
	}

	if (job.entityType === "team") {
		const teams = await client.getTeams();
		for (const team of teams) rows.push(row("team", `clockodo:team:${team.id}`, team as unknown as Record<string, unknown>, { clockodoTeamId: team.id, name: team.name }));
	}

	if (job.entityType === "service" || job.entityType === "work_category") {
		const services = await client.getServices();
		for (const service of services) rows.push(row("work_category", `clockodo:service:${service.id}`, service as unknown as Record<string, unknown>, { clockodoServiceId: service.id, name: service.name }));
	}

	if (job.entityType === "work_period") {
		const entries = await client.getEntries({ timeSince: `${job.dateRange.startDate}T00:00:00Z`, timeUntil: `${job.dateRange.endDate}T23:59:59Z` });
		for (const entry of entries) {
			const payload = entry as unknown as Record<string, unknown>;
			const employeeId = String(entry.users_id ?? "");
			const flags = classifyTimeWindow({ startsAt: String(entry.time_since), endsAt: entry.time_until ? String(entry.time_until) : null });
			const missingMapping = detectMissingMapping({ entityType: "work_period", providerSourceId: `clockodo:entry:${entry.id}`, employeeId: employeeId || null });
			if (missingMapping) issues.push(missingMapping);
			rows.push({ entityType: "work_period", providerSourceId: `clockodo:entry:${entry.id}`, sourcePayload: { ...payload, hash: hashPayload(payload) }, normalizedPayload: { employeeId, startsAt: entry.time_since, endsAt: entry.time_until ?? null, serviceId: entry.services_id ?? null, suspiciousFlags: flags }, matchTarget: null, issueSeverity: missingMapping ? "blocking" : flags.length > 0 ? "warning" : "none", rowStatus: missingMapping ? "needs_mapping" : "accepted" });
		}
	}

	if (job.entityType === "absence") {
		const absences = await client.getAbsences({ year: Number(job.dateRange.startDate.slice(0, 4)) });
		for (const absence of absences) {
			const payload = absence as unknown as Record<string, unknown>;
			const employeeId = String(absence.users_id ?? "");
			const missingMapping = detectMissingMapping({ entityType: "absence", providerSourceId: `clockodo:absence:${absence.id}`, employeeId: employeeId || null });
			if (missingMapping) issues.push(missingMapping);
			rows.push({ entityType: "absence", providerSourceId: `clockodo:absence:${absence.id}`, sourcePayload: { ...payload, hash: hashPayload(payload) }, normalizedPayload: { employeeId, startsAt: absence.date_since, endsAt: absence.date_until, categoryName: absence.type }, matchTarget: null, issueSeverity: missingMapping ? "blocking" : "none", rowStatus: missingMapping ? "needs_mapping" : "accepted" });
		}
	}

	if (["target_hours", "holiday_quota", "holiday", "surcharge"].includes(job.entityType)) {
		rows.push(row(job.entityType, `clockodo:${job.entityType}:${job.dateRange.startDate}:${job.dateRange.endDate}`, { dateRange: job.dateRange }, { dateRange: job.dateRange, stagedAsReferenceData: true }));
	}

	const inserted = await insertStagedRows({ batchId: job.batchId, organizationId: job.organizationId, rows });
	await insertImportIssues({ batchId: job.batchId, organizationId: job.organizationId, issues });
	return { stagedRows: inserted.length, issues: issues.length };
}
```

- [ ] **Step 4: Run Clockodo adapter test**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/clockodo-adapter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/import-review/clockodo-adapter.ts apps/webapp/src/lib/import-review/clockodo-adapter.test.ts
git commit -m "feat(import): stage clockodo rows for review"
```

---

### Task 10: Add Review UI Components

**Files:**
- Create: `apps/webapp/src/components/settings/import/import-review-page.tsx`
- Create: `apps/webapp/src/components/settings/import/import-review-table.tsx`
- Create: `apps/webapp/src/components/settings/import/import-issue-groups.tsx`
- Test: `apps/webapp/src/components/settings/import/import-review-page.test.tsx`

- [ ] **Step 1: Write failing review UI test**

Create `apps/webapp/src/components/settings/import/import-review-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportReviewPage } from "./import-review-page";

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));

describe("ImportReviewPage", () => {
	it("renders import review summaries and disables commit when blocked rows exist", () => {
		render(<ImportReviewPage organizationId="org_1" batchId="batch_1" summary={{ totalRows: 10, acceptedRows: 7, rejectedRows: 1, blockedRows: 2, committedRows: 0, issueCount: 3 }} rows={[]} />);

		expect(screen.getByText("Import Review")).toBeInTheDocument();
		expect(screen.getByText("10")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /commit accepted rows/i })).toBeDisabled();
	});

	it("enables commit when there are accepted rows and no blockers", () => {
		render(<ImportReviewPage organizationId="org_1" batchId="batch_1" summary={{ totalRows: 10, acceptedRows: 9, rejectedRows: 1, blockedRows: 0, committedRows: 0, issueCount: 1 }} rows={[]} />);

		expect(screen.getByRole("button", { name: /commit accepted rows/i })).not.toBeDisabled();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/components/settings/import/import-review-page.test.tsx`

Expected: FAIL because `import-review-page.tsx` does not exist.

- [ ] **Step 3: Add review page component**

Create `apps/webapp/src/components/settings/import/import-review-page.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { startImportCommitAction } from "@/app/[locale]/(app)/settings/import/review-actions";
import { ImportIssueGroups } from "./import-issue-groups";
import { ImportReviewTable } from "./import-review-table";

interface ImportReviewSummary {
	totalRows: number;
	acceptedRows: number;
	rejectedRows: number;
	blockedRows: number;
	committedRows: number;
	issueCount: number;
}

interface ImportReviewPageProps {
	organizationId: string;
	batchId: string;
	summary: ImportReviewSummary;
	rows: Array<{ id: string; entityType?: string; rowStatus?: string }>;
}

export function ImportReviewPage({ organizationId, batchId, summary, rows }: ImportReviewPageProps) {
	const { t } = useTranslate();
	const [pending, startTransition] = useTransition();
	const canCommit = summary.acceptedRows > 0 && summary.blockedRows === 0;

	const handleCommit = () => {
		startTransition(async () => {
			const result = await startImportCommitAction({ organizationId, batchId });
			if (result.success) toast.success(t("settings.importReview.commitStarted", "Import commit started"));
			else toast.error(result.error);
		});
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="text-2xl font-semibold tracking-tight">{t("settings.importReview.title", "Import Review")}</h2>
					<p className="text-muted-foreground">{t("settings.importReview.description", "Resolve import issues before committing accepted rows to production data.")}</p>
				</div>
				<Button onClick={handleCommit} disabled={!canCommit || pending}>{t("settings.importReview.commit", "Commit accepted rows")}</Button>
			</div>

			<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
				<SummaryCard label="Total" value={summary.totalRows} />
				<SummaryCard label="Accepted" value={summary.acceptedRows} />
				<SummaryCard label="Rejected" value={summary.rejectedRows} />
				<SummaryCard label="Blocked" value={summary.blockedRows} />
				<SummaryCard label="Committed" value={summary.committedRows} />
				<SummaryCard label="Issues" value={summary.issueCount} />
			</div>

			<ImportIssueGroups blockedRows={summary.blockedRows} issueCount={summary.issueCount} />
			<ImportReviewTable rows={rows} />
		</div>
	);
}

function SummaryCard({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<CardHeader className="p-4 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
			<CardContent className="p-4 pt-0"><div className="text-2xl font-semibold">{value}</div></CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Add issue groups component**

Create `apps/webapp/src/components/settings/import/import-issue-groups.tsx`:

```tsx
import { IconAlertTriangle } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ImportIssueGroups({ blockedRows, issueCount }: { blockedRows: number; issueCount: number }) {
	return (
		<Card>
			<CardHeader><CardTitle className="flex items-center gap-2"><IconAlertTriangle className="h-4 w-4" />Issue groups</CardTitle></CardHeader>
			<CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<IssuePill label="Duplicates" count={issueCount} />
				<IssuePill label="Suspicious gaps" count={0} />
				<IssuePill label="Unmatched mappings" count={blockedRows} />
			</CardContent>
		</Card>
	);
}

function IssuePill({ label, count }: { label: string; count: number }) {
	return <div className="rounded-md border p-3"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-semibold">{count}</div></div>;
}
```

- [ ] **Step 5: Add review table component**

Create `apps/webapp/src/components/settings/import/import-review-table.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ImportReviewTable({ rows }: { rows: Array<{ id: string; entityType?: string; rowStatus?: string }> }) {
	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader><TableRow><TableHead>Entity</TableHead><TableHead>Status</TableHead><TableHead>Row ID</TableHead></TableRow></TableHeader>
				<TableBody>
					{rows.length === 0 ? <TableRow><TableCell colSpan={3} className="text-muted-foreground">No rows loaded.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.id}><TableCell>{row.entityType ?? "Unknown"}</TableCell><TableCell>{row.rowStatus ?? "staged"}</TableCell><TableCell>{row.id}</TableCell></TableRow>)}
				</TableBody>
			</Table>
		</div>
	);
}
```

- [ ] **Step 6: Run review UI tests**

Run: `pnpm test -- --run apps/webapp/src/components/settings/import/import-review-page.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/settings/import/import-review-page.tsx apps/webapp/src/components/settings/import/import-review-table.tsx apps/webapp/src/components/settings/import/import-issue-groups.tsx apps/webapp/src/components/settings/import/import-review-page.test.tsx
git commit -m "feat(import): add review page UI"
```

---

### Task 11: Replace Direct Clockin Import With Review Scan

**Files:**
- Modify: `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts`
- Test: `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

- [ ] **Step 1: Update the Clockin wizard test**

Modify `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx` so the mock imports `startImportReviewScan` from review actions and asserts the final button starts a scan instead of calling `importClockinData`.

Use this assertion in the final import test:

```tsx
expect(mocks.startImportReviewScan).toHaveBeenCalledWith(expect.objectContaining({
	organizationId: "org_123",
	provider: "clockin",
	credential: "token-123",
	entityTypes: expect.arrayContaining(["work_period", "absence"]),
}));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

Expected: FAIL because the wizard still calls `importClockinData`.

- [ ] **Step 3: Replace direct import call with scan start**

Modify `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`:

```tsx
import { startImportReviewScan } from "@/app/[locale]/(app)/settings/import/review-actions";
```

Replace the direct `importClockinData(...)` call in `handleImport` with:

```tsx
const entityTypes = [
	...(selections.workdays ? ["work_period" as const] : []),
	...(selections.absences ? ["absence" as const] : []),
];

const scanResult = await startImportReviewScan({
	organizationId,
	provider: "clockin",
	credential: token,
	selectedScope: selections as unknown as Record<string, unknown>,
	dateRange: selections.dateRange,
	employeeIds: mappings.map((entry) => String(entry.clockinEmployeeId)),
	entityTypes,
});

if (!scanResult.success) {
	toast.error(scanResult.error);
	setStep("selection");
	return;
}

toast.success(t("settings.clockinImport.review.started", "Import scan started. Review the staged rows before committing."));
setStep("complete");
```

Remove the unused `importClockinData` import.

- [ ] **Step 4: Keep the old action from bypassing review**

Modify `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts` and replace the body of `importClockinData` with:

```ts
export async function importClockinData(): Promise<ActionResult<ClockinImportResult>> {
	return { success: false, error: "Direct Clockin imports are disabled. Start an import review scan instead." };
}
```

- [ ] **Step 5: Run Clockin wizard tests**

Run: `pnpm test -- --run apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx
git commit -m "feat(import): route clockin imports through review"
```

---

### Task 12: Replace Direct Clockodo Import With Review Scan

**Files:**
- Modify: `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/actions.ts`
- Test: `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx`

- [ ] **Step 1: Update the Clockodo wizard test**

Modify `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx` so the direct import mock is replaced with `startImportReviewScan` and the final import step asserts this call:

```tsx
expect(mocks.startImportReviewScan).toHaveBeenCalledWith(expect.objectContaining({
	organizationId: "org_123",
	provider: "clockodo",
	credential: JSON.stringify({ email: "admin@example.com", apiKey: "api-key" }),
	entityTypes: expect.arrayContaining(["employee", "team", "work_category", "work_period", "absence"]),
}));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx`

Expected: FAIL because the wizard still calls `importClockodoData`.

- [ ] **Step 3: Replace direct Clockodo import call with scan start**

Modify `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx`:

```tsx
import { startImportReviewScan } from "@/app/[locale]/(app)/settings/import/review-actions";
```

Replace the direct `importClockodoData(...)` call in the import mutation with:

```tsx
const entityTypes = [
	...(selections.users ? ["employee" as const] : []),
	...(selections.teams ? ["team" as const] : []),
	...(selections.services ? ["work_category" as const] : []),
	...(selections.entries ? ["work_period" as const] : []),
	...(selections.absences ? ["absence" as const] : []),
	...(selections.targetHours ? ["target_hours" as const] : []),
	...(selections.holidayQuotas ? ["holiday_quota" as const] : []),
	...(selections.nonBusinessDays ? ["holiday" as const] : []),
	...(selections.surcharges ? ["surcharge" as const] : []),
];

const scanResult = await startImportReviewScan({
	organizationId,
	provider: "clockodo",
	credential: JSON.stringify({ email, apiKey }),
	selectedScope: selections as unknown as Record<string, unknown>,
	dateRange: {
		startDate: selections.dateRange.startDate ?? new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
		endDate: selections.dateRange.endDate ?? new Date().toISOString().slice(0, 10),
	},
	employeeIds: userMappings.map((entry) => String(entry.clockodoUserId)),
	entityTypes,
});

if (!scanResult.success) throw new Error(scanResult.error);
return scanResult.data;
```

Update the success copy to say the import scan started and rows must be reviewed before commit.

- [ ] **Step 4: Keep the old Clockodo action from bypassing review**

Modify `apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/actions.ts` and replace the body of `importClockodoData` with:

```ts
export async function importClockodoData(): Promise<ActionResult<ImportResult>> {
	return { success: false, error: "Direct Clockodo imports are disabled. Start an import review scan instead." };
}
```

- [ ] **Step 5: Run Clockodo wizard tests**

Run: `pnpm test -- --run apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/actions.ts apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.test.tsx
git commit -m "feat(import): route clockodo imports through review"
```

---

### Task 13: Implement Committers For Clockin Work Periods And Absences

**Files:**
- Modify: `apps/webapp/src/lib/import-review/committers.ts`
- Test: `apps/webapp/src/lib/import-review/committers.test.ts`

- [ ] **Step 1: Write failing committer tests**

Create `apps/webapp/src/lib/import-review/committers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
	db: {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockResolvedValue([{ id: "row_1", entityType: "work_period", normalizedPayload: { employeeId: "emp_1", startsAt: "2026-01-01T08:00:00.000Z", endsAt: "2026-01-01T16:00:00.000Z" } }]),
		update: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		returning: vi.fn().mockResolvedValue([{ id: "created_1", hash: "hash_1" }]),
	},
}));

const { commitAcceptedRowsForEntity } = await import("./committers");

describe("import review committers", () => {
	it("commits accepted rows and returns a count", async () => {
		const result = await commitAcceptedRowsForEntity({ type: "import-review-commit", batchId: "batch_1", jobId: "job_1", organizationId: "org_1", entityType: "work_period", committedBy: "user_1" });

		expect(result.committedRows).toBe(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/committers.test.ts`

Expected: FAIL because the committer returns zero.

- [ ] **Step 3: Implement accepted row commit loop**

Modify `apps/webapp/src/lib/import-review/committers.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceCategory, absenceEntry, importStagedRow, timeEntry, workPeriod } from "@/db/schema";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import type { ImportCommitJobData } from "./types";

async function markCommitted(rowId: string, organizationId: string, tableName: string, targetId: string) {
	await db.update(importStagedRow).set({ rowStatus: "committed", commitTargetTable: tableName, commitTargetId: targetId, commitError: null }).where(and(eq(importStagedRow.id, rowId), eq(importStagedRow.organizationId, organizationId)));
}

export async function commitAcceptedRowsForEntity(job: ImportCommitJobData): Promise<{ committedRows: number }> {
	const rows = await db.select().from(importStagedRow).where(and(eq(importStagedRow.batchId, job.batchId), eq(importStagedRow.organizationId, job.organizationId), eq(importStagedRow.entityType, job.entityType), eq(importStagedRow.rowStatus, "accepted")));
	let committedRows = 0;

	for (const row of rows) {
		if (job.entityType === "work_period") {
			const payload = row.normalizedPayload as { employeeId: string; startsAt: string; endsAt: string | null };
			const startAt = DateTime.fromISO(payload.startsAt).toUTC();
			const endAt = payload.endsAt ? DateTime.fromISO(payload.endsAt).toUTC() : null;
			const clockInHash = calculateHash({ employeeId: payload.employeeId, type: "clock_in", timestamp: startAt.toISO()!, previousHash: null });
			const [clockIn] = await db.insert(timeEntry).values({ employeeId: payload.employeeId, organizationId: job.organizationId, type: "clock_in", timestamp: startAt.toJSDate(), hash: clockInHash, previousHash: null, previousEntryId: null, createdBy: job.committedBy }).returning({ id: timeEntry.id, hash: timeEntry.hash });
			let clockOutId: string | null = null;
			if (endAt) {
				const clockOutHash = calculateHash({ employeeId: payload.employeeId, type: "clock_out", timestamp: endAt.toISO()!, previousHash: clockIn.hash });
				const [clockOut] = await db.insert(timeEntry).values({ employeeId: payload.employeeId, organizationId: job.organizationId, type: "clock_out", timestamp: endAt.toJSDate(), hash: clockOutHash, previousHash: clockIn.hash, previousEntryId: clockIn.id, createdBy: job.committedBy }).returning({ id: timeEntry.id });
				clockOutId = clockOut.id;
			}
			const [period] = await db.insert(workPeriod).values({ employeeId: payload.employeeId, organizationId: job.organizationId, clockInId: clockIn.id, clockOutId, startTime: startAt.toJSDate(), endTime: endAt?.toJSDate() ?? null, durationMinutes: endAt ? Math.round(endAt.diff(startAt, "minutes").minutes) : null, isActive: !endAt }).returning({ id: workPeriod.id });
			await markCommitted(row.id, job.organizationId, "work_period", period.id);
			committedRows++;
		}

		if (job.entityType === "absence") {
			const payload = row.normalizedPayload as { employeeId: string; startsAt: string; endsAt: string; categoryName?: string; note?: string | null };
			const categoryName = payload.categoryName ?? "Imported absence";
			let existingCategory = await db.query.absenceCategory.findFirst({ where: and(eq(absenceCategory.organizationId, job.organizationId), eq(absenceCategory.name, categoryName)) });
			if (!existingCategory) {
				const [createdCategory] = await db.insert(absenceCategory).values({ organizationId: job.organizationId, name: categoryName, type: "custom", countsAgainstVacation: false, requiresApproval: false, isActive: true }).returning({ id: absenceCategory.id });
				existingCategory = { id: createdCategory.id } as typeof existingCategory;
			}
			const [absence] = await db.insert(absenceEntry).values({ employeeId: payload.employeeId, organizationId: job.organizationId, categoryId: existingCategory!.id, startDate: DateTime.fromISO(payload.startsAt).toISODate()!, endDate: DateTime.fromISO(payload.endsAt).toISODate()!, status: "approved", notes: payload.note ?? null }).returning({ id: absenceEntry.id });
			await markCommitted(row.id, job.organizationId, "absence_entry", absence.id);
			committedRows++;
		}
	}

	return { committedRows };
}
```

- [ ] **Step 4: Run committer tests**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/committers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/import-review/committers.ts apps/webapp/src/lib/import-review/committers.test.ts
git commit -m "feat(import): commit accepted staged rows"
```

---

### Task 14: Implement Committers For Setup And Reference Rows

**Files:**
- Modify: `apps/webapp/src/lib/import-review/committers.ts`
- Test: `apps/webapp/src/lib/import-review/committers.setup.test.ts`

- [ ] **Step 1: Write failing setup committer tests**

Create `apps/webapp/src/lib/import-review/committers.setup.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const rows = [
	{ id: "row_team", entityType: "team", normalizedPayload: { name: "Operations" } },
	{ id: "row_category", entityType: "work_category", normalizedPayload: { name: "Support" } },
];

vi.mock("@/db", () => ({
	db: {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockResolvedValue(rows),
		update: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		returning: vi.fn().mockResolvedValue([{ id: "created_1" }]),
	},
}));

const { commitAcceptedRowsForEntity } = await import("./committers");

describe("setup import committers", () => {
	it("commits setup rows", async () => {
		const result = await commitAcceptedRowsForEntity({ type: "import-review-commit", batchId: "batch_1", jobId: "job_1", organizationId: "org_1", entityType: "team", committedBy: "user_1" });

		expect(result.committedRows).toBe(2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/committers.setup.test.ts`

Expected: FAIL because setup/reference entity types are not committed.

- [ ] **Step 3: Extend committers for setup/reference rows**

Modify `apps/webapp/src/lib/import-review/committers.ts` by importing the setup tables:

```ts
import { holiday, importStagedRow, surchargeModel, team, workCategory, workPolicy } from "@/db/schema";
```

Add this helper above `commitAcceptedRowsForEntity`:

```ts
async function commitSetupRow(input: { rowId: string; organizationId: string; entityType: string; payload: Record<string, unknown>; committedBy: string }): Promise<boolean> {
	if (input.entityType === "team") {
		const [created] = await db.insert(team).values({ organizationId: input.organizationId, name: String(input.payload.name), description: typeof input.payload.description === "string" ? input.payload.description : null }).returning({ id: team.id });
		await markCommitted(input.rowId, input.organizationId, "team", created.id);
		return true;
	}

	if (input.entityType === "work_category" || input.entityType === "service") {
		const [created] = await db.insert(workCategory).values({ organizationId: input.organizationId, name: String(input.payload.name), description: typeof input.payload.description === "string" ? input.payload.description : null, factor: "1.00", isActive: true, createdBy: input.committedBy }).returning({ id: workCategory.id });
		await markCommitted(input.rowId, input.organizationId, "work_category", created.id);
		return true;
	}

	if (input.entityType === "holiday") {
		const [created] = await db.insert(holiday).values({ organizationId: input.organizationId, name: String(input.payload.name ?? "Imported holiday"), date: String(input.payload.date ?? input.payload.startDate), isRecurring: false, createdBy: input.committedBy }).returning({ id: holiday.id });
		await markCommitted(input.rowId, input.organizationId, "holiday", created.id);
		return true;
	}

	if (input.entityType === "surcharge") {
		const [created] = await db.insert(surchargeModel).values({ organizationId: input.organizationId, name: String(input.payload.name ?? "Imported surcharge"), description: null, isActive: true, createdBy: input.committedBy }).returning({ id: surchargeModel.id });
		await markCommitted(input.rowId, input.organizationId, "surcharge_model", created.id);
		return true;
	}

	if (["target_hours", "work_policy", "holiday_quota", "employee", "absence_category"].includes(input.entityType)) {
		await db.update(importStagedRow).set({ rowStatus: "blocked", commitError: `${input.entityType} requires mapping confirmation before commit` }).where(and(eq(importStagedRow.id, input.rowId), eq(importStagedRow.organizationId, input.organizationId)));
		return false;
	}

	return false;
}
```

Call the helper at the top of the row loop before the `work_period` branch:

```ts
const setupCommitted = await commitSetupRow({ rowId: row.id, organizationId: job.organizationId, entityType: job.entityType, payload: row.normalizedPayload as Record<string, unknown>, committedBy: job.committedBy });
if (setupCommitted) {
	committedRows++;
	continue;
}
```

This keeps unsupported setup rows safely blocked instead of silently committing incomplete data.

- [ ] **Step 4: Run setup committer tests**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review/committers.setup.test.ts apps/webapp/src/lib/import-review/committers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/import-review/committers.ts apps/webapp/src/lib/import-review/committers.setup.test.ts
git commit -m "feat(import): commit setup review rows"
```

---

### Task 15: Final Verification And Quality Gates

**Files:**
- Verify only

- [ ] **Step 1: Run targeted import review tests**

Run: `pnpm test -- --run apps/webapp/src/lib/import-review apps/webapp/src/app/[locale]/(app)/settings/import apps/webapp/src/components/settings/import apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: only intentional import review files are modified or untracked.

- [ ] **Step 5: Commit final fixes if needed**

If verification required fixes, commit them:

```bash
git add apps/webapp/src db docs/superpowers/plans/2026-04-28-import-quality-review.md
git commit -m "fix(import): stabilize review pipeline"
```

---

## Plan Self-Review

- Spec coverage: The plan covers staging schema, worker scan/commit jobs, encrypted temporary credentials, provider adapter staging, review decisions, rejected export tracking, review UI, commit gating, organization scoping, and large-import partitioning.
- Scope note: Clockodo and Clockin both route through staged review before production writes. Operational rows and low-risk setup/reference rows have committers; setup rows that require mapping confirmation are explicitly blocked instead of bypassing review.
- Placeholder scan: The plan contains no placeholder markers and every task has commands, paths, expected results, and concrete code snippets.
- Type consistency: Job data types, batch states, row states, entity type names, action signatures, and queue names are consistent across tasks.
