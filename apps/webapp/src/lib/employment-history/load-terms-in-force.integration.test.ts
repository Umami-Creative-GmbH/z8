/**
 * PostgreSQL contract for the terms-in-force loader (#1174): confirmed terms
 * only, scoped to one organization, with the wage read as a number.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadConfirmedTermsSpans, loadTermsInForceOn } from "./load-terms-in-force";

describe("terms in force loader", () => {
	let fixture: LifecycleDatabaseFixture;
	let otherOrganizationId: string;

	async function seedTerms(input: {
		organizationId: string;
		employmentPeriodId: string | null;
		validFrom: string;
		validUntil: string | null;
		hourlyRate: string | null;
		reviewState: "draft" | "pending" | "confirmed";
	}) {
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, valid_until,
			  contract_type, weekly_contract_minutes, hourly_rate, currency, review_state,
			  created_by, updated_at)
			 values ($1, $2, $3, $4, $5, 'hourly', 2400, $6, 'EUR', $7, $8, now())`,
			[
				fixture.employeeId,
				input.organizationId,
				input.employmentPeriodId,
				input.validFrom,
				input.validUntil,
				input.hourlyRate,
				input.reviewState,
				fixture.ownerUserId,
			],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		otherOrganizationId = await fixture.createOrganization();
		const own = {
			organizationId: fixture.organizationId,
			employmentPeriodId: fixture.employmentPeriodId,
		};
		await seedTerms({
			...own,
			validFrom: "2026-01-01 00:00:00",
			validUntil: "2026-03-10 00:00:00",
			hourlyRate: "20.00",
			reviewState: "confirmed",
		});
		await seedTerms({
			...own,
			validFrom: "2026-03-10 00:00:00",
			validUntil: null,
			hourlyRate: "25.50",
			reviewState: "confirmed",
		});
		await seedTerms({
			...own,
			validFrom: "2026-03-20 00:00:00",
			validUntil: null,
			hourlyRate: "99.00",
			reviewState: "draft",
		});
		// A row filed under another organization never counts for this one.
		await seedTerms({
			organizationId: otherOrganizationId,
			employmentPeriodId: null,
			validFrom: "2026-03-15 00:00:00",
			validUntil: null,
			hourlyRate: "77.00",
			reviewState: "confirmed",
		});
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("returns the organization's confirmed terms overlapping a range, wage as a number", async () => {
		const spans = await loadConfirmedTermsSpans(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			range: { from: parsePlainDate("2026-03-01"), toExclusive: parsePlainDate("2026-04-01") },
			timezone: "Europe/Berlin",
		});

		expect(
			spans.map((span) => [
				span.from.toString(),
				span.until?.toString() ?? null,
				span.terms.hourlyRate,
			]),
		).toEqual([
			["2026-01-01", "2026-03-10", 20],
			["2026-03-10", null, 25.5],
		]);
	});

	it("finds the terms in force on a boundary day", async () => {
		const input = {
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			timezone: "America/New_York",
		};

		expect(
			(await loadTermsInForceOn(fixture.db, { ...input, date: parsePlainDate("2026-03-09") }))
				?.hourlyRate,
		).toBe(20);
		expect(
			(await loadTermsInForceOn(fixture.db, { ...input, date: parsePlainDate("2026-03-10") }))
				?.hourlyRate,
		).toBe(25.5);
	});

	it("reads only the given organization's terms, in its own timezone", async () => {
		const spans = await loadConfirmedTermsSpans(fixture.db, {
			organizationId: otherOrganizationId,
			employeeId: fixture.employeeId,
			range: { from: parsePlainDate("2026-01-01"), toExclusive: parsePlainDate("2026-12-31") },
		});

		expect(spans.map((span) => span.terms.hourlyRate)).toEqual([77]);
	});
});
