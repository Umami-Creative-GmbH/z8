// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import type { AbsenceWithDays } from "@/lib/absences/types";
import { AbsenceEntriesTable } from "./absence-entries-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	cancelAbsenceRequest: vi.fn(),
}));

const sickNotes = vi.hoisted(() => ({
	canAttach: false,
	markers: {} as Record<string, { count: number; viewable: boolean }>,
	refresh: async () => undefined,
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

beforeAll(() => {
	class ResizeObserverMock implements ResizeObserver {
		disconnect() {}
		observe() {}
		unobserve() {}
	}

	globalThis.ResizeObserver = ResizeObserverMock;
});

function buildAbsence(overrides: Partial<AbsenceWithDays>): AbsenceWithDays {
	return {
		id: "absence-1",
		employeeId: "employee-1",
		startDate: "2026-05-21",
		startPeriod: "full_day",
		endDate: "2026-05-21",
		endPeriod: "full_day",
		status: "pending",
		notes: null,
		sickDetail: null,
		category: {
			id: "category-vacation",
			name: "Vacation",
			type: "vacation",
			color: null,
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

describe("AbsenceEntriesTable", () => {
	it("shows the absence days the server resolved (#979)", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[
					// A Monday-to-Friday range the client would have counted as 5.
					buildAbsence({ startDate: "2026-10-12", endDate: "2026-10-16", absenceDays: 1 }),
				]}
			/>,
		);

		expect(screen.getByText("1 day")).toBeTruthy();
	});

	it("keeps the cancel action on a phone screen with a visible label (#846)", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[buildAbsence({ id: "pending", status: "pending", startDate: "2026-05-21" })]}
			/>,
		);

		const cancel = screen.getByRole("button", { name: "Cancel absence" });
		// The actions column stays pinned at the right edge while the other columns scroll.
		expect(cancel.closest("td")?.className).toContain("sticky");
		expect(cancel.closest("td")?.className).toContain("right-0");
		// Touch screens cannot show the tooltip, so phones see the label in the button.
		const label = Array.from(cancel.querySelectorAll("span")).find(
			(span) => span.textContent === "Cancel absence",
		);
		expect(label?.className).toContain("sm:sr-only");
	});

	it("shows sick detail labels for sick absences only", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[
					{
						id: "absence-sick",
						employeeId: "employee-1",
						startDate: "2026-05-18",
						startPeriod: "full_day",
						endDate: "2026-05-18",
						endPeriod: "full_day",
						status: "approved",
						notes: null,
						sickDetail: "child_sick",
						category: {
							id: "category-sick",
							name: "Sick Leave",
							type: "sick",
							color: null,
							countsAgainstVacation: false,
						},
						approvedBy: null,
						approvedAt: null,
						rejectionReason: null,
						createdAt: new Date("2026-05-01T00:00:00Z"),
					},
					{
						id: "absence-vacation",
						employeeId: "employee-1",
						startDate: "2026-06-01",
						startPeriod: "full_day",
						endDate: "2026-06-01",
						endPeriod: "full_day",
						status: "approved",
						notes: null,
						sickDetail: "with_certificate",
						category: {
							id: "category-vacation",
							name: "Vacation",
							type: "vacation",
							color: null,
							countsAgainstVacation: true,
						},
						approvedBy: null,
						approvedAt: null,
						rejectionReason: null,
						createdAt: new Date("2026-05-01T00:00:00Z"),
					},
				]}
			/>,
		);

		expect(screen.getByText("Child sick")).toBeTruthy();
		expect(screen.queryByText("With certificate")).toBeNull();
	});

	it("shows cancel actions for pending and future approved absences", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[
					buildAbsence({ id: "pending", status: "pending", startDate: "2026-05-20" }),
					buildAbsence({ id: "approved-future", status: "approved", startDate: "2026-05-21" }),
				]}
			/>,
		);

		expect(screen.getAllByLabelText("Cancel absence")).toHaveLength(2);
	});

	it("hides cancel actions for approved absences starting today or earlier", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[
					buildAbsence({ id: "approved-today", status: "approved", startDate: "2026-05-20" }),
					buildAbsence({ id: "approved-past", status: "approved", startDate: "2026-05-19" }),
					buildAbsence({ id: "rejected-future", status: "rejected", startDate: "2026-05-21" }),
				]}
			/>,
		);

		expect(screen.queryByLabelText("Cancel absence")).toBeNull();
	});

	it("uses the provided current date for approved absence eligibility", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-21"
				absences={[
					buildAbsence({ id: "approved-today", status: "approved", startDate: "2026-05-21" }),
				]}
			/>,
		);

		expect(screen.queryByLabelText("Cancel absence")).toBeNull();
	});

	it("refreshes absence data after successful cancellation", async () => {
		const onUpdate = vi.fn();
		vi.mocked(cancelAbsenceRequest).mockResolvedValueOnce({ success: true });

		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[buildAbsence({ id: "absence-cancellable", status: "pending" })]}
				onUpdate={onUpdate}
			/>,
		);

		fireEvent.click(screen.getByLabelText("Cancel absence"));
		fireEvent.click(screen.getByRole("button", { name: "Yes, cancel absence" }));

		await waitFor(() => {
			expect(onUpdate).toHaveBeenCalledTimes(1);
		});
	});

	it("shows translated tooltip copy for the cancel button", async () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[buildAbsence({ id: "absence-cancellable", status: "pending" })]}
			/>,
		);

		fireEvent.focus(screen.getByLabelText("Cancel absence"));

		expect((await screen.findAllByText("Cancel absence")).length).toBeGreaterThan(0);
	});

	describe("sick notes (#982)", () => {
		const sickCategory = {
			id: "category-sick",
			name: "Sick Leave",
			type: "sick",
			color: null,
			countsAgainstVacation: false,
		};

		afterEach(() => {
			sickNotes.canAttach = false;
			sickNotes.markers = {};
		});

		it("offers no attach action while the organization does not allow it", () => {
			render(
				<AbsenceEntriesTable
					currentDate="2026-05-20"
					absences={[buildAbsence({ id: "sick", category: sickCategory })]}
				/>,
			);
			expect(screen.queryByLabelText("Attach sick note")).toBeNull();
		});

		it("offers attaching on pending and approved sick leave only", () => {
			sickNotes.canAttach = true;
			render(
				<AbsenceEntriesTable
					currentDate="2026-05-20"
					absences={[
						buildAbsence({ id: "sick-pending", category: sickCategory, status: "pending" }),
						// Approved and already started: no cancel action, but notes still go on.
						buildAbsence({
							id: "sick-approved",
							category: sickCategory,
							status: "approved",
							startDate: "2026-05-18",
						}),
						buildAbsence({ id: "sick-rejected", category: sickCategory, status: "rejected" }),
						buildAbsence({ id: "vacation", status: "pending" }),
					]}
				/>,
			);
			const attach = screen.getAllByLabelText("Attach sick note");
			expect(attach).toHaveLength(2);
			fireEvent.click(attach[1] as HTMLElement);
			expect(screen.getByText("attaching to sick-approved")).toBeTruthy();
		});

		it("shows the attached count and opens the notes when they may be opened", () => {
			sickNotes.markers = {
				"sick-own": { count: 2, viewable: true },
				"sick-hidden": { count: 1, viewable: false },
			};
			render(
				<AbsenceEntriesTable
					currentDate="2026-05-20"
					absences={[
						buildAbsence({ id: "sick-own", category: sickCategory }),
						buildAbsence({ id: "sick-hidden", category: sickCategory }),
					]}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Sick note attached ({count})" }));
			expect(screen.getByText("sick notes of sick-own")).toBeTruthy();
			// A note the viewer cannot open is a marker only.
			expect(screen.getAllByText("Sick note attached ({count})")).toHaveLength(2);
			expect(screen.getAllByRole("button", { name: "Sick note attached ({count})" })).toHaveLength(
				1,
			);
		});
	});

	it("renders the search input with the shared card surface", () => {
		render(
			<AbsenceEntriesTable
				currentDate="2026-05-20"
				absences={[buildAbsence({ id: "absence-cancellable", status: "pending" })]}
			/>,
		);

		expect(screen.getByPlaceholderText("Search by type, status, or notes…").className).toContain(
			"bg-card",
		);
	});
});
