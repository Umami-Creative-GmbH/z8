/**
 * PostgreSQL contract (#1065, spec #805): payroll readiness warns about missing or unapproved
 * period submissions in the run's range. The check never blocks, is scoped to the organization,
 * and does not appear while the organization's submission cadence is off.
 */
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { getPayrollReadiness } from "./get-payroll-readiness";

const april = {
	start: DateTime.fromISO("2026-04-01T00:00:00.000Z", { zone: "utc" }),
	end: DateTime.fromISO("2026-04-30T00:00:00.000Z", { zone: "utc" }),
};
const now = DateTime.fromISO("2026-05-10T12:00:00.000Z", { zone: "utc" });

describe("payroll readiness period submission warning on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function weeklyOrganization() {
		const org = await fixture.organization("UTC");
		await fixture.submissionCadence({
			organizationId: org.organizationId,
			cadence: "weekly",
			changedAt: "2026-01-01T00:00:00Z",
			changedBy: org.ownerUserId,
		});
		return org;
	}

	const periodSubmissionCheck = (result: Awaited<ReturnType<typeof getPayrollReadiness>>) =>
		result.groups
			.flatMap((group) => group.checks)
			.find((check) => check.id === "period-submissions");

	it("warns about every week overlapping the range without an approved submission", async () => {
		const org = await weeklyOrganization();
		const person = await fixture.employee({ organizationId: org.organizationId });
		await fixture.periodSubmission({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			submittedBy: person.userId,
			cadence: "weekly",
			startDate: "2026-04-06",
			endDate: "2026-04-12",
			status: "approved",
		});
		await fixture.periodSubmission({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			submittedBy: person.userId,
			cadence: "weekly",
			startDate: "2026-04-13",
			endDate: "2026-04-19",
			status: "pending",
		});
		const stranger = await weeklyOrganization();
		const foreigner = await fixture.employee({ organizationId: stranger.organizationId });

		const result = await getPayrollReadiness({
			organizationId: org.organizationId,
			period: april,
			now,
		});

		const check = periodSubmissionCheck(result);
		// Five weeks overlap April for the owner and the employee; one of the employee's is approved.
		expect(check).toMatchObject({
			status: "warning",
			severity: "warning",
			required: false,
			count: 9,
		});
		const affected = check?.affectedEmployees.map((employee) => employee.id) ?? [];
		expect(affected).toContain(person.employeeId);
		expect(affected).not.toContain(foreigner.employeeId);
	});

	it("has no period submission check while the cadence is off", async () => {
		const org = await fixture.organization("UTC");
		await fixture.employee({ organizationId: org.organizationId });

		const result = await getPayrollReadiness({
			organizationId: org.organizationId,
			period: april,
			now,
		});

		expect(periodSubmissionCheck(result)).toBeUndefined();
	});
});
