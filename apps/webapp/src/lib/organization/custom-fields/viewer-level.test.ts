import { describe, expect, it } from "vitest";
import {
	canEditCustomField,
	canViewCustomField,
	resolveCustomFieldViewerLevel,
} from "./viewer-level";

const activeEmployee = (role: "admin" | "manager" | "employee") => ({ role, isActive: true });

describe("resolveCustomFieldViewerLevel", () => {
	it("gives org owners and admins the admin level, with or without an employee record", () => {
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "owner",
				employee: null,
				customRoleBaseTiers: [],
			}),
		).toBe("admin");
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "member,admin",
				employee: activeEmployee("employee"),
				customRoleBaseTiers: [],
			}),
		).toBe("admin");
	});

	it("maps a member's employee role directly", () => {
		for (const role of ["admin", "manager", "employee"] as const) {
			expect(
				resolveCustomFieldViewerLevel({
					membershipRole: "member",
					employee: activeEmployee(role),
					customRoleBaseTiers: [],
				}),
			).toBe(role);
		}
	});

	it("takes the highest of the employee role and the base roles of assigned custom roles", () => {
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "member",
				employee: activeEmployee("employee"),
				customRoleBaseTiers: ["employee", "manager"],
			}),
		).toBe("manager");
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "member",
				employee: activeEmployee("manager"),
				customRoleBaseTiers: ["employee"],
			}),
		).toBe("manager");
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "member",
				employee: activeEmployee("employee"),
				customRoleBaseTiers: ["admin"],
			}),
		).toBe("admin");
	});

	it("gives no access to a member without an active employee record", () => {
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "member",
				employee: null,
				customRoleBaseTiers: [],
			}),
		).toBeNull();
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: "member",
				employee: { role: "manager", isActive: false },
				customRoleBaseTiers: ["admin"],
			}),
		).toBeNull();
	});

	it("gives no access without an approved membership", () => {
		expect(
			resolveCustomFieldViewerLevel({
				membershipRole: null,
				employee: activeEmployee("admin"),
				customRoleBaseTiers: [],
			}),
		).toBeNull();
	});
});

describe("field visibility and edit level", () => {
	it("lets a level see fields whose visibility it meets", () => {
		expect(canViewCustomField("admin", "admin")).toBe(true);
		expect(canViewCustomField("admin", "employee")).toBe(true);
		expect(canViewCustomField("manager", "admin")).toBe(false);
		expect(canViewCustomField("manager", "manager")).toBe(true);
		expect(canViewCustomField("manager", "employee")).toBe(true);
		expect(canViewCustomField("employee", "manager")).toBe(false);
		expect(canViewCustomField("employee", "employee")).toBe(true);
		expect(canViewCustomField(null, "employee")).toBe(false);
	});

	it("lets a level edit fields whose edit level it meets; employees never edit", () => {
		expect(canEditCustomField("admin", "admin")).toBe(true);
		expect(canEditCustomField("admin", "manager")).toBe(true);
		expect(canEditCustomField("manager", "admin")).toBe(false);
		expect(canEditCustomField("manager", "manager")).toBe(true);
		expect(canEditCustomField("employee", "manager")).toBe(false);
		expect(canEditCustomField(null, "manager")).toBe(false);
	});
});
