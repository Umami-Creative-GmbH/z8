// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("AbsenceEntriesTable", () => {
	it("shows sick detail labels for sick absences only", () => {
		render(
			<AbsenceEntriesTable
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
});
