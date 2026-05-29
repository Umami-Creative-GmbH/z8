import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, timeEntry, userSettings, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import {
	accessibleByDrizzle,
	asAppSubject,
	ForbiddenError,
	toHttpError,
	UnsupportedAuthorizationConditionError,
} from "@/lib/authorization";
import {
	createBillingForbiddenResponse,
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import {
	isValidIanaTimezone,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { isWorkLocationType } from "@/lib/time-tracking/work-location";

async function getSavedUserTimezone(userId: string): Promise<string | null> {
	try {
		const settings = await db.query.userSettings.findFirst({
			where: eq(userSettings.userId, userId),
			columns: { timezone: true },
		});
		return isValidIanaTimezone(settings?.timezone) ? settings.timezone : null;
	} catch {
		return null;
	}
}

/**
 * GET /api/time-entries
 * Retrieve time entries for an employee
 * Query params: employeeId, from, to, includeSuperseded
 */
export async function GET(request: NextRequest) {
	// Opt out of caching - must be awaited immediately, not stored as promise
	await connection();

	try {
		// Parse search params
		const searchParams = request.nextUrl.searchParams;
		const employeeId = searchParams.get("employeeId");
		const from = searchParams.get("from");
		const to = searchParams.get("to");
		const includeSuperseded = searchParams.get("includeSuperseded") === "true";

		const resolvedHeaders = await headers();

		// With Bearer plugin, getSession handles both cookie and Bearer token auth
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get current user's employee record for the active organization
		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const [currentEmployee] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, activeOrgId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);

		if (!currentEmployee) {
			return NextResponse.json(
				{ error: "Employee record not found in this organization" },
				{ status: 404 },
			);
		}

		// Determine which employee's entries to fetch
		const targetEmployeeId = employeeId || currentEmployee.id;
		let timeEntryAccess: ReturnType<typeof accessibleByDrizzle> | null = null;

		// Only allow viewing own entries unless CASL permits this employee's entries.
		if (targetEmployeeId !== currentEmployee.id) {
			const ability = await getAbility();
			if (!ability) {
				const error = new ForbiddenError("read", "TimeEntry");
				const httpError = toHttpError(error);
				return NextResponse.json(httpError.body, { status: httpError.status });
			}

			try {
				timeEntryAccess = accessibleByDrizzle(ability, "read", "TimeEntry", {
					organizationId: timeEntry.organizationId,
					employeeId: timeEntry.employeeId,
				});
			} catch (error) {
				if (!(error instanceof UnsupportedAuthorizationConditionError)) {
					throw error;
				}
				// Legacy string grants may not be query-translatable yet;
				// the object check below is authoritative.
			}

			// Verify target employee is in same organization
			const [targetEmployee] = await db
				.select()
				.from(employee)
				.where(
					and(
						eq(employee.id, targetEmployeeId),
						eq(employee.organizationId, currentEmployee.organizationId),
					),
				)
				.limit(1);

			if (!targetEmployee) {
				return NextResponse.json({ error: "Employee not found" }, { status: 404 });
			}

			if (
				!ability.can(
					"read",
					asAppSubject("TimeEntry", {
						employeeId: targetEmployee.id,
						organizationId: targetEmployee.organizationId,
					}),
				)
			) {
				const error = new ForbiddenError("read", "TimeEntry");
				const httpError = toHttpError(error);
				return NextResponse.json(httpError.body, { status: httpError.status });
			}
		}

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(
				timeEntryService.getTimeEntries({
					employeeId: targetEmployeeId,
					organizationId: activeOrgId,
					from: from ? new Date(from) : undefined,
					to: to ? new Date(to) : undefined,
					includeSuperseded,
					authorizationPredicate: timeEntryAccess ?? undefined,
				}),
			);
		});

		const entries = await runtime.runPromise(effect);

		return NextResponse.json({ entries });
	} catch (error) {
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/time-entries
 * Create a new time entry (clock in/out)
 */
export async function POST(request: NextRequest) {
	// Opt out of caching - must be awaited immediately, not stored as promise
	await connection();

	try {
		// Await headers and body in parallel
		const [resolvedHeaders, body] = await Promise.all([headers(), request.json()]);

		// With Bearer plugin, getSession handles both cookie and Bearer token auth
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { type, timestamp, notes, location, projectId, workLocationType, browserTimezone, timezone } =
			body;

		// Validate required fields
		if (!type || !["clock_in", "clock_out"].includes(type)) {
			return NextResponse.json(
				{ error: "Invalid type. Must be 'clock_in' or 'clock_out'" },
				{ status: 400 },
			);
		}

		const resolvedWorkLocationType =
			type === "clock_in" ? (workLocationType ?? "office") : undefined;

		if (type === "clock_in" && !isWorkLocationType(resolvedWorkLocationType)) {
			return NextResponse.json({ error: "Invalid work location type" }, { status: 400 });
		}

		// Get current user's employee record for the active organization
		const activeOrgId = session.session.activeOrganizationId;

		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const [currentEmployee] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, activeOrgId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);

		if (!currentEmployee) {
			return NextResponse.json(
				{ error: "Employee record not found in this organization" },
				{ status: 404 },
			);
		}

		const billingAccess = await requireBillingForMutation(activeOrgId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return createBillingForbiddenResponse(billingAccess);
		}

		// Extract request metadata from already-resolved headers
		const ipAddress =
			resolvedHeaders.get("x-forwarded-for") || resolvedHeaders.get("x-real-ip") || "unknown";
		const deviceInfo = resolvedHeaders.get("user-agent") || "unknown";
		const entryTime = timestamp ? new Date(timestamp) : new Date();
		const savedTimezone = (await getSavedUserTimezone(session.user.id)) ?? "UTC";
		const requestTimezone = isValidIanaTimezone(browserTimezone)
			? browserTimezone
			: isValidIanaTimezone(timezone)
				? timezone
				: null;
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: entryTime,
			browserTimezone: requestTimezone,
			fallbackTimezone: savedTimezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(
				timeEntryService.createTimeEntry({
					employeeId: currentEmployee.id,
					organizationId: activeOrgId,
					type,
					timestamp: entryTime,
					createdBy: session.user.id,
					notes,
					location,
					ipAddress,
					deviceInfo,
					...timezoneCapture,
				}),
			);
		});

		const entry = await runtime.runPromise(effect);

		// Manage work periods based on entry type
		if (type === "clock_in") {
			// Create a new work period with organizationId
			await db.insert(workPeriod).values({
				employeeId: currentEmployee.id,
				organizationId: activeOrgId,
				clockInId: entry.id,
				startTime: entryTime,
				isActive: true,
				workLocationType: resolvedWorkLocationType,
			});
		} else if (type === "clock_out") {
			// Find and close the active work period for this employee in this org
			const [activePeriod] = await db
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, activeOrgId),
						isNull(workPeriod.endTime),
					),
				)
				.limit(1);

			if (activePeriod) {
				const durationMs = entryTime.getTime() - activePeriod.startTime.getTime();
				const durationMinutes = Math.round(durationMs / 60000);

				await db
					.update(workPeriod)
					.set({
						clockOutId: entry.id,
						endTime: entryTime,
						durationMinutes,
						isActive: false,
						...(projectId && { projectId }),
					})
					.where(eq(workPeriod.id, activePeriod.id));
			}
		}

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		// Handle Effect errors
		if (error instanceof Error && error.message.includes("NotFoundError")) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
