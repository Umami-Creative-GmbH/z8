import { and, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
	calculateAndPersistSurcharges,
	checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut,
} from "@/app/[locale]/(app)/time-tracking/actions/compliance";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import { db } from "@/db";
import { employee, userSettings, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { asAppSubject, ForbiddenError, toHttpError } from "@/lib/authorization";
import {
	createBillingForbiddenResponse,
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import {
	isValidIanaTimezone,
	resolveFallbackTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import {
  ClockingAccessError,
  ClockingConflictError,
  clockingService,
} from "@/lib/time-tracking/clocking-service";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";

class TimeEntryConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeEntryConflictError";
	}
}

async function markWorkBalanceDirtyAfterOnBehalfClockOutBestEffort(input: {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string;
}) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error(
			{ error, employeeId: input.employeeId, organizationId: input.organizationId },
			"Failed to mark work balance dirty after on-behalf clock-out",
		);
	}
}

export async function POST(request: NextRequest) {
	await connection();

	try {
		const body = await request.json();
		const workPeriodId = body?.workPeriodId;

		if (typeof workPeriodId !== "string" || !workPeriodId) {
			return NextResponse.json({ error: "workPeriodId is required" }, { status: 400 });
		}

		const resolvedHeaders = await headers();
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		await clockingService.requireActor({ userId: session.user.id, activeOrganizationId: organizationId });

		const [actorEmployee] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);

		if (!actorEmployee) {
			return NextResponse.json(
				{ error: "Employee record not found in this organization" },
				{ status: 404 },
			);
		}

		const [target] = await db
			.select({ period: workPeriod, targetEmployee: employee })
			.from(workPeriod)
			.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.organizationId, organizationId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);

		if (!target) {
			return NextResponse.json({ error: "Work period not found" }, { status: 404 });
		}

		if (!target.period.isActive || target.period.endTime) {
			return NextResponse.json({ error: "Work period is no longer running" }, { status: 409 });
		}

		if (target.targetEmployee.id === actorEmployee.id) {
			const error = new ForbiddenError("manage", "TimeEntry");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const ability = await getAbility();
		if (
			!ability?.can(
				"manage",
				asAppSubject("TimeEntry", {
					employeeId: target.targetEmployee.id,
					organizationId,
				}),
			)
		) {
			const error = new ForbiddenError("manage", "TimeEntry");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const billingAccess = await requireBillingForMutation(organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return createBillingForbiddenResponse(billingAccess);
		}

		const entryTime = new Date();
		const settings = await db.query.userSettings.findFirst({
			where: eq(userSettings.userId, target.targetEmployee.userId),
			columns: { timezone: true },
		});
		const timezone = isValidIanaTimezone(settings?.timezone) ? settings.timezone : "UTC";
		const timezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: entryTime,
			timezone,
			timezoneSource: "manager_target_user_setting",
		});

		const result = await clockingService.clockOut({
			createdBy: session.user.id,
			employeeId: target.targetEmployee.id,
			organizationId,
			workPeriodId: target.period.id,
			action: { instant: instantFromDate(entryTime), ...timezoneCapture },
			source: { ipAddress: null, deviceInfo: "web-on-behalf" },
		});

		await checkComplianceAfterClockOut(
			target.targetEmployee.id,
			organizationId,
			result.period.id,
			result.durationMinutes,
			timezone,
		);

		const breakEnforcementResult = await enforceBreaksAfterClockOut({
			createdBy: session.user.id,
			employeeId: target.targetEmployee.id,
			organizationId,
			sessionDurationMinutes: result.durationMinutes,
			timezone,
			workPeriodId: result.period.id,
		});
		// Break enforcement may split the original period, but currently does not expose
		// the inserted second work period id for separate surcharge recalculation.
		await calculateAndPersistSurcharges(result.period.id, organizationId);

		const dirtyMark = {
			dirtyFromDate:
				DateTime.fromJSDate(result.activePeriod.startTime, { zone: "utc" }).toISODate() ?? undefined,
			employeeId: target.targetEmployee.id,
			organizationId,
		};

		await markWorkBalanceDirtyAfterOnBehalfClockOutBestEffort(dirtyMark);
		if (breakEnforcementResult.wasAdjusted) {
			await markWorkBalanceDirtyAfterOnBehalfClockOutBestEffort(dirtyMark);
		}

		return NextResponse.json({ entry: result.entry }, { status: 201 });
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		if (
			error instanceof TimeEntryConflictError ||
			error instanceof ClockingConflictError ||
			(error instanceof Error && error.name === "ClockingConflictError")
		) {
			return NextResponse.json({ error: error.message }, { status: 409 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
