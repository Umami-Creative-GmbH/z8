import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";

/**
 * PATCH /api/admin/holiday-categories/[id]
 * Update a holiday category
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	await connection();
	try {
		const { id } = await params;
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

		// Verify category belongs to organization
		const [existingCategory] = await db
			.select()
			.from(holidayCategory)
			.where(
				and(
					eq(holidayCategory.id, id),
					eq(holidayCategory.organizationId, activeOrgId),
				),
			)
			.limit(1);

		if (!existingCategory) {
			return NextResponse.json({ error: "Category not found" }, { status: 404 });
		}

		const body = await request.json();
		const { type, name, description, color, blocksTimeEntry, excludeFromCalculations, isActive } =
			body;

		// Update category
		const [updatedCategory] = await db
			.update(holidayCategory)
			.set({
				...(type && { type }),
				...(name && { name }),
				...(description !== undefined && { description }),
				...(color !== undefined && { color }),
				...(blocksTimeEntry !== undefined && { blocksTimeEntry }),
				...(excludeFromCalculations !== undefined && { excludeFromCalculations }),
				...(isActive !== undefined && { isActive }),
			})
			.where(eq(holidayCategory.id, id))
			.returning();

		return NextResponse.json({ category: updatedCategory });
	} catch (error) {
		console.error("Error updating holiday category:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/admin/holiday-categories/[id]
 * Delete a holiday category
 */
export async function DELETE(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	await connection();
	try {
		const { id } = await params;
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

		// Verify category belongs to organization
		const [existingCategory] = await db
			.select()
			.from(holidayCategory)
			.where(
				and(
					eq(holidayCategory.id, id),
					eq(holidayCategory.organizationId, activeOrgId),
				),
			)
			.limit(1);

		if (!existingCategory) {
			return NextResponse.json({ error: "Category not found" }, { status: 404 });
		}

		// Soft delete by setting isActive to false
		await db.update(holidayCategory).set({ isActive: false }).where(eq(holidayCategory.id, id));

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting holiday category:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
