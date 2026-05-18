import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getCurrentEmployee: vi.fn(),
	getAbsenceEntries: vi.fn(),
	getHolidays: vi.fn(),
	getVacationBalance: vi.fn(),
	findOrganization: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mockState.findOrganization,
			},
		},
	},
}));

vi.mock("./current-employee", () => ({
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

vi.mock("./queries", () => ({
	getAbsenceCategories: vi.fn(),
	getAbsenceEntries: mockState.getAbsenceEntries,
	getHolidays: mockState.getHolidays,
	getVacationBalance: mockState.getVacationBalance,
}));

vi.mock("./mutations", () => ({
	cancelAbsenceRequest: vi.fn(),
	cancelAbsenceRequestForEmployee: vi.fn(),
}));

vi.mock("./plan-preview", () => ({
	getAbsencePlanPreview: vi.fn(),
}));

vi.mock("./request-absence-effect", () => ({
	requestAbsenceEffect: vi.fn(),
	requestAbsenceForEmployeeEffect: vi.fn(),
}));

const actions = await import("./actions");

describe("absence action wrappers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getCurrentEmployee.mockResolvedValue({ id: "emp-current", organizationId: "org-1" });
		mockState.getAbsenceEntries.mockResolvedValue([{ id: "absence-1" }]);
		mockState.getHolidays.mockResolvedValue([{ id: "holiday-1" }]);
		mockState.getVacationBalance.mockResolvedValue({ year: 2026, remainingDays: 10 });
		mockState.findOrganization.mockResolvedValue({ timezone: "UTC" });
	});

	it("does not load absence entries for a client-provided employee id", async () => {
		const result = await actions.getAbsenceEntries("emp-other", "2026-05-01", "2026-05-31");

		expect(result).toEqual([]);
		expect(mockState.getAbsenceEntries).not.toHaveBeenCalled();
	});

	it("loads absence entries for the current employee", async () => {
		const result = await actions.getAbsenceEntries("emp-current", "2026-05-01", "2026-05-31");

		expect(result).toEqual([{ id: "absence-1" }]);
		expect(mockState.getAbsenceEntries).toHaveBeenCalledWith(
			"emp-current",
			"2026-05-01",
			"2026-05-31",
		);
	});

	it("does not load vacation balance for a client-provided employee id", async () => {
		const result = await actions.getVacationBalance("emp-other", 2026);

		expect(result).toBeNull();
		expect(mockState.getVacationBalance).not.toHaveBeenCalled();
	});

	it("loads vacation balance for the current employee calendar year", async () => {
		const result = await actions.getVacationBalance("emp-current", 2026);

		expect(result).toEqual({ year: 2026, remainingDays: 10 });
		expect(mockState.getVacationBalance).toHaveBeenCalledWith("emp-current", 2026);
	});

	it("loads absence calendar data for the current employee and selected year", async () => {
		const result = await actions.getAbsenceCalendarYearData(2027);

		expect(result).toEqual({ absences: [{ id: "absence-1" }], holidays: [{ id: "holiday-1" }] });
		expect(mockState.getAbsenceEntries).toHaveBeenCalledWith(
			"emp-current",
			"2027-01-01",
			"2027-12-31",
		);
		expect(mockState.getHolidays).toHaveBeenCalledWith(
			"emp-current",
			new Date("2027-01-01T00:00:00.000Z"),
			new Date("2027-12-31T23:59:59.999Z"),
		);
	});
});
