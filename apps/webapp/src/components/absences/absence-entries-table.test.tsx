// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
import type { AbsenceWithCategory } from "@/lib/absences/types";
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

beforeAll(() => {
	class ResizeObserverMock implements ResizeObserver {
		disconnect() {}
		observe() {}
		unobserve() {}
	}

	globalThis.ResizeObserver = ResizeObserverMock;
});

function buildAbsence(overrides: Partial<AbsenceWithCategory>): AbsenceWithCategory {
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
		...overrides,
	};
}

describe("AbsenceEntriesTable", () => {
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
