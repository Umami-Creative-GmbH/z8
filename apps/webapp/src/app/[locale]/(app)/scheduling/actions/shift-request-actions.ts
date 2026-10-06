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
	const effect = Effect.gen(function* () {
		const shiftRequestService = yield* ShiftRequestService;
		const { currentEmployee } = yield* requireCurrentEmployee();

		return yield* shiftRequestService.requestSwap(
			currentEmployee.organizationId,
			{
				shiftId: input.shiftId,
				requesterId: currentEmployee.id,
				targetEmployeeId: input.targetEmployeeId,
				reason: input.reason,
				reasonCategory: input.reasonCategory,
				notes: input.notes,
			},
		);
	});

	return runSchedulingAction("requestShiftSwap", effect);
}

export async function requestShiftPickup(
	shiftId: string,
	notes?: string,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* () {
		const shiftRequestService = yield* ShiftRequestService;
		const { currentEmployee } = yield* requireCurrentEmployee();

		return yield* shiftRequestService.requestPickup(
			currentEmployee.organizationId,
			{
				shiftId,
				requesterId: currentEmployee.id,
				notes,
			},
		);
	});

	return runSchedulingAction("requestShiftPickup", effect);
}

export async function approveShiftRequest(
	requestId: string,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* () {
		const shiftRequestService = yield* ShiftRequestService;
		const { currentEmployee } = yield* requireManagerEmployee({
			resource: "shiftRequest",
			action: "approve",
			message: "Only managers and admins can approve shift requests",
		});

		return yield* shiftRequestService.approveRequest(
			currentEmployee.organizationId,
			requestId,
			currentEmployee.id,
		);
	});

	return runSchedulingAction("approveShiftRequest", effect);
}

export async function rejectShiftRequest(
	requestId: string,
	reason?: string,
): Promise<SchedulingActionResult<ShiftRequest>> {
	const effect = Effect.gen(function* () {
		const shiftRequestService = yield* ShiftRequestService;
		const { currentEmployee } = yield* requireManagerEmployee({
			resource: "shiftRequest",
			action: "reject",
			message: "Only managers and admins can reject shift requests",
		});

		return yield* shiftRequestService.rejectRequest(
			currentEmployee.organizationId,
			requestId,
			currentEmployee.id,
			reason,
		);
	});

	return runSchedulingAction("rejectShiftRequest", effect);
}

export async function cancelShiftRequest(
	requestId: string,
): Promise<SchedulingActionResult<void>> {
	const effect = Effect.gen(function* () {
		const shiftRequestService = yield* ShiftRequestService;
		const { currentEmployee } = yield* requireCurrentEmployee(
			"getCurrentEmployeeForCancelShiftRequest",
		);

		yield* shiftRequestService.cancelRequest(
			currentEmployee.organizationId,
			requestId,
			currentEmployee.id,
		);
	});

	return runSchedulingAction("cancelShiftRequest", effect);
}

export async function getPendingShiftRequests(): Promise<
	SchedulingActionResult<ShiftRequestWithRelations[]>
> {
	const effect = Effect.gen(function* () {
		const shiftRequestService = yield* ShiftRequestService;
		const { currentEmployee } = yield* requireManagerEmployee({
			resource: "shiftRequest",
			action: "read",
			message: "Only managers and admins can view pending requests",
		});

		return yield* shiftRequestService.getPendingRequests(
			currentEmployee.organizationId,
			currentEmployee.id,
		);
	});

	return runSchedulingAction("getPendingShiftRequests", effect);
}
