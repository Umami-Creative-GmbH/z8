"use server";

import type { ServerActionResult } from "@/lib/effect/result";
import type { CreateRateHistory } from "@/lib/validations/employee";
import { createRateHistoryEntryAction } from "./rate-mutations.actions";
import { getEmployeeRateHistoryAction, getRateAtDateAction } from "./rate-queries.actions";
import type { RateHistoryEntry } from "./rate-action-types";

export type { RateHistoryEntry } from "./rate-action-types";

export async function getEmployeeRateHistory(
	employeeId: string,
): Promise<ServerActionResult<RateHistoryEntry[]>> {
	return getEmployeeRateHistoryAction(employeeId);
}

export async function createRateHistoryEntry(
	employeeId: string,
	data: CreateRateHistory,
): Promise<ServerActionResult<void>> {
	return createRateHistoryEntryAction(employeeId, data);
}

export async function getRateAtDate(
	employeeId: string,
	date: Date,
): Promise<ServerActionResult<RateHistoryEntry | null>> {
	return getRateAtDateAction(employeeId, date);
}
