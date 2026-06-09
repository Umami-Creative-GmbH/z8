import { and, eq, gte, isNull, lte, not, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import type { SurchargeCalculationDetails } from "@/db/schema";
import { employee, project, surchargeCalculation, timeEntry, workPeriod } from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import type { SurchargeBreakdown, WorkPeriodEvent } from "./types";

const clockInEntry = alias(timeEntry, "clock_in_entry");
const clockOutEntry = alias(timeEntry, "clock_out_entry");

interface WorkPeriodFilters {
	organizationId: string;
	employeeId?: string;
}

export function workPeriodOverlapsCalendarMonth(
	period: { startTime: Date; endTime: Date | null; isActive: boolean },
	monthStart: Date,
	monthEnd: Date,
	now: Date,
): boolean {
	if (period.endTime) {
		return period.startTime >= monthStart && period.startTime <= monthEnd;
	}

	return period.isActive && period.startTime <= monthEnd && now >= monthStart;
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
): Promise<WorkPeriodEvent[]> {
	// Calculate date range for the month (month is 0-indexed in JavaScript, 1-indexed in Luxon)
	const zonedStart = DateTime.fromObject(
		{ year, month: month + 1, day: 1 },
		{ zone: timezone || "UTC" },
	);
	const startDT = (zonedStart.isValid ? zonedStart : DateTime.utc(year, month + 1, 1))
		.startOf("month")
		.toUTC();
	const endDT = (zonedStart.isValid ? zonedStart : DateTime.utc(year, month + 1, 1))
		.endOf("month")
		.toUTC();

	// Convert to Date objects for Drizzle query
	const startDate = dateToDB(startDT)!;
	const endDate = dateToDB(endDT)!;
	const nowDT = DateTime.utc();
	const now = nowDT.toJSDate();

	try {
		const completedPeriodDateCondition = and(
			not(isNull(workPeriod.endTime)),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		);
		const runningPeriodDateCondition = and(
			eq(workPeriod.isActive, true),
			isNull(workPeriod.endTime),
			lte(workPeriod.startTime, endDate),
		);
		const periodDateCondition =
			now >= startDate
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
				surcharge: surchargeCalculation,
				project: project,
			})
			.from(workPeriod)
			.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.leftJoin(clockInEntry, eq(workPeriod.clockInId, clockInEntry.id))
			.leftJoin(clockOutEntry, eq(workPeriod.clockOutId, clockOutEntry.id))
			.leftJoin(surchargeCalculation, eq(surchargeCalculation.workPeriodId, workPeriod.id))
			.leftJoin(project, eq(workPeriod.projectId, project.id))
			.where(and(...conditions));

		// Return individual work periods as timed events (not aggregated)
		// This allows the calendar to show work blocks at specific times
		// Breaks appear as gaps between the green work blocks
		return periods.map(
			({ period, user, clockInEntry, clockOutEntry, surcharge, project: proj }) => {
				const notes = clockOutEntry?.notes?.trim();
				const projectPrefix = proj?.name ? `[${proj.name}] ` : "";

				// Use project color if available, otherwise default green
				const eventColor = proj?.color || "#10b981"; // Green (emerald)

				// Format start and end times for display
				const startDT = dateFromDB(period.startTime);
				const endDT = period.endTime ? dateFromDB(period.endTime) : null;
				const startTimeFormatted =
					startDT?.setLocale("en-US").toLocaleString(DateTime.TIME_SIMPLE) ?? undefined;
				const endTimeFormatted =
					endDT?.setLocale("en-US").toLocaleString(DateTime.TIME_SIMPLE) ?? undefined;
				const isRunning = period.isActive && !period.endTime;

				if (isRunning) {
					const durationMinutes = Math.max(
						0,
						Math.floor(nowDT.diff(startDT ?? nowDT, "minutes").minutes),
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
					const details = surcharge.calculationDetails as SurchargeCalculationDetails;
					if (details.rulesApplied && details.rulesApplied.length > 0) {
						surchargeBreakdown = details.rulesApplied.map((rule) => ({
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
					descriptionKey: notes ? undefined : "calendar.calendar.workPeriod.fallbackDescription",
					color: eventColor,
					metadata: {
						durationMinutes,
						employeeId: period.employeeId,
						employeeName: user.name,
						notes: notes || undefined,
						startTime: startTimeFormatted,
						endTime: endTimeFormatted,
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
