# Platform Admin Cron Schedule Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, audited preset-based cron schedule editing to `/platform-admin/worker-queue`, with immediate BullMQ reconciliation and worker-startup reconciliation.

**Architecture:** Keep `CRON_JOBS` as the default registry and store only non-default schedule overrides in Postgres. Resolve effective schedules through a focused cron schedule module, reuse one reconciliation helper from platform-admin actions and worker startup, and render schedule editing in a small client component attached to the existing worker queue page.

**Tech Stack:** Next.js server actions, React client components, `@tanstack/react-form`, Drizzle ORM, Postgres migrations, BullMQ repeatable jobs, Effect result handling, Vitest, Testing Library, pnpm.

---

## File Structure

- Create `apps/webapp/drizzle/0043_cron_schedule_override.sql`: database migration for the platform-level override table.
- Modify `apps/webapp/drizzle/meta/_journal.json`: append migration journal entry with `idx: 43` and `when: 1780304304744`.
- Modify `apps/webapp/src/db/schema/cron-job.ts`: add `cronScheduleOverride` Drizzle table and exported types next to cron execution schema.
- Modify `apps/webapp/src/db/schema/index.ts`: already exports `./cron-job`, so no added export is expected after the table is added in that file.
- Create `apps/webapp/src/lib/cron/schedules.ts`: pure preset catalog, high-risk classification, default/effective schedule shaping, mismatch detection, and visible scheduled job row types.
- Create `apps/webapp/src/lib/cron/schedules.test.ts`: pure tests for presets, high-risk rules, effective schedule resolution, and row shaping.
- Create `apps/webapp/src/lib/cron/schedule-overrides.ts`: database functions for loading, upserting, and deleting overrides.
- Create `apps/webapp/src/lib/cron/schedule-overrides.test.ts`: tests for the database function call shapes with a mocked `db`.
- Create `apps/webapp/src/lib/cron/reconciliation.ts`: BullMQ repeatable-job reconciliation helpers for one job and all jobs.
- Create `apps/webapp/src/lib/cron/reconciliation.test.ts`: tests for stale repeatable removal and effective repeatable registration.
- Modify `apps/webapp/src/lib/cron/index.ts`: export new schedule modules.
- Modify `apps/webapp/src/worker.ts`: replace local static setup logic with shared all-job reconciliation.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`: return enriched scheduled-job rows and add update/reset server actions.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`: add server action tests for authorization, validation, persistence, warnings, and resets.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.tsx`: client component for edit/reset controls and preset-only TanStack form.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx`: render tests for overridden/default state, high-risk confirmation, and action calls.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`: use enriched rows and render `ScheduleControls` in the scheduled cron jobs table.
- Modify `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`: mention schedule editing and reset behavior.

## Task 1: Add Cron Schedule Override Schema

**Files:**
- Create: `apps/webapp/drizzle/0043_cron_schedule_override.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/db/schema/cron-job.ts`

- [ ] **Step 1: Add schema test first**

Add this test to `apps/webapp/src/db/schema/__tests__/cron-schedule-override-schema.test.ts`:

```ts
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cronScheduleOverride } from "../cron-job";

describe("cronScheduleOverride schema", () => {
	it("uses the expected table and column names", () => {
		expect(getTableName(cronScheduleOverride)).toBe("cron_schedule_override");
		expect(cronScheduleOverride.jobName.name).toBe("job_name");
		expect(cronScheduleOverride.presetId.name).toBe("preset_id");
		expect(cronScheduleOverride.pattern.name).toBe("pattern");
		expect(cronScheduleOverride.updatedBy.name).toBe("updated_by");
	});
});
```

- [ ] **Step 2: Run schema test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/db/schema/__tests__/cron-schedule-override-schema.test.ts`

Expected: FAIL because `cronScheduleOverride` is not exported from `cron-job.ts`.

- [ ] **Step 3: Add the Drizzle table**

Modify imports in `apps/webapp/src/db/schema/cron-job.ts` to include `uniqueIndex` and import `user`:

```ts
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
```

Add this table after `cronJobExecution`:

```ts
export const cronScheduleOverride = pgTable(
	"cron_schedule_override",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		jobName: varchar("job_name", { length: 100 }).notNull(),
		presetId: varchar("preset_id", { length: 100 }).notNull(),
		pattern: varchar("pattern", { length: 100 }).notNull(),
		updatedBy: text("updated_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("idx_cron_schedule_override_job_name_unique").on(table.jobName),
		index("idx_cron_schedule_override_updated_by").on(table.updatedBy),
	],
);

export type CronScheduleOverride = typeof cronScheduleOverride.$inferSelect;
export type NewCronScheduleOverride = typeof cronScheduleOverride.$inferInsert;
```

- [ ] **Step 4: Add SQL migration**

Create `apps/webapp/drizzle/0043_cron_schedule_override.sql`:

```sql
CREATE TABLE IF NOT EXISTS "cron_schedule_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"preset_id" varchar(100) NOT NULL,
	"pattern" varchar(100) NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cron_schedule_override_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_cron_schedule_override_job_name_unique" ON "cron_schedule_override" USING btree ("job_name");
CREATE INDEX IF NOT EXISTS "idx_cron_schedule_override_updated_by" ON "cron_schedule_override" USING btree ("updated_by");
```

- [ ] **Step 5: Append migration journal entry**

Modify the tail of `apps/webapp/drizzle/meta/_journal.json` so the last two entries are:

```json
    {
      "idx": 42,
      "version": "7",
      "when": 1780304304743,
      "tag": "0042_approval_policy_runtime_tables",
      "breakpoints": true
    },
    {
      "idx": 43,
      "version": "7",
      "when": 1780304304744,
      "tag": "0043_cron_schedule_override",
      "breakpoints": true
    }
```

- [ ] **Step 6: Run schema test to verify it passes**

Run: `pnpm --dir apps/webapp vitest run src/db/schema/__tests__/cron-schedule-override-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit schema task**

```bash
git add apps/webapp/drizzle/0043_cron_schedule_override.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/db/schema/cron-job.ts apps/webapp/src/db/schema/__tests__/cron-schedule-override-schema.test.ts
git commit -m "feat(cron): add schedule override schema"
```

## Task 2: Add Pure Schedule Helpers

**Files:**
- Create: `apps/webapp/src/lib/cron/schedules.ts`
- Create: `apps/webapp/src/lib/cron/schedules.test.ts`
- Modify: `apps/webapp/src/lib/cron/index.ts`

- [ ] **Step 1: Write failing schedule helper tests**

Create `apps/webapp/src/lib/cron/schedules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	CRON_SCHEDULE_PRESETS,
	buildScheduledJobRows,
	getPresetById,
	isHighRiskCronJob,
	resolveEffectiveCronSchedules,
} from "./schedules";

describe("cron schedule presets", () => {
	it("contains stable preset IDs for supported intervals", () => {
		expect(CRON_SCHEDULE_PRESETS.map((preset) => preset.id)).toEqual([
			"every-minute",
			"every-5-minutes",
			"every-15-minutes",
			"every-30-minutes",
			"hourly",
			"every-3-hours",
			"daily-midnight",
			"daily-1am",
			"daily-230am",
			"weekly-sunday-midnight",
		]);
		expect(getPresetById("hourly")?.pattern).toBe("0 * * * *");
	});

	it("marks operationally high-risk jobs", () => {
		expect(isHighRiskCronJob("cron:billing-seat-reconciliation")).toBe(true);
		expect(isHighRiskCronJob("cron:execution-cleanup")).toBe(true);
		expect(isHighRiskCronJob("cron:export")).toBe(false);
	});

	it("resolves overrides over registry defaults", () => {
		const schedules = resolveEffectiveCronSchedules({
			overrides: [
				{
					jobName: "cron:export",
					presetId: "hourly",
					pattern: "0 * * * *",
				},
			],
		});

		expect(schedules["cron:export"]).toMatchObject({
			jobName: "cron:export",
			defaultPattern: "*/5 * * * *",
			effectivePattern: "0 * * * *",
			presetId: "hourly",
			isOverridden: true,
		});
		expect(schedules["cron:vacation"].isOverridden).toBe(false);
	});

	it("builds rows with mismatch status from BullMQ repeatables", () => {
		const rows = buildScheduledJobRows({
			overrides: [
				{
					jobName: "cron:export",
					presetId: "hourly",
					pattern: "0 * * * *",
				},
			],
			repeatableJobs: [
				{
					name: "cron:export",
					pattern: "*/5 * * * *",
					next: "2026-06-03T12:05:00.000Z",
				},
			],
		});

		const exportRow = rows.find((row) => row.name === "cron:export");
		expect(exportRow).toMatchObject({
			name: "cron:export",
			effectivePattern: "0 * * * *",
			currentBullMqPattern: "*/5 * * * *",
			hasScheduleMismatch: true,
			canEdit: true,
		});
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/schedules.test.ts`

Expected: FAIL because `./schedules` does not exist.

- [ ] **Step 3: Implement schedule helper module**

Create `apps/webapp/src/lib/cron/schedules.ts`:

```ts
import { CRON_JOBS, type CronJobName, getAllCronJobNames } from "./registry";

export interface CronSchedulePreset {
	id: string;
	label: string;
	pattern: string;
}

export interface CronScheduleOverrideLike {
	jobName: string;
	presetId: string;
	pattern: string;
}

export interface RepeatableCronJobLike {
	name: string;
	pattern: string;
	next: string | null;
}

export interface EffectiveCronSchedule {
	jobName: CronJobName;
	description: string;
	defaultPattern: string;
	defaultPresetId: string | null;
	effectivePattern: string;
	presetId: string | null;
	presetLabel: string | null;
	isOverridden: boolean;
	isHighRisk: boolean;
	canEdit: boolean;
}

export interface ScheduledCronJobRow extends EffectiveCronSchedule {
	name: CronJobName;
	next: string | null;
	currentBullMqPattern: string | null;
	hasScheduleMismatch: boolean;
}

export const CRON_SCHEDULE_PRESETS = [
	{ id: "every-minute", label: "Every minute", pattern: "* * * * *" },
	{ id: "every-5-minutes", label: "Every 5 minutes", pattern: "*/5 * * * *" },
	{ id: "every-15-minutes", label: "Every 15 minutes", pattern: "*/15 * * * *" },
	{ id: "every-30-minutes", label: "Every 30 minutes", pattern: "*/30 * * * *" },
	{ id: "hourly", label: "Hourly", pattern: "0 * * * *" },
	{ id: "every-3-hours", label: "Every 3 hours", pattern: "0 */3 * * *" },
	{ id: "daily-midnight", label: "Daily at midnight", pattern: "0 0 * * *" },
	{ id: "daily-1am", label: "Daily at 1 AM", pattern: "0 1 * * *" },
	{ id: "daily-230am", label: "Daily at 2:30 AM", pattern: "30 2 * * *" },
	{ id: "weekly-sunday-midnight", label: "Weekly on Sunday at midnight", pattern: "0 0 * * 0" },
] as const satisfies CronSchedulePreset[];

const HIGH_RISK_CRON_JOBS = new Set<CronJobName>([
	"cron:billing-seat-reconciliation",
	"cron:execution-cleanup",
	"cron:organization-cleanup",
	"cron:break-enforcement",
	"cron:teams-daily-digest",
	"cron:teams-escalation",
	"cron:telegram-daily-digest",
	"cron:telegram-escalation",
	"cron:discord-daily-digest",
	"cron:discord-escalation",
	"cron:slack-daily-digest",
	"cron:slack-escalation",
]);

export function getPresetById(presetId: string): CronSchedulePreset | null {
	return CRON_SCHEDULE_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function getPresetByPattern(pattern: string): CronSchedulePreset | null {
	return CRON_SCHEDULE_PRESETS.find((preset) => preset.pattern === pattern) ?? null;
}

export function isHighRiskCronJob(jobName: CronJobName): boolean {
	return HIGH_RISK_CRON_JOBS.has(jobName);
}

export function resolveEffectiveCronSchedules({
	overrides,
}: {
	overrides: CronScheduleOverrideLike[];
}): Record<CronJobName, EffectiveCronSchedule> {
	const overridesByName = new Map(overrides.map((override) => [override.jobName, override]));

	return Object.fromEntries(
		getAllCronJobNames().map((jobName) => {
			const definition = CRON_JOBS[jobName];
			const override = overridesByName.get(jobName);
			const defaultPreset = getPresetByPattern(definition.schedule);
			const effectivePattern = override?.pattern ?? definition.schedule;
			const effectivePreset = override
				? getPresetById(override.presetId)
				: getPresetByPattern(effectivePattern);

			return [
				jobName,
				{
					jobName,
					description: definition.description,
					defaultPattern: definition.schedule,
					defaultPresetId: defaultPreset?.id ?? null,
					effectivePattern,
					presetId: effectivePreset?.id ?? override?.presetId ?? null,
					presetLabel: effectivePreset?.label ?? null,
					isOverridden: Boolean(override && override.pattern !== definition.schedule),
					isHighRisk: isHighRiskCronJob(jobName),
					canEdit: defaultPreset !== null,
				},
			];
		}),
	) as Record<CronJobName, EffectiveCronSchedule>;
}

export function buildScheduledJobRows({
	overrides,
	repeatableJobs,
}: {
	overrides: CronScheduleOverrideLike[];
	repeatableJobs: RepeatableCronJobLike[];
}): ScheduledCronJobRow[] {
	const effectiveSchedules = resolveEffectiveCronSchedules({ overrides });
	const repeatableByName = new Map(repeatableJobs.map((job) => [job.name, job]));

	return getAllCronJobNames()
		.map((jobName) => {
			const schedule = effectiveSchedules[jobName];
			const repeatable = repeatableByName.get(jobName);

			return {
				...schedule,
				name: jobName,
				next: repeatable?.next ?? null,
				currentBullMqPattern: repeatable?.pattern ?? null,
				hasScheduleMismatch: Boolean(
				repeatable && repeatable.pattern !== schedule.effectivePattern,
				),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Export schedule helpers**

Modify `apps/webapp/src/lib/cron/index.ts`:

```ts
export * from "./registry";
export * from "./schedules";
export * from "./tracking";
```

- [ ] **Step 5: Run helper tests to verify they pass**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/schedules.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit pure helpers**

```bash
git add apps/webapp/src/lib/cron/index.ts apps/webapp/src/lib/cron/schedules.ts apps/webapp/src/lib/cron/schedules.test.ts
git commit -m "feat(cron): add schedule preset helpers"
```

## Task 3: Add Override Persistence Functions

**Files:**
- Create: `apps/webapp/src/lib/cron/schedule-overrides.ts`
- Create: `apps/webapp/src/lib/cron/schedule-overrides.test.ts`
- Modify: `apps/webapp/src/lib/cron/index.ts`

- [ ] **Step 1: Write failing persistence tests**

Create `apps/webapp/src/lib/cron/schedule-overrides.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
	deleteWhere: vi.fn(),
	from: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	orderBy: vi.fn(),
	returning: vi.fn(),
	select: vi.fn(),
	where: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: dbMocks.select,
		insert: vi.fn(() => ({
			values: dbMocks.insertValues,
		})),
		delete: vi.fn(() => ({
			where: dbMocks.deleteWhere,
		})),
	},
}));

import {
	deleteCronScheduleOverride,
	listCronScheduleOverrides,
	upsertCronScheduleOverride,
} from "./schedule-overrides";

describe("cron schedule override persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbMocks.select.mockReturnValue({ from: dbMocks.from });
		dbMocks.from.mockReturnValue({ orderBy: dbMocks.orderBy });
		dbMocks.orderBy.mockResolvedValue([]);
		dbMocks.insertValues.mockReturnValue({ onConflictDoUpdate: dbMocks.onConflictDoUpdate });
		dbMocks.onConflictDoUpdate.mockReturnValue({ returning: dbMocks.returning });
		dbMocks.returning.mockResolvedValue([{ jobName: "cron:export" }]);
		dbMocks.deleteWhere.mockResolvedValue(undefined);
	});

	it("lists overrides ordered by job name", async () => {
		await listCronScheduleOverrides();

		expect(dbMocks.select).toHaveBeenCalledTimes(1);
		expect(dbMocks.from).toHaveBeenCalledTimes(1);
		expect(dbMocks.orderBy).toHaveBeenCalledTimes(1);
	});

	it("upserts an override and returns the saved row", async () => {
		const result = await upsertCronScheduleOverride({
			jobName: "cron:export",
			presetId: "hourly",
			pattern: "0 * * * *",
			updatedBy: "admin-1",
		});

		expect(dbMocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				jobName: "cron:export",
				presetId: "hourly",
				pattern: "0 * * * *",
				updatedBy: "admin-1",
			}),
		);
		expect(dbMocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ jobName: "cron:export" });
	});

	it("deletes an override by job name", async () => {
		await deleteCronScheduleOverride("cron:export");

		expect(dbMocks.deleteWhere).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run persistence tests to verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/schedule-overrides.test.ts`

Expected: FAIL because `./schedule-overrides` does not exist.

- [ ] **Step 3: Implement persistence functions**

Create `apps/webapp/src/lib/cron/schedule-overrides.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cronScheduleOverride, type CronScheduleOverride } from "@/db/schema";
import type { CronJobName } from "./registry";

export async function listCronScheduleOverrides(): Promise<CronScheduleOverride[]> {
	return db.select().from(cronScheduleOverride).orderBy(cronScheduleOverride.jobName);
}

export async function upsertCronScheduleOverride(input: {
	jobName: CronJobName;
	presetId: string;
	pattern: string;
	updatedBy: string;
}): Promise<CronScheduleOverride> {
	const now = new Date();
	const [saved] = await db
		.insert(cronScheduleOverride)
		.values({
			jobName: input.jobName,
			presetId: input.presetId,
			pattern: input.pattern,
			updatedBy: input.updatedBy,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: cronScheduleOverride.jobName,
			set: {
				presetId: input.presetId,
				pattern: input.pattern,
				updatedBy: input.updatedBy,
				updatedAt: now,
			},
		})
		.returning();

	return saved;
}

export async function deleteCronScheduleOverride(jobName: CronJobName): Promise<void> {
	await db.delete(cronScheduleOverride).where(eq(cronScheduleOverride.jobName, jobName));
}
```

- [ ] **Step 4: Export persistence functions**

Modify `apps/webapp/src/lib/cron/index.ts`:

```ts
export * from "./registry";
export * from "./schedule-overrides";
export * from "./schedules";
export * from "./tracking";
```

- [ ] **Step 5: Run persistence tests to verify they pass**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/schedule-overrides.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit persistence functions**

```bash
git add apps/webapp/src/lib/cron/index.ts apps/webapp/src/lib/cron/schedule-overrides.ts apps/webapp/src/lib/cron/schedule-overrides.test.ts
git commit -m "feat(cron): persist schedule overrides"
```

## Task 4: Add BullMQ Reconciliation Helper And Worker Startup Integration

**Files:**
- Create: `apps/webapp/src/lib/cron/reconciliation.ts`
- Create: `apps/webapp/src/lib/cron/reconciliation.test.ts`
- Modify: `apps/webapp/src/lib/cron/index.ts`
- Modify: `apps/webapp/src/worker.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Create `apps/webapp/src/lib/cron/reconciliation.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { reconcileCronJobSchedule, reconcileCronSchedules } from "./reconciliation";

function queue(overrides?: {
	repeatables?: Array<{ name: string; pattern?: string; key?: string }>;
	removeRejects?: boolean;
	addRejects?: boolean;
}) {
	return {
		getRepeatableJobs: vi.fn().mockResolvedValue(
			overrides?.repeatables ?? [
				{ name: "cron:export", pattern: "*/5 * * * *", key: "repeat-key-export-old" },
			],
		),
		removeRepeatableByKey: vi.fn((key: string) => {
			if (overrides?.removeRejects) {
				return Promise.reject(new Error(`remove failed ${key}`));
			}
			return Promise.resolve();
		}),
		add: vi.fn(() => {
			if (overrides?.addRejects) {
				return Promise.reject(new Error("add failed"));
			}
			return Promise.resolve({ id: "job-1" });
		}),
	};
}

describe("cron schedule reconciliation", () => {
	it("removes stale repeatables and adds the effective schedule for one job", async () => {
		const fakeQueue = queue();

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(fakeQueue.removeRepeatableByKey).toHaveBeenCalledWith("repeat-key-export-old");
		expect(fakeQueue.add).toHaveBeenCalledWith(
			"cron:export",
			{ type: "cron:export", triggeredAt: expect.any(String) },
			expect.objectContaining({
				repeat: { pattern: "0 * * * *" },
				jobId: "cron-cron:export",
			}),
		);
		expect(result).toEqual({ success: true, removedCount: 1 });
	});

	it("reports a failed add without throwing", async () => {
		const fakeQueue = queue({ addRejects: true });

		const result = await reconcileCronJobSchedule({
			queue: fakeQueue as never,
			jobName: "cron:export",
			pattern: "0 * * * *",
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("add failed");
	});

	it("reconciles all provided schedules", async () => {
		const fakeQueue = queue({ repeatables: [] });

		const result = await reconcileCronSchedules({
			queue: fakeQueue as never,
			schedules: {
				"cron:export": { pattern: "*/5 * * * *" },
				"cron:vacation": { pattern: "0 0 * * *" },
			} as never,
		});

		expect(fakeQueue.add).toHaveBeenCalledTimes(2);
		expect(result.failed).toEqual([]);
	});
});
```

- [ ] **Step 2: Run reconciliation tests to verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/reconciliation.test.ts`

Expected: FAIL because `./reconciliation` does not exist.

- [ ] **Step 3: Implement reconciliation helper**

Create `apps/webapp/src/lib/cron/reconciliation.ts`:

```ts
import type { Queue } from "bullmq";
import { CRON_JOBS, type CronJobName } from "./registry";
import type { JobData, JobResult } from "@/lib/queue";

export interface ReconcileCronJobResult {
	success: boolean;
	removedCount: number;
	error?: string;
}

export async function reconcileCronJobSchedule({
	queue,
	jobName,
	pattern,
}: {
	queue: Queue<JobData, JobResult>;
	jobName: CronJobName;
	pattern: string;
}): Promise<ReconcileCronJobResult> {
	try {
		const repeatables = await queue.getRepeatableJobs();
		const staleRepeatables = repeatables.filter((job) => job.name === jobName);

		for (const repeatable of staleRepeatables) {
			if (repeatable.key) {
				await queue.removeRepeatableByKey(repeatable.key);
			}
		}

		await queue.add(
			jobName,
			{
				type: jobName,
				triggeredAt: new Date().toISOString(),
			},
			{
				repeat: { pattern },
				jobId: `cron-${jobName}`,
				removeOnComplete: { count: 50, age: 24 * 60 * 60 },
				removeOnFail: { count: 100, age: 7 * 24 * 60 * 60 },
				...CRON_JOBS[jobName].defaultJobOptions,
			},
		);

		return { success: true, removedCount: staleRepeatables.length };
	} catch (error) {
		return {
			success: false,
			removedCount: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function reconcileCronSchedules({
	queue,
	schedules,
}: {
	queue: Queue<JobData, JobResult>;
	schedules: Record<CronJobName, { pattern: string }>;
}) {
	const failed: Array<{ jobName: CronJobName; error: string }> = [];
	let reconciled = 0;

	for (const [jobName, schedule] of Object.entries(schedules) as Array<
		[CronJobName, { pattern: string }]
	>) {
		const result = await reconcileCronJobSchedule({ queue, jobName, pattern: schedule.pattern });
		if (result.success) {
			reconciled += 1;
		} else {
			failed.push({ jobName, error: result.error ?? "Unknown reconciliation error" });
		}
	}

	return { reconciled, failed };
}
```

- [ ] **Step 4: Export reconciliation helper**

Modify `apps/webapp/src/lib/cron/index.ts`:

```ts
export * from "./reconciliation";
export * from "./registry";
export * from "./schedule-overrides";
export * from "./schedules";
export * from "./tracking";
```

- [ ] **Step 5: Run reconciliation tests to verify they pass**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/reconciliation.test.ts`

Expected: PASS.

- [ ] **Step 6: Update worker startup to use effective schedules**

Modify imports in `apps/webapp/src/worker.ts`:

```ts
import {
	CRON_JOBS,
	type CronJobData,
	type CronJobName,
	isCronJobName,
	listCronScheduleOverrides,
	reconcileCronSchedules,
	resolveEffectiveCronSchedules,
} from "@/lib/cron";
```

Replace the body of `setupCronJobs(queue: Queue)` with:

```ts
async function setupCronJobs(queue: Queue): Promise<void> {
	const enableCron = env.ENABLE_CRON_JOBS !== "false";

	if (!enableCron) {
		logger.info("Cron jobs disabled via ENABLE_CRON_JOBS=false");
		return;
	}

	logger.info("Reconciling repeatable cron jobs from registry and schedule overrides...");

	const overrides = await listCronScheduleOverrides();
	const effectiveSchedules = resolveEffectiveCronSchedules({ overrides });
	const schedules = Object.fromEntries(
		Object.entries(effectiveSchedules).map(([jobName, schedule]) => [
			jobName,
			{ pattern: schedule.effectivePattern },
		]),
	) as Record<CronJobName, { pattern: string }>;

	const result = await reconcileCronSchedules({ queue: queue as never, schedules });

	if (result.failed.length > 0) {
		logger.error({ failed: result.failed }, "Some cron jobs failed to reconcile");
	}

	logger.info(
		{ reconciled: result.reconciled, failed: result.failed.length },
		"Cron job reconciliation complete",
	);
}
```

- [ ] **Step 7: Run worker-adjacent tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/cron/reconciliation.test.ts src/lib/cron/schedules.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit reconciliation task**

```bash
git add apps/webapp/src/lib/cron/index.ts apps/webapp/src/lib/cron/reconciliation.ts apps/webapp/src/lib/cron/reconciliation.test.ts apps/webapp/src/worker.ts
git commit -m "feat(cron): reconcile effective schedules"
```

## Task 5: Enrich Worker Queue Stats With Schedule Rows

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`

- [ ] **Step 1: Add failing action test for scheduled rows**

In `actions.test.ts`, extend hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
	getJobExecutionHistory: vi.fn(),
	listCronScheduleOverrides: vi.fn(),
	reconcileCronJobSchedule: vi.fn(),
	requirePlatformAdmin: vi.fn(),
}));
```

Add to the cron mock:

```ts
vi.mock("@/lib/cron/schedule-overrides", () => ({
	listCronScheduleOverrides: mocks.listCronScheduleOverrides,
}));
```

Add this test:

```ts
describe("getWorkerQueueStats schedule rows", () => {
	it("returns effective schedule rows with override and mismatch state", async () => {
		const { getWorkerQueueStats } = await import("./actions");
		const { getRecentExecutions, getAllJobMetrics, getExecutionsSince } = await import(
			"@/lib/cron/tracking"
		);
		const { getJobQueue, isQueueHealthy } = await import("@/lib/queue");

		vi.mocked(isQueueHealthy).mockResolvedValue(true);
		vi.mocked(getJobQueue).mockReturnValue({
			getJobCounts: vi.fn().mockResolvedValue({}),
			getRepeatableJobs: vi.fn().mockResolvedValue([
				{ name: "cron:export", pattern: "*/5 * * * *", next: Date.parse("2026-06-03T12:05:00.000Z") },
			]),
		} as never);
		vi.mocked(getRecentExecutions).mockResolvedValue([]);
		vi.mocked(getAllJobMetrics).mockResolvedValue([]);
		vi.mocked(getExecutionsSince).mockResolvedValue([]);
		mocks.listCronScheduleOverrides.mockResolvedValue([
			{ jobName: "cron:export", presetId: "hourly", pattern: "0 * * * *" },
		]);

		const result = await getWorkerQueueStats();

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		const exportRow = result.data.scheduledJobs.find((job) => job.name === "cron:export");
		expect(exportRow).toMatchObject({
			effectivePattern: "0 * * * *",
			isOverridden: true,
			hasScheduleMismatch: true,
		});
	});
});
```

- [ ] **Step 2: Run action test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'`

Expected: FAIL because `scheduledJobs` is not returned and overrides are not loaded.

- [ ] **Step 3: Enrich action return type and implementation**

Modify imports in `actions.ts`:

```ts
import { listCronScheduleOverrides } from "@/lib/cron/schedule-overrides";
import { buildScheduledJobRows, type ScheduledCronJobRow } from "@/lib/cron/schedules";
```

Update `WorkerQueueStats`:

```ts
export interface WorkerQueueStats {
	isConnected: boolean;
	counts: QueueCounts;
	repeatableJobs: RepeatableJob[];
	scheduledJobs: ScheduledCronJobRow[];
	availableJobNames: string[];
	recentExecutions: RecentExecution[];
	jobMetrics: JobMetric[];
	reliability: WorkerReliabilityData;
	fetchedAt: string;
}
```

After metrics are loaded and before `availableJobNames`, add:

```ts
const scheduleOverrides = yield* Effect.tryPromise({
	try: () => listCronScheduleOverrides(),
	catch: () =>
		new DatabaseError({
			message: "Failed to fetch cron schedule overrides",
			operation: "query",
			table: "cron_schedule_override",
		}),
});

const scheduledJobs = buildScheduledJobRows({
	overrides: scheduleOverrides,
	repeatableJobs,
}).filter((job) => isVisibleCronJobName(job.name));
```

Return `scheduledJobs` with the existing payload.

- [ ] **Step 4: Run action test to verify it passes**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit stats enrichment**

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'
git commit -m "feat(admin): expose cron schedule rows"
```

## Task 6: Add Schedule Update And Reset Server Actions

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts`

- [ ] **Step 1: Add failing mutation tests**

Add mocks to `actions.test.ts`:

```ts
const mocks = vi.hoisted(() => ({
	deleteCronScheduleOverride: vi.fn(),
	getJobExecutionHistory: vi.fn(),
	listCronScheduleOverrides: vi.fn(),
	logAction: vi.fn(),
	reconcileCronJobSchedule: vi.fn(),
	requirePlatformAdmin: vi.fn(),
	upsertCronScheduleOverride: vi.fn(),
}));
```

Mock persistence and reconciliation:

```ts
vi.mock("@/lib/cron/schedule-overrides", () => ({
	deleteCronScheduleOverride: mocks.deleteCronScheduleOverride,
	listCronScheduleOverrides: mocks.listCronScheduleOverrides,
	upsertCronScheduleOverride: mocks.upsertCronScheduleOverride,
}));

vi.mock("@/lib/cron/reconciliation", () => ({
	reconcileCronJobSchedule: mocks.reconcileCronJobSchedule,
}));
```

Ensure the mocked platform admin service includes `logAction`:

```ts
AppLayer: Layer.succeed(PlatformAdminService, {
	requirePlatformAdmin: mocks.requirePlatformAdmin,
	logAction: mocks.logAction,
} as never),
```

Add tests:

```ts
describe("cron schedule mutations", () => {
	beforeEach(() => {
		mocks.listCronScheduleOverrides.mockResolvedValue([]);
		mocks.upsertCronScheduleOverride.mockResolvedValue({ jobName: "cron:export" });
		mocks.deleteCronScheduleOverride.mockResolvedValue(undefined);
		mocks.reconcileCronJobSchedule.mockResolvedValue({ success: true, removedCount: 1 });
		mocks.logAction.mockReturnValue(Effect.succeed(undefined));
	});

	it("updates a low-risk schedule and logs the change", async () => {
		const { updateCronSchedule } = await import("./actions");
		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "hourly" });

		expect(result).toMatchObject({ success: true, data: { immediateReconciled: true } });
		expect(mocks.upsertCronScheduleOverride).toHaveBeenCalledWith({
			jobName: "cron:export",
			presetId: "hourly",
			pattern: "0 * * * *",
			updatedBy: "platform-admin-1",
		});
		expect(mocks.reconcileCronJobSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ jobName: "cron:export", pattern: "0 * * * *" }),
		);
		expect(mocks.logAction).toHaveBeenCalledWith(
			"platform-admin-1",
			"update_cron_schedule",
			"cron_job",
			"cron:export",
			expect.objectContaining({ newPattern: "0 * * * *" }),
		);
	});

	it("rejects hidden cron jobs", async () => {
		const { updateCronSchedule } = await import("./actions");
		const result = await updateCronSchedule({ jobName: "cron:telemetry", presetId: "hourly" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
	});

	it("requires high-risk confirmation", async () => {
		const { updateCronSchedule } = await import("./actions");
		const result = await updateCronSchedule({
			jobName: "cron:billing-seat-reconciliation",
			presetId: "hourly",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.upsertCronScheduleOverride).not.toHaveBeenCalled();
	});

	it("returns warning data when reconciliation fails after saving", async () => {
		const { updateCronSchedule } = await import("./actions");
		mocks.reconcileCronJobSchedule.mockResolvedValue({
			success: false,
			removedCount: 0,
			error: "Redis unavailable",
		});

		const result = await updateCronSchedule({ jobName: "cron:export", presetId: "hourly" });

		expect(result).toMatchObject({
			success: true,
			data: { immediateReconciled: false, warning: "Redis unavailable" },
		});
	});

	it("resets an override to the default schedule", async () => {
		const { resetCronSchedule } = await import("./actions");
		const result = await resetCronSchedule({ jobName: "cron:export" });

		expect(result).toMatchObject({ success: true, data: { immediateReconciled: true } });
		expect(mocks.deleteCronScheduleOverride).toHaveBeenCalledWith("cron:export");
		expect(mocks.reconcileCronJobSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ jobName: "cron:export", pattern: "*/5 * * * *" }),
		);
	});
});
```

- [ ] **Step 2: Run mutation tests to verify they fail**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'`

Expected: FAIL because `updateCronSchedule` and `resetCronSchedule` do not exist.

- [ ] **Step 3: Implement mutation actions**

Add imports in `actions.ts`:

```ts
import { getJobQueue } from "@/lib/queue";
import { CRON_JOBS, type CronJobName, isCronJobName } from "@/lib/cron/registry";
import {
	deleteCronScheduleOverride,
	listCronScheduleOverrides,
	upsertCronScheduleOverride,
} from "@/lib/cron/schedule-overrides";
import {
	getPresetById,
	isHighRiskCronJob,
} from "@/lib/cron/schedules";
import { reconcileCronJobSchedule } from "@/lib/cron/reconciliation";
```

Add types and validation helpers near the constants:

```ts
export interface CronScheduleMutationResult {
	immediateReconciled: boolean;
	warning: string | null;
}

export interface CronScheduleMutationInput {
	jobName: string;
	presetId?: string;
	confirmation?: string;
}

const HIGH_RISK_CONFIRMATION = "I understand the operational impact";

function validateEditableCronJob(jobName: string) {
	if (!isCronJobName(jobName) || !isVisibleCronJobName(jobName)) {
		return Effect.fail(
			new ValidationError({
				message: "Invalid cron job name",
				field: "jobName",
				value: jobName,
			}),
		);
	}

	return Effect.succeed(jobName);
}

function validateHighRiskConfirmation(jobName: CronJobName, confirmation?: string) {
	if (isHighRiskCronJob(jobName) && confirmation !== HIGH_RISK_CONFIRMATION) {
		return Effect.fail(
			new ValidationError({
				message: "High-risk cron schedule changes require confirmation",
				field: "confirmation",
				value: confirmation ?? "",
			}),
		);
	}

	return Effect.succeed(undefined);
}
```

Add actions at the end of the file:

```ts
export async function updateCronSchedule(
	input: CronScheduleMutationInput,
): Promise<ServerActionResult<CronScheduleMutationResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		const admin = yield* adminService.requirePlatformAdmin();
		const jobName = yield* validateEditableCronJob(input.jobName);
		yield* validateHighRiskConfirmation(jobName, input.confirmation);

		const preset = input.presetId ? getPresetById(input.presetId) : null;
		if (!preset) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Invalid cron schedule preset",
					field: "presetId",
					value: input.presetId ?? "",
				}),
			);
		}

		const defaultPattern = CRON_JOBS[jobName].schedule;
		if (preset.pattern === defaultPattern) {
			yield* Effect.tryPromise({
				try: () => deleteCronScheduleOverride(jobName),
				catch: () =>
					new DatabaseError({
						message: "Failed to delete cron schedule override",
						operation: "delete",
						table: "cron_schedule_override",
					}),
			});
		} else {
			yield* Effect.tryPromise({
				try: () =>
					upsertCronScheduleOverride({
						jobName,
						presetId: preset.id,
						pattern: preset.pattern,
						updatedBy: admin.userId,
					}),
				catch: () =>
					new DatabaseError({
						message: "Failed to save cron schedule override",
						operation: "upsert",
						table: "cron_schedule_override",
					}),
			});
		}

		const reconciliation = yield* Effect.tryPromise({
			try: () => reconcileCronJobSchedule({ queue: getJobQueue(), jobName, pattern: preset.pattern }),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		}).pipe(
			Effect.orElseSucceed((error) => ({
				success: false,
				removedCount: 0,
				error: error.message,
			})),
		);

		yield* adminService.logAction(admin.userId, "update_cron_schedule", "cron_job", jobName, {
			oldPattern: defaultPattern,
			newPattern: preset.pattern,
			presetId: preset.id,
			immediateReconciled: reconciliation.success,
			reconciliationError: reconciliation.error ?? null,
		});

		return {
			immediateReconciled: reconciliation.success,
			warning: reconciliation.success ? null : reconciliation.error ?? "Cron schedule saved but not reconciled",
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function resetCronSchedule(
	input: Pick<CronScheduleMutationInput, "jobName" | "confirmation">,
): Promise<ServerActionResult<CronScheduleMutationResult>> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		const admin = yield* adminService.requirePlatformAdmin();
		const jobName = yield* validateEditableCronJob(input.jobName);
		yield* validateHighRiskConfirmation(jobName, input.confirmation);

		yield* Effect.tryPromise({
			try: () => deleteCronScheduleOverride(jobName),
			catch: () =>
				new DatabaseError({
					message: "Failed to delete cron schedule override",
					operation: "delete",
					table: "cron_schedule_override",
				}),
		});

		const defaultPattern = CRON_JOBS[jobName].schedule;
		const reconciliation = yield* Effect.tryPromise({
			try: () => reconcileCronJobSchedule({ queue: getJobQueue(), jobName, pattern: defaultPattern }),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		}).pipe(
			Effect.orElseSucceed((error) => ({
				success: false,
				removedCount: 0,
				error: error.message,
			})),
		);

		yield* adminService.logAction(admin.userId, "reset_cron_schedule", "cron_job", jobName, {
			newPattern: defaultPattern,
			immediateReconciled: reconciliation.success,
			reconciliationError: reconciliation.error ?? null,
		});

		return {
			immediateReconciled: reconciliation.success,
			warning: reconciliation.success ? null : reconciliation.error ?? "Cron schedule reset but not reconciled",
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
```

- [ ] **Step 4: Run mutation tests to verify they pass**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit mutation actions**

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts'
git commit -m "feat(admin): add cron schedule actions"
```

## Task 7: Add Schedule Controls Client Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.tsx`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
	resetCronSchedule: vi.fn(),
	updateCronSchedule: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./actions", () => ({
	resetCronSchedule: actionMocks.resetCronSchedule,
	updateCronSchedule: actionMocks.updateCronSchedule,
}));

import { ScheduleControls } from "./schedule-controls";

const labels = {
	edit: "Edit",
	reset: "Reset",
	save: "Save schedule",
	cancel: "Cancel",
	presetLabel: "Schedule preset",
	highRiskTitle: "High-risk schedule",
	highRiskDescription: "Changing this job can affect operations.",
	confirmationLabel: "Type confirmation",
	confirmationText: "I understand the operational impact",
	saved: "Schedule saved",
	resetSaved: "Schedule reset",
	warningPrefix: "Saved with warning",
	failed: "Schedule change failed",
	mismatch: "BullMQ differs from saved schedule",
	readOnly: "No matching preset for this schedule",
};

const presets = [
	{ id: "every-5-minutes", label: "Every 5 minutes", pattern: "*/5 * * * *" },
	{ id: "hourly", label: "Hourly", pattern: "0 * * * *" },
];

const job = {
	name: "cron:export",
	description: "Process pending data exports",
	defaultPattern: "*/5 * * * *",
	defaultPresetId: "every-5-minutes",
	effectivePattern: "*/5 * * * *",
	presetId: "every-5-minutes",
	presetLabel: "Every 5 minutes",
	isOverridden: false,
	isHighRisk: false,
	canEdit: true,
	next: null,
	currentBullMqPattern: "*/5 * * * *",
	hasScheduleMismatch: false,
} as const;

describe("ScheduleControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actionMocks.updateCronSchedule.mockResolvedValue({
			success: true,
			data: { immediateReconciled: true, warning: null },
		});
		actionMocks.resetCronSchedule.mockResolvedValue({
			success: true,
			data: { immediateReconciled: true, warning: null },
		});
	});

	it("submits a selected preset", async () => {
		render(<ScheduleControls job={job} labels={labels} presets={presets} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Schedule preset"), { target: { value: "hourly" } });
		fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

		await waitFor(() =>
			expect(actionMocks.updateCronSchedule).toHaveBeenCalledWith({
				jobName: "cron:export",
				presetId: "hourly",
				confirmation: undefined,
			}),
		);
	});

	it("requires confirmation for high-risk jobs", async () => {
		render(
			<ScheduleControls
				job={{ ...job, name: "cron:billing-seat-reconciliation", isHighRisk: true }}
				labels={labels}
				presets={presets}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		expect(screen.getByText("High-risk schedule")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Type confirmation"), {
			target: { value: "I understand the operational impact" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

		await waitFor(() =>
			expect(actionMocks.updateCronSchedule).toHaveBeenCalledWith(
				expect.objectContaining({ confirmation: "I understand the operational impact" }),
			),
		);
	});

	it("disables editing when the row cannot be edited", () => {
		render(<ScheduleControls job={{ ...job, canEdit: false }} labels={labels} presets={presets} />);

		expect(screen.getByRole("button", { name: "Edit" })).toHaveProperty("disabled", true);
		expect(screen.getByText("No matching preset for this schedule")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx'`

Expected: FAIL because `schedule-controls.tsx` does not exist.

- [ ] **Step 3: Implement the client component**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CronSchedulePreset, ScheduledCronJobRow } from "@/lib/cron/schedules";
import { resetCronSchedule, updateCronSchedule } from "./actions";

interface ScheduleControlsLabels {
	edit: string;
	reset: string;
	save: string;
	cancel: string;
	presetLabel: string;
	highRiskTitle: string;
	highRiskDescription: string;
	confirmationLabel: string;
	confirmationText: string;
	saved: string;
	resetSaved: string;
	warningPrefix: string;
	failed: string;
	mismatch: string;
	readOnly: string;
}

interface ScheduleFormValues {
	presetId: string;
	confirmation: string;
}

export function ScheduleControls({
	job,
	labels,
	presets,
}: {
	job: ScheduledCronJobRow;
	labels: ScheduleControlsLabels;
	presets: CronSchedulePreset[];
}) {
	const router = useRouter();
	const [isEditing, setIsEditing] = useState(false);
	const [isPending, startTransition] = useTransition();
	const form = useForm({
		defaultValues: {
			presetId: job.presetId ?? job.defaultPresetId ?? presets[0]?.id ?? "",
			confirmation: "",
		} satisfies ScheduleFormValues,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await updateCronSchedule({
					jobName: job.name,
					presetId: value.presetId,
					confirmation: job.isHighRisk ? value.confirmation : undefined,
				});

				if (!result.success) {
					toast.error(result.error || labels.failed);
					return;
				}

				if (result.data.warning) {
					toast.warning(`${labels.warningPrefix}: ${result.data.warning}`);
				} else {
					toast.success(labels.saved);
				}
				setIsEditing(false);
				router.refresh();
			});
		},
	});

	function handleReset() {
		startTransition(async () => {
			const confirmation = job.isHighRisk ? window.prompt(labels.confirmationLabel) : undefined;
			const result = await resetCronSchedule({ jobName: job.name, confirmation });

			if (!result.success) {
				toast.error(result.error || labels.failed);
				return;
			}

			if (result.data.warning) {
				toast.warning(`${labels.warningPrefix}: ${result.data.warning}`);
			} else {
				toast.success(labels.resetSaved);
			}
			router.refresh();
		});
	}

	return (
		<div className="min-w-64 space-y-2">
			{job.hasScheduleMismatch && (
				<p className="text-xs text-yellow-700 dark:text-yellow-400">{labels.mismatch}</p>
			)}
			{!job.canEdit && <p className="text-xs text-muted-foreground">{labels.readOnly}</p>}

			{isEditing ? (
				<form
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="presetId">
						{(field) => (
							<label className="block space-y-1 text-sm">
								<span className="font-medium">{labels.presetLabel}</span>
								<select
									aria-label={labels.presetLabel}
									className="flex h-9 w-full rounded-md border border-input px-3 py-2 text-sm"
									disabled={isPending}
									onChange={(event) => field.handleChange(event.target.value)}
									value={field.state.value}
								>
									{presets.map((preset) => (
										<option key={preset.id} value={preset.id}>
											{preset.label} ({preset.pattern})
										</option>
									))}
								</select>
							</label>
						)}
					</form.Field>

					{job.isHighRisk && (
						<Alert>
							<AlertTitle>{labels.highRiskTitle}</AlertTitle>
							<AlertDescription className="space-y-2">
								<p>{labels.highRiskDescription}</p>
								<form.Field name="confirmation">
									{(field) => (
										<label className="block space-y-1 text-sm">
											<span>{labels.confirmationLabel}</span>
											<input
												aria-label={labels.confirmationLabel}
												className="flex h-9 w-full rounded-md border border-input px-3 py-2 text-sm"
												onChange={(event) => field.handleChange(event.target.value)}
												placeholder={labels.confirmationText}
												value={field.state.value}
											/>
										</label>
									)}
								</form.Field>
							</AlertDescription>
						</Alert>
					)}

					<div className="flex gap-2">
						<Button disabled={isPending} size="sm" type="submit">
							{labels.save}
						</Button>
						<Button disabled={isPending} onClick={() => setIsEditing(false)} size="sm" type="button" variant="outline">
							{labels.cancel}
						</Button>
					</div>
				</form>
			) : (
				<div className="flex gap-2">
					<Button disabled={!job.canEdit || isPending} onClick={() => setIsEditing(true)} size="sm" type="button" variant="outline">
						{labels.edit}
					</Button>
					<Button disabled={!job.isOverridden || isPending} onClick={handleReset} size="sm" type="button" variant="outline">
						{labels.reset}
					</Button>
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Run component tests to verify they pass**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit schedule controls**

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx'
git commit -m "feat(admin): add cron schedule controls"
```

## Task 8: Render Schedule Editing On Worker Queue Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx`

- [ ] **Step 1: Update imports**

Add imports to `page.tsx`:

```ts
import { CRON_SCHEDULE_PRESETS } from "@/lib/cron/schedules";
import { ScheduleControls } from "./schedule-controls";
```

- [ ] **Step 2: Add labels for schedule controls**

Inside `WorkerQueueContent`, after `recentExecutionsLabels`, add:

```ts
const scheduleControlLabels = {
	edit: t("settings.workerQueue.schedule.edit", "Edit"),
	reset: t("settings.workerQueue.schedule.reset", "Reset"),
	save: t("settings.workerQueue.schedule.save", "Save schedule"),
	cancel: t("settings.workerQueue.schedule.cancel", "Cancel"),
	presetLabel: t("settings.workerQueue.schedule.presetLabel", "Schedule preset"),
	highRiskTitle: t("settings.workerQueue.schedule.highRiskTitle", "High-risk schedule"),
	highRiskDescription: t(
		"settings.workerQueue.schedule.highRiskDescription",
		"Changing this job can affect billing, cleanup, integrations, compliance, or operational automation.",
	),
	confirmationLabel: t("settings.workerQueue.schedule.confirmationLabel", "Type confirmation"),
	confirmationText: "I understand the operational impact",
	saved: t("settings.workerQueue.schedule.saved", "Schedule saved"),
	resetSaved: t("settings.workerQueue.schedule.resetSaved", "Schedule reset"),
	warningPrefix: t("settings.workerQueue.schedule.warningPrefix", "Saved with warning"),
	failed: t("settings.workerQueue.schedule.failed", "Schedule change failed"),
	mismatch: t(
		"settings.workerQueue.schedule.mismatch",
		"BullMQ currently differs from the saved schedule; worker startup will reconcile it.",
	),
	readOnly: t(
		"settings.workerQueue.schedule.readOnly",
		"This default schedule has no editable preset yet.",
	),
};
```

- [ ] **Step 3: Replace scheduled jobs table source and columns**

In the scheduled jobs section, replace `stats.repeatableJobs.length` with `stats.scheduledJobs.length`, and replace the table header with:

```tsx
<TableRow>
	<TableHead>{t("settings.workerQueue.table.jobName", "Job Name")}</TableHead>
	<TableHead>{t("settings.workerQueue.table.schedule", "Schedule")}</TableHead>
	<TableHead>{t("settings.workerQueue.table.defaultSchedule", "Default")}</TableHead>
	<TableHead>{t("settings.workerQueue.table.nextRun", "Next Run")}</TableHead>
	<TableHead>{t("settings.workerQueue.table.actions", "Actions")}</TableHead>
</TableRow>
```

Replace row rendering with:

```tsx
{stats.scheduledJobs.map((job) => (
	<TableRow key={job.name}>
		<TableCell className="font-mono text-sm">
			<div>{job.name}</div>
			<p className="text-muted-foreground text-xs">{job.description}</p>
		</TableCell>
		<TableCell className="text-sm">
			<div>{job.presetLabel ?? unknownLabel}</div>
			<code className="text-xs text-muted-foreground">{job.effectivePattern}</code>
			{job.isOverridden && (
				<Badge className="ml-2" variant="outline">
					{t("settings.workerQueue.schedule.overridden", "Overridden")}
				</Badge>
			)}
		</TableCell>
		<TableCell className="text-sm">
			<code className="text-xs text-muted-foreground">{job.defaultPattern}</code>
		</TableCell>
		<TableCell>{formatDateTime(job.next, locale)}</TableCell>
		<TableCell>
			<ScheduleControls
				job={job}
				labels={scheduleControlLabels}
				presets={[...CRON_SCHEDULE_PRESETS]}
			/>
		</TableCell>
	</TableRow>
))}
```

- [ ] **Step 4: Run page-related tests**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit page rendering**

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx'
git commit -m "feat(admin): render editable cron schedules"
```

## Task 9: Update Documentation And Run Focused Checks

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`

- [ ] **Step 1: Update platform admin guide**

Find the worker queue/platform admin section in `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx` and add this paragraph near the worker queue description:

```mdx
Platform admins can edit visible worker cron schedules from the worker queue page using approved presets, or reset a job back to its code-defined default. Schedule changes are saved durably, audited, and applied to BullMQ immediately when the queue is reachable; worker startup reconciles saved schedules again if immediate queue reconciliation was unavailable.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp vitest run src/lib/cron/schedules.test.ts src/lib/cron/schedule-overrides.test.ts src/lib/cron/reconciliation.test.ts 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx' src/db/schema/__tests__/cron-schedule-override-schema.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run lint/format check for touched code**

Run:

```bash
pnpm --dir apps/webapp exec biome check src/lib/cron/schedules.ts src/lib/cron/schedules.test.ts src/lib/cron/schedule-overrides.ts src/lib/cron/schedule-overrides.test.ts src/lib/cron/reconciliation.ts src/lib/cron/reconciliation.test.ts src/lib/cron/index.ts src/worker.ts 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx' 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.tsx' 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx' src/db/schema/cron-job.ts src/db/schema/__tests__/cron-schedule-override-schema.test.ts
```

Expected: PASS. If Biome reports formatting diffs, run the same command with `--write`, inspect the diff, and rerun the check command until it passes.

- [ ] **Step 4: Run final git diff review**

Run: `git diff --stat`

Expected: only files listed in this plan are changed. Do not revert unrelated user or peer-agent changes.

- [ ] **Step 5: Commit documentation and verification fixes**

```bash
git add apps/docs/content/docs/guide/admin-guide/platform-admin.mdx
git commit -m "docs(admin): document cron schedule editing"
```

## Task 10: Final Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run all cron and worker queue tests**

Run:

```bash
pnpm --dir apps/webapp vitest run src/lib/cron/schedules.test.ts src/lib/cron/schedule-overrides.test.ts src/lib/cron/reconciliation.test.ts src/lib/cron/registry.test.ts 'src/app/[locale]/(admin)/platform-admin/worker-queue/actions.test.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability.test.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/reliability-charts.test.ts' 'src/app/[locale]/(admin)/platform-admin/worker-queue/recent-executions.test.tsx' 'src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.test.tsx' src/db/schema/__tests__/cron-schedule-override-schema.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run app type/build check**

Run: `CI=true pnpm --dir apps/webapp build`

Expected: PASS. If this command requires unavailable environment variables, record the exact missing variable error and do not claim the build passed.

- [ ] **Step 3: Inspect status before handoff**

Run: `git status --short`

Expected: no unintended unstaged changes from this implementation. Unrelated pre-existing changes may remain and must be left untouched.
