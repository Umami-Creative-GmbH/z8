import { describe, expect, it } from "vitest";

import {
	ORG_ADMIN_SETTINGS_ROUTES,
	canResolvedTierAccessRoute,
	hasSettingsAccessTier,
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
} from "@/lib/settings-access";

describe("resolveSettingsAccessTier", () => {
	it("resolves owner membership to orgAdmin without an employee row", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "owner",
				employeeRole: null,
			}),
		).toBe("orgAdmin");
});

	it("resolves admin membership to orgAdmin before employee-role checks", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "admin",
				employeeRole: "manager",
			}),
		).toBe("orgAdmin");
	});

	it("resolves active-org employee manager and admin roles to manager tier", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "member",
				employeeRole: "manager",
			}),
		).toBe("manager");

		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "member",
				employeeRole: "admin",
			}),
		).toBe("manager");
	});

	it("resolves legal entity admins to entityAdmin without org-admin membership", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "member",
				employeeRole: "employee",
				legalEntityAdminIds: ["entity-a"],
			}),
		).toBe("entityAdmin");
	});

	it("resolves manager legal entity admins to entityAdmin", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "member",
				employeeRole: "manager",
				legalEntityAdminIds: ["entity-a"],
			}),
		).toBe("entityAdmin");
	});

	it("falls back to member when there is no active organization", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: null,
				membershipRole: "owner",
				employeeRole: "manager",
			}),
		).toBe("member");
	});

	it("can resolve different tiers when the same user switches active organizations", () => {
		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "owner",
				employeeRole: null,
			}),
		).toBe("orgAdmin");

		expect(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-b",
				membershipRole: "member",
				employeeRole: "manager",
			}),
		).toBe("manager");
	});
});

describe("hasSettingsAccessTier", () => {
	it("applies none < member < manager < entityAdmin < orgAdmin ordering", () => {
		expect(hasSettingsAccessTier("none", "member")).toBe(false);
		expect(hasSettingsAccessTier("member", "member")).toBe(true);
		expect(hasSettingsAccessTier("member", "manager")).toBe(false);
		expect(hasSettingsAccessTier("manager", "manager")).toBe(true);
		expect(hasSettingsAccessTier("manager", "entityAdmin")).toBe(false);
		expect(hasSettingsAccessTier("entityAdmin", "manager")).toBe(true);
		expect(hasSettingsAccessTier("entityAdmin", "entityAdmin")).toBe(true);
		expect(hasSettingsAccessTier("manager", "orgAdmin")).toBe(false);
		expect(hasSettingsAccessTier("entityAdmin", "orgAdmin")).toBe(false);
		expect(hasSettingsAccessTier("orgAdmin", "manager")).toBe(true);
		expect(hasSettingsAccessTier("orgAdmin", "orgAdmin")).toBe(true);
	});
});

describe("statistics route access", () => {
	it("does not treat statistics as an org-admin-only settings route", () => {
		expect(ORG_ADMIN_SETTINGS_ROUTES).not.toContain("/settings/statistics");
		expect(ORG_ADMIN_SETTINGS_ROUTES).not.toContain("/settings/scheduled-exports");
	});

	it("allows managers into statistics while preserving org-admin-only routes", () => {
		expect(canResolvedTierAccessRoute("manager", "/settings/statistics")).toBe(true);
		expect(canResolvedTierAccessRoute("manager", "/settings/legal-entities")).toBe(false);
		expect(canResolvedTierAccessRoute("manager", "/settings/export")).toBe(false);
		expect(canResolvedTierAccessRoute("manager", "/settings/scheduled-exports")).toBe(true);
		expect(canResolvedTierAccessRoute("orgAdmin", "/settings/legal-entities")).toBe(true);
		expect(canResolvedTierAccessRoute("orgAdmin", "/settings/statistics")).toBe(true);
		expect(canResolvedTierAccessRoute("orgAdmin", "/settings/scheduled-exports")).toBe(true);
	});

	it("allows entity admins into scoped legal-entity-owned settings but not parent org settings", () => {
		const scopedRoutes = [
			"/settings/payroll-export",
			"/settings/payroll-readiness",
			"/settings/scheduled-exports",
			"/settings/holidays",
			"/settings/vacation",
			"/settings/work-policies",
			"/settings/change-policies",
		];

		for (const route of scopedRoutes) {
			expect(canResolvedTierAccessRoute("entityAdmin", route)).toBe(true);
		}

		expect(canResolvedTierAccessRoute("entityAdmin", "/settings/legal-entities")).toBe(false);
		expect(canResolvedTierAccessRoute("entityAdmin", "/settings/billing")).toBe(false);
	});
	});

describe("isSettingsAccessMembershipRole", () => {
	it("accepts only settings membership roles", () => {
		expect(isSettingsAccessMembershipRole("owner")).toBe(true);
		expect(isSettingsAccessMembershipRole("admin")).toBe(true);
		expect(isSettingsAccessMembershipRole("member")).toBe(true);
		expect(isSettingsAccessMembershipRole("manager")).toBe(false);
		expect(isSettingsAccessMembershipRole(null)).toBe(false);
	});
});
