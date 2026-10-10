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
let captureMode: "local-queue" | "local-review" | "server" = "server";
let connectionRequiredMock = false;
let activeWorkPeriodMock: {
	startTime: string;
	currentTask?: { id: string; name: string; state: "open" | "done"; projectId: string } | null;
} | null = null;
let billableTimeEnabledMock = false;
const defaultProjects = () => [
	{ id: "project-1", name: "Project One", tasks: [{ id: "task-1", name: "Design" }] },
	{ id: "project-2", name: "Project Two", tasks: [] },
];
let projectsMock: Array<Record<string, unknown>> = defaultProjects();

function getPopoverClockButton(name: "Clock In" | "Clock Out"): HTMLElement {
	const button = screen.getAllByRole("button", { name }).at(-1);
	if (!button) throw new Error(`${name} popover button not found`);
	return button;
}

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
		captureMode,
		connectionRequired: connectionRequiredMock,
	}),
}));

vi.mock("@/lib/query/use-assigned-projects", () => ({
	useAssignedProjects: () => ({
		projects: projectsMock,
		isLoading: false,
		isError: false,
	}),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback: string,
			values?: Record<string, string | number>,
		) => {
			if (!values) return fallback;
			return Object.entries(values).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useBillableTimeEnabled: () => billableTimeEnabledMock,
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en-US",
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => "Europe/Berlin",
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
	ProjectSelectorView: ({
		onValueChange,
	}: {
		onValueChange: (projectId: string | undefined) => void;
	}) => (
		<button type="button" onClick={() => onValueChange("project-2")}>
			Choose Project Two
		</button>
	),
}));

vi.mock("@/components/time-tracking/work-category-selector", () => ({
	WorkCategorySelector: () => null,
	WorkCategorySelectorView: () => null,
}));

vi.mock("@/components/time-tracking/use-available-work-categories", () => ({
	useAvailableWorkCategories: () => ({
		categories: [{ id: "category-1", name: "Category One" }],
		isLoading: false,
		isError: false,
	}),
}));

describe("TimeClockPopover", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		HTMLElement.prototype.scrollIntoView = vi.fn();
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
		captureMode = "server";
		connectionRequiredMock = false;
		activeWorkPeriodMock = null;
		billableTimeEnabledMock = false;
		projectsMock = defaultProjects();
		clockInMock.mockResolvedValue({ success: true });
		addBreakMock.mockResolvedValue({ success: true });
	});

	describe("offline in an organization that is not adopted (#845)", () => {
		const refused = {
			success: false,
			code: "connection_required",
			error: "Clocking needs a connection in this organization. Reconnect and try again.",
		};

		it("shows the needs-a-connection outcome inline, not as an error toast", async () => {
			clockInMock.mockResolvedValue(refused);
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
			fireEvent.click(getPopoverClockButton("Clock In"));
			await waitFor(() => expect(clockInMock).toHaveBeenCalledOnce());
			expect(toastMocks.error).not.toHaveBeenCalled();
			// The popover stays open so the inline message can be read.
			expect(getPopoverClockButton("Clock In")).toBeTruthy();
		});

		it("does not toast a refused clock-out either", async () => {
			isClockedInMock = true;
			activeWorkPeriodMock = { startTime: "2026-10-10T06:00:00Z" };
			clockOutMock.mockResolvedValue(refused);
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));
			fireEvent.click(getPopoverClockButton("Clock Out"));
			await waitFor(() => expect(clockOutMock).toHaveBeenCalledOnce());
			expect(toastMocks.error).not.toHaveBeenCalled();
		});

		it("renders the message inline while the last action needs a connection", () => {
			connectionRequiredMock = true;
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
			expect(screen.getByRole("alert").textContent).toBe(
				"Clocking needs a connection in this organization. Reconnect and try again.",
			);
		});
	});

	it("keeps both offline endpoints available without inventing a server period", async () => {
		captureMode = "local-review";
		clockInMock.mockResolvedValue({
			success: true,
			queued: true,
			reviewRequired: true,
		});
		clockOutMock.mockResolvedValue({
			success: true,
			queued: true,
			reviewRequired: true,
		});
		render(<TimeClockPopover />);
		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		fireEvent.click(screen.getByRole("radio", { name: "Remote" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Save clock-in for review" }),
		);
		await waitFor(() =>
			expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "remote" }),
		);
		await waitFor(() =>
			expect(toastMocks.info).toHaveBeenCalledWith(
				expect.stringContaining("not confirmed on the server"),
			),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Save clock-in for review" }),
			).toBeNull(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Save clock-out for review" }),
		);
		await waitFor(() => expect(clockOutMock).toHaveBeenCalledOnce());
		expect(toastMocks.success).not.toHaveBeenCalled();
	});

	it("submits office as the default quick clock-in work location", async () => {
		render(<TimeClockPopover />);

		const mobileTrigger = screen.getByRole("button", { name: "Clock In" });
		expect(mobileTrigger.getAttribute("aria-label")).toBe("Clock In");
		fireEvent.click(mobileTrigger);
		fireEvent.click(getPopoverClockButton("Clock In"));

		await waitFor(() =>
			expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "office" }),
		);
	});

	it("explains a clock-in held for time history review without server details", async () => {
		clockInMock.mockResolvedValue({
			success: false,
			code: "append_review_required",
			error: "Server-side review message",
		});
		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		fireEvent.click(getPopoverClockButton("Clock In"));

		await waitFor(() =>
			expect(toastMocks.error).toHaveBeenCalledWith(
				"Clock-in needs a review of your time history",
				{
					description:
						"Your earlier time entries could not be verified, so a new clock-in was not saved. Please contact your administrator.",
				},
			),
		);
		expect(toastMocks.success).not.toHaveBeenCalled();
	});

	it("submits remote when selected before quick clock-in", async () => {
		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: "Clock In" }));
		fireEvent.click(screen.getByRole("radio", { name: "Remote" }));
		fireEvent.click(getPopoverClockButton("Clock In"));

		await waitFor(() =>
			expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "remote" }),
		);
	});

	it("shows an icon-only quick break trigger next to the header clock-out button while clocked in", () => {
		isClockedInMock = true;
		activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };

		render(<TimeClockPopover />);

		expect(screen.getByRole("button", { name: /Clock Out/ })).toBeTruthy();
		const addBreakButton = screen.getByRole("button", { name: "Add break" });

		expect(addBreakButton.textContent).toBe("");
		expect(addBreakButton.className).toContain("bg-background");
		expect(addBreakButton.className).toContain("rounded-l-none");
		expect(addBreakButton.className).toContain("border-l-0");
	});

	it("adds a break from the header quick break trigger while clocked in", async () => {
		isClockedInMock = true;
		activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };

		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));
		fireEvent.change(screen.getByLabelText("Break duration in minutes"), {
			target: { value: "15" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		await waitFor(() =>
			expect(addBreakMock).toHaveBeenCalledWith({ breakMinutes: 15 }),
		);
	});

	it("does not show the header quick break trigger while clocked out", () => {
		isClockedInMock = false;

		render(<TimeClockPopover />);

		expect(screen.queryByRole("button", { name: "Add break" })).toBeNull();
	});

	it("submits valid stored project and work category defaults when clocking out", async () => {
		localStorageData = {
			"z8-last-project-id": "project-1",
			"z8-last-work-category-id": "category-1",
		};
		isClockedInMock = true;
		activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };
		clockOutMock.mockResolvedValue({ success: true, queued: true });

		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));
		fireEvent.click(getPopoverClockButton("Clock Out"));

		await waitFor(() =>
			expect(clockOutMock).toHaveBeenCalledWith({
				projectId: "project-1",
				workCategoryId: "category-1",
			}),
		);
	});
	describe("billable toggle (#900)", () => {
		function clockOutWithStoredProject(project: Record<string, unknown>) {
			localStorageData = { "z8-last-project-id": "project-1" };
			projectsMock = [{ id: "project-1", name: "Project One", tasks: [], ...project }];
			isClockedInMock = true;
			activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };
			clockOutMock.mockResolvedValue({ success: true, queued: true });
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));
		}

		it("prefills the project's billable default and sends an override", async () => {
			billableTimeEnabledMock = true;
			clockOutWithStoredProject({ hasCustomer: true, billableDefault: true });

			const toggle = await screen.findByRole("switch", { name: "Billable" });
			expect(toggle.getAttribute("aria-checked")).toBe("true");
			fireEvent.click(toggle);
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() =>
				expect(clockOutMock).toHaveBeenCalledWith({ projectId: "project-1", billable: false }),
			);
		});

		it("leaves the default to the server while the toggle is untouched", async () => {
			billableTimeEnabledMock = true;
			clockOutWithStoredProject({ hasCustomer: true, billableDefault: true });

			await screen.findByRole("switch", { name: "Billable" });
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() => expect(clockOutMock).toHaveBeenCalledWith({ projectId: "project-1" }));
		});

		it("disables the toggle for a project without a customer", async () => {
			billableTimeEnabledMock = true;
			clockOutWithStoredProject({ hasCustomer: false, billableDefault: false });

			const toggle = await screen.findByRole("switch", { name: "Billable" });
			expect(toggle.getAttribute("aria-disabled") ?? String(toggle.hasAttribute("disabled"))).toBe(
				"true",
			);
		});

		it("hides the toggle while Billable Time is off", async () => {
			clockOutWithStoredProject({ hasCustomer: true, billableDefault: true });

			await waitFor(() => expect(getPopoverClockButton("Clock Out")).toBeTruthy());
			expect(screen.queryByRole("switch", { name: "Billable" })).toBeNull();
		});
	});

	describe("task at clock-out", () => {
		beforeEach(() => {
			localStorageData = { "z8-last-project-id": "project-1" };
			isClockedInMock = true;
			activeWorkPeriodMock = { startTime: "2026-05-18T08:00:00.000Z" };
			clockOutMock.mockResolvedValue({ success: true, queued: true });
		});

		async function chooseTask(name: string) {
			fireEvent.click(await screen.findByRole("combobox", { name: "Task" }));
			fireEvent.click(await screen.findByRole("option", { name }));
		}

		it("books the chosen task of the chosen project", async () => {
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			await chooseTask("Design");
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() =>
				expect(clockOutMock).toHaveBeenCalledWith(
					expect.objectContaining({ projectId: "project-1", taskId: "task-1" }),
				),
			);
		});

		it("clears the chosen task when the project changes", async () => {
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			await chooseTask("Design");
			fireEvent.click(screen.getByRole("button", { name: "Choose Project Two" }));
			expect(screen.queryByRole("combobox", { name: "Task" })).toBeNull();
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() => expect(clockOutMock).toHaveBeenCalledOnce());
			expect(clockOutMock.mock.calls[0]?.[0]).toEqual({ projectId: "project-2" });
		});

		it("books the chosen task with a clock-out queued as a frozen command", async () => {
			captureMode = "local-queue";
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			await chooseTask("Design");
			fireEvent.click(screen.getByRole("button", { name: "Save clock-out" }));

			await waitFor(() =>
				expect(clockOutMock).toHaveBeenCalledWith(
					expect.objectContaining({ projectId: "project-1", taskId: "task-1" }),
				),
			);
		});

		it("shows the running work's task and keeps it by naming none", async () => {
			activeWorkPeriodMock = {
				startTime: "2026-05-18T08:00:00.000Z",
				currentTask: { id: "task-0", name: "Kickoff", state: "done", projectId: "project-1" },
			};
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			const task = await screen.findByRole("combobox", { name: "Task" });
			expect(task.textContent).toContain("Kickoff");
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() => expect(clockOutMock).toHaveBeenCalledOnce());
			expect(clockOutMock.mock.calls[0]?.[0]).toEqual({ projectId: "project-1" });
		});

		it("clears the running work's task when no task is chosen", async () => {
			activeWorkPeriodMock = {
				startTime: "2026-05-18T08:00:00.000Z",
				currentTask: { id: "task-1", name: "Design", state: "open", projectId: "project-1" },
			};
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			await chooseTask("No task");
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() =>
				expect(clockOutMock).toHaveBeenCalledWith(
					expect.objectContaining({ projectId: "project-1", taskId: null }),
				),
			);
		});

		it("words a refused task's stable reason", async () => {
			clockOutMock.mockResolvedValue({
				success: false,
				error: "Cannot book time to this task",
				code: "task_done",
			});
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			await chooseTask("Design");
			fireEvent.click(getPopoverClockButton("Clock Out"));

			await waitFor(() =>
				expect(toastMocks.error).toHaveBeenCalledWith(
					"This task is done, so no time can be booked to it",
					{ description: undefined },
				),
			);
		});

		it("offers no task while the clock-out is only saved for review", async () => {
			captureMode = "local-review";
			render(<TimeClockPopover />);
			fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));

			expect(screen.queryByRole("combobox", { name: "Task" })).toBeNull();
		});
	});
});
