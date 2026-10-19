import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { listEmployeeCostRates } from "@/lib/billable-time/cost-rates";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";

describe("current contract type reads", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			fixture.organizationId,
		]);
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, contract_type,
			  weekly_contract_minutes, hourly_rate, currency, review_state, created_by, updated_at)
			 values ($1, $2, $3, '2026-03-10 00:00:00', 'hourly', 2400, 25, 'EUR',
			         'confirmed', $4, now())`,
			[fixture.employeeId, fixture.organizationId, fixture.employmentPeriodId, fixture.ownerUserId],
		);
	});
	afterEach(() => vi.restoreAllMocks());
	afterAll(() => fixture?.close());

	it("updates the cost-rates overview at organization-local midnight without another write", async () => {
		const clock = vi.spyOn(Temporal.Now, "instant");
		clock.mockReturnValue(Temporal.Instant.from("2026-03-09T22:59:59Z"));
		const before = await listEmployeeCostRates(fixture.db, fixture.organizationId);
		expect(before.find((row) => row.employeeId === fixture.employeeId)?.contractType).toBe("fixed");

		clock.mockReturnValue(Temporal.Instant.from("2026-03-09T23:00:00Z"));
		const after = await listEmployeeCostRates(fixture.db, fixture.organizationId);
		expect(after.find((row) => row.employeeId === fixture.employeeId)?.contractType).toBe("hourly");
	});

	it("shows the current contract type in the scoped payroll summary", async () => {
		vi.spyOn(Temporal.Now, "instant").mockReturnValue(
			Temporal.Instant.from("2026-03-09T23:00:00Z"),
		);
		const summary = await getPayrollWorkspaceSummary({
			organizationId: fixture.organizationId,
			allowedEmployeeIds: [fixture.employeeId],
			period: {
				start: DateTime.fromISO("2026-03-01", { zone: "UTC" }),
				end: DateTime.fromISO("2026-03-31", { zone: "UTC" }),
				label: "March 2026",
			},
			generatedBy: { id: fixture.ownerUserId, name: "Owner" },
		});
		expect(summary.employees.map((row) => [row.id, row.contractType])).toEqual([
			[fixture.employeeId, "hourly"],
		]);
	});
});
