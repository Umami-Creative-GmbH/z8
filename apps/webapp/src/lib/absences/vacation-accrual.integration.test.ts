import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getVacationBalance } from "@/app/[locale]/(app)/absences/queries";
import { getManagerAbsenceEmployees } from "@/app/[locale]/(app)/team/absences/actions";
import { vacationAdjustment, vacationAllowance } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getEnhancedVacationBalance } from "./vacation.service";
import { accrueDueVacationPeriods, accrueVacationPeriods } from "./vacation-accrual";
import {
	loadManualVacationAdjustments,
	loadVacationAdjustmentSums,
	loadVacationAdjustmentTotal,
} from "./vacation-adjustments";

const session = vi.hoisted(() => ({
	current: null as null | { user: { id: string }; session: { activeOrganizationId: string } },
}));

vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: async () => session.current,
}));
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

describe("vacation accrual on a monthly policy (#1106)", () => {
	let fixture: LifecycleDatabaseFixture;
	let foreignOrganizationId: string;
	let foreignEmployeeId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		foreignOrganizationId = await fixture.createOrganization();
		const foreignOwner = await fixture.seedEmployee({
			organizationId: foreignOrganizationId,
			role: "owner",
		});
		foreignEmployeeId = (await fixture.seedEmployee({ organizationId: foreignOrganizationId }))
			.employeeId;

		await fixture.db.insert(vacationAllowance).values([
			{
				organizationId: fixture.organizationId,
				name: "Monthly accrual",
				startDate: "2026-01-01",
				isCompanyDefault: true,
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "monthly",
				createdBy: fixture.ownerUserId,
			},
		]);
		await fixture.db.insert(vacationAdjustment).values({
			employeeId: foreignEmployeeId,
			year: 2026,
			days: "4",
			reason: "Other organization",
			adjustedBy: foreignOwner.employeeId,
		});

		await accrueVacationPeriods(fixture.organizationId, {
			year: 2026,
			months: [1, 2, 3],
		});
	});

	afterAll(async () => {
		// `adjusted_by` does not cascade, so the organization cleanup needs the rows gone first.
		await fixture?.db
			.delete(vacationAdjustment)
			.where(inArray(vacationAdjustment.employeeId, [fixture.employeeId, foreignEmployeeId]));
		await fixture?.db
			.delete(vacationAdjustment)
			.where(eq(vacationAdjustment.employeeId, fixture.ownerEmployeeId));
		await fixture?.close();
	});

	it("writes one system accrual row per month, with no adjusting employee", async () => {
		const rows = await fixture.db
			.select({
				days: vacationAdjustment.days,
				kind: vacationAdjustment.kind,
				adjustedBy: vacationAdjustment.adjustedBy,
				accrualMonth: vacationAdjustment.accrualMonth,
			})
			.from(vacationAdjustment)
			.where(
				and(
					eq(vacationAdjustment.employeeId, fixture.employeeId),
					eq(vacationAdjustment.year, 2026),
				),
			)
			.orderBy(vacationAdjustment.accrualMonth);

		expect(rows).toEqual(
			[1, 2, 3].map((accrualMonth) => ({
				days: "2.00",
				kind: "accrual",
				adjustedBy: null,
				accrualMonth,
			})),
		);
	});

	it("writes nothing again when a month is accrued a second time, in sequence or in parallel", async () => {
		const retry = await accrueVacationPeriods(fixture.organizationId, {
			year: 2026,
			months: [2, 3],
		});
		const parallel = await Promise.all(
			[1, 2].map(() =>
				accrueVacationPeriods(fixture.organizationId, {
					year: 2026,
					months: [3],
				}),
			),
		);

		expect(retry.rowsWritten).toBe(0);
		expect(parallel.map((run) => run.rowsWritten)).toEqual([0, 0]);
		expect(
			await loadVacationAdjustmentTotal(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				year: 2026,
			}),
		).toBe(6);
		await expect(
			fixture.db.insert(vacationAdjustment).values({
				employeeId: fixture.employeeId,
				year: 2026,
				days: "2",
				reason: "Duplicate March accrual",
				kind: "accrual",
				accrualMonth: 3,
			}),
		).rejects.toThrow();
	});

	it("shows a balance of 6 after three accruals in every balance reader", async () => {
		const absencesPage = await getVacationBalance(fixture.employeeId, 2026);
		const dashboard = await getEnhancedVacationBalance({
			employeeId: fixture.employeeId,
			year: 2026,
		});
		session.current = {
			user: { id: fixture.ownerUserId },
			session: { activeOrganizationId: fixture.organizationId },
		};
		const managerView = await getManagerAbsenceEmployees({ year: 2026 });

		expect(absencesPage).toMatchObject({ totalDays: 6, remainingDays: 6 });
		expect(dashboard).toMatchObject({ totalDays: 6, remainingDays: 6, baseAllowance: 0 });
		expect(managerView.success).toBe(true);
		const row = managerView.success
			? managerView.data.rows.find((candidate) => candidate.id === fixture.employeeId)
			: undefined;
		expect(row).toMatchObject({ vacationAllowance: 6, remainingVacationDays: 6 });
	});

	it("splits accrual from manual adjustments and lists only the manual ones", async () => {
		await fixture.db.insert(vacationAdjustment).values({
			employeeId: fixture.employeeId,
			year: 2026,
			days: "-1.5",
			reason: "Correction",
			adjustedBy: fixture.ownerEmployeeId,
		});

		const sums = await loadVacationAdjustmentSums(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, foreignEmployeeId],
			year: 2026,
		});
		expect(Object.fromEntries(sums)).toEqual({
			[fixture.employeeId]: { manual: -1.5, accrual: 6 },
		});
		expect(
			await loadVacationAdjustmentTotal(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				year: 2026,
			}),
		).toBe(4.5);

		const history = await loadManualVacationAdjustments(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			year: 2026,
		});
		expect(history).toEqual([
			expect.objectContaining({ days: -1.5, reason: "Correction", adjustedByName: "Lifecycle" }),
		]);
		expect(
			await loadManualVacationAdjustments(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: foreignEmployeeId,
				year: 2026,
			}),
		).toEqual([]);
	});

	it("refuses a manual adjustment without an adjusting employee", async () => {
		await expect(
			fixture.db.insert(vacationAdjustment).values({
				employeeId: fixture.employeeId,
				year: 2026,
				days: "1",
				reason: "Anonymous",
			}),
		).rejects.toThrow();
	});
});

describe("vacation adjustment kind backfill migration", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.db
			.delete(vacationAdjustment)
			.where(eq(vacationAdjustment.employeeId, fixture.employeeId));
		await fixture?.close();
	});

	it("marks the accrual job's rows as accrual and keeps every other row manual", async () => {
		await fixture.db.insert(vacationAdjustment).values([
			{
				employeeId: fixture.employeeId,
				year: 2025,
				days: "2.50",
				reason: "Monthly accrual for March 2025: +2.50 days",
				adjustedBy: fixture.ownerEmployeeId,
				createdAt: new Date("2025-03-01T00:00:00Z"),
			},
			{
				employeeId: fixture.employeeId,
				year: 2025,
				days: "2.50",
				reason: "Monthly accrual for March 2025: +2.50 days (retried)",
				adjustedBy: fixture.ownerEmployeeId,
				createdAt: new Date("2025-03-01T00:05:00Z"),
			},
			{
				employeeId: fixture.employeeId,
				year: 2025,
				days: "2.50",
				reason: "Monthly accrual for December 2025: +2.50 days",
				adjustedBy: fixture.ownerEmployeeId,
			},
			{
				employeeId: fixture.employeeId,
				year: 2025,
				days: "-5",
				reason: "Pro-rated first year",
				adjustedBy: fixture.ownerEmployeeId,
			},
		]);

		const drizzleDirectory = path.join(process.cwd(), "drizzle");
		const migrationFile = readdirSync(drizzleDirectory).find((file) =>
			file.endsWith("_vacation_adjustment_kind.sql"),
		);
		expect(migrationFile).toBeDefined();
		const migration = readFileSync(path.join(drizzleDirectory, migrationFile as string), "utf8");
		const backfills = migration
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim())
			.filter((statement) => /^(UPDATE|WITH)\b/.test(statement));
		expect(backfills).toHaveLength(2);
		for (const backfill of backfills) await fixture.pool.query(backfill);

		const rows = await fixture.db
			.select({
				reason: vacationAdjustment.reason,
				kind: vacationAdjustment.kind,
				accrualMonth: vacationAdjustment.accrualMonth,
			})
			.from(vacationAdjustment)
			.where(eq(vacationAdjustment.employeeId, fixture.employeeId));
		// The earlier of two rows for one month keeps the month; the retried duplicate keeps none,
		// so the unique period index never blocks the backfill.
		expect(
			Object.fromEntries(rows.map((row) => [row.reason, [row.kind, row.accrualMonth]])),
		).toEqual({
			"Monthly accrual for March 2025: +2.50 days": ["accrual", 3],
			"Monthly accrual for March 2025: +2.50 days (retried)": ["accrual", null],
			"Monthly accrual for December 2025: +2.50 days": ["accrual", 12],
			"Pro-rated first year": ["manual", null],
		});
	});
});

describe("vacation accrual catch-up (#1106)", () => {
	let fixture: LifecycleDatabaseFixture;
	let marchHireId: string;
	let inactiveId: string;
	let novemberHireId: string;
	let berlinOrganizationId: string;
	let berlinEmployeeId: string;

	async function accrualRows(employeeId: string) {
		return fixture.db
			.select({ days: vacationAdjustment.days, accrualMonth: vacationAdjustment.accrualMonth })
			.from(vacationAdjustment)
			.where(
				and(eq(vacationAdjustment.employeeId, employeeId), eq(vacationAdjustment.kind, "accrual")),
			)
			.orderBy(vacationAdjustment.accrualMonth);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		marchHireId = (await fixture.seedEmployee({ startDate: new Date("2026-03-16T00:00:00Z") }))
			.employeeId;
		inactiveId = (await fixture.seedEmployee({ isActive: false })).employeeId;
		novemberHireId = (await fixture.seedEmployee({ startDate: new Date("2026-11-02T00:00:00Z") }))
			.employeeId;
		berlinOrganizationId = await fixture.createOrganization();
		const berlinOwner = await fixture.seedEmployee({
			organizationId: berlinOrganizationId,
			role: "owner",
		});
		berlinEmployeeId = (
			await fixture.seedEmployee({
				organizationId: berlinOrganizationId,
				startDate: new Date("2025-01-01T00:00:00Z"),
			})
		).employeeId;

		await fixture.db.insert(vacationAllowance).values([
			{
				organizationId: fixture.organizationId,
				name: "Monthly accrual",
				startDate: "2026-01-01",
				isCompanyDefault: true,
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "monthly",
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId: berlinOrganizationId,
				name: "Monthly accrual",
				startDate: "2025-01-01",
				isCompanyDefault: true,
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "monthly",
				createdBy: berlinOwner.userId,
			},
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("accrues every period of the year so far, prorating the hire month, and only once", async () => {
		const now = parseInstant("2026-10-13T08:00:00Z");
		const first = await accrueDueVacationPeriods(fixture.organizationId, { timezone: "UTC", now });
		const second = await accrueDueVacationPeriods(fixture.organizationId, { timezone: "UTC", now });

		expect(await accrualRows(fixture.employeeId)).toEqual(
			Array.from({ length: 10 }, (_, index) => ({ days: "2.00", accrualMonth: index + 1 })),
		);
		// Hired 16 March: 16 of 31 days of March, then whole months through October.
		expect(await accrualRows(marchHireId)).toEqual([
			{ days: "1.03", accrualMonth: 3 },
			...[4, 5, 6, 7, 8, 9, 10].map((accrualMonth) => ({ days: "2.00", accrualMonth })),
		]);
		expect(await accrualRows(inactiveId)).toEqual([]);
		expect(await accrualRows(novemberHireId)).toEqual([]);
		expect(first.rowsWritten).toBeGreaterThan(0);
		expect(second.rowsWritten).toBe(0);
		expect(await getVacationBalance(fixture.employeeId, 2026)).toMatchObject({ totalDays: 20 });
	});

	it("takes the year and month from the organization's timezone", async () => {
		// 22:30 UTC on 30 September is already 1 October in Berlin. Two runs race, as a cron retry
		// overlapping a slow run would: the unique period index lets only one row per month in.
		const runs = await Promise.all(
			[1, 2].map(() =>
				accrueDueVacationPeriods(berlinOrganizationId, {
					timezone: "Europe/Berlin",
					now: parseInstant("2026-09-30T22:30:00Z"),
				}),
			),
		);

		expect((await accrualRows(berlinEmployeeId)).map((row) => row.accrualMonth)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
		// Owner and employee, ten months each.
		expect(runs[0].rowsWritten + runs[1].rowsWritten).toBe(20);
		expect(runs.map((run) => [run.year, run.throughMonth])).toEqual([
			[2026, 10],
			[2026, 10],
		]);
	});

	it("never catches up a year before 2026", async () => {
		const result = await accrueDueVacationPeriods(berlinOrganizationId, {
			timezone: "Europe/Berlin",
			now: parseInstant("2025-06-15T08:00:00Z"),
		});

		expect(result.rowsWritten).toBe(0);
		const rows = await fixture.db
			.select({ id: vacationAdjustment.id })
			.from(vacationAdjustment)
			.where(
				and(eq(vacationAdjustment.employeeId, berlinEmployeeId), eq(vacationAdjustment.year, 2025)),
			);
		expect(rows).toEqual([]);
	});
});
