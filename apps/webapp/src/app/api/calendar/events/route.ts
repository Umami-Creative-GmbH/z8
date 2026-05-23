import { DateTime } from "luxon";
import { connection, type NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { asAppSubject, defineAbilityFor, type PrincipalContext } from "@/lib/authorization";
import { getVerifiedOrgContext } from "@/lib/auth-helpers";
import { getAbsencesForMonth } from "@/lib/calendar/absence-service";
import {
	assignedHolidayToCalendarEvent,
	getAssignedHolidaysForEmployee,
} from "@/lib/calendar/assigned-holidays";
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

type VerifiedCalendarContext = NonNullable<Awaited<ReturnType<typeof getVerifiedOrgContext>>>;

async function resolveAuthorizedCalendarEmployeeId(
	orgContext: VerifiedCalendarContext,
	requestedEmployeeId: string | undefined,
): Promise<string | undefined> {
	if (!orgContext.employeeId || !orgContext.role) {
		return undefined;
	}

	const currentEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, orgContext.employeeId),
			eq(employee.organizationId, orgContext.organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!currentEmployee) {
		return undefined;
	}

	const targetEmployeeId = requestedEmployeeId ?? currentEmployee.id;
	const targetEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, targetEmployeeId),
			eq(employee.organizationId, orgContext.organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!targetEmployee) {
		return undefined;
	}

	const managedRecords = await db.query.employeeManagers.findMany({
		where: eq(employeeManagers.managerId, currentEmployee.id),
		columns: { employeeId: true },
	});
	const principal: PrincipalContext = {
		userId: orgContext.user.id,
		isPlatformAdmin: orgContext.user.role === "admin",
		activeOrganizationId: orgContext.organizationId,
		orgMembership: null,
		employee: {
			id: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			role: currentEmployee.role,
			teamId: currentEmployee.teamId,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: managedRecords.map((record) => record.employeeId),
		customRoles: [],
	};

	const ability = defineAbilityFor(principal);
	return ability.can(
		"read",
		asAppSubject("Employee", {
			id: targetEmployee.id,
			employeeId: targetEmployee.id,
			organizationId: targetEmployee.organizationId,
			teamId: targetEmployee.teamId,
		}),
	)
		? targetEmployee.id
		: undefined;
}

async function fetchHolidayEvents(params: {
	organizationId: string;
	employeeId: string | undefined;
	month: number;
	year: number;
	showHolidays: boolean;
}): Promise<CalendarEvent[]> {
	if (!params.showHolidays) return [];
	if (!params.employeeId) {
		return getHolidaysForMonth(params.organizationId, params.month, params.year);
	}

	const monthStart = DateTime.utc(params.year, params.month + 1, 1).startOf("day");
	const monthEnd = monthStart.endOf("month");

	try {
		const holidays = await getAssignedHolidaysForEmployee({
			organizationId: params.organizationId,
			employeeId: params.employeeId,
			startDate: monthStart.toJSDate(),
			endDate: monthEnd.toJSDate(),
		});
		return holidays.map(assignedHolidayToCalendarEvent);
	} catch (error) {
		console.error("Error fetching assigned calendar holidays:", error);
		return [];
	}
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
		fetchHolidayEvents({ organizationId, employeeId, month, year, showHolidays }),
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
		const scopedEmployeeId = await resolveAuthorizedCalendarEmployeeId(orgContext, employeeId);

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
