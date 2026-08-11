import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	deleteShift: vi.fn(),
	layer: undefined as unknown,
	requireCurrentEmployee: vi.fn(),
	requireManagerEmployee: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions/shared", async () => {
	const { Effect } = await import("effect");
	return {
		logger: { info: vi.fn() },
		requireCurrentEmployee: mockState.requireCurrentEmployee,
		requireManagerEmployee: mockState.requireManagerEmployee,
		runSchedulingAction: vi.fn((_name, effect) =>
			Effect.runPromise(effect.pipe(Effect.provide(mockState.layer as never))),
		),
	};
});

vi.mock("@/lib/effect/services/shift.service", async () => {
	const { Context } = await import("effect");
	return {
		ShiftService: Context.GenericTag<{
			deleteShift: typeof mockState.deleteShift;
		}>("DeleteShiftService"),
	};
});

const { ShiftService } = await import("@/lib/effect/services/shift.service");
const { Effect, Layer } = await import("effect");
const { deleteShift } = await import("./shift-actions");

describe("deleteShift active organization scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const context = {
			currentEmployee: {
				id: "employee-b",
				organizationId: "org-b",
				role: "manager",
			},
			session: { user: { id: "user-multi-org" } },
		};
		mockState.requireCurrentEmployee.mockReturnValue(Effect.succeed(context));
		mockState.requireManagerEmployee.mockReturnValue(Effect.succeed(context));
		mockState.deleteShift.mockReturnValue(Effect.void);
		mockState.layer = Layer.succeed(
			ShiftService,
			ShiftService.of({ deleteShift: mockState.deleteShift }),
		);
	});

	it("requires the active manager and passes authoritative scope to the service", async () => {
		await expect(deleteShift("shift-org-a")).resolves.toBeUndefined();

		expect(mockState.requireManagerEmployee).toHaveBeenCalledWith({
			resource: "shift",
			action: "delete",
			message: "Only managers and admins can delete shifts",
		});
		expect(mockState.requireCurrentEmployee).not.toHaveBeenCalled();
		expect(mockState.deleteShift).toHaveBeenCalledWith("shift-org-a", {
			employeeId: "employee-b",
			organizationId: "org-b",
			userId: "user-multi-org",
		});
	});
});
