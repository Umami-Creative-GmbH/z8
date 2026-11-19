/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbsenceChangeSummary } from "@/lib/absences/change-request-types";
import type { AbsenceWithDays } from "@/lib/absences/types";
import { AbsenceYearCalendar } from "./absence-year-calendar";
import { AbsencesViewContainer } from "./absences-view-container";

const mockGetAbsenceCalendarYearData = vi.hoisted(() => vi.fn());
const mockCancelAbsenceRequest = vi.hoisted(() => vi.fn());
const ownChanges = vi.hoisted(() => ({
	current: {
		data: undefined as AbsenceChangeSummary[] | undefined,
		isError: false,
		isSuccess: true,
		refetch: vi.fn(),
	},
}));
const sickNotes = vi.hoisted(() => ({
	canAttach: false,
	markers: {} as Record<string, { count: number; viewable: boolean }>,
	refresh: async () => undefined,
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	getAbsenceCalendarYearData: mockGetAbsenceCalendarYearData,
	cancelAbsenceRequest: mockCancelAbsenceRequest,
}));

vi.mock("./sick-notes/use-own-absence-sick-notes", () => ({
	useOwnAbsenceSickNotes: () => sickNotes,
}));
vi.mock("./sick-notes/absence-sick-notes-panel", () => ({
	AbsenceSickNotesPanel: ({ absence }: { absence: { id: string } }) => (
		<div>{`sick notes of ${absence.id}`}</div>
	),
}));
vi.mock("./sick-notes/attach-sick-note-dialog", () => ({
	AttachSickNoteDialog: ({ absence }: { absence: { id: string } }) => (
		<div>{`attaching to ${absence.id}`}</div>
	),
}));
vi.mock("./change-deputy-dialog", () => ({
	ChangeDeputyDialog: ({ absence }: { absence: { id: string } }) => (
		<div>{`changing the deputy of ${absence.id}`}</div>
	),
}));
vi.mock("./absence-change-dialog", () => ({
	AbsenceChangeDialog: ({
		absence,
		kind,
	}: {
		absence: { id: string };
		kind: string;
	}) => <div>{`requesting ${kind} of ${absence.id}`}</div>,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback?: string,
			params?: Record<string, unknown>,
		) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) =>
				String(params?.[name] ?? `{${name}}`),
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("./use-own-absence-changes", () => ({
	useOwnAbsenceChanges: () => ownChanges.current,
}));

vi.mock("@/app/[locale]/(app)/absences/change-actions", () => ({
	withdrawAbsenceChangeAction: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/query/period-submission-readiness", () => ({
	useInvalidatePeriodSubmissionReadiness: () => vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

vi.mock("./absence-entries-table", () => ({
	AbsenceEntriesTable: ({
		absences,
		currentDate,
	}: {
		absences: Array<{ id: string }>;
		currentDate: string;
	}) => (
		<div data-current-date={currentDate} data-absence-count={absences.length}>
			Absence entries
		</div>
	),
}));

vi.mock("./request-absence-dialog", () => ({
	RequestAbsenceDialog: ({
		open,
		initialDate,
		onSuccess,
	}: {
		open?: boolean;
		initialDate?: string;
		onSuccess?: () => void;
	}) => (
		<div
			data-testid="request-absence-dialog"
			data-open={open ? "true" : "false"}
			data-initial-date={initialDate ?? ""}
		>
			<button type="button" onClick={onSuccess}>
				Simulate request success
			</button>
		</div>
	),
}));

const categories: ComponentProps<typeof AbsencesViewContainer>["categories"] = [
	{
		id: "vacation",
		name: "Vacation",
		type: "vacation",
		color: null,
		requiresApproval: true,
		countsAgainstVacation: true,
	},
];

const baseProps = {
	absences: [],
	holidays: [],
	categories,
	year: 2026,
	currentDate: "2026-05-20",
	organizationId: "org-1",
};

/** One calendar day button, by its YYYY-MM-DD date. */
function getCalendarDay(date: string) {
	const day = document.querySelector<HTMLButtonElement>(
		`button[data-date="${date}"]`,
	);
	if (!day) throw new Error(`Calendar day ${date} is missing`);
	return day;
}

/** Holidays are stored at UTC midnight of their calendar day. */
function holiday(id: string, name: string, date: string) {
	const day = new Date(`${date}T00:00:00.000Z`);
	return { id, name, startDate: day, endDate: day, categoryId: "public" };
}

function absence(overrides: Partial<AbsenceWithDays> = {}): AbsenceWithDays {
	return {
		id: "absence-1",
		employeeId: "employee-1",
		startDate: "2026-05-20",
		startPeriod: "full_day",
		endDate: "2026-05-20",
		endPeriod: "full_day",
		status: "pending",
		notes: null,
		sickDetail: null,
		category: {
			id: "category-vacation",
			name: "Vacation",
			color: null,
			type: "vacation",
			countsAgainstVacation: true,
		},
		approvedBy: null,
		approvedAt: null,
		rejectionReason: null,
		createdAt: new Date("2026-05-01T00:00:00Z"),
		absenceDays: 1,
		...overrides,
	};
}

function requestDialog() {
	return screen.getByTestId("request-absence-dialog");
}

// The view keeps its view and year in the URL; a tab click in one test must not leak into the next.
beforeEach(() => {
	window.history.replaceState(null, "", "/");
});

describe("absence day popover (#1863)", () => {
	beforeEach(() => {
		mockGetAbsenceCalendarYearData.mockReset();
		mockCancelAbsenceRequest.mockReset();
		ownChanges.current = {
			data: [],
			isError: false,
			isSuccess: true,
			refetch: vi.fn(),
		};
	});
	afterEach(() => {
		sickNotes.canAttach = false;
		sickNotes.markers = {};
	});

	it("shows an approved absence day's details instead of starting a new request", async () => {
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[
					absence({
						status: "approved",
						startDate: "2026-07-13",
						endDate: "2026-07-14",
						endPeriod: "am",
						deputy: { id: "employee-2", name: "Ben Example" },
					}),
				]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-07-14"));

		const popover = await screen.findByRole("dialog", {
			name: "Tuesday, July 14, 2026",
		});
		expect(requestDialog().dataset.open).toBe("false");
		expect(within(popover).getByText("Vacation")).toBeTruthy();
		expect(within(popover).getByText("Approved")).toBeTruthy();
		expect(within(popover).getByText("Morning")).toBeTruthy();
		expect(within(popover).getByText("Ben Example")).toBeTruthy();
	});

	it("offers each absence on the day the actions of its table row", async () => {
		ownChanges.current.data = [
			changeRequest({ absenceId: "approved", kind: "change" }),
		];
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[
					absence({ id: "approved", status: "approved", startDate: "2026-07-14", endDate: "2026-07-14" }),
					absence({ id: "pending", status: "pending", startDate: "2026-07-14", endDate: "2026-07-14" }),
				]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-07-14"));
		const popover = await screen.findByRole("dialog", {
			name: "Tuesday, July 14, 2026",
		});

		// The approved absence has a change request pending, so its change actions wait.
		expect(within(popover).getByText("Change request pending")).toBeTruthy();
		const requestChange = within(popover).getByRole("button", {
			name: "Request change",
		}) as HTMLButtonElement;
		expect(requestChange.disabled).toBe(true);
		// Only the pending request can be withdrawn directly; both still change their deputy.
		expect(
			within(popover).getAllByRole("button", { name: "Cancel absence" }),
		).toHaveLength(1);
		expect(
			within(popover).getAllByRole("button", { name: "Change deputy" }),
		).toHaveLength(2);
	});

	it("offers sick leave its sick-note actions and lists the day's holidays", async () => {
		sickNotes.canAttach = true;
		sickNotes.markers = { sick: { count: 1, viewable: true } };
		const sickCategory = {
			id: "category-sick",
			name: "Sick Leave",
			type: "sick",
			color: null,
			countsAgainstVacation: false,
		};
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[
					// Ended before today: no deputy change any more, but notes still go on.
					absence({ id: "sick", status: "approved", category: sickCategory, startDate: "2026-05-04", endDate: "2026-05-04" }),
				]}
				holidays={[holiday("h", "Labour Day", "2026-05-04")]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-05-04"));
		const popover = await screen.findByRole("dialog", {
			name: "Monday, May 4, 2026",
		});

		expect(within(popover).getByText("Labour Day")).toBeTruthy();
		expect(within(popover).queryByRole("button", { name: "Change deputy" })).toBeNull();
		fireEvent.click(
			within(popover).getByRole("button", { name: "Sick note attached (1)" }),
		);
		expect(screen.getByText("sick notes of sick")).toBeTruthy();

		fireEvent.click(getCalendarDay("2026-05-04"));
		fireEvent.click(
			within(
				await screen.findByRole("dialog", { name: "Monday, May 4, 2026" }),
			).getByRole("button", { name: "Attach sick note" }),
		);
		expect(screen.getByText("attaching to sick")).toBeTruthy();
	});

	it("closes the popover and opens the action's dialog", async () => {
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[absence({ status: "approved", startDate: "2026-07-14", endDate: "2026-07-14" })]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-07-14"));
		const popover = await screen.findByRole("dialog", {
			name: "Tuesday, July 14, 2026",
		});
		fireEvent.click(
			within(popover).getByRole("button", { name: "Request cancellation" }),
		);

		expect(screen.getByText("requesting cancel of absence-1")).toBeTruthy();
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Tuesday, July 14, 2026" }),
			).toBeNull(),
		);
	});

	it("moves focus into the popover and back to the day on Escape", async () => {
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[absence({ status: "approved", startDate: "2026-07-14", endDate: "2026-07-14" })]}
			/>,
		);
		const day = getCalendarDay("2026-07-14");
		day.focus();

		fireEvent.click(day);
		const popover = await screen.findByRole("dialog", {
			name: "Tuesday, July 14, 2026",
		});
		await waitFor(() =>
			expect(popover.contains(document.activeElement)).toBe(true),
		);

		fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(day));
	});

	it("starts another request from an absence day", async () => {
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[absence({ status: "pending", startDate: "2026-07-14", endDate: "2026-07-14", endPeriod: "am" })]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-07-14"));
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Request another absence from this day",
			}),
		);

		expect(requestDialog().dataset.open).toBe("true");
		expect(requestDialog().dataset.initialDate).toBe("2026-07-14");
	});

	it("starts a request from a holiday-only day and a day whose absences were all rejected", () => {
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[absence({ status: "rejected", startDate: "2026-07-14", endDate: "2026-07-14" })]}
				holidays={[holiday("h", "Founders Day", "2026-07-15")]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-07-14"));
		expect(requestDialog().dataset.open).toBe("true");
		expect(requestDialog().dataset.initialDate).toBe("2026-07-14");
		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(getCalendarDay("2026-07-15"));
		expect(requestDialog().dataset.initialDate).toBe("2026-07-15");
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("reloads the calendar after cancelling a pending request from the popover", async () => {
		mockCancelAbsenceRequest.mockResolvedValue({ success: true });
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [],
			holidays: [],
		});
		render(
			<AbsencesViewContainer
				{...baseProps}
				absences={[absence({ status: "pending", startDate: "2026-07-14", endDate: "2026-07-14" })]}
			/>,
		);

		fireEvent.click(getCalendarDay("2026-07-14"));
		const popover = await screen.findByRole("dialog", {
			name: "Tuesday, July 14, 2026",
		});
		fireEvent.click(
			within(popover).getByRole("button", { name: "Cancel absence" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Yes, cancel absence" }),
		);

		await waitFor(() =>
			expect(mockCancelAbsenceRequest).toHaveBeenCalledWith("absence-1"),
		);
		await waitFor(() =>
			expect(getCalendarDay("2026-07-14").dataset.state).toBe("none"),
		);
	});
});

function changeRequest(
	overrides: Partial<AbsenceChangeSummary> = {},
): AbsenceChangeSummary {
	return {
		id: "change-1",
		absenceId: "absence-1",
		kind: "cancel",
		status: "pending",
		original: {
			startDate: "2026-10-05",
			endDate: "2026-10-09",
			startPeriod: "full_day",
			endPeriod: "full_day",
			categoryId: "vacation",
			canonicalRecordId: null,
			canonical: null,
			updatedAt: "2026-10-01T00:00:00Z",
		},
		proposed: null,
		reason: "Trip was cancelled",
		decisionReason: null,
		createdAt: "2026-10-02T00:00:00Z",
		decidedAt: null,
		deciderName: null,
		...overrides,
	};
}

describe("AbsencesViewContainer", () => {
	beforeEach(() => {
		mockGetAbsenceCalendarYearData.mockReset();
		ownChanges.current = {
			data: [],
			isError: false,
			isSuccess: true,
			refetch: vi.fn(),
		};
	});

	it("shows pending change requests above the views while the calendar is selected", () => {
		ownChanges.current.data = [changeRequest()];
		render(<AbsencesViewContainer {...baseProps} />);

		expect(
			screen.getByRole("tab", { name: "Calendar" }).getAttribute("aria-selected"),
		).toBe("true");
		const withdraw = screen.getByRole("button", { name: "Withdraw request" });
		expect(withdraw.closest('[role="tabpanel"]')).toBeNull();
		expect(withdraw.closest("details")?.open).toBe(true);
		expect(screen.getByText("1 pending")).toBeTruthy();
	});

	it("keeps one change-request section above the toolbar in the table view", () => {
		ownChanges.current.data = [changeRequest({ status: "rejected" })];
		render(<AbsencesViewContainer {...baseProps} />);

		fireEvent.click(screen.getByRole("tab", { name: "Table" }));

		expect(screen.getByText("Absence entries")).toBeTruthy();
		const sections = screen.getAllByText("Absence change requests");
		expect(sections).toHaveLength(1);
		expect(sections[0]?.closest('[role="tabpanel"]')).toBeNull();
		// Nothing is pending, so the section stays collapsed.
		expect(sections[0]?.closest("details")?.open).toBe(false);
	});

	it("reports a failed change-request load with a retry in the calendar view", () => {
		ownChanges.current = {
			data: undefined,
			isError: true,
			isSuccess: false,
			refetch: vi.fn(),
		};
		render(<AbsencesViewContainer {...baseProps} />);

		const alert = screen.getByText("Could not load change requests.", {
			exact: false,
		});
		expect(alert.closest('[role="tabpanel"]')).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(ownChanges.current.refetch).toHaveBeenCalledOnce();
	});

	it("keeps a newer server snapshot when an older current-year refresh finishes", async () => {
		let finish: (value: { absences: []; holidays: [] }) => void = () => {};
		mockGetAbsenceCalendarYearData.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { rerender } = render(<AbsencesViewContainer {...baseProps} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Simulate request success" }),
		);
		rerender(
			<AbsencesViewContainer
				{...baseProps}
				holidays={[holiday("new", "New holiday", "2026-05-21")]}
			/>,
		);
		await act(async () => {
			finish({ absences: [], holidays: [] });
		});
		expect(getCalendarDay("2026-05-21").dataset.state).toBe("holiday");
	});

	it("retains the last loaded year when another year's read fails and offers retry", async () => {
		mockGetAbsenceCalendarYearData.mockRejectedValueOnce(
			new Error("Unavailable"),
		);
		render(<AbsencesViewContainer {...baseProps} />);
		fireEvent.click(screen.getByRole("button", { name: "Next year" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "2026", level: 2 }),
		).toBeTruthy();
		mockGetAbsenceCalendarYearData.mockResolvedValueOnce({
			absences: [],
			holidays: [],
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: "2027", level: 2 }),
			).toBeTruthy(),
		);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("opens the request dialog from the action beside the view controls", () => {
		render(<AbsencesViewContainer {...baseProps} />);
		const requestAbsence = screen.getByRole("button", {
			name: "Request absence",
		});

		// Outside the tab panels, so it stays available in both views.
		expect(requestAbsence.closest('[role="tabpanel"]')).toBeNull();
		expect(requestAbsence.parentElement?.querySelector('[role="tablist"]')).toBeTruthy();
		expect(requestDialog().dataset.open).toBe("false");
		fireEvent.click(requestAbsence);
		expect(requestDialog().dataset.open).toBe("true");
		expect(requestDialog().dataset.initialDate).toBe("");
	});

	it("starts a request from the selected calendar day", () => {
		render(<AbsencesViewContainer {...baseProps} />);

		fireEvent.click(getCalendarDay("2026-07-14"));

		expect(requestDialog().dataset.open).toBe("true");
		expect(requestDialog().dataset.initialDate).toBe("2026-07-14");
	});

	it("keeps year navigation outside the calendar so the table follows the year too", () => {
		render(<AbsencesViewContainer {...baseProps} />);
		const toolbar = screen.getByRole("button", { name: "Next year" });

		expect(toolbar.closest('[role="tabpanel"]')).toBeNull();
		expect(screen.queryByRole("button", { name: "This year" })).toBeNull();
	});

	it("loads holidays for the selected calendar year", async () => {
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [],
			holidays: [holiday("holiday-2027", "New 2027 Holiday", "2027-01-06")],
		});

		render(<AbsencesViewContainer {...baseProps} />);

		fireEvent.click(screen.getByRole("button", { name: "Next year" }));

		await waitFor(() => {
			expect(mockGetAbsenceCalendarYearData).toHaveBeenCalledWith(2027);
		});
		await waitFor(() => {
			expect(getCalendarDay("2027-01-06").dataset.state).toBe("holiday");
		});
		expect(screen.getByRole("button", { name: "This year" })).toBeTruthy();
	});

	it("keeps the selected year's data and open request when fresh server props arrive", async () => {
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [],
			holidays: [
				holiday("holiday-2027", "Selected year holiday", "2027-01-06"),
			],
		});
		const { rerender } = render(<AbsencesViewContainer {...baseProps} />);
		fireEvent.click(screen.getByRole("button", { name: "Next year" }));
		await waitFor(() =>
			expect(getCalendarDay("2027-01-06").dataset.state).toBe("holiday"),
		);
		fireEvent.click(screen.getByRole("button", { name: "Request absence" }));
		rerender(
			<AbsencesViewContainer {...baseProps} absences={[]} holidays={[]} />,
		);
		expect(getCalendarDay("2027-01-06").dataset.state).toBe("holiday");
		expect(requestDialog().dataset.open).toBe("true");
	});

	it("reloads absence data after a request succeeds", async () => {
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [absence()],
			holidays: [],
		});

		render(<AbsencesViewContainer {...baseProps} />);

		expect(getCalendarDay("2026-05-20").dataset.state).toBe("none");

		fireEvent.click(
			screen.getByRole("button", { name: "Simulate request success" }),
		);

		await waitFor(() => {
			expect(mockGetAbsenceCalendarYearData).toHaveBeenCalledWith(2026);
		});
		await waitFor(() => {
			expect(getCalendarDay("2026-05-20").dataset.state).toBe("pending");
		});
	});
});

describe("absences view and year in the URL (#1864)", () => {
	beforeEach(() => {
		mockGetAbsenceCalendarYearData.mockReset();
		window.history.replaceState(null, "", "/en/absences?utm=mail");
	});
	afterEach(() => {
		window.history.replaceState(null, "", "/");
	});

	function currentSearch() {
		return window.location.search;
	}

	it("arrives on the linked view and year without a client read", () => {
		window.history.replaceState(null, "", "/en/absences?view=table&year=2027");
		render(
			<AbsencesViewContainer {...baseProps} year={2027} initialView="table" />,
		);

		expect(screen.getByRole("heading", { name: "2027", level: 2 })).toBeTruthy();
		expect(
			screen.getByRole("tab", { name: "Table" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("button", { name: "This year" })).toBeTruthy();
		expect(mockGetAbsenceCalendarYearData).not.toHaveBeenCalled();
	});

	it("keeps the selected view in the URL without adding history entries", () => {
		render(<AbsencesViewContainer {...baseProps} />);
		const entries = window.history.length;

		fireEvent.mouseDown(screen.getByRole("tab", { name: "Table" }));
		fireEvent.click(screen.getByRole("tab", { name: "Table" }));
		expect(currentSearch()).toBe("?utm=mail&view=table");

		fireEvent.mouseDown(screen.getByRole("tab", { name: "Calendar" }));
		fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
		expect(currentSearch()).toBe("?utm=mail");
		expect(window.history.length).toBe(entries);
	});

	it("writes the year once it is shown and drops it again for this year", async () => {
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [],
			holidays: [],
		});
		window.history.replaceState(null, "", "/en/absences?utm=mail&view=table");
		render(<AbsencesViewContainer {...baseProps} initialView="table" />);

		fireEvent.click(screen.getByRole("button", { name: "Next year" }));
		await waitFor(() =>
			expect(currentSearch()).toBe("?utm=mail&view=table&year=2027"),
		);
		expect(screen.getByRole("heading", { name: "2027", level: 2 })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "This year" }));
		await waitFor(() => expect(currentSearch()).toBe("?utm=mail&view=table"));
	});

	it("leaves the URL on the shown year while another year fails to load", async () => {
		mockGetAbsenceCalendarYearData.mockRejectedValueOnce(
			new Error("Unavailable"),
		);
		render(<AbsencesViewContainer {...baseProps} />);

		fireEvent.click(screen.getByRole("button", { name: "Next year" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(currentSearch()).toBe("?utm=mail");
	});

	it("takes a fresh server snapshot for a linked year", () => {
		window.history.replaceState(null, "", "/en/absences?year=2027");
		const { rerender } = render(
			<AbsencesViewContainer {...baseProps} year={2027} />,
		);
		rerender(
			<AbsencesViewContainer
				{...baseProps}
				year={2027}
				holidays={[holiday("new", "New holiday", "2027-03-01")]}
			/>,
		);
		expect(getCalendarDay("2027-03-01").dataset.state).toBe("holiday");
	});

	it("follows a navigation to another view and year while staying mounted", async () => {
		let finish: (value: { absences: []; holidays: [] }) => void = () => {};
		mockGetAbsenceCalendarYearData.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		window.history.replaceState(null, "", "/en/absences?view=table&year=2027");
		const { rerender } = render(
			<AbsencesViewContainer {...baseProps} year={2027} initialView="table" />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Next year" }));

		// e.g. the sidebar link to the plain route
		window.history.replaceState(null, "", "/en/absences");
		rerender(
			<AbsencesViewContainer
				{...baseProps}
				year={2026}
				initialView="calendar"
				holidays={[holiday("today", "Navigated holiday", "2026-06-01")]}
			/>,
		);
		await act(async () => {
			finish({ absences: [], holidays: [] });
		});

		expect(screen.getByRole("heading", { name: "2026", level: 2 })).toBeTruthy();
		expect(
			screen.getByRole("tab", { name: "Calendar" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(getCalendarDay("2026-06-01").dataset.state).toBe("holiday");
		expect(screen.queryByRole("status")).toBeNull();
		expect(currentSearch()).toBe("");
	});

	it("restores the URL's view and year when it remounts with props of another entry", async () => {
		// e.g. back navigation that reuses a server render of the entry before `replaceState`
		mockGetAbsenceCalendarYearData.mockResolvedValue({
			absences: [],
			holidays: [holiday("restored", "Restored holiday", "2027-03-01")],
		});
		window.history.replaceState(null, "", "/en/absences?utm=mail&view=table&year=2027");

		render(<AbsencesViewContainer {...baseProps} />);

		expect(
			screen.getByRole("tab", { name: "Table" }).getAttribute("aria-selected"),
		).toBe("true");
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "2027", level: 2 })).toBeTruthy(),
		);
		expect(mockGetAbsenceCalendarYearData).toHaveBeenCalledWith(2027);
		expect(currentSearch()).toBe("?utm=mail&view=table&year=2027");
	});

	it("stops year navigation at the edges of the supported range", () => {
		window.history.replaceState(null, "", "/en/absences?year=2100");
		const { unmount } = render(
			<AbsencesViewContainer {...baseProps} year={2100} />,
		);
		expect(
			screen.getByRole("button", { name: "Next year" }).hasAttribute("disabled"),
		).toBe(true);
		unmount();
		window.history.replaceState(null, "", "/en/absences?year=1900");
		render(<AbsencesViewContainer {...baseProps} year={1900} />);
		expect(
			screen
				.getByRole("button", { name: "Previous year" })
				.hasAttribute("disabled"),
		).toBe(true);
	});
});

describe("AbsenceYearCalendar", () => {
	const originalTimeZone = process.env.TZ;
	afterEach(() => {
		process.env.TZ = originalTimeZone;
	});

	it("keeps all twelve months and day request controls available", () => {
		render(
			<AbsenceYearCalendar
				absences={[]}
				holidays={[]}
				year={2026}
				currentDate="2026-05-20"
			/>,
		);

		expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
		expect(getCalendarDay("2026-01-01")).toBeTruthy();
		expect(getCalendarDay("2026-12-31")).toBeTruthy();
	});

	it("places absences and holidays on their calendar day west of UTC", () => {
		// Parsing "2026-05-20" or a UTC-midnight holiday as a local instant moved both a day early.
		process.env.TZ = "America/Los_Angeles";
		render(
			<AbsenceYearCalendar
				absences={[absence({ status: "approved" })]}
				holidays={[holiday("h", "Ascension Day", "2026-05-14")]}
				year={2026}
				currentDate="2026-05-01"
			/>,
		);

		expect(getCalendarDay("2026-05-19").dataset.state).toBe("none");
		expect(getCalendarDay("2026-05-20").dataset.state).toBe("approved");
		expect(getCalendarDay("2026-05-13").dataset.state).toBe("none");
		expect(getCalendarDay("2026-05-14").dataset.state).toBe("holiday");
	});

	it("names each day with its date, absence, status and half-day part", () => {
		render(
			<AbsenceYearCalendar
				absences={[
					absence({
						status: "pending",
						startDate: "2026-03-02",
						endDate: "2026-03-03",
						endPeriod: "am",
					}),
				]}
				holidays={[]}
				year={2026}
				currentDate="2026-03-03"
			/>,
		);

		expect(
			screen.getByRole("button", {
				name: "Monday, March 2, 2026, Vacation · Pending",
			}),
		).toBeTruthy();
		const halfDay = screen.getByRole("button", {
			name: "Today, Tuesday, March 3, 2026, Vacation · Pending · Morning",
		});
		expect(halfDay.getAttribute("aria-current")).toBe("date");
	});
});
