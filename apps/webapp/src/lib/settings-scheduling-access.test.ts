import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
	db: {
		query: {
			teamPermissions: { findMany: vi.fn(async () => []) },
			subareaEmployee: { findMany: vi.fn(async () => []) },
			location: { findMany: vi.fn(async () => []) },
			shiftTemplate: { findFirst: vi.fn(async () => null) },
			coverageRule: { findFirst: vi.fn(async () => null) },
		},
	},
}));

vi.mock("@/db/schema", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/db/schema")>()),
	coverageRule: { id: "id" },
	location: { organizationId: "organizationId", createdAt: "createdAt" },
	shiftTemplate: { id: "id" },
	subareaEmployee: { employeeId: "employeeId" },
	teamPermissions: { employeeId: "employeeId" },
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: vi.fn(async () => null),
}));

const {
	canAccessCoverageRuleSettings,
	canAccessShiftTemplateSettings,
	canManageScopedSchedulingSubarea,
	filterItemsToManageableSubareas,
	getManagedShiftTemplateSubareaIds,
	getSchedulingSettingsAccessContext,
} = await import("@/lib/settings-scheduling-access");
const { getCurrentSettingsAccess } = await import("@/lib/auth-helpers");

/** A scoped manager's settings access caller in org-1. */
function callerFor(employee: { id: string; role: "admin" | "manager" }) {
	return {
		userId: "user-1",
		organizationId: "org-1",
		settingsAccess: "scopedManager" as const,
		membershipRole: "member",
		employee,
	};
}

describe("settings scheduling access helpers", () => {
	it.each(["orgAdmin", "owner"] as const)(
		"keeps org-admin parity for %s settings access",
		(settingsAccess) => {
			expect(canAccessShiftTemplateSettings(settingsAccess, false, new Set())).toBe(true);
			expect(canAccessCoverageRuleSettings(settingsAccess, new Set())).toBe(true);
			expect(canManageScopedSchedulingSubarea(settingsAccess, new Set(), undefined)).toBe(true);
		},
	);

	it("requires both team settings and own-team shift-template scope for managers", () => {
		expect(canAccessShiftTemplateSettings("scopedManager", true, new Set(["team-subarea-1"]))).toBe(
			true,
		);
		expect(
			canAccessShiftTemplateSettings("scopedManager", false, new Set(["team-subarea-1"])),
		).toBe(false);
		expect(canAccessShiftTemplateSettings("scopedManager", true, new Set())).toBe(false);
		expect(canAccessShiftTemplateSettings(null, true, new Set(["team-subarea-1"]))).toBe(false);
	});

	it("derives shift-template subareas from manageable teams instead of arbitrary area assignments", () => {
		expect(
			getManagedShiftTemplateSubareaIds({
				manageableTeamIds: new Set(["team-1"]),
				subareaAssignments: [
					{ subareaId: "subarea-1", employeeTeamId: "team-1", employeeOrganizationId: "org-1" },
					{ subareaId: "subarea-2", employeeTeamId: "team-2", employeeOrganizationId: "org-1" },
					{ subareaId: "subarea-3", employeeTeamId: "team-1", employeeOrganizationId: "org-2" },
				],
				organizationId: "org-1",
			}),
		).toEqual(new Set(["subarea-1"]));
	});

	it("requires at least one manageable area for manager coverage access", () => {
		expect(canAccessCoverageRuleSettings("scopedManager", new Set(["subarea-1"]))).toBe(true);
		expect(canAccessCoverageRuleSettings("scopedManager", new Set())).toBe(false);
		expect(canAccessCoverageRuleSettings(null, new Set(["subarea-1"]))).toBe(false);
	});

	it("denies manager writes outside explicit subarea scope", () => {
		const manageableSubareaIds = new Set(["subarea-1"]);

		expect(
			canManageScopedSchedulingSubarea("scopedManager", manageableSubareaIds, "subarea-1"),
		).toBe(true);
		expect(
			canManageScopedSchedulingSubarea("scopedManager", manageableSubareaIds, "subarea-2"),
		).toBe(false);
		expect(canManageScopedSchedulingSubarea("scopedManager", manageableSubareaIds, undefined)).toBe(
			false,
		);
	});

	it("filters lists down to manageable subareas for managers", () => {
		const items = [
			{ id: "rule-1", subareaId: "subarea-1" },
			{ id: "rule-2", subareaId: "subarea-2" },
			{ id: "rule-3", subareaId: null },
		];

		expect(filterItemsToManageableSubareas(items, null)).toEqual(items);
		expect(filterItemsToManageableSubareas(items, new Set(["subarea-2"]))).toEqual([
			{ id: "rule-2", subareaId: "subarea-2" },
		]);
	});

	it("opens every coverage rule, but no shift template or coverage setting, to a workforce admin", async () => {
		vi.mocked(getCurrentSettingsAccess).mockResolvedValueOnce(
			callerFor({ id: "employee-workforce-admin", role: "admin" }),
		);

		const context = await getSchedulingSettingsAccessContext();

		expect(context).toMatchObject({
			organizationId: "org-1",
			canAccessCoverageRules: true,
			manageableSubareaIds: null,
			canManageCoverageSettings: false,
			canAccessShiftTemplates: false,
			canManageTeamSettings: false,
		});
		expect(context?.manageableShiftTemplateSubareaIds).toEqual(new Set());
	});

	it("keeps a scoped manager without an assigned subarea out of coverage rules", async () => {
		vi.mocked(getCurrentSettingsAccess).mockResolvedValueOnce(
			callerFor({ id: "employee-manager", role: "manager" }),
		);

		const context = await getSchedulingSettingsAccessContext();

		expect(context).toMatchObject({
			canAccessCoverageRules: false,
			canAccessShiftTemplates: false,
		});
		expect(context?.manageableSubareaIds).toEqual(new Set());
	});

	it("refuses former employees and unapproved members from scheduling settings", async () => {
		vi.mocked(getCurrentSettingsAccess).mockResolvedValueOnce({
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: null,
			membershipRole: null,
			employee: null,
		});

		await expect(getSchedulingSettingsAccessContext()).resolves.toBeNull();
	});

	it("uses directly scoped permission and team-member queries for scheduling access", () => {
		const source = readFileSync(
			new URL("./settings-scheduling-access.ts", import.meta.url),
			"utf8",
		);

		expect(source.includes("eq(teamPermissions.employeeId, currentEmployee.id)")).toBe(true);
		expect(source.includes("db.query.employee.findMany(")).toBe(true);
		expect(source.includes("eq(teamPermissions.organizationId, organizationId)")).toBe(false);
	});
});
