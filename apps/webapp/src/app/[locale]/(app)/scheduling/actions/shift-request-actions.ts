"use server";

import { Effect } from "effect";
import {
	ShiftRequestService,
	type ShiftRequestWithRelations,
} from "@/lib/effect/services/shift-request.service";
import type { ShiftRequest, SwapRequestInput } from "../types";
import {
	requireCurrentEmployee,
	requireManagerEmployee,
	runSchedulingAction,
	type SchedulingActionResult,
} from "./shared";

export async function requestShiftSwap(
	input: SwapRequestInput,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const shiftRequestService = yield* _(ShiftRequestService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		return yield* _(
			shiftRequestService.requestSwap({
				shiftId: input.shiftId,
				requesterId: currentEmployee.id,
				targetEmployeeId: input.targetEmployeeId,
				reason: input.reason,
				reasonCategory: input.reasonCategory,
				notes: input.notes,
			}),
		);
	});

	return runSchedulingAction("requestShiftSwap", effect);
}

export async function requestShiftPickup(
	shiftId: string,
	notes?: string,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const shiftRequestService = yield* _(ShiftRequestService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		return yield* _(
			shiftRequestService.requestPickup({
				shiftId,
				requesterId: currentEmployee.id,
				notes,
			}),
		);
	});

	return runSchedulingAction("requestShiftPickup", effect);
}

export async function approveShiftRequest(
	requestId: string,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const shiftRequestService = yield* _(ShiftRequestService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		return yield* _(shiftRequestService.approveRequest(requestId, currentEmployee.id));
	});

	return runSchedulingAction("approveShiftRequest", effect);
}

export async function rejectShiftRequest(
	requestId: string,
	reason?: string,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* (_) {
		const shiftRequestService = yield* _(ShiftRequestService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		return yield* _(shiftRequestService.rejectRequest(requestId, currentEmployee.id, reason));
	});

	return runSchedulingAction("rejectShiftRequest", effect);
}

export async function cancelShiftRequest(requestId: string): Promise<SchedulingActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const shiftRequestService = yield* _(ShiftRequestService);
		const { session } = yield* _(requireCurrentEmployee("getCurrentEmployeeForCancelShiftRequest"));

		yield* _(shiftRequestService.cancelRequest(requestId, session.user.id));
	});

	return runSchedulingAction("cancelShiftRequest", effect);
}

export async function getPendingShiftRequests(): Promise<
	SchedulingActionResult<ShiftRequestWithRelations[]>
> {
	const effect = Effect.gen(function* (_) {
		const shiftRequestService = yield* _(ShiftRequestService);
		const { currentEmployee } = yield* _(
			requireManagerEmployee({
				resource: "shiftRequest",
				action: "read",
				message: "Only managers and admins can view pending requests",
			}),
		);

		return yield* _(shiftRequestService.getPendingRequests(currentEmployee.id));
	});

	return runSchedulingAction("getPendingShiftRequests", effect);
}
