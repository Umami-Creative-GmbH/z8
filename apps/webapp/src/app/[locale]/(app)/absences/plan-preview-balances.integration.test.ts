/**
 * PostgreSQL contract (#1340): the absence plan preview and the request submission judge a
 * request's vacation per calendar year, against each year's recorded balance from the shared
 * balance computation. A year without a vacation policy is unavailable, never zero, and never
 * blocks the request.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const currentEmployee = vi.hoisted(() => ({
	value: null as { id: string; organizationId: string } | null,
}));

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
vi.mock("./current-employee", () => ({
	getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: async () => null,
}));

const { getAbsencePlanPreview } = await import("./plan-preview");
const { requestAbsenceForEmployeeEffect } = await import("./request-absence-effect");

// Wed 2026-12-30 to Sat 2027-01-02: Wed and Thu in 2026, Fri in 2027.
const acrossNewYear = {
	startDate: "2026-12-30",
	startPeriod: "full_day" as const,
	endDate: "2027-01-02",
	endPeriod: "full_day" as const,
};

describe("vacation balance by calendar year", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	beforeEach(() => {
		currentEmployee.value = null;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/** An organization with a company default policy and a vacation category; one employee. */
	async function seedOrganization(policy: { startDate: string; annualDays: number }) {
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
			 values ($1, 'Annual', $2, true, $3, '0', 'annual', $4, now())`,
			[organizationId, policy.startDate, String(policy.annualDays), owner.userId],
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

	it("previews each year's charged days against that year's recorded balance", async () => {
		const org = await seedOrganization({ startDate: "2026-01-01", annualDays: 30 });
		// Mon 2026-06-01 to Fri 06-05: 5 approved days of 2026.
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, organization_id, category_id, start_date, end_date, status, updated_at)
			 values ($1, $2, $3, '2026-06-01', '2026-06-05', 'approved', now())`,
			[org.requester.employeeId, org.organizationId, org.categoryId],
		);
		currentEmployee.value = { id: org.requester.employeeId, organizationId: org.organizationId };

		const result = await getAbsencePlanPreview({ categoryId: org.categoryId, ...acrossNewYear });

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.requestedAbsenceDays).toBe(3);
		expect(result.data.balances).toEqual([
			expect.objectContaining({
				year: 2026,
				chargedAbsenceDays: 2,
				status: "available",
				remainingDays: 25,
				remainingAfterRequest: 23,
			}),
			expect.objectContaining({
				year: 2027,
				chargedAbsenceDays: 1,
				status: "available",
				remainingDays: 30,
				remainingAfterRequest: 29,
			}),
		]);
		expect(Number.isNaN(Date.parse(result.data.evaluatedAt))).toBe(false);
		expect(await absenceCount(org.requester.employeeId)).toBe(1);
	});

	it("shows a year without a vacation policy as unavailable while the other year stays usable", async () => {
		const org = await seedOrganization({ startDate: "2027-01-01", annualDays: 30 });
		currentEmployee.value = { id: org.requester.employeeId, organizationId: org.organizationId };

		const result = await getAbsencePlanPreview({ categoryId: org.categoryId, ...acrossNewYear });

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.balances).toEqual([
			expect.objectContaining({
				year: 2026,
				chargedAbsenceDays: 2,
				status: "unavailable",
				reason: "missing_policy",
			}),
			expect.objectContaining({ year: 2027, status: "available", remainingAfterRequest: 29 }),
		]);
	});

	it("refuses a submission whose days in one year exceed that year's recorded balance", async () => {
		const org = await seedOrganization({ startDate: "2026-01-01", annualDays: 1 });

		const result = await requestAbsenceForEmployeeEffect(
			{ categoryId: org.categoryId, ...acrossNewYear },
			{ id: org.requester.employeeId, organizationId: org.organizationId },
			org.requester.userId,
		);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "insufficient_balance",
			error: "The requested dates exceed your available vacation balance for 2026.",
		});
		expect(await absenceCount(org.requester.employeeId)).toBe(0);
	});

	it("accepts a cross-year submission that each year's balance covers", async () => {
		// 3 days in total exceed one year's 2 days, but each year is charged at most 2.
		const org = await seedOrganization({ startDate: "2026-01-01", annualDays: 2 });

		const result = await requestAbsenceForEmployeeEffect(
			{ categoryId: org.categoryId, ...acrossNewYear },
			{ id: org.requester.employeeId, organizationId: org.organizationId },
			org.requester.userId,
		);

		expect(result).toMatchObject({ success: true });
		expect(await absenceCount(org.requester.employeeId)).toBe(1);
	});

	it("does not block a submission in a year whose balance is unavailable", async () => {
		const org = await seedOrganization({ startDate: "2027-01-01", annualDays: 30 });

		const result = await requestAbsenceForEmployeeEffect(
			{
				categoryId: org.categoryId,
				startDate: "2026-12-28",
				startPeriod: "full_day",
				endDate: "2026-12-29",
				endPeriod: "full_day",
			},
			{ id: org.requester.employeeId, organizationId: org.organizationId },
			org.requester.userId,
		);

		expect(result).toMatchObject({ success: true });
	});
});
