/**
 * PostgreSQL contract (#1396): new absence requests of one employee are admitted one at a time.
 * The overlap and per-year balance checks run inside the submission transaction after the
 * employee coordination guard, so submissions at the same moment can neither double-book nor
 * overdraw: exactly one of them is recorded.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: async () => null,
}));

const { requestAbsenceForEmployeeEffect } = await import("./request-absence-effect");

describe("concurrent absence submissions of one employee", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/** An organization with a company default policy and a vacation category; one employee. */
	async function seedOrganization(annualDays: number) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			organizationId,
		]);
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const requester = await fixture.seedEmployee({
			organizationId,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		await fixture.pool.query(
			`insert into vacation_allowance
			 (organization_id, name, start_date, is_company_default, default_annual_days,
				statutory_minimum_days, accrual_type, created_by, updated_at)
			 values ($1, 'Annual', '2026-01-01', true, $2, '0', 'annual', $3, now())`,
			[organizationId, String(annualDays), owner.userId],
		);
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', false, true, true, now())`,
			[categoryId, organizationId],
		);
		return { organizationId, categoryId, requester };
	}

	async function absenceCount(employeeId: string) {
		const { rows } = await fixture.pool.query<{ count: string }>(
			"select count(*) from absence_entry where employee_id = $1",
			[employeeId],
		);
		return Number(rows[0]?.count);
	}

	/** Sends the requests at the same moment; without the guard several of them pass. */
	function submitAll(
		org: Awaited<ReturnType<typeof seedOrganization>>,
		ranges: readonly { startDate: string; endDate: string }[],
	) {
		return Promise.all(
			ranges.map((range) =>
				requestAbsenceForEmployeeEffect(
					{
						categoryId: org.categoryId,
						startDate: range.startDate,
						startPeriod: "full_day",
						endDate: range.endDate,
						endPeriod: "full_day",
					},
					{ id: org.requester.employeeId, organizationId: org.organizationId },
					org.requester.userId,
				),
			),
		);
	}

	it("records exactly one of several overlapping requests", async () => {
		const org = await seedOrganization(30);

		// The same Mon-Tue, 2026-11-02 to 11-03, every time.
		const results = await submitAll(
			org,
			Array.from({ length: 4 }, () => ({ startDate: "2026-11-02", endDate: "2026-11-03" })),
		);

		expect(results.filter((result) => result.success)).toHaveLength(1);
		for (const refused of results.filter((result) => !result.success)) {
			expect(refused).toMatchObject({ success: false, code: "ConflictError" });
		}
		expect(await absenceCount(org.requester.employeeId)).toBe(1);
	});

	it("records exactly one of several requests that each fit the balance but not together", async () => {
		// 3 days of 2026; each request charges 2 (Mon-Tue of a different week).
		const org = await seedOrganization(3);

		const results = await submitAll(org, [
			{ startDate: "2026-11-02", endDate: "2026-11-03" },
			{ startDate: "2026-11-09", endDate: "2026-11-10" },
			{ startDate: "2026-11-16", endDate: "2026-11-17" },
			{ startDate: "2026-11-23", endDate: "2026-11-24" },
		]);

		expect(results.filter((result) => result.success)).toHaveLength(1);
		for (const refused of results.filter((result) => !result.success)) {
			expect(refused).toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: "insufficient_balance",
			});
		}
		expect(await absenceCount(org.requester.employeeId)).toBe(1);
	});
});
