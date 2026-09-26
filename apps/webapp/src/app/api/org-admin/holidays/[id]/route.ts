import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { holiday, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/organization-configuration-guard";

/**
 * PATCH /api/org-admin/holidays/[id]
 * Update a holiday
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

		// Manual submissions read organization holidays under the configuration guard.
		const result = await withOrganizationConfigurationMutation(db, activeOrgId, async (tx) => {
			// Verify holiday belongs to organization
			const [existingHoliday] = await tx
				.select()
				.from(holiday)
				.where(and(eq(holiday.id, id), eq(holiday.organizationId, activeOrgId)))
				.limit(1);
			if (!existingHoliday) return "holiday_not_found" as const;

			if (categoryId) {
				const [existingCategory] = await tx
					.select()
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, categoryId),
							eq(holidayCategory.organizationId, activeOrgId),
						),
					)
					.limit(1);
				if (!existingCategory) return "invalid_category" as const;
			}

			const [updated] = await tx
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
						recurrenceEndDate: recurrenceEndDate
							? new Date(recurrenceEndDate)
							: null,
					}),
					...(isActive !== undefined && { isActive }),
					updatedBy: session.user.id,
				})
				.where(and(eq(holiday.id, id), eq(holiday.organizationId, activeOrgId)))
				.returning();
			return { holiday: updated };
		});

		if (result === "holiday_not_found") {
			return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
		}
		if (result === "invalid_category") {
			return NextResponse.json(
				{ error: "Invalid holiday category" },
				{ status: 400 },
			);
		}

		return NextResponse.json({ holiday: result.holiday });
	} catch (error) {
		console.error("Error updating holiday:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

/**
 * DELETE /api/org-admin/holidays/[id]
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
		// that manual submissions read organization holidays under.
		const deletedHoliday = await withOrganizationConfigurationMutation(db, activeOrgId, async (tx) => {
			const [deleted] = await tx
				.update(holiday)
				.set({ isActive: false, updatedBy: session.user.id })
				.where(and(eq(holiday.id, id), eq(holiday.organizationId, activeOrgId)))
				.returning({ id: holiday.id });
			return deleted;
		});
		if (!deletedHoliday) {
			return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting holiday:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
