import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import {
	employee,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { holidayPresetFormSchema } from "@/lib/holidays/validation";

/**
 * GET /api/admin/holiday-presets
 * List all holiday presets for the organization
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

		// Fetch all presets for the organization with holiday count
		const presets = await db
			.select({
				id: holidayPreset.id,
				name: holidayPreset.name,
				description: holidayPreset.description,
				countryCode: holidayPreset.countryCode,
				stateCode: holidayPreset.stateCode,
				regionCode: holidayPreset.regionCode,
				color: holidayPreset.color,
				isActive: holidayPreset.isActive,
				createdAt: holidayPreset.createdAt,
			})
			.from(holidayPreset)
			.where(eq(holidayPreset.organizationId, employeeRecord.organizationId))
			.orderBy(holidayPreset.name);

		// Get holiday counts and assignment counts for each preset
		const presetsWithCounts = await Promise.all(
			presets.map(async (preset) => {
				const [holidayCount] = await db
					.select({
						count: db.$count(holidayPresetHoliday, eq(holidayPresetHoliday.presetId, preset.id)),
					})
					.from(holidayPresetHoliday)
					.where(eq(holidayPresetHoliday.presetId, preset.id));

				const [assignmentCount] = await db
					.select({
						count: db.$count(
							holidayPresetAssignment,
							eq(holidayPresetAssignment.presetId, preset.id),
						),
					})
					.from(holidayPresetAssignment)
					.where(
						and(
							eq(holidayPresetAssignment.presetId, preset.id),
							eq(holidayPresetAssignment.isActive, true),
						),
					);

				return {
					...preset,
					holidayCount: holidayCount?.count ?? 0,
					assignmentCount: assignmentCount?.count ?? 0,
				};
			}),
		);

		return NextResponse.json({ presets: presetsWithCounts });
	} catch (error) {
		console.error("Error fetching holiday presets:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/admin/holiday-presets
 * Create a new holiday preset
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
		const validationResult = holidayPresetFormSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request body", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const { name, description, countryCode, stateCode, regionCode, color, isActive } =
			validationResult.data;

		// Check for existing preset with same location
		if (countryCode) {
			const existingConditions = [
				eq(holidayPreset.organizationId, employeeRecord.organizationId),
				eq(holidayPreset.countryCode, countryCode),
			];

			if (stateCode) {
				existingConditions.push(eq(holidayPreset.stateCode, stateCode));
			}
			if (regionCode) {
				existingConditions.push(eq(holidayPreset.regionCode, regionCode));
			}

			const [existing] = await db
				.select()
				.from(holidayPreset)
				.where(and(...existingConditions))
				.limit(1);

			if (existing) {
				return NextResponse.json(
					{ error: "A preset for this location already exists", existingId: existing.id },
					{ status: 409 },
				);
			}
		}

		// Create preset
		const [newPreset] = await db
			.insert(holidayPreset)
			.values({
				organizationId: employeeRecord.organizationId,
				name,
				description: description || null,
				countryCode: countryCode || null,
				stateCode: stateCode || null,
				regionCode: regionCode || null,
				color: color || null,
				isActive: isActive ?? true,
				createdBy: session.user.id,
			})
			.returning();

		return NextResponse.json({ preset: newPreset }, { status: 201 });
	} catch (error) {
		console.error("Error creating holiday preset:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
