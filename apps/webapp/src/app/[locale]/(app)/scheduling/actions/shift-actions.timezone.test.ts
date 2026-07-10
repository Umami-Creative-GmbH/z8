import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	coverageValidation: vi.fn(),
	evaluateScheduleWindow: vi.fn(),
	getCoverageSettings: vi.fn(),
	layer: undefined as unknown,
	publishShifts: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: vi.fn(async () => ({ timezone: "Europe/Berlin" })),
			},
		},
	},
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions/shared", async () => {
	const { Effect } = await import("effect");
	return {
		logger: { info: vi.fn() },
		requireManagerEmployee: vi.fn(() =>
			Effect.succeed({
				currentEmployee: { id: "employee-1", organizationId: "org-1", role: "manager" },
				session: { user: { id: "user-1" } },
			}),
		),
		runSchedulingAction: vi.fn((_name, effect) =>
			Effect.runPromise(effect.pipe(Effect.provide(mockState.layer as never))),
		),
	};
});

vi.mock("@/lib/effect/services/coverage.service", async () => {
	const { Context, Effect } = await import("effect");
	const CoverageService = Context.GenericTag<any>("CoverageService");
	return { CoverageService, Effect };
});

vi.mock("@/lib/effect/services/shift.service", async () => {
	const { Context } = await import("effect");
	const ShiftService = Context.GenericTag<any>("ShiftService");
	return { ShiftService };
});

vi.mock("@/lib/effect/services/schedule-compliance.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const ScheduleComplianceService = Context.GenericTag<any>("ScheduleComplianceService");
	return {
		ScheduleComplianceService,
		ScheduleComplianceServiceLive: Layer.succeed(
			ScheduleComplianceService,
			ScheduleComplianceService.of({
				evaluateScheduleWindow: (input: unknown) => {
					mockState.evaluateScheduleWindow(input);
					return Effect.succeed({
						summary: { totalFindings: 0, byType: {} },
						fingerprint: "fingerprint-1",
					});
				},
			}),
		),
	};
});

const { CoverageService } = await import("@/lib/effect/services/coverage.service");
const { DatabaseService } = await import("@/lib/effect/services/database.service");
const { ShiftService } = await import("@/lib/effect/services/shift.service");
const { Effect, Layer } = await import("effect");
const { publishShifts } = await import("./shift-actions");

describe("publishShifts organization timezone boundary", () => {
	beforeEach(() => {
		mockState.coverageValidation.mockReset();
		mockState.evaluateScheduleWindow.mockReset();
		mockState.getCoverageSettings.mockReset();
		mockState.publishShifts.mockReset();
		mockState.getCoverageSettings.mockReturnValue(Effect.succeed({ allowPublishWithGaps: false }));
		mockState.coverageValidation.mockReturnValue(Effect.succeed({ canPublish: true, gaps: [] }));
		mockState.publishShifts.mockReturnValue(
			Effect.succeed({ count: 1, affectedEmployeeIds: ["employee-1"] }),
		);
		mockState.layer = Layer.mergeAll(
			Layer.succeed(
				CoverageService,
				CoverageService.of({
					getCoverageSettings: mockState.getCoverageSettings,
					validateScheduleCanPublish: mockState.coverageValidation,
				}),
			),
			Layer.succeed(ShiftService, ShiftService.of({ publishShifts: mockState.publishShifts })),
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({ db: {}, query: (_name, query) => Effect.promise(query) }),
			),
		);
	});

	it("uses Berlin half-open instants for coverage, compliance, and publishing", async () => {
		await expect(
			publishShifts({ startDate: "2026-03-01", endDateExclusive: "2026-03-08" }),
		).resolves.toMatchObject({ published: true, count: 1 });

		const expectedRange = {
			startDate: new Date("2026-02-28T23:00:00.000Z"),
			endDate: new Date("2026-03-07T23:00:00.000Z"),
		};
		expect(mockState.coverageValidation).toHaveBeenCalledWith({
			organizationId: "org-1",
			...expectedRange,
			timezone: "Europe/Berlin",
		});
		expect(mockState.evaluateScheduleWindow).toHaveBeenCalledWith({
			organizationId: "org-1",
			...expectedRange,
			timezone: "Europe/Berlin",
		});
		expect(mockState.publishShifts).toHaveBeenCalledWith(
			"org-1",
			{
				start: expectedRange.startDate,
				endExclusive: expectedRange.endDate,
			},
			"user-1",
		);
	});
});
