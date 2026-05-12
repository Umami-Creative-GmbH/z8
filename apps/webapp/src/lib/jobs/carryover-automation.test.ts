import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOrganizationsMock = vi.fn();
const getVacationAllowanceMock = vi.fn();
const calculateAnnualCarryoverMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findMany: findManyOrganizationsMock,
			},
		},
	},
}));

vi.mock("@/lib/query/vacation.queries", () => ({
	getVacationAllowance: getVacationAllowanceMock,
}));

vi.mock("@/lib/absences/vacation.service", () => ({
	accrueVacationDays: vi.fn(),
	calculateAnnualCarryover: calculateAnnualCarryoverMock,
	expireCarryoverDays: vi.fn(),
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: { TIME_ENTRY_CHAIN_VERIFIED: "TIME_ENTRY_CHAIN_VERIFIED" },
	logAudit: logAuditMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
	}),
}));

describe("runAnnualCarryover fiscal-year scheduling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-31T10:00:00.000Z"));
		findManyOrganizationsMock.mockReset();
		getVacationAllowanceMock.mockReset();
		calculateAnnualCarryoverMock.mockReset();
		logAuditMock.mockReset();
		getVacationAllowanceMock.mockResolvedValue({ allowCarryover: true });
		calculateAnnualCarryoverMock.mockResolvedValue({
			organizationId: "org-1",
			fromYear: 2025,
			toYear: 2026,
			processedAt: new Date("2026-04-01T00:00:00.000Z"),
			employeesProcessed: 0,
			totalDaysCarriedOver: 0,
			results: [],
			errors: [],
		});
		logAuditMock.mockResolvedValue(undefined);
	});

	it("does not process non-January organizations before their fiscal year start day", async () => {
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).not.toHaveBeenCalled();
		expect(calculateAnnualCarryoverMock).not.toHaveBeenCalled();
	});

	it("processes the previous fiscal label year on the organization's fiscal year start", async () => {
		vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"));
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover();

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2025, 4);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2025,
			"system-automation",
			4,
		);
	});

	it("treats targetYear as an explicit fiscal label override", async () => {
		findManyOrganizationsMock.mockResolvedValue([
			{ id: "org-1", name: "April Org", fiscalYearStartMonth: 4 },
		]);

		const { runAnnualCarryover } = await import("./carryover-automation");
		await runAnnualCarryover(2024);

		expect(getVacationAllowanceMock).toHaveBeenCalledWith("org-1", 2024, 4);
		expect(calculateAnnualCarryoverMock).toHaveBeenCalledWith(
			"org-1",
			2024,
			"system-automation",
			4,
		);
	});
});
