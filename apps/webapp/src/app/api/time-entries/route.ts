import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { validateProjectAssignment } from "@/app/[locale]/(app)/time-tracking/actions/entry-helpers";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, project, timeEntry, userSettings, workCategory } from "@/db/schema";
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
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { preserveLateClockEvidence } from "@/lib/employee-lifecycle/late-clock-evidence";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import { employeeHasAccessToCategory } from "@/lib/query/work-category.queries";
import {
  ClockingAccessError,
  ClockingConflictError,
  clockingService,
} from "@/lib/time-tracking/clocking-service";
import {
	getUtcOffsetMinutesForZone,
	isValidIanaTimezone,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { isWorkLocationType } from "@/lib/time-tracking/work-location";
import {
	classifyLegacyClockConsumer,
	fenceLegacyClockConsumerResponse,
} from "./legacy-consumer-fence";

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
		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: activeOrgId,
		});

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
const REPLAY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * A departed employee's queued extension capture is refused like any other
 * clock action, but a valid pre-cutoff capture is kept for administrator
 * review. Only complete replay evidence that would pass the accepted-replay
 * checks qualifies; it never becomes a time entry here.
 */
async function preserveRefusedReplay(userId: string, organizationId: string, body: any) {
	if (body?.replay !== true) return;
	const { id, type, timestamp, browserTimezone, utcOffsetMinutes } = body;
	if (typeof id !== "string" || !ACTION_ID_PATTERN.test(id)) return;
	if (type !== "clock_in" && type !== "clock_out") return;
	if (!timestamp || !isValidIanaTimezone(browserTimezone) || !Number.isInteger(utcOffsetMinutes)) {
		return;
	}
	const capturedAt = new Date(timestamp);
	if (Number.isNaN(capturedAt.getTime())) return;
	const ageMs = Date.now() - capturedAt.getTime();
	if (ageMs < -5 * 60_000 || ageMs > REPLAY_MAX_AGE_MS) return;
	if (getUtcOffsetMinutesForZone(capturedAt, browserTimezone) !== utcOffsetMinutes) return;
	await preserveLateClockEvidence(db, {
		organizationId,
		userId,
		actionId: id,
		type,
		instant: instantFromDate(capturedAt),
		utcOffsetMinutes,
		timezone: browserTimezone,
		receivedAt: instantFromDate(new Date()),
	});
}

export async function POST(request: NextRequest) {
	// Opt out of caching - must be awaited immediately, not stored as promise
	await connection();

	let resolvedHeaders: Headers;
	let body: any;
	try {
		// Await headers and body in parallel
		[resolvedHeaders, body] = await Promise.all([headers(), request.json()]);
	} catch {
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}

	return fenceLegacyClockConsumerResponse(
		classifyLegacyClockConsumer(resolvedHeaders, body),
		await createClockEntry(resolvedHeaders, body),
	);
}

async function createClockEntry(resolvedHeaders: Headers, body: any) {
	try {
		// With Bearer plugin, getSession handles both cookie and Bearer token auth
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		if (body && typeof body === "object" && "employeeId" in body) {
			return NextResponse.json({ error: "employeeId is server-derived" }, { status: 400 });
		}

		const {
			id,
			type,
			timestamp,
			notes,
			location,
			projectId,
			workCategoryId,
			workLocationType,
			browserTimezone,
			utcOffsetMinutes,
			replay,
			organizationId,
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

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		const activeMembership = await db.query.member.findFirst({
			where: and(eq(member.userId, session.user.id), eq(member.organizationId, activeOrgId)),
			columns: { id: true },
		});
		if (!activeMembership) {
			return NextResponse.json(
				{ error: "Active organization membership required" },
				{ status: 403 },
			);
		}
		if (organizationId !== undefined) {
			return NextResponse.json({ error: "organizationId is server-derived" }, { status: 400 });
		}
		const requestedOrgId = activeOrgId;

		if (!requestedOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		try {
			await clockingService.requireActor({
				userId: session.user.id,
				activeOrganizationId: requestedOrgId,
			});
		} catch (error) {
			if (error instanceof ClockingAccessError) {
				await preserveRefusedReplay(session.user.id, requestedOrgId, body);
			}
			throw error;
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

		const isReplay = replay === true;
		const actionId =
			typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
				? id
				: undefined;
		const requestBrowserTimezone = isValidIanaTimezone(browserTimezone) ? browserTimezone : null;
		const hasCapturedEvidence = actionId !== undefined || utcOffsetMinutes !== undefined;
		if (isReplay && !actionId) {
			return NextResponse.json(
				{ error: "Replay requires an extension action id" },
				{ status: 400 },
			);
		}
		if (
			hasCapturedEvidence &&
			(!timestamp || !requestBrowserTimezone || !Number.isInteger(utcOffsetMinutes))
		) {
			return NextResponse.json({ error: "Clock timezone evidence is incomplete" }, { status: 400 });
		}
		const entryTime = timestamp ? new Date(timestamp) : new Date();
		if (Number.isNaN(entryTime.getTime())) {
			return NextResponse.json({ error: "Invalid clock instant" }, { status: 400 });
		}
		if (hasCapturedEvidence) {
			const ageMs = Date.now() - entryTime.getTime();
			const maxAgeMs = isReplay ? 7 * 24 * 60 * 60_000 : 5 * 60_000;
			if (ageMs < -5 * 60_000 || ageMs > maxAgeMs) {
				return NextResponse.json(
					{ error: "Clock instant is outside the allowed capture window" },
					{ status: 400 },
				);
			}
			if (getUtcOffsetMinutesForZone(entryTime, requestBrowserTimezone!) !== utcOffsetMinutes) {
				return NextResponse.json(
					{ error: "Timezone offset does not match instant" },
					{ status: 400 },
				);
			}
		}
		const savedTimezone = (await getSavedUserTimezone(session.user.id)) ?? "UTC";
		const timezoneCapture = hasCapturedEvidence
			? { timezone: requestBrowserTimezone!, timezoneSource: "browser" as const, utcOffsetMinutes }
			: resolveTimeEntryTimezoneCapture({
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
				requestedOrgId,
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
				requestedOrgId,
			);
			if (!hasCategoryAccess) {
				return NextResponse.json({ error: "Cannot assign to this work category" }, { status: 400 });
			}
		}

		const input = {
			employeeId: currentEmployee.id,
			organizationId: requestedOrgId,
			createdBy: session.user.id,
			actionId,
			action: { instant: instantFromDate(entryTime), ...timezoneCapture },
			source: { ipAddress: null, deviceInfo: isReplay ? "extension-replay" : "api" },
			notes,
			location,
		};
		const result =
			type === "clock_in"
				? await clockingService.clockIn({ ...input, workLocationType: resolvedWorkLocationType! })
				: await clockingService.clockOut({ ...input, projectId, workCategoryId });
		const entry = result.entry;

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		if (error instanceof TimeEntryConflictError || error instanceof ClockingConflictError) {
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
