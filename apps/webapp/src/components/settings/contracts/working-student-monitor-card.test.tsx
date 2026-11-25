/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getWorkingStudentMonitorAction: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/contracts/working-student-actions", () => ({
	getWorkingStudentMonitorAction: mocks.getWorkingStudentMonitorAction,
	recordWorkingStudentLectureFreePeriodAction: vi.fn(),
	recordWorkingStudentPriorWeeksAction: vi.fn(),
	voidWorkingStudentLectureFreePeriodAction: vi.fn(),
	voidWorkingStudentPriorWeeksAction: vi.fn(),
}));

const { WorkingStudentMonitorCard } = await import("./working-student-monitor-card");
const { UserPreferencesProvider } =
	await import("@/components/providers/user-preferences-provider");

function renderCard(timeFormat: "24h" | "12h") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<UserPreferencesProvider timeFormat={timeFormat}>
			<QueryClientProvider client={client}>
				<WorkingStudentMonitorCard organizationId="org-1" employeeId="emp-1" canManage={false} />
			</QueryClientProvider>
		</UserPreferencesProvider>,
	);
}

describe("WorkingStudentMonitorCard daytime band", () => {
	afterEach(cleanup);

	beforeEach(() => {
		mocks.getWorkingStudentMonitorAction.mockResolvedValue({
			success: true,
			data: {
				applies: true,
				currentlyWorkingStudent: true,
				audience: "restricted",
				daytimeBand: { startMinute: 18 * 60, endMinute: 1440 },
				rolling: null,
				weeks: [],
				findings: [],
				lectureFreePeriods: [],
				priorWeeks: null,
			},
		});
	});

	it("writes the band in 24-hour time, the end of the day as 24:00", async () => {
		renderCard("24h");

		expect(await screen.findByText(/weekday daytime work \(18:00–24:00\)/)).toBeTruthy();
	});

	it("writes the band in the reader's 12-hour time, the end of the day as midnight", async () => {
		renderCard("12h");

		expect(await screen.findByText(/weekday daytime work \(6:00 PM–12:00 AM\)/)).toBeTruthy();
	});
});
