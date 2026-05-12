import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

		expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
		expect(screen.getByText("24")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /record absence/i }));
		expect(screen.getByText("Record absence for Ada Lovelace")).toBeInTheDocument();
	});
});
