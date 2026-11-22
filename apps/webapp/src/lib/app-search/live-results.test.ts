import { describe, expect, it, vi } from "vitest";
import {
	buildEmployeeSearchConditions,
	getSearchableTeamIds,
	mapEmployeeSearchRow,
	mapTeamSearchRow,
	normalizeAppSearchQuery,
	searchLiveAppResults,
} from "./live-results";

vi.mock("@/db", () => ({ db: {} }));

describe("normalizeAppSearchQuery", () => {
	it("returns a trimmed query when it has at least two characters", () => {
		expect(normalizeAppSearchQuery("  maria  ")).toBe("maria");
		expect(normalizeAppSearchQuery("ab")).toBe("ab");
	});

	it("returns null for empty or single-character queries", () => {
		expect(normalizeAppSearchQuery("")).toBeNull();
		expect(normalizeAppSearchQuery("   ")).toBeNull();
		expect(normalizeAppSearchQuery(" a ")).toBeNull();
	});
});

describe("mapEmployeeSearchRow", () => {
	it("builds a safe employee search result with compact details", () => {
		expect(
			mapEmployeeSearchRow({
				employeeId: "emp-1",
				firstName: "Maria",
				lastName: "Muster",
				name: "Maria M.",
				email: "maria@example.com",
				image: "https://example.com/maria.png",
				gender: "female",
				position: "Shift Lead",
				teamName: "Retail",
			}),
		).toEqual({
			type: "employee",
			id: "employee-emp-1",
			title: "Maria Muster",
			subtitle: "Shift Lead · Retail · maria@example.com",
			href: "/settings/employees/emp-1",
			image: "https://example.com/maria.png",
			avatarSeed: "emp-1",
			gender: "female",
		});
	});

	it("falls back from full name to account name and then email", () => {
		expect(
			mapEmployeeSearchRow({
				employeeId: "emp-2",
				firstName: null,
				lastName: null,
				name: "Account Name",
				email: "account@example.com",
				image: null,
				gender: null,
				position: null,
				teamName: null,
			}).title,
		).toBe("Account Name");

		expect(
			mapEmployeeSearchRow({
				employeeId: "emp-3",
				firstName: null,
				lastName: null,
				name: null,
				email: "fallback@example.com",
				image: null,
				gender: null,
				position: null,
				teamName: null,
			}).title,
		).toBe("fallback@example.com");
	});
});

describe("mapTeamSearchRow", () => {
	it("builds a safe team search result", () => {
		expect(
			mapTeamSearchRow({
				teamId: "team-1",
				name: "Operations",
				description: "Main floor team",
			}),
		).toEqual({
			type: "team",
			id: "team-team-1",
			title: "Operations",
			subtitle: "Main floor team",
			href: "/settings/teams/team-1",
		});
	});

	it("omits blank descriptions", () => {
		expect(
			mapTeamSearchRow({
				teamId: "team-2",
				name: "Back Office",
				description: "   ",
			}).subtitle,
		).toBeUndefined();
	});
});

describe("getSearchableTeamIds", () => {
	const teams = [{ id: "team-1" }, { id: "team-2" }, { id: "team-3" }];

	it("returns all organization team ids for org admins and owners", () => {
		for (const settingsAccess of ["orgAdmin", "owner"] as const) {
			expect(
				getSearchableTeamIds({
					settingsAccess,
					teams,
					permissionsByTeamId: new Map(),
				}),
			).toEqual(["team-1", "team-2", "team-3"]);
		}
	});

	it("returns only teams where scoped managers can manage members or settings", () => {
		expect(
			getSearchableTeamIds({
				settingsAccess: "scopedManager",
				teams,
				permissionsByTeamId: new Map([
					["team-1", { canManageTeamMembers: true, canManageTeamSettings: false }],
					["team-2", { canManageTeamMembers: false, canManageTeamSettings: true }],
					["team-3", { canManageTeamMembers: false, canManageTeamSettings: false }],
				]),
			}),
		).toEqual(["team-1", "team-2"]);
	});

	it("returns no teams for members or null settingsAccess", () => {
		for (const settingsAccess of [null, "member"] as const) {
			expect(
				getSearchableTeamIds({
					settingsAccess,
					teams,
					permissionsByTeamId: new Map([
						["team-1", { canManageTeamMembers: true, canManageTeamSettings: true }],
					]),
				}),
			).toEqual([]);
		}
	});
});

describe("buildEmployeeSearchConditions", () => {
	it("returns no access for members or null settingsAccess", () => {
		for (const settingsAccess of [null, "member"] as const) {
			expect(
				buildEmployeeSearchConditions({
					settingsAccess,
					organizationId: "org-1",
					currentEmployeeId: "emp-1",
				}),
			).toBeNull();
		}
	});

	it("returns organization-scoped access for org admins and owners", () => {
		for (const settingsAccess of ["orgAdmin", "owner"] as const) {
			const conditions = buildEmployeeSearchConditions({
				settingsAccess,
				organizationId: "org-1",
				currentEmployeeId: null,
			});

			expect(conditions).not.toBeNull();
			expect(conditions).toHaveLength(1);
		}
	});

	it("returns manager-scoped access only when the current employee exists", () => {
		expect(
			buildEmployeeSearchConditions({
				settingsAccess: "scopedManager",
				organizationId: "org-1",
				currentEmployeeId: null,
			}),
		).toBeNull();

		const conditions = buildEmployeeSearchConditions({
			settingsAccess: "scopedManager",
			organizationId: "org-1",
			currentEmployeeId: "manager-1",
		});

		expect(conditions).not.toBeNull();
		expect(conditions).toHaveLength(2);
	});
});

describe("searchLiveAppResults", () => {
	it("returns empty results without querying when organizationId or settingsAccess is missing", async () => {
		await expect(
			searchLiveAppResults({
				query: "maria",
				settingsAccess: "orgAdmin",
				organizationId: null,
				currentEmployeeId: null,
				permissionsByTeamId: new Map(),
			}),
		).resolves.toEqual({ employees: [], teams: [] });

		await expect(
			searchLiveAppResults({
				query: "maria",
				settingsAccess: null,
				organizationId: "org-1",
				currentEmployeeId: "emp-1",
				permissionsByTeamId: new Map(),
			}),
		).resolves.toEqual({ employees: [], teams: [] });
	});
});
