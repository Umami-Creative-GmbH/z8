import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { schedulePublishComplianceAck, shift, workPeriod } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { DatabaseError } from "@/lib/effect/errors";
import {
	buildEmployeeComplianceInput,
	normalizeScheduleComplianceRegulation,
} from "@/lib/scheduling/compliance/employee-compliance-input";
import {
	evaluateScheduleCompliance,
	summarizeComplianceFindings,
} from "@/lib/scheduling/compliance/schedule-compliance-evaluator";
import { evaluateStatutoryScheduleWindow } from "@/lib/statutory/scheduling/evaluate";
import type { DatedStatutoryFinding } from "@/lib/statutory/scheduling/findings-list";
import {
	loadExecutiveExemptDays,
	withoutExecutiveExemptFindings,
} from "@/lib/statutory/youth/executive-exempt";
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
	/**
	 * The statutory findings of `findings`, each with the period it judges, for Scheduling's
	 * findings list (#2026). Server-side: the Scheduling action scopes and names them.
	 */
	datedStatutoryFindings: DatedStatutoryFinding[];
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
	/** `statutoryPublishKey` of each statutory finding of `result`. */
	statutoryPublishKeys: readonly string[];
}): string {
	const normalizedFindings = [
		...params.result.findings.flatMap((finding) =>
			finding.type === "statutory" ? [] : [{ ...finding }],
		),
		// A statutory finding counts by what a planner acknowledges and how deep its breach goes,
		// not by its running totals. Its key is built server-side and only reaches the client hashed.
		...params.statutoryPublishKeys,
	].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

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

					const regulationResult = evaluateScheduleCompliance({
						timezone: input.timezone,
						window,
						regulation: effectiveRegulation,
						employees,
					});
					// German statutory monitors (#1988 seam): wage-free findings from each contributor.
					const statutory = yield* dbService.query("scheduleCompliance.statutory", () =>
						evaluateStatutoryScheduleWindow(dbService.db, {
							organizationId: input.organizationId,
							timezone: input.timezone,
							window: {
								start: window.start.toString(),
								endExclusive: window.endExclusive.toString(),
							},
							employeeIds,
							now: systemClock.nowInstant(),
						}),
					);
					// Executive-exempt employees are outside adult ArbZG rules (#1993).
					const exemptDays = yield* dbService.query("scheduleCompliance.executiveExempt", () =>
						loadExecutiveExemptDays(dbService.db, {
							organizationId: input.organizationId,
							employeeIds,
							from: window.start.toString(),
							until: window.endExclusive.toString(),
							timezone: input.timezone,
						}),
					);
					const statutoryFindings = statutory.findings;
					const evaluationResult =
						statutoryFindings.length === 0 && exemptDays.size === 0
							? regulationResult
							: summarizeComplianceFindings([
									...withoutExecutiveExemptFindings(
										regulationResult.findings,
										exemptDays,
										input.timezone,
									),
									...statutoryFindings,
								]);

					return {
						organizationId: input.organizationId,
						...evaluationResult,
						fingerprint: buildFingerprint({
							organizationId: input.organizationId,
							startDate: input.startDate,
							endDateExclusive: input.endDateExclusive,
							timezone: input.timezone,
							result: evaluationResult,
							statutoryPublishKeys: statutory.publishKeys,
						}),
						datedStatutoryFindings: statutoryFindings.map((finding, index) => ({
							finding,
							period: statutory.periods[index] ?? null,
						})),
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
