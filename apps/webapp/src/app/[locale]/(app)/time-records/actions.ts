"use server";

import { Cause, Effect, Exit, Option } from "effect";
import { DateTime } from "luxon";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { TimeRecordService, TimeRecordServiceLive } from "@/lib/effect/services/time-record.service";
import type { CreateTimeRecordInput, ListTimeRecordsFilters, TimeRecord } from "./types";

const hasElevatedRecordScope = (role: string) => role === "manager" || role === "admin";

function parseIsoDate(value: string, fieldName: string): ServerActionResult<Date> {
	const parsed = DateTime.fromISO(value, { setZone: true });
	if (!parsed.isValid) {
		return { success: false, error: `${fieldName} must be a valid ISO datetime` };
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

async function runTimeRecordEffect<T>(
	effect: Effect.Effect<T, unknown, never>,
): Promise<ServerActionResult<T>> {
	const exit = await Effect.runPromiseExit(
		effect.pipe(Effect.provide(TimeRecordServiceLive), Effect.provide(DatabaseServiceLive)),
	);

	if (Exit.isSuccess(exit)) {
		return { success: true, data: exit.value };
	}

	const failure = Option.getOrNull(Cause.failureOption(exit.cause));
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

export async function createTimeRecord(
	input: CreateTimeRecordInput,
): Promise<ServerActionResult<TimeRecord>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const isElevated = hasElevatedRecordScope(authContext.employee.role);
		if (!isElevated && input.employeeId !== authContext.employee.id) {
			return { success: false, error: "Forbidden" };
		}

		const startAtResult = parseIsoDate(input.startAt, "startAt");
		if (!startAtResult.success) {
			return startAtResult;
		}

		const endAtResult = parseOptionalIsoDate(input.endAt, "endAt");
		if (!endAtResult.success) {
			return endAtResult;
		}

		return await runTimeRecordEffect(
			Effect.gen(function* (_) {
				const service = yield* _(TimeRecordService);
				return yield* _(
					service.create({
						organizationId: authContext.employee.organizationId,
						employeeId: input.employeeId,
						recordKind: input.recordKind,
						startAt: startAtResult.data,
						endAt: endAtResult.data,
						durationMinutes: input.durationMinutes,
						approvalState: input.approvalState,
						origin: input.origin,
						createdBy: authContext.user.id,
						updatedBy: authContext.user.id,
					}),
				);
			}),
		);
	} catch (_error) {
		return { success: false, error: "Failed to create time record" };
	}
}

export async function listTimeRecords(
	filters: ListTimeRecordsFilters = {},
): Promise<ServerActionResult<TimeRecord[]>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const isElevated = hasElevatedRecordScope(authContext.employee.role);
		if (!isElevated && filters.employeeId && filters.employeeId !== authContext.employee.id) {
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
			Effect.gen(function* (_) {
				const service = yield* _(TimeRecordService);
				return yield* _(
					service.listByOrganization(authContext.employee.organizationId, {
						employeeId: isElevated ? filters.employeeId : authContext.employee.id,
						recordKind: filters.recordKind,
						startAtFrom: startAtFromResult.data,
						startAtTo: startAtToResult.data,
						limit: filters.limit,
					}),
				);
			}),
		);
	} catch (_error) {
		return { success: false, error: "Failed to list time records" };
	}
}
