import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
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
		const validationResult = holidayImportSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{
					error: "Invalid request body",
					details: validationResult.error.issues,
				},
				{ status: 400 },
			);
		}

		const { holidays, categoryId, createRecurring, skipDuplicates } =
			validationResult.data;

		const result = await db.transaction(async (tx) => {
			const lockKey = `holiday-import:${activeOrgId}`;
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
			);

			if (categoryId) {
				const [category] = await tx
					.select({ id: holidayCategory.id })
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, categoryId),
							eq(holidayCategory.organizationId, activeOrgId),
						),
					)
					.limit(1);

				if (!category) return { invalidCategory: true as const };
			}

			let targetCategoryId = categoryId;
			if (!targetCategoryId) {
				const [existingCategory] = await tx
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
					const [newCategory] = await tx
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

					if (!newCategory) {
						throw new Error("Failed to create holiday category");
					}
					targetCategoryId = newCategory.id;
				}
			}

			const existingHolidays = await tx
				.select({
					name: holiday.name,
					startDate: holiday.startDate,
					recurrenceRule: holiday.recurrenceRule,
				})
				.from(holiday)
				.where(
					and(
						eq(holiday.organizationId, activeOrgId),
						eq(holiday.isActive, true),
					),
				);
			const values: Array<typeof holiday.$inferInsert> = [];
			const errors: string[] = [];
			let skipped = 0;

			for (const item of holidays) {
				const holidayPreview: HolidayPreview = {
					name: item.name,
					date: item.date,
					startDate: item.startDate,
					endDate: item.endDate,
					type: item.type,
				};

				if (
					skipDuplicates &&
					isHolidayDuplicate(holidayPreview, existingHolidays)
				) {
					skipped++;
					continue;
				}

				try {
					const holidayData = mapToHolidayFormValues(
						holidayPreview,
						targetCategoryId,
						createRecurring,
					);
					values.push({
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
					existingHolidays.push({
						name: holidayData.name,
						startDate: holidayData.startDate,
						recurrenceRule: holidayData.recurrenceRule || null,
					});
				} catch {
					errors.push(`Failed to import "${item.name}"`);
				}
			}

			if (values.length > 0) {
				await tx.insert(holiday).values(values);
			}

			return {
				imported: values.length,
				skipped,
				errors,
				categoryId: targetCategoryId,
			};
		});
		if ("invalidCategory" in result) {
			return NextResponse.json(
				{ error: "Invalid holiday category" },
				{ status: 400 },
			);
		}

		return NextResponse.json(result);
	} catch (error) {
		console.error("Error importing holidays:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
