import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";

/**
 * POST /api/time-entries/verify
 * Verify chain integrity for an employee's time entries
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
			return NextResponse.json({ error: "Employee record not found in this organization" }, { status: 404 });
		}

		// Determine which employee's chain to verify
		const targetEmployeeId = employeeId || currentEmployee.id;

		// Only allow verifying own entries unless admin/manager
		if (targetEmployeeId !== currentEmployee.id) {
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return NextResponse.json(
					{ error: "Not authorized to verify other employees' chains" },
					{ status: 403 },
				);
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
			return yield* _(timeEntryService.verifyTimeEntryChain(targetEmployeeId, currentEmployee.organizationId));
		});

		const result = await runtime.runPromise(effect);

		return NextResponse.json({
			employeeId: targetEmployeeId,
			verification: result,
			verifiedAt: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Error verifying time entry chain:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * GET /api/time-entries/verify
 * Get chain hash for quick integrity check
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
			return NextResponse.json({ error: "Employee record not found in this organization" }, { status: 404 });
		}

		// Determine which employee's chain hash to get
		const targetEmployeeId = employeeId || currentEmployee.id;

		// Only allow viewing own chain hash unless admin/manager
		if (targetEmployeeId !== currentEmployee.id) {
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return NextResponse.json(
					{ error: "Not authorized to view other employees' chain hash" },
					{ status: 403 },
				);
			}
		}

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(timeEntryService.getChainHash(targetEmployeeId, currentEmployee.organizationId));
		});

		const chainHash = await runtime.runPromise(effect);

		return NextResponse.json({
			employeeId: targetEmployeeId,
			chainHash,
			generatedAt: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Error getting chain hash:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
