/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SettingsEntry, SettingsGroupConfig } from "./settings-config";
import { SettingsGrid } from "./settings-grid";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: () => ({ isHydrated: true }),
}));

vi.mock("@/components/settings/settings-card", () => ({
	SettingsCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe("SettingsGrid", () => {
	const visibleGroups: SettingsGroupConfig[] = [
		{
			id: "account",
			labelKey: "settings.group.account",
			labelDefault: "Account",
		},
		{
			id: "organization",
			labelKey: "settings.group.organization",
			labelDefault: "Organization",
		},
	];

	const visibleSettings: SettingsEntry[] = [
		{
			id: "profile",
			titleKey: "settings.profile.title",
			titleDefault: "Profile",
			descriptionKey: "settings.profile.description",
			descriptionDefault: "Manage your profile",
			href: "/settings/profile",
			icon: "user-circle",
			minimumTier: "member",
			group: "account",
		},
		{
			id: "employees",
			titleKey: "settings.employees.title",
			titleDefault: "Employees",
			descriptionKey: "settings.employees.description",
			descriptionDefault: "Manage invitations and employee access",
			href: "/settings/employees",
			icon: "users",
			minimumTier: "orgAdmin",
			group: "organization",
		},
	];

	it("renders category headings as sticky scroll headers", () => {
		render(<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />);

		const heading = screen.getByRole("heading", { name: "Account" });

		expect(heading.className).toContain("sticky");
		expect(heading.className).toContain("top-0");
		expect(heading.className).toContain("z-10");
	});

	it.each(["EMPLOYEES", "invitations", "organization access", "/settings/employees"])(
		"finds settings by title, description, group, or route: %s",
		async (query) => {
			const user = userEvent.setup();
			render(<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />);
			await user.type(screen.getByRole("searchbox", { name: "Search settings" }), query);
			expect(screen.getByText("Employees")).toBeTruthy();
			expect(screen.queryByText("Profile")).toBeNull();
			expect(screen.queryByRole("heading", { name: "Account" })).toBeNull();
		},
	);

	it("shows a helpful empty state and restores settings when the search is cleared", async () => {
		const user = userEvent.setup();
		render(<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />);
		const search = screen.getByRole("searchbox", { name: "Search settings" });
		await user.type(search, "no matching setting");
		expect(screen.getByRole("status").textContent).toContain("No settings found");
		await user.clear(search);
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByText("Profile")).toBeTruthy();
		expect(screen.getByText("Employees")).toBeTruthy();
	});
});
