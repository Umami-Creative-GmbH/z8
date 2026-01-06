import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAbsencesForMonth } from "@/lib/calendar/absence-service";
import { getHolidaysForMonth } from "@/lib/calendar/holiday-service";
import { getTimeEntriesForMonth } from "@/lib/calendar/time-entry-service";
import type { CalendarEvent } from "@/lib/calendar/types";
import { getWorkPeriodsForMonth } from "@/lib/calendar/work-period-service";

export async function GET(request: NextRequest) {
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
		const employeeId = searchParams.get("employeeId"); // Optional filter for specific employee
		const showHolidays = searchParams.get("showHolidays") === "true";
		const showAbsences = searchParams.get("showAbsences") === "true";
		const showTimeEntries = searchParams.get("showTimeEntries") === "true";
		const showWorkPeriods = searchParams.get("showWorkPeriods") === "true";

		if (!organizationId || month === null || year === null) {
			return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
		}

		const events: CalendarEvent[] = [];

		// Fetch holidays if requested
		if (showHolidays) {
			const holidays = await getHolidaysForMonth(
				organizationId,
				parseInt(month, 10),
				parseInt(year, 10),
			);
			events.push(...holidays);
		}

		// Fetch absences if requested
		if (showAbsences) {
			const absences = await getAbsencesForMonth(parseInt(month, 10), parseInt(year, 10), {
				organizationId,
				employeeId: employeeId || undefined,
			});
			events.push(...absences);
		}

		// Fetch time entries if requested
		if (showTimeEntries) {
			const timeEntries = await getTimeEntriesForMonth(parseInt(month, 10), parseInt(year, 10), {
				organizationId,
				employeeId: employeeId || undefined,
			});
			events.push(...timeEntries);
		}

		// Fetch work periods if requested
		if (showWorkPeriods) {
			const workPeriods = await getWorkPeriodsForMonth(parseInt(month, 10), parseInt(year, 10), {
				organizationId,
				employeeId: employeeId || undefined,
			});
			events.push(...workPeriods);
		}

		return NextResponse.json({
			events,
			total: events.length,
		});
	} catch (error) {
		console.error("Error fetching calendar events:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
