/**
 * PostgreSQL contract (#1000): an approved absence releases its days' required time unless
 * its category draws on the work balance (time off in lieu), whose required time still
 * counts, full day or half day, so the work balance falls by it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { getDailyWorkRequirementsForEmployee } from "./work-policy-requirements";

type CategoryKind = "time_off_in_lieu" | "vacation";

describe("required time on approved absences", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/** An hourly employee with an 8-hour published shift on `SHIFT_DAY`, absent that day. */
	async function absentOnShiftDay(input: {
		category: CategoryKind;
		period?: "full_day" | "am" | "pm";
		status?: "approved" | "pending";
	}) {
		const org: ShiftTestOrganization = await fixture.organization("UTC");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query("update employee set contract_type = 'hourly' where id = $1", [
			person.employeeId,
		]);
		await fixture.shift(org, { employeeId: person.employeeId, stored: STORED_SHIFT_DATES.UTC.day });

		const categoryId = randomUUID();
		const timeOffInLieu = input.category === "time_off_in_lieu";
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_work_time, counts_against_vacation,
				draws_on_work_balance, updated_at)
			 values ($1, $2, $3, $4, false, $5, $6, now())`,
			[
				categoryId,
				org.organizationId,
				input.category,
				timeOffInLieu ? "Time off in lieu" : "Vacation",
				!timeOffInLieu,
				timeOffInLieu,
			],
		);
		const period = input.period ?? "full_day";
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, category_id, organization_id, start_date, start_period, end_date, end_period,
				status, updated_at)
			 values ($1, $2, $3, $4, $5, $4, $5, $6, now())`,
			[
				person.employeeId,
				categoryId,
				org.organizationId,
				SHIFT_DAY,
				period,
				input.status ?? "approved",
			],
		);

		const requirements = await getDailyWorkRequirementsForEmployee({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			startDate: new Date(`${SHIFT_DAY}T00:00:00.000Z`),
			endDate: new Date(`${SHIFT_DAY}T23:59:59.999Z`),
			timezone: "UTC",
		});
		return requirements[SHIFT_DAY]?.requiredMinutes ?? 0;
	}

	it("keeps the whole day's required time on an approved full day of time off in lieu", async () => {
		expect(await absentOnShiftDay({ category: "time_off_in_lieu" })).toBe(480);
	});

	it("keeps the whole day's required time on an approved half day of time off in lieu", async () => {
		expect(await absentOnShiftDay({ category: "time_off_in_lieu", period: "am" })).toBe(480);
	});

	it("releases the day's required time on an approved vacation day", async () => {
		expect(await absentOnShiftDay({ category: "vacation" })).toBe(0);
	});

	it("releases half the day's required time on an approved vacation half day", async () => {
		expect(await absentOnShiftDay({ category: "vacation", period: "pm" })).toBe(240);
	});
});
