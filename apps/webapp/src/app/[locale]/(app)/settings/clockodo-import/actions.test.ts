import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/db/auth-schema", () => ({}));

vi.mock("@/db/schema", () => ({
	absenceEntry: {},
	clockodoUserMapping: {},
	employee: {},
	holiday: {},
	surchargeModel: {},
	team: {},
	workCategory: {},
	workPeriod: {},
	workPolicy: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: vi.fn(),
}));

vi.mock("@/lib/clockodo/client", () => ({
	ClockodoClient: vi.fn(),
}));

vi.mock("@/lib/clockodo/import-orchestrator", () => ({
	orchestrateImport: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
	}),
}));

const { importClockodoData } = await import("./actions");

describe("Clockodo import actions", () => {
	it("disables direct production imports", async () => {
		const result = await importClockodoData(
			"admin@example.com",
			"api-key-123",
			"org_123",
			{
				users: true,
				teams: false,
				services: false,
				entries: false,
				absences: false,
				targetHours: false,
				holidayQuotas: false,
				nonBusinessDays: false,
				surcharges: false,
				dateRange: { preset: "all_data", startDate: null, endDate: null },
			},
		);

		expect(result).toEqual({
			success: false,
			error: "Direct Clockodo imports are disabled. Start an import review scan instead.",
		});
	});
});
