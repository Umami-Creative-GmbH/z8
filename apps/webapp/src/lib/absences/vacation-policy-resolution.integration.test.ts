/**
 * Every vacation balance reader resolves the same policy for a year: the organization's company
 * default in effect during the year with the newest start. A policy that replaces another
 * mid-year therefore applies to the whole year on the Absences page, the dashboard, the manager
 * view, the admin vacation pages and the proration notice alike. Against PostgreSQL; only the
 * session is replaced.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.setConfig({ testTimeout: 60_000 });

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", email: `${harness.userId}@example.test` },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

const { getVacationBalance } = await import("@/app/[locale]/(app)/absences/queries");
const { getEmployeesWithAllowances, getEmployeeVacationBalance } = await import(
	"@/app/[locale]/(app)/settings/vacation/actions"
);
const { getManagerAbsenceEmployees } = await import("@/app/[locale]/(app)/team/absences/actions");
const { vacationAllowance } = await import("@/db/schema");
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
const { loadProrationNotice } = await import("./proration-notice-store");
const { getEnhancedVacationBalance } = await import("./vacation.service");

const utcDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("one vacation policy per year for every balance reader", () => {
	let fixture: LifecycleDatabaseFixture;
	let foreignOrganizationId: string;
	let joinerId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();

		// Joined on 1 October 2026: 3 of 12 months.
		joinerId = (await fixture.seedEmployee({ startDate: utcDate("2026-10-01"), withPeriod: false }))
			.employeeId;

		await fixture.db.insert(vacationAllowance).values([
			// Replaced on 1 July 2026 by the 30-day policy below.
			{
				organizationId: fixture.organizationId,
				name: "Until June",
				startDate: "2025-01-01",
				validUntil: "2026-06-30",
				isCompanyDefault: true,
				defaultAnnualDays: "24",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId: fixture.organizationId,
				name: "From July",
				startDate: "2026-07-01",
				isCompanyDefault: true,
				defaultAnnualDays: "30",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			},
			// Not the company default: a team or employee policy never sets the year's allowance here.
			{
				organizationId: fixture.organizationId,
				name: "Team policy",
				startDate: "2026-01-01",
				isCompanyDefault: false,
				defaultAnnualDays: "40",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			},
		]);

		// Another organization's newer default never applies.
		foreignOrganizationId = await fixture.createOrganization();
		await fixture.db.insert(vacationAllowance).values({
			organizationId: foreignOrganizationId,
			name: "Foreign",
			startDate: "2026-09-01",
			isCompanyDefault: true,
			defaultAnnualDays: "10",
			statutoryMinimumDays: "10",
			accrualType: "annual",
			createdBy: fixture.ownerUserId,
		});
	});

	beforeEach(() => {
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("applies the policy that started last in the year on every page", async () => {
		const absencesPage = await getVacationBalance(fixture.employeeId, 2026, "UTC");
		const dashboard = await getEnhancedVacationBalance({
			employeeId: fixture.employeeId,
			year: 2026,
			timezone: "UTC",
		});
		const managerView = await getManagerAbsenceEmployees({ year: 2026 });
		const adminList = await getEmployeesWithAllowances(fixture.organizationId, 2026);
		if (!managerView.success) throw new Error(managerView.error);
		if (!adminList.success) throw new Error(adminList.error);

		expect(absencesPage).toMatchObject({ totalDays: 30, remainingDays: 30 });
		expect(dashboard).toMatchObject({ totalDays: 30, remainingDays: 30, baseAllowance: 30 });
		expect(managerView.data.rows.find((row) => row.id === fixture.employeeId)).toMatchObject({
			vacationAllowance: 30,
			remainingVacationDays: 30,
		});
		expect(
			adminList.data.find((employee) => employee.id === fixture.employeeId)?.vacationBalance,
		).toEqual(absencesPage);

		// The employee's admin page shows the organization's current year.
		const adminPage = await getEmployeeVacationBalance(fixture.employeeId);
		if (!adminPage.success) throw new Error(adminPage.error);
		expect(adminPage.data.balance).toEqual(
			await getVacationBalance(fixture.employeeId, adminPage.data.year, "UTC"),
		);
	});

	it("prorates a joiner from the same policy on every page and in the notice", async () => {
		// 30 × 3/12 = 7.5, rounded up to 8.
		const absencesPage = await getVacationBalance(joinerId, 2026, "UTC");
		const dashboard = await getEnhancedVacationBalance({
			employeeId: joinerId,
			year: 2026,
			timezone: "UTC",
		});
		const managerView = await getManagerAbsenceEmployees({ year: 2026 });
		const notice = await loadProrationNotice(fixture.db, {
			organizationId: fixture.organizationId,
		});
		if (!managerView.success) throw new Error(managerView.error);

		expect(absencesPage).toMatchObject({
			totalDays: 8,
			allowance: { fullAllowance: 30, days: 8 },
		});
		expect(dashboard).toMatchObject({ totalDays: 8, baseAllowance: 8 });
		expect(managerView.data.rows.find((row) => row.id === joinerId)).toMatchObject({
			vacationAllowance: 8,
			proratedAllowance: absencesPage?.allowance,
		});
		expect(notice).toEqual([
			expect.objectContaining({
				employeeId: joinerId,
				fullAllowance: 30,
				proratedAllowance: 8,
				allowance: absencesPage?.allowance,
			}),
		]);
	});
});
