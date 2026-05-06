/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReminderPanel } from "@/components/time-tracking/session-reminder-panel";

const getBreakReminderStatusMock = vi.fn();
const useElapsedTimerMock = vi.fn();
const useWaterReminderMock = vi.fn();
const useHydrationStatsMock = vi.fn();

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getBreakReminderStatus: () => getBreakReminderStatusMock(),
}));

vi.mock("@/lib/query", () => ({
	queryKeys: {
		timeClock: {
			breakStatus: () => ["time-clock", "break-status"],
		},
	},
	useElapsedTimer: () => useElapsedTimerMock(),
}));

vi.mock("@/hooks/use-water-reminder", () => ({
	useWaterReminder: (...args: unknown[]) => useWaterReminderMock(...args),
}));

vi.mock("@/hooks/use-hydration-stats", () => ({
	useHydrationStats: (...args: unknown[]) => useHydrationStatsMock(...args),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string | number>) => {
			if (!values) return fallback;
			return Object.entries(values).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function setupDefaults() {
	getBreakReminderStatusMock.mockResolvedValue({
		success: true,
		data: {
			maxUninterrupted: 240,
			breakRequirement: null,
		},
	});
	useElapsedTimerMock.mockReturnValue(60 * 60);
	useWaterReminderMock.mockReturnValue({
		enabled: false,
		showReminder: false,
		isSnoozed: false,
		handleReminderAction: vi.fn(),
		dismiss: vi.fn(),
	});
	useHydrationStatsMock.mockReturnValue({
		todayIntake: 0,
		dailyGoal: 8,
		goalProgress: 0,
		currentStreak: 0,
		logIntake: vi.fn(),
		snooze: vi.fn(),
		isLogging: false,
		isSnoozing: false,
		goalMet: false,
	});
}

describe("SessionReminderPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("does not render while clocked out", () => {
		renderWithQueryClient(<SessionReminderPanel isClockedIn={false} sessionStartTime={null} />);

		expect(screen.queryByText("Session reminders")).toBeNull();
	});

	it("renders nothing when no break or water reminder is due", async () => {
		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		await waitFor(() => expect(getBreakReminderStatusMock).toHaveBeenCalled());
		expect(screen.queryByText("Session reminders")).toBeNull();
	});

	it("shows approaching break copy in a compact panel", async () => {
		useElapsedTimerMock.mockReturnValue(230 * 60);

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Session reminders")).toBeTruthy();
		expect(screen.getByText("Break soon")).toBeTruthy();
		expect(screen.getByText("10 min until break")).toBeTruthy();
	});

	it("treats zero remaining break minutes as required now", async () => {
		useElapsedTimerMock.mockReturnValue(240 * 60);

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Break required now")).toBeTruthy();
		expect(screen.queryByText("0 min until break")).toBeNull();
	});

	it("treats break requirements without a countdown as required now", async () => {
		getBreakReminderStatusMock.mockResolvedValue({
			success: true,
			data: {
				maxUninterrupted: null,
				breakRequirement: { remaining: 15, totalNeeded: 30 },
			},
		});

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Break required now")).toBeTruthy();
		expect(screen.getByText("Take a break before continuing your session.")).toBeTruthy();
		expect(screen.getByText("15 min break remaining")).toBeTruthy();
		expect(screen.queryByText("0 min until break")).toBeNull();
	});

	it("renders hydration progress and logs one glass", async () => {
		const logIntake = vi.fn().mockResolvedValue({ goalJustMet: false, goalProgress: 50 });
		const handleReminderAction = vi.fn();
		useWaterReminderMock.mockReturnValue({
			enabled: true,
			showReminder: true,
			isSnoozed: false,
			handleReminderAction,
			dismiss: vi.fn(),
		});
		useHydrationStatsMock.mockReturnValue({
			todayIntake: 3,
			dailyGoal: 8,
			goalProgress: 38,
			currentStreak: 0,
			logIntake,
			snooze: vi.fn(),
			isLogging: false,
			isSnoozing: false,
			goalMet: false,
		});

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Hydration")).toBeTruthy();
		expect(screen.getByText("3/8 glasses today")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "+1 glass" }));

		await waitFor(() =>
			expect(logIntake).toHaveBeenCalledWith({ amount: 1, source: "reminder_action" }),
		);
		expect(handleReminderAction).toHaveBeenCalled();
	});

	it("uses contextual dismiss button names when both reminders are visible", async () => {
		useElapsedTimerMock.mockReturnValue(230 * 60);
		useWaterReminderMock.mockReturnValue({
			enabled: true,
			showReminder: true,
			isSnoozed: false,
			handleReminderAction: vi.fn(),
			dismiss: vi.fn(),
		});

		renderWithQueryClient(
			<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />,
		);

		expect(await screen.findByText("Break soon")).toBeTruthy();
		expect(screen.getByText("Hydration")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Dismiss break reminder" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Dismiss hydration reminder" })).toBeTruthy();
	});

	it("refetches break status for a new active session", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />
			</QueryClientProvider>,
		);

		await waitFor(() => expect(getBreakReminderStatusMock).toHaveBeenCalledTimes(1));

		rerender(
			<QueryClientProvider client={queryClient}>
				<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T09:00:00Z")} />
			</QueryClientProvider>,
		);

		await waitFor(() => expect(getBreakReminderStatusMock).toHaveBeenCalledTimes(2));
	});

	it("resets water dismissal when a new session starts", async () => {
		const resetDismissed = vi.fn();
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		useWaterReminderMock.mockReturnValue({
			enabled: true,
			showReminder: true,
			isSnoozed: false,
			handleReminderAction: vi.fn(),
			dismiss: vi.fn(),
			resetDismissed,
		});

		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T08:00:00Z")} />
			</QueryClientProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Dismiss hydration reminder" }));

		rerender(
			<QueryClientProvider client={queryClient}>
				<SessionReminderPanel isClockedIn sessionStartTime={new Date("2026-05-06T09:00:00Z")} />
			</QueryClientProvider>,
		);

		expect(resetDismissed).toHaveBeenCalled();
	});
});
