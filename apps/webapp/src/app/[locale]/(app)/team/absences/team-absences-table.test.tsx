// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateRecordAbsenceFormDateRange } from "./record-absence-dialog";
import { TeamAbsencesTable } from "./team-absences-table";

const routerPush = vi.fn();
let mockedSearchParams = "search=old&page=2&pageSize=10&year=2026";

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

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ image, name, seed }: { image?: string | null; name?: string | null; seed: string }) => (
		<span
			data-testid="user-avatar"
			data-image={image ?? ""}
			data-name={name ?? ""}
			data-seed={seed}
		/>
	),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(mockedSearchParams),
}));

vi.mock("./actions", () => ({
	recordAbsenceForEmployee: vi.fn(),
}));

describe("TeamAbsencesTable", () => {
	beforeEach(() => {
		routerPush.mockClear();
		mockedSearchParams = "search=old&page=2&pageSize=10&year=2026";
	});

	it("submits search through URL params and resets to the first page", () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [],
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 0,
					page: 2,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
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
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 0,
					page: 1,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
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
							image: "https://example.com/ada.png",
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
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 1,
					page: 1,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
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
		expect(screen.getByTestId("user-avatar").getAttribute("data-image")).toBe(
			"https://example.com/ada.png",
		);
		expect(screen.getByTestId("user-avatar").getAttribute("data-seed")).toBe("user-1");
		expect(screen.getByText("24")).toBeTruthy();
		expect(screen.getByRole("columnheader", { name: /employee/i }).getAttribute("aria-sort")).toBe(
			"ascending",
		);
		expect(screen.getByRole("columnheader", { name: /pending/i }).className).not.toContain(
			"hidden",
		);
		expect(screen.getByRole("columnheader", { name: /sick/i }).className).not.toContain("hidden");
		const recordButton = screen.getByRole("button", {
			name: "Record absence for Ada Lovelace",
		});
		expect(recordButton.textContent).not.toContain("Record absence");
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
							image: "https://example.com/ada.png",
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
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 15,
					page: 1,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
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

	it("filters by team through URL params and resets to the first page", () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [
						{
							id: "employee-1",
							userId: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: "https://example.com/ada.png",
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
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 1,
					page: 2,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
					pageCount: 1,
				}}
				categories={[]}
				search="old"
			/>,
		);

		fireEvent.click(screen.getByRole("combobox", { name: /filter by team/i }));
		fireEvent.click(screen.getByRole("option", { name: "Operations" }));

		expect(routerPush).toHaveBeenCalledWith(
			"/team/absences?search=old&page=1&pageSize=10&year=2026&teamId=team-ops",
		);
	});

	it("sorts by header through URL params and resets to the first page", () => {
		render(
			<TeamAbsencesTable
				data={{
					rows: [
						{
							id: "employee-1",
							userId: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: "https://example.com/ada.png",
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
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 1,
					page: 2,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
					pageCount: 1,
				}}
				categories={[]}
				search="old"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /sort by used/i }));

		expect(routerPush).toHaveBeenCalledWith(
			"/team/absences?search=old&page=1&pageSize=10&year=2026&sort=usedVacationDays&direction=asc",
		);
	});

	it("drops stale team ids from URL updates when server canonical state has no team", () => {
		mockedSearchParams = "search=old&page=2&pageSize=10&year=2026&teamId=stale";

		render(
			<TeamAbsencesTable
				data={{
					rows: [
						{
							id: "employee-1",
							userId: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: null,
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
					teams: [{ id: "team-ops", name: "Operations" }],
					total: 1,
					page: 2,
					pageSize: 10,
					year: 2026,
					teamId: null,
					sort: "employee",
					direction: "asc",
					pageCount: 1,
				}}
				categories={[]}
				search="old"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /sort by used/i }));

		expect(routerPush).toHaveBeenCalledWith(
			"/team/absences?search=old&page=1&pageSize=10&year=2026&sort=usedVacationDays&direction=asc",
		);

		fireEvent.change(screen.getByRole("searchbox", { name: /search employees/i }), {
			target: { value: "Grace" },
		});
		fireEvent.click(screen.getByRole("button", { name: /search/i }));

		expect(routerPush).toHaveBeenLastCalledWith(
			"/team/absences?search=Grace&page=1&pageSize=10&year=2026",
		);

		fireEvent.click(screen.getByRole("combobox", { name: /filter by year/i }));
		fireEvent.click(screen.getByRole("option", { name: "2025" }));

		expect(routerPush).toHaveBeenLastCalledWith(
			"/team/absences?search=old&page=1&pageSize=10&year=2025",
		);
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
