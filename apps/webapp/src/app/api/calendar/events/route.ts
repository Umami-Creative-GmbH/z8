import { DateTime } from "luxon";
import { connection, type NextRequest, NextResponse } from "next/server";
import { getVerifiedOrgContext } from "@/lib/auth-helpers";
import { getAbsencesForMonth } from "@/lib/calendar/absence-service";
import { getHolidaysForMonth } from "@/lib/calendar/holiday-service";
import { getTimeEntriesForMonth } from "@/lib/calendar/time-entry-service";
import type {
	CalendarEvent,
	DailyWorkActualMinutes,
	DailyWorkRequirements,
} from "@/lib/calendar/types";
import { buildDailyActualMinutes } from "@/lib/calendar/work-hours-summary";
import { getWorkPeriodsForMonth } from "@/lib/calendar/work-period-service";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { superJsonResponse } from "@/lib/superjson";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

function canViewOrganizationWideCalendar(role: string | null): boolean {
	return role === "admin" || role === "manager";
}

/**
 * Fetch events for a single month
 * Uses Promise.all for parallel fetching to eliminate waterfalls
 */
async function fetchMonthEvents(
	organizationId: string,
	month: number,
	year: number,
	employeeId: string | undefined,
	showHolidays: boolean,
	showAbsences: boolean,
	showTimeEntries: boolean,
	showWorkPeriods: boolean,
	includeWorkPeriodActuals: boolean,
): Promise<{ events: CalendarEvent[]; dailyActualMinutes: DailyWorkActualMinutes }> {
	// Fetch all event types in parallel - conditional fetches return empty arrays
	const [holidays, absences, timeEntries, workPeriods] = await Promise.all([
		showHolidays ? getHolidaysForMonth(organizationId, month, year) : [],
		showAbsences ? getAbsencesForMonth(month, year, { organizationId, employeeId }) : [],
		showTimeEntries ? getTimeEntriesForMonth(month, year, { organizationId, employeeId }) : [],
		showWorkPeriods || includeWorkPeriodActuals
			? getWorkPeriodsForMonth(month, year, { organizationId, employeeId })
			: [],
	]);

	return {
		events: [...holidays, ...absences, ...timeEntries, ...(showWorkPeriods ? workPeriods : [])],
		dailyActualMinutes: includeWorkPeriodActuals ? buildDailyActualMinutes(workPeriods) : {},
	};
}

function getRequestDateRange(year: number, month: number | null, fullYear: boolean) {
	const start = fullYear
		? DateTime.utc(year, 1, 1).startOf("day")
		: DateTime.utc(year, (month ?? 0) + 1, 1).startOf("day");
	const end = fullYear ? start.endOf("year") : start.endOf("month");

	return {
		startDate: start.toJSDate(),
		endDate: end.toJSDate(),
	};
}

async function fetchDailyRequirements(params: {
	organizationId: string;
	employeeId: string | undefined;
	startDate: Date;
	endDate: Date;
}): Promise<DailyWorkRequirements> {
	if (!params.employeeId) return {};
	const employeeId = params.employeeId;

	try {
		return await getDailyWorkRequirementsForEmployee({
			organizationId: params.organizationId,
			employeeId,
			startDate: params.startDate,
			endDate: params.endDate,
		});
	} catch (error) {
		console.error("Error fetching calendar work policy requirements:", error);
		return {};
	}
}

async function fetchWorkBalance(params: {
	organizationId: string;
	employeeId: string | undefined;
}): Promise<EmployeeWorkBalancePayload | null> {
	if (!params.employeeId) return null;
	const employeeId = params.employeeId;

	try {
		return await getEmployeeWorkBalance({
			organizationId: params.organizationId,
			employeeId,
		});
	} catch (error) {
		console.error("Error fetching calendar work balance:", error);
		return null;
	}
}

export async function GET(request: NextRequest) {
	await connection();
	try {
		// Parse query parameters
		const searchParams = request.nextUrl.searchParams;
		const requestedOrgId = searchParams.get("organizationId");
		const month = searchParams.get("month");
		const year = searchParams.get("year");
		const fullYear = searchParams.get("fullYear") === "true"; // Fetch all 12 months
		const employeeId = searchParams.get("employeeId") || undefined;
		const showHolidays = searchParams.get("showHolidays") === "true";
		const showAbsences = searchParams.get("showAbsences") === "true";
		const showTimeEntries = searchParams.get("showTimeEntries") === "true";
		const showWorkPeriods = searchParams.get("showWorkPeriods") === "true";

		// SECURITY: Verify user is authenticated AND a member of the requested organization
		const orgContext = await getVerifiedOrgContext(requestedOrgId);
		if (!orgContext) {
			return NextResponse.json(
				{ error: "Forbidden: Not a member of this organization" },
				{ status: 403 },
			);
		}

		const organizationId = orgContext.organizationId;
		const showsEmployeeScopedEvents = showAbsences || showTimeEntries || showWorkPeriods;
		const scopedEmployeeId = canViewOrganizationWideCalendar(orgContext.role)
			? employeeId
			: (orgContext.employeeId ?? undefined);

		if (showsEmployeeScopedEvents && !scopedEmployeeId) {
			return NextResponse.json({ error: "Forbidden: Employee profile required" }, { status: 403 });
		}

		if (year === null) {
			return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
		}

		// For single month, require month parameter
		if (!fullYear && month === null) {
			return NextResponse.json({ error: "Missing month parameter" }, { status: 400 });
		}

		const yearNum = parseInt(year, 10);
		const monthNum = month === null ? null : parseInt(month, 10);
		const { startDate, endDate } = getRequestDateRange(yearNum, monthNum, fullYear);
		let dailyRequirements: DailyWorkRequirements = {};
		let dailyActualMinutes: DailyWorkActualMinutes = {};
		let events: CalendarEvent[] = [];
		let workBalance: EmployeeWorkBalancePayload | null = null;
		const includeWorkPeriodActuals = Boolean(scopedEmployeeId);

		if (fullYear) {
			// Fetch all 12 months in parallel
			const monthPromises = Array.from({ length: 12 }, (_, monthIndex) =>
				fetchMonthEvents(
					organizationId,
					monthIndex,
					yearNum,
					scopedEmployeeId,
					showHolidays,
					showAbsences,
					showTimeEntries,
					showWorkPeriods,
					includeWorkPeriodActuals,
				),
			);

			const monthResults = await Promise.all(monthPromises);
			events = monthResults.flatMap((result) => result.events);
			dailyActualMinutes = monthResults.reduce<DailyWorkActualMinutes>(
				(acc, result) => ({ ...acc, ...result.dailyActualMinutes }),
				{},
			);
		} else {
			// Fetch single month
			const monthResult = await fetchMonthEvents(
				organizationId,
				monthNum!,
				yearNum,
				scopedEmployeeId,
				showHolidays,
				showAbsences,
				showTimeEntries,
				showWorkPeriods,
				includeWorkPeriodActuals,
			);
			events = monthResult.events;
			dailyActualMinutes = monthResult.dailyActualMinutes;
		}

		[dailyRequirements, workBalance] = await Promise.all([
			fetchDailyRequirements({
				organizationId,
				employeeId: scopedEmployeeId,
				startDate,
				endDate,
			}),
			fetchWorkBalance({ organizationId, employeeId: scopedEmployeeId }),
		]);

		// Use SuperJSON to preserve Date objects in the response
		return superJsonResponse({
			events,
			total: events.length,
			dailyRequirements,
			dailyActualMinutes,
			workBalance,
		});
	} catch (error) {
		console.error("Error fetching calendar events:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
