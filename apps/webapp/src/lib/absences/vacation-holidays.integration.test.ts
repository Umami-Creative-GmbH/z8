import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getVacationBalance } from "@/app/[locale]/(app)/absences/queries";
import {
	absenceCategory,
	absenceEntry,
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayCategoryAssignment,
	vacationAllowance,
} from "@/db/schema";
import {
	getAssignedHolidayDateKeys,
	getAssignedHolidaysForEmployee,
} from "@/lib/calendar/assigned-holidays";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getPendingVacationRequests, getVacationTakenInYear } from "@/lib/query/vacation.queries";
import { getEnhancedVacationBalance } from "./vacation.service";

const migration = await readFile(
	new URL("../../../drizzle/0112_yearly_holiday_recovery.sql", import.meta.url),
	"utf8",
);

describe("existing vacation requests and assigned company holidays", () => {
	let fixture: LifecycleDatabaseFixture;
	let categoryId: string;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const [category] = await fixture.db
			.insert(holidayCategory)
			.values({
				organizationId: fixture.organizationId,
				type: "company_holiday",
				name: "Company closed",
			})
			.returning();
		categoryId = category.id;
		await fixture.db.insert(holidayCategoryAssignment).values({
			organizationId: fixture.organizationId,
			categoryId,
			assignmentType: "organization",
			createdBy: fixture.ownerUserId,
		});
		await fixture.db.insert(holiday).values([
			{
				organizationId: fixture.organizationId,
				categoryId,
				name: "Weihnachten",
				startDate: new Date("2026-12-24T00:00:00Z"),
				endDate: new Date("2026-12-24T00:00:00Z"),
				recurrenceType: "yearly",
				recurrenceRule: JSON.stringify({ month: 2, day: 24 }),
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId: fixture.organizationId,
				categoryId,
				name: "Silvester",
				startDate: new Date("2026-12-31T00:00:00Z"),
				endDate: new Date("2026-12-31T00:00:00Z"),
				recurrenceType: "yearly",
				recurrenceRule: JSON.stringify({ month: 12, day: 31 }),
				createdBy: fixture.ownerUserId,
			},
		]);
		await fixture.db.insert(vacationAllowance).values({
			organizationId: fixture.organizationId,
			name: "Default",
			startDate: "2026-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "30",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
		const [vacation] = await fixture.db
			.insert(absenceCategory)
			.values({
				organizationId: fixture.organizationId,
				name: "Vacation",
				type: "vacation",
			})
			.returning();
		await fixture.db.insert(absenceEntry).values([
			{
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				categoryId: vacation.id,
				startDate: "2026-12-28",
				endDate: "2026-12-31",
				status: "approved",
			},
			{
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
				categoryId: vacation.id,
				startDate: "2026-12-24",
				endDate: "2026-12-24",
				status: "pending",
			},
		]);
	});
	afterAll(async () => {
		await fixture?.close();
	});

	it("restores the deducted day on employee, enhanced and reporting balance reads", async () => {
		const balance = await getVacationBalance(fixture.employeeId, 2026);
		const enhanced = await getEnhancedVacationBalance({
			employeeId: fixture.employeeId,
			year: 2026,
		});
		expect(balance).toMatchObject({
			usedDays: 3,
			pendingDays: 0,
			remainingDays: 27,
		});
		expect(enhanced).toMatchObject({
			usedDays: 3,
			pendingDays: 0,
			remainingDays: 27,
		});
		expect((await getVacationTakenInYear(fixture.employeeId, 2026)).totalDays).toBe(3);
		expect((await getPendingVacationRequests(fixture.organizationId))[0]?.days).toBe(0);
	});

	it("recalculates pending requests and legacy requests without organization linkage", async () => {
		await fixture.pool.query(
			"update absence_entry set status = 'pending', organization_id = null where employee_id = $1 and start_date = '2026-12-28'",
			[fixture.employeeId],
		);
		try {
			expect(await getVacationBalance(fixture.employeeId, 2026)).toMatchObject({
				usedDays: 0,
				pendingDays: 3,
				remainingDays: 27,
			});
			expect(
				await getEnhancedVacationBalance({ employeeId: fixture.employeeId, year: 2026 }),
			).toMatchObject({ usedDays: 0, pendingDays: 3, remainingDays: 27 });
		} finally {
			await fixture.pool.query(
				"update absence_entry set status = 'approved', organization_id = $2 where employee_id = $1 and start_date = '2026-12-28'",
				[fixture.employeeId, fixture.organizationId],
			);
		}
	});

	it("renders December 24 in successive calendar years despite the legacy February rule", async () => {
		const holidays = await getAssignedHolidaysForEmployee({
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			startDate: new Date("2026-12-01T00:00:00Z"),
			endDate: new Date("2027-12-31T23:59:59Z"),
		});
		expect([...getAssignedHolidayDateKeys(holidays)].sort()).toEqual([
			"2026-12-24",
			"2026-12-31",
			"2027-12-24",
			"2027-12-31",
		]);
	});

	it("deduplicates category and direct assignments and rejects a different organization", async () => {
		const [silvester] = await fixture.pool
			.query("select id from holiday where organization_id = $1 and name = 'Silvester'", [
				fixture.organizationId,
			])
			.then((result) => result.rows);
		await fixture.db.insert(holidayAssignment).values({
			organizationId: fixture.organizationId,
			holidayId: silvester.id,
			assignmentType: "employee",
			employeeId: fixture.employeeId,
			createdBy: fixture.ownerUserId,
		});
		expect((await getVacationBalance(fixture.employeeId, 2026))?.usedDays).toBe(3);
		const foreignOrganization = await fixture.createOrganization();
		expect(
			await getAssignedHolidaysForEmployee({
				organizationId: foreignOrganization,
				employeeId: fixture.employeeId,
				startDate: new Date("2026-01-01T00:00:00Z"),
				endDate: new Date("2026-12-31T23:59:59Z"),
			}),
		).toEqual([]);
	});

	it("repairs persisted rules idempotently while preserving request dates and balances", async () => {
		await fixture.pool.query(migration);
		const repaired = await fixture.pool.query(
			"select name, recurrence_rule, updated_at from holiday where organization_id = $1 order by name",
			[fixture.organizationId],
		);
		expect(repaired.rows.map((row) => [row.name, row.recurrence_rule])).toEqual([
			["Silvester", '{"month":12,"day":31}'],
			["Weihnachten", '{"month":12,"day":24}'],
		]);
		await fixture.pool.query(migration);
		expect(
			(
				await fixture.pool.query(
					"select name, recurrence_rule, updated_at from holiday where organization_id = $1 order by name",
					[fixture.organizationId],
				)
			).rows,
		).toEqual(repaired.rows);
		expect((await getVacationBalance(fixture.employeeId, 2026))?.remainingDays).toBe(27);
		expect(
			(
				await fixture.pool.query(
					"select start_date::text, end_date::text from absence_entry where organization_id = $1 and status = 'approved'",
					[fixture.organizationId],
				)
			).rows,
		).toEqual([{ start_date: "2026-12-28", end_date: "2026-12-31" }]);
	});
});
