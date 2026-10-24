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

const { waterCommand } = vi.hoisted(() => ({ waterCommand: vi.fn() }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./actions", () => ({
	getUpcomingBirthdays: vi.fn(),
	getHydrationWidgetData: vi.fn(),
	getVacationBalanceResult: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getCurrentEmployee: vi.fn(),
	getPresenceStatus: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/wellness/actions", () => ({ logWaterIntake: waterCommand }));

import { BirthdayRemindersWidget } from "./birthday-reminders-widget";
import type { DashboardWidgetSnapshot } from "./dashboard-types";
import { HydrationWidget } from "./hydration-widget";
import { PresenceStatusWidget } from "./presence-status-widget";
import { VacationBalanceWidget } from "./vacation-balance-widget";

const scope = { userId: "user-a", organizationId: "org-a" };
const snapshot = <T,>(data: T): DashboardWidgetSnapshot<T> => ({
	scope,
	updatedAt: Date.now(),
	result: { success: true, data },
});
const birthdays = [
	{
		id: "birthday-a",
		userId: "birthday-user",
		image: null,
		user: { name: "Ada Lovelace" },
		nextBirthday: "2026-10-24",
		daysUntil: 0,
	},
];
const hydration = {
	enabled: true,
	currentStreak: 2,
	longestStreak: 4,
	todayIntake: 1,
	dailyGoal: 8,
	goalProgress: 13,
	teamStreakLeaders: [],
	organizationStreakLeaders: [],
};
const vacation = {
	year: 2026,
	configuration: { status: "resolved" as const },
	balance: {
		totalDays: 30,
		usedDays: 6.5,
		pendingDays: 1,
		remainingDays: 22.5,
		carryoverDays: 0,
		carryoverExpiryDate: null,
		carryoverExpiryDaysRemaining: null,
		hasCarryover: false,
	},
};
const presence = {
	presenceEnabled: true,
	available: true,
	period: "weekly" as const,
	periodStart: "2026-10-19T00:00:00.000Z",
	periodEnd: "2026-10-25T23:59:59.999Z",
	mode: "minimum_count" as const,
	homeOfficeDaysLeft: 3,
	officeDaysRequiredLeft: 2,
	officeDaysCompleted: 1,
	homeOfficeDaysUsed: 0,
	workingDaysRemaining: 3,
	requiredOfficeDays: 3,
	fixedOfficeDays: [],
	message: null,
};

beforeEach(() => {
	context.organizationId = "org-a";
	vi.stubGlobal("fetch", vi.fn());
	waterCommand.mockReset();
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
			<BirthdayRemindersWidget initialSnapshot={deliver("birthday-reminders", birthdays)} />
			<HydrationWidget initialSnapshot={deliver("hydration", hydration)} />
			<VacationBalanceWidget initialSnapshot={deliver("vacation-balance", vacation)} />
			<PresenceStatusWidget initialSnapshot={deliver("presence-status", presence)} />
		</QueryClientProvider>
	);
}
it("renders all four personal regions from scoped server data without queued initial reads or an employee lookup", () => {
	render(widgets());
	expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
	expect(screen.getByRole("button", { name: "Add 1 glass" })).toBeTruthy();
	expect(screen.getAllByText("22.5").length).toBeGreaterThan(0);
	expect(screen.getByText("Home office left")).toBeTruthy();
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	["birthday-reminders", "Upcoming Birthdays", birthdays, "Ada Lovelace"],
	["hydration", "Hydration", hydration, "of 8"],
	["vacation-balance", "Vacation Balance", vacation, "22.5"],
	["presence-status", "Work location", presence, "Home office left"],
])(
	"holds and fails %s locally while completed siblings and a draft stay usable",
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
		render(
			<>
				<input aria-label="Draft note" defaultValue="" />
				{widgets(new QueryClient({ defaultOptions: { queries: { retry: false } } }), id)}
			</>,
		);
		fireEvent.change(screen.getByLabelText("Draft note"), { target: { value: "Unsaved" } });
		expect(request).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: `Retry ${title}` }));
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
		expect(
			id === "hydration"
				? screen.getByText("Home office left")
				: screen.getByRole("button", { name: "Add 1 glass" }),
		).toBeTruthy();
		await act(async () => fail(new Error("Fixture failed")));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: `Retry ${title}` }).hasAttribute("disabled")).toBe(
				false,
			),
		);
		fireEvent.click(screen.getByRole("button", { name: `Retry ${title}` }));
		await screen.findAllByText(readyText);
		expect(screen.queryByRole("alert")).toBeNull();
		expect((screen.getByLabelText("Draft note") as HTMLInputElement).value).toBe("Unsaved");
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			`/api/dashboard/widgets/${id}`,
			`/api/dashboard/widgets/${id}`,
		]);
	},
);

it("logs water through the authoritative command and reads only hydration back without replacing a draft", async () => {
	waterCommand.mockResolvedValue({ success: true, data: { goalJustMet: false } });
	const request = vi.fn(async () =>
		Response.json(snapshot({ ...hydration, todayIntake: 3, goalProgress: 38 })),
	);
	vi.stubGlobal("fetch", request);
	render(
		<>
			<input aria-label="Draft note" defaultValue="Unsaved" />
			{widgets()}
		</>,
	);
	expect(request).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Add 2 glasses" }));
	await waitFor(() => expect(waterCommand).toHaveBeenCalledWith({ amount: 2, source: "widget" }));
	await waitFor(() => expect(screen.getAllByText("3").length).toBeGreaterThan(0));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Add 2 glasses" }).hasAttribute("disabled")).toBe(
			false,
		),
	);
	expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/dashboard/widgets/hydration"]);
	expect((screen.getByLabelText("Draft note") as HTMLInputElement).value).toBe("Unsaved");
});

it("keeps missing or unknown vacation balances distinct from numeric zero", () => {
	const client = new QueryClient();
	const renderBalance = (configuration: typeof vacation.configuration | null) => (
		<QueryClientProvider client={client}>
			<VacationBalanceWidget
				initialSnapshot={snapshot({ year: 2026, balance: null, configuration })}
			/>
		</QueryClientProvider>
	);
	render(renderBalance(null));
	expect(screen.getByRole("alert")).toBeTruthy();
	expect(screen.queryByText("0.0")).toBeNull();
	expect(screen.queryByText("days remaining")).toBeNull();
});

it("hides known-disabled feature snapshots without initial reads", () => {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<HydrationWidget initialSnapshot={snapshot({ ...hydration, enabled: false })} />
			<PresenceStatusWidget
				initialSnapshot={snapshot({ ...presence, presenceEnabled: false, available: false })}
			/>
		</QueryClientProvider>,
	);
	expect(screen.queryByText("Hydration")).toBeNull();
	expect(screen.queryByText("Work location")).toBeNull();
	expect(fetch).not.toHaveBeenCalled();
});
