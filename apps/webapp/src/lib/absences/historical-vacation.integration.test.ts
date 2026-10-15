import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
				user: { id: session.userId, role: "user", email: "vacation@test.invalid" },
				session: {
					id: session.userId,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
const { previewPreviouslyTakenVacation, commitPreviouslyTakenVacation } =
	await import("@/app/[locale]/(app)/settings/vacation/historical-usage-actions");
const { getVacationBalance } = await import("@/app/[locale]/(app)/absences/queries");
const { getEnhancedVacationBalance } = await import("./vacation.service");

describe("reviewed previously taken vacation", () => {
	vi.setConfig({ testTimeout: 90000, hookTimeout: 90000 });
	let fixture: LifecycleDatabaseFixture;
	let employeeId: string;
	let categoryId: string;
	let targetUserId: string;
	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		const target = await fixture.seedEmployee({
			startDate: new Date("2020-01-01T00:00:00Z"),
			withPeriod: false,
		});
		employeeId = target.employeeId;
		targetUserId = target.userId;
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id, tracking_start_date, activated_at) values ($1, '2026-05-21', now())`,
			[fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into vacation_allowance (organization_id, name, start_date, is_company_default, default_annual_days, statutory_minimum_days, accrual_type, created_by, updated_at) values ($1, 'Annual 30', '2026-01-01', true, '30', '20', 'annual', $2, now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, name, type, counts_against_vacation, requires_approval, updated_at) values ($1,$2,'Vacation','vacation',true,false,now())`,
			[categoryId, fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into absence_entry (employee_id, organization_id, category_id, start_date, end_date, status, updated_at) values ($1,$2,$3,'2026-06-01','2026-06-05','approved',now())`,
			[employeeId, fixture.organizationId, categoryId],
		);
	});
	afterAll(async () => {
		await fixture?.pool.query(
			`delete from vacation_adjustment where employee_id in (select id from employee where organization_id=$1)`,
			[fixture.organizationId],
		);
		await fixture?.close();
		vi.useRealTimers();
	});
	beforeEach(async () => {
		await fixture.pool.query(
			`delete from absence_entry where employee_id=$1 and start_date<'2026-06-01'`,
			[employeeId],
		);
		await fixture.pool.query(
			`delete from vacation_adjustment where employee_id in (select id from employee where organization_id=$1)`,
			[fixture.organizationId],
		);
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
	});
	it("reviews then records eight previously taken days without reducing a thirty-day allowance", async () => {
		const input = {
			organizationId: fixture.organizationId,
			employeeId,
			year: 2026,
			days: 8,
			reason: "Reviewed pre-rollout payroll record",
		};
		const preview = await previewPreviouslyTakenVacation(input);
		expect(preview.success).toBe(true);
		if (!preview.success) throw new Error(preview.error);
		expect(preview.data).toMatchObject({
			coverageStart: "2026-01-01",
			coverageEnd: "2026-05-20",
			before: { remainingDays: 25 },
			after: { allowanceDays: 30, previouslyTakenDays: 8, remainingDays: 17 },
			blockers: [],
		});
		const committed = await commitPreviouslyTakenVacation({
			...input,
			fingerprint: preview.data.fingerprint,
		});
		expect(committed.success).toBe(true);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 30,
			previouslyTakenDays: 8,
			usedDays: 13,
			remainingDays: 17,
		});
		expect(await getEnhancedVacationBalance({ employeeId, year: 2026 })).toMatchObject({
			allowanceDays: 30,
			previouslyTakenDays: 8,
			usedDays: 13,
			remainingDays: 17,
		});
		const { getEmployeeVacationBalance } =
			await import("@/app/[locale]/(app)/settings/vacation/actions");
		const admin = await getEmployeeVacationBalance(employeeId);
		expect(admin.success && admin.data.balance).toMatchObject({
			allowanceDays: 30,
			previouslyTakenDays: 8,
			remainingDays: 17,
		});
		const { getManagerAbsenceEmployees } =
			await import("@/app/[locale]/(app)/team/absences/actions");
		const team = await getManagerAbsenceEmployees({ year: 2026 });
		expect(team.success && team.data.rows.find((row) => row.id === employeeId)).toMatchObject({
			previouslyTakenVacationDays: 8,
			usedVacationDays: 13,
			remainingVacationDays: 17,
		});
		session.userId = targetUserId;
		const { getVacationBalance: dashboardAction } = await import("@/components/dashboard/actions");
		const dashboard = await dashboardAction();
		expect(dashboard.success && dashboard.data).toMatchObject({
			previouslyTakenDays: 8,
			usedDays: 13,
			remainingDays: 17,
		});
	});
	it("refuses manager historical recording after an aggregate while preserving normal post-rollout vacation", async () => {
		const input = {
			organizationId: fixture.organizationId,
			employeeId,
			year: 2026,
			days: 8,
			reason: "Payroll reviewed",
		};
		const review = await previewPreviouslyTakenVacation(input);
		if (!review.success) throw new Error(review.error);
		expect(
			(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.data.fingerprint }))
				.success,
		).toBe(true);
		const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
		const blocked = await recordAbsenceForEmployee({
			employeeId,
			categoryId,
			startDate: "2026-04-06",
			endDate: "2026-04-06",
			startPeriod: "full_day",
			endPeriod: "full_day",
		});
		expect(blocked).toMatchObject({ success: false });
		if (!blocked.success) expect(blocked.error).toContain("previously taken vacation");
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			usedDays: 13,
			remainingDays: 17,
		});
	});

	async function reviewedTotal(target = employeeId, days = 8, year = 2026) {
		const input = {
			organizationId: fixture.organizationId,
			employeeId: target,
			year,
			days,
			reason: "Reviewed payroll usage",
		};
		const preview = await previewPreviouslyTakenVacation(input);
		if (!preview.success) throw new Error(preview.error);
		return { input, review: preview.data };
	}
	async function saveTotal(target = employeeId, days = 8, year = 2026) {
		const { input, review } = await reviewedTotal(target, days, year);
		const result = await commitPreviouslyTakenVacation({
			...input,
			fingerprint: review.fingerprint,
		});
		expect(result.success).toBe(true);
		return { input, review };
	}
	it("refuses the inverse write order for approved and pending historical vacation, with a review of the actual records", async () => {
		await fixture.pool.query(
			`insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,status,updated_at) values ($1,$2,$3,'2026-04-06','2026-04-06','pending',now())`,
			[employeeId, fixture.organizationId, categoryId],
		);
		const { input, review } = await reviewedTotal();
		expect(review.historicalRecords).toHaveLength(1);
		expect(review.blockers.join(" ")).toContain("Recorded historical vacation");
		expect(
			(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint })).success,
		).toBe(false);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 30,
			usedDays: 5,
			pendingDays: 1,
			remainingDays: 24,
		});
	});
	it("replaces a total in half-day precision and rejects both stale reviews and changed submitted values", async () => {
		await saveTotal();
		const first = await reviewedTotal(employeeId, 6.5);
		const concurrent = await reviewedTotal(employeeId, 7);
		expect(
			(
				await commitPreviouslyTakenVacation({
					...first.input,
					fingerprint: first.review.fingerprint,
				})
			).success,
		).toBe(true);
		expect(
			(
				await commitPreviouslyTakenVacation({
					...concurrent.input,
					fingerprint: concurrent.review.fingerprint,
				})
			).success,
		).toBe(false);
		expect(
			(
				await commitPreviouslyTakenVacation({
					...first.input,
					days: 4,
					fingerprint: first.review.fingerprint,
				})
			).success,
		).toBe(false);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 30,
			previouslyTakenDays: 6.5,
			usedDays: 11.5,
			remainingDays: 18.5,
		});
	});
	it("makes simultaneous commits from the same review succeed only once", async () => {
		const { input, review } = await reviewedTotal();
		const results = await Promise.all([
			commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint }),
			commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint }),
		]);
		expect(results.filter((result) => result.success)).toHaveLength(1);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			remainingDays: 17,
			usedDays: 13,
		});
	});
	it("serializes aggregate creation and manual historical recording when no total exists", async () => {
		const { input, review } = await reviewedTotal();
		const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
		const results = await Promise.all([
			commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint }),
			recordAbsenceForEmployee({
				employeeId,
				categoryId,
				startDate: "2026-04-07",
				endDate: "2026-04-07",
				startPeriod: "full_day",
				endPeriod: "full_day",
			}),
		]);
		expect(results.filter((result) => result.success)).toHaveLength(1);
		const balance = await getVacationBalance(employeeId, 2026);
		expect([6, 13]).toContain(balance?.usedDays);
	});
	it("keeps historical coverage fixed after tracking changes and permits clearing a total", async () => {
		await saveTotal();
		await fixture.pool.query(
			`update organization_tracking_settings set tracking_start_date='2026-06-15' where organization_id=$1`,
			[fixture.organizationId],
		);
		const { input, review } = await reviewedTotal(employeeId, 7.5);
		expect(review).toMatchObject({
			coverageStart: "2026-01-01",
			coverageEnd: "2026-05-20",
			trackingStart: "2026-05-21",
		});
		expect(
			(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint })).success,
		).toBe(true);
		await saveTotal(employeeId, 0);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			usedDays: 5,
			remainingDays: 25,
		});
		await fixture.pool.query(
			`update organization_tracking_settings set tracking_start_date='2026-05-21' where organization_id=$1`,
			[fixture.organizationId],
		);
	});
	it.each([-1, 0.25, Number.NaN, 367])("rejects invalid vacation-day amount %s", async (days) => {
		expect(
			(
				await previewPreviouslyTakenVacation({
					organizationId: fixture.organizationId,
					employeeId,
					year: 2026,
					days,
					reason: "Invalid",
				})
			).success,
		).toBe(false);
	});
	it("refuses foreign targets and non-admins at preview and after a reviewed permission change", async () => {
		const foreignOrg = await fixture.createOrganization();
		const foreign = (await fixture.seedEmployee({ organizationId: foreignOrg })).employeeId;
		expect(
			(
				await previewPreviouslyTakenVacation({
					organizationId: fixture.organizationId,
					employeeId: foreign,
					year: 2026,
					days: 8,
					reason: "Foreign",
				})
			).success,
		).toBe(false);
		const { input, review } = await reviewedTotal();
		await fixture.seedEmployee({ role: "owner" });
		session.userId = targetUserId;
		expect((await previewPreviouslyTakenVacation(input)).success).toBe(false);
		expect(
			(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint })).success,
		).toBe(false);
		session.userId = fixture.ownerUserId;
		await fixture.pool.query(
			`update member set role='member' where user_id=$1 and organization_id=$2`,
			[fixture.ownerUserId, fixture.organizationId],
		);
		expect(
			(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint })).success,
		).toBe(false);
		await fixture.pool.query(
			`update member set role='owner' where user_id=$1 and organization_id=$2`,
			[fixture.ownerUserId, fixture.organizationId],
		);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			usedDays: 5,
			remainingDays: 25,
		});
	});
	it("guards self recording and historical date changes while leaving ordinary post-coverage recording usable", async () => {
		await saveTotal();
		session.userId = targetUserId;
		const { requestAbsenceEffect } =
			await import("@/app/[locale]/(app)/absences/request-absence-effect");
		const self = await requestAbsenceEffect({
			categoryId,
			startDate: "2026-04-08",
			endDate: "2026-04-08",
			startPeriod: "full_day",
			endPeriod: "full_day",
		});
		expect(self.success).toBe(false);
		if (!self.success) expect(self.error).toContain("previously taken vacation");
		const { requestAbsenceChange } = await import("./change-request-service");
		const existing = await fixture.pool.query(
			`select id from absence_entry where employee_id=$1 and start_date='2026-06-01'`,
			[employeeId],
		);
		await expect(
			requestAbsenceChange({
				organizationId: fixture.organizationId,
				userId: targetUserId,
				absenceId: existing.rows[0].id,
				kind: "change",
				reason: "Correct historical dates",
				proposed: {
					startDate: "2026-04-13",
					endDate: "2026-04-17",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
			}),
		).rejects.toThrow("previously taken vacation");
		session.userId = fixture.ownerUserId;
		const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
		const future = await recordAbsenceForEmployee({
			employeeId,
			categoryId,
			startDate: "2026-07-06",
			endDate: "2026-07-06",
			startPeriod: "am",
			endPeriod: "am",
		});
		expect(future.success).toBe(true);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 8,
			usedDays: 13.5,
			remainingDays: 16.5,
		});
		await fixture.pool.query(
			`delete from absence_entry where employee_id=$1 and start_date='2026-07-06'`,
			[employeeId],
		);
	});
	it("keeps other years, custom allowances, manual adjustments and accrual shares separate", async () => {
		await fixture.pool.query(
			`insert into vacation_allowance (organization_id,name,start_date,valid_until,is_company_default,default_annual_days,statutory_minimum_days,accrual_type,created_by,updated_at) values ($1,'Previous policy','2025-01-01','2025-12-31',true,'30','20','annual',$2,now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		await saveTotal(employeeId, 3.5, 2025);
		await saveTotal(employeeId, 8, 2026);
		expect(await getVacationBalance(employeeId, 2025)).toMatchObject({
			previouslyTakenDays: 3.5,
			usedDays: 3.5,
			remainingDays: 26.5,
		});
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 8,
			remainingDays: 17,
		});
		await fixture.pool.query(
			`insert into vacation_adjustment (employee_id,year,days,reason,kind,adjusted_by) values ($1,2026,2,'Bonus','manual',$2),($1,2026,1,'Accrual','accrual',null)`,
			[employeeId, fixture.ownerEmployeeId],
		);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 30,
			previouslyTakenDays: 8,
			remainingDays: 20,
		});
		const { updateEmployeeAllowance } =
			await import("@/app/[locale]/(app)/settings/vacation/actions");
		expect(
			(await updateEmployeeAllowance(employeeId, 2026, { customAnnualDays: "35" })).success,
		).toBe(true);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			allowanceDays: 35,
			previouslyTakenDays: 8,
			remainingDays: 25,
		});
		await fixture.pool.query(`delete from employee_vacation_allowance where employee_id=$1`, [
			employeeId,
		]);
	});
	it.each([true, false])(
		"guards unknown imported historical vacation in both write orders (total first: %s)",
		async (totalFirst) => {
			if (totalFirst) await saveTotal();
			const { importBatch, importBatchJob, importStagedRow } = await import("@/db/schema");
			const { processImportReviewJob } = await import("@/lib/import-review/worker");
			const batchId = randomUUID(),
				jobId = randomUUID();
			await fixture.db.insert(importBatch).values({
				id: batchId,
				organizationId: fixture.organizationId,
				provider: "clockin",
				status: "committing",
				selectedScope: {},
				dateRange: { startDate: "2026-01-01", endDate: "2026-05-20" },
				startedBy: fixture.ownerUserId,
			});
			await fixture.db.insert(importBatchJob).values({
				id: jobId,
				batchId,
				organizationId: fixture.organizationId,
				kind: "commit",
				entityType: "absence",
				partitionKey: "absence",
			});
			await fixture.db.insert(importStagedRow).values({
				batchId,
				organizationId: fixture.organizationId,
				entityType: "absence",
				providerSourceId: "absence:1238",
				sourcePayloadHash: "test-source-hash",
				sourcePayload: { id: 1238 },
				normalizedPayload: {
					employeeId,
					startsAt: "2026-04-20T00:00:00Z",
					endsAt: "2026-04-21T23:59:00Z",
					absenceCategoryName: "Vacation",
				},
				rowStatus: "accepted",
				issueSeverity: "none",
			});
			const job = {
				data: {
					type: "import-review-commit" as const,
					batchId,
					jobId,
					organizationId: fixture.organizationId,
					entityType: "absence" as const,
					committedBy: fixture.ownerUserId,
				},
				attemptsMade: 0,
				opts: { attempts: 1 },
			} as Parameters<typeof processImportReviewJob>[0];
			if (totalFirst) {
				await expect(processImportReviewJob(job)).rejects.toThrow("previously taken vacation");
				expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
					usedDays: 13,
					remainingDays: 17,
				});
			} else {
				expect((await processImportReviewJob(job)).success).toBe(true);
				const { input, review } = await reviewedTotal();
				expect(review.historicalRecords).toHaveLength(1);
				expect(review.blockers.length).toBeGreaterThan(0);
				expect(
					(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint }))
						.success,
				).toBe(false);
			}
			const category = await fixture.pool.query(
				`select id from absence_category where organization_id=$1 and name='Imported absence'`,
				[fixture.organizationId],
			);
			expect(category.rows).toHaveLength(totalFirst ? 0 : 1);
			await fixture.pool.query(`delete from import_batch where id=$1`, [batchId]);
		},
	);
	it("keeps manual/accrual adjustments distinct and carries forward a balance reduced by historical usage", async () => {
		await saveTotal();
		await fixture.pool.query(
			`update vacation_allowance set allow_carryover=true where organization_id=$1 and start_date='2026-01-01'`,
			[fixture.organizationId],
		);
		const { calculateAnnualCarryover } = await import("./vacation.service");
		const result = await calculateAnnualCarryover(
			fixture.organizationId,
			2026,
			fixture.ownerUserId,
		);
		expect(result.results.find((row) => row.employeeId === employeeId)).toMatchObject({
			carryoverApplied: 17,
		});
		await fixture.pool.query(
			`delete from employee_vacation_allowance where employee_id in (select id from employee where organization_id=$1)`,
			[fixture.organizationId],
		);
	});
	it("refuses turning recorded historical non-vacation into vacation through a category edit", async () => {
		await saveTotal();
		const otherCategory = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id,organization_id,name,type,counts_against_vacation,requires_approval,updated_at) values ($1,$2,'Historical custom leave','custom',false,false,now())`,
			[otherCategory, fixture.organizationId],
		);
		const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
		expect(
			(
				await recordAbsenceForEmployee({
					employeeId,
					categoryId: otherCategory,
					startDate: "2026-03-03",
					endDate: "2026-03-03",
					startPeriod: "full_day",
					endPeriod: "full_day",
				})
			).success,
		).toBe(true);
		const { updateAbsenceCategory } =
			await import("@/app/[locale]/(app)/settings/vacation/actions");
		expect(
			(
				await updateAbsenceCategory(otherCategory, {
					type: "vacation",
					name: "Historical custom leave",
					countsAgainstVacation: true,
					requiresApproval: false,
					isActive: true,
				})
			).success,
		).toBe(false);
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({
			previouslyTakenDays: 8,
			remainingDays: 17,
		});
	});

	it("refuses a newly closed historical month at commit without changing the total", async () => {
		const { input, review } = await reviewedTotal();
		const { closeMonth } = await import("@/lib/time-tracking/closed-months/store");
		const { parseInstant } = await import("@/lib/datetime/temporal-core");
		const closed = await closeMonth(fixture.db, {
			organizationId: fixture.organizationId,
			month: "2026-01",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: fixture.ownerUserId },
			now: parseInstant("2026-10-15T00:00:00Z"),
		});
		expect(closed.kind).toBe("closed");
		expect(
			(await commitPreviouslyTakenVacation({ ...input, fingerprint: review.fingerprint })).success,
		).toBe(false);
		const next = await reviewedTotal();
		expect(next.review.blockers.join(" ")).toContain("closed");
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({ remainingDays: 25 });
		const { reopenMonth } = await import("@/lib/time-tracking/closed-months/store");
		await reopenMonth(fixture.db, {
			organizationId: fixture.organizationId,
			month: "2026-01",
			scope: { kind: "employees", employeeIds: [employeeId] },
			reason: "Authorized historical review",
			actorUserId: fixture.ownerUserId,
		});
		await saveTotal();
		expect(await getVacationBalance(employeeId, 2026)).toMatchObject({ remainingDays: 17 });
	});
});
