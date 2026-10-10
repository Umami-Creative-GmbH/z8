import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { schedulePublishComplianceAck, shift, workPeriod } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, instantFromDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseError } from "@/lib/effect/errors";
import {
	buildEmployeeComplianceInput,
	normalizeScheduleComplianceRegulation,
} from "@/lib/scheduling/compliance/employee-compliance-input";
import { evaluateScheduleCompliance } from "@/lib/scheduling/compliance/schedule-compliance-evaluator";
import type {
	EmployeeScheduleComplianceInput,
	ScheduleComplianceResult,
	ScheduleComplianceWindow,
} from "@/lib/scheduling/compliance/types";
import { DatabaseService } from "./database.service";
import { WorkPolicyService } from "./work-policy.service";

/**
 * The half-open window `[startDate, endDateExclusive)`, both at organization-local midnight in
 * `timezone`. Only shifts, work periods and rest transitions on the window's days are judged.
 */
export interface EvaluateScheduleWindowInput {
	organizationId: string;
	startDate: Date;
	endDateExclusive: Date;
	timezone: string;
}

export interface EvaluateScheduleWindowResult extends ScheduleComplianceResult {
	organizationId: string;
	fingerprint: string;
}

export interface RecordPublishAcknowledgmentInput {
	organizationId: string;
	actorEmployeeId: string;
	publishedRangeStart: Date;
	publishedRangeEnd: Date;
	warningCountTotal: number;
	warningCountsByType: Record<string, number>;
	evaluationFingerprint: string;
}

function buildFingerprint(params: {
	organizationId: string;
	startDate: Date;
	endDateExclusive: Date;
	timezone: string;
	result: ScheduleComplianceResult;
}): string {
	const normalizedFindings = [...params.result.findings]
		.map((finding) => ({ ...finding }))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

	const payload = {
		organizationId: params.organizationId,
		startDate: params.startDate.toISOString(),
		endDateExclusive: params.endDateExclusive.toISOString(),
		timezone: params.timezone,
		summary: params.result.summary,
		findings: normalizedFindings,
	};

	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function toSortedJson(value: Record<string, number>): string {
	const keys = Object.keys(value).sort();
	const stable: Record<string, number> = {};
	for (const key of keys) {
		stable[key] = value[key] ?? 0;
	}
	return JSON.stringify(stable);
}

export class ScheduleComplianceService extends Context.Service<
	ScheduleComplianceService,
	{
		readonly evaluateScheduleWindow: (
			input: EvaluateScheduleWindowInput,
		) => Effect.Effect<EvaluateScheduleWindowResult, DatabaseError>;
		readonly recordPublishAcknowledgment: (
			input: RecordPublishAcknowledgmentInput,
		) => Effect.Effect<void, DatabaseError>;
	}
>()("ScheduleComplianceService") {}

export const ScheduleComplianceServiceLive = Layer.effect(
	ScheduleComplianceService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const workPolicyService = yield* WorkPolicyService;

		return ScheduleComplianceService.of({
			evaluateScheduleWindow: (input) =>
				Effect.gen(function* () {
					const assignedShifts = yield* dbService.query(
						"getAssignedShiftsForScheduleCompliance",
						async () => {
							return await dbService.db.query.shift.findMany({
								where: and(
									eq(shift.organizationId, input.organizationId),
									gte(shift.date, input.startDate),
									lt(shift.date, input.endDateExclusive),
									isNotNull(shift.employeeId),
								),
								columns: {
									employeeId: true,
									date: true,
									startTime: true,
									endTime: true,
								},
							});
						},
					);

					const employeeIds = Array.from(
						new Set(
							assignedShifts.flatMap((scheduledShift) =>
								scheduledShift.employeeId ? [scheduledShift.employeeId] : [],
							),
						),
					).toSorted();

					const window: ScheduleComplianceWindow = {
						start: plainDateAt(instantFromDate(input.startDate), input.timezone),
						endExclusive: plainDateAt(instantFromDate(input.endDateExclusive), input.timezone),
					};
					// Lookback gives weekly/monthly totals and the first rest gap their history.
					const lookbackStart = dateFromInstant(
						localDayRange(window.start.subtract({ days: 35 }).toString(), input.timezone).start,
					);

					const periods =
						employeeIds.length === 0
							? []
							: yield* dbService.query("getWorkPeriodsForScheduleCompliance", async () => {
									return await dbService.db.query.workPeriod.findMany({
										where: and(
											eq(workPeriod.organizationId, input.organizationId),
											inArray(workPeriod.employeeId, employeeIds),
											gte(workPeriod.startTime, lookbackStart),
											lt(workPeriod.startTime, input.endDateExclusive),
											isNotNull(workPeriod.endTime),
										),
										columns: {
											employeeId: true,
											startTime: true,
											endTime: true,
											durationMinutes: true,
										},
									});
								});

					const effectiveRegulation =
						employeeIds.length === 0
							? {}
							: normalizeScheduleComplianceRegulation(
									(yield* Effect.forEach(employeeIds, (employeeId) =>
										workPolicyService
											.getEffectivePolicy(employeeId)
											.pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null))),
									)).find((policy) => policy?.regulation)?.regulation ?? null,
								);

					const shiftsByEmployee = new Map<string, typeof assignedShifts>();
					for (const scheduledShift of assignedShifts) {
						if (!scheduledShift.employeeId) {
							continue;
						}
						const existing = shiftsByEmployee.get(scheduledShift.employeeId) ?? [];
						existing.push(scheduledShift);
						shiftsByEmployee.set(scheduledShift.employeeId, existing);
					}

					const periodsByEmployee = new Map<string, typeof periods>();
					for (const period of periods) {
						const existing = periodsByEmployee.get(period.employeeId) ?? [];
						existing.push(period);
						periodsByEmployee.set(period.employeeId, existing);
					}

					const employees: EmployeeScheduleComplianceInput[] = employeeIds.map((employeeId) =>
						buildEmployeeComplianceInput({
							employeeId,
							shifts: shiftsByEmployee.get(employeeId) ?? [],
							workPeriods: periodsByEmployee.get(employeeId) ?? [],
							timezone: input.timezone,
						}),
					);

					const evaluationResult = evaluateScheduleCompliance({
						timezone: input.timezone,
						window,
						regulation: effectiveRegulation,
						employees,
					});

					return {
						organizationId: input.organizationId,
						...evaluationResult,
						fingerprint: buildFingerprint({
							organizationId: input.organizationId,
							startDate: input.startDate,
							endDateExclusive: input.endDateExclusive,
							timezone: input.timezone,
							result: evaluationResult,
						}),
					};
				}),

			recordPublishAcknowledgment: (input) =>
				dbService.query("recordSchedulePublishComplianceAcknowledgment", async () => {
					await dbService.db.insert(schedulePublishComplianceAck).values({
						organizationId: input.organizationId,
						actorEmployeeId: input.actorEmployeeId,
						publishedRangeStart: input.publishedRangeStart,
						publishedRangeEnd: input.publishedRangeEnd,
						warningCountTotal: input.warningCountTotal,
						warningCountsByType: toSortedJson(input.warningCountsByType),
						evaluationFingerprint: input.evaluationFingerprint,
					});
				}),
		});
	}),
);
