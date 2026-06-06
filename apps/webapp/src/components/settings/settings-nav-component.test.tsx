/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SettingsNav } from "./settings-nav";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	usePathname: () => "/settings/profile",
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: () => ({ isHydrated: true }),
}));

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
});

describe("SettingsNav", () => {
	it("renders group labels as sticky scroll headers", () => {
		render(
			<SidebarProvider>
				<SettingsNav accessTier="orgAdmin" billingEnabled={true} />
			</SidebarProvider>,
		);

		const accountLabel = screen.getByText("Account");
		const accountGroup = accountLabel.closest('[data-sidebar="group"]');

		expect(accountLabel.className).toContain("sticky");
		expect(accountLabel.className).toContain("top-0");
		expect(accountLabel.className).toContain("z-10");
		expect(accountLabel.className).toContain("bg-card");
		expect(accountLabel.className).toContain("rounded-none");
		expect(accountLabel.className).toContain("px-4");
		expect(accountGroup?.className).toContain("p-0");
	});
});
