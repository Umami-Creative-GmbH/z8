/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
	];

	it("renders category headings as sticky scroll headers", () => {
		render(<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />);

		const heading = screen.getByRole("heading", { name: "Account" });

		expect(heading.className).toContain("sticky");
		expect(heading.className).toContain("top-0");
		expect(heading.className).toContain("z-10");
	});
});
