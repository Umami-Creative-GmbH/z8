import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	layer: undefined as unknown,
	upsertShift: vi.fn(),
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
				currentEmployee: { id: "employee-1", organizationId: "org-trusted", role: "manager" },
				session: { user: { id: "user-trusted" } },
			}),
		),
		runSchedulingAction: vi.fn((_name, effect) =>
			Effect.runPromise(effect.pipe(Effect.provide(mockState.layer as never))),
		),
	};
});

vi.mock("@/lib/effect/services/shift.service", async () => {
	const { Context } = await import("effect");
	const ShiftService = Context.Service<any>("ShiftService");
	return { ShiftService };
});

const { DatabaseService } = await import("@/lib/effect/services/database.service");
const { ShiftService } = await import("@/lib/effect/services/shift.service");
const { Effect, Layer } = await import("effect");
const { upsertShift } = await import("./shift-actions");

describe("upsertShift skill override reason (#893)", () => {
	beforeEach(() => {
		mockState.upsertShift.mockReset();
		mockState.upsertShift.mockReturnValue(
			Effect.succeed({ shift: { id: "shift-1" }, metadata: { hasOverlap: false } }),
		);
		mockState.layer = Layer.mergeAll(
			Layer.succeed(ShiftService, ShiftService.of({ upsertShift: mockState.upsertShift })),
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({ db: {}, query: (_name, query) => Effect.promise(query) }),
			),
		);
	});

	it("forwards the planner's reason with the trusted organization and actor", async () => {
		await upsertShift({
			employeeId: "employee-2",
			subareaId: "subarea-1",
			date: "2026-10-09",
			startTime: "08:00",
			endTime: "16:00",
			skillOverrideReason: "Only one on duty",
			// Spoofed scope from the client is not part of the contract.
			organizationId: "org-spoofed",
			createdBy: "user-spoofed",
		} as never);

		expect(mockState.upsertShift).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-trusted",
				employeeId: "employee-2",
				skillOverrideReason: "Only one on duty",
				createdBy: "user-trusted",
			}),
		);
	});
});
