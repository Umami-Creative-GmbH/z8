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
// These former HTTP action boundaries must never be called by an initially delivered widget.
vi.mock("./actions", () => ({
	getManagedEmployees: vi.fn(),
	getTeamOverviewStats: vi.fn(),
	getRecentlyApprovedRequests: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: vi.fn(),
	getPendingApprovals: vi.fn(),
}));

import type { DashboardWidgetSnapshot } from "./dashboard-types";
import { ManagedEmployeesWidget } from "./managed-employees-widget";
import { PendingApprovalsWidget } from "./pending-approvals-widget";
import { RecentlyApprovedWidget } from "./recently-approved-widget";
import { TeamOverviewWidget } from "./team-overview-widget";

const scope = { userId: "user-a", organizationId: "org-a" };
const snapshot = <T,>(data: T): DashboardWidgetSnapshot<T> => ({
	scope,
	updatedAt: Date.now(),
	result: { success: true, data },
});
const managed = {
	isManager: true,
	employees: [
		{
			id: "report-a",
			position: "Designer",
			user: { id: "report-user", name: "Ada Lovelace", email: "ada@example.com", image: null },
			team: null,
		},
	],
};
const pending = {
	absenceApprovals: [
		{
			id: "absence-a",
			requester: { user: { name: "Grace Hopper" } },
			absence: { startDate: "2026-10-26", endDate: "2026-10-27", category: { name: "Vacation" } },
		},
	],
	timeCorrectionApprovals: [
		{
			id: "correction-a",
			requester: { user: { name: "Katherine Johnson" } },
			workPeriod: { startTime: "2026-10-23T08:00:00.000Z" },
		},
	],
};
const approved = [
	{
		id: "approved-a",
		type: "absence" as const,
		updatedAt: "2026-10-22T12:00:00.000Z",
		requestedByEmployee: { user: { name: "Dorothy Vaughan" } },
		approverEmployee: { user: { name: "Mary Jackson" } },
	},
];

beforeEach(() => {
	context.role = "manager";
	vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function widgets(
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	failed?: string,
) {
	const deliver = <T,>(id: string, data: T): DashboardWidgetSnapshot<T> =>
		id === failed
			? { scope, updatedAt: Date.now(), result: { success: false, error: "Unavailable fixture" } }
			: snapshot(data);
	return (
		<QueryClientProvider client={client}>
			<ManagedEmployeesWidget initialSnapshot={deliver("managed-employees", managed)} />
			<TeamOverviewWidget
				initialSnapshot={deliver("team-overview", {
					currentEmployees: 7,
					teamsCount: 2,
					avgWorkHours: 35,
				})}
			/>
			<PendingApprovalsWidget initialSnapshot={deliver("pending-approvals", pending)} />
			<RecentlyApprovedWidget initialSnapshot={deliver("recently-approved", approved)} />
		</QueryClientProvider>
	);
}

it("renders all four authorized server deliveries without an initial GET, retaining names, counts, dates and inbox links", () => {
	render(widgets());
	expect(screen.getByRole("link", { name: /Ada Lovelace/ }).getAttribute("href")).toBe(
		"/settings/employees/report-a",
	);
	expect(screen.getByText("7")).toBeTruthy();
	expect(screen.getByText("2 pending requests")).toBeTruthy();
	expect(screen.getByText("Grace Hopper")).toBeTruthy();
	expect(screen.getByText("Oct 23, 2026")).toBeTruthy();
	expect(screen.getByText("Dorothy Vaughan")).toBeTruthy();
	expect(screen.getByText("by Mary Jackson")).toBeTruthy();
	expect(screen.getByRole("link", { name: "Review All Approvals" }).getAttribute("href")).toBe(
		"/approvals/inbox",
	);
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	["managed-employees", "Your Team", managed, "Ada Lovelace"],
	[
		"team-overview",
		"Organization",
		{ currentEmployees: 7, teamsCount: 2, avgWorkHours: 35 },
		"Current employees",
	],
	["pending-approvals", "Pending Approvals", pending, "Grace Hopper"],
	["recently-approved", "Recently Approved", approved, "Dorothy Vaughan"],
])(
	"keeps siblings usable during a held/failed %s retry, and retries only that widget",
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
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(widgets(client, id));
		expect(request).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: `Retry ${title}` }));
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		expect(
			screen.getByRole("link", {
				name: id === "managed-employees" ? "View All Approvals" : /Ada Lovelace/,
			}),
		).toBeTruthy();
		await act(async () => fail(new Error("Fixture failed")));
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

it("hides organization counts immediately on role reduction and rejects all old organization deliveries on a scope switch", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { rerender } = render(widgets(client));
	context.role = "employee";
	rerender(widgets(client));
	expect(screen.queryByText("Current employees")).toBeNull();
	context.organizationId = "org-b";
	vi.stubGlobal(
		"fetch",
		vi.fn(() => new Promise(() => {})),
	);
	rerender(widgets(client));
	expect(screen.queryByText("Ada Lovelace")).toBeNull();
	expect(screen.queryByText("Grace Hopper")).toBeNull();
	expect(screen.queryByText("Dorothy Vaughan")).toBeNull();
	context.organizationId = "org-a";
});

it("does not duplicate a slow initial server delivery with an immediate GET", async () => {
	const initial = snapshot(managed);
	initial.updatedAt -= 120_000;
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ManagedEmployeesWidget initialSnapshot={initial} />
		</QueryClientProvider>,
	);
	await act(async () => {});
	expect(fetch).not.toHaveBeenCalled();
	expect(screen.getByRole("link", { name: /Ada Lovelace/ })).toBeTruthy();
});
