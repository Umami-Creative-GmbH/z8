import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { runtime } from "@/lib/effect/runtime";
import { TimeEntryService } from "@/lib/effect/services/time-entry.service";

/**
 * GET /api/time-entries
 * Retrieve time entries for an employee
 * Query params: employeeId, from, to, includeSuperseded
 * Optimized: start promises early, await late
 */
export async function GET(request: NextRequest) {
	// Start connection and headers promises early (don't await yet)
	const connectionPromise = connection();
	const headersPromise = headers();

	try {
		// Parse search params while promises are in flight
		const searchParams = request.nextUrl.searchParams;
		const employeeId = searchParams.get("employeeId");
		const from = searchParams.get("from");
		const to = searchParams.get("to");
		const includeSuperseded = searchParams.get("includeSuperseded") === "true";

		// Now await connection and session in parallel
		const [, resolvedHeaders] = await Promise.all([connectionPromise, headersPromise]);

		// Support both Bearer token (desktop app) and cookie-based auth (web app)
		const authHeader = resolvedHeaders.get("authorization");
		let session;

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			session = await auth.api.getSession({
				headers: new Headers({ cookie: `better-auth.session_token=${token}` }),
			});
		} else {
			session = await auth.api.getSession({ headers: resolvedHeaders });
		}

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
		console.error("Error fetching time entries:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/time-entries
 * Create a new time entry (clock in/out)
 * Optimized: start promises early, await late
 */
export async function POST(request: NextRequest) {
	// Start all promises early in parallel
	const connectionPromise = connection();
	const headersPromise = headers();
	const bodyPromise = request.json();

	try {
		// Await all initial promises in parallel
		const [, resolvedHeaders, body] = await Promise.all([
			connectionPromise,
			headersPromise,
			bodyPromise,
		]);

		// Support both Bearer token (desktop app) and cookie-based auth (web app)
		const authHeader = resolvedHeaders.get("authorization");
		let session;

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			session = await auth.api.getSession({
				headers: new Headers({ cookie: `better-auth.session_token=${token}` }),
			});
		} else {
			session = await auth.api.getSession({ headers: resolvedHeaders });
		}

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

		// Get current user's employee record
		const [currentEmployee] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!currentEmployee) {
			return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
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

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		console.error("Error creating time entry:", error);

		// Handle Effect errors
		if (error instanceof Error && error.message.includes("NotFoundError")) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
