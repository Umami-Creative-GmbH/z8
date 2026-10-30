/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({
	context: { userId: "user-a", organizationId: "org-a", role: "manager", isLoading: false },
}));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => context }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => undefined } } }));
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => "unknown",
		getActivity: () => null,
		getBreak: () => null,
	}),
}));
vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("@/components/employee-activity-text", () => ({ EmployeeActivityText: () => null }));

vi.mock("@/stores/organization-settings-store", () => ({ useShiftsEnabled: () => true }));
vi.mock("./actions", () => ({ getWhosOutToday: vi.fn(), getUpcomingAbsences: vi.fn() }));
vi.mock("./cover-duties-actions", () => ({ getCoverDuties: vi.fn() }));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({ getMyUpcomingShifts: vi.fn() }));

import { CoveringForWidget } from "./covering-for-widget";
import type { DashboardWidgetSnapshot } from "./dashboard-types";
import { UpcomingShiftsWidget } from "./upcoming-shifts-widget";
import { UpcomingTimeOffWidget } from "./upcoming-time-off-widget";
import { WhosOutTodayWidget } from "./whos-out-today-widget";

const scope = { userId: "user-a", organizationId: "org-a" };
const snapshot = <T,>(data: T): DashboardWidgetSnapshot<T> => ({
	scope,
	updatedAt: Date.now(),
	result: { success: true, data },
});
const shifts = {
	today: "2026-10-24",
	shifts: [
		{
			id: "shift-a",
			date: "2026-10-24",
			startTime: "22:00",
			endTime: "06:00",
			notes: null,
			subareaName: "Floor",
			locationName: "Store",
		},
	],
};
const cover = {
	viewerRole: "manager" as const,
	running: [
		{
			absenceId: "cover-a",
			employeeId: "report-a",
			employeeName: "Ada Lovelace",
			startDate: "2026-10-23",
			endDate: "2026-10-26",
			category: null,
		},
	],
	upcoming: [],
};
const out = {
	outToday: [
		{
			id: "report-b",
			userId: "report-user-b",
			name: "Grace Hopper",
			image: null,
			category: "Vacation",
			categoryColor: null,
			endsToday: true,
			returnsTomorrow: false,
			returnDate: "2026-10-27",
		},
	],
	returningTomorrow: [],
	totalOut: 1,
};
const upcoming = [
	{
		id: "absence-a",
		employee: {
			id: "report-c",
			user: { id: "report-user-c", name: "Katherine Johnson", image: null },
		},
		startDate: "2026-10-26",
		endDate: "2026-10-26",
		startPeriod: "pm",
		endPeriod: "pm",
		absenceDays: 0.5,
		daysUntil: 2,
		category: { name: "Vacation", color: null },
	},
];

beforeEach(() => {
	context.role = "manager";
	context.organizationId = "org-a";
	vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function widgets(
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	failed?: string,
) {
	const deliver = <T,>(id: string, data: T): DashboardWidgetSnapshot<T> =>
		id === failed
			? { scope, updatedAt: Date.now(), result: { success: false, error: "Fixture unavailable" } }
			: snapshot(data);
	return (
		<QueryClientProvider client={client}>
			<UpcomingShiftsWidget initialSnapshot={deliver("upcoming-shifts", shifts)} />
			<CoveringForWidget initialSnapshot={deliver("covering-for", cover)} />
			<WhosOutTodayWidget initialSnapshot={deliver("whos-out-today", out)} />
			<UpcomingTimeOffWidget initialSnapshot={deliver("upcoming-time-off", upcoming)} />
		</QueryClientProvider>
	);
}

it("renders the four scoped server deliveries without initial GETs, retaining dates, deputy privacy, return rules and half-day totals", () => {
	render(widgets());
	expect(screen.getByRole("link", { name: /22:00/ }).getAttribute("href")).toBe(
		"/scheduling?date=2026-10-24",
	);
	expect(screen.getByText("(ends next day)")).toBeTruthy();
	expect(screen.getByText("Covering for Ada Lovelace until Oct 26, 2026")).toBeTruthy();
	expect(screen.getAllByText("Grace Hopper").length).toBeGreaterThan(0);
	expect(screen.getByText("Until Oct 27")).toBeTruthy();
	expect(screen.getAllByText("Katherine Johnson").length).toBeGreaterThan(0);
	expect(screen.getByText("0.5 days")).toBeTruthy();
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	["upcoming-shifts", "Upcoming Shifts", shifts, "(ends next day)"],
	["covering-for", "Covering for", cover, "Covering for Ada Lovelace until Oct 26, 2026"],
	["whos-out-today", "Who's Out Today", out, "Until Oct 27"],
	["upcoming-time-off", "Upcoming Time Off", upcoming, "0.5 days"],
])(
	"holds and fails %s locally while its siblings remain usable, then retries only that dataset",
	async (id, title, data, readyText) => {
		let fail!: (error: Error) => void;
		const request = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						fail = reject;
					}),
			)
			.mockImplementationOnce(async () => Response.json(snapshot(data)));
		vi.stubGlobal("fetch", request);
		render(widgets(new QueryClient({ defaultOptions: { queries: { retry: false } } }), id));
		expect(request).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: `Retry ${title}` }));
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		expect(
			id === "upcoming-shifts"
				? screen.getAllByRole("link", { name: "View Full Calendar" }).length
				: screen.getByRole("link", { name: /22:00/ }),
		).toBeTruthy();
		await act(async () => fail(new Error("Fixture failure")));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: `Retry ${title}` }).hasAttribute("disabled")).toBe(
				false,
			),
		);
		expect(screen.getByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: `Retry ${title}` }));
		await screen.findAllByText(readyText);
		expect(screen.queryByRole("alert")).toBeNull();
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			`/api/dashboard/widgets/${id}`,
			`/api/dashboard/widgets/${id}`,
		]);
	},
);

it("hides every old organization snapshot immediately when the shared identity changes", () => {
	const client = new QueryClient();
	const view = render(widgets(client));
	context.organizationId = "org-b";
	vi.stubGlobal(
		"fetch",
		vi.fn(() => new Promise(() => {})),
	);
	view.rerender(widgets(client));
	expect(screen.queryByRole("link", { name: /22:00/ })).toBeNull();
	expect(screen.queryByText(/Covering for Ada/)).toBeNull();
	expect(screen.queryAllByText("Grace Hopper")).toHaveLength(0);
	expect(screen.queryAllByText("Katherine Johnson")).toHaveLength(0);
});

it("removes an old privileged cover category immediately when the shared base role is reduced", () => {
	const client = new QueryClient();
	const initial = snapshot({
		...cover,
		viewerRole: "admin" as const,
		running: [{ ...cover.running[0], category: { name: "Private category", color: null } }],
	});
	context.role = "admin";
	const tree = () => (
		<QueryClientProvider client={client}>
			<CoveringForWidget initialSnapshot={initial} />
		</QueryClientProvider>
	);
	const view = render(tree());
	expect(screen.getByText("Private category")).toBeTruthy();
	context.role = "employee";
	view.rerender(tree());
	expect(screen.queryByText("Private category")).toBeNull();
	expect(screen.getByText("Covering for Ada Lovelace until Oct 26, 2026")).toBeTruthy();
});
