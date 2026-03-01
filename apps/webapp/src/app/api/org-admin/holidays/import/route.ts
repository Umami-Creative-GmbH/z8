import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { holiday, holidayCategory } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import {
	type HolidayPreview,
	isHolidayDuplicate,
	mapToHolidayFormValues,
} from "@/lib/holidays/date-holidays-service";
import { holidayImportSchema } from "@/lib/holidays/validation";

/**
 * POST /api/org-admin/holidays/import
 * Bulk import holidays from date-holidays library
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
		const validationResult = holidayImportSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request body", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const { holidays, categoryId, createRecurring, skipDuplicates } = validationResult.data;

		// Get or create "Public Holidays" category
		let targetCategoryId = categoryId;

		if (!targetCategoryId) {
			// Check if "Public Holidays" category exists
			const [existingCategory] = await db
				.select({ id: holidayCategory.id })
				.from(holidayCategory)
				.where(
					and(
						eq(holidayCategory.organizationId, activeOrgId),
						eq(holidayCategory.type, "public_holiday"),
						eq(holidayCategory.isActive, true),
					),
				)
				.limit(1);

			if (existingCategory) {
				targetCategoryId = existingCategory.id;
			} else {
				// Create the "Public Holidays" category
				const [newCategory] = await db
					.insert(holidayCategory)
					.values({
						organizationId: activeOrgId,
						type: "public_holiday",
						name: "Public Holidays",
						description: "National and regional public holidays",
						color: "#EF4444",
						blocksTimeEntry: true,
						excludeFromCalculations: true,
						isActive: true,
					})
					.returning({ id: holidayCategory.id });

				targetCategoryId = newCategory.id;
			}
		}

		// Get existing holidays to detect duplicates
		const existingHolidays = await db
			.select({
				name: holiday.name,
				startDate: holiday.startDate,
				recurrenceRule: holiday.recurrenceRule,
			})
			.from(holiday)
			.where(
				and(eq(holiday.organizationId, activeOrgId), eq(holiday.isActive, true)),
			);

		// Process holidays
		let imported = 0;
		let skipped = 0;
		const errors: string[] = [];

		for (const h of holidays) {
			const holidayPreview: HolidayPreview = {
				name: h.name,
				date: h.date,
				startDate: h.startDate,
				endDate: h.endDate,
				type: h.type,
			};

			// Check for duplicates
			if (skipDuplicates && isHolidayDuplicate(holidayPreview, existingHolidays)) {
				skipped++;
				continue;
			}

			try {
				const holidayData = mapToHolidayFormValues(
					holidayPreview,
					targetCategoryId,
					createRecurring,
				);

				await db.insert(holiday).values({
					organizationId: activeOrgId,
					name: holidayData.name,
					description: holidayData.description || null,
					categoryId: holidayData.categoryId,
					startDate: holidayData.startDate,
					endDate: holidayData.endDate,
					recurrenceType: holidayData.recurrenceType,
					recurrenceRule: holidayData.recurrenceRule || null,
					recurrenceEndDate: holidayData.recurrenceEndDate || null,
					isActive: holidayData.isActive,
					createdBy: session.user.id,
				});

				imported++;

				// Add to existing list to prevent duplicates within same batch
				existingHolidays.push({
					name: holidayData.name,
					startDate: holidayData.startDate,
					recurrenceRule: holidayData.recurrenceRule || null,
				});
			} catch (error) {
				console.error(`Error importing holiday ${h.name}:`, error);
				errors.push(`Failed to import "${h.name}"`);
			}
		}

		return NextResponse.json({
			imported,
			skipped,
			errors,
			categoryId: targetCategoryId,
		});
	} catch (error) {
		console.error("Error importing holidays:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
