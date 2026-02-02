import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { holiday } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";

/**
 * PATCH /api/admin/holidays/[id]
 * Update a holiday
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

		// Verify holiday belongs to organization
		const [existingHoliday] = await db
			.select()
			.from(holiday)
			.where(and(eq(holiday.id, id), eq(holiday.organizationId, activeOrgId)))
			.limit(1);

		if (!existingHoliday) {
			return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
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

		// Update holiday
		const [updatedHoliday] = await db
			.update(holiday)
			.set({
				...(name && { name }),
				...(description !== undefined && { description }),
				...(categoryId && { categoryId }),
				...(startDate && { startDate: new Date(startDate) }),
				...(endDate && { endDate: new Date(endDate) }),
				...(recurrenceType && { recurrenceType }),
				...(recurrenceRule !== undefined && { recurrenceRule }),
				...(recurrenceEndDate !== undefined && {
					recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
				}),
				...(isActive !== undefined && { isActive }),
				updatedBy: session.user.id,
			})
			.where(eq(holiday.id, id))
			.returning();

		return NextResponse.json({ holiday: updatedHoliday });
	} catch (error) {
		console.error("Error updating holiday:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/admin/holidays/[id]
 * Delete a holiday
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

		// Verify holiday belongs to organization
		const [existingHoliday] = await db
			.select()
			.from(holiday)
			.where(and(eq(holiday.id, id), eq(holiday.organizationId, activeOrgId)))
			.limit(1);

		if (!existingHoliday) {
			return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
		}

		// Soft delete by setting isActive to false
		await db
			.update(holiday)
			.set({ isActive: false, updatedBy: session.user.id })
			.where(eq(holiday.id, id));

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting holiday:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
