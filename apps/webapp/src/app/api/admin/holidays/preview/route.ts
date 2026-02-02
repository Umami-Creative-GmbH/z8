import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { holiday } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import {
	getHolidaysForYear,
	type HolidayType,
	isHolidayDuplicate,
} from "@/lib/holidays/date-holidays-service";

/**
 * GET /api/admin/holidays/preview
 * Preview holidays from date-holidays library for a specific location
 */
export async function GET(request: NextRequest) {
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

		// Get query parameters
		const { searchParams } = new URL(request.url);
		const country = searchParams.get("country");
		const state = searchParams.get("state") || undefined;
		const region = searchParams.get("region") || undefined;
		const yearParam = searchParams.get("year");
		const typesParam = searchParams.get("types");

		if (!country) {
			return NextResponse.json({ error: "Country code is required" }, { status: 400 });
		}

		const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
		const types = typesParam ? (typesParam.split(",") as HolidayType[]) : ["public" as HolidayType];

		// Get holidays from date-holidays library
		const previewHolidays = getHolidaysForYear(country, state, region, year, types);

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

		// Mark duplicates
		const holidaysWithDuplicateInfo = previewHolidays.map((h) => ({
			...h,
			isDuplicate: isHolidayDuplicate(h, existingHolidays),
		}));

		return NextResponse.json({
			holidays: holidaysWithDuplicateInfo,
			existingCount: existingHolidays.length,
		});
	} catch (error) {
		console.error("Error previewing holidays:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
