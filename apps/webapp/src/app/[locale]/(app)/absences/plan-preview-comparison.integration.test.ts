/**
 * PostgreSQL contract (#1342): each option of a vacation comparison is the ordinary preview of an
 * independent hypothetical request. Comparison is refused for any category other than an active
 * vacation category that consumes the vacation balance, or one outside the session's
 * organization; it writes nothing and exposes no colleague data.
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
vi.mock("./current-employee", () => ({
	getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: async () => null,
}));

const { getAbsenceComparisonPreview, getAbsencePlanPreview } = await import("./plan-preview");

// Wed 2026-12-30 to Sat 2027-01-02: Wed and Thu in 2026, Fri in 2027.
const acrossNewYear = {
	startDate: "2026-12-30",
	startPeriod: "full_day" as const,
	endDate: "2027-01-02",
	endPeriod: "full_day" as const,
	durationKind: "full_day" as const,
};

// Thu 2026-12-31 22:00 to Fri 2027-01-01 02:00: half a day on the start day only.
const overnightNewYearsEve = {
	startDate: "2026-12-31",
	startPeriod: "am" as const,
	endDate: "2027-01-01",
	endPeriod: "am" as const,
	durationKind: "partial_day" as const,
	startTime: "22:00",
	endTime: "02:00",
};

describe("vacation comparison options", () => {
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

	async function insertCategory(
		organizationId: string,
		category: { type: string; countsAgainstVacation: boolean; isActive?: boolean },
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
			 values ($1, $2, $3, $4, true, $5, $6, now())`,
			[
				id,
				organizationId,
				category.type,
				`${category.type} ${id.slice(0, 8)}`,
				category.countsAgainstVacation,
				category.isActive ?? true,
			],
		);
		return id;
	}

	/** An organization with a 30-day company default policy, a vacation category, a requester. */
	async function seedOrganization() {
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
			 values ($1, 'Annual', '2026-01-01', true, '30', '0', 'annual', $2, now())`,
			[organizationId, owner.userId],
		);
		const vacationId = await insertCategory(organizationId, {
			type: "vacation",
			countsAgainstVacation: true,
		});
		currentEmployee.value = { id: requester.employeeId, organizationId };
		return { organizationId, owner, requester, vacationId };
	}

	async function recordCounts(organizationId: string) {
		const { rows } = await fixture.pool.query<{ absences: string; workflows: string }>(
			`select
				(select count(*) from absence_entry where organization_id = $1) as absences,
				(select count(*) from approval_workflow where organization_id = $1) as workflows`,
			[organizationId],
		);
		return rows[0];
	}

	function withoutEvaluationTime<T extends { evaluatedAt: string }>(data: T) {
		return { ...data, evaluatedAt: "" };
	}

	it("evaluates every option exactly like the ordinary preview, each on its own", async () => {
		const org = await seedOrganization();
		const before = await recordCounts(org.organizationId);

		const crossYear = await getAbsenceComparisonPreview({
			categoryId: org.vacationId,
			...acrossNewYear,
		});
		const overnight = await getAbsenceComparisonPreview({
			categoryId: org.vacationId,
			...overnightNewYearsEve,
		});
		const crossYearAgain = await getAbsenceComparisonPreview({
			categoryId: org.vacationId,
			...acrossNewYear,
		});
		const ordinary = await getAbsencePlanPreview({ categoryId: org.vacationId, ...acrossNewYear });

		expect(crossYear.success && overnight.success && crossYearAgain.success).toBe(true);
		if (!crossYear.success || !overnight.success || !crossYearAgain.success || !ordinary.success) {
			return;
		}
		expect(withoutEvaluationTime(crossYear.data)).toEqual(withoutEvaluationTime(ordinary.data));
		expect(crossYear.data.balances).toEqual([
			expect.objectContaining({ year: 2026, chargedAbsenceDays: 2, remainingAfterRequest: 28 }),
			expect.objectContaining({ year: 2027, chargedAbsenceDays: 1, remainingAfterRequest: 29 }),
		]);
		// Overnight across New Year: half a day on Thursday Dec 31, nothing charged to 2027.
		expect(overnight.data.requestedAbsenceDays).toBe(0.5);
		expect(overnight.data.balances).toEqual([
			expect.objectContaining({ year: 2026, chargedAbsenceDays: 0.5, remainingAfterRequest: 29.5 }),
		]);
		// Another option never deducts from this one.
		expect(withoutEvaluationTime(crossYearAgain.data)).toEqual(
			withoutEvaluationTime(crossYear.data),
		);
		expect(await recordCounts(org.organizationId)).toEqual(before);
	});

	it.each([
		["sick leave", { type: "sick", countsAgainstVacation: false }],
		["another type that counts against vacation", { type: "custom", countsAgainstVacation: true }],
		[
			"vacation that does not consume the balance",
			{ type: "vacation", countsAgainstVacation: false },
		],
	])("refuses to compare %s", async (_label, category) => {
		const org = await seedOrganization();
		const categoryId = await insertCategory(org.organizationId, category);

		const result = await getAbsenceComparisonPreview({ categoryId, ...acrossNewYear });

		expect(result).toEqual({
			success: false,
			error: "This absence type cannot be compared",
			code: "comparison_ineligible",
		});
	});

	it("refuses an inactive vacation category", async () => {
		const org = await seedOrganization();
		const categoryId = await insertCategory(org.organizationId, {
			type: "vacation",
			countsAgainstVacation: true,
			isActive: false,
		});

		const result = await getAbsenceComparisonPreview({ categoryId, ...acrossNewYear });

		expect(result).toEqual({ success: false, error: "Absence category not found" });
	});

	it("refuses another organization's vacation category", async () => {
		const other = await seedOrganization();
		const org = await seedOrganization();

		const result = await getAbsenceComparisonPreview({
			categoryId: other.vacationId,
			...acrossNewYear,
		});

		expect(currentEmployee.value?.organizationId).toBe(org.organizationId);
		expect(result).toEqual({ success: false, error: "Absence category not found" });
	});

	it("shows the requester's own overlaps but nothing about colleagues", async () => {
		const org = await seedOrganization();
		const colleague = await fixture.seedEmployee({
			organizationId: org.organizationId,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		const sickId = await insertCategory(org.organizationId, {
			type: "sick",
			countsAgainstVacation: false,
		});
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, organization_id, category_id, start_date, end_date, status, notes, updated_at)
			 values ($1, $2, $3, '2026-12-30', '2026-12-30', 'approved', 'colleague health note', now()),
			        ($4, $2, $5, '2026-12-31', '2026-12-31', 'pending', null, now())`,
			[colleague.employeeId, org.organizationId, sickId, org.requester.employeeId, org.vacationId],
		);

		const result = await getAbsenceComparisonPreview({
			categoryId: org.vacationId,
			...acrossNewYear,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.overlaps).toEqual([
			expect.objectContaining({
				startDate: "2026-12-31",
				endDate: "2026-12-31",
				status: "pending",
			}),
		]);
		const response = JSON.stringify(result);
		expect(response).not.toContain(colleague.employeeId);
		expect(response).not.toContain(colleague.userId);
		expect(response).not.toContain("colleague health note");
		expect(response).not.toContain(sickId);
	});
});
