/* @vitest-environment jsdom */
import { fireEvent, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { render } from "@/test/render-with-translations";
import { SidebarCapabilityNotice } from "./sidebar-capability-notice";
import { SidebarLoading } from "./sidebar-loading";

const route = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => route }));
beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
});
describe("sidebar loading and local retry", () => {
	it("uses the real inset sidebar frame with accessible neutral busy geometry", () => {
		render(
			<SidebarProvider>
				<SidebarLoading variant="inset" />
			</SidebarProvider>,
		);
		expect(
			screen.getByLabelText("Loading navigation").getAttribute("aria-busy"),
		).toBe("true");
		expect(screen.getByRole("status").textContent).toBe("Loading navigation");
		expect(screen.queryAllByRole("link")).toHaveLength(0);
	});
	it("requests a server navigation refresh without replacing the current draft or clock", () => {
		render(
			<>
				<SidebarCapabilityNotice />
				<input aria-label="Task draft" defaultValue="Unsaved note" />
				<button type="button">Clock Out</button>
			</>,
		);
		const input = screen.getByRole("textbox");
		input.focus();
		fireEvent.click(screen.getByRole("button", { name: "Retry navigation" }));
		expect(route.refresh).toHaveBeenCalledOnce();
		expect(screen.getByDisplayValue("Unsaved note")).toBe(input);
		expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
		expect(screen.getByRole("status").textContent).toContain(
			"Some navigation is unavailable",
		);
	});
});
