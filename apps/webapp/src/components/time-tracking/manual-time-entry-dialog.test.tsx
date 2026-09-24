/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualEntryTargetContext } from "@/app/[locale]/(app)/time-tracking/actions/types";
import { queryKeys } from "@/lib/query/keys";
import { ManualTimeEntryDialog } from "./manual-time-entry-dialog";

const {
	createManualTimeEntry,
	formatTimeInZone,
	refresh,
	toastInfo,
	updateTimezone,
	useTimeFormat,
} = vi.hoisted(() => ({
	createManualTimeEntry: vi.fn(),
	formatTimeInZone: vi.fn(() => "09:00"),
	refresh: vi.fn(),
	toastInfo: vi.fn(),
	updateTimezone: vi.fn(),
	useTimeFormat: vi.fn(() => "24h"),
}));

const { getBrowserTimezone } = vi.hoisted(() => ({
	getBrowserTimezone: vi.fn(),
}));

const targetContextState = vi.hoisted(() => ({
	current: null as ManualEntryTargetContext | null,
	getManualEntryTargetContext: vi.fn(),
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
	useTimeFormat,
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

vi.mock("@/components/time-tracking/project-selector", () => ({
	ProjectSelectorView: ({
		isError,
		onValueChange,
		persistPreference,
		projects,
		value,
	}: {
		isError: boolean;
		onValueChange: (value: string | undefined) => void;
		persistPreference?: boolean;
		projects: { id: string; name: string }[];
		value?: string;
	}) =>
		isError ? null : (
			<select
				aria-label="Project"
				data-persist-preference={String(persistPreference)}
				onChange={(event) => onValueChange(event.target.value || undefined)}
				value={value ?? ""}
			>
				<option value="">No project</option>
				{projects.map((project) => (
					<option key={project.id} value={project.id}>
						{project.name}
					</option>
				))}
			</select>
		),
}));

vi.mock("@/components/time-tracking/work-category-selector", () => ({
	WorkCategorySelectorView: ({
		categories,
		employeeId,
		isError,
		onValueChange,
		persistPreference,
		value,
	}: {
		categories: { id: string; name: string }[];
		employeeId: string;
		isError: boolean;
		onValueChange: (value: string | undefined) => void;
		persistPreference?: boolean;
		value?: string;
	}) =>
		isError ? null : (
			<div data-employee-id={employeeId} data-testid="work-category-selector">
				<select
					aria-label="Work category"
					data-persist-preference={String(persistPreference)}
					onChange={(event) => onValueChange(event.target.value || undefined)}
					value={value ?? ""}
				>
					<option value="">No category</option>
					{categories.map((category) => (
						<option key={category.id} value={category.id}>
							{category.name}
						</option>
					))}
				</select>
			</div>
		),
}));

vi.mock(
	"@/app/[locale]/(app)/time-tracking/actions/manual-entry-context",
	() => ({
		getManualEntryTargetContext: targetContextState.getManualEntryTargetContext,
	}),
);

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	createManualTimeEntry,
}));

vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone,
}));

function buildTargetContext(
	targetEmployeeId: string | undefined,
	overrides: Partial<ManualEntryTargetContext> = {},
): ManualEntryTargetContext {
	return {
		targetEmployeeId: targetEmployeeId ?? "employee-current",
		targetName: "",
		isOwnEntry: !targetEmployeeId,
		timezone: "UTC",
		timezoneSource: "employee",
		projects: [
			{
				id: "project-1",
				name: "Project 1",
				color: null,
				status: "active",
				budgetHours: null,
				deadline: null,
				totalHoursBooked: 0,
			},
		],
		categories: [
			{ id: "category-1", name: "Category 1", factor: "1.00", color: null },
		],
		...overrides,
	};
}

/**
 * Renders the dialog with the target context already loaded, as the server
 * would return it for the target. The context zone follows `employeeTimezone`
 * unless overridden.
 */
function renderDialog(
	props: Partial<Parameters<typeof ManualTimeEntryDialog>[0]> = {},
	contextOverrides: Partial<ManualEntryTargetContext> | null = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	targetContextState.current =
		contextOverrides === null
			? null
			: buildTargetContext(props.targetEmployeeId, {
					timezone: props.employeeTimezone ?? "UTC",
					...contextOverrides,
				});
	if (targetContextState.current) {
		queryClient.setQueryData(
			queryKeys.manualEntry.targetContext(props.targetEmployeeId ?? null),
			targetContextState.current,
		);
	}
	const view = render(
		<ManualTimeEntryDialog
			employeeId="employee-current"
			employeeTimezone="UTC"
			hasManager={false}
			{...props}
		/>,
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		},
	);
	return { ...view, queryClient };
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
		useTimeFormat.mockReturnValue("24h");
		targetContextState.getManualEntryTargetContext.mockReset();
		targetContextState.getManualEntryTargetContext.mockImplementation(
			async () =>
				targetContextState.current
					? { success: true, data: targetContextState.current }
					: { success: false, error: "Failed to load entry options" },
		);
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
		act(() => vi.runOnlyPendingTimers());

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
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			targetEmployeeId: "employee-2",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue(submissionId);

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

	it.each(["Clock In", "Clock Out"])(
		"blocks keyboard-truncated %s and submits only after it is completed",
		async (label) => {
			const user = userEvent.setup();
			renderDialog({
				open: true,
				hideTrigger: true,
				targetEmployeeId: "employee-2",
				defaultDate: "2026-05-12",
				defaultClockInTime: "10:15",
				defaultClockOutTime: "15:45",
			});
			await user.type(screen.getByLabelText("Reason"), "Correcting my time");
			const input = screen.getByLabelText<HTMLInputElement>(label);
			await user.click(input);
			await user.keyboard("{End}{Backspace}");
			expect(input.value).toBe(label === "Clock In" ? "10:1" : "15:4");
			await user.click(screen.getByRole("button", { name: "Create Entry" }));
			expect(createManualTimeEntry).not.toHaveBeenCalled();
			const message = await screen.findByText("Enter a complete, valid time");
			expect(input.getAttribute("aria-invalid")).toBe("true");
			expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(
				message.id,
			);

			await user.click(input);
			await user.keyboard("{End}5");
			await user.click(screen.getByRole("button", { name: "Create Entry" }));
			await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledOnce());
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					clockInTime: "10:15",
					clockOutTime: "15:45",
				}),
			);
		},
	);

	it.each(["25:00", "15:60", "15:", ""])(
		"rejects visible %s even when submitting the form directly",
		async (draft) => {
			renderDialog({
				open: true,
				hideTrigger: true,
				targetEmployeeId: "employee-2",
				defaultDate: "2026-05-12",
				defaultClockInTime: "10:15",
				defaultClockOutTime: "15:45",
			});
			fireEvent.change(screen.getByLabelText("Reason"), {
				target: { value: "Correction" },
			});
			const input = screen.getByLabelText<HTMLInputElement>("Clock Out");
			fireEvent.change(input, { target: { value: draft } });
			if (!input.form)
				throw new Error("Time input must belong to the manual form");
			fireEvent.submit(input.form);
			await screen.findByText("Enter a complete, valid time");
			expect(createManualTimeEntry).not.toHaveBeenCalled();
			expect(input.value).toBe(draft);
		},
	);

	it.each([
		{ format: "24h", digits: "1630", display: "16:30" },
		{ format: "12h", digits: "0430", display: "04:30" },
	])(
		"submits completed masked digits with Enter in $format mode",
		async ({ format, digits, display }) => {
			useTimeFormat.mockReturnValue(format);
			const user = userEvent.setup();
			renderDialog({
				open: true,
				hideTrigger: true,
				targetEmployeeId: "employee-2",
				defaultDate: "2026-05-12",
				defaultClockInTime: "10:15",
				defaultClockOutTime: "15:45",
			});
			await user.type(screen.getByLabelText("Reason"), "Correcting my time");
			const input = screen.getByLabelText<HTMLInputElement>("Clock Out");
			await user.clear(input);
			await user.type(input, digits.slice(0, 3));
			await user.keyboard("{Enter}");
			expect(createManualTimeEntry).not.toHaveBeenCalled();
			expect(input.getAttribute("aria-invalid")).toBe("true");
			await user.type(input, digits.slice(3));
			expect(input.value).toBe(display);
			expect(input.getAttribute("aria-invalid")).toBe("false");
			expect(screen.queryByText("Enter a complete, valid time")).toBeNull();
			await user.keyboard("{Enter}");
			await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledOnce());
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					clockInTime: "10:15",
					clockOutTime: "16:30",
				}),
			);
		},
	);

	it("scopes submission ids to deliberate manual submissions and preserves one serialized retry id", async () => {
		const firstSubmissionId = "10000000-0000-4000-8000-000000000099";
		const secondSubmissionId = "20000000-0000-4000-8000-000000000099";
		const transportSubmissionIds: string[] = [];
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
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstSubmissionId)
			.mockReturnValueOnce(secondSubmissionId);
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
		renderDialog({
			open: true,
			hideTrigger: true,
			employeeTimezone: "Europe/Berlin",
			defaultDate: "2026-05-12",
			defaultClockInTime: "10:15",
			defaultClockOutTime: "15:45",
		});
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue(submissionId);

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

describe("ManualTimeEntryDialog target context", () => {
	beforeEach(() => {
		createManualTimeEntry.mockReset();
		createManualTimeEntry.mockResolvedValue({ success: true, data: {} });
		getBrowserTimezone.mockReset();
		getBrowserTimezone.mockReturnValue("Asia/Tokyo");
		refresh.mockReset();
		useTimeFormat.mockReturnValue("24h");
		targetContextState.getManualEntryTargetContext.mockReset();
		targetContextState.getManualEntryTargetContext.mockImplementation(
			async () =>
				targetContextState.current
					? { success: true, data: targetContextState.current }
					: { success: false, error: "Failed to load entry options" },
		);
	});

	it("shows the target's effective zone and its organization fallback, not the actor's browser zone", async () => {
		renderDialog(
			{
				open: true,
				hideTrigger: true,
				employeeTimezone: "UTC",
				targetEmployeeId: "employee-2",
				targetEmployeeName: "Jane Doe",
				defaultDate: "2026-05-12",
				defaultClockInTime: "10:15",
				defaultClockOutTime: "15:45",
			},
			{ timezone: "America/New_York", timezoneSource: "organization" },
		);

		expect(
			screen.getByText(
				"Times are in Jane Doe's timezone: America/New_York (America/New_York)",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Jane Doe has no personal timezone, so the organization's timezone is used.",
			),
		).toBeTruthy();
		expect(targetContextState.getManualEntryTargetContext).toHaveBeenCalledWith(
			{
				targetEmployeeId: "employee-2",
			},
		);

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Entered for Jane" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => {
			expect(createManualTimeEntry).toHaveBeenCalledWith(
				expect.objectContaining({
					employeeId: "employee-2",
					timezone: "America/New_York",
					browserTimezone: null,
				}),
			);
		});
		expect(screen.queryByText(/Your device timezone is/)).toBeNull();
	});

	it("names the target from the context when the caller does not know it", () => {
		renderDialog(
			{ open: true, hideTrigger: true, targetEmployeeId: "employee-2" },
			{ targetName: "Bertha Sipes", timezone: "Europe/Berlin" },
		);

		expect(
			screen.getByText("Add Manual Time Entry for Bertha Sipes"),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Times are in Bertha Sipes's timezone: Europe/Berlin (Europe/Berlin)",
			),
		).toBeTruthy();
	});

	it("offers the target's own choices without touching the actor's saved preferences", () => {
		renderDialog(
			{ open: true, hideTrigger: true, targetEmployeeId: "employee-2" },
			{
				projects: [
					{
						id: "project-target",
						name: "Target Project",
						color: null,
						status: "active",
						budgetHours: null,
						deadline: null,
						totalHoursBooked: 0,
					},
				],
				categories: [
					{
						id: "category-target",
						name: "Target Category",
						factor: "1.50",
						color: null,
					},
				],
			},
		);

		const project = screen.getByLabelText("Project");
		const category = screen.getByLabelText("Work category");
		expect(
			within(project).getByRole("option", { name: "Target Project" }),
		).toBeTruthy();
		expect(
			within(project).queryByRole("option", { name: "Project 1" }),
		).toBeNull();
		expect(
			within(category).getByRole("option", { name: "Target Category" }),
		).toBeTruthy();
		expect(project.getAttribute("data-persist-preference")).toBe("false");
		expect(category.getAttribute("data-persist-preference")).toBe("false");
	});

	it("keeps preference persistence for self entries", () => {
		renderDialog({ open: true, hideTrigger: true });

		expect(
			screen.getByLabelText("Project").getAttribute("data-persist-preference"),
		).toBe("true");
	});

	it("blocks creation and explains when the actor may not create for the target", async () => {
		targetContextState.getManualEntryTargetContext.mockResolvedValue({
			success: false,
			error: "Not authorized to create time entries for this employee",
			code: "target_not_authorized",
		});
		renderDialog(
			{ open: true, hideTrigger: true, targetEmployeeId: "employee-foreign" },
			null,
		);

		expect(
			await screen.findByText(
				"You can't create time entries for this employee.",
			),
		).toBeTruthy();
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Create Entry" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(screen.queryByLabelText("Project")).toBeNull();

		fireEvent.submit(
			screen
				.getByRole("button", { name: "Create Entry" })
				.closest("form") as HTMLFormElement,
		);
		await act(async () => {});
		expect(createManualTimeEntry).not.toHaveBeenCalled();
	});

	it("offers a retry when the context fails to load for other reasons", async () => {
		renderDialog(
			{ open: true, hideTrigger: true, targetEmployeeId: "employee-2" },
			null,
		);

		expect(
			await screen.findByText(
				"Couldn't load the timezone and choices for this entry.",
			),
		).toBeTruthy();
		targetContextState.current = buildTargetContext("employee-2", {
			timezone: "Europe/Berlin",
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		expect(
			await screen.findByText(
				"Times are in this employee's timezone: Europe/Berlin (Europe/Berlin)",
			),
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Create Entry" })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("clears draft choices and announces it when the target changes", async () => {
		const { queryClient, rerender } = renderDialog({
			open: true,
			hideTrigger: true,
			targetEmployeeId: "employee-2",
		});
		fireEvent.change(screen.getByLabelText("Project"), {
			target: { value: "project-1" },
		});
		fireEvent.change(screen.getByLabelText("Work category"), {
			target: { value: "category-1" },
		});
		expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe(
			"project-1",
		);

		targetContextState.current = buildTargetContext("employee-3");
		queryClient.setQueryData(
			queryKeys.manualEntry.targetContext("employee-3"),
			targetContextState.current,
		);
		rerender(
			<ManualTimeEntryDialog
				employeeId="employee-current"
				employeeTimezone="UTC"
				hasManager={false}
				hideTrigger
				open
				targetEmployeeId="employee-3"
			/>,
		);

		expect(
			await screen.findByText(
				"The employee changed, so the project and category were cleared.",
			),
		).toBeTruthy();
		expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe(
			"",
		);
		expect(
			(screen.getByLabelText("Work category") as HTMLSelectElement).value,
		).toBe("");
		expect(
			screen
				.getByTestId("work-category-selector")
				.getAttribute("data-employee-id"),
		).toBe("employee-3");
	});

	it("drops a selection that is no longer eligible when the context refreshes", async () => {
		const { queryClient } = renderDialog({
			open: true,
			hideTrigger: true,
			targetEmployeeId: "employee-2",
		});
		fireEvent.change(screen.getByLabelText("Project"), {
			target: { value: "project-1" },
		});

		// The project stops being eligible on the server; the refreshed context drops it.
		targetContextState.current = buildTargetContext("employee-2", {
			projects: [],
		});
		await act(async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.manualEntry.all,
			});
		});

		expect(
			await screen.findByText(
				"A selected project or category is no longer available and was cleared.",
			),
		).toBeTruthy();
		expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe(
			"",
		);
	});

	it("refreshes the target context after the server rejects a submission", async () => {
		createManualTimeEntry.mockResolvedValue({
			success: false,
			error: "Cannot assign to this project",
		});
		renderDialog({
			open: true,
			hideTrigger: true,
			targetEmployeeId: "employee-2",
			defaultDate: "2026-05-12",
		});
		const callsBeforeSubmit =
			targetContextState.getManualEntryTargetContext.mock.calls.length;

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Entered for a report" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(
				targetContextState.getManualEntryTargetContext.mock.calls.length,
			).toBeGreaterThan(callsBeforeSubmit),
		);
	});
});
