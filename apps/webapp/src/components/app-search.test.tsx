/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
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
	formatForDisplay: vi.fn(() => "⌘ K"),
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

const staticCommands: AppSearchResult[] = [
	{
		type: "action",
		id: "add-manual-time-entry",
		title: "Add manual time entry",
		subtitle: "Record time for a completed shift",
		href: "/time-tracking",
	},
];

const searchPlaceholder = "Search pages, people, teams, settings, or actions…";

function renderAppSearch({
	commands = staticCommands,
	results = staticResults,
}: {
	commands?: AppSearchResult[];
	results?: AppSearchResult[];
} = {}) {
	return render(
		<SidebarProvider>
			<AppSearch staticCommands={commands} staticResults={results} />
		</SidebarProvider>,
	);
}

describe("AppSearch", () => {
	beforeEach(() => {
		vi.useFakeTimers();
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
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it("opens from the trigger button and navigates to a static result", async () => {
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.click(screen.getByText("Dashboard"));

		expect(pushMock).toHaveBeenCalledWith("/dashboard");
		expect(screen.queryByPlaceholderText(searchPlaceholder)).toBeNull();
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

	it("shows the OS-aware search shortcut in the main menu", async () => {
		const { formatForDisplay } = await import("@tanstack/react-hotkeys");

		renderAppSearch();

		expect(formatForDisplay).toHaveBeenCalledWith("Mod+K");
		expect(screen.getByText("⌘ K")).not.toBeNull();
	});

	it("opens when the registered hotkey fires", () => {
		renderAppSearch();

		act(() => {
			hotkeyRegistrations.at(-1)?.callback();
		});

		expect(screen.getByPlaceholderText(searchPlaceholder)).not.toBeNull();
	});

	it("shows the empty state when the current query filters out all results", () => {
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
			target: { value: "zzzz" },
		});

		expect(screen.getByText("No results found.")).not.toBeNull();
	});

	it("matches static results by keywords", () => {
		renderAppSearch({
			results: [
				{
					type: "page",
					id: "team-absences",
					title: "Team Absences",
					subtitle: "Review employee absence metrics and record absences",
					href: "/team/absences",
					keywords: ["team", "absence", "sick", "vacation", "manager"],
				},
			],
		});

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
			target: { value: "vacation" },
		});

		expect(screen.getByText("Team Absences")).not.toBeNull();
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

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
			target: { value: "al" },
		});
		expect(searchAppRecordsActionMock).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});

		expect(searchAppRecordsActionMock).toHaveBeenCalledWith("al");
		fireEvent.click(screen.getByText("Alex Morgan"));

		expect(pushMock).toHaveBeenCalledWith("/settings/employees/employee-1");
	});

	it("orders actions before live people, teams, pages, and settings", async () => {
		searchAppRecordsActionMock.mockResolvedValue({
			success: true,
			data: {
				employees: [
					{
						type: "employee",
						id: "employee-1",
						title: "Alex Morgan",
						href: "/settings/employees/employee-1",
					},
				],
				teams: [
					{
						type: "team",
						id: "team-1",
						title: "Operations",
						href: "/settings/teams/team-1",
					},
				],
			},
		});
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
			target: { value: "op" },
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});

		const groupHeadings = screen
			.getAllByText(/^(Actions|People|Teams|Pages|Settings)$/)
			.map((heading) => heading.textContent);

		expect(groupHeadings).toEqual(["Actions", "People", "Teams", "Pages", "Settings"]);
	});

	it("navigates to a selected action and closes the palette", () => {
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.click(screen.getByText("Add manual time entry"));

		expect(pushMock).toHaveBeenCalledWith("/time-tracking");
		expect(screen.queryByPlaceholderText(searchPlaceholder)).toBeNull();
	});

	it("keeps static results available and shows the live search error when loading fails", async () => {
		searchAppRecordsActionMock.mockResolvedValue({
			success: false,
			error: "Could not load people or teams",
		});
		renderAppSearch();

		fireEvent.click(screen.getByRole("button", { name: /search or run command/i }));
		fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
			target: { value: "em" },
		});
		expect(searchAppRecordsActionMock).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});

		expect(screen.getByText("Could not load people or teams")).not.toBeNull();
		expect(screen.getByText("Employees")).not.toBeNull();
	});
});
