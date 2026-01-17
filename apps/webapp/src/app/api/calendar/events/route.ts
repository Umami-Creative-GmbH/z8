import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { auth } from "@/lib/auth";
import { getAbsencesForMonth } from "@/lib/calendar/absence-service";
import { getHolidaysForMonth } from "@/lib/calendar/holiday-service";
import { getTimeEntriesForMonth } from "@/lib/calendar/time-entry-service";
import type { CalendarEvent } from "@/lib/calendar/types";
import { getWorkPeriodsForMonth } from "@/lib/calendar/work-period-service";
import { superJsonResponse } from "@/lib/superjson";

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
		showAbsences
			? getAbsencesForMonth(month, year, { organizationId, employeeId })
			: [],
		showTimeEntries
			? getTimeEntriesForMonth(month, year, { organizationId, employeeId })
			: [],
		showWorkPeriods
			? getWorkPeriodsForMonth(month, year, { organizationId, employeeId })
			: [],
	]);

	return [...holidays, ...absences, ...timeEntries, ...workPeriods];
}

export async function GET(request: NextRequest) {
	await connection();
	try {
		// Authenticate user
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Parse query parameters
		const searchParams = request.nextUrl.searchParams;
		const organizationId = searchParams.get("organizationId");
		const month = searchParams.get("month");
		const year = searchParams.get("year");
		const fullYear = searchParams.get("fullYear") === "true"; // Fetch all 12 months
		const employeeId = searchParams.get("employeeId") || undefined;
		const showHolidays = searchParams.get("showHolidays") === "true";
		const showAbsences = searchParams.get("showAbsences") === "true";
		const showTimeEntries = searchParams.get("showTimeEntries") === "true";
		const showWorkPeriods = searchParams.get("showWorkPeriods") === "true";

		if (!organizationId || year === null) {
			return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
		}

		// For single month, require month parameter
		if (!fullYear && month === null) {
			return NextResponse.json({ error: "Missing month parameter" }, { status: 400 });
		}

		const yearNum = parseInt(year, 10);
		let events: CalendarEvent[] = [];

		if (fullYear) {
			// Fetch all 12 months in parallel
			const monthPromises = Array.from({ length: 12 }, (_, monthIndex) =>
				fetchMonthEvents(
					organizationId,
					monthIndex,
					yearNum,
					employeeId,
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
				parseInt(month!, 10),
				yearNum,
				employeeId,
				showHolidays,
				showAbsences,
				showTimeEntries,
				showWorkPeriods,
			);
		}

		// Use SuperJSON to preserve Date objects in the response
		return superJsonResponse({
			events,
			total: events.length,
		});
	} catch (error) {
		console.error("Error fetching calendar events:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
