/**
 * Teams Daily Digest Job
 *
 * Sends daily summary cards to managers via Teams at their configured time.
 * Runs every 15 minutes to check for digests due to be sent.
 */

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	complianceException,
	employee,
	employeeManagers,
	location,
	locationSubarea,
	shift,
	workPeriod,
} from "@/db/schema";
import { fmtTime, fmtWeekdayShortDate, getUserLocale } from "@/lib/bot-platform/i18n";
import { createLogger } from "@/lib/logger";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { sendAdaptiveCard } from "../bot-adapter";
import { buildDailyDigestCard } from "../cards";
import { getOrganizationPersonalConversations } from "../conversation-manager";
import { getAllActiveTenants } from "../tenant-resolver";
import type { DailyDigestData } from "../types";

const logger = createLogger("TeamsDailyDigest");

export interface DailyDigestResult {
	success: boolean;
	tenantsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/**
 * Run the daily digest job
 *
 * This checks all active tenants and sends digest cards to managers
 * whose configured digest time matches the current time window.
 */
export async function runDailyDigestJob(): Promise<DailyDigestResult> {
	const startedAt = new Date();
	const errors: string[] = [];
	let digestsSent = 0;

	try {
		// Get all active tenants with daily digest enabled
		const tenants = await getAllActiveTenants();
		const digestEnabledTenants = tenants.filter((t) => t.enableDailyDigest);

		logger.info(
			{ tenantCount: digestEnabledTenants.length },
			"Starting daily digest job",
		);

		for (const tenant of digestEnabledTenants) {
			try {
				const sent = await processTenantDigest(tenant);
				digestsSent += sent;
			} catch (error) {
				const errorMsg = `Failed to process digest for tenant ${tenant.tenantId}: ${error instanceof Error ? error.message : String(error)}`;
				logger.error({ error, tenantId: tenant.tenantId }, errorMsg);
				errors.push(errorMsg);
			}
		}

		logger.info(
			{
				duration: Date.now() - startedAt.getTime(),
				tenantsProcessed: digestEnabledTenants.length,
				digestsSent,
				errors: errors.length,
			},
			"Daily digest job completed",
		);

		return {
			success: errors.length === 0,
			tenantsProcessed: digestEnabledTenants.length,
			digestsSent,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Daily digest job failed");
		throw error;
	}
}

/**
 * Process daily digest for a single tenant
 */
async function processTenantDigest(tenant: {
	tenantId: string;
	organizationId: string;
	digestTime: string;
	digestTimezone: string;
}): Promise<number> {
	// Check if it's time to send the digest
	const now = DateTime.now().setZone(tenant.digestTimezone);
	const [digestHour, digestMinute] = tenant.digestTime.split(":").map(Number);

	// Only send if within the 15-minute window of the digest time
	const digestTime = now.set({
		hour: digestHour,
		minute: digestMinute,
		second: 0,
	});
	const minutesSinceDigestTime = now.diff(digestTime, "minutes").minutes;

	// Send if we're within 0-15 minutes after the digest time
	if (minutesSinceDigestTime < 0 || minutesSinceDigestTime >= 15) {
		logger.debug(
			{
				tenantId: tenant.tenantId,
				digestTime: tenant.digestTime,
				currentTime: now.toISO(),
			},
			"Not digest time for tenant",
		);
		return 0;
	}

	// Get all managers in this organization who have Teams conversations
	const conversations = await getOrganizationPersonalConversations(
		tenant.organizationId,
	);

	if (conversations.length === 0) {
		logger.debug(
			{ organizationId: tenant.organizationId },
			"No Teams conversations for digest",
		);
		return 0;
	}

	const appUrl = process.env.APP_URL || "https://z8-time.app";

	const results = await Promise.allSettled(
		conversations.map(async (conv) => {
			try {
				// Get employee ID for this user
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, conv.userId),
						eq(employee.organizationId, tenant.organizationId),
					),
				});

				if (!emp) return false;

				// Check if this employee is a manager (has any employees reporting to them)
				const manages = await db.query.employeeManagers.findFirst({
					where: eq(employeeManagers.managerId, emp.id),
				});

				if (!manages) return false;

				// Build digest data for this manager
				const userLocale = await getUserLocale(conv.userId);
				const digestData = await buildDigestDataForManager(
					emp.id,
					tenant.organizationId,
					tenant.digestTimezone,
					userLocale,
				);

				// Build and send card
				const card = buildDailyDigestCard(digestData, appUrl, userLocale);

				await sendAdaptiveCard(
					conv.conversationReference,
					card,
					`Daily Digest - ${digestData.date.toLocaleDateString()}`,
				);

				return true;
			} catch (error) {
				logger.warn(
					{ error, userId: conv.userId },
					"Failed to send digest to user",
				);
				return false;
			}
		}),
	);

	const sent = results.filter(
		(r) => r.status === "fulfilled" && r.value === true,
	).length;

	logger.info(
		{ organizationId: tenant.organizationId, digestsSent: sent },
		"Sent daily digests for tenant",
	);

	return sent;
}

/**
 * Build digest data for a specific manager
 */
export async function buildDigestDataForManager(
	managerId: string,
	organizationId: string,
	timezone: string,
	locale: string = DEFAULT_LANGUAGE,
): Promise<DailyDigestData> {
	const now = DateTime.now().setZone(timezone);
	const todayStr = now.toISODate();
	const tomorrowStr = now.plus({ days: 1 }).toISODate();

	// =========================================
	// Phase 1: All independent queries in parallel
	// These queries only depend on function parameters, not on each other
	// =========================================
	const [
		pendingApprovals,
		managedEmployeesResult,
		[todayShiftsResult, tomorrowShiftsResult],
		scheduledShifts,
	] = await Promise.all([
		// Pending approvals for this manager
		db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.approverId, managerId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.status, "pending"),
			),
		}),
		// Managed employees
		db.query.employeeManagers.findMany({
			where: eq(employeeManagers.managerId, managerId),
			with: {
				employee: {
					columns: { id: true, organizationId: true },
				},
			},
		}),
		// Open shifts count for today and tomorrow
		Promise.all([
			db
				.select({ count: sql<number>`count(*)` })
				.from(shift)
				.where(
					and(
						eq(shift.organizationId, organizationId),
						eq(shift.status, "published"),
						isNull(shift.employeeId),
						sql`DATE(${shift.date}) = ${todayStr}`,
					),
				),
			db
				.select({ count: sql<number>`count(*)` })
				.from(shift)
				.where(
					and(
						eq(shift.organizationId, organizationId),
						eq(shift.status, "published"),
						isNull(shift.employeeId),
						sql`DATE(${shift.date}) = ${tomorrowStr}`,
					),
				),
		]),
		// Scheduled shifts for coverage gap calculation
		db.query.shift.findMany({
			where: and(
				eq(shift.organizationId, organizationId),
				eq(shift.status, "published"),
				sql`DATE(${shift.date}) = ${todayStr}`,
				sql`${shift.employeeId} IS NOT NULL`,
			),
			columns: {
				id: true,
				subareaId: true,
				employeeId: true,
				startTime: true,
				endTime: true,
			},
		}),
	]);

	// Process Phase 1 results
	const managedEmployeeIds = managedEmployeesResult
		.filter((m) => m.employee.organizationId === organizationId)
		.map((m) => m.employeeId);

	const todayCount = Number(todayShiftsResult[0]?.count) || 0;
	const tomorrowCount = Number(tomorrowShiftsResult[0]?.count) || 0;
	const openShiftsToday = todayCount > 0 ? todayCount : undefined;
	const openShiftsTomorrow = tomorrowCount > 0 ? tomorrowCount : undefined;

	// =========================================
	// Phase 2: Queries that depend on managedEmployeeIds
	// These run in parallel with each other
	// =========================================
	let employeesOut: Array<{
		name: string;
		category: string;
		returnDate: string;
	}> = [];
	let employeesClockedIn: Array<{
		name: string;
		clockedInAt: string;
		durationSoFar: string;
	}> = [];
	let activeWorkPeriods: Array<{
		employeeId: string;
		startTime: Date;
		employeeName: string | null;
	}> = [];
	let compliancePending: number | undefined;

	if (managedEmployeeIds.length > 0) {
		const [absences, activeWorkPeriodsResult, [pendingExceptionsResult]] =
			await Promise.all([
				// Employees out today
				db
					.select({
						employeeId: absenceEntry.employeeId,
						startDate: absenceEntry.startDate,
						endDate: absenceEntry.endDate,
						employeeName: user.name,
						categoryName: absenceCategory.name,
					})
					.from(absenceEntry)
					.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(
						absenceCategory,
						eq(absenceEntry.categoryId, absenceCategory.id),
					)
					.where(
						and(
							eq(absenceEntry.status, "approved"),
							lte(absenceEntry.startDate, todayStr!),
							gte(absenceEntry.endDate, todayStr!),
							inArray(absenceEntry.employeeId, managedEmployeeIds),
						),
					),
				// Employees clocked in
				db
					.select({
						employeeId: workPeriod.employeeId,
						startTime: workPeriod.startTime,
						employeeName: user.name,
					})
					.from(workPeriod)
					.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
					.innerJoin(user, eq(employee.userId, user.id))
					.where(
						and(
							eq(workPeriod.organizationId, organizationId),
							eq(workPeriod.isActive, true),
							inArray(workPeriod.employeeId, managedEmployeeIds),
						),
					),
				// Pending compliance exceptions
				db
					.select({ count: sql<number>`count(*)` })
					.from(complianceException)
					.where(
						and(
							eq(complianceException.organizationId, organizationId),
							eq(complianceException.status, "pending"),
							inArray(complianceException.employeeId, managedEmployeeIds),
						),
					),
			]);

		// Process Phase 2 results
		employeesOut = absences.map((a) => ({
			name: a.employeeName || "Unknown",
			category: a.categoryName || "Leave",
			returnDate: fmtWeekdayShortDate(
				DateTime.fromISO(a.endDate).plus({ days: 1 }),
				locale,
			),
		}));

		activeWorkPeriods = activeWorkPeriodsResult;
		employeesClockedIn = activeWorkPeriods.map((e) => {
			const clockInTime = DateTime.fromJSDate(e.startTime).setZone(timezone);
			const duration = now.diff(clockInTime, ["hours", "minutes"]);

			return {
				name: e.employeeName || "Unknown",
				clockedInAt: fmtTime(clockInTime, locale),
				durationSoFar: `${Math.floor(duration.hours)}h ${Math.floor(duration.minutes % 60)}m`,
			};
		});

		const pendingCount = Number(pendingExceptionsResult?.count) || 0;
		if (pendingCount > 0) compliancePending = pendingCount;
	}

	// =========================================
	// Phase 3: Coverage gap calculation (depends on scheduledShifts from Phase 1)
	// =========================================
	let coverageGaps:
		| Array<{
				subareaName: string;
				locationName: string;
				timeSlot: string;
				scheduled: number;
				actual: number;
				shortage: number;
		  }>
		| undefined;

	// Get subarea info
	const subareaIds = [...new Set(scheduledShifts.map((s) => s.subareaId))];
	if (subareaIds.length > 0) {
		const subareas = await db
			.select({
				id: locationSubarea.id,
				name: locationSubarea.name,
				locationName: location.name,
			})
			.from(locationSubarea)
			.innerJoin(location, eq(locationSubarea.locationId, location.id))
			.where(inArray(locationSubarea.id, subareaIds));

		const subareaMap = new Map(subareas.map((s) => [s.id, s]));

		// Group shifts by subarea and calculate scheduled count
		const scheduledBySubarea = new Map<string, number>();
		for (const s of scheduledShifts) {
			const current = scheduledBySubarea.get(s.subareaId) || 0;
			scheduledBySubarea.set(s.subareaId, current + 1);
		}

		// Count clocked-in employees by the shifts they're assigned to
		const scheduledEmployeeIds = [
			...new Set(scheduledShifts.map((s) => s.employeeId).filter(Boolean)),
		] as string[];
		const clockedInEmployeeIds = new Set(
			activeWorkPeriods?.map((wp) => wp.employeeId) || [],
		);

		// Calculate gaps per subarea
		const gaps: typeof coverageGaps = [];
		for (const [subareaId, scheduled] of scheduledBySubarea) {
			const subarea = subareaMap.get(subareaId);
			if (!subarea) continue;

			// Count clocked-in employees and find time range in a single pass (O(n) instead of O(n log n))
			const subareaShifts = scheduledShifts.filter(
				(s) => s.subareaId === subareaId,
			);
			if (subareaShifts.length === 0) continue;

			let clockedIn = 0;
			let earliestStart = subareaShifts[0].startTime;
			let latestEnd = subareaShifts[0].endTime;

			for (const s of subareaShifts) {
				// Count clocked-in
				if (s.employeeId && clockedInEmployeeIds.has(s.employeeId)) {
					clockedIn++;
				}
				// Track min/max times
				if (s.startTime < earliestStart) earliestStart = s.startTime;
				if (s.endTime > latestEnd) latestEnd = s.endTime;
			}

			const shortage = scheduled - clockedIn;
			if (shortage > 0) {
				gaps.push({
					subareaName: subarea.name,
					locationName: subarea.locationName,
					timeSlot: `${earliestStart}-${latestEnd}`,
					scheduled,
					actual: clockedIn,
					shortage,
				});
			}
		}

		// Sort by shortage (highest first) and limit to top 3
		if (gaps.length > 0) {
			gaps.sort((a, b) => b.shortage - a.shortage);
			coverageGaps = gaps.slice(0, 3);
		}
	}

	return {
		date: now.toJSDate(),
		timezone,
		pendingApprovals: pendingApprovals.length,
		employeesOut,
		employeesClockedIn,
		// Operations Console Additions
		coverageGaps,
		openShiftsToday,
		openShiftsTomorrow,
		compliancePending,
	};
}
