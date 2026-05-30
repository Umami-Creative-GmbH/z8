/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderTimezoneControl } from "./header-timezone-control";
import { formatHeaderTimezone } from "./header-timezone-control-utils";

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	updateTimezone: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
	timezone: "Europe/Berlin",
	timeFormat: "24h" as "24h" | "12h",
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => mocks.timeFormat,
	useUserTimezone: () => mocks.timezone,
}));

vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone: (timezone: string) => mocks.updateTimezone(timezone),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: (message: string) => mocks.toastSuccess(message),
		error: (message: string) => mocks.toastError(message),
	},
}));

vi.mock("@/components/settings/timezone-picker", () => ({
	TimezonePicker: ({
		value,
		onChange,
		disabled,
	}: {
		value: string;
		onChange: (timezone: string) => void;
		disabled?: boolean;
	}) => (
		<label>
			Timezone picker
			<select
				aria-label="Timezone picker"
				disabled={disabled}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="Europe/Berlin">Europe/Berlin</option>
				<option value="America/New_York">America/New_York</option>
			</select>
		</label>
	),
}));

describe("formatHeaderTimezone", () => {
	it("formats 24-hour local time without seconds and includes the current UTC offset", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Europe/Berlin", timeFormat: "24h" })).toEqual({
			displayTimezone: "Europe/Berlin",
			offsetLabel: "UTC+02:00",
			timeLabel: "14:34",
		});
	});

	it("formats 12-hour local time without seconds", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "America/New_York", timeFormat: "12h" })).toEqual({
			displayTimezone: "America/New_York",
			offsetLabel: "UTC-04:00",
			timeLabel: "8:34 AM",
		});
	});

	it("falls back to UTC when the stored timezone is invalid", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Not/AZone", timeFormat: "24h" })).toEqual({
			displayTimezone: "UTC",
			offsetLabel: "UTC+00:00",
			timeLabel: "12:34",
		});
	});
});

describe("HeaderTimezoneControl", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-29T12:34:56.000Z"));
		mocks.timezone = "Europe/Berlin";
		mocks.timeFormat = "24h";
		mocks.refresh.mockReset();
		mocks.updateTimezone.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows the current configured time and UTC offset in the trigger", () => {
		render(<HeaderTimezoneControl />);

		expect(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i })).toBeTruthy();
		expect(screen.getByText("14:34")).toBeTruthy();
		expect(screen.getByText("UTC+02:00")).toBeTruthy();
		expect(screen.queryByText(/14:34:56/)).toBeNull();
	});

	it("updates the displayed time at the next minute boundary", async () => {
		render(<HeaderTimezoneControl />);

		expect(screen.getByText("14:34")).toBeTruthy();

		vi.setSystemTime(new Date("2026-05-29T12:35:00.000Z"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(4_000);
		});

		expect(screen.getByText("14:35")).toBeTruthy();
		expect(screen.queryByText("14:34")).toBeNull();
	});

	it("syncs the displayed time when the minute rolls over before effects schedule", async () => {
		const nowSpy = vi
			.spyOn(DateTime, "now")
			.mockReturnValueOnce(DateTime.fromISO("2026-05-29T12:34:59.999Z", { zone: "utc" }))
			.mockReturnValueOnce(DateTime.fromISO("2026-05-29T12:35:00.000Z", { zone: "utc" }));

		render(<HeaderTimezoneControl />);

		await act(async () => {});

		expect(screen.getByText("14:35")).toBeTruthy();
		expect(screen.queryByText("14:34")).toBeNull();
		nowSpy.mockRestore();
	});

	it("opens a popover with a disabled save button until the draft timezone changes", async () => {
		render(<HeaderTimezoneControl />);
		vi.useRealTimers();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));

		expect(screen.getByText("Saved timezone")).toBeTruthy();
		expect(screen.getAllByText("Europe/Berlin").length).toBeGreaterThan(0);
		expect(
			(screen.getByRole("button", { name: "Save timezone" }) as HTMLButtonElement).disabled,
		).toBe(true);

		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");

		expect(
			(screen.getByRole("button", { name: "Save timezone" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("saves the selected timezone, refreshes the route, and shows success feedback", async () => {
		mocks.updateTimezone.mockResolvedValue({ success: true });
		render(<HeaderTimezoneControl />);
		vi.useRealTimers();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));
		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");
		await user.click(screen.getByRole("button", { name: "Save timezone" }));

		await waitFor(() => expect(mocks.updateTimezone).toHaveBeenCalledWith("America/New_York"));
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Timezone updated successfully");
	});

	it("shows a busy saving state while the timezone update is pending", async () => {
		let resolveUpdate: (value: { success: true }) => void = () => {};
		mocks.updateTimezone.mockReturnValue(
			new Promise((resolve) => {
				resolveUpdate = resolve;
			}),
		);
		render(<HeaderTimezoneControl />);
		vi.useRealTimers();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));
		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");
		await user.click(screen.getByRole("button", { name: "Save timezone" }));

		const saveButton = screen.getByRole("button", { name: "Saving..." });
		expect(saveButton.getAttribute("aria-busy")).toBe("true");
		expect((saveButton as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByLabelText("Timezone picker") as HTMLSelectElement).disabled).toBe(true);

		resolveUpdate({ success: true });
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
	});

	it("keeps the popover open and preserves the draft timezone when save fails", async () => {
		mocks.updateTimezone.mockResolvedValue({ success: false, error: "Failed to update timezone" });
		render(<HeaderTimezoneControl />);
		vi.useRealTimers();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: /Current timezone Europe\/Berlin/i }));
		await user.selectOptions(screen.getByLabelText("Timezone picker"), "America/New_York");
		await user.click(screen.getByRole("button", { name: "Save timezone" }));

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Failed to update timezone"));
		expect(mocks.refresh).not.toHaveBeenCalled();
		expect((screen.getByLabelText("Timezone picker") as HTMLSelectElement).value).toBe(
			"America/New_York",
		);
		expect(screen.getByText("Saved timezone")).toBeTruthy();
	});
});
