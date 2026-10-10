import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	layer: undefined as unknown,
	loadOrganizationTimezone: vi.fn(),
	loadUpcomingShifts: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/app/[locale]/(app)/scheduling/actions/shared", async () => {
	const { Effect } = await import("effect");
	return {
		logger: { info: vi.fn() },
		requireCurrentEmployee: vi.fn(() =>
			Effect.succeed({
				currentEmployee: { id: "employee-1", organizationId: "org-1", role: "employee" },
				session: { user: { id: "user-1" } },
			}),
		),
		runSchedulingAction: vi.fn((_name, effect) =>
			Effect.runPromise(effect.pipe(Effect.provide(mockState.layer as never))),
		),
	};
});

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mockState.loadOrganizationTimezone,
}));

vi.mock("@/lib/scheduling/upcoming-shifts", () => ({
	UPCOMING_SHIFTS_LIMIT: 5,
	loadUpcomingShifts: mockState.loadUpcomingShifts,
}));

vi.mock("@/lib/effect/services/coverage.service", async () => {
	const { Context } = await import("effect");
	return { CoverageService: Context.Service<any>("CoverageService") };
});

vi.mock("@/lib/effect/services/shift.service", async () => {
	const { Context } = await import("effect");
	return { ShiftService: Context.Service<any>("ShiftService") };
});

vi.mock("@/lib/effect/services/schedule-compliance.service", async () => {
	const { Context, Layer } = await import("effect");
	const ScheduleComplianceService = Context.Service<any>("ScheduleComplianceService");
	return {
		ScheduleComplianceService,
		ScheduleComplianceServiceLive: Layer.empty,
	};
});

const { DatabaseService } = await import("@/lib/effect/services/database.service");
const { Effect, Layer } = await import("effect");
const { getMyUpcomingShifts } = await import("./shift-actions");

const scopedDb = { scoped: true };

describe("getMyUpcomingShifts", () => {
	beforeEach(() => {
		mockState.loadOrganizationTimezone.mockReset().mockResolvedValue("Europe/Berlin");
		mockState.loadUpcomingShifts.mockReset().mockResolvedValue({ today: "2026-10-09", shifts: [] });
		mockState.layer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({ db: scopedDb as never, query: (_name, query) => Effect.promise(query) }),
		);
	});

	it("loads the current employee's shifts in the active organization and its zone", async () => {
		await expect(getMyUpcomingShifts()).resolves.toEqual({ today: "2026-10-09", shifts: [] });

		expect(mockState.loadOrganizationTimezone).toHaveBeenCalledWith(scopedDb, "org-1");
		expect(mockState.loadUpcomingShifts).toHaveBeenCalledWith(
			scopedDb,
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				organizationTimezone: "Europe/Berlin",
				limit: 5,
			}),
		);
	});
});
