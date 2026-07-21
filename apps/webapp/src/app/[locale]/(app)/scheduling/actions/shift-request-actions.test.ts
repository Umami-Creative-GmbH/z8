import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	currentEmployee: {
		id: "employee-trusted",
		organizationId: "org-trusted",
		role: "manager",
	},
	requestSwap: vi.fn(),
	requestPickup: vi.fn(),
	approveRequest: vi.fn(),
	rejectRequest: vi.fn(),
	cancelRequest: vi.fn(),
	getPendingRequests: vi.fn(),
	layer: undefined as unknown,
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions/shared", async () => {
	const { Effect } = await import("effect");
	return {
		requireCurrentEmployee: vi.fn(() =>
			Effect.succeed({
				currentEmployee: state.currentEmployee,
				session: {
					user: { id: "user-trusted" },
					session: { activeOrganizationId: "org-trusted" },
				},
			}),
		),
		requireManagerEmployee: vi.fn(() =>
			Effect.succeed({
				currentEmployee: state.currentEmployee,
				session: {
					user: { id: "user-trusted" },
					session: { activeOrganizationId: "org-trusted" },
				},
			}),
		),
		runSchedulingAction: vi.fn((_name, effect) =>
			Effect.runPromise(effect.pipe(Effect.provide(state.layer as never))).then(
				(data) => ({
					success: true,
					data,
				}),
			),
		),
	};
});

vi.mock("@/lib/effect/services/shift-request.service", async () => {
	const { Context } = await import("effect");
	return {
		ShiftRequestService: Context.GenericTag<Record<string, unknown>>(
			"ShiftRequestService",
		),
	};
});

const { ShiftRequestService } = await import(
	"@/lib/effect/services/shift-request.service"
);
const {
	approveShiftRequest,
	cancelShiftRequest,
	getPendingShiftRequests,
	rejectShiftRequest,
	requestShiftPickup,
	requestShiftSwap,
} = await import("./shift-request-actions");

describe("shift request action trusted context", () => {
	beforeEach(() => {
		for (const mock of [
			state.requestSwap,
			state.requestPickup,
			state.approveRequest,
			state.rejectRequest,
			state.cancelRequest,
			state.getPendingRequests,
		]) {
			mock.mockReset();
			mock.mockReturnValue(Effect.succeed({ id: "request-1" }));
		}
		state.layer = Layer.succeed(
			ShiftRequestService,
			ShiftRequestService.of({
				requestSwap: state.requestSwap,
				requestPickup: state.requestPickup,
				approveRequest: state.approveRequest,
				rejectRequest: state.rejectRequest,
				cancelRequest: state.cancelRequest,
				getPendingRequests: state.getPendingRequests,
			}),
		);
	});

	it("forwards trusted organization and employee context for creation", async () => {
		await requestShiftSwap({
			shiftId: "shift-client",
			targetEmployeeId: "target-client",
			notes: "Cover me",
		});
		await requestShiftPickup("shift-open", "Available");

		expect(state.requestSwap).toHaveBeenCalledWith("org-trusted", {
			shiftId: "shift-client",
			requesterId: "employee-trusted",
			targetEmployeeId: "target-client",
			reason: undefined,
			reasonCategory: undefined,
			notes: "Cover me",
		});
		expect(state.requestPickup).toHaveBeenCalledWith("org-trusted", {
			shiftId: "shift-open",
			requesterId: "employee-trusted",
			notes: "Available",
		});
	});

	it("forwards trusted organization and manager context for decisions", async () => {
		await approveShiftRequest("request-approve");
		await rejectShiftRequest("request-reject", "No coverage");

		expect(state.approveRequest).toHaveBeenCalledWith(
			"org-trusted",
			"request-approve",
			"employee-trusted",
		);
		expect(state.rejectRequest).toHaveBeenCalledWith(
			"org-trusted",
			"request-reject",
			"employee-trusted",
			"No coverage",
		);
	});

	it("uses the trusted employee rather than the session user for cancellation", async () => {
		state.cancelRequest.mockReturnValue(Effect.void);
		await cancelShiftRequest("request-cancel");

		expect(state.cancelRequest).toHaveBeenCalledWith(
			"org-trusted",
			"request-cancel",
			"employee-trusted",
		);
	});

	it("passes organization scope to pending request reads", async () => {
		state.getPendingRequests.mockReturnValue(Effect.succeed([]));
		await getPendingShiftRequests();

		expect(state.getPendingRequests).toHaveBeenCalledWith(
			"org-trusted",
			"employee-trusted",
		);
	});

	it("serializes pending request employee relations without sensitive fields", async () => {
		state.getPendingRequests.mockReturnValue(
			Effect.succeed([
				{
					id: "request-1",
					requester: {
						id: "employee-requester",
						firstName: "Riley",
						lastName: "Requester",
					},
					targetEmployee: {
						id: "employee-target",
						firstName: "Taylor",
						lastName: "Target",
					},
					shift: {
						id: "shift-1",
						employee: {
							id: "employee-requester",
							firstName: "Riley",
							lastName: "Requester",
						},
					},
				},
			]),
		);

		const result = await getPendingShiftRequests();
		const serialized = JSON.stringify(result);

		expect(serialized).toContain('"firstName":"Riley"');
		expect(serialized).toContain('"firstName":"Taylor"');
		expect(serialized).not.toMatch(
			/birthday|currentHourlyRate|employeeNumber|userId/,
		);
	});
});
