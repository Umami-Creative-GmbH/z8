/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({
	useIsMobile: () => true,
}));

import { SidebarMenuButton, SidebarProvider, useSidebar } from "./sidebar";

beforeEach(() => {
	const storage = new Map<string, string>();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: vi.fn((key: string) => storage.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
		},
	});
});

function MobileSidebarLinkHarness() {
	const { openMobile, setOpenMobile } = useSidebar();

	return (
		<>
			<div data-testid="open-mobile">{String(openMobile)}</div>
			<button type="button" onClick={() => setOpenMobile(true)}>
				Open sidebar
			</button>
			<SidebarMenuButton asChild>
				<a href="#settings">Settings</a>
			</SidebarMenuButton>
		</>
	);
}

describe("SidebarMenuButton", () => {
	it("closes the mobile sidebar when a sidebar link is clicked", () => {
		render(
			<SidebarProvider>
				<MobileSidebarLinkHarness />
			</SidebarProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
		expect(screen.getByTestId("open-mobile").textContent).toBe("true");

		fireEvent.click(screen.getByRole("link", { name: "Settings" }));

		expect(screen.getByTestId("open-mobile").textContent).toBe("false");
	});
});

describe("Sidebar", () => {
	it("uses FLIP motion for synchronized offcanvas content expansion", async () => {
		const source = await readFile(join(process.cwd(), "src/components/ui/sidebar.tsx"), "utf8");

		expect(source).toContain("transform-gpu");
		expect(source).toContain("transition-[transform,opacity]");
		expect(source).toContain("group-data-[collapsible=offcanvas]:-translate-x-full");
		expect(source).toContain("group-data-[collapsible=offcanvas]:translate-x-full");
		expect(source).toContain("animate(");
		expect(source).toContain("scaleX");
		expect(source).not.toContain("transition-[width]");
		expect(source).not.toContain("transition-[transform,width]");
		expect(source).not.toContain("will-change-[width]");
		expect(source).not.toContain("transition-[left,right,width]");
	});
});
