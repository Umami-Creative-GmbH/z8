import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { employee, holiday, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";

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

		// Get employee record for the active organization ONLY
		const [employeeRecord] = await db
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

		if (!employeeRecord || employeeRecord.role !== "admin") {
			return NextResponse.json({ error: "Admin access required" }, { status: 403 });
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
			.where(eq(holiday.organizationId, employeeRecord.organizationId))
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

		// Get employee record for the active organization ONLY
		const [employeeRecord] = await db
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

		if (!employeeRecord || employeeRecord.role !== "admin") {
			return NextResponse.json({ error: "Admin access required" }, { status: 403 });
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
				organizationId: employeeRecord.organizationId,
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
