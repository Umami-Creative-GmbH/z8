import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";

/**
 * GET /api/org-admin/holiday-categories
 * List all holiday categories for the organization
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

		// Check CASL permissions - reading holidays requires at least read permission
		const ability = await getAbility();
		if (!ability || ability.cannot("read", "Holiday")) {
			const error = new ForbiddenError("read", "Holiday");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		// Fetch all categories for the organization
		const categories = await db
			.select()
			.from(holidayCategory)
			.where(eq(holidayCategory.organizationId, activeOrgId))
			.orderBy(holidayCategory.name);

		return NextResponse.json({ categories });
	} catch (error) {
		console.error("Error fetching holiday categories:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/org-admin/holiday-categories
 * Create a new holiday category
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
				organizationId: activeOrgId,
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
