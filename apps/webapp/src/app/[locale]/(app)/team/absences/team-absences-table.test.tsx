// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildRecordAbsenceForEmployeeInput,
	validateRecordAbsenceFormDateRange,
} from "./record-absence-dialog";
import { TeamAbsencesTable } from "./team-absences-table";

const routerPush = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams("search=old&page=2&pageSize=10&year=2026"),
}));

vi.mock("./actions", () => ({
	recordAbsenceForEmployee: vi.fn(),
}));

describe("TeamAbsencesTable", () => {
	beforeEach(() => {
		routerPush.mockClear();
	});

	it("submits search through URL params and resets to the first page", () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [],
					total: 0,
					page: 2,
					pageSize: 10,
					year: 2026,
					pageCount: 0,
				}}
				categories={[]}
				search="old"
			/>,
		);

		fireEvent.change(screen.getByRole("searchbox", { name: /search employees/i }), {
			target: { value: "Ada" },
		});
		fireEvent.click(screen.getByRole("button", { name: /search/i }));

		expect(routerPush).toHaveBeenCalledWith("/team/absences?search=Ada&page=1&pageSize=10&year=2026");
	});

	it("renders an empty state when no employees match", () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [],
					total: 0,
					page: 1,
					pageSize: 10,
					year: 2026,
					pageCount: 0,
				}}
				categories={[]}
				search=""
			/>,
		);

		expect(screen.getByRole("status", { name: /no employees found/i })).toBeTruthy();
		expect(screen.getByText(/try adjusting filters/i)).toBeTruthy();
	});

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
		expect(screen.getByRole("columnheader", { name: "Pending" }).className).not.toContain(
			"hidden",
		);
		expect(screen.getByRole("columnheader", { name: "Sick" }).className).not.toContain("hidden");
		const recordButton = screen.getByRole("button", {
			name: "Record absence for Ada Lovelace",
		});
		expect(recordButton.closest("div.rounded-lg")?.className).not.toContain("overflow-hidden");

		fireEvent.click(recordButton);
		expect(screen.getByText("Record absence for Ada Lovelace")).toBeTruthy();
	});

	it("disables pagination controls at boundaries and routes to the next page", () => {
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
					total: 15,
					page: 1,
					pageSize: 10,
					year: 2026,
					pageCount: 2,
				}}
				categories={[]}
				search="old"
			/>,
		);

		expect(screen.getByRole<HTMLButtonElement>("button", { name: /previous page/i }).disabled).toBe(
			true,
		);
		const nextButton = screen.getByRole("button", { name: /next page/i });
		expect((nextButton as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(nextButton);

		expect(routerPush).toHaveBeenCalledWith("/team/absences?search=old&page=2&pageSize=10&year=2026");
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

describe("buildRecordAbsenceForEmployeeInput", () => {
	it("includes sick detail for manager-recorded sick absences", () => {
		expect(
			buildRecordAbsenceForEmployeeInput("employee-1", {
				categoryId: "category-sick",
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
				notes: "",
				sickDetail: "with_certificate",
			}),
		).toMatchObject({
			employeeId: "employee-1",
			sickDetail: "with_certificate",
		});
	});
});
