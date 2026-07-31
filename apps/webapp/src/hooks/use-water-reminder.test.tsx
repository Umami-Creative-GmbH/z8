/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWaterReminderStatus } from "@/app/[locale]/(app)/wellness/actions";
import { useHydrationStats } from "./use-hydration-stats";
import { useWaterReminder } from "./use-water-reminder";

vi.mock("@/app/[locale]/(app)/wellness/actions", () => ({
	getWaterReminderStatus: vi.fn(),
}));

vi.mock("./use-hydration-stats", () => ({
	useHydrationStats: vi.fn(),
}));

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return ({ children }: { children: ReactNode }) => (
		<StrictMode>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</StrictMode>
	);
}

describe("useWaterReminder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		vi.mocked(getWaterReminderStatus).mockResolvedValue({
			success: true,
			data: {
				enabled: true,
				intervalMinutes: 45,
				dailyGoal: 8,
				snoozedUntil: null,
				lastIntakeTime: null,
			},
		});
		vi.mocked(useHydrationStats).mockReturnValue({
			snoozedUntil: null,
			todayIntake: 0,
		} as ReturnType<typeof useHydrationStats>);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
		);
	});

	it("keeps reminder delivery outside the timer effect", () => {
		const source = readFileSync(
			resolve("src/hooks/use-water-reminder.ts"),
			"utf8",
		);

		expect(source).toContain("sendWaterReminderNotification()");
		expect(source).toContain('fetch("/api/wellness/water-reminder"');
		expect(source).toContain('credentials: "include"');
	});

	it("sends once per due work session even when effects replay", async () => {
		const now = Date.now();
		const firstSession = new Date(now - 60 * 60 * 1000);
		const secondSession = new Date(now - 50 * 60 * 1000);
		const { rerender } = renderHook(
			({ workSessionStart }) => useWaterReminder({ workSessionStart }),
			{
				initialProps: { workSessionStart: firstSession },
				wrapper: createWrapper(),
			},
		);

		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		rerender({ workSessionStart: firstSession });
		expect(fetch).toHaveBeenCalledTimes(1);

		rerender({ workSessionStart: secondSession });
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
	});
});
