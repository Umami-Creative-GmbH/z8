import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getVacationBalance } from "@/app/[locale]/(app)/absences/queries";
import { vacationAdjustment, vacationAllowance } from "@/db/schema";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getEnhancedVacationBalance } from "./vacation.service";
import { loadVacationAdjustmentTotal, loadVacationAdjustmentTotals } from "./vacation-adjustments";

describe("vacation adjustment totals (#1105)", () => {
	let fixture: LifecycleDatabaseFixture;
	let foreignEmployeeId: string;
	let unadjustedEmployeeId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignOwner = await fixture.seedEmployee({
			organizationId: foreignOrganizationId,
			role: "owner",
		});
		foreignEmployeeId = (await fixture.seedEmployee({ organizationId: foreignOrganizationId }))
			.employeeId;
		unadjustedEmployeeId = (await fixture.seedEmployee()).employeeId;

		await fixture.db.insert(vacationAllowance).values({
			organizationId: fixture.organizationId,
			name: "Default",
			startDate: "2026-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "30",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
		await fixture.db.insert(vacationAdjustment).values([
			{
				employeeId: fixture.employeeId,
				year: 2026,
				days: "-5",
				reason: "Pro-rated first year",
				adjustedBy: fixture.ownerEmployeeId,
			},
			{
				employeeId: fixture.employeeId,
				year: 2026,
				days: "1.5",
				reason: "Overtime compensation",
				adjustedBy: fixture.ownerEmployeeId,
			},
			{
				employeeId: fixture.employeeId,
				year: 2025,
				days: "10",
				reason: "Previous year",
				adjustedBy: fixture.ownerEmployeeId,
			},
			{
				employeeId: foreignEmployeeId,
				year: 2026,
				days: "7",
				reason: "Other organization",
				adjustedBy: foreignOwner.employeeId,
			},
		]);
	});

	afterAll(async () => {
		// `adjusted_by` does not cascade, so the organization cleanup needs the rows gone first.
		await fixture?.db
			.delete(vacationAdjustment)
			.where(inArray(vacationAdjustment.employeeId, [fixture.employeeId, foreignEmployeeId]));
		await fixture?.close();
	});

	it("sums each employee's adjustments for the year inside the organization only", async () => {
		const totals = await loadVacationAdjustmentTotals(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, unadjustedEmployeeId, foreignEmployeeId],
			year: 2026,
		});

		expect(Object.fromEntries(totals)).toEqual({
			[fixture.employeeId]: -3.5,
			[unadjustedEmployeeId]: 0,
		});
		expect(
			await loadVacationAdjustmentTotal(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: foreignEmployeeId,
				year: 2026,
			}),
		).toBe(0);
		expect(
			await loadVacationAdjustmentTotal(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				year: 2025,
			}),
		).toBe(10);
	});

	it("shows the same adjusted balance on the Absences page and the dashboard", async () => {
		const absencesPage = await getVacationBalance(fixture.employeeId, 2026);
		const dashboard = await getEnhancedVacationBalance({
			employeeId: fixture.employeeId,
			year: 2026,
		});

		expect(absencesPage).toMatchObject({ totalDays: 26.5, remainingDays: 26.5 });
		expect(dashboard).toMatchObject({
			totalDays: 26.5,
			remainingDays: 26.5,
			adjustments: -3.5,
		});
	});
});
