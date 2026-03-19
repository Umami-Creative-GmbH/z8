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
	it("applies member < manager < orgAdmin ordering", () => {
		expect(hasSettingsAccessTier("member", "member")).toBe(true);
		expect(hasSettingsAccessTier("member", "manager")).toBe(false);
		expect(hasSettingsAccessTier("manager", "manager")).toBe(true);
		expect(hasSettingsAccessTier("manager", "orgAdmin")).toBe(false);
		expect(hasSettingsAccessTier("orgAdmin", "manager")).toBe(true);
		expect(hasSettingsAccessTier("orgAdmin", "orgAdmin")).toBe(true);
	});
});

	describe("statistics route access", () => {
		it("does not treat statistics as an org-admin-only settings route", () => {
			expect(ORG_ADMIN_SETTINGS_ROUTES).not.toContain("/settings/statistics");
			expect(ORG_ADMIN_SETTINGS_ROUTES).toContain("/settings/scheduled-exports");
		});

		it("allows managers into statistics while preserving org-admin-only routes", () => {
			expect(canResolvedTierAccessRoute("manager", "/settings/statistics")).toBe(true);
			expect(canResolvedTierAccessRoute("manager", "/settings/export")).toBe(false);
			expect(canResolvedTierAccessRoute("manager", "/settings/scheduled-exports")).toBe(false);
			expect(canResolvedTierAccessRoute("orgAdmin", "/settings/statistics")).toBe(true);
			expect(canResolvedTierAccessRoute("orgAdmin", "/settings/scheduled-exports")).toBe(true);
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
