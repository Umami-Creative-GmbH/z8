/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeClockPopover } from "@/components/time-tracking/time-clock-popover";

const toastMocks = vi.hoisted(() => ({
	success: vi.fn(),
	info: vi.fn(),
	error: vi.fn(),
}));

const clockInMock = vi.fn();
const clockOutMock = vi.fn();
const addBreakMock = vi.fn();
const updateNotesMock = vi.fn();
const useElapsedTimerMock = vi.fn();

let localStorageData: Record<string, string> = {};
let isClockedInMock = false;
let activeWorkPeriodMock: { startTime: string } | null = null;

vi.mock("@/lib/query", () => ({
	useElapsedTimer: () => useElapsedTimerMock(),
	useTimeClock: () => ({
		hasEmployee: true,
		employeeId: "employee-1",
		isClockedIn: isClockedInMock,
		activeWorkPeriod: activeWorkPeriodMock,
		isLoading: false,
		clockIn: clockInMock,
		clockOut: clockOutMock,
		addBreak: addBreakMock,
		updateNotes: updateNotesMock,
		isClockingOut: false,
		isAddingBreak: false,
		isUpdatingNotes: false,
		isMutating: false,
	}),
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
		success: toastMocks.success,
		info: toastMocks.info,
		error: toastMocks.error,
	},
}));

vi.mock("@/components/time-tracking/project-selector", () => ({
	ProjectSelector: () => null,
}));

vi.mock("@/components/time-tracking/work-category-selector", () => ({
	WorkCategorySelector: () => null,
}));

describe("TimeClockPopover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageData = {};
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((key: string) => localStorageData[key] ?? null),
			setItem: vi.fn((key: string, value: string) => {
				localStorageData[key] = value;
			}),
		});
		useElapsedTimerMock.mockReturnValue(0);
		isClockedInMock = false;
		activeWorkPeriodMock = null;
		clockInMock.mockResolvedValue({ success: true });
		addBreakMock.mockResolvedValue({ success: true });
	});

	it("submits office as the default quick clock-in work location", async () => {
		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Clock In" }).at(-1)!);

		await waitFor(() => expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "office" }));
	});

	it("submits remote when selected before quick clock-in", async () => {
		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		fireEvent.click(screen.getByRole("radio", { name: "Remote" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Clock In" }).at(-1)!);

		await waitFor(() => expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "remote" }));
	});

	it("does not show an add break button in the header while clocked in", () => {
		isClockedInMock = true;
		activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };

		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

		expect(screen.queryByRole("button", { name: "Add break" })).toBeNull();
	});

	it("does not show an icon-only quick break trigger next to the header clock-out button while clocked in", () => {
		isClockedInMock = true;
		activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };

		render(<TimeClockPopover />);

		expect(screen.getByRole("button", { name: /Clock Out/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add break" })).toBeNull();
	});

	it("does not show the header quick break trigger while clocked out", () => {
		isClockedInMock = false;

		render(<TimeClockPopover />);

		expect(screen.queryByRole("button", { name: "Add break" })).toBeNull();
	});
});
