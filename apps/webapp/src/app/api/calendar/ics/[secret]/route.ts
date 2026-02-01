/**
 * ICS Feed Endpoint
 *
 * Public endpoint that generates ICS calendar feeds for external calendar
 * applications to subscribe to. Authentication is via secret token in the URL.
 *
 * GET /api/calendar/ics/[secret]
 *
 * Returns: text/calendar (ICS format)
 */

import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, icsFeed } from "@/db/schema";
import { employee, team } from "@/db/schema/organization";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import {
	generateICS,
	mapAbsencesToICSEvents,
} from "@/lib/calendar-sync/domain";
import type { ICSFeedOptions } from "@/lib/calendar-sync/types";

// ============================================
// ROUTE HANDLER
// ============================================

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ secret: string }> },
) {
	await connection(); // Opt out of caching for dynamic data

	const { secret } = await params;

	try {
		// 1. Validate the secret token and get feed config
		const feed = await db.query.icsFeed.findFirst({
			where: and(eq(icsFeed.secret, secret), eq(icsFeed.isActive, true)),
		});

		if (!feed) {
			return new NextResponse("Feed not found", { status: 404 });
		}

		// 2. Update last accessed timestamp (fire and forget)
		db.update(icsFeed)
			.set({ lastAccessedAt: new Date() })
			.where(eq(icsFeed.id, feed.id))
			.catch(() => {
				// Ignore errors updating access time
			});

		// 3. Determine date range (past 30 days to next 365 days)
		const now = DateTime.now();
		const startDate = now.minus({ days: 30 }).toFormat("yyyy-MM-dd");
		const endDate = now.plus({ days: 365 }).toFormat("yyyy-MM-dd");

		// 4. Build status filter based on feed settings
		const statusFilters: Array<"pending" | "approved" | "rejected"> = [];
		if (feed.includeApproved) statusFilters.push("approved");
		if (feed.includePending) statusFilters.push("pending");

		if (statusFilters.length === 0) {
			// Return empty calendar if no statuses selected
			const emptyICS = generateICS([], {
				calendarName: "Z8 Absences",
				refreshInterval: 60,
			});
			return new NextResponse(emptyICS, {
				headers: getICSHeaders(),
			});
		}

		// 5. Fetch absences based on feed type
		let absences: AbsenceWithCategory[] = [];
		let calendarName = "Z8 Absences";
		let calendarDescription = "";
		let includeEmployeeName = false;

		if (feed.feedType === "user" && feed.employeeId) {
			// User feed: fetch absences for a single employee
			const emp = await db.query.employee.findFirst({
				where: eq(employee.id, feed.employeeId),
				with: { user: true },
			});

			if (emp) {
				calendarName = `${emp.user.name}'s Absences`;
				calendarDescription = `Absence calendar for ${emp.user.name}`;
			}

			absences = await fetchEmployeeAbsences(
				feed.employeeId,
				startDate,
				endDate,
				statusFilters,
			);
		} else if (feed.feedType === "team" && feed.teamId) {
			// Team feed: fetch absences for all team members
			const teamRecord = await db.query.team.findFirst({
				where: eq(team.id, feed.teamId),
			});

			if (teamRecord) {
				calendarName = `${teamRecord.name} Team Absences`;
				calendarDescription = `Absence calendar for the ${teamRecord.name} team`;
				includeEmployeeName = true;
			}

			absences = await fetchTeamAbsences(
				feed.teamId,
				startDate,
				endDate,
				statusFilters,
			);
		}

		// 6. Map absences to ICS events
		const options: ICSFeedOptions = {
			calendarName,
			calendarDescription,
			refreshInterval: 60, // Refresh every hour
		};

		const events = mapAbsencesToICSEvents(absences, {
			organizationId: feed.organizationId,
			includeEmployeeName,
		});

		// 7. Generate ICS content
		const icsContent = generateICS(events, options);

		// 8. Return ICS response
		return new NextResponse(icsContent, {
			headers: getICSHeaders(),
		});
	} catch (error) {
		console.error("Error generating ICS feed:", error);
		return new NextResponse("Internal server error", { status: 500 });
	}
}

// ============================================
// HELPERS
// ============================================

function getICSHeaders(): HeadersInit {
	return {
		"Content-Type": "text/calendar; charset=utf-8",
		"Content-Disposition": 'attachment; filename="calendar.ics"',
		"Cache-Control": "no-cache, no-store, must-revalidate",
		Pragma: "no-cache",
		Expires: "0",
	};
}

async function fetchEmployeeAbsences(
	employeeId: string,
	startDate: string,
	endDate: string,
	statuses: Array<"pending" | "approved" | "rejected">,
): Promise<AbsenceWithCategory[]> {
	const results = await db
		.select({
			absence: absenceEntry,
			category: absenceCategory,
			user: user,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			and(
				eq(absenceEntry.employeeId, employeeId),
				inArray(absenceEntry.status, statuses),
				or(
					// Absence overlaps with our date range
					and(
						lte(absenceEntry.startDate, endDate),
						gte(absenceEntry.endDate, startDate),
					),
				),
			),
		);

	return results.map(({ absence, category }) => ({
		id: absence.id,
		employeeId: absence.employeeId,
		startDate: absence.startDate,
		startPeriod: absence.startPeriod,
		endDate: absence.endDate,
		endPeriod: absence.endPeriod,
		status: absence.status as "pending" | "approved" | "rejected",
		notes: absence.notes,
		category: {
			id: category.id,
			name: category.name,
			type: category.type,
			color: category.color,
			countsAgainstVacation: category.countsAgainstVacation,
		},
		approvedBy: absence.approvedBy,
		approvedAt: absence.approvedAt,
		rejectionReason: absence.rejectionReason,
		createdAt: absence.createdAt,
	}));
}

async function fetchTeamAbsences(
	teamId: string,
	startDate: string,
	endDate: string,
	statuses: Array<"pending" | "approved" | "rejected">,
): Promise<AbsenceWithCategory[]> {
	// First get all employees in the team
	const teamEmployees = await db.query.employee.findMany({
		where: eq(employee.teamId, teamId),
		columns: { id: true },
	});

	const employeeIds = teamEmployees.map((e) => e.id);

	if (employeeIds.length === 0) {
		return [];
	}

	const results = await db
		.select({
			absence: absenceEntry,
			category: absenceCategory,
			user: user,
			employee: employee,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			and(
				inArray(absenceEntry.employeeId, employeeIds),
				inArray(absenceEntry.status, statuses),
				or(
					and(
						lte(absenceEntry.startDate, endDate),
						gte(absenceEntry.endDate, startDate),
					),
				),
			),
		);

	return results.map(({ absence, category, user: u }) => ({
		id: absence.id,
		employeeId: absence.employeeId,
		startDate: absence.startDate,
		startPeriod: absence.startPeriod,
		endDate: absence.endDate,
		endPeriod: absence.endPeriod,
		status: absence.status as "pending" | "approved" | "rejected",
		notes: absence.notes,
		category: {
			id: category.id,
			name: category.name,
			type: category.type,
			color: category.color,
			countsAgainstVacation: category.countsAgainstVacation,
		},
		approvedBy: absence.approvedBy,
		approvedAt: absence.approvedAt,
		rejectionReason: absence.rejectionReason,
		createdAt: absence.createdAt,
		// Store employee name in a custom field for team feeds
		employeeName: u.name,
	})) as AbsenceWithCategory[];
}
