/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SettingsNav } from "./settings-nav";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: (props: ComponentProps<"a">) => <a {...props} />,
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
	it("preserves the current active route when searching and clearing settings", async () => {
		const user = userEvent.setup();
		render(
			<SidebarProvider>
				<SettingsNav accessTier="orgAdmin" billingEnabled={true} />
			</SidebarProvider>,
		);
		expect(screen.getByRole("link", { name: "Profile" }).getAttribute("data-active")).toBe("true");

		const search = screen.getByRole("searchbox", { name: "Search settings" });
		await user.type(search, "/settings/security");
		expect(screen.queryByRole("link", { name: "Profile" })).toBeNull();
		expect(screen.getByRole("link", { name: "Security" }).getAttribute("data-active")).toBe("false");

		await user.clear(search);
		expect(screen.getByRole("link", { name: "Profile" }).getAttribute("data-active")).toBe("true");
	});

	it("lists Driving licence control only when the visibility reader offers it (#1420)", () => {
		const { unmount } = render(
			<SidebarProvider>
				<SettingsNav accessTier="orgAdmin" billingEnabled={true} />
			</SidebarProvider>,
		);
		expect(screen.queryByText("Driving licence control")).toBeNull();
		expect(screen.queryByText("My driving authorization")).toBeNull();
		unmount();

		render(
			<SidebarProvider>
				<SettingsNav
					accessTier="orgAdmin"
					billingEnabled={true}
					drivingLicenceSettingsVisible={true}
				/>
			</SidebarProvider>,
		);
		expect(screen.getByText("Driving licence control").closest("a")?.getAttribute("href")).toBe(
			"/settings/driving-licence",
		);
	});

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
