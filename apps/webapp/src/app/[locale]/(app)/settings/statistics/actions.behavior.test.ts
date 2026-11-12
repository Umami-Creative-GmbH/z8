import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	teamPermissionsRows: [] as Array<{ teamId: string | null }>,
	teamScopedEmployees: [] as Array<{ id: string; isActive: boolean }>,
	selectResults: [] as Array<Array<{ count: number }>>,
	select: vi.fn(),
}));

const db = vi.hoisted(() => ({
	select: () => {
		mocks.select();
		return {
			from: () => ({
				where: async () => mocks.selectResults.shift() ?? [{ count: 0 }],
			}),
		};
	},
	query: {
		organization: { findFirst: async () => ({ timezone: "Europe/Berlin" }) },
		teamPermissions: { findMany: async () => mocks.teamPermissionsRows },
		employee: { findMany: async () => mocks.teamScopedEmployees },
	},
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db }));
});

const { getManagerStatisticsReadView, getOrganizationStats } = await import("./actions");

const owner: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const manager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};
const workforceAdmin: StubCaller = {
	...manager,
	employee: { id: "employee-workforce-admin", role: "admin", former: false },
};
const orgMember: StubCaller = {
	...manager,
	employee: { id: "employee-member", role: "employee", former: false },
};

const refused = { success: false, code: "AuthorizationError" };

describe("statistics actions", () => {
	beforeEach(() => {
		mocks.caller = manager;
		mocks.teamPermissionsRows = [{ teamId: "team-managed" }];
		mocks.teamScopedEmployees = [
			{ id: "employee-1", isActive: true },
			{ id: "employee-2", isActive: false },
		];
		mocks.selectResults = [];
		mocks.select.mockClear();
	});

	it("returns only team-scoped analytics for manager read access", async () => {
		mocks.selectResults = [
			[{ count: 1 }],
			[{ count: 6 }],
			[{ count: 4 }],
			[{ count: 2 }],
			[{ count: 3 }],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 2 }],
			[{ count: 1 }],
		];

		const result = await getManagerStatisticsReadView();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toMatchObject({
			totalEmployees: 2,
			activeEmployees: 1,
			inactiveEmployees: 1,
			totalTeams: 1,
			totalTimeEntries: 6,
			timeEntriesThisMonth: 4,
			timeEntriesLastMonth: 2,
			totalAbsences: 3,
			pendingAbsences: 1,
			approvedAbsences: 1,
			rejectedAbsences: 1,
			totalApprovals: 2,
			pendingApprovals: 1,
		});
		expect(result.data).not.toHaveProperty("activeSessions");
		expect(typeof result.data.fetchedAt).toBe("string");
	});

	it("gives a workforce admin, whose employee role is not manager, empty statistics as before", async () => {
		mocks.caller = workforceAdmin;

		const result = await getManagerStatisticsReadView();

		expect(result).toMatchObject({ success: true, data: { totalEmployees: 0, totalTeams: 0 } });
		expect(mocks.select).not.toHaveBeenCalled();
	});

	it("refuses an org member the manager statistics", async () => {
		mocks.caller = orgMember;

		await expect(getManagerStatisticsReadView()).resolves.toMatchObject(refused);
	});

	it("keeps owner and admin parity with active-organization statistics only", async () => {
		mocks.caller = owner;
		mocks.selectResults = [
			[{ count: 8 }],
			[{ count: 6 }],
			[{ count: 4 }],
			[{ count: 30 }],
			[{ count: 12 }],
			[{ count: 9 }],
			[{ count: 7 }],
			[{ count: 2 }],
			[{ count: 3 }],
			[{ count: 2 }],
			[{ count: 6 }],
			[{ count: 1 }],
			[{ count: 5 }],
		];

		const result = await getOrganizationStats();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toMatchObject({
			totalEmployees: 8,
			activeEmployees: 6,
			inactiveEmployees: 2,
			totalTeams: 4,
			totalTimeEntries: 30,
			timeEntriesThisMonth: 12,
			timeEntriesLastMonth: 9,
			totalAbsences: 7,
			pendingAbsences: 2,
			approvedAbsences: 3,
			rejectedAbsences: 2,
			totalApprovals: 6,
			pendingApprovals: 1,
			activeSessions: 5,
		});
	});

	it("refuses a scoped manager the org-wide statistics", async () => {
		await expect(getOrganizationStats()).resolves.toMatchObject(refused);
		expect(mocks.select).not.toHaveBeenCalled();
	});

	it("refuses a former owner the org-wide statistics", async () => {
		mocks.caller = { ...owner, employee: { id: "employee-owner", role: "admin", former: true } };

		await expect(getOrganizationStats()).resolves.toMatchObject(refused);
	});
});
