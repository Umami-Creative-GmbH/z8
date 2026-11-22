/**
 * Teams Daily Digest Job
 *
 * Sends daily summary cards to managers via Teams at their configured time.
 * Runs every 15 minutes to check for digests due to be sent.
 */

import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	complianceException,
	employee,
	location,
	locationSubarea,
	shift,
	workPeriod,
} from "@/db/schema";
import { env } from "@/env";
import {
	currentRosterDigestManager,
	currentRosterReportIds,
} from "@/lib/bot-platform/current-roster-team";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import { resolveBotTemporalContext } from "@/lib/bot-platform/temporal-context";
import { resolveEffectiveContractOnDay } from "@/lib/contracts/resolve-contract";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	formatInstant,
	formatPlainDate,
	localeDefaultTimeFormat,
} from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { sendAdaptiveCard } from "../bot-adapter";
import { buildDailyDigestCard } from "../cards/daily-digest-card";
import { getOrganizationPersonalConversations } from "../conversation-manager";
import { getAllActiveTenants } from "../tenant-resolver";
import type { DailyDigestData } from "../types";

// The absence's deputy (#1012) in "Who's out".
const deputyEmployee = alias(employee, "deputy_employee");
const deputyUser = alias(user, "deputy_user");

const logger = createLogger("TeamsDailyDigest");

/** Returns whether a manager should not receive a digest on their local day. */
export async function shouldSkipDigestForManager(
	employeeId: string,
	organizationId: string,
	timezone: string,
): Promise<boolean> {
	const now = systemClock.nowInstant().toZonedDateTimeISO(timezone);
	const todayStr = now.toPlainDate().toString();

	const absence = await db.query.absenceEntry.findFirst({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			eq(absenceEntry.organizationId, organizationId),
			eq(absenceEntry.status, "approved"),
			lte(absenceEntry.startDate, todayStr),
			gte(absenceEntry.endDate, todayStr),
		),
		with: { category: true },
	});

	if (absence && !absence.category.requiresWorkTime) {
		logger.debug({ employeeId, todayStr }, "Skipping digest: manager is on absence today");
		return true;
	}

	const contract = await resolveEffectiveContractOnDay(db, {
		organizationId,
		employeeId,
		date: todayStr,
		timezoneOverride: timezone,
	});
	if (!contract) return false;

	const hasEffectiveSchedule =
		contract.scheduleSource === "policy" &&
		(contract.scheduleMode === "custom_days" ||
			contract.scheduleMode === "hours_only" ||
			Boolean(contract.workPolicy?.scheduleEnabled && contract.workPolicy.schedule));
	if (!hasEffectiveSchedule) return false;

	if (!contract.isWorkDay) {
		logger.debug(
			{ employeeId, todayStr, todayDayName: contract.dayOfWeek },
			"Skipping digest: today is not a work day for manager",
		);
		return true;
	}

	return false;
}

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

		logger.info({ tenantCount: digestEnabledTenants.length }, "Starting daily digest job");

		const tenantResults = await Promise.all(
			digestEnabledTenants.map(async (tenant) => {
				try {
					return { sent: await processTenantDigest(tenant), error: undefined };
				} catch (error) {
					const errorMsg = `Failed to process digest for tenant ${tenant.tenantId}: ${error instanceof Error ? error.message : String(error)}`;
					logger.error({ error, tenantId: tenant.tenantId }, errorMsg);
					return { sent: 0, error: errorMsg };
				}
			}),
		);
		digestsSent = tenantResults.reduce((total, result) => total + result.sent, 0);
		errors.push(...tenantResults.flatMap((result) => (result.error ? [result.error] : [])));

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
type DigestTenant = {
	tenantId: string;
	organizationId: string;
	digestTime: string;
	digestTimezone: string;
};

async function processTenantDigest(tenant: DigestTenant): Promise<number> {
	// Check if it's time to send the digest
	const now = systemClock.nowInstant().toZonedDateTimeISO(tenant.digestTimezone);
	const [digestHour, digestMinute] = tenant.digestTime.split(":").map(Number);

	// Only send if within the 15-minute window of the digest time
	const digestTime = now.with({
		hour: digestHour,
		minute: digestMinute,
		second: 0,
		millisecond: 0,
		microsecond: 0,
		nanosecond: 0,
	});
	const minutesSinceDigestTime = (now.epochMilliseconds - digestTime.epochMilliseconds) / 60_000;

	// Send if we're within 0-15 minutes after the digest time
	if (minutesSinceDigestTime < 0 || minutesSinceDigestTime >= 15) {
		logger.debug(
			{
				tenantId: tenant.tenantId,
				digestTime: tenant.digestTime,
				currentTime: now.toString(),
			},
			"Not digest time for tenant",
		);
		return 0;
	}

	// Get all managers in this organization who have Teams conversations
	const conversations = await getOrganizationPersonalConversations(tenant.organizationId);

	if (conversations.length === 0) {
		logger.debug({ organizationId: tenant.organizationId }, "No Teams conversations for digest");
		return 0;
	}

	const appUrl = env.APP_URL || "https://z8-time.app";

	const results = await Promise.allSettled(
		conversations.map(async (conv) => {
			try {
				// A current manager of at least one current report (#1438).
				const emp = await currentRosterDigestManager(db, {
					organizationId: tenant.organizationId,
					userId: conv.userId,
				});

				if (!emp) return false;
				if (
					await shouldSkipDigestForManager(emp.id, tenant.organizationId, tenant.digestTimezone)
				) {
					return false;
				}

				const temporal = await resolveBotTemporalContext({
					userId: conv.userId,
					employeeId: emp.id,
					organizationId: tenant.organizationId,
				});
				if (!temporal) return false;

				// Digest delivery is scheduled in the tenant timezone, but content uses the recipient's context.
				const digestData = await buildDigestDataForManager(
					emp.id,
					tenant.organizationId,
					temporal.effectiveTimezone,
					temporal.locale,
				);

				// Build and send card
				const t = await getBotTranslate(temporal.locale);
				const card = buildDailyDigestCard(digestData, appUrl, temporal.locale, t);

				await sendAdaptiveCard(
					conv.conversationReference,
					card,
					t("bot.digest.title", "Daily Digest - {date}", {
						date: digestTitleDate(digestData.date, digestData.timezone, temporal.locale),
					}),
				);

				return true;
			} catch (error) {
				logger.warn({ error, userId: conv.userId }, "Failed to send digest to user");
				return false;
			}
		}),
	);

	const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;

	logger.info(
		{ organizationId: tenant.organizationId, digestsSent: sent },
		"Sent daily digests for tenant",
	);

	return sent;
}

/** The digest's day for its title: the calendar day in the recipient's zone, written out. */
export function digestTitleDate(date: Date, timezone: string, locale: string): string {
	return formatPlainDate(plainDateAt(instantFromDate(date), timezone), locale, "weekdayDateLong");
}

/**
 * Build digest data for a specific manager
 */
export async function buildDigestDataForManager(
	managerId: string,
	organizationId: string,
	timezone: string,
	locale: string = DEFAULT_LANGUAGE,
	nowInstant: Instant = systemClock.nowInstant(),
): Promise<DailyDigestData> {
	const today = plainDateAt(nowInstant, timezone);
	const todayStr = today.toString();
	// `shift.date` is keyed in the organization's zone: read the shifts of today's calendar date.
	const organizationTimezone = await loadOrganizationTimezone(db, organizationId);
	const todayShifts = shiftDateBounds(today.toString(), organizationTimezone);
	const tomorrowShifts = shiftDateBounds(today.add({ days: 1 }).toString(), organizationTimezone);

	// =========================================
	// Phase 1: All independent queries in parallel
	// These queries only depend on function parameters, not on each other
	// =========================================
	const [
		pendingApprovals,
		managedEmployeeIds,
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
		// The manager's team in this organization: its current roster only (#1438).
		currentRosterReportIds(db, { organizationId, managerEmployeeId: managerId }),
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
						gte(shift.date, todayShifts.start),
						lt(shift.date, todayShifts.endExclusive),
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
						gte(shift.date, tomorrowShifts.start),
						lt(shift.date, tomorrowShifts.endExclusive),
					),
				),
		]),
		// Scheduled shifts for coverage gap calculation
		db.query.shift.findMany({
			where: and(
				eq(shift.organizationId, organizationId),
				eq(shift.status, "published"),
				gte(shift.date, todayShifts.start),
				lt(shift.date, todayShifts.endExclusive),
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
	const todayCount = Number(todayShiftsResult[0]?.count) || 0;
	const tomorrowCount = Number(tomorrowShiftsResult[0]?.count) || 0;
	const openShiftsToday = todayCount > 0 ? todayCount : undefined;
	const openShiftsTomorrow = tomorrowCount > 0 ? tomorrowCount : undefined;

	// =========================================
	// Phase 2: Queries that depend on managedEmployeeIds
	// These run in parallel with each other
	// =========================================
	let employeesOut: DailyDigestData["employeesOut"] = [];
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
		const [absences, activeWorkPeriodsResult, [pendingExceptionsResult]] = await Promise.all([
			// Employees out today
			db
				.select({
					employeeId: absenceEntry.employeeId,
					startDate: absenceEntry.startDate,
					endDate: absenceEntry.endDate,
					employeeName: user.name,
					categoryName: absenceCategory.name,
					deputyName: deputyUser.name,
				})
				.from(absenceEntry)
				.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
				.innerJoin(user, eq(employee.userId, user.id))
				.leftJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
				// Who covers (#1012), only an employee of the same organization.
				.leftJoin(
					deputyEmployee,
					and(
						eq(deputyEmployee.id, absenceEntry.deputyEmployeeId),
						eq(deputyEmployee.organizationId, organizationId),
					),
				)
				.leftJoin(deputyUser, eq(deputyUser.id, deputyEmployee.userId))
				.where(
					and(
						eq(absenceEntry.organizationId, organizationId),
						eq(absenceEntry.status, "approved"),
						lte(absenceEntry.startDate, todayStr),
						gte(absenceEntry.endDate, todayStr),
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
			returnDate: formatPlainDate(
				parsePlainDate(a.endDate).add({ days: 1 }),
				locale,
				"weekdayMonthDay",
			),
			deputyName: a.deputyName,
		}));

		activeWorkPeriods = activeWorkPeriodsResult;
		const timeFormat = localeDefaultTimeFormat(locale);
		employeesClockedIn = activeWorkPeriods.map((e) => {
			const clockInInstant = instantFromDate(e.startTime);
			const totalMinutes = Math.max(
				0,
				Math.floor((nowInstant.epochMilliseconds - clockInInstant.epochMilliseconds) / 60_000),
			);

			return {
				name: e.employeeName || "Unknown",
				clockedInAt: formatInstant(clockInInstant, { locale, timezone, timeFormat }, "time"),
				durationSoFar: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
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
		const _scheduledEmployeeIds = [
			...new Set(scheduledShifts.flatMap((s) => (s.employeeId ? [s.employeeId] : []))),
		] as string[];
		const clockedInEmployeeIds = new Set(activeWorkPeriods?.map((wp) => wp.employeeId) || []);

		// Calculate gaps per subarea
		const gaps: typeof coverageGaps = [];
		for (const [subareaId, scheduled] of scheduledBySubarea) {
			const subarea = subareaMap.get(subareaId);
			if (!subarea) continue;

			// Count clocked-in employees and find time range in a single pass (O(n) instead of O(n log n))
			const subareaShifts = scheduledShifts.filter((s) => s.subareaId === subareaId);
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
		date: dateFromInstant(nowInstant),
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
