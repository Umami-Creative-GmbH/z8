/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualTimeEntryDialog } from "./manual-time-entry-dialog";

const {
	createManualTimeEntry,
	formatTimeInZone,
	refresh,
	toastInfo,
	updateTimezone,
} = vi.hoisted(() => ({
	createManualTimeEntry: vi.fn(),
	formatTimeInZone: vi.fn(() => "09:00"),
	refresh: vi.fn(),
	toastInfo: vi.fn(),
	updateTimezone: vi.fn(),
}));

const { getBrowserTimezone } = vi.hoisted(() => ({
	getBrowserTimezone: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(
				/\{(\w+)\}/g,
				(_, key: string) => params?.[key] ?? `{${key}}`,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));

vi.mock("@/lib/time-tracking/timezone-utils", () => ({
	formatTimeInZone,
	getTimezoneAbbreviation: (timezone: string) => timezone,
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), info: toastInfo, success: vi.fn() },
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

function renderDialog(
	props: Partial<Parameters<typeof ManualTimeEntryDialog>[0]> = {},
) {
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

function jsonRoundTrip<Value>(value: Value): Value {
	const serialized = JSON.stringify(value);
	return JSON.parse(serialized as string) as Value;
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

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
			join(
				process.cwd(),
				"src/components/time-tracking/manual-time-entry-dialog.tsx",
			),
			"utf8",
		);

		expect(source).toContain('className="flex min-h-0 flex-col"');
		expect(source).not.toContain('className="flex min-h-0 flex-1 flex-col"');
		expect(source).toContain('<ActionPanelFooter className="gap-2">');
		expect(source).not.toContain("sm:gap-0");
	});

	it("formats adjusted toast times with the saved time format preference", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/components/time-tracking/manual-time-entry-dialog.tsx",
			),
			"utf8",
		);

		expect(source).toContain("useTimeFormat");
		expect(source).toContain("formatTimeInZone");
		expect(source).toMatch(
			/formatTimeInZone\(\s*result\.data\.adjustedTimes\.clockIn,\s*timezone,\s*false,\s*timeFormat,\s*\)/,
		);
		expect(source).toMatch(
			/formatTimeInZone\(\s*result\.data\.adjustedTimes\.clockOut,\s*timezone,\s*false,\s*timeFormat,\s*\)/,
		);
	});

	it("renders no trigger button when controlled open with hideTrigger", () => {
		renderDialog({ open: true, hideTrigger: true });

		expect(
			screen.queryByRole("button", { name: "Add Manual Entry" }),
		).toBeNull();
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

		expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
			"2026-05-12",
		);
		expect((screen.getByLabelText("Clock In") as HTMLInputElement).value).toBe(
			"10:15",
		);
		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe(
			"15:45",
		);
	});

	it("defaults clock out to the current time in the employee timezone", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-12T23:37:00.000Z"));

		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "America/Los_Angeles",
		});

		expect((screen.getByLabelText("Clock In") as HTMLInputElement).value).toBe(
			"09:00",
		);
		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe(
			"16:37",
		);
	});

	it("derives the default date and time from one employee-local instant near midnight", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-13T06:59:59.999Z"));
		const zonedNow = vi.spyOn(Temporal.Now, "zonedDateTimeISO");

		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "America/Los_Angeles",
		});

		expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(
			"2026-05-12",
		);
		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe(
			"23:59",
		);
		expect(zonedNow).toHaveBeenCalledTimes(2);
		expect(zonedNow).toHaveBeenNthCalledWith(1, "America/Los_Angeles");
		expect(zonedNow).toHaveBeenNthCalledWith(2, "America/Los_Angeles");
	});

	it("prefers an explicit default clock out time over the current time", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-12T23:37:00.000Z"));

		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "America/Los_Angeles",
			defaultClockOutTime: "15:45",
		});

		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe(
			"15:45",
		);
	});

	it("recalculates the default clock out time when reopened", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-12T23:37:00.000Z"));
		const { rerender } = renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "America/Los_Angeles",
		});

		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe(
			"16:37",
		);

		rerender(
			<ManualTimeEntryDialog
				employeeId="employee-current"
				employeeTimezone="America/Los_Angeles"
				hasManager={false}
				hideTrigger
				open={false}
			/>,
		);
		vi.setSystemTime(new Date("2026-05-13T00:12:00.000Z"));
		rerender(
			<ManualTimeEntryDialog
				employeeId="employee-current"
				employeeTimezone="America/Los_Angeles"
				hasManager={false}
				hideTrigger
				open
			/>,
		);

		expect((screen.getByLabelText("Clock Out") as HTMLInputElement).value).toBe(
			"17:12",
		);
	});

	it("shows the target employee name in the title", () => {
		renderDialog({
			open: true,
			hideTrigger: true,
			targetEmployeeName: "Jane Doe",
		});

		expect(screen.getByText("Add Manual Time Entry for Jane Doe")).toBeTruthy();
	});

	it("submits the target employee id and entered form values", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue(submissionId);
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			targetEmployeeId: "employee-2",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		expect(
			screen
				.getByTestId("work-category-selector")
				.getAttribute("data-employee-id"),
		).toBe("employee-2");

		fireEvent.change(screen.getByLabelText("Date"), {
			target: { value: "2026-05-13" },
		});
		fireEvent.change(screen.getByLabelText("Clock In"), {
			target: { value: "11:00" },
		});
		fireEvent.change(screen.getByLabelText("Clock Out"), {
			target: { value: "16:30" },
		});
		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.change(screen.getByLabelText("Project"), {
			target: { value: "project-1" },
		});
		fireEvent.change(screen.getByLabelText("Work category"), {
			target: { value: "category-1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => {
			expect(createManualTimeEntry).toHaveBeenCalledWith({
				submissionId,
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
		expect(randomUUID).toHaveBeenCalledOnce();
		randomUUID.mockRestore();
	});

	it("scopes submission ids to deliberate manual submissions and preserves one serialized retry id", async () => {
		const firstSubmissionId = "10000000-0000-4000-8000-000000000099";
		const secondSubmissionId = "20000000-0000-4000-8000-000000000099";
		const transportSubmissionIds: string[] = [];
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstSubmissionId)
			.mockReturnValueOnce(secondSubmissionId);
		createManualTimeEntry
			.mockImplementationOnce(async (request) => {
				const serializedRetry = jsonRoundTrip(request);
				transportSubmissionIds.push(
					request.submissionId,
					serializedRetry.submissionId,
				);
				return { success: false, error: "connection reset" };
			})
			.mockImplementationOnce(async (request) => {
				transportSubmissionIds.push(request.submissionId);
				return { success: true, data: {} };
			});
		renderDialog({
			open: true,
			hideTrigger: true,
			targetEmployeeId: "employee-2",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});
		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));
		await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));
		await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledTimes(2));

		expect(transportSubmissionIds).toEqual([
			firstSubmissionId,
			firstSubmissionId,
			secondSubmissionId,
		]);
		expect(randomUUID).toHaveBeenCalledTimes(2);
		randomUUID.mockRestore();
	});

	it("shows timezone mismatch before submitting self manual entries and updates before continuing", async () => {
		const submissionId = "10000000-0000-4000-8000-000000000099";
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue(submissionId);
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		expect(
			await screen.findByText(
				"Your device timezone is America/New_York, but your saved timezone is Europe/Berlin.",
			),
		).toBeTruthy();
		expect(createManualTimeEntry).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole("button", { name: "Update timezone and continue" }),
		);

		await waitFor(() => {
			expect(updateTimezone).toHaveBeenCalledWith("America/New_York");
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					submissionId,
					date: "2026-05-12",
					clockInTime: "10:15",
					clockOutTime: "15:45",
					timezone: "America/New_York",
					browserTimezone: "America/New_York",
				}),
			);
		});
		expect(randomUUID).toHaveBeenCalledOnce();
		randomUUID.mockRestore();
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

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		fireEvent.click(
			await screen.findByRole("button", { name: "Continue once" }),
		);

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
		const createResult = deferredResult<{
			success: true;
			data: Record<string, never>;
		}>();
		createManualTimeEntry.mockReturnValue(createResult.promise);

		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		const continueButton = await screen.findByRole("button", {
			name: "Continue once",
		});
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(continueButton.hasAttribute("disabled")).toBe(true);
		});
		fireEvent.click(continueButton);
		expect(createManualTimeEntry).toHaveBeenCalledTimes(1);

		createResult.resolve({ success: true, data: {} });
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	it("re-enables mismatch actions when updating the saved timezone fails", async () => {
		updateTimezone.mockResolvedValue({
			success: false,
			error: "Timezone update failed",
		});
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		const updateButton = await screen.findByRole("button", {
			name: "Update timezone and continue",
		});
		fireEvent.click(updateButton);

		await waitFor(() => expect(updateTimezone).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(updateButton.hasAttribute("disabled")).toBe(false),
		);
		expect(
			screen
				.getByRole("button", { name: "Continue once" })
				.hasAttribute("disabled"),
		).toBe(false);
		expect(createManualTimeEntry).not.toHaveBeenCalled();
	});

	it("keeps the updated employee timezone after the following create fails", async () => {
		createManualTimeEntry.mockResolvedValue({
			success: false,
			error: "Create failed",
		});
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});
		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Update timezone and continue",
			}),
		);

		await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(screen.queryByText(/Your device timezone is/)).toBeNull(),
		);
		expect(
			screen.getByText("Times are in your local timezone (America/New_York)"),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));
		await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledTimes(2));
		expect(screen.queryByText(/Your device timezone is/)).toBeNull();
		expect(createManualTimeEntry).toHaveBeenLastCalledWith(
			expect.objectContaining({
				timezone: "America/New_York",
				browserTimezone: "America/New_York",
			}),
		);
	});

	it("formats continue-once adjusted times in the browser parsing zone", async () => {
		createManualTimeEntry.mockResolvedValue({
			success: true,
			data: {
				wasAdjusted: true,
				adjustedTimes: {
					clockIn: "2026-05-12T14:00:00.000Z",
					clockOut: "2026-05-12T22:00:00.000Z",
				},
			},
		});
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});
		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Continue once" }),
		);

		await waitFor(() => expect(toastInfo).toHaveBeenCalledOnce());
		expect(formatTimeInZone).toHaveBeenNthCalledWith(
			1,
			"2026-05-12T14:00:00.000Z",
			"America/New_York",
			false,
			"24h",
		);
		expect(formatTimeInZone).toHaveBeenNthCalledWith(
			2,
			"2026-05-12T22:00:00.000Z",
			"America/New_York",
			false,
			"24h",
		);
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

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		const mismatchDialog = await screen.findByRole("dialog", {
			name: "Confirm Timezone for This Entry",
		});
		fireEvent.click(
			within(mismatchDialog).getByRole("button", { name: "Cancel" }),
		);

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

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
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

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Calendar adjustment" },
		});
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
