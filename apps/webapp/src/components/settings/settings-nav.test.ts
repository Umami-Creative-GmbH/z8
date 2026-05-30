import { describe, expect, it, vi } from "vitest";
import { isSettingsNavItemActive } from "@/components/settings/settings-nav-utils";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
	usePathname: () => "/settings/teams-notifications",
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: () => ({ isHydrated: true }),
}));

describe("settings nav active state", () => {
	it("does not mark sibling routes as active when their paths share a prefix", () => {
		expect(isSettingsNavItemActive("/settings/teams-notifications", "/settings/teams")).toBe(false);
		expect(
			isSettingsNavItemActive("/settings/teams-notifications", "/settings/teams-notifications"),
		).toBe(true);
	});

	it("marks nested routes under the same settings entry as active", () => {
		expect(isSettingsNavItemActive("/settings/teams/team-1", "/settings/teams")).toBe(true);
	});
});
