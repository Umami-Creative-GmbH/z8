import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { employee, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * GET /api/admin/holiday-categories
 * List all holiday categories for the organization
 */
export async function GET(_request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get employee record to check organization (admin check not required for GET)
		const [employeeRecord] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!employeeRecord) {
			return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
		}

		// Fetch all categories for the organization
		const categories = await db
			.select()
			.from(holidayCategory)
			.where(eq(holidayCategory.organizationId, employeeRecord.organizationId))
			.orderBy(holidayCategory.name);

		return NextResponse.json({ categories });
	} catch (error) {
		console.error("Error fetching holiday categories:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/admin/holiday-categories
 * Create a new holiday category
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get employee record to check role and organization
		const [employeeRecord] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			return NextResponse.json({ error: "Admin access required" }, { status: 403 });
		}

		const body = await request.json();
		const { type, name, description, color, blocksTimeEntry, excludeFromCalculations, isActive } =
			body;

		// Validate required fields
		if (!type || !name) {
			return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
		}

		// Create category
		const [newCategory] = await db
			.insert(holidayCategory)
			.values({
				organizationId: employeeRecord.organizationId,
				type,
				name,
				description: description || null,
				color: color || null,
				blocksTimeEntry: blocksTimeEntry ?? true,
				excludeFromCalculations: excludeFromCalculations ?? true,
				isActive: isActive ?? true,
			})
			.returning();

		return NextResponse.json({ category: newCategory }, { status: 201 });
	} catch (error) {
		console.error("Error creating holiday category:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
