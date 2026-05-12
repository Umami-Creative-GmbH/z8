import { describe, expect, it } from "vitest";
import {
	canActorManageTarget,
	canUseManagerAbsencePage,
} from "./manager-absence-permissions";

describe("manager absence permissions", () => {
	it("allows managers to manage assigned employees", () => {
		expect(
			canActorManageTarget({
				actor: { id: "manager-1", role: "manager", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: ["manager-1"],
			}),
		).toBe(true);
	});

	it("blocks managers from unmanaged employees", () => {
		expect(
			canActorManageTarget({
				actor: { id: "manager-1", role: "manager", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: ["manager-2"],
			}),
		).toBe(false);
	});

	it("allows admins to manage active employees in the same organization", () => {
		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(true);
	});

	it("blocks employees from managing active same-organization targets", () => {
		expect(
			canActorManageTarget({
				actor: { id: "employee-1", role: "employee", organizationId: "org-1" },
				target: { id: "employee-2", organizationId: "org-1", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(false);
	});

	it("blocks cross-organization and inactive targets", () => {
		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-2", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(false);

		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: false },
				managerIdsForTarget: [],
			}),
		).toBe(false);
	});

	it("allows only managers and admins to open the page", () => {
		expect(canUseManagerAbsencePage("admin")).toBe(true);
		expect(canUseManagerAbsencePage("manager")).toBe(true);
		expect(canUseManagerAbsencePage("employee")).toBe(false);
	});
});
