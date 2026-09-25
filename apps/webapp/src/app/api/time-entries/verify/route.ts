import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { asAppSubject, ForbiddenError, toHttpError } from "@/lib/authorization";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import { summarizeAppendAssurance } from "@/lib/time-tracking/append-assurance";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";

/**
 * POST /api/time-entries/verify
 * Graph-aware append assurance for an employee's time entries (#324). Operators
 * receive record-level diagnostics; employees verifying their own history receive
 * status and limitation codes only.
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
		const { employeeId } = body;

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

		// Determine which employee's chain to verify
		const targetEmployeeId = employeeId || currentEmployee.id;

		// Every role self-manages its own time entries, so that alone does not make an
		// operator. Record-level diagnostics need management of this other employee's
		// entries (a manager's covers direct reports only), or organization
		// administration when verifying one's own history.
		const ability = await getAbility();
		const isSelf = targetEmployeeId === currentEmployee.id;
		const canDiagnose = Boolean(
			isSelf
				? ability?.can("manage", "OrgSettings")
				: ability?.can(
						"manage",
						asAppSubject("TimeEntry", {
							employeeId: targetEmployeeId,
							organizationId: currentEmployee.organizationId,
						}),
					),
		);

		// Only allow verifying own entries unless user can manage the target's time entries
		if (!isSelf) {
			if (!canDiagnose) {
				const error = new ForbiddenError("read", "TimeEntry");
				const httpError = toHttpError(error);
				return NextResponse.json(httpError.body, { status: httpError.status });
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
		}

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(
				timeEntryService.verifyTimeEntryChain(targetEmployeeId, currentEmployee.organizationId),
			);
		});

		const report = await runtime.runPromise(effect);

		return NextResponse.json({
			employeeId: targetEmployeeId,
			diagnostics: canDiagnose ? "record_level" : "summary",
			assurance: canDiagnose ? report : summarizeAppendAssurance(report),
			verifiedAt: new Date().toISOString(),
		});
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		console.error("Error verifying time entry chain:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * GET /api/time-entries/verify
 * Digest of the employee's stored entry hashes, for detecting changes between
 * reads. It is not a lineage verification; use POST for assurance.
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

		// Determine which employee's chain hash to get
		const targetEmployeeId = employeeId || currentEmployee.id;

		// Only allow viewing own chain hash unless user can manage the target's time entries
		if (targetEmployeeId !== currentEmployee.id) {
			const ability = await getAbility();
			if (
				!ability?.can(
					"manage",
					asAppSubject("TimeEntry", {
						employeeId: targetEmployeeId,
						organizationId: currentEmployee.organizationId,
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
				timeEntryService.getChainHash(targetEmployeeId, currentEmployee.organizationId),
			);
		});

		const chainHash = await runtime.runPromise(effect);

		return NextResponse.json({
			employeeId: targetEmployeeId,
			chainHash,
			claim: "change_digest",
			generatedAt: new Date().toISOString(),
		});
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		console.error("Error getting chain hash:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
