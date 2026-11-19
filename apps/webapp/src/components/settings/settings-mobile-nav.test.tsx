/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsMobileNav } from "./settings-mobile-nav";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

let pathname = "/settings/profile";
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
	usePathname: () => pathname,
}));

const { Link } = await import("@/navigation");

function Menu() {
	return (
		<SettingsMobileNav>
			<nav aria-label="Settings navigation">
				<Link href="/settings/security">Security</Link>
			</nav>
		</SettingsMobileNav>
	);
}

describe("SettingsMobileNav", () => {
	beforeEach(() => {
		pathname = "/settings/profile";
	});

	it("opens the settings navigation in a titled drawer from a labelled menu button", async () => {
		const user = userEvent.setup();
		render(<Menu />);

		const trigger = screen.getByRole("button", { name: "Settings menu" });
		expect(trigger.className).toContain("md:hidden");
		expect(screen.queryByRole("navigation", { name: "Settings navigation" })).toBeNull();

		await user.click(trigger);

		const drawer = await screen.findByRole("dialog");
		expect(drawer.textContent).toContain("Settings");
		expect(screen.getByRole("navigation", { name: "Settings navigation" })).toBeTruthy();
	});

	it("closes when a link in the drawer is followed", async () => {
		const user = userEvent.setup();
		render(<Menu />);

		await user.click(screen.getByRole("button", { name: "Settings menu" }));
		await user.click(await screen.findByRole("link", { name: "Security" }));

		await waitFor(() =>
			expect(screen.queryByRole("navigation", { name: "Settings navigation" })).toBeNull(),
		);
	});

	it("closes when the route changes", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<Menu />);

		await user.click(screen.getByRole("button", { name: "Settings menu" }));
		expect(await screen.findByRole("dialog")).toBeTruthy();

		pathname = "/settings/security";
		act(() => rerender(<Menu />));

		await waitFor(() =>
			expect(screen.queryByRole("navigation", { name: "Settings navigation" })).toBeNull(),
		);
	});

	it("closes on Escape and returns focus to the menu button", async () => {
		const user = userEvent.setup();
		render(<Menu />);
		const trigger = screen.getByRole("button", { name: "Settings menu" });

		await user.click(trigger);
		expect(await screen.findByRole("dialog")).toBeTruthy();
		await user.keyboard("{Escape}");

		await waitFor(() =>
			expect(screen.queryByRole("navigation", { name: "Settings navigation" })).toBeNull(),
		);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it("offers no menu on the settings hub, which lists every setting", () => {
		pathname = "/settings";
		render(<Menu />);

		expect(screen.queryByRole("button", { name: "Settings menu" })).toBeNull();
	});
});
