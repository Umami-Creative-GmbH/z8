import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, timeEntry, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import {
	accessibleByDrizzle,
	asAppSubject,
	ForbiddenError,
	toHttpError,
	UnsupportedAuthorizationConditionError,
} from "@/lib/authorization";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import { preserveLateClockEvidence } from "@/lib/employee-lifecycle/late-clock-evidence";
import { createLogger } from "@/lib/logger";
import type { AttributionIntent } from "@/lib/time-tracking/close-active-work";
import {
	type ClockInRefusal,
	type ClockOutRefusal,
	type ClockOutResult,
	clocking,
} from "@/lib/time-tracking/clocking";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";
import { isProjectTaskId } from "@/lib/time-tracking/task-attribution";
import {
	getUtcOffsetMinutesForZone,
	isValidIanaTimezone,
} from "@/lib/time-tracking/timezone-capture";
import {
	classifyLegacyClockConsumer,
	fenceLegacyClockConsumerResponse,
} from "./legacy-consumer-fence";

const logger = createLogger("LegacyClockRoute");

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

		const effect = Effect.gen(function* () {
			const timeEntryService = yield* TimeEntryService;
			return yield* timeEntryService.getTimeEntries({
				employeeId: targetEmployeeId,
				organizationId: activeOrgId,
				from: from ? new Date(from) : undefined,
				to: to ? new Date(to) : undefined,
				includeSuperseded,
				authorizationPredicate: timeEntryAccess ?? undefined,
			});
		});

		const entries = await runtime.runPromise(effect);

		return NextResponse.json({ entries });
	} catch (_error) {
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

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

/** Omitted attribution preserves the period's; `null` or an empty ID clears it. */
function attributionOf(value: unknown): AttributionIntent {
	if (value === undefined) return { kind: "preserve" };
	return typeof value === "string" && value ? { kind: "replace", id: value } : { kind: "clear" };
}

/**
 * The project task of a clock-out (#875): omitted, the task follows the project;
 * `null` or an empty ID clears it. Anything else that cannot name a task (a
 * malformed ID, a number, a boolean) is refused as an unknown task before
 * anything runs.
 */
function taskAttributionOf(value: unknown): { ok: true; task?: AttributionIntent } | { ok: false } {
	if (value === undefined) return { ok: true };
	if (value === null || value === "") return { ok: true, task: { kind: "clear" } };
	return isProjectTaskId(value) ? { ok: true, task: { kind: "replace", id: value } } : { ok: false };
}

type LegacyClockFailure = ClockInRefusal["code"] | ClockOutRefusal["code"];

/**
 * Every failure, as the route's established status and error text. Old queue
 * readers retain 401 and 409 (#266); the fence rewrites the extension's 400.
 */
const FAILURE_REPLIES: Record<
	Exclude<LegacyClockFailure, "billing_required" | "legacy_not_accepted">,
	{ status: number; error: string }
> = {
	access_denied: { status: 403, error: "Active employee record required for the organization" },
	invalid_command: { status: 400, error: "Invalid clock action id" },
	invalid_work_location: { status: 400, error: "Invalid work location type" },
	// Legacy commands carry no freshness; the route checks the capture window itself.
	admission_window: { status: 400, error: "Clock instant is outside the allowed capture window" },
	collision: { status: 409, error: "Clock action id collision" },
	append_review_required: {
		status: 409,
		error: "Clock action was not saved because time history needs review",
	},
	frozen_not_accepted: { status: 400, error: "Invalid clock action" },
	already_clocked_in: { status: 409, error: "Active work period already exists" },
	holiday_blocked: { status: 409, error: "Clock-in is not allowed on a holiday" },
	occupancy_conflict: { status: 409, error: "Clock-in overlaps recorded work" },
	// Legacy closures always close the active work.
	not_clocked_in: { status: 409, error: "No active work period found" },
	target_unknown: { status: 409, error: "No active work period found" },
	target_not_active: { status: 409, error: "No active work period found" },
	project_not_allowed: { status: 400, error: "Cannot assign to this project" },
	// Also names the stable reason; see `refusedResponse`.
	task_not_allowed: { status: 400, error: "Cannot book time to this task" },
	work_category_not_allowed: { status: 400, error: "Cannot assign to this work category" },
	invalid_interval: { status: 409, error: "Clock-out precedes clock-in" },
	failed: { status: 500, error: "Internal server error" },
	unconfirmed: { status: 500, error: "Internal server error" },
};

function refusedResponse(failure: ClockInRefusal | ClockOutRefusal) {
	switch (failure.code) {
		case "billing_required":
			// The billing guard's response shape.
			return NextResponse.json(
				{ error: "billing_required", reason: failure.reason },
				{ status: 402 },
			);
		case "legacy_not_accepted":
			// The #327 fence's response: every legacy queue reader retains 409.
			return NextResponse.json(
				{
					error: "This organization only accepts coordinated clock commands",
					code: "append_adopted",
				},
				{ status: 409 },
			);
		case "task_not_allowed":
			// The stable task reason, worded as the other clock adapters word it (#875).
			return NextResponse.json(
				{
					error: FAILURE_REPLIES.task_not_allowed.error,
					code: "attribution_not_allowed",
					field: "taskId",
					reason: failure.reason,
				},
				{ status: FAILURE_REPLIES.task_not_allowed.status },
			);
		case "failed":
		case "unconfirmed":
			logger.error({ error: failure.cause }, "Legacy clock command failed");
			break;
	}
	const { status, error } = FAILURE_REPLIES[failure.code];
	return NextResponse.json({ error }, { status });
}

/** The entry alone, as legacy consumers read it; closure advice stays with the web. */
function entryOf(result: ClockOutResult) {
	const { complianceWarnings, breakAdjustment, pendingApproval, ...entry } = result;
	return entry;
}

/**
 * POST /api/time-entries
 * The legacy direct clock route (#483): a thin adapter over the Clocking module
 * for old consumers, the legacy desktop transport and the old service-worker and
 * extension queues. It keeps only its transport checks: the capture evidence
 * with its committed-action pre-read ahead of the age window, and the #266 queue
 * fence. Its commands are legacy commands, which adopted organizations refuse.
 */
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
		await runLegacyClockCommand(resolvedHeaders, body),
	);
}

async function runLegacyClockCommand(resolvedHeaders: Headers, body: any) {
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
			projectId,
			taskId,
			workCategoryId,
			workLocationType,
			browserTimezone,
			utcOffsetMinutes,
			replay,
			organizationId,
		} = body;

		if (type !== "clock_in" && type !== "clock_out") {
			return NextResponse.json(
				{ error: "Invalid type. Must be 'clock_in' or 'clock_out'" },
				{ status: 400 },
			);
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
		// Authentication; the Clocking module authorizes the command.
		let actor: Awaited<ReturnType<typeof clockingService.requireActor>>;
		try {
			actor = await clockingService.requireActor({
				userId: session.user.id,
				activeOrganizationId: activeOrgId,
			});
		} catch (error) {
			if (error instanceof ClockingAccessError) {
				await preserveRefusedReplay(session.user.id, activeOrgId, body);
			}
			throw error;
		}

		const isReplay = replay === true;
		// Postgres compares UUIDs case-insensitively; the module's identities are lowercase.
		const actionId =
			typeof id === "string" && ACTION_ID_PATTERN.test(id) ? id.toLowerCase() : undefined;
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
		const entryTime = timestamp ? new Date(timestamp) : null;
		if (entryTime && Number.isNaN(entryTime.getTime())) {
			return NextResponse.json({ error: "Invalid clock instant" }, { status: 400 });
		}
		// Historical committed recovery precedes fresh age admission (#275): an
		// action id that already committed in this scope replays through the
		// module's legacy matcher at any age. Absence of an entry proves nothing
		// about identity-less requests, which keep their rules.
		const [committedAction] = actionId
			? await db
					.select({ id: timeEntry.id })
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.id, actionId),
							eq(timeEntry.employeeId, actor.employee.id),
							eq(timeEntry.organizationId, activeOrgId),
						),
					)
					.limit(1)
			: [];
		if (entryTime && hasCapturedEvidence && !committedAction) {
			const ageMs = Date.now() - entryTime.getTime();
			const maxAgeMs = isReplay ? REPLAY_MAX_AGE_MS : 5 * 60_000;
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

		const command = {
			organizationId: activeOrgId,
			principal: { kind: "user" as const, userId: session.user.id },
			subject: { employeeId: actor.employee.id },
			// An action id names one attempt across retries; without one, nothing replays.
			identity: actionId
				? { origin: "client" as const, id: actionId }
				: { origin: "server" as const, id: randomUUID() },
			channel: "api" as const,
			legacy: true as const,
			at: entryTime
				? { kind: "occurred" as const, instant: instantFromDate(entryTime) }
				: { kind: "now" as const },
			zone: {
				device: requestBrowserTimezone,
				fallback: (await getSavedUserTimezone(session.user.id)) ?? "UTC",
			},
		};
		const task = taskAttributionOf(taskId);
		if (type === "clock_out" && !task.ok) {
			return refusedResponse({ code: "task_not_allowed", reason: "task_not_found" });
		}
		const outcome =
			type === "clock_in"
				? await clocking.run({
						...command,
						body: { kind: "clock_in", workLocationType: workLocationType ?? "office" },
					})
				: await clocking.run({
						...command,
						body: {
							kind: "clock_out",
							project: attributionOf(projectId),
							workCategory: attributionOf(workCategoryId),
							...(task.ok && task.task ? { task: task.task } : {}),
						},
					});
		if (outcome.outcome === "refused") return refusedResponse(outcome.failure);
		// A replayed command answers as it did when it was first saved.
		return NextResponse.json({ entry: entryOf(outcome.result) }, { status: 201 });
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		logger.error({ error }, "Legacy clock command failed");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
