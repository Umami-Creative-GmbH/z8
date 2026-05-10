/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSearchResult } from "@/lib/app-search/types";

const { hotkeyRegistrations, pushMock, searchAppRecordsActionMock } = vi.hoisted(() => ({
	hotkeyRegistrations: [] as Array<{
		keys: string;
		callback: () => void;
		options: { preventDefault?: boolean } | undefined;
	}>,
	pushMock: vi.fn(),
	searchAppRecordsActionMock: vi.fn(),
}));

vi.mock("@tanstack/react-hotkeys", () => ({
	useHotkey: (keys: string, callback: () => void, options?: { preventDefault?: boolean }) => {
		hotkeyRegistrations.push({ keys, callback, options });
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/[locale]/(app)/search/actions", () => ({
	searchAppRecordsAction: searchAppRecordsActionMock,
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
		open ? <div>{children}</div> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

import { AppSearch } from "./app-search";
import { SidebarProvider } from "./ui/sidebar";

const staticResults: AppSearchResult[] = [
	{
		type: "page",
		id: "dashboard",
		title: "Dashboard",
		subtitle: "Overview",
		href: "/dashboard",
	},
	{
		type: "setting",
		id: "employees",
		title: "Employees",
		subtitle: "Manage people",
		href: "/settings/employees",
	},
];

function renderAppSearch(results = staticResults) {
	return render(
		<SidebarProvider>
			<AppSearch staticResults={results} />
		</SidebarProvider>,
	);
}

describe("AppSearch", () => {
	beforeEach(() => {
		vi.useRealTimers();
		window.matchMedia = vi.fn().mockReturnValue({
			addEventListener: vi.fn(),
			matches: false,
			removeEventListener: vi.fn(),
		});
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: {
				getItem: vi.fn(() => null),
				setItem: vi.fn(),
			},
		});
		globalThis.ResizeObserver = class ResizeObserver {
			disconnect() {}
			observe() {}
			unobserve() {}
		};
		HTMLElement.prototype.scrollIntoView = vi.fn();
		hotkeyRegistrations.length = 0;
		pushMock.mockReset();
		searchAppRecordsActionMock.mockReset();
		searchAppRecordsActionMock.mockResolvedValue({
			success: true,
			data: { employees: [], teams: [] },
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens from the trigger button and navigates to a static result", async () => {
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search/i }));
		fireEvent.click(screen.getByText("Dashboard"));

		expect(pushMock).toHaveBeenCalledWith("/dashboard");
		expect(
			screen.queryByPlaceholderText("Search pages, settings, people, and teams..."),
		).toBeNull();
	});

	it("registers Mod+K with preventDefault", () => {
		renderAppSearch();

		expect(hotkeyRegistrations).toContainEqual(
			expect.objectContaining({
				keys: "Mod+K",
				options: { preventDefault: true },
			}),
		);
	});

	it("opens when the registered hotkey fires", () => {
		renderAppSearch();

		act(() => {
			hotkeyRegistrations.at(-1)?.callback();
		});

		expect(
			screen.getByPlaceholderText("Search pages, settings, people, and teams..."),
		).not.toBeNull();
	});

	it("loads live results after typing and navigates to an employee result", async () => {
		searchAppRecordsActionMock.mockResolvedValue({
			success: true,
			data: {
				employees: [
					{
						type: "employee",
						id: "employee-1",
						title: "Alex Morgan",
						subtitle: "Operations",
						href: "/settings/employees/employee-1",
					},
				],
				teams: [],
			},
		});
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search/i }));
		fireEvent.change(screen.getByPlaceholderText("Search pages, settings, people, and teams..."), {
			target: { value: "al" },
		});
		expect(searchAppRecordsActionMock).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 260));

		await waitFor(() => expect(searchAppRecordsActionMock).toHaveBeenCalledWith("al"));
		fireEvent.click(await screen.findByText("Alex Morgan"));

		expect(pushMock).toHaveBeenCalledWith("/settings/employees/employee-1");
	});

	it("keeps static results available and shows the live search error when loading fails", async () => {
		searchAppRecordsActionMock.mockResolvedValue({
			success: false,
			error: "Could not load people or teams",
		});
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search/i }));
		fireEvent.change(screen.getByPlaceholderText("Search pages, settings, people, and teams..."), {
			target: { value: "em" },
		});
		expect(searchAppRecordsActionMock).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 260));

		expect(await screen.findByText("Could not load people or teams")).not.toBeNull();
		expect(screen.getByText("Employees")).not.toBeNull();
	});
});
