import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import {
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { holidayPresetFormSchema } from "@/lib/holidays/validation";

interface RouteParams {
	params: Promise<{ id: string }>;
}

/**
 * GET /api/org-admin/holiday-presets/[id]
 * Get a specific holiday preset with its holidays
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { id } = await params;

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

		// Fetch the preset
		const [preset] = await db
			.select()
			.from(holidayPreset)
			.where(
				and(
					eq(holidayPreset.id, id),
					eq(holidayPreset.organizationId, activeOrgId),
				),
			)
			.limit(1);

		if (!preset) {
			return NextResponse.json({ error: "Preset not found" }, { status: 404 });
		}

		// Fetch holidays for the preset
		const holidays = await db
			.select()
			.from(holidayPresetHoliday)
			.where(eq(holidayPresetHoliday.presetId, id))
			.orderBy(holidayPresetHoliday.month, holidayPresetHoliday.day);

		// Get assignment count
		const [assignmentCount] = await db
			.select({
				count: db.$count(holidayPresetAssignment, eq(holidayPresetAssignment.presetId, id)),
			})
			.from(holidayPresetAssignment)
			.where(
				and(eq(holidayPresetAssignment.presetId, id), eq(holidayPresetAssignment.isActive, true)),
			);

		return NextResponse.json({
			preset,
			holidays,
			assignmentCount: assignmentCount?.count ?? 0,
		});
	} catch (error) {
		console.error("Error fetching holiday preset:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * PUT /api/org-admin/holiday-presets/[id]
 * Update a holiday preset
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { id } = await params;

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

		// Check if preset exists and belongs to organization
		const [existingPreset] = await db
			.select()
			.from(holidayPreset)
			.where(
				and(
					eq(holidayPreset.id, id),
					eq(holidayPreset.organizationId, activeOrgId),
				),
			)
			.limit(1);

		if (!existingPreset) {
			return NextResponse.json({ error: "Preset not found" }, { status: 404 });
		}

		const body = await request.json();
		const validationResult = holidayPresetFormSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request body", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const { name, description, countryCode, stateCode, regionCode, color, isActive } =
			validationResult.data;

		// Update preset
		const [updatedPreset] = await db
			.update(holidayPreset)
			.set({
				name,
				description: description || null,
				countryCode: countryCode || null,
				stateCode: stateCode || null,
				regionCode: regionCode || null,
				color: color || null,
				isActive: isActive ?? true,
				updatedBy: session.user.id,
			})
			.where(eq(holidayPreset.id, id))
			.returning();

		return NextResponse.json({ preset: updatedPreset });
	} catch (error) {
		console.error("Error updating holiday preset:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/org-admin/holiday-presets/[id]
 * Delete a holiday preset (soft delete by setting isActive to false)
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { id } = await params;

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

		// Check if preset exists and belongs to organization
		const [existingPreset] = await db
			.select()
			.from(holidayPreset)
			.where(
				and(
					eq(holidayPreset.id, id),
					eq(holidayPreset.organizationId, activeOrgId),
				),
			)
			.limit(1);

		if (!existingPreset) {
			return NextResponse.json({ error: "Preset not found" }, { status: 404 });
		}

		// Check if preset has active assignments
		const [assignmentCount] = await db
			.select({
				count: db.$count(holidayPresetAssignment, eq(holidayPresetAssignment.presetId, id)),
			})
			.from(holidayPresetAssignment)
			.where(
				and(eq(holidayPresetAssignment.presetId, id), eq(holidayPresetAssignment.isActive, true)),
			);

		if (assignmentCount && assignmentCount.count > 0) {
			return NextResponse.json(
				{
					error: "Cannot delete preset with active assignments",
					assignmentCount: assignmentCount.count,
				},
				{ status: 409 },
			);
		}

		// Soft delete by setting isActive to false
		await db
			.update(holidayPreset)
			.set({
				isActive: false,
				updatedBy: session.user.id,
			})
			.where(eq(holidayPreset.id, id));

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting holiday preset:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
