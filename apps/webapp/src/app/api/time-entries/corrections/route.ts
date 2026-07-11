import { and, eq, isNull, or } from "drizzle-orm";
import { Cause, Effect, Either, Option, Runtime } from "effect";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { getUserTimezone } from "@/app/[locale]/(app)/time-tracking/actions/auth";
import { resolveCorrectionApprovalManager } from "@/app/[locale]/(app)/time-tracking/actions/corrections";
import { createTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions/entry-helpers";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import { db } from "@/db";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import { createTimeCorrectionApprovalWorkflow } from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { auth } from "@/lib/auth";
import { canApproveFor, getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import {
	isValidIanaTimezone,
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";

const RFC3339_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseCorrectionTimestamp(value: unknown) {
	if (typeof value !== "string" || !RFC3339_WITH_OFFSET.test(value)) {
		return null;
	}

	const parsed = DateTime.fromISO(value, { setZone: true });
	return parsed.isValid ? parsed.toUTC() : null;
}

type CorrectionDomainError = ConflictError | NotFoundError | ValidationError;

function getCorrectionDomainError(error: unknown): CorrectionDomainError | null {
	if (
		error instanceof ConflictError ||
		error instanceof NotFoundError ||
		error instanceof ValidationError
	) {
		return error;
	}
	if (!Runtime.isFiberFailure(error)) {
		return null;
	}

	const failure = Option.getOrNull(Cause.failureOption(error[Runtime.FiberFailureCauseId]));
	return failure instanceof ConflictError ||
		failure instanceof NotFoundError ||
		failure instanceof ValidationError
		? failure
		: null;
}

function createTransactionalApprovalDbService(
	client: Parameters<Parameters<typeof db.transaction>[0]>[0],
): ApprovalDbService {
	return {
		db: client,
		query: (name, query) =>
			Effect.tryPromise({
				try: query,
				catch: (cause) =>
					new DatabaseError({
						message: `Database query failed: ${name}`,
						operation: name,
						cause,
					}),
			}),
	};
}

async function markWorkBalanceDirtyAfterDirectCorrectionBestEffort(input: {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string;
}) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error(
			{ error, ...input },
			"Failed to mark work balance dirty after direct time correction",
		);
	}
}

/**
 * POST /api/time-entries/corrections
 * Submit a correction for a time entry
 * Requires approval from a manager/admin
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		await clockingService.requireActor({ userId: session.user.id, activeOrganizationId: activeOrgId });

		const body = await request.json();
		const { replacesEntryId, timestamp, notes, timezone } = body;

		// Validate required fields
		if (!replacesEntryId) {
			return NextResponse.json({ error: "replacesEntryId is required" }, { status: 400 });
		}

		if (!timestamp) {
			return NextResponse.json({ error: "timestamp is required" }, { status: 400 });
		}
		const correctionDateTime = parseCorrectionTimestamp(timestamp);
		if (!correctionDateTime) {
			return NextResponse.json(
				{ error: "timestamp must be a valid RFC3339 value with an explicit offset" },
				{ status: 400 },
			);
		}
		if (timezone !== undefined && !isValidIanaTimezone(timezone)) {
			return NextResponse.json(
				{ error: "timezone must be a valid IANA timezone" },
				{ status: 400 },
			);
		}
		if (!notes) {
			return NextResponse.json({ error: "notes is required for corrections" }, { status: 400 });
		}

		// Get current user's employee record for the active organization ONLY
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

		// Resolve every target record inside the active organization before authorization.
		const [entryToCorrect] = await db
			.select()
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.id, replacesEntryId),
					eq(timeEntry.organizationId, activeOrgId),
					eq(timeEntry.isSuperseded, false),
				),
			)
			.limit(1);

		if (!entryToCorrect) {
			return NextResponse.json({ error: "Time entry to correct not found" }, { status: 404 });
		}

		// Get the employee who owns the entry
		const [entryOwner] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.id, entryToCorrect.employeeId),
					eq(employee.organizationId, activeOrgId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);

		if (!entryOwner) {
			return NextResponse.json({ error: "Entry owner not found" }, { status: 404 });
		}

		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.employeeId, entryOwner.id),
					eq(workPeriod.organizationId, activeOrgId),
					isNull(workPeriod.deletedAt),
					or(eq(workPeriod.clockInId, replacesEntryId), eq(workPeriod.clockOutId, replacesEntryId)),
				),
			)
			.limit(1);

		if (!selectedWorkPeriod) {
			return NextResponse.json({ error: "Work period not found" }, { status: 404 });
		}

		const correctsClockIn = selectedWorkPeriod.clockInId === replacesEntryId;
		const correctionTimestamp = correctionDateTime.toJSDate();
		if (
			correctsClockIn &&
			selectedWorkPeriod.endTime &&
			correctionDateTime >= DateTime.fromJSDate(selectedWorkPeriod.endTime, { zone: "utc" })
		) {
			return NextResponse.json(
				{ error: "Clock out time must be after clock in time" },
				{ status: 400 },
			);
		}
		if (
			!correctsClockIn &&
			correctionDateTime <= DateTime.fromJSDate(selectedWorkPeriod.startTime, { zone: "utc" })
		) {
			return NextResponse.json(
				{ error: "Clock out time must be after clock in time" },
				{ status: 400 },
			);
		}

		// Check authorization using CASL
		// Self-correction: Employee can request correction of their own entries (but needs approval)
		// Admin/Manager correction: Can directly correct entries of employees they manage
		const isSelfCorrection = entryToCorrect.employeeId === currentEmployee.id;
		const canApprove = await canApproveFor(entryToCorrect.employeeId);

		if (!isSelfCorrection && !canApprove) {
			const error = new ForbiddenError("update", "TimeEntry");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const targetTimezone = await getUserTimezone(entryOwner.userId);
		const timezoneCapture = isSelfCorrection
			? timezone
				? resolveTimeEntryTimezoneCapture({
						timestamp: correctionTimestamp,
						browserTimezone: timezone,
						fallbackTimezone: targetTimezone,
						browserSource: "browser",
						fallbackSource: "user_setting",
					})
				: resolveFallbackTimezoneCapture({
						timestamp: correctionTimestamp,
						timezone: targetTimezone,
						timezoneSource: "user_setting",
					})
			: resolveFallbackTimezoneCapture({
					timestamp: correctionTimestamp,
					timezone: targetTimezone,
					timezoneSource: "manager_target_user_setting",
				});

		// Get request metadata
		const headersList = await headers();
		const ipAddress =
			headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown";
		const deviceInfo = headersList.get("user-agent") || "unknown";

		if (isSelfCorrection && !canApprove) {
			const managerDecision = await resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: currentEmployee.id,
				organizationId: activeOrgId,
			});
			if (!managerDecision.ok) {
				return NextResponse.json({ error: managerDecision.message }, { status: 400 });
			}

			const result = await db.transaction(async (tx) => {
				const correctionEntry = await createTimeEntry(
					{
						employeeId: entryOwner.id,
						organizationId: activeOrgId,
						type: "correction",
						timestamp: correctionTimestamp,
						createdBy: session.user.id,
						replacesEntryId,
						notes,
						isSuperseded: true,
						...timezoneCapture,
					},
					tx,
				);
				const approvalResult = await Effect.runPromise(
					Effect.either(
						createTimeCorrectionApprovalWorkflow(createTransactionalApprovalDbService(tx), {
							organizationId: activeOrgId,
							requesterEmployeeId: currentEmployee.id,
							teamId: currentEmployee.teamId ?? null,
							workPeriodId: selectedWorkPeriod.id,
							defaultApproverId: managerDecision.managerId,
							reason: notes,
							overtimeRisk: "warning",
							correctionEntryIds: correctsClockIn
								? { clockInCorrectionId: correctionEntry.id }
								: { clockOutCorrectionId: correctionEntry.id },
						}),
					),
				);
				if (Either.isLeft(approvalResult)) {
					throw approvalResult.left;
				}

				return { correctionEntry, approvalId: approvalResult.right.approvalRequestId };
			});

			return NextResponse.json(
				{
					entry: result.correctionEntry,
					approvalId: result.approvalId,
					message: "Correction submitted. Awaiting manager approval.",
				},
				{ status: 201 },
			);
		}

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(
				timeEntryService.createCorrectionEntry({
					employeeId: entryToCorrect.employeeId,
					organizationId: currentEmployee.organizationId,
					replacesEntryId,
					workPeriodId: selectedWorkPeriod.id,
					timestamp: correctionTimestamp,
					createdBy: session.user.id,
					notes,
					ipAddress,
					deviceInfo,
					...timezoneCapture,
				}),
			);
		});

		const correctionEntry = await runtime.runPromise(effect);
		const originalStart = DateTime.fromJSDate(selectedWorkPeriod.startTime, { zone: "utc" });
		const correctedStart = correctsClockIn ? correctionDateTime : originalStart;
		await markWorkBalanceDirtyAfterDirectCorrectionBestEffort({
			dirtyFromDate: DateTime.min(originalStart, correctedStart).toISODate() ?? undefined,
			employeeId: entryToCorrect.employeeId,
			organizationId: activeOrgId,
		});

		return NextResponse.json(
			{
				entry: correctionEntry,
				message:
					isSelfCorrection && !canApprove
						? "Correction submitted. Awaiting manager approval."
						: "Correction applied successfully.",
			},
			{ status: 201 },
		);
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		const domainError = getCorrectionDomainError(error);
		if (domainError instanceof ConflictError) {
			return NextResponse.json(
				{ error: domainError.message, code: domainError.conflictType },
				{ status: 409 },
			);
		}
		if (domainError instanceof NotFoundError) {
			return NextResponse.json({ error: domainError.message }, { status: 404 });
		}
		if (domainError instanceof ValidationError) {
			return NextResponse.json({ error: domainError.message }, { status: 400 });
		}
		console.error("Error creating correction entry:", error);

		// Handle specific Effect errors
		if (error instanceof Error) {
			if (error.message.includes("NotFoundError")) {
				return NextResponse.json({ error: "Entry not found" }, { status: 404 });
			}
			if (error.message.includes("ValidationError")) {
				return NextResponse.json({ error: error.message }, { status: 400 });
			}
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * GET /api/time-entries/corrections
 * Get correction history for an entry or all corrections for an employee
 */
export async function GET(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		await clockingService.requireActor({ userId: session.user.id, activeOrganizationId: activeOrgId });

		const searchParams = request.nextUrl.searchParams;
		const employeeId = searchParams.get("employeeId");
		const entryId = searchParams.get("entryId");

		// Get current user's employee record for the active organization ONLY
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

		// Build query conditions
		const conditions = [
			eq(timeEntry.type, "correction"),
			eq(timeEntry.organizationId, activeOrgId),
		];

		if (entryId) {
			// Get the original entry and its correction
			const [originalEntry] = await db
				.select()
				.from(timeEntry)
				.where(and(eq(timeEntry.id, entryId), eq(timeEntry.organizationId, activeOrgId)))
				.limit(1);

			if (!originalEntry) {
				return NextResponse.json({ error: "Entry not found" }, { status: 404 });
			}

			// Check authorization using CASL
			if (originalEntry.employeeId !== currentEmployee.id) {
				const ability = await getAbility();
				if (!ability || ability.cannot("manage", "TimeEntry")) {
					const error = new ForbiddenError("read", "TimeEntry");
					const httpError = toHttpError(error);
					return NextResponse.json(httpError.body, { status: httpError.status });
				}
			}

			conditions.push(eq(timeEntry.replacesEntryId, entryId));
		} else {
			// Get all corrections for an employee
			const targetEmployeeId = employeeId || currentEmployee.id;

			if (employeeId) {
				const [targetEmployee] = await db
					.select()
					.from(employee)
					.where(
						and(
							eq(employee.id, employeeId),
							eq(employee.organizationId, activeOrgId),
							eq(employee.isActive, true),
						),
					)
					.limit(1);

				if (!targetEmployee) {
					return NextResponse.json({ error: "Employee not found" }, { status: 404 });
				}
			}

			// Only allow viewing own corrections unless user can manage time entries
			if (targetEmployeeId !== currentEmployee.id) {
				const ability = await getAbility();
				if (!ability || ability.cannot("manage", "TimeEntry")) {
					const error = new ForbiddenError("read", "TimeEntry");
					const httpError = toHttpError(error);
					return NextResponse.json(httpError.body, { status: httpError.status });
				}
			}

			conditions.push(eq(timeEntry.employeeId, targetEmployeeId));
		}

		const corrections = await db
			.select()
			.from(timeEntry)
			.where(and(...conditions));

		return NextResponse.json({ corrections });
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		console.error("Error fetching corrections:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
