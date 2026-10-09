import { describe, expect, it } from "vitest";
import { defineAbilityFor } from "@/lib/authorization/ability";
import { PERMISSION_REGISTRY } from "@/lib/authorization/permission-registry";
import type { PrincipalContext } from "@/lib/authorization/types";
import {
	mayViewEveryonesPositionStamps,
	type PositionStampViewer,
	positionStampAccess,
} from "./viewer";

const SUBJECT = "employee-subject";

function viewer(overrides: Partial<PositionStampViewer>): PositionStampViewer {
	return {
		organizationId: "org-1",
		userId: "user-viewer",
		ownEmployeeId: null,
		organizationWide: null,
		...overrides,
	};
}

describe("positionStampAccess", () => {
	it("lets an employee see their own stamps without an access-log entry", () => {
		expect(positionStampAccess(viewer({ ownEmployeeId: SUBJECT }), SUBJECT)).toEqual({
			allowed: true,
			basis: "self",
			logged: false,
		});
	});

	it("does not log an owner viewing their own stamps", () => {
		expect(
			positionStampAccess(viewer({ ownEmployeeId: SUBJECT, organizationWide: "owner" }), SUBJECT),
		).toEqual({ allowed: true, basis: "self", logged: false });
	});

	it.each(["owner", "admin", "permission"] as const)(
		"lets a viewer with %s access see another employee's stamps, logged",
		(basis) => {
			expect(
				positionStampAccess(
					viewer({ ownEmployeeId: "employee-viewer", organizationWide: basis }),
					SUBJECT,
				),
			).toEqual({ allowed: true, basis, logged: true });
		},
	);

	it("refuses an employee (manager or not) without organization-wide access", () => {
		expect(positionStampAccess(viewer({ ownEmployeeId: "employee-manager" }), SUBJECT)).toEqual({
			allowed: false,
		});
	});

	it("refuses a user who is neither the employee nor permitted", () => {
		expect(positionStampAccess(viewer({}), SUBJECT)).toEqual({ allowed: false });
	});
});

describe("mayViewEveryonesPositionStamps", () => {
	it("is true only for owners, admins and permission holders", () => {
		expect(mayViewEveryonesPositionStamps(viewer({ organizationWide: "owner" }))).toBe(true);
		expect(mayViewEveryonesPositionStamps(viewer({ organizationWide: "admin" }))).toBe(true);
		expect(mayViewEveryonesPositionStamps(viewer({ organizationWide: "permission" }))).toBe(true);
		expect(mayViewEveryonesPositionStamps(viewer({ ownEmployeeId: SUBJECT }))).toBe(false);
	});
});

describe("view position stamps permission", () => {
	it("is in the permission registry so custom roles can grant it", () => {
		expect(PERMISSION_REGISTRY["read:PositionStamp"]).toMatchObject({
			action: "read",
			subject: "PositionStamp",
			category: "time_tracking",
		});
	});

	it.each(["admin", "manager", "employee"] as const)(
		"is never implied by the %s employee role",
		(role) => {
			const principal: PrincipalContext = {
				userId: "user-1",
				isPlatformAdmin: false,
				activeOrganizationId: "org-1",
				orgMembership: { organizationId: "org-1", role: "member", status: "approved" },
				employee: { id: "employee-1", organizationId: "org-1", role, teamId: "team-1" },
				permissions: { orgWide: null, byTeamId: new Map() },
				managedEmployeeIds: role === "manager" ? ["employee-2"] : [],
				customRoles: [],
			};
			expect(defineAbilityFor(principal).can("read", "PositionStamp")).toBe(false);
		},
	);
});
