/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

const loading = vi.hoisted(() => ({ hydration: true, birthdays: true }));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "widget-user",
		organizationId: "widget-org",
		role: "manager",
		isLoading: false,
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params: Record<string, string> = {}) =>
			Object.entries(params).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, value),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/app/[locale]/(app)/wellness/actions", () => ({
	logWaterIntake: vi.fn(),
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));
vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("./hydration-widget", async (original) => {
	const actual = await original<typeof import("./hydration-widget")>();
	return {
		get HydrationWidget() {
			if (loading.hydration)
				throw new Error("Transient widget module load failure");
			return actual.HydrationWidget;
		},
	};
});
vi.mock("./birthday-reminders-widget", async (original) => {
	const actual = await original<typeof import("./birthday-reminders-widget")>();
	return {
		get BirthdayRemindersWidget() {
			if (loading.birthdays)
				throw new Error("Transient widget module load failure");
			return actual.BirthdayRemindersWidget;
		},
	};
});

import { DeferredDashboardWidget } from "./deferred-dashboard-widget";

// Represents the surrounding route boundary. A widget failure must never reach it.
class PageBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		return this.state.failed ? (
			<p>Dashboard unavailable</p>
		) : (
			this.props.children
		);
	}
}
function ClockSibling() {
	const [uses, setUses] = useState(0);
	return (
		<button type="button" onClick={() => setUses((count) => count + 1)}>
			Clock control {uses}
		</button>
	);
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it.each([
	["hydration", "Hydration", "hydration", "Add 1 glass"],
	["birthday-reminders", "Upcoming Birthdays", "birthdays", "Ada Lovelace"],
] as const)(
	"isolates a rejected %s module and retries actual lazy loading without remounting siblings",
	async (id, title, fault, loaded) => {
		class Observer {
			observe() {}
			disconnect() {}
		}
		vi.stubGlobal("IntersectionObserver", Observer);
		vi.spyOn(console, "error").mockImplementation(() => {});
		loading[fault] = true;
		const request = vi.fn(async () =>
			Response.json({
				scope: { userId: "widget-user", organizationId: "widget-org" },
				updatedAt: Date.now(),
				result: {
					success: true,
					data:
						id === "hydration"
							? {
									enabled: true,
									currentStreak: 1,
									longestStreak: 2,
									todayIntake: 1,
									dailyGoal: 8,
									goalProgress: 13,
									teamStreakLeaders: [],
									organizationStreakLeaders: [],
								}
							: [
									{
										id: "birthday",
										userId: "birthday-user",
										user: { name: "Ada Lovelace" },
										image: null,
										nextBirthday: "2026-10-24",
										daysUntil: 0,
									},
								],
				},
			}),
		);
		vi.stubGlobal("fetch", request);
		render(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<PageBoundary>
					<ClockSibling />
					<input aria-label="Widget draft" defaultValue="Unsaved" />
					<DeferredDashboardWidget id={id} />
				</PageBoundary>
			</QueryClientProvider>,
		);
		const draft = screen.getByRole<HTMLInputElement>("textbox", {
			name: "Widget draft",
		});
		fireEvent.change(draft, { target: { value: "Edited unsaved draft" } });
		fireEvent.click(screen.getByRole("button", { name: `Load ${title}` }));
		const retry = await screen.findByRole("button", { name: `Retry ${title}` });
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByText("Dashboard unavailable")).toBeNull();
		expect(request).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Clock control 0" }));
		expect(
			screen.getByRole("button", { name: "Clock control 1" }),
		).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Widget draft" })).toBe(draft);
		expect(draft.value).toBe("Edited unsaved draft");
		loading[fault] = false;
		retry.focus();
		fireEvent.click(retry);
		if (id === "hydration") await screen.findByRole("button", { name: loaded });
		else await screen.findAllByText(loaded);
		expect(request).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("textbox", { name: "Widget draft" })).toBe(draft);
		expect(draft.value).toBe("Edited unsaved draft");
		expect(document.activeElement).toBe(
			screen.getByRole("region", { name: title }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Clock control 1" }));
		expect(
			screen.getByRole("button", { name: "Clock control 2" }),
		).toBeTruthy();
	},
);
