import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, timeEntry } from "@/db/schema";
import { auth } from "@/lib/auth";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";
import { runtime } from "@/lib/effect/runtime";
import { canApproveFor } from "@/lib/auth-helpers";

/**
 * POST /api/time-entries/corrections
 * Submit a correction for a time entry
 * Requires approval from a manager/admin
 */
export async function POST(request: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { replacesEntryId, timestamp, notes } = body;

		// Validate required fields
		if (!replacesEntryId) {
			return NextResponse.json({ error: "replacesEntryId is required" }, { status: 400 });
		}

		if (!timestamp) {
			return NextResponse.json({ error: "timestamp is required" }, { status: 400 });
		}

		if (!notes) {
			return NextResponse.json(
				{ error: "notes is required for corrections" },
				{ status: 400 },
			);
		}

		// Get current user's employee record
		const [currentEmployee] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!currentEmployee) {
			return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
		}

		// Get the entry being corrected
		const [entryToCorrect] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.id, replacesEntryId))
			.limit(1);

		if (!entryToCorrect) {
			return NextResponse.json({ error: "Time entry to correct not found" }, { status: 404 });
		}

		// Get the employee who owns the entry
		const [entryOwner] = await db
			.select()
			.from(employee)
			.where(eq(employee.id, entryToCorrect.employeeId))
			.limit(1);

		if (!entryOwner) {
			return NextResponse.json({ error: "Entry owner not found" }, { status: 404 });
		}

		// Verify entry is in same organization
		if (entryOwner.organizationId !== currentEmployee.organizationId) {
			return NextResponse.json(
				{ error: "Not authorized to correct entries from other organizations" },
				{ status: 403 },
			);
		}

		// Check authorization
		// Self-correction: Employee can request correction of their own entries (but needs approval)
		// Admin/Manager correction: Can directly correct entries of employees they manage
		const isSelfCorrection = entryToCorrect.employeeId === currentEmployee.id;
		const canApprove = await canApproveFor(entryToCorrect.employeeId);

		if (!isSelfCorrection && !canApprove) {
			return NextResponse.json(
				{ error: "Not authorized to correct this entry" },
				{ status: 403 },
			);
		}

		// Get request metadata
		const headersList = await headers();
		const ipAddress =
			headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown";
		const deviceInfo = headersList.get("user-agent") || "unknown";

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(
				timeEntryService.createCorrectionEntry({
					employeeId: entryToCorrect.employeeId,
					replacesEntryId,
					timestamp: new Date(timestamp),
					createdBy: session.user.id,
					notes,
					ipAddress,
					deviceInfo,
				}),
			);
		});

		const correctionEntry = await runtime.runPromise(effect);

		return NextResponse.json(
			{
				entry: correctionEntry,
				message: isSelfCorrection && !canApprove
					? "Correction submitted. Awaiting manager approval."
					: "Correction applied successfully.",
			},
			{ status: 201 },
		);
	} catch (error) {
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
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const searchParams = request.nextUrl.searchParams;
		const employeeId = searchParams.get("employeeId");
		const entryId = searchParams.get("entryId");

		// Get current user's employee record
		const [currentEmployee] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!currentEmployee) {
			return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
		}

		// Build query conditions
		const conditions = [eq(timeEntry.type, "correction")];

		if (entryId) {
			// Get the original entry and its correction
			const [originalEntry] = await db
				.select()
				.from(timeEntry)
				.where(eq(timeEntry.id, entryId))
				.limit(1);

			if (!originalEntry) {
				return NextResponse.json({ error: "Entry not found" }, { status: 404 });
			}

			// Check authorization
			if (originalEntry.employeeId !== currentEmployee.id) {
				if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
					return NextResponse.json(
						{ error: "Not authorized to view correction history" },
						{ status: 403 },
					);
				}
			}

			conditions.push(eq(timeEntry.replacesEntryId, entryId));
		} else {
			// Get all corrections for an employee
			const targetEmployeeId = employeeId || currentEmployee.id;

			// Only allow viewing own corrections unless admin/manager
			if (targetEmployeeId !== currentEmployee.id) {
				if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
					return NextResponse.json(
						{ error: "Not authorized to view other employees' corrections" },
						{ status: 403 },
					);
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
		console.error("Error fetching corrections:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
