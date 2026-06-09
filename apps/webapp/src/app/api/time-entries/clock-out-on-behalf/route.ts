import { and, eq, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { createTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions/entry-helpers";
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

class TimeEntryConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeEntryConflictError";
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
			return NextResponse.json(
				{ error: "Work period is no longer running" },
				{ status: 409 },
			);
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

		const entry = await db.transaction(async (tx) => {
			const lockKey = `${organizationId}:${target.targetEmployee.id}`;
			await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

			const [activePeriod] = await tx
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.id, target.period.id),
						eq(workPeriod.employeeId, target.targetEmployee.id),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
						isNull(workPeriod.deletedAt),
					),
				)
				.limit(1);

			if (!activePeriod) {
				throw new TimeEntryConflictError("Active work period changed");
			}

			const createdEntry = await createTimeEntry(
				{
					createdBy: session.user.id,
					employeeId: target.targetEmployee.id,
					organizationId,
					timestamp: entryTime,
					type: "clock_out",
					...timezoneCapture,
				},
				tx,
			);

			const durationMs = entryTime.getTime() - activePeriod.startTime.getTime();
			const durationMinutes = Math.round(durationMs / 60000);

			const updatedPeriods = await tx
				.update(workPeriod)
				.set({
					clockOutId: createdEntry.id,
					durationMinutes,
					endTime: entryTime,
					isActive: false,
				})
				.where(
					and(
						eq(workPeriod.id, activePeriod.id),
						eq(workPeriod.employeeId, target.targetEmployee.id),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
						isNull(workPeriod.deletedAt),
					),
				)
				.returning({ id: workPeriod.id });

			if (updatedPeriods.length === 0) {
				throw new TimeEntryConflictError("Active work period changed");
			}

			return createdEntry;
		});

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		if (error instanceof TimeEntryConflictError) {
			return NextResponse.json({ error: error.message }, { status: 409 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
