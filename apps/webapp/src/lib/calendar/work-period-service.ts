import { and, eq, gt, isNull, lt, not, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import type { SurchargeCalculationDetails } from "@/db/schema";
import {
	automaticClockOutExecution,
	employee,
	project,
	surchargeCalculation,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { dateFromDB } from "@/lib/datetime/drizzle-adapter";
import { localMonthRange } from "@/lib/datetime/temporal-boundaries";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { SurchargeBreakdown, WorkPeriodEvent } from "./types";
import { resolveWorkPeriodEditedBy } from "./work-period-edited-by";

const clockInEntry = alias(timeEntry, "clock_in_entry");
const clockOutEntry = alias(timeEntry, "clock_out_entry");
const clockInEditor = alias(user, "clock_in_editor");
const clockOutEditor = alias(user, "clock_out_editor");

interface WorkPeriodFilters {
	organizationId: string;
	employeeId?: string;
}

export function workPeriodOverlapsCalendarMonth(
	period: { startTime: Date; endTime: Date | null; isActive: boolean },
	monthStart: Date,
	monthEndExclusive: Date,
	now: Date,
): boolean {
	const start = instantFromDate(period.startTime);
	const rangeStart = instantFromDate(monthStart);
	const rangeEndExclusive = instantFromDate(monthEndExclusive);

	if (period.endTime) {
		return (
			compareInstants(start, rangeEndExclusive) < 0 &&
			compareInstants(instantFromDate(period.endTime), rangeStart) > 0
		);
	}

	return (
		period.isActive &&
		compareInstants(start, rangeEndExclusive) < 0 &&
		compareInstants(instantFromDate(now), rangeStart) > 0
	);
}

/**
 * Get work periods for a specific month to display on the calendar
 * Returns individual work periods with start/end times for timed display
 * Includes completed work periods and active running periods.
 */
export async function getWorkPeriodsForMonth(
	month: number,
	year: number,
	filters: WorkPeriodFilters,
	timezone?: string | null,
	clock: Clock = systemClock,
): Promise<WorkPeriodEvent[]> {
	const range = localMonthRange(
		`${year}-${String(month + 1).padStart(2, "0")}-01`,
		timezone || "UTC",
	);
	const startDate = dateFromInstant(range.start);
	const endExclusiveDate = dateFromInstant(range.endExclusive);
	const nowInstant = clock.nowInstant();
	const now = dateFromInstant(nowInstant);

	try {
		const completedPeriodDateCondition = and(
			not(isNull(workPeriod.endTime)),
			lt(workPeriod.startTime, endExclusiveDate),
			gt(workPeriod.endTime, startDate),
		);
		const runningPeriodDateCondition = and(
			eq(workPeriod.isActive, true),
			isNull(workPeriod.endTime),
			lt(workPeriod.startTime, endExclusiveDate),
		);
		const periodDateCondition =
			compareInstants(nowInstant, range.start) > 0
				? or(completedPeriodDateCondition, runningPeriodDateCondition)
				: completedPeriodDateCondition;

		// Prepare conditions
		const conditions = [
			// Direct organization filter (no join needed for org filtering)
			eq(workPeriod.organizationId, filters.organizationId),
			isNull(workPeriod.deletedAt),
			periodDateCondition,
		];

		// Add employee filter if provided
		if (filters.employeeId) {
			conditions.push(eq(workPeriod.employeeId, filters.employeeId));
		}

		const periods = await db
			.select({
				period: workPeriod,
				employee: employee,
				user: user,
				clockInEntry,
				clockOutEntry,
				clockInEditorName: clockInEditor.name,
				clockOutEditorName: clockOutEditor.name,
				surcharge: surchargeCalculation,
				project: project,
				automaticExecution: {
					organizationId: automaticClockOutExecution.organizationId,
					employeeId: automaticClockOutExecution.employeeId,
					clockOutEntryId: automaticClockOutExecution.clockOutEntryId,
					cutoffTime: automaticClockOutExecution.cutoffTime,
					maxUninterruptedMinutes: automaticClockOutExecution.maxUninterruptedMinutes,
					processedAt: automaticClockOutExecution.processedAt,
				},
			})
			.from(workPeriod)
			.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.leftJoin(clockInEntry, eq(workPeriod.clockInId, clockInEntry.id))
			.leftJoin(clockOutEntry, eq(workPeriod.clockOutId, clockOutEntry.id))
			.leftJoin(
				automaticClockOutExecution,
				and(
					eq(automaticClockOutExecution.organizationId, workPeriod.organizationId),
					eq(automaticClockOutExecution.employeeId, workPeriod.employeeId),
					eq(automaticClockOutExecution.clockOutEntryId, workPeriod.clockOutId),
				),
			)
			.leftJoin(clockInEditor, eq(clockInEntry.createdBy, clockInEditor.id))
			.leftJoin(clockOutEditor, eq(clockOutEntry.createdBy, clockOutEditor.id))
			.leftJoin(
				surchargeCalculation,
				eq(surchargeCalculation.workPeriodId, workPeriod.id),
			)
			.leftJoin(project, eq(workPeriod.projectId, project.id))
			.where(and(...conditions));

		// Return individual work periods as timed events (not aggregated)
		// This allows the calendar to show work blocks at specific times
		// Breaks appear as gaps between the green work blocks
		return periods.map(
			({
				period,
				user,
				clockInEntry,
				clockOutEntry,
				clockInEditorName,
				clockOutEditorName,
				surcharge,
				project: proj,
				automaticExecution,
			}) => {
				const notes = clockOutEntry?.notes?.trim();
				const projectPrefix = proj?.name ? `[${proj.name}] ` : "";

				// Use project color if available, otherwise default green
				const eventColor = proj?.color || "#10b981"; // Green (emerald)

				// Format start and end times for display
				const startDT = dateFromDB(period.startTime);
				const endDT = period.endTime ? dateFromDB(period.endTime) : null;
				const startTimeFormatted =
					startDT?.setLocale("en-US").toLocaleString(DateTime.TIME_SIMPLE) ??
					undefined;
				const endTimeFormatted =
					endDT?.setLocale("en-US").toLocaleString(DateTime.TIME_SIMPLE) ??
					undefined;
				const isRunning = period.isActive && !period.endTime;

				if (isRunning) {
					const startInstant = instantFromDate(period.startTime);
					const durationMinutes = Math.max(
						0,
						Math.floor(
							nowInstant.since(startInstant).total({ unit: "minutes" }),
						),
					);

					return {
						id: period.id,
						type: "work_period" as const,
						date: period.startTime,
						endDate: now,
						title: `${projectPrefix}${user.name} - ${formatDuration(durationMinutes)} (running)`,
						description: "Running work period",
						descriptionKey: "calendar.calendar.workPeriod.runningDescription",
						color: eventColor,
						metadata: {
							durationMinutes,
							employeeId: period.employeeId,
							employeeName: user.name,
							startTime: startTimeFormatted,
							// Project fields (only included if assigned to a project)
							...(proj && {
								projectId: proj.id,
								projectName: proj.name,
								projectColor: proj.color || undefined,
							}),
							// Approval status for change policy enforcement
							approvalStatus: period.approvalStatus ?? "approved",
							...(clockInEntry && {
								clockInUtcOffsetMinutes: clockInEntry.utcOffsetMinutes,
								clockInTimezone: clockInEntry.timezone || undefined,
							}),
							isRunning: true,
						},
					};
				}

				// Historical execution remains system evidence only while its endpoint stands.
				// A start-only correction keeps the automatic clock-out and its own human audit.
				const automaticClockOut =
					automaticExecution &&
					automaticExecution.organizationId === filters.organizationId &&
					automaticExecution.organizationId === period.organizationId &&
					automaticExecution.employeeId === period.employeeId &&
					automaticExecution.clockOutEntryId === period.clockOutId &&
					clockOutEntry?.id === period.clockOutId &&
					period.endTime &&
					compareInstants(
						instantFromDate(period.endTime),
						instantFromDate(automaticExecution.cutoffTime),
					) === 0
						? {
								cutoffAt: instantFromDate(automaticExecution.cutoffTime).toString(),
								limitMinutes: automaticExecution.maxUninterruptedMinutes,
								processedAt: instantFromDate(automaticExecution.processedAt).toString(),
							}
						: undefined;
				const editedBy = resolveWorkPeriodEditedBy({
					ownerUserId: user.id,
					endpoints: [
						clockInEntry && {
							type: clockInEntry.type,
							createdBy: clockInEntry.createdBy,
							createdAt: clockInEntry.createdAt,
							editorName: clockInEditorName ?? null,
						},
						clockOutEntry && !automaticClockOut
							? {
									type: clockOutEntry.type,
									createdBy: clockOutEntry.createdBy,
									createdAt: clockOutEntry.createdAt,
									editorName: clockOutEditorName ?? null,
								}
							: null,
					],
				});
				const durationMinutes = period.durationMinutes ?? 0;
				const surchargeMinutes = surcharge?.surchargeMinutes ?? 0;
				const totalCreditedMinutes = durationMinutes + surchargeMinutes;

				// Format duration, including surcharge if present
				const baseDuration = formatDuration(durationMinutes);
				const duration =
					surchargeMinutes > 0
						? `${baseDuration} (+${formatDuration(surchargeMinutes)})`
						: baseDuration;

				// Format: "[Project] Name - 4h 30m (+1h)" or "Name - 4h 30m: Working on report"
				const title = notes
					? `${projectPrefix}${user.name} - ${duration}: ${notes}`
					: `${projectPrefix}${user.name} - ${duration}`;

				// Parse surcharge breakdown from calculation details
				let surchargeBreakdown: SurchargeBreakdown[] | undefined;
				if (surcharge?.calculationDetails) {
					const details =
						surcharge.calculationDetails as SurchargeCalculationDetails;
					if (details.rulesApplied && details.rulesApplied.length > 0) {
						surchargeBreakdown = details.rulesApplied.map((rule) => ({
							ruleId: rule.ruleId,
							ruleName: rule.ruleName,
							ruleType: rule.ruleType as SurchargeBreakdown["ruleType"],
							percentage: rule.percentage,
							qualifyingMinutes: rule.qualifyingMinutes,
							surchargeMinutes: rule.surchargeMinutes,
						}));
					}
				}

				return {
					id: period.id,
					type: "work_period" as const,
					date: period.startTime,
					endDate: period.endTime ?? undefined,
					title,
					description: notes || "Work period",
					descriptionKey: notes
						? undefined
						: "calendar.calendar.workPeriod.fallbackDescription",
					color: eventColor,
					metadata: {
						durationMinutes,
						employeeId: period.employeeId,
						employeeName: user.name,
						notes: notes || undefined,
						startTime: startTimeFormatted,
						endTime: endTimeFormatted,
						...(automaticClockOut && { automaticClockOut }),
						// Project fields (only included if assigned to a project)
						...(proj && {
							projectId: proj.id,
							projectName: proj.name,
							projectColor: proj.color || undefined,
						}),
						// Surcharge fields (only included if surcharge calculation exists)
						...(surcharge && {
							surchargeMinutes,
							totalCreditedMinutes,
							surchargeBreakdown,
						}),
						// Approval status for change policy enforcement
						approvalStatus: period.approvalStatus ?? "approved",
						...(clockInEntry && {
							clockInUtcOffsetMinutes: clockInEntry.utcOffsetMinutes,
							clockInTimezone: clockInEntry.timezone || undefined,
						}),
						...(clockOutEntry && {
							clockOutUtcOffsetMinutes: clockOutEntry.utcOffsetMinutes,
							clockOutTimezone: clockOutEntry.timezone || undefined,
						}),
						// Last edit by someone other than the employee (#507)
						...(editedBy && {
							editedByName: editedBy.editedByName,
							editedAt: editedBy.editedAt,
						}),
					},
				};
			},
		);
	} catch (error) {
		console.error("Error fetching work periods for calendar:", error);
		return [];
	}
}

/**
 * Format duration in minutes to human-readable string
 * Examples: "8h 30m", "4h", "45m"
 */
export function formatDuration(minutes: number): string {
	if (minutes < 0) return "0m";

	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;

	if (hours === 0) {
		return `${mins}m`;
	} else if (mins === 0) {
		return `${hours}h`;
	} else {
		return `${hours}h ${mins}m`;
	}
}
