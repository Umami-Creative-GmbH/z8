/* @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHydrationWidgetData } from "./actions";
import { HydrationWidget } from "./hydration-widget";

const { getHydrationWidgetDataMock, logWaterIntakeMock, toastErrorMock, translateMock } =
	vi.hoisted(() => ({
		getHydrationWidgetDataMock: vi.fn(),
		logWaterIntakeMock: vi.fn(),
		toastErrorMock: vi.fn(),
		translateMock: vi.fn(
			(_key: string, fallback: string, params?: Record<string, string | number>) =>
				Object.entries(params ?? {}).reduce(
					(message, [key, value]) => message.replace(`{${key}}`, String(value)),
					fallback,
				),
		),
	}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: translateMock,
	}),
}));

vi.mock("canvas-confetti", () => ({
	default: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { error: toastErrorMock },
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: "org-1" }),
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

vi.mock("@dnd-kit/utilities", () => ({
	CSS: { Translate: { toString: () => undefined } },
}));

vi.mock("@/app/[locale]/(app)/wellness/actions", () => ({
	logWaterIntake: logWaterIntakeMock,
}));

vi.mock("./actions", () => ({
	getHydrationWidgetData: getHydrationWidgetDataMock,
}));

const enabledHydrationData = {
	enabled: true,
	currentStreak: 4,
	longestStreak: 8,
	todayIntake: 3,
	dailyGoal: 8,
	goalProgress: 38,
};

describe("HydrationWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		translateMock.mockImplementation(
			(_key: string, fallback: string, params?: Record<string, string | number>) =>
				Object.entries(params ?? {}).reduce(
					(message, [key, value]) => message.replace(`{${key}}`, String(value)),
					fallback,
				),
		);
	});

	it("renders team streak leaderboard rows when leaders exist", async () => {
		getHydrationWidgetDataMock.mockResolvedValue({
			success: true,
			data: {
				...enabledHydrationData,
				teamStreakLeaders: [
					{
						employeeId: "emp-1",
						displayName: "Avery Stone",
						currentStreak: 9,
						isCurrentUser: false,
					},
					{
						employeeId: "emp-2",
						displayName: "Blair Kim",
						currentStreak: 7,
						isCurrentUser: true,
					},
				],
			},
		});

		render(<HydrationWidget />);

		const leaders = await screen.findByTestId("hydration-team-streak-leaders");
		expect(within(leaders).getByText("Avery Stone")).toBeTruthy();
		expect(within(leaders).getByText("Blair Kim")).toBeTruthy();
		expect(within(leaders).getByText("#1")).toBeTruthy();
		expect(within(leaders).getByText("#2")).toBeTruthy();
		expect(within(leaders).getByText("9 days")).toBeTruthy();
		expect(within(leaders).getByText("7 days")).toBeTruthy();
		expect(getHydrationWidgetData).toHaveBeenCalledTimes(1);
	});

	it("renders a subtle You label for the current user's leaderboard row", async () => {
		getHydrationWidgetDataMock.mockResolvedValue({
			success: true,
			data: {
				...enabledHydrationData,
				teamStreakLeaders: [
					{
						employeeId: "emp-1",
						displayName: "Avery Stone",
						currentStreak: 9,
						isCurrentUser: false,
					},
					{
						employeeId: "emp-2",
						displayName: "Blair Kim",
						currentStreak: 7,
						isCurrentUser: true,
					},
				],
			},
		});

		render(<HydrationWidget />);

		const blairRow = await screen.findByLabelText(
			"Blair Kim, rank 2, streak: 7 days, current user",
		);
		expect(within(blairRow).getByText("You")).toBeTruthy();
	});

	it("uses localized labels for the team streak leaderboard", async () => {
		translateMock.mockImplementation(
			(key: string, fallback: string, params?: Record<string, string | number>) => {
				if (key === "dashboard.hydration.team-streaks") return "Team-Serie";
				if (key === "dashboard.hydration.you") return "Du";
				if (key === "dashboard.hydration.streak-days") return `${params?.count} Tage`;
				if (key === "dashboard.hydration.team-streak-current-user-suffix") return ", Du";
				if (key === "dashboard.hydration.team-streak-row") {
					return `${params?.name}, Rang ${params?.rank}, ${params?.streakLabel}${params?.currentUserLabel}`;
				}

				return Object.entries(params ?? {}).reduce(
					(message, [paramKey, value]) => message.replace(`{${paramKey}}`, String(value)),
					fallback,
				);
			},
		);
		getHydrationWidgetDataMock.mockResolvedValue({
			success: true,
			data: {
				...enabledHydrationData,
				teamStreakLeaders: [
					{
						employeeId: "emp-1",
						displayName: "Blair Kim",
						currentStreak: 7,
						isCurrentUser: true,
					},
				],
			},
		});

		render(<HydrationWidget />);

		const leaders = await screen.findByTestId("hydration-team-streak-leaders");
		expect(within(leaders).getByText("Team-Serie")).toBeTruthy();
		expect(within(leaders).getByText("Du")).toBeTruthy();
		expect(within(leaders).getByText("7 Tage")).toBeTruthy();
		expect(screen.getByLabelText("Blair Kim, Rang 1, 7 Tage, Du")).toBeTruthy();
	});

	it("does not render the team streak leaderboard when no leaders exist", async () => {
		getHydrationWidgetDataMock.mockResolvedValue({
			success: true,
			data: {
				...enabledHydrationData,
				teamStreakLeaders: [],
			},
		});

		render(<HydrationWidget />);

		await waitFor(() => expect(getHydrationWidgetDataMock).toHaveBeenCalledTimes(1));
		expect(screen.queryByTestId("hydration-team-streak-leaders")).toBeNull();
	});
});
