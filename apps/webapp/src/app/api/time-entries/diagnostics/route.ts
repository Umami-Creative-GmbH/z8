import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { summarizeAppendAssurance } from "@/lib/time-tracking/append-assurance";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";
import { historicalWorkViewerAccess } from "@/lib/time-tracking/diagnostic-access";
import {
	calendarDateEnvelope,
	projectHistoricalWorkForViewer,
} from "@/lib/time-tracking/historical-work-diagnostics";
import { readHistoricalWorkDiagnostics } from "@/lib/time-tracking/historical-work-diagnostics-reader";

/** Longest diagnostic scope, in calendar days; wider reads belong to the operator page. */
const MAX_SCOPE_DAYS = 366;

function parseScopeDates(body: unknown): { startDate: string; endDate: string } | null {
	if (typeof body !== "object" || body === null) return null;
	const { startDate, endDate } = body as Record<string, unknown>;
	if (typeof startDate !== "string" || typeof endDate !== "string") return null;
	try {
		const start = parsePlainDate(startDate);
		const end = parsePlainDate(endDate);
		const days = start.until(end, { largestUnit: "days" }).days;
		if (Temporal.PlainDate.compare(start, end) > 0 || days >= MAX_SCOPE_DAYS) return null;
	} catch {
		return null;
	}
	return { startDate, endDate };
}

/**
 * POST /api/time-entries/diagnostics
 * Scoped completeness and record-level historical work diagnostics for one
 * employee and calendar-date range (#319), with that employee's append assurance
 * as a separate claim. Operators (see `historicalWorkViewerAccess`) receive
 * record-level evidence; findings naming employees they may not diagnose keep only
 * their classification. Employees reading their own history receive status and
 * counts. Nothing is repaired.
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
		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: activeOrgId,
		});

		const body: unknown = await request.json().catch(() => null);
		const dates = parseScopeDates(body);
		if (!dates) {
			return NextResponse.json(
				{
					error: `startDate and endDate must be YYYY-MM-DD, in order, within ${MAX_SCOPE_DAYS} days`,
				},
				{ status: 400 },
			);
		}

		const [currentEmployee] = await db
			.select({ id: employee.id, organizationId: employee.organizationId })
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

		const requestedEmployeeId = (body as { employeeId?: unknown }).employeeId;
		const targetEmployeeId =
			typeof requestedEmployeeId === "string" && requestedEmployeeId
				? requestedEmployeeId
				: currentEmployee.id;
		const access = historicalWorkViewerAccess(await getAbility(), {
			organizationId: currentEmployee.organizationId,
			employeeId: currentEmployee.id,
		});
		const canDiagnose = access.canDiagnose(targetEmployeeId);

		if (targetEmployeeId !== currentEmployee.id) {
			if (!canDiagnose) {
				const httpError = toHttpError(new ForbiddenError("read", "TimeEntry"));
				return NextResponse.json(httpError.body, { status: httpError.status });
			}
			const [targetEmployee] = await db
				.select({ id: employee.id })
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
		}

		const { work, appendAssurance } = await readHistoricalWorkDiagnostics(
			db,
			currentEmployee.organizationId,
			{
				employeeIds: [targetEmployeeId],
				range: calendarDateEnvelope(dates.startDate, dates.endDate),
			},
		);
		const read = projectHistoricalWorkForViewer(work, access);
		const assurance = appendAssurance.get(targetEmployeeId);
		if (!assurance) throw new Error("Append assurance was not assessed for the employee");

		return NextResponse.json({
			employeeId: targetEmployeeId,
			dates,
			diagnostics: read.diagnostics,
			work: read.diagnostics === "record_level" ? read.report : read.summary,
			appendAssurance: canDiagnose ? assurance : summarizeAppendAssurance(assurance),
			assessedAt: Temporal.Now.instant().toString(),
		});
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		console.error("Error diagnosing historical work:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
