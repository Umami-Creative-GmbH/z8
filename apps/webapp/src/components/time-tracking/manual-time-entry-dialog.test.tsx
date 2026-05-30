/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualTimeEntryDialog } from "./manual-time-entry-dialog";

const { createManualTimeEntry, refresh, updateTimezone } = vi.hoisted(() => ({
	createManualTimeEntry: vi.fn(),
	refresh: vi.fn(),
	updateTimezone: vi.fn(),
}));

const { getBrowserTimezone } = vi.hoisted(() => ({
	getBrowserTimezone: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key: string) => params?.[key] ?? `{${key}}`),
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));

vi.mock("@/lib/time-tracking/timezone-utils", () => ({
	formatTimeInZone: () => "09:00",
	getTimezoneAbbreviation: () => "UTC",
}));

vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	getBrowserTimezone,
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		name,
		onChange,
		value,
	}: {
		name: string;
		onChange: (value: string) => void;
		value: string;
	}) => (
		<input
			aria-label="Date"
			name={name}
			onChange={(event) => onChange(event.target.value)}
			value={value}
		/>
	),
}));

vi.mock("@/components/ui/time-input", () => ({
	TimeInput: ({
		name,
		onChange,
		value,
	}: {
		name: string;
		onChange: (event: { target: { value: string } }) => void;
		value: string;
	}) => (
		<input
			aria-label={name === "clockInTime" ? "Clock In" : "Clock Out"}
			name={name}
			onChange={(event) => onChange(event)}
			value={value}
		/>
	),
}));

vi.mock("@/components/time-tracking/project-selector", () => ({
	ProjectSelector: ({
		onValueChange,
		value,
	}: {
		onValueChange: (value: string) => void;
		value?: string;
	}) => (
		<select
			aria-label="Project"
			onChange={(event) => onValueChange(event.target.value)}
			value={value ?? ""}
		>
			<option value="">No project</option>
			<option value="project-1">Project 1</option>
		</select>
	),
}));

vi.mock("@/components/time-tracking/work-category-selector", () => ({
	WorkCategorySelector: ({
		employeeId,
		onValueChange,
		value,
	}: {
		employeeId: string;
		onValueChange: (value: string) => void;
		value?: string;
	}) => (
		<div data-employee-id={employeeId} data-testid="work-category-selector">
			<select
				aria-label="Work category"
				onChange={(event) => onValueChange(event.target.value)}
				value={value ?? ""}
			>
				<option value="">No category</option>
				<option value="category-1">Category 1</option>
			</select>
		</div>
	),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	createManualTimeEntry,
}));

vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone,
}));

function renderDialog(props: Partial<Parameters<typeof ManualTimeEntryDialog>[0]> = {}) {
	return render(
		<ManualTimeEntryDialog
			employeeId="employee-current"
			employeeTimezone="UTC"
			hasManager={false}
			{...props}
		/>,
	);
}

function deferredResult<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
}

describe("ManualTimeEntryDialog layout", () => {
	beforeEach(() => {
		createManualTimeEntry.mockReset();
		createManualTimeEntry.mockResolvedValue({ success: true, data: {} });
		updateTimezone.mockReset();
		updateTimezone.mockResolvedValue({ success: true });
		getBrowserTimezone.mockReset();
		getBrowserTimezone.mockReturnValue("America/New_York");
		refresh.mockReset();
	});

	it("keeps the form body naturally sized and preserves footer action spacing", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/time-tracking/manual-time-entry-dialog.tsx"),
			"utf8",
		);

		expect(source).toContain('className="flex min-h-0 flex-col"');
		expect(source).not.toContain('className="flex min-h-0 flex-1 flex-col"');
		expect(source).toContain('<ActionPanelFooter className="gap-2">');
		expect(source).not.toContain("sm:gap-0");
	});

	it("formats adjusted toast times with the saved time format preference", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/time-tracking/manual-time-entry-dialog.tsx"),
			"utf8",
		);

		expect(source).toContain("useTimeFormat");
		expect(source).toContain("formatTimeInZone");
		expect(source).toMatch(
			/formatTimeInZone\(\s*result\.data\.adjustedTimes\.clockIn,\s*employeeTimezone,\s*false,\s*timeFormat,\s*\)/,
		);
		expect(source).toMatch(
			/formatTimeInZone\(\s*result\.data\.adjustedTimes\.clockOut,\s*employeeTimezone,\s*false,\s*timeFormat,\s*\)/,
		);
		expect(source).not.toContain('.toFormat("HH:mm")');
	});

	it("renders no trigger button when controlled open with hideTrigger", () => {
		renderDialog({ open: true, hideTrigger: true });

		expect(screen.queryByRole("button", { name: "Add Manual Entry" })).toBeNull();
		expect(screen.getByText("Add Manual Time Entry")).toBeTruthy();
	});

	it("populates the form with provided default date and times", () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-05-12");
		expect((screen.getByLabelText("Clock In") as HTMLInputElement).value).toBe("10:15");
		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe("15:45");
	});

	it("shows the target employee name in the title", () => {
		renderDialog({ open: true, hideTrigger: true, targetEmployeeName: "Jane Doe" });

		expect(screen.getByText("Add Manual Time Entry for Jane Doe")).toBeTruthy();
	});

	it("submits the target employee id and entered form values", async () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			targetEmployeeId: "employee-2",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		expect(screen.getByTestId("work-category-selector").getAttribute("data-employee-id")).toBe(
			"employee-2",
		);

		fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-05-13" } });
		fireEvent.change(screen.getByLabelText("Clock In"), { target: { value: "11:00" } });
		fireEvent.change(screen.getByLabelText("Clock Out"), { target: { value: "16:30" } });
		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.change(screen.getByLabelText("Project"), { target: { value: "project-1" } });
		fireEvent.change(screen.getByLabelText("Work category"), { target: { value: "category-1" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => {
			expect(createManualTimeEntry).toHaveBeenCalledWith({
				employeeId: "employee-2",
				date: "2026-05-13",
				clockInTime: "11:00",
				clockOutTime: "16:30",
				reason: "Calendar adjustment",
				timezone: "Europe/Berlin",
				browserTimezone: null,
				projectId: "project-1",
				workCategoryId: "category-1",
			});
		});
	});

	it("shows timezone mismatch before submitting self manual entries and updates before continuing", async () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		expect(
			await screen.findByText(
				"Your device timezone is America/New_York, but your saved timezone is Europe/Berlin.",
			),
		).toBeTruthy();
		expect(createManualTimeEntry).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Update timezone and continue" }));

		await waitFor(() => {
			expect(updateTimezone).toHaveBeenCalledWith("America/New_York");
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					date: "2026-05-12",
					clockInTime: "10:15",
					clockOutTime: "15:45",
					timezone: "America/New_York",
					browserTimezone: "America/New_York",
				}),
			);
		});
	});

	it("continues once for self manual timezone mismatch without updating saved timezone", async () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		fireEvent.click(await screen.findByRole("button", { name: "Continue once" }));

		await waitFor(() => {
			expect(updateTimezone).not.toHaveBeenCalled();
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					timezone: "America/New_York",
					browserTimezone: "America/New_York",
				}),
			);
		});
	});

	it("keeps mismatch actions disabled while continue-once manual entry submit is pending", async () => {
		const createResult = deferredResult<{ success: true; data: Record<string, never> }>();
		createManualTimeEntry.mockReturnValue(createResult.promise);

		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		const continueButton = await screen.findByRole("button", { name: "Continue once" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(continueButton.hasAttribute("disabled")).toBe(true);
		});
		fireEvent.click(continueButton);
		expect(createManualTimeEntry).toHaveBeenCalledTimes(1);

		createResult.resolve({ success: true, data: {} });
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	it("cancels self manual timezone mismatch without submitting", async () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		const mismatchDialog = await screen.findByRole("dialog", {
			name: "Confirm Timezone for This Entry",
		});
		fireEvent.click(within(mismatchDialog).getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByText(/Your device timezone is/)).toBeNull();
		});
		expect(updateTimezone).not.toHaveBeenCalled();
		expect(createManualTimeEntry).not.toHaveBeenCalled();
	});

	it("does not show timezone mismatch or pass browser timezone for manager manual entries", async () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			targetEmployeeId: "employee-2",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => {
			expect(screen.queryByText(/Your device timezone is/)).toBeNull();
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					employeeId: "employee-2",
					timezone: "Europe/Berlin",
					browserTimezone: null,
				}),
			);
		});
	});

	it("submits browser timezone for self manual entries when it matches the employee timezone", async () => {
		getBrowserTimezone.mockReturnValue("Europe/Berlin");

		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Calendar adjustment" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => {
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					timezone: "Europe/Berlin",
					browserTimezone: "Europe/Berlin",
				}),
			);
		});
	});
});
