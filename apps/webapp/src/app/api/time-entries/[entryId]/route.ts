import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { employee, timeEntry } from "@/db/schema";
import { auth } from "@/lib/auth";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";

interface RouteParams {
	params: Promise<{ entryId: string }>;
}

/**
 * GET /api/time-entries/[entryId]
 * Get a specific time entry with verification status
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
	await connection();
	try {
		const { entryId } = await params;

		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// SECURITY: Use activeOrganizationId from session to ensure org-scoped data
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
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
			return NextResponse.json({ error: "Employee record not found in this organization" }, { status: 404 });
		}

		// Get the time entry
		const [entry] = await db.select().from(timeEntry).where(eq(timeEntry.id, entryId)).limit(1);

		if (!entry) {
			return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
		}

		// Get the entry owner
		const [entryOwner] = await db
			.select()
			.from(employee)
			.where(eq(employee.id, entry.employeeId))
			.limit(1);

		// Check authorization - must be same organization
		if (entryOwner?.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json({ error: "Not authorized to view this entry" }, { status: 403 });
		}

		// Only allow viewing own entries unless admin/manager
		if (entry.employeeId !== currentEmployee.id) {
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return NextResponse.json(
					{ error: "Not authorized to view other employees' entries" },
					{ status: 403 },
				);
			}
		}

		// Verify the entry hash
		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(timeEntryService.verifyEntry(entryId));
		});

		const verification = await runtime.runPromise(effect);

		return NextResponse.json({
			entry,
			verification: {
				isValid: verification.isValid,
				calculatedHash: verification.calculatedHash,
				storedHash: verification.storedHash,
			},
		});
	} catch (error) {
		console.error("Error fetching time entry:", error);

		if (error instanceof Error && error.message.includes("NotFoundError")) {
			return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
