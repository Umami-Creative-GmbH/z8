import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { Cause, Effect, Option, Runtime } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { getUserTimezone } from "@/app/[locale]/(app)/time-tracking/actions/auth";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import { db } from "@/db";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import {
	dispatchCommittedTimeCorrectionSubmission,
	submitCorrection,
} from "@/lib/approvals/server/time-correction-submission";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { auth } from "@/lib/auth";
import { canApproveFor, getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import {
	ClockingAccessError,
	clockingService,
} from "@/lib/time-tracking/clocking-service";
import {
	dirtyFromDateForTimeCorrection,
	instantFromTimeCorrectionBoundary,
	instantToTimeCorrectionDate,
	parseTimeCorrectionRfc3339,
	validateTimeCorrectionRange,
	validateTimeCorrectionTimezoneEvidence,
} from "@/lib/time-tracking/time-correction-temporal";
import {
	isValidIanaTimezone,
	resolveFallbackTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CorrectionDomainError =
	| AuthorizationError
	| ConflictError
	| NotFoundError
	| ValidationError;

function getCorrectionDomainError(
	error: unknown,
): CorrectionDomainError | null {
	if (
		error instanceof AuthorizationError ||
		error instanceof ConflictError ||
		error instanceof NotFoundError ||
		error instanceof ValidationError
	) {
		return error;
	}
	if (!Runtime.isFiberFailure(error)) {
		return null;
	}

	const failure = Option.getOrNull(
		Cause.failureOption(error[Runtime.FiberFailureCauseId]),
	);
	return failure instanceof AuthorizationError ||
		failure instanceof ConflictError ||
		failure instanceof NotFoundError ||
		failure instanceof ValidationError
		? failure
		: null;
}

function createTransactionalApprovalDbService(
	client: ApprovalDbService["db"],
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
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}
		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: activeOrgId,
		});

		const body = await request.json();
		const { replacesEntryId, timestamp, notes, timezone } = body;

		// Validate required fields
		if (
			typeof replacesEntryId !== "string" ||
			replacesEntryId.trim().length === 0
		) {
			return NextResponse.json(
				{ error: "replacesEntryId is required" },
				{ status: 400 },
			);
		}

		if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
			return NextResponse.json(
				{ error: "timestamp is required" },
				{ status: 400 },
			);
		}
		let parsedCorrection: ReturnType<typeof parseTimeCorrectionRfc3339>;
		try {
			parsedCorrection = parseTimeCorrectionRfc3339(timestamp);
		} catch {
			return NextResponse.json(
				{
					error:
						"timestamp must be a valid RFC3339 value with an explicit offset",
				},
				{ status: 400 },
			);
		}
		if (
			timezone !== undefined &&
			(typeof timezone !== "string" || !isValidIanaTimezone(timezone))
		) {
			return NextResponse.json(
				{ error: "timezone must be a valid IANA timezone" },
				{ status: 400 },
			);
		}
		if (typeof notes !== "string" || notes.trim().length === 0) {
			return NextResponse.json(
				{ error: "notes is required for corrections" },
				{ status: 400 },
			);
		}
		const idempotencyKey = request.headers.get("Idempotency-Key");
		if (idempotencyKey !== null && !UUID.test(idempotencyKey)) {
			return NextResponse.json(
				{ error: "Idempotency-Key must be a valid UUID" },
				{ status: 400 },
			);
		}
		// Headerless requests remain accepted, but transport retries are only
		// idempotent when clients provide a stable Idempotency-Key.
		const submissionId = idempotencyKey
			? idempotencyKey.toLowerCase()
			: randomUUID();

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
			return NextResponse.json(
				{ error: "Time entry to correct not found" },
				{ status: 404 },
			);
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
			return NextResponse.json(
				{ error: "Entry owner not found" },
				{ status: 404 },
			);
		}

		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.employeeId, entryOwner.id),
					eq(workPeriod.organizationId, activeOrgId),
					isNull(workPeriod.deletedAt),
					or(
						eq(workPeriod.clockInId, replacesEntryId),
						eq(workPeriod.clockOutId, replacesEntryId),
					),
				),
			)
			.limit(1);

		if (!selectedWorkPeriod) {
			return NextResponse.json(
				{ error: "Work period not found" },
				{ status: 404 },
			);
		}

		const correctsClockIn = selectedWorkPeriod.clockInId === replacesEntryId;
		const isSelfCorrection = entryToCorrect.employeeId === currentEmployee.id;
		try {
			validateTimeCorrectionRange(
				correctsClockIn
					? parsedCorrection.instant
					: instantFromTimeCorrectionBoundary(selectedWorkPeriod.startTime),
				correctsClockIn
					? selectedWorkPeriod.endTime
						? instantFromTimeCorrectionBoundary(selectedWorkPeriod.endTime)
						: null
					: parsedCorrection.instant,
			);
		} catch {
			return NextResponse.json(
				{ error: "Clock out time must be after clock in time" },
				{ status: 400 },
			);
		}
		const targetTimezone = await getUserTimezone(entryOwner.userId);
		const selectedTimezone =
			isSelfCorrection && timezone ? timezone : targetTimezone;
		const trustedEvidence = { ...parsedCorrection, timezone: selectedTimezone };
		try {
			validateTimeCorrectionTimezoneEvidence(trustedEvidence);
		} catch {
			return NextResponse.json(
				{
					error:
						"timestamp offset does not match timezone at the event instant",
				},
				{ status: 400 },
			);
		}

		// Check authorization using CASL after validating the scoped target data.
		const canApprove = await canApproveFor(entryToCorrect.employeeId);
		if (!isSelfCorrection && !canApprove) {
			const error = new ForbiddenError("update", "TimeEntry");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}
		const trustedCorrectionTimestamp = instantToTimeCorrectionDate(
			trustedEvidence.instant,
		);
		const timezoneCapture = {
			timezone: trustedEvidence.timezone,
			utcOffsetMinutes: trustedEvidence.utcOffsetMinutes,
			timezoneSource: isSelfCorrection
				? timezone
					? ("browser" as const)
					: ("user_setting" as const)
				: ("manager_target_user_setting" as const),
		};

		// Get request metadata
		const headersList = await headers();
		const ipAddress =
			headersList.get("x-forwarded-for") ||
			headersList.get("x-real-ip") ||
			"unknown";
		const deviceInfo = headersList.get("user-agent") || "unknown";

		if (isSelfCorrection && !canApprove) {
			const approvalResult = await submitCorrection({
				dbService: createTransactionalApprovalDbService(db),
				organizationId: activeOrgId,
				employeeId: currentEmployee.id,
				userId: session.user.id,
				submissionId,
				workPeriodId: selectedWorkPeriod.id,
				expectedClockInId: selectedWorkPeriod.clockInId,
				expectedClockOutId: selectedWorkPeriod.clockOutId,
				expectedStartTime: selectedWorkPeriod.startTime,
				expectedEndTime: selectedWorkPeriod.endTime,
				action: "edit",
				reason: notes,
				endpoints: [
					{
						endpointType: correctsClockIn ? "clock_in" : "clock_out",
						originalEntryId: replacesEntryId,
						timestamp: trustedCorrectionTimestamp,
						timezoneCapture,
					},
				],
			});
			if (approvalResult.postCommit.authority === "legacy") {
				try {
					await dispatchCommittedTimeCorrectionSubmission({
						organizationId: activeOrgId,
						employeeId: currentEmployee.id,
						workPeriodId: selectedWorkPeriod.id,
						reason: notes,
						period: selectedWorkPeriod,
						correctedClockIn: correctsClockIn
							? trustedCorrectionTimestamp
							: selectedWorkPeriod.startTime,
						correctedClockOut: correctsClockIn
							? (selectedWorkPeriod.endTime ?? undefined)
							: trustedCorrectionTimestamp,
						result: approvalResult,
					});
				} catch (error) {
					logger.error(
						{ error },
						"Failed to dispatch committed REST correction effects",
					);
				}
			}
			const correctionEntryId = approvalResult.correctionEntryIds[0];
			const persistedResponseEntry = correctionEntryId
				? await db.query.timeEntry.findFirst({
						where: and(
							eq(timeEntry.id, correctionEntryId),
							eq(timeEntry.organizationId, activeOrgId),
							eq(timeEntry.employeeId, entryOwner.id),
							eq(timeEntry.type, "correction"),
							eq(
								timeEntry.isSuperseded,
								approvalResult.kind !== "auto_completed",
							),
						),
					})
				: null;
			const responseEntry =
				persistedResponseEntry ??
				(approvalResult.disposition === "replayed"
					? approvalResult.correctionEntries?.find(
							(entry) => entry.id === correctionEntryId,
						)
					: null);
			if (!responseEntry) {
				throw new NotFoundError({
					message: "Correction entry not found after submission",
					entityType: "time_entry",
					entityId: correctionEntryId,
				});
			}
			return NextResponse.json(
				{
					entry: responseEntry,
					approvalId: approvalResult.approvalRequestId,
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
					timestamp: trustedCorrectionTimestamp,
					createdBy: session.user.id,
					notes,
					ipAddress,
					deviceInfo,
					...timezoneCapture,
				}),
			);
		});

		const correctionEntry = await runtime.runPromise(effect);
		const originalTimezoneCapture =
			entryToCorrect.timezone &&
			Number.isInteger(entryToCorrect.utcOffsetMinutes)
				? {
						timezone: entryToCorrect.timezone,
						utcOffsetMinutes: entryToCorrect.utcOffsetMinutes as number,
					}
				: resolveFallbackTimezoneCapture({
						timestamp: entryToCorrect.timestamp,
						timezone: entryToCorrect.timezone ?? targetTimezone,
						timezoneSource: "manager_target_user_setting",
					});
		const dirtyFromDate = dirtyFromDateForTimeCorrection([
			{
				instant: instantFromTimeCorrectionBoundary(entryToCorrect.timestamp),
				...originalTimezoneCapture,
			},
			trustedEvidence,
		]);
		await markWorkBalanceDirtyAfterDirectCorrectionBestEffort({
			dirtyFromDate: dirtyFromDate ?? undefined,
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
		if (domainError instanceof AuthorizationError) {
			return NextResponse.json({ error: domainError.message }, { status: 403 });
		}
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

		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
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
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}
		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: activeOrgId,
		});

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
				.where(
					and(
						eq(timeEntry.id, entryId),
						eq(timeEntry.organizationId, activeOrgId),
					),
				)
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
					return NextResponse.json(httpError.body, {
						status: httpError.status,
					});
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
					return NextResponse.json(
						{ error: "Employee not found" },
						{ status: 404 },
					);
				}
			}

			// Only allow viewing own corrections unless user can manage time entries
			if (targetEmployeeId !== currentEmployee.id) {
				const ability = await getAbility();
				if (!ability || ability.cannot("manage", "TimeEntry")) {
					const error = new ForbiddenError("read", "TimeEntry");
					const httpError = toHttpError(error);
					return NextResponse.json(httpError.body, {
						status: httpError.status,
					});
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
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
