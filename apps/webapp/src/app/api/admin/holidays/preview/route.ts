import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, holiday } from "@/db/schema";
import { auth } from "@/lib/auth";
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
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get employee record to check role and organization
		const [employeeRecord] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
			.limit(1);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			return NextResponse.json({ error: "Admin access required" }, { status: 403 });
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
				and(eq(holiday.organizationId, employeeRecord.organizationId), eq(holiday.isActive, true)),
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
