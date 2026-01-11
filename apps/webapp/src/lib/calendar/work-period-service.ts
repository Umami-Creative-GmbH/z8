import { and, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, project, surchargeCalculation, timeEntry, workPeriod } from "@/db/schema";
import type { SurchargeCalculationDetails } from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { toDateKey } from "@/lib/datetime/luxon-utils";
import type { SurchargeBreakdown, WorkPeriodEvent } from "./types";

interface WorkPeriodFilters {
	organizationId: string;
	employeeId?: string;
}

/**
 * Get work periods for a specific month to display on the calendar
 * Returns individual work periods with start/end times for timed display
 * Only includes completed work periods (isActive = false)
 */
export async function getWorkPeriodsForMonth(
	month: number,
	year: number,
	filters: WorkPeriodFilters,
): Promise<WorkPeriodEvent[]> {
	// Calculate date range for the month (month is 0-indexed in JavaScript, 1-indexed in Luxon)
	const startDT = DateTime.utc(year, month + 1, 1).startOf("day");
	const endDT = startDT.endOf("month");

	// Convert to Date objects for Drizzle query
	const startDate = dateToDB(startDT)!;
	const endDate = dateToDB(endDT)!;

	try {
		// Prepare conditions
		const conditions = [
			// Organization filter via employee
			eq(employee.organizationId, filters.organizationId),
			// Date range filter
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
			// Only completed work periods
			eq(workPeriod.isActive, false),
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
				clockOutEntry: timeEntry,
				surcharge: surchargeCalculation,
				project: project,
			})
			.from(workPeriod)
			.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.leftJoin(timeEntry, eq(workPeriod.clockOutId, timeEntry.id))
			.leftJoin(surchargeCalculation, eq(surchargeCalculation.workPeriodId, workPeriod.id))
			.leftJoin(project, eq(workPeriod.projectId, project.id))
			.where(and(...conditions));

		// Return individual work periods as timed events (not aggregated)
		// This allows the calendar to show work blocks at specific times
		// Breaks appear as gaps between the green work blocks
		return periods.map(({ period, user, clockOutEntry, surcharge, project: proj }) => {
			const notes = clockOutEntry?.notes?.trim();
			const durationMinutes = period.durationMinutes ?? 0;
			const surchargeMinutes = surcharge?.surchargeMinutes ?? 0;
			const totalCreditedMinutes = durationMinutes + surchargeMinutes;

			// Format duration, including surcharge if present
			const baseDuration = formatDuration(durationMinutes);
			const duration = surchargeMinutes > 0
				? `${baseDuration} (+${formatDuration(surchargeMinutes)})`
				: baseDuration;

			// Build title parts
			const projectPrefix = proj?.name ? `[${proj.name}] ` : "";
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

			// Use project color if available, otherwise default green
			const eventColor = proj?.color || "#10b981"; // Green (emerald)

			return {
				id: period.id,
				type: "work_period" as const,
				date: period.startTime,
				endDate: period.endTime ?? undefined,
				title,
				description: notes || "Work period",
				color: eventColor,
				metadata: {
					durationMinutes,
					employeeName: user.name,
					notes: notes || undefined,
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
				},
			};
		});
	} catch (error) {
		console.error("Error fetching work periods for calendar:", error);
		return [];
	}
}

/**
 * Aggregate work periods by day and employee
 */
function aggregateByDay(
	periods: Array<{
		period: typeof workPeriod.$inferSelect;
		employee: typeof employee.$inferSelect;
		user: typeof user.$inferSelect;
	}>,
): WorkPeriodEvent[] {
	// Group by date (YYYY-MM-DD) and employee ID
	const grouped = new Map<
		string,
		{
			employeeId: string;
			employeeName: string;
			date: Date;
			totalMinutes: number;
			periodCount: number;
		}
	>();

	for (const { period, user } of periods) {
		if (!period.durationMinutes) continue; // Skip if no duration

		// Get date key (YYYY-MM-DD) using Luxon
		const startDT = dateFromDB(period.startTime);
		if (!startDT) continue;

		const dateKey = toDateKey(startDT);
		const groupKey = `${dateKey}_${period.employeeId}`;

		if (!grouped.has(groupKey)) {
			grouped.set(groupKey, {
				employeeId: period.employeeId,
				employeeName: user.name,
				date: period.startTime, // Keep as Date for now (interface compatibility)
				totalMinutes: 0,
				periodCount: 0,
			});
		}

		const group = grouped.get(groupKey)!;
		group.totalMinutes += period.durationMinutes;
		group.periodCount += 1;
	}

	// Transform to WorkPeriodEvent objects
	return Array.from(grouped.values()).map((group) => {
		const dateDT = dateFromDB(group.date);
		const dateKey = dateDT ? toDateKey(dateDT) : group.date.toISOString().split("T")[0];

		return {
			id: `${dateKey}_${group.employeeId}`,
			type: "work_period" as const,
			date: group.date,
			title: `${group.employeeName} - ${formatDuration(group.totalMinutes)}`,
			description: `${group.periodCount} work ${group.periodCount === 1 ? "period" : "periods"}`,
			color: "#6366f1", // Indigo-500
			metadata: {
				durationMinutes: group.totalMinutes,
				employeeName: group.employeeName,
				periodCount: group.periodCount,
			},
		};
	});
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
