"use server";

import { Effect, Exit } from "effect";
import { DateTime } from "luxon";
import { getAuthContext } from "@/lib/auth-helpers";
import { typedFailureOfCause } from "@/lib/effect/cause-failure";
import type { ServerActionResult } from "@/lib/effect/result";
import { runtime } from "@/lib/effect/runtime";
import type { DatabaseService } from "@/lib/effect/services/database.service";
import {
	TimeRecordService,
	TimeRecordServiceLive,
} from "@/lib/effect/services/time-record.service";
import type { ListTimeRecordsFilters, TimeRecord } from "./types";

const hasElevatedRecordScope = (role: string) => role === "manager" || role === "admin";

function parseIsoDate(value: string, fieldName: string): ServerActionResult<Date> {
	const parsed = DateTime.fromISO(value, { setZone: true });
	if (!parsed.isValid) {
		return {
			success: false,
			error: `${fieldName} must be a valid ISO datetime`,
		};
	}

	return { success: true, data: parsed.toJSDate() };
}

function parseOptionalIsoDate(
	value: string | null | undefined,
	fieldName: string,
): ServerActionResult<Date | null | undefined> {
	if (value === undefined || value === null) {
		return { success: true, data: value };
	}

	return parseIsoDate(value, fieldName);
}

async function runTimeRecordEffect<T, E>(
	effect: Effect.Effect<T, E, TimeRecordService | DatabaseService>,
): Promise<ServerActionResult<T>> {
	const exit = await runtime.runPromiseExit(effect.pipe(Effect.provide(TimeRecordServiceLive)));

	if (Exit.isSuccess(exit)) {
		return { success: true, data: exit.value };
	}

	const failure = typedFailureOfCause(exit.cause);
	if (
		failure &&
		typeof failure === "object" &&
		"message" in failure &&
		typeof failure.message === "string"
	) {
		return { success: false, error: failure.message };
	}

	return { success: false, error: "Operation failed" };
}

export async function listTimeRecords(
	filters: ListTimeRecordsFilters = {},
): Promise<ServerActionResult<TimeRecord[]>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const currentEmployee = authContext.employee;

		const isElevated = hasElevatedRecordScope(currentEmployee.role);
		if (!isElevated && filters.employeeId && filters.employeeId !== currentEmployee.id) {
			return { success: false, error: "Forbidden" };
		}

		const startAtFromResult = parseOptionalIsoDate(filters.startAtFrom, "startAtFrom");
		if (!startAtFromResult.success) {
			return startAtFromResult;
		}

		const startAtToResult = parseOptionalIsoDate(filters.startAtTo, "startAtTo");
		if (!startAtToResult.success) {
			return startAtToResult;
		}

		return await runTimeRecordEffect(
			Effect.gen(function* () {
				const service = yield* TimeRecordService;
				return yield* service.listByOrganization(currentEmployee.organizationId, {
					employeeId: isElevated ? filters.employeeId : currentEmployee.id,
					recordKind: filters.recordKind,
					startAtFrom: startAtFromResult.data ?? undefined,
					startAtTo: startAtToResult.data ?? undefined,
					limit: filters.limit,
				});
			}),
		);
	} catch (_error) {
		return { success: false, error: "Failed to list time records" };
	}
}
