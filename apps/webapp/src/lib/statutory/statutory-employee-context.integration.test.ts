/**
 * #1988: per-employee statutory context (external / prior-employment offsets, working-student
 * lecture-free periods, apprentice school and exam releases) is organization-scoped and audited.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { employeeStatutoryOffset } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	listApprenticeReleases,
	listEmployeeStatutoryOffsets,
	listEmployeeStudyPeriods,
	recordApprenticeRelease,
	recordEmployeeStatutoryOffset,
	recordEmployeeStudyPeriod,
	voidEmployeeStudyPeriod,
} from "./employee-context";

describe("per-employee statutory context (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const fx = statutoryFixture(integrationAdminPool(), "t1988-context");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	async function twoOrganizations() {
		const orgA = await fx.organization("a");
		const orgB = await fx.organization("b");
		const adminA = await fx.user("admin-a");
		const adminB = await fx.user("admin-b");
		const workerA = await fx.employee(orgA, "worker-a");
		return { orgA, orgB, adminA, adminB, workerA };
	}

	it("records offsets with provenance and lists the ones overlapping a range", async () => {
		const { orgA, adminA, workerA } = await twoOrganizations();

		await recordEmployeeStatutoryOffset(db, {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
			offsetKind: "external_minijob_monthly_earnings",
			validFromDate: "2026-01-01",
			validUntilDate: null,
			amountCents: 15_000,
			note: "Second Minijob at a bakery",
		});
		await recordEmployeeStatutoryOffset(db, {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
			offsetKind: "prior_short_term_work_days",
			calendarYear: 2025,
			count: 20,
			note: "Harvest work, certificate on file",
		});

		const offsets = await listEmployeeStatutoryOffsets(db, {
			organizationId: orgA.id,
			employeeId: workerA.employeeId,
			from: "2026-03-01",
			until: "2026-04-01",
		});

		expect(offsets).toEqual([
			expect.objectContaining({
				offsetKind: "external_minijob_monthly_earnings",
				amountCents: 15_000,
				currency: "EUR",
				validFromDate: "2026-01-01",
				validUntilDate: null,
				note: "Second Minijob at a bakery",
				createdBy: adminA.userId,
			}),
		]);
		expect(
			await listEmployeeStatutoryOffsets(db, {
				organizationId: orgA.id,
				employeeId: workerA.employeeId,
				kinds: ["prior_short_term_work_days"],
				from: "2025-01-01",
				until: "2026-01-01",
			}),
		).toEqual([
			expect.objectContaining({
				countValue: 20,
				validFromDate: "2025-01-01",
				validUntilDate: "2026-01-01",
			}),
		]);
	});

	it("records prior working-student weeks as consecutive Monday weeks a window can age out", async () => {
		const { orgA, adminA, workerA } = await twoOrganizations();
		const base = {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
			offsetKind: "prior_working_student_over_20h_weeks" as const,
			note: "Certificate from previous employer",
		};

		const offset = await recordEmployeeStatutoryOffset(db, {
			...base,
			firstWeekStartsOn: "2025-03-03",
			count: 10,
		});
		expect(offset).toMatchObject({
			countValue: 10,
			validFromDate: "2025-03-03",
			validUntilDate: "2025-05-12",
		});

		for (const invalid of [
			{ firstWeekStartsOn: "2025-03-04", count: 2 },
			{ firstWeekStartsOn: "2025-03-03", count: 0 },
			{ firstWeekStartsOn: "not-a-date", count: 1 },
		]) {
			await expect(
				recordEmployeeStatutoryOffset(db, { ...base, ...invalid }),
			).rejects.toBeInstanceOf(ValidationError);
		}
	});

	it("records external Minijob earnings for whole calendar months only", async () => {
		const { orgA, adminA, workerA } = await twoOrganizations();
		const base = {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
			offsetKind: "external_minijob_monthly_earnings" as const,
			amountCents: 15_000,
			note: "Second Minijob",
		};

		for (const dates of [
			{ validFromDate: "2026-03-15", validUntilDate: null },
			{ validFromDate: "2026-03-01", validUntilDate: "2026-05-02" },
		]) {
			await expect(recordEmployeeStatutoryOffset(db, { ...base, ...dates })).rejects.toMatchObject({
				refusal: "statutory_invalid_range",
			});
		}
		await expect(
			db.insert(employeeStatutoryOffset).values({
				organizationId: orgA.id,
				employeeId: workerA.employeeId,
				offsetKind: "external_minijob_monthly_earnings",
				validFromDate: "2026-03-15",
				amountCents: 15_000,
				currency: "EUR",
				note: "Direct write",
				createdBy: adminA.userId,
			}),
		).rejects.toThrow();
		await recordEmployeeStatutoryOffset(db, {
			...base,
			validFromDate: "2026-03-01",
			validUntilDate: "2026-05-01",
		});
	});

	it("refuses offsets without a count or end date and voids without a reason in the database", async () => {
		const { orgA, adminA, workerA } = await twoOrganizations();
		const row = {
			organizationId: orgA.id,
			employeeId: workerA.employeeId,
			note: "Direct write",
			createdBy: adminA.userId,
		};

		for (const values of [
			{ offsetKind: "prior_short_term_work_days" as const, validFromDate: "2026-01-01" },
			{
				offsetKind: "prior_short_term_months" as const,
				validFromDate: "2026-01-01",
				countValue: 2,
			},
			{
				offsetKind: "prior_working_student_over_20h_weeks" as const,
				validFromDate: "2026-03-02",
				validUntilDate: "2026-03-09",
			},
		]) {
			await expect(
				db.insert(employeeStatutoryOffset).values({ ...row, ...values }),
			).rejects.toThrow();
		}

		const [offset] = await db
			.insert(employeeStatutoryOffset)
			.values({
				...row,
				offsetKind: "prior_short_term_months",
				validFromDate: "2026-01-01",
				validUntilDate: "2027-01-01",
				countValue: 2,
			})
			.returning();
		await expect(
			db
				.update(employeeStatutoryOffset)
				.set({ voidedAt: new Date(), voidedBy: adminA.userId, voidReason: " " })
				.where(
					and(
						eq(employeeStatutoryOffset.id, offset.id),
						eq(employeeStatutoryOffset.organizationId, orgA.id),
					),
				),
		).rejects.toThrow();
	});

	it("never lets another organization write or read an employee's context", async () => {
		const { orgA, orgB, adminA, adminB, workerA } = await twoOrganizations();
		await recordEmployeeStudyPeriod(db, {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
			startsOn: "2026-02-01",
			endsOn: "2026-04-15",
		});

		await expect(
			recordEmployeeStatutoryOffset(db, {
				organizationId: orgB.id,
				actorUserId: adminB.userId,
				employeeId: workerA.employeeId,
				offsetKind: "prior_short_term_months",
				calendarYear: 2026,
				count: 1,
				note: "Foreign write",
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			recordApprenticeRelease(db, {
				organizationId: orgB.id,
				actorUserId: adminB.userId,
				employeeId: workerA.employeeId,
				releaseKind: "exam_day",
				startsOn: "2026-05-04",
				endsOn: "2026-05-04",
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		expect(
			await listEmployeeStudyPeriods(db, {
				organizationId: orgB.id,
				employeeId: workerA.employeeId,
			}),
		).toEqual([]);
		expect(
			await listEmployeeStudyPeriods(db, {
				organizationId: orgA.id,
				employeeId: workerA.employeeId,
			}),
		).toEqual([expect.objectContaining({ startsOn: "2026-02-01", endsOn: "2026-04-15" })]);
	});

	it("refuses overlapping lecture-free periods until the older one is voided", async () => {
		const { orgA, adminA, workerA } = await twoOrganizations();
		const base = {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
		};
		const first = await recordEmployeeStudyPeriod(db, {
			...base,
			startsOn: "2026-02-01",
			endsOn: "2026-04-15",
		});

		const overlapping = recordEmployeeStudyPeriod(db, {
			...base,
			startsOn: "2026-04-15",
			endsOn: "2026-04-30",
		});
		await expect(overlapping).rejects.toBeInstanceOf(ValidationError);
		await expect(overlapping).rejects.toMatchObject({ refusal: "statutory_period_overlap" });

		await expect(
			voidEmployeeStudyPeriod(db, { ...base, periodId: first.id, reason: "  " }),
		).rejects.toMatchObject({ refusal: "statutory_note_required", field: "reason" });
		await voidEmployeeStudyPeriod(db, { ...base, periodId: first.id, reason: "Wrong semester" });
		await recordEmployeeStudyPeriod(db, { ...base, startsOn: "2026-04-15", endsOn: "2026-04-30" });

		expect(
			await listEmployeeStudyPeriods(db, {
				organizationId: orgA.id,
				employeeId: workerA.employeeId,
			}),
		).toEqual([expect.objectContaining({ startsOn: "2026-04-15" })]);
	});

	it("records apprentice school and exam releases with lesson details", async () => {
		const { orgA, adminA, workerA } = await twoOrganizations();
		const base = {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			employeeId: workerA.employeeId,
		};
		await recordApprenticeRelease(db, {
			...base,
			releaseKind: "vocational_school_day",
			startsOn: "2026-03-02",
			endsOn: "2026-03-02",
			lessonCount: 6,
		});
		await recordApprenticeRelease(db, {
			...base,
			releaseKind: "vocational_school_block_week",
			startsOn: "2026-03-09",
			endsOn: "2026-03-13",
			schoolMinutes: 1_800,
		});

		const singleDayBlock = recordApprenticeRelease(db, {
			...base,
			releaseKind: "exam_day",
			startsOn: "2026-06-01",
			endsOn: "2026-06-02",
		});
		await expect(singleDayBlock).rejects.toMatchObject({ refusal: "statutory_release_single_day" });

		expect(
			await listApprenticeReleases(db, {
				organizationId: orgA.id,
				employeeId: workerA.employeeId,
				from: "2026-03-01",
				until: "2026-04-01",
			}),
		).toEqual([
			expect.objectContaining({ releaseKind: "vocational_school_day", lessonCount: 6 }),
			expect.objectContaining({
				releaseKind: "vocational_school_block_week",
				schoolMinutes: 1_800,
			}),
		]);
	});
});
