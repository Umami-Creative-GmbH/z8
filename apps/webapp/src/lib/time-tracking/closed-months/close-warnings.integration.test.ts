/**
 * PostgreSQL contract (#1065, spec #805): missing or unapproved period submissions are warnings
 * on the close screen. They never block the close, a pending submission is left to the close
 * blockers, and an organization with the cadence off gets none.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { monthCloseWarnings } from "./close-warnings";
import { closeMonth } from "./store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./testing/closed-month-database.test.fixture";

const now = parseInstant("2026-04-10T12:00:00Z");

describe("close warnings about period submissions on PostgreSQL", () => {
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

	it("warns about every week touching the month without an approved submission, except a pending one", async () => {
		const org = await weeklyOrganization();
		const person = await fixture.employee({ organizationId: org.organizationId });
		const submit = (startDate: string, endDate: string, status: "approved" | "pending" | "rejected") =>
			fixture.periodSubmission({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				submittedBy: person.userId,
				cadence: "weekly",
				startDate,
				endDate,
				status,
			});
		await submit("2026-02-23", "2026-03-01", "approved");
		await submit("2026-03-02", "2026-03-08", "pending");
		await submit("2026-03-09", "2026-03-15", "rejected");

		const warnings = await monthCloseWarnings(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			now,
		});

		const own = warnings.filter((warning) => warning.employeeId === person.employeeId);
		expect(own.map((warning) => [warning.kind, warning.startDate, warning.status])).toEqual([
			["period_submission", "2026-03-09", "rejected"],
			["period_submission", "2026-03-16", "awaiting_submission"],
			["period_submission", "2026-03-23", "awaiting_submission"],
			["period_submission", "2026-03-30", "awaiting_submission"],
		]);
	});

	it("does not block the close for missing submissions", async () => {
		const org = await weeklyOrganization();
		const person = await fixture.employee({ organizationId: org.organizationId });

		const warnings = await monthCloseWarnings(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			now,
		});
		const result = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		expect(warnings.some((warning) => warning.employeeId === person.employeeId)).toBe(true);
		expect(result.kind).toBe("closed");
	});

	it("has no warnings with the cadence off, and none about another organization", async () => {
		const off = await fixture.organization("UTC");
		await fixture.employee({ organizationId: off.organizationId });
		const other = await weeklyOrganization();
		await fixture.employee({ organizationId: other.organizationId });

		const warnings = await monthCloseWarnings(fixture.db, {
			organizationId: off.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			now,
		});

		expect(warnings).toEqual([]);
	});

	it("has no warnings for employees already closed for the month", async () => {
		const org = await weeklyOrganization();
		await fixture.employee({ organizationId: org.organizationId });
		await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});

		const warnings = await monthCloseWarnings(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			now,
		});

		expect(warnings).toEqual([]);
	});
});
