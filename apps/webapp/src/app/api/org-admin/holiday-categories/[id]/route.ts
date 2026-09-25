import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { mutateOrganizationConfiguration } from "@/lib/time-tracking/organization-configuration-guard";

/**
 * PATCH /api/org-admin/holiday-categories/[id]
 * Update a holiday category
 */
export async function PATCH(
	request: NextRequest,
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
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
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
			type,
			name,
			description,
			color,
			blocksTimeEntry,
			excludeFromCalculations,
			isActive,
		} = body;

		// Update the organization's category under the configuration guard that
		// manual submissions read blocking categories under.
		const updatedCategory = await mutateOrganizationConfiguration(db, activeOrgId, async (tx) => {
			const [updated] = await tx
				.update(holidayCategory)
				.set({
					...(type && { type }),
					...(name && { name }),
					...(description !== undefined && { description }),
					...(color !== undefined && { color }),
					...(blocksTimeEntry !== undefined && { blocksTimeEntry }),
					...(excludeFromCalculations !== undefined && {
						excludeFromCalculations,
					}),
					...(isActive !== undefined && { isActive }),
				})
				.where(
					and(
						eq(holidayCategory.id, id),
						eq(holidayCategory.organizationId, activeOrgId),
					),
				)
				.returning();
			return updated;
		});
		if (!updatedCategory) {
			return NextResponse.json(
				{ error: "Category not found" },
				{ status: 404 },
			);
		}

		return NextResponse.json({ category: updatedCategory });
	} catch (error) {
		console.error("Error updating holiday category:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

/**
 * DELETE /api/org-admin/holiday-categories/[id]
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
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}

		// Check CASL permissions
		const ability = await getAbility();
		if (!ability || ability.cannot("manage", "Holiday")) {
			const error = new ForbiddenError("manage", "Holiday");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		// Soft delete by setting isActive to false, under the configuration guard
		// that manual submissions read blocking categories under.
		const deletedCategory = await mutateOrganizationConfiguration(db, activeOrgId, async (tx) => {
			const [deleted] = await tx
				.update(holidayCategory)
				.set({ isActive: false })
				.where(
					and(
						eq(holidayCategory.id, id),
						eq(holidayCategory.organizationId, activeOrgId),
					),
				)
				.returning({ id: holidayCategory.id });
			return deleted;
		});
		if (!deletedCategory) {
			return NextResponse.json(
				{ error: "Category not found" },
				{ status: 404 },
			);
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting holiday category:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
