/**
 * PostgreSQL contract (#1000): the projected work balance after time off in lieu reads the
 * stored work balance and the required time of the absence's days not yet counted in it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { loadTimeOffInLieuPreview } from "./time-off-in-lieu-preview.server";

describe("projected work balance after time off in lieu on PostgreSQL", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function hourlyEmployee(balance: { minutes: number; through: string } | null) {
		const org = await fixture.organization("UTC");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query("update employee set contract_type = 'hourly' where id = $1", [
			person.employeeId,
		]);
		await fixture.shift(org, { employeeId: person.employeeId, stored: STORED_SHIFT_DATES.UTC.day });
		if (balance) {
			await fixture.pool.query(
				`insert into employee_work_balance
				 (employee_id, organization_id, actual_minutes, required_minutes, balance_minutes,
					computed_from_date, computed_through_date, computed_at, is_dirty, updated_at)
				 values ($1, $2, 0, 0, $3, '2026-01-01', $4, now(), false, now())`,
				[person.employeeId, org.organizationId, balance.minutes, balance.through],
			);
		}
		return { org, person };
	}

	const day = {
		startDate: SHIFT_DAY,
		startPeriod: "full_day" as const,
		endDate: SHIFT_DAY,
		endPeriod: "full_day" as const,
	};

	it("lowers the stored balance by the day's required time", async () => {
		const { org, person } = await hourlyEmployee({ minutes: 600, through: "2026-10-08" });

		const preview = await loadTimeOffInLieuPreview({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			absence: day,
		});

		expect(preview).toEqual({
			currentBalanceMinutes: 600,
			drawnMinutes: 480,
			projectedBalanceMinutes: 120,
			wouldBeNegative: false,
		});
	});

	it("has no projection without a stored balance", async () => {
		const { org, person } = await hourlyEmployee(null);

		expect(
			await loadTimeOffInLieuPreview({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				absence: day,
			}),
		).toBeNull();
	});

	it("never reads another organization's employee", async () => {
		const { person } = await hourlyEmployee({ minutes: 600, through: "2026-10-08" });
		const other = await fixture.organization("UTC");

		expect(
			await loadTimeOffInLieuPreview({
				organizationId: other.organizationId,
				employeeId: person.employeeId,
				absence: day,
			}),
		).toBeNull();
	});
});
