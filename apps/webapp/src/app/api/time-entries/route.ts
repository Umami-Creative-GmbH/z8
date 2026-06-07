import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
	createTimeEntry,
	validateProjectAssignment,
} from "@/app/[locale]/(app)/time-tracking/actions/entry-helpers";
import { db } from "@/db";
import { employee, project, timeEntry, userSettings, workCategory, workPeriod } from "@/db/schema";
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
import { employeeHasAccessToCategory } from "@/lib/query/work-category.queries";
import {
	isValidIanaTimezone,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { isWorkLocationType } from "@/lib/time-tracking/work-location";

class TimeEntryConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeEntryConflictError";
	}
}

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
	} catch (_error) {
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

		const {
			type,
			timestamp,
			notes,
			organizationId,
			location,
			projectId,
			workCategoryId,
			workLocationType,
			browserTimezone,
		} = body;

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

		// Offline sync sends the organization captured when the event happened.
		const activeOrgId = session.session.activeOrganizationId;
		const requestedOrgId =
			typeof organizationId === "string" && organizationId ? organizationId : activeOrgId;

		if (!requestedOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const [currentEmployee] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, requestedOrgId),
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

		const billingAccess = await requireBillingForMutation(requestedOrgId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return createBillingForbiddenResponse(billingAccess);
		}

		const entryTime = timestamp ? new Date(timestamp) : new Date();
		const savedTimezone = (await getSavedUserTimezone(session.user.id)) ?? "UTC";
		const requestBrowserTimezone = isValidIanaTimezone(browserTimezone) ? browserTimezone : null;
		const timezoneCapture = resolveTimeEntryTimezoneCapture({
			timestamp: entryTime,
			browserTimezone: requestBrowserTimezone,
			fallbackTimezone: savedTimezone,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});

		if (projectId) {
			const [assignedProject] = await db
				.select()
				.from(project)
				.where(and(eq(project.id, projectId), eq(project.organizationId, requestedOrgId)))
				.limit(1);

			if (!assignedProject) {
				return NextResponse.json({ error: "Project not found" }, { status: 400 });
			}

			const projectValidation = await validateProjectAssignment(
				projectId,
				currentEmployee.id,
				currentEmployee.teamId,
			);
			if (!projectValidation.isValid) {
				return NextResponse.json(
					{ error: projectValidation.error || "Cannot assign to this project" },
					{ status: 400 },
				);
			}
		}

		if (workCategoryId) {
			const [category] = await db
				.select()
				.from(workCategory)
				.where(
					and(
						eq(workCategory.id, workCategoryId),
						eq(workCategory.organizationId, requestedOrgId),
						eq(workCategory.isActive, true),
					),
				)
				.limit(1);

			if (!category) {
				return NextResponse.json({ error: "Work category not found" }, { status: 400 });
			}

			const hasCategoryAccess = await employeeHasAccessToCategory(
				currentEmployee.id,
				workCategoryId,
			);
			if (!hasCategoryAccess) {
				return NextResponse.json({ error: "Cannot assign to this work category" }, { status: 400 });
			}
		}

		const entry = await db.transaction(async (tx) => {
			const lockKey = `${requestedOrgId}:${currentEmployee.id}`;
			await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

			const [activePeriod] = await tx
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, requestedOrgId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
					),
				)
				.limit(1);

			if (type === "clock_in" && activePeriod) {
				throw new TimeEntryConflictError("Active work period already exists");
			}

			if (type === "clock_out" && !activePeriod) {
				throw new Error("No active work period found");
			}

			const createdEntry = await createTimeEntry(
				{
					employeeId: currentEmployee.id,
					organizationId: requestedOrgId,
					type,
					timestamp: entryTime,
					createdBy: session.user.id,
					notes,
					location,
					...timezoneCapture,
				},
				tx,
			);

			if (type === "clock_in") {
				await tx.insert(workPeriod).values({
					employeeId: currentEmployee.id,
					organizationId: requestedOrgId,
					clockInId: createdEntry.id,
					startTime: entryTime,
					isActive: true,
					workLocationType: resolvedWorkLocationType,
				});
			} else if (activePeriod) {
				const durationMs = entryTime.getTime() - activePeriod.startTime.getTime();
				const durationMinutes = Math.round(durationMs / 60000);

				const updatedPeriods = await tx
					.update(workPeriod)
					.set({
						clockOutId: createdEntry.id,
						endTime: entryTime,
						durationMinutes,
						isActive: false,
						...(projectId && { projectId }),
						...(workCategoryId && { workCategoryId }),
					})
					.where(
						and(
							eq(workPeriod.id, activePeriod.id),
							eq(workPeriod.employeeId, currentEmployee.id),
							eq(workPeriod.organizationId, requestedOrgId),
							eq(workPeriod.isActive, true),
							isNull(workPeriod.endTime),
						),
					)
					.returning({ id: workPeriod.id });

				if (updatedPeriods.length === 0) {
					throw new TimeEntryConflictError("Active work period changed");
				}
			}

			return createdEntry;
		});

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		if (error instanceof TimeEntryConflictError) {
			return NextResponse.json({ error: error.message }, { status: 409 });
		}

		if (error instanceof Error && error.message === "No active work period found") {
			return NextResponse.json({ error: "No active work period found" }, { status: 400 });
		}

		// Handle Effect errors
		if (error instanceof Error && error.message.includes("NotFoundError")) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
