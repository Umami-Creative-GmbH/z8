/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

const viewport = vi.hoisted(() => ({ isMobile: true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.isMobile }));

import {
	Sidebar,
	SidebarMenuButton,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from "./sidebar";

beforeEach(() => {
	viewport.isMobile = true;
	const storage = new Map<string, string>();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: vi.fn((key: string) => storage.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
		},
	});
});

function DesktopShell() {
	return (
		<SidebarProvider>
			<SidebarTrigger />
			<Sidebar collapsible="icon">
				<SidebarMenuButton asChild tooltip="Settings">
					<a href="#settings" aria-label="Settings">
						Settings
					</a>
				</SidebarMenuButton>
			</Sidebar>
		</SidebarProvider>
	);
}

describe("Sidebar collapse preferences", () => {
	it("keeps a named icon rail, expands by keyboard, and restores the saved desktop preference", () => {
		viewport.isMobile = false;
		const first = render(<DesktopShell />);
		const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(
			first.container
				.querySelector('[data-slot="sidebar"]')
				?.getAttribute("data-collapsible"),
		).toBe("icon");
		expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
		expect(window.localStorage.getItem("sidebar_state")).toBe("false");
		first.unmount();
		render(<DesktopShell />);
		const restored = screen.getByRole("button", { name: "Toggle Sidebar" });
		expect(restored.getAttribute("aria-expanded")).toBe("false");
		fireEvent.keyDown(window, { key: "b", ctrlKey: true });
		expect(restored.getAttribute("aria-expanded")).toBe("true");
		fireEvent.keyDown(window, { key: "b", metaKey: true });
		expect(restored.getAttribute("aria-expanded")).toBe("false");
	});

	it("reports mobile drawer state separately without overwriting the desktop preference", () => {
		window.localStorage.setItem("sidebar_state", "false");
		render(
			<SidebarProvider>
				<SidebarTrigger />
			</SidebarProvider>,
		);
		const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(window.localStorage.getItem("sidebar_state")).toBe("false");
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

function OpenMobileSidebar() {
	const { setOpenMobile } = useSidebar();
	return (
		<>
			<button type="button" onClick={() => setOpenMobile(true)}>
				Open sidebar
			</button>
			<Sidebar>
				<SidebarMenuButton>Absences</SidebarMenuButton>
			</Sidebar>
		</>
	);
}

describe("Sidebar", () => {
	it("dismisses the phone drawer with Escape", async () => {
		render(
			<SidebarProvider>
				<OpenMobileSidebar />
				<SidebarTrigger />
			</SidebarProvider>,
		);
		const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
		fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.keyDown(screen.getByRole("button", { name: "Absences" }), {
			key: "Escape",
		});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(
			screen
				.getByRole("button", { name: "Toggle Sidebar" })
				.getAttribute("aria-expanded"),
		).toBe("false");
	});
	it("keeps the phone navigation clear of the status bar and home indicator with 44 px rows (#846)", () => {
		render(
			<SidebarProvider>
				<OpenMobileSidebar />
			</SidebarProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));

		const navigation = screen.getByRole("button", {
			name: "Absences",
		}).parentElement;
		expect(navigation?.className).toContain("pt-[env(safe-area-inset-top)]");
		expect(navigation?.className).toContain("pb-[env(safe-area-inset-bottom)]");
		expect(navigation?.className).toContain("pl-[env(safe-area-inset-left)]");
		expect(navigation?.className).toContain(
			"[&_[data-sidebar=menu-button]]:min-h-11",
		);
	});

	it("uses CSS motion for synchronized offcanvas content expansion", async () => {
		const source = await readFile(
			join(process.cwd(), "src/components/ui/sidebar.tsx"),
			"utf8",
		);
		const globalsSource = await readFile(
			join(process.cwd(), "src/app/globals.css"),
			"utf8",
		);

		expect(source).toContain("transform-gpu");
		expect(source).toContain("transition-[transform,opacity]");
		expect(source).toContain(
			"group-data-[collapsible=offcanvas]:-translate-x-full",
		);
		expect(source).toContain(
			"group-data-[collapsible=offcanvas]:translate-x-full",
		);
		expect(source).toContain(
			"peer-data-[state=collapsed]:animate-sidebar-inset-collapse",
		);
		expect(source).toContain(
			"peer-data-[state=expanded]:animate-sidebar-inset-expand",
		);
		expect(source).not.toContain("requestAnimationFrame");
		expect(source).not.toContain("animate(");
		expect(source).not.toContain("getBoundingClientRect");
		expect(globalsSource).toContain("--animate-sidebar-inset-collapse");
		expect(globalsSource).toContain("@keyframes sidebar-inset-collapse");
		expect(source).not.toContain("transition-[width]");
		expect(source).not.toContain("transition-[transform,width]");
		expect(source).not.toContain("will-change-[width]");
		expect(source).not.toContain("transition-[left,right,width]");
	});
});
