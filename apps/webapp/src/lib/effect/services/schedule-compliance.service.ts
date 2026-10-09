import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { schedulePublishComplianceAck, shift, workPeriod } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, instantFromDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseError } from "@/lib/effect/errors";
import { evaluateScheduleCompliance } from "@/lib/scheduling/compliance/schedule-compliance-evaluator";
import type {
	EmployeeScheduleComplianceInput,
	ScheduleComplianceRegulation,
	ScheduleComplianceResult,
	ScheduleComplianceWindow,
} from "@/lib/scheduling/compliance/types";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
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

interface Interval {
	start: DateTime;
	end: DateTime;
}

function addMinutes(target: Record<string, number>, dayKey: string | null, minutes: number): void {
	if (!dayKey || minutes <= 0) {
		return;
	}
	target[dayKey] = (target[dayKey] ?? 0) + minutes;
}

function normalizeRegulation(
	regulation: {
		minRestPeriodMinutes: number | null;
		maxDailyMinutes: number | null;
		overtimeDailyThresholdMinutes: number | null;
		overtimeWeeklyThresholdMinutes: number | null;
		overtimeMonthlyThresholdMinutes: number | null;
	} | null,
): ScheduleComplianceRegulation {
	if (!regulation) {
		return {};
	}

	return {
		...(regulation.minRestPeriodMinutes != null
			? { minRestPeriodMinutes: regulation.minRestPeriodMinutes }
			: {}),
		...(regulation.maxDailyMinutes != null ? { maxDailyMinutes: regulation.maxDailyMinutes } : {}),
		...(regulation.overtimeDailyThresholdMinutes != null
			? {
					overtimeDailyThresholdMinutes: regulation.overtimeDailyThresholdMinutes,
				}
			: {}),
		...(regulation.overtimeWeeklyThresholdMinutes != null
			? {
					overtimeWeeklyThresholdMinutes: regulation.overtimeWeeklyThresholdMinutes,
				}
			: {}),
		...(regulation.overtimeMonthlyThresholdMinutes != null
			? {
					overtimeMonthlyThresholdMinutes: regulation.overtimeMonthlyThresholdMinutes,
				}
			: {}),
	};
}

function toShiftInterval(params: {
	date: Date;
	startTime: string;
	endTime: string;
	timezone: string;
}): Interval | null {
	const baseDate = shiftCalendarDate(params.date, params.timezone).toString();

	const start = DateTime.fromISO(`${baseDate}T${params.startTime}`, {
		zone: params.timezone,
	});
	let end = DateTime.fromISO(`${baseDate}T${params.endTime}`, {
		zone: params.timezone,
	});

	if (!start.isValid || !end.isValid) {
		return null;
	}

	if (end <= start) {
		end = end.plus({ days: 1 });
	}

	return { start, end };
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
							: normalizeRegulation(
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

					const employees: EmployeeScheduleComplianceInput[] = employeeIds.map((employeeId) => {
						const actualMinutesByDay: Record<string, number> = {};
						const scheduledMinutesByDay: Record<string, number> = {};
						const intervals: Interval[] = [];

						for (const employeePeriod of periodsByEmployee.get(employeeId) ?? []) {
							const endTime = employeePeriod.endTime;
							if (!endTime) {
								continue;
							}
							const start = DateTime.fromJSDate(employeePeriod.startTime).setZone(input.timezone);
							const end = DateTime.fromJSDate(endTime).setZone(input.timezone);
							const minutes =
								employeePeriod.durationMinutes ??
								Math.max(0, Math.round(end.diff(start, "minutes").minutes));

							addMinutes(actualMinutesByDay, start.toISODate(), minutes);
							intervals.push({ start, end });
						}

						for (const employeeShift of shiftsByEmployee.get(employeeId) ?? []) {
							const interval = toShiftInterval({
								date: employeeShift.date,
								startTime: employeeShift.startTime,
								endTime: employeeShift.endTime,
								timezone: input.timezone,
							});

							if (!interval) {
								continue;
							}

							const minutes = Math.max(
								0,
								Math.round(interval.end.diff(interval.start, "minutes").minutes),
							);
							addMinutes(scheduledMinutesByDay, interval.start.toISODate(), minutes);
							intervals.push(interval);
						}

						intervals.sort((a, b) => a.start.toMillis() - b.start.toMillis());

						const restTransitions: EmployeeScheduleComplianceInput["restTransitions"] = [];
						for (let index = 1; index < intervals.length; index++) {
							const previous = intervals[index - 1];
							const current = intervals[index];
							// The evaluator judges only transitions into the window.
							if (current.start > previous.end) {
								restTransitions.push({
									fromEndIso: previous.end.toISO() ?? previous.end.toUTC().toISO() ?? "",
									toStartIso: current.start.toISO() ?? current.start.toUTC().toISO() ?? "",
								});
							}
						}

						return {
							employeeId,
							actualMinutesByDay,
							scheduledMinutesByDay,
							restTransitions,
						};
					});

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
