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
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";
import {
	applyHistoricalGapRepair,
	HistoricalRepairNotAuthorizedError,
	readHistoricalGapRepairPlan,
} from "@/lib/time-tracking/historical-gap-repair-executor";
import { calendarDateEnvelope } from "@/lib/time-tracking/historical-work-diagnostics";

/** Longest repair scope, in calendar days, matching the diagnostics route. */
const MAX_SCOPE_DAYS = 366;
const MAX_REASON_LENGTH = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{64}$/;

type RepairRequest =
	| { action: "plan"; startDate: string; endDate: string; employeeId: string | null }
	| {
			action: "apply";
			startDate: string;
			endDate: string;
			employeeId: string | null;
			expected: { employeeId: string; fingerprint: string }[];
			reason: string;
	  };

function parseRequest(body: unknown): RepairRequest | string {
	if (typeof body !== "object" || body === null) return "Request body must be an object";
	const { action, startDate, endDate, employeeId, expected, reason } = body as Record<
		string,
		unknown
	>;
	if (action !== "plan" && action !== "apply") return "action must be plan or apply";
	if (typeof startDate !== "string" || typeof endDate !== "string") {
		return "startDate and endDate are required";
	}
	try {
		const start = parsePlainDate(startDate);
		const end = parsePlainDate(endDate);
		if (
			Temporal.PlainDate.compare(start, end) > 0 ||
			start.until(end, { largestUnit: "days" }).days >= MAX_SCOPE_DAYS
		) {
			return `startDate and endDate must be in order, within ${MAX_SCOPE_DAYS} days`;
		}
	} catch {
		return "startDate and endDate must be YYYY-MM-DD";
	}
	if (
		employeeId !== undefined &&
		employeeId !== null &&
		(typeof employeeId !== "string" || !UUID.test(employeeId))
	) {
		return "employeeId must be a UUID";
	}
	const scope = { startDate, endDate, employeeId: (employeeId as string | undefined) ?? null };
	if (action === "plan") return { action, ...scope };

	if (typeof reason !== "string" || reason.trim() === "" || reason.length > MAX_REASON_LENGTH) {
		return `reason is required (at most ${MAX_REASON_LENGTH} characters)`;
	}
	if (!Array.isArray(expected) || expected.length === 0) {
		return "expected must list the reviewed plan of each employee";
	}
	const plans: { employeeId: string; fingerprint: string }[] = [];
	for (const item of expected) {
		const candidate = item as Record<string, unknown> | null;
		if (
			typeof candidate?.employeeId !== "string" ||
			!UUID.test(candidate.employeeId) ||
			typeof candidate.fingerprint !== "string" ||
			!FINGERPRINT.test(candidate.fingerprint)
		) {
			return "expected entries need an employeeId and a plan fingerprint";
		}
		plans.push({ employeeId: candidate.employeeId, fingerprint: candidate.fingerprint });
	}
	if (new Set(plans.map((plan) => plan.employeeId)).size !== plans.length) {
		return "expected lists an employee twice";
	}
	return { action, ...scope, expected: plans, reason: reason.trim() };
}

/**
 * POST /api/time-entries/diagnostics/repair
 * Evidence-only historical gap repair (#320) for one employee or every employee
 * and a calendar-date range. `plan` reads the repairable gaps and the held ones;
 * `apply` repairs exactly the reviewed plan of each listed employee, and only when
 * the organization has separately authorized repair. Organization administrators
 * only.
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const organizationId = session.session?.activeOrganizationId;
		if (!organizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}
		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: organizationId,
		});
		const ability = await getAbility();
		if (!ability?.can("manage", "OrgSettings")) {
			const httpError = toHttpError(new ForbiddenError("manage", "OrgSettings"));
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const parsed = parseRequest(await request.json().catch(() => null));
		if (typeof parsed === "string") {
			return NextResponse.json({ error: parsed }, { status: 400 });
		}

		// Every employee, active or not: departed employees' history stays in scope.
		const employees = await db
			.select({ id: employee.id })
			.from(employee)
			.where(
				parsed.employeeId
					? and(eq(employee.organizationId, organizationId), eq(employee.id, parsed.employeeId))
					: eq(employee.organizationId, organizationId),
			);
		if (parsed.employeeId && employees.length === 0) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}
		const employeeIds = employees.map((row) => row.id);
		const range = calendarDateEnvelope(parsed.startDate, parsed.endDate);
		const dates = { startDate: parsed.startDate, endDate: parsed.endDate };

		if (parsed.action === "plan") {
			const { repair } = await readHistoricalGapRepairPlan(db, organizationId, {
				employeeIds,
				range,
			});
			return NextResponse.json({ dates, ...repair });
		}

		const inScope = new Set(employeeIds);
		if (parsed.expected.some((plan) => !inScope.has(plan.employeeId))) {
			return NextResponse.json(
				{ error: "expected names an employee outside the requested scope" },
				{ status: 400 },
			);
		}
		const outcomes = await applyHistoricalGapRepair({
			organizationId,
			actorUserId: session.user.id,
			range,
			expected: parsed.expected,
			reason: parsed.reason,
		});
		return NextResponse.json({ dates, outcomes });
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		if (error instanceof HistoricalRepairNotAuthorizedError) {
			return NextResponse.json(
				{ error: error.message, code: "repair_not_authorized" },
				{ status: 409 },
			);
		}
		console.error("Error repairing historical work:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
