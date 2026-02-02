import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { holiday, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";

/**
 * GET /api/admin/holidays
 * List all holidays for the organization
 */
export async function GET(_request: NextRequest) {
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

		// Check CASL permissions
		const ability = await getAbility();
		if (!ability || ability.cannot("manage", "Holiday")) {
			const error = new ForbiddenError("manage", "Holiday");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		// Fetch all holidays for the organization with category info
		const holidays = await db
			.select({
				id: holiday.id,
				name: holiday.name,
				description: holiday.description,
				startDate: holiday.startDate,
				endDate: holiday.endDate,
				recurrenceType: holiday.recurrenceType,
				recurrenceRule: holiday.recurrenceRule,
				recurrenceEndDate: holiday.recurrenceEndDate,
				isActive: holiday.isActive,
				category: {
					id: holidayCategory.id,
					name: holidayCategory.name,
					type: holidayCategory.type,
					color: holidayCategory.color,
				},
			})
			.from(holiday)
			.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
			.where(eq(holiday.organizationId, activeOrgId))
			.orderBy(holiday.startDate);

		return NextResponse.json({ holidays });
	} catch (error) {
		console.error("Error fetching holidays:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/admin/holidays
 * Create a new holiday
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

		// Check CASL permissions
		const ability = await getAbility();
		if (!ability || ability.cannot("manage", "Holiday")) {
			const error = new ForbiddenError("manage", "Holiday");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const body = await request.json();
		const {
			name,
			description,
			categoryId,
			startDate,
			endDate,
			recurrenceType,
			recurrenceRule,
			recurrenceEndDate,
			isActive,
		} = body;

		// Validate required fields
		if (!name || !categoryId || !startDate || !endDate || !recurrenceType) {
			return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
		}

		// Create holiday
		const [newHoliday] = await db
			.insert(holiday)
			.values({
				organizationId: activeOrgId,
				name,
				description: description || null,
				categoryId,
				startDate: new Date(startDate),
				endDate: new Date(endDate),
				recurrenceType,
				recurrenceRule: recurrenceRule || null,
				recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
				isActive: isActive ?? true,
				createdBy: session.user.id,
			})
			.returning();

		return NextResponse.json({ holiday: newHoliday }, { status: 201 });
	} catch (error) {
		console.error("Error creating holiday:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
