import type { Job } from "bullmq";
import type { ImportCommitJobData } from "@/lib/import-review/types";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: {
					id: session.userId,
					role: "user",
					email: "reconciliation@test.invalid",
				},
				session: {
					id: session.userId,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
const { previewPreviouslyTakenVacation, commitPreviouslyTakenVacation } =
	await import(
		"@/app/[locale]/(app)/settings/vacation/historical-usage-actions"
	);
const { previewHistoricalVacationReconciliation } = await import(
	"@/app/[locale]/(app)/settings/vacation/reconciliation-actions"
);
const { recordAbsenceForEmployee } = await import(
	"@/app/[locale]/(app)/team/absences/actions"
);
const { getVacationBalance, getAbsenceEntries } = await import(
	"@/app/[locale]/(app)/absences/queries"
);
describe("reviewed historical vacation reconciliation", () => {
	vi.setConfig({ testTimeout: 90000, hookTimeout: 90000 });
	let fixture: LifecycleDatabaseFixture, employeeId: string, categoryId: string;
	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
		employeeId = (
			await fixture.seedEmployee({
				withPeriod: false,
				startDate: new Date("2020-01-01T00:00:00Z"),
			})
		).employeeId;
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-21',now())`,
			[fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into vacation_allowance (organization_id,name,start_date,is_company_default,default_annual_days,statutory_minimum_days,accrual_type,created_by,updated_at) values ($1,'Annual30','2026-01-01',true,30,20,'annual',$2,now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id,organization_id,name,type,counts_against_vacation,requires_approval,updated_at) values ($1,$2,'Vacation','vacation',true,false,now())`,
			[categoryId, fixture.organizationId],
		);
		const input = {
			organizationId: fixture.organizationId,
			employeeId,
			year: 2026,
			days: 8,
			reason: "Reviewed old payroll",
		};
		const preview = await previewPreviouslyTakenVacation(input);
		if (!preview.success) throw new Error(preview.error);
		expect(
			(
				await commitPreviouslyTakenVacation({
					...input,
					fingerprint: preview.data.fingerprint,
				})
			).success,
		).toBe(true);
	});
	afterAll(async () => {
		await fixture?.pool.query(
			`delete from vacation_adjustment where employee_id in (select id from employee where organization_id=$1)`,
			[fixture.organizationId],
		);
		await fixture?.close();
		vi.useRealTimers();
	});
	it("replaces three of eight aggregate days with explicitly supplied dated history and keeps the balance fixed", async () => {
		const absence = {
			employeeId,
			categoryId,
			startDate: "2026-05-18",
			endDate: "2026-05-20",
			startPeriod: "full_day" as const,
			endPeriod: "full_day" as const,
		};
		const preview = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [{ employeeId, year: 2026, remainingDays: 5 }],
			reason: "Three days located in payroll history",
		});
		expect(preview.success).toBe(true);
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.balances).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employeeId,
					year: 2026,
					before: expect.objectContaining({ remainingDays: 22 }),
					after: expect.objectContaining({
						previouslyTakenDays: 5,
						usedDays: 8,
						remainingDays: 22,
					}),
				}),
			]),
		);
		const result = await recordAbsenceForEmployee({
			...absence,
			historicalReconciliation: {
				operationId: preview.data.operationId,
				fingerprint: preview.data.fingerprint,
			},
		});
		expect(result.success).toBe(true);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 30,
			previouslyTakenDays: 5,
			usedDays: 8,
			remainingDays: 22,
		});
		expect(
			await getAbsenceEntries(employeeId, "2026-05-01", "2026-05-31"),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					startDate: "2026-05-18",
					endDate: "2026-05-20",
				}),
			]),
		);
	});
	it("commits an explicitly mapped import group once, including the remaining total and source receipts", async () => {
		const batchId = randomUUID(),
			rowId = randomUUID(),
			jobId = randomUUID();
		await fixture.pool.query(
			`insert into import_batch(id,organization_id,provider,status,selected_scope,date_range,started_by) values($1,$2,'clockodo','needs_review','{}','{}',$3)`,
			[batchId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into import_batch_job(id,batch_id,organization_id,kind,entity_type,partition_key) values($1,$2,$3,'commit','absence','commit:absence')`,
			[jobId, batchId, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into import_staged_row(id,batch_id,organization_id,entity_type,provider_source_id,source_payload_hash,source_payload,normalized_payload,row_status) values($1,$2,$3,'absence','provider-A','hash-A','{}',$4,'accepted')`,
			[
				rowId,
				batchId,
				fixture.organizationId,
				JSON.stringify({
					employeeId,
					startsAt: "2026-05-11T00:00:00Z",
					endsAt: "2026-05-12T23:59:59Z",
					absenceCategoryId: 99,
				}),
			],
		);
		const preview = await previewHistoricalVacationReconciliation({
			kind: "import",
			batchId,
			mappings: [
				{ rowId, categoryId, startPeriod: "full_day", endPeriod: "full_day" },
			],
			decisions: [{ employeeId, year: 2026, remainingDays: 3 }],
			reason: "Two provider days replace the aggregate",
		});
		expect(preview.success).toBe(true);
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.blockers).toEqual([]);
		const { processImportReviewJob } = await import(
			"@/lib/import-review/worker"
		);
		const job = {
			type: "import-review-commit" as const,
			batchId,
			jobId,
			organizationId: fixture.organizationId,
			entityType: "absence" as const,
			committedBy: fixture.ownerUserId,
			historicalReconciliation: {
				operationId: preview.data.operationId,
				fingerprint: preview.data.fingerprint,
			},
		};
		const queued = {
			data: job,
			opts: { attempts: 1 },
			attemptsMade: 0,
		} as Job<ImportCommitJobData>;
		expect(await processImportReviewJob(queued)).toMatchObject({
			success: true,
			data: { committedRows: 1 },
		});
		expect(await processImportReviewJob(queued)).toMatchObject({
			success: true,
			data: { committedRows: 1 },
		});
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 3,
			usedDays: 8,
			remainingDays: 22,
		});
		expect(
			(
				await fixture.pool.query(
					`select commit_target_id from import_staged_row where id=$1`,
					[rowId],
				)
			).rows[0].commit_target_id,
		).toBeTruthy();
	});

	it("keeps an approved date-change reconciliation pending until another authorized approver applies both parts", async () => {
		const person = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		const input = {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
			year: 2026,
			days: 3,
			reason: "Payroll opening total",
		};
		const opening = await previewPreviouslyTakenVacation(input);
		if (!opening.success) throw new Error(opening.error);
		expect(
			(
				await commitPreviouslyTakenVacation({
					...input,
					fingerprint: opening.data.fingerprint,
				})
			).success,
		).toBe(true);
		const recorded = await recordAbsenceForEmployee({
			employeeId: person.employeeId,
			categoryId,
			startDate: "2026-05-25",
			endDate: "2026-05-26",
			startPeriod: "full_day",
			endPeriod: "full_day",
		});
		if (!recorded.success) throw new Error(recorded.error);
		await fixture.pool.query(
			`insert into employee_managers(id,employee_id,manager_id,is_primary,assigned_by) values($1,$2,$3,true,$4)`,
			[
				randomUUID(),
				person.employeeId,
				fixture.ownerEmployeeId,
				fixture.ownerUserId,
			],
		);
		session.userId = person.userId;
		const proposed = {
			startDate: "2026-05-04",
			endDate: "2026-05-05",
			startPeriod: "full_day" as const,
			endPeriod: "full_day" as const,
		};
		const preview = await previewHistoricalVacationReconciliation({
			kind: "change",
			absenceId: recorded.data.absenceId,
			proposed,
			coverage: "choose",
			decisions: [
				{ employeeId: person.employeeId, year: 2026, remainingDays: 1 },
			],
			reason: "The approved dates belong to old payroll history",
		});
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.blockers).toEqual([]);
		const { submitAbsenceChangeAction } = await import(
			"@/app/[locale]/(app)/absences/change-actions"
		);
		const submitted = await submitAbsenceChangeAction({
			kind: "change",
			absenceId: recorded.data.absenceId,
			proposed,
			coverage: "choose",
			reason: "Correct payroll dates",
			historicalReconciliation: {
				operationId: preview.data.operationId,
				fingerprint: preview.data.fingerprint,
			},
		});
		if (!submitted.success) throw new Error(submitted.error);
		expect(submitted.success).toBe(true);
		expect(await getVacationBalance(person.employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 3,
		});
		session.userId = fixture.ownerUserId;
		const assignment = await fixture.pool.query(
			`select id from approval_stage_assignment where workflow_id=$1 and status='pending'`,
			[submitted.data.workflowId],
		);
		const { decideAbsenceChange } = await import("./change-request-service");
		await decideAbsenceChange({
			organizationId: fixture.organizationId,
			actorEmployeeId: fixture.ownerEmployeeId,
			assignmentId: assignment.rows[0].id,
			action: "approve",
		});
		expect(await getVacationBalance(person.employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 1,
			usedDays: 3,
			remainingDays: 27,
		});
		session.userId = person.userId;
		const moved = await previewHistoricalVacationReconciliation({
			kind: "change",
			absenceId: recorded.data.absenceId,
			proposed: { ...proposed, startDate: "2026-05-06", endDate: "2026-05-07" },
			coverage: "choose",
			decisions: [
				{ employeeId: person.employeeId, year: 2026, remainingDays: 0 },
			],
			reason:
				"Different historical payroll dates replace the remaining aggregate",
		});
		if (!moved.success) throw new Error(moved.error);
		expect(moved.data.blockers).toEqual([]);
		expect(moved.data.totals[0]?.datedDays).toBe(2);
		session.userId = fixture.ownerUserId;
	});

	it("refuses a changed proposal or stale total without partially recording it", async () => {
		session.userId = fixture.ownerUserId;
		const absence = {
			employeeId,
			categoryId,
			startDate: "2026-04-20",
			endDate: "2026-04-21",
			startPeriod: "full_day" as const,
			endPeriod: "full_day" as const,
		};
		const preview = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [{ employeeId, year: 2026, remainingDays: 1 }],
			reason: "Review current payroll",
		});
		if (!preview.success) throw new Error(preview.error);
		const proof = {
			operationId: preview.data.operationId,
			fingerprint: preview.data.fingerprint,
		};
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					endDate: "2026-04-22",
					historicalReconciliation: proof,
				})
			).success,
		).toBe(false);
		await fixture.pool.query(
			`update vacation_adjustment set revision=revision+1 where employee_id=$1 and kind='historical_usage'`,
			[employeeId],
		);
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					historicalReconciliation: proof,
				})
			).success,
		).toBe(false);
		expect(
			await getAbsenceEntries(employeeId, "2026-04-20", "2026-04-22"),
		).toEqual([]);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 3,
		});
	});
	it("serializes competing half-day reconciliations and replays the winning receipt without another deduction", async () => {
		const plans = await Promise.all(
			["2026-04-16", "2026-04-17"].map(async (date) => {
				const absence = {
					employeeId,
					categoryId,
					startDate: date,
					endDate: date,
					startPeriod: "am" as const,
					endPeriod: "am" as const,
				};
				const preview = await previewHistoricalVacationReconciliation({
					kind: "manual",
					absence,
					decisions: [{ employeeId, year: 2026, remainingDays: 2.5 }],
					reason: "Located a payroll half day",
				});
				if (!preview.success) throw new Error(preview.error);
				return {
					...absence,
					historicalReconciliation: {
						operationId: preview.data.operationId,
						fingerprint: preview.data.fingerprint,
					},
				};
			}),
		);
		const results = await Promise.all(
			plans.map((input) => recordAbsenceForEmployee(input)),
		);
		expect(results.filter((result) => result.success)).toHaveLength(1);
		const winner = results.findIndex((result) => result.success);
		expect(await recordAbsenceForEmployee(plans[winner]!)).toEqual(
			results[winner],
		);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 2.5,
			usedDays: 8,
			remainingDays: 22,
		});
	});
	it("rolls a total reduction back when the normal writer refuses the deputy", async () => {
		const absence = {
			employeeId,
			categoryId,
			startDate: "2026-04-13",
			endDate: "2026-04-13",
			startPeriod: "am" as const,
			endPeriod: "am" as const,
			deputyEmployeeId: randomUUID(),
		};
		const preview = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [{ employeeId, year: 2026, remainingDays: 2 }],
			reason: "Reviewed half day",
		});
		if (!preview.success) throw new Error(preview.error);
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					historicalReconciliation: {
						operationId: preview.data.operationId,
						fingerprint: preview.data.fingerprint,
					},
				})
			).success,
		).toBe(false);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 2.5,
		});
		expect(
			await getAbsenceEntries(employeeId, "2026-04-13", "2026-04-13"),
		).toEqual([]);
	});

	it("refuses cross-organization category mapping and lost recorder authority", async () => {
		const absence = {
			employeeId,
			categoryId,
			startDate: "2026-04-06",
			endDate: "2026-04-07",
			startPeriod: "full_day" as const,
			endPeriod: "full_day" as const,
		};
		const otherOrg = await fixture.createOrganization(),
			otherCategory = randomUUID();
		await fixture.pool.query(
			`insert into absence_category(id,organization_id,name,type,counts_against_vacation,updated_at) values($1,$2,'Other','vacation',true,now())`,
			[otherCategory, otherOrg],
		);
		expect(
			(
				await previewHistoricalVacationReconciliation({
					kind: "manual",
					absence: { ...absence, categoryId: otherCategory },
					decisions: [],
					reason: "Invalid mapping",
				})
			).success,
		).toBe(false);
		const preview = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [{ employeeId, year: 2026, remainingDays: 0.5 }],
			reason: "Current reviewed permission",
		});
		if (!preview.success) throw new Error(preview.error);
		await fixture.pool.query(
			`update employee set role='employee' where id=$1`,
			[fixture.ownerEmployeeId],
		);
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					historicalReconciliation: {
						operationId: preview.data.operationId,
						fingerprint: preview.data.fingerprint,
					},
				})
			).success,
		).toBe(false);
		await fixture.pool.query(`update employee set role='admin' where id=$1`, [
			fixture.ownerEmployeeId,
		]);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 2.5,
		});
	});
	it("refuses a newly closed month and preserves every part of the reviewed operation", async () => {
		const absence = {
			employeeId,
			categoryId,
			startDate: "2026-03-16",
			endDate: "2026-03-17",
			startPeriod: "full_day" as const,
			endPeriod: "full_day" as const,
		};
		const preview = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [{ employeeId, year: 2026, remainingDays: 0.5 }],
			reason: "Review before closure",
		});
		if (!preview.success) throw new Error(preview.error);
		const { closeMonth, reopenMonth } = await import(
			"@/lib/time-tracking/closed-months/store"
		);
		const { parseInstant } = await import("@/lib/datetime/temporal-core");
		const close = {
			organizationId: fixture.organizationId,
			month: "2026-03",
			scope: { kind: "organization" as const },
			actor: { kind: "user" as const, userId: fixture.ownerUserId },
			now: parseInstant("2026-10-15T00:00:00Z"),
		};
		expect((await closeMonth(fixture.db, close)).kind).toBe("closed");
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					historicalReconciliation: {
						operationId: preview.data.operationId,
						fingerprint: preview.data.fingerprint,
					},
				})
			).success,
		).toBe(false);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 2.5,
		});
		expect(
			await getAbsenceEntries(employeeId, "2026-03-16", "2026-03-17"),
		).toEqual([]);
		await reopenMonth(fixture.db, {
			organizationId: fixture.organizationId,
			month: "2026-03",
			scope: { kind: "all" },
			actorUserId: fixture.ownerUserId,
			reason: "Test cleanup",
		});
	});
	it("rolls back an entire import group on a persistence failure, then retries its original receipt safely", async () => {
		const batchId = randomUUID(),
			jobId = randomUUID(),
			rowIds = [randomUUID(), randomUUID()];
		await fixture.pool.query(
			`insert into import_batch(id,organization_id,provider,status,selected_scope,date_range,started_by) values($1,$2,'clockodo','needs_review','{}','{}',$3)`,
			[batchId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into import_batch_job(id,batch_id,organization_id,kind,entity_type,partition_key) values($1,$2,$3,'commit','absence','commit:absence')`,
			[jobId, batchId, fixture.organizationId],
		);
		for (let index = 0; index < 2; index++)
			await fixture.pool.query(
				`insert into import_staged_row(id,batch_id,organization_id,entity_type,provider_source_id,source_payload_hash,source_payload,normalized_payload,row_status) values($1,$2,$3,'absence',$4,$4,'{}',$5,'accepted')`,
				[
					rowIds[index],
					batchId,
					fixture.organizationId,
					`rollback-${index}`,
					JSON.stringify({
						employeeId,
						startsAt: `2026-04-0${index + 2}T00:00:00Z`,
						endsAt: `2026-04-0${index + 2}T23:59:59Z`,
						note: index ? "FAIL_RECONCILIATION" : "First group row",
					}),
				],
			);
		const preview = await previewHistoricalVacationReconciliation({
			kind: "import",
			batchId,
			mappings: rowIds.map((rowId) => ({
				rowId,
				categoryId,
				startPeriod: "full_day",
				endPeriod: "full_day",
			})),
			decisions: [{ employeeId, year: 2026, remainingDays: 0.5 }],
			reason: "Two payroll dates in one atomic batch",
		});
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.blockers).toEqual([]);
		const { processImportReviewJob } = await import(
			"@/lib/import-review/worker"
		);
		const job = {
			data: {
				type: "import-review-commit",
				batchId,
				jobId,
				organizationId: fixture.organizationId,
				entityType: "absence",
				committedBy: fixture.ownerUserId,
				historicalReconciliation: {
					operationId: preview.data.operationId,
					fingerprint: preview.data.fingerprint,
				},
			},
			opts: { attempts: 1 },
			attemptsMade: 0,
		} as Job<ImportCommitJobData>;
		await fixture.pool.query(
			`alter table absence_entry add constraint reconciliation_test_failure check(notes is distinct from 'FAIL_RECONCILIATION')`,
		);
		try {
			await expect(processImportReviewJob(job)).rejects.toThrow();
		} finally {
			await fixture.pool.query(
				`alter table absence_entry drop constraint reconciliation_test_failure`,
			);
		}
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 2.5,
		});
		expect(
			await getAbsenceEntries(employeeId, "2026-04-02", "2026-04-03"),
		).toEqual([]);
		expect(
			(
				await fixture.pool.query(
					`select row_status,commit_target_id from import_staged_row where batch_id=$1`,
					[batchId],
				)
			).rows,
		).toEqual([
			expect.objectContaining({
				row_status: "accepted",
				commit_target_id: null,
			}),
			expect.objectContaining({
				row_status: "accepted",
				commit_target_id: null,
			}),
		]);
		expect(
			(
				await fixture.pool.query(
					`select status from vacation_reconciliation where id=$1`,
					[preview.data.operationId],
				)
			).rows[0].status,
		).toBe("reviewed");
		expect(await processImportReviewJob(job)).toMatchObject({
			success: true,
			data: { committedRows: 2 },
		});
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 0.5,
			usedDays: 8,
			remainingDays: 22,
		});
	});
	it("links a repeated provider source in a later batch without writing or deducting it again", async () => {
		const batchId = randomUUID(),
			jobId = randomUUID(),
			rowId = randomUUID();
		await fixture.pool.query(
			`insert into import_batch(id,organization_id,provider,status,selected_scope,date_range,started_by) values($1,$2,'clockodo','needs_review','{}','{}',$3)`,
			[batchId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into import_batch_job(id,batch_id,organization_id,kind,entity_type,partition_key) values($1,$2,$3,'commit','absence','commit:absence')`,
			[jobId, batchId, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into import_staged_row(id,batch_id,organization_id,entity_type,provider_source_id,source_payload_hash,source_payload,normalized_payload,row_status) values($1,$2,$3,'absence','provider-A','hash-A','{}',$4,'accepted')`,
			[
				rowId,
				batchId,
				fixture.organizationId,
				JSON.stringify({
					employeeId,
					startsAt: "2026-05-11T00:00:00Z",
					endsAt: "2026-05-12T23:59:59Z",
					absenceCategoryId: 99,
				}),
			],
		);
		const preview = await previewHistoricalVacationReconciliation({
			kind: "import",
			batchId,
			mappings: [
				{ rowId, categoryId, startPeriod: "full_day", endPeriod: "full_day" },
			],
			decisions: [],
			reason: "Review an already imported provider source",
		});
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.absences).toEqual([]);
		const { processImportReviewJob } = await import(
			"@/lib/import-review/worker"
		);
		const job = {
			data: {
				type: "import-review-commit",
				batchId,
				jobId,
				organizationId: fixture.organizationId,
				entityType: "absence",
				committedBy: fixture.ownerUserId,
				historicalReconciliation: {
					operationId: preview.data.operationId,
					fingerprint: preview.data.fingerprint,
				},
			},
			opts: { attempts: 1 },
			attemptsMade: 0,
		} as Job<ImportCommitJobData>;
		expect(await processImportReviewJob(job)).toMatchObject({
			success: true,
			data: { committedRows: 1 },
		});
		expect(
			(
				await fixture.pool.query(
					`select distinct commit_target_id from import_staged_row where organization_id=$1 and provider_source_id='provider-A'`,
					[fixture.organizationId],
				)
			).rows,
		).toHaveLength(1);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 0.5,
			usedDays: 8,
		});
	});
	it("continues to record ordinary post-coverage vacation without reconciliation", async () => {
		expect(
			(
				await recordAbsenceForEmployee({
					employeeId,
					categoryId,
					startDate: "2026-06-01",
					endDate: "2026-06-02",
					startPeriod: "full_day",
					endPeriod: "full_day",
				})
			).success,
		).toBe(true);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 0.5,
			usedDays: 10,
			remainingDays: 20,
		});
	});

	it("fully replaces reviewed totals across two years using the actual half-day coverage", async () => {
		const person = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		await fixture.pool.query(
			`update vacation_allowance set start_date='2025-01-01' where organization_id=$1`,
			[fixture.organizationId],
		);
		for (const [year, days] of [
			[2025, 0.5],
			[2026, 2],
		]) {
			const input = {
				organizationId: fixture.organizationId,
				employeeId: person.employeeId,
				year: year!,
				days: days!,
				reason: "Year-end historical payroll",
			};
			const preview = await previewPreviouslyTakenVacation(input);
			if (!preview.success) throw new Error(preview.error);
			expect(
				(
					await commitPreviouslyTakenVacation({
						...input,
						fingerprint: preview.data.fingerprint,
					})
				).success,
			).toBe(true);
		}
		const absence = {
			employeeId: person.employeeId,
			categoryId,
			startDate: "2025-12-31",
			endDate: "2026-01-02",
			startPeriod: "pm" as const,
			endPeriod: "full_day" as const,
		};
		const preview = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [
				{ employeeId: person.employeeId, year: 2025, remainingDays: 0 },
				{ employeeId: person.employeeId, year: 2026, remainingDays: 0 },
			],
			reason: "Complete dated year-end replacement",
		});
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data.totals.map((row) => row.datedDays).sort()).toEqual([
			0.5, 2,
		]);
		expect(preview.data.blockers).toEqual([]);
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					historicalReconciliation: {
						operationId: preview.data.operationId,
						fingerprint: preview.data.fingerprint,
					},
				})
			).success,
		).toBe(true);
		expect(await getVacationBalance(person.employeeId, 2025)).toMatchObject({
			usedDays: 0.5,
			remainingDays: 29.5,
		});
		expect(await getVacationBalance(person.employeeId, 2026)).toMatchObject({
			usedDays: 2,
			remainingDays: 28,
		});
	});
	it("uses the persisted half-day rule for an exact-hours overnight historical absence", async () => {
		const person = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		const input = {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
			year: 2026,
			days: 0.5,
			reason: "One historical partial day",
		};
		const opening = await previewPreviouslyTakenVacation(input);
		if (!opening.success) throw new Error(opening.error);
		expect(
			(
				await commitPreviouslyTakenVacation({
					...input,
					fingerprint: opening.data.fingerprint,
				})
			).success,
		).toBe(true);
		const absence = {
			employeeId: person.employeeId,
			categoryId,
			startDate: "2026-05-14",
			endDate: "2026-05-15",
			startPeriod: "am" as const,
			endPeriod: "am" as const,
			durationKind: "partial_day" as const,
			startTime: "22:00",
			endTime: "06:00",
		};
		const review = await previewHistoricalVacationReconciliation({
			kind: "manual",
			absence,
			decisions: [
				{ employeeId: person.employeeId, year: 2026, remainingDays: 0 },
			],
			reason: "Exact hours located in old payroll",
		});
		if (!review.success) throw new Error(review.error);
		expect(review.data.totals[0]?.datedDays).toBe(0.5);
		expect(
			(
				await recordAbsenceForEmployee({
					...absence,
					historicalReconciliation: {
						operationId: review.data.operationId,
						fingerprint: review.data.fingerprint,
					},
				})
			).success,
		).toBe(true);
		expect(await getVacationBalance(person.employeeId, 2026)).toMatchObject({
			usedDays: 0.5,
			remainingDays: 29.5,
		});
	});
});
