/**
 * PostgreSQL contract (#988): a run acts on behalf of the schedule owner, not the creator,
 * and writes one audit entry attributed to the owner. A due schedule whose owner is no
 * longer an org admin pauses instead of running.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { ExecuteParams } from "./executors/base-executor";

const runs = vi.hoisted(() => ({ executed: [] as ExecuteParams[] }));

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);

// The executors' and the delivery's own suites cover the file and the email; this
// suite is about whom a run acts for and what it records.
vi.mock("./executors/registry", () => ({
	executorRegistry: {
		get: () => ({
			reportType: "payroll_export",
			displayName: "Payroll",
			validateConfig: () => ({ valid: true }),
			execute: async (params: ExecuteParams) => {
				runs.executed.push(params);
				return { success: true, s3Key: "org/run.csv", recordCount: 3 };
			},
		}),
	},
}));
vi.mock("../infrastructure/delivery-service", () => ({
	DeliveryService: class {
		async deliver() {
			return {
				s3Key: "org/run.csv",
				emailsSent: 1,
				emailsFailed: 1,
				emailErrors: [
					{ recipient: "hr@example.com", error: "mailbox full", timestamp: "2026-10-11T08:00:00Z" },
				],
			};
		}
	},
}));

const { ScheduledExportOrchestrator } = await import("./orchestrator");

describe("scheduled export runs", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		runs.executed = [];
	});

	async function seedSchedule(input: {
		organizationId: string;
		ownerId: string;
		createdBy: string;
		nextExecutionAt?: Date;
	}) {
		const { rows } = await fixture.pool.query(
			`insert into scheduled_export
			 (organization_id, name, schedule_type, report_type, report_config, date_range_strategy,
				delivery_method, email_recipients, owner_id, created_by, next_execution_at, updated_at)
			 values ($1, 'Monthly payroll', 'monthly', 'payroll_export', '{"formatId":"datev_lohn"}',
				'previous_month', 'email_only', $2, $3, $4, $5, now())
			 returning *`,
			[
				input.organizationId,
				["tax@example.com", "hr@example.com"],
				input.ownerId,
				input.createdBy,
				input.nextExecutionAt ?? new Date("2026-10-01T00:00:00Z"),
			],
		);
		const { db } = await import("@/db");
		const { scheduledExport } = await import("@/db/schema");
		const { eq } = await import("drizzle-orm");
		const [schedule] = await db
			.select()
			.from(scheduledExport)
			.where(eq(scheduledExport.id, rows[0].id));
		if (!schedule) throw new Error("The seeded schedule is missing");
		return schedule;
	}

	async function auditFor(scheduleId: string) {
		const { rows } = await fixture.pool.query<{
			action: string;
			performed_by: string;
			metadata: string | null;
		}>(
			`select action, performed_by, metadata from audit_log
			 where entity_type = 'scheduled_export' and entity_id = $1 order by timestamp`,
			[scheduleId],
		);
		return rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	it("runs on behalf of the owner and attributes its delivery entry to the owner", async () => {
		const organizationId = await fixture.createOrganization();
		const creator = await fixture.seedEmployee({ organizationId, role: "admin" });
		const owner = await fixture.seedEmployee({ organizationId, role: "admin" });
		const schedule = await seedSchedule({
			organizationId,
			ownerId: owner.userId,
			createdBy: creator.userId,
		});

		await new ScheduledExportOrchestrator().executeSchedule(
			schedule,
			DateTime.fromISO("2026-10-11T08:00:00Z", { zone: "utc" }),
		);

		expect(runs.executed.map((params) => params.ownerId)).toEqual([owner.userId]);
		const entries = await auditFor(schedule.id);
		expect(entries).toEqual([
			{
				action: "scheduled_export.delivered",
				performedBy: owner.userId,
				metadata: expect.objectContaining({
					trigger: "schedule",
					requestedBy: null,
					fileStored: true,
					recipients: ["tax@example.com", "hr@example.com"],
					failedRecipients: ["hr@example.com"],
					skippedRecipients: [],
				}),
			},
		]);
		const executionId = entries[0]?.metadata.executionId;
		const { rows } = await fixture.pool.query(
			"select status, emails_sent, emails_failed from scheduled_export_execution where id = $1",
			[executionId],
		);
		expect(rows).toEqual([{ status: "completed", emails_sent: 1, emails_failed: 1 }]);
	});

	it("records who asked for a run-now, still acting for the owner", async () => {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "admin" });
		const requester = await fixture.seedEmployee({ organizationId, role: "admin" });
		const schedule = await seedSchedule({
			organizationId,
			ownerId: owner.userId,
			createdBy: owner.userId,
		});

		await new ScheduledExportOrchestrator().executeSchedule(
			schedule,
			DateTime.fromISO("2026-10-11T08:00:00Z", { zone: "utc" }),
			{ trigger: "run_now", requestedBy: requester.userId },
		);

		expect(runs.executed.map((params) => params.ownerId)).toEqual([owner.userId]);
		expect(await auditFor(schedule.id)).toEqual([
			expect.objectContaining({
				action: "scheduled_export.delivered",
				performedBy: owner.userId,
				metadata: expect.objectContaining({ trigger: "run_now", requestedBy: requester.userId }),
			}),
		]);
	});

	it("pauses a due schedule whose owner is no longer an org admin instead of running it", async () => {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "admin" });
		const schedule = await seedSchedule({
			organizationId,
			ownerId: owner.userId,
			createdBy: owner.userId,
		});
		await fixture.pool.query("update member set role = 'member' where id = $1", [owner.memberId]);

		await new ScheduledExportOrchestrator().processDueExports();

		expect(runs.executed.filter((params) => params.organizationId === organizationId)).toEqual([]);
		expect(await auditFor(schedule.id)).toEqual([
			expect.objectContaining({ action: "scheduled_export.paused", performedBy: owner.userId }),
		]);
		const { rows } = await fixture.pool.query(
			"select is_active from scheduled_export where id = $1",
			[schedule.id],
		);
		expect(rows).toEqual([{ is_active: false }]);
	});
});
