import { beforeEach, describe, expect, it, vi } from "vitest";

const getManagerAbsenceEmployees = vi.fn();

vi.mock("next/navigation", () => ({
	redirect: vi.fn(),
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => null,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: () => (key: string, fallback: string) => fallback,
}));

vi.mock("../../absences/actions", () => ({
	getAbsenceCategories: vi.fn(async () => []),
}));

vi.mock("../actions", () => ({
	getCurrentEmployee: vi.fn(async () => ({
		id: "employee-1",
		organizationId: "org-1",
		role: "manager",
	})),
}));

vi.mock("./actions", () => ({
	getManagerAbsenceEmployees,
}));

vi.mock("./team-absences-table", () => ({
	TeamAbsencesTable: () => null,
}));

const { default: TeamAbsencesPage } = await import("./page");

describe("TeamAbsencesPage", () => {
	beforeEach(() => {
		getManagerAbsenceEmployees.mockReset();
		getManagerAbsenceEmployees.mockResolvedValue({
			success: true,
			data: {
				rows: [],
				total: 0,
				page: 1,
				pageSize: 25,
				year: 2026,
				pageCount: 0,
			},
		});
	});

	it("passes team and sort URL state to the manager absence list", async () => {
		await TeamAbsencesPage({
			searchParams: Promise.resolve({
				search: " Ada ",
				page: "2",
				pageSize: "50",
				year: "2026",
				teamId: "team-1",
				sort: "remainingVacationDays",
				direction: "desc",
			}),
		});

		expect(getManagerAbsenceEmployees).toHaveBeenCalledWith({
			search: "Ada",
			page: 2,
			pageSize: 50,
			year: 2026,
			teamId: "team-1",
			sort: "remainingVacationDays",
			direction: "desc",
		});
	});
});
