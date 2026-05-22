import { type NextRequest, NextResponse, connection } from "next/server";
import { DateTime } from "luxon";
import { getVerifiedOrgContext } from "@/lib/auth-helpers";
import { getAbsencesForMonth } from "@/lib/calendar/absence-service";
import { getHolidaysForMonth } from "@/lib/calendar/holiday-service";
import { getTimeEntriesForMonth } from "@/lib/calendar/time-entry-service";
import type { CalendarEvent, DailyWorkRequirements } from "@/lib/calendar/types";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { getWorkPeriodsForMonth } from "@/lib/calendar/work-period-service";
import { superJsonResponse } from "@/lib/superjson";

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
): Promise<CalendarEvent[]> {
	// Fetch all event types in parallel - conditional fetches return empty arrays
	const [holidays, absences, timeEntries, workPeriods] = await Promise.all([
		showHolidays ? getHolidaysForMonth(organizationId, month, year) : [],
		showAbsences ? getAbsencesForMonth(month, year, { organizationId, employeeId }) : [],
		showTimeEntries ? getTimeEntriesForMonth(month, year, { organizationId, employeeId }) : [],
		showWorkPeriods ? getWorkPeriodsForMonth(month, year, { organizationId, employeeId }) : [],
	]);

	return [...holidays, ...absences, ...timeEntries, ...workPeriods];
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

	try {
		return await getDailyWorkRequirementsForEmployee(params);
	} catch (error) {
		console.error("Error fetching calendar work policy requirements:", error);
		return {};
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
			: orgContext.employeeId ?? undefined;

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
		let events: CalendarEvent[] = [];

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
				),
			);

			const monthResults = await Promise.all(monthPromises);
			events = monthResults.flat();
		} else {
			// Fetch single month
			events = await fetchMonthEvents(
				organizationId,
				monthNum!,
				yearNum,
				scopedEmployeeId,
				showHolidays,
				showAbsences,
				showTimeEntries,
				showWorkPeriods,
			);
		}

		dailyRequirements = await fetchDailyRequirements({
			organizationId,
			employeeId: scopedEmployeeId,
			startDate,
			endDate,
		});

		// Use SuperJSON to preserve Date objects in the response
		return superJsonResponse({
			events,
			total: events.length,
			dailyRequirements,
		});
	} catch (error) {
		console.error("Error fetching calendar events:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
