// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { validateRecordAbsenceFormDateRange } from "./record-absence-dialog";
import { TeamAbsencesTable } from "./team-absences-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("./actions", () => ({
	recordAbsenceForEmployee: vi.fn(),
}));

describe("TeamAbsencesTable", () => {
	it("renders metrics and opens the record absence dialog", async () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [
						{
							id: "employee-1",
							userId: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							employeeNumber: "E-001",
							position: "Engineer",
							role: "employee",
							teamName: "Operations",
							vacationAllowance: 30,
							usedVacationDays: 4,
							pendingVacationDays: 2,
							remainingVacationDays: 24,
							sickDays: 1,
						},
					],
					total: 1,
					page: 1,
					pageSize: 10,
					year: 2026,
					pageCount: 1,
				}}
				categories={[
					{
						id: "category-sick",
						name: "Sick Leave",
						type: "sick",
						color: null,
						requiresApproval: true,
						countsAgainstVacation: false,
					},
				]}
				search=""
			/>,
		);

		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("24")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /record absence/i }));
		expect(screen.getByText("Record absence for Ada Lovelace")).toBeTruthy();
	});
});

describe("validateRecordAbsenceFormDateRange", () => {
	it("rejects reversed dates and same-day afternoon-to-morning ranges", () => {
		expect(
			validateRecordAbsenceFormDateRange({
				startDate: "2026-05-13",
				startPeriod: "am",
				endDate: "2026-05-12",
				endPeriod: "pm",
			}),
		).toBe("Start date must be before end date");

		expect(
			validateRecordAbsenceFormDateRange({
				startDate: "2026-05-12",
				startPeriod: "pm",
				endDate: "2026-05-12",
				endPeriod: "am",
			}),
		).toBe("Cannot end in the morning if starting in the afternoon on the same day");
	});
});
