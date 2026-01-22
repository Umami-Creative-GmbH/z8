import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";

/**
 * GET /api/time-entries
 * Retrieve time entries for an employee
 * Query params: employeeId, from, to, includeSuperseded
 */
export async function GET(request: NextRequest) {
	// Opt out of caching - must be awaited immediately, not stored as promise
	await connection();

	try {
		// Parse search params
		const searchParams = request.nextUrl.searchParams;
		const employeeId = searchParams.get("employeeId");
		const from = searchParams.get("from");
		const to = searchParams.get("to");
		const includeSuperseded = searchParams.get("includeSuperseded") === "true";

		const resolvedHeaders = await headers();

		// With Bearer plugin, getSession handles both cookie and Bearer token auth
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get current user's employee record for the active organization
		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

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

		// Determine which employee's entries to fetch
		const targetEmployeeId = employeeId || currentEmployee.id;

		// Only allow viewing own entries unless admin/manager
		if (targetEmployeeId !== currentEmployee.id) {
			if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
				return NextResponse.json(
					{ error: "Not authorized to view other employees' entries" },
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
			return yield* _(
				timeEntryService.getTimeEntries({
					employeeId: targetEmployeeId,
					from: from ? new Date(from) : undefined,
					to: to ? new Date(to) : undefined,
					includeSuperseded,
				}),
			);
		});

		const entries = await runtime.runPromise(effect);

		return NextResponse.json({ entries });
	} catch (error) {
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/time-entries
 * Create a new time entry (clock in/out)
 */
export async function POST(request: NextRequest) {
	// Opt out of caching - must be awaited immediately, not stored as promise
	await connection();

	try {
		// Await headers and body in parallel
		const [resolvedHeaders, body] = await Promise.all([headers(), request.json()]);

		// With Bearer plugin, getSession handles both cookie and Bearer token auth
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { type, timestamp, notes, location } = body;

		// Validate required fields
		if (!type || !["clock_in", "clock_out"].includes(type)) {
			return NextResponse.json(
				{ error: "Invalid type. Must be 'clock_in' or 'clock_out'" },
				{ status: 400 },
			);
		}

		// Get current user's employee record for the active organization
		const activeOrgId = session.session.activeOrganizationId;

		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

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

		// Extract request metadata from already-resolved headers
		const ipAddress =
			resolvedHeaders.get("x-forwarded-for") || resolvedHeaders.get("x-real-ip") || "unknown";
		const deviceInfo = resolvedHeaders.get("user-agent") || "unknown";

		const effect = Effect.gen(function* (_) {
			const timeEntryService = yield* _(TimeEntryService);
			return yield* _(
				timeEntryService.createTimeEntry({
					employeeId: currentEmployee.id,
					type,
					timestamp: timestamp ? new Date(timestamp) : new Date(),
					createdBy: session.user.id,
					notes,
					location,
					ipAddress,
					deviceInfo,
				}),
			);
		});

		const entry = await runtime.runPromise(effect);

		// Manage work periods based on entry type
		const entryTime = timestamp ? new Date(timestamp) : new Date();

		if (type === "clock_in") {
			// Create a new work period
			await db.insert(workPeriod).values({
				employeeId: currentEmployee.id,
				clockInId: entry.id,
				startTime: entryTime,
				isActive: true,
			});
		} else if (type === "clock_out") {
			// Find and close the active work period
			const [activePeriod] = await db
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.employeeId, currentEmployee.id),
						isNull(workPeriod.endTime),
					),
				)
				.limit(1);

			if (activePeriod) {
				const durationMs = entryTime.getTime() - activePeriod.startTime.getTime();
				const durationMinutes = Math.round(durationMs / 60000);

				await db
					.update(workPeriod)
					.set({
						clockOutId: entry.id,
						endTime: entryTime,
						durationMinutes,
						isActive: false,
					})
					.where(eq(workPeriod.id, activePeriod.id));
			}
		}

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		// Handle Effect errors
		if (error instanceof Error && error.message.includes("NotFoundError")) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
