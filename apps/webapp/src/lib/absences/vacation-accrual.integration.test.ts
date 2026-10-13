import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getVacationBalance } from "@/app/[locale]/(app)/absences/queries";
import { getManagerAbsenceEmployees } from "@/app/[locale]/(app)/team/absences/actions";
import { vacationAdjustment, vacationAllowance } from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { accrueVacationDays, getEnhancedVacationBalance } from "./vacation.service";
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

		for (const month of [1, 2, 3]) {
			await accrueVacationDays(fixture.organizationId, month, 2026, "UTC");
		}
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
			})
			.from(vacationAdjustment)
			.where(
				and(
					eq(vacationAdjustment.employeeId, fixture.employeeId),
					eq(vacationAdjustment.year, 2026),
				),
			);

		expect(rows).toEqual(
			Array.from({ length: 3 }, () => ({ days: "2.00", kind: "accrual", adjustedBy: null })),
		);
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
		const backfill = migration
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim())
			.find((statement) => statement.startsWith("UPDATE"));
		expect(backfill).toBeDefined();
		await fixture.pool.query(backfill as string);

		const rows = await fixture.db
			.select({ reason: vacationAdjustment.reason, kind: vacationAdjustment.kind })
			.from(vacationAdjustment)
			.where(eq(vacationAdjustment.employeeId, fixture.employeeId));
		expect(Object.fromEntries(rows.map((row) => [row.reason, row.kind]))).toEqual({
			"Monthly accrual for March 2025: +2.50 days": "accrual",
			"Pro-rated first year": "manual",
		});
	});
});
