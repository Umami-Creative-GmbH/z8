import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import {
	getAbsenceCategories,
	getAbsenceEntries,
	getVacationBalance,
	requestAbsenceForEmployee,
} from "@/app/[locale]/(app)/absences/actions";

function isRealIsoDate(value: string) {
	return DateTime.fromISO(value, { zone: "utc" }).toISODate() === value;
}

const mobileAbsenceDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
	.refine(isRealIsoDate, "Date must be a real calendar date");

const mobileAbsenceRequestSchema = z.object({
	categoryId: z.string().trim().min(1, "categoryId is required"),
	startDate: mobileAbsenceDateSchema,
	startPeriod: z.enum(["full_day", "am", "pm"]),
	endDate: mobileAbsenceDateSchema,
	endPeriod: z.enum(["full_day", "am", "pm"]),
	notes: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const year = DateTime.now().year;
		const startOfYear = `${year - 1}-01-01`;
		const endOfYear = `${year + 1}-12-31`;

		const [categories, absences, vacationBalance] = await Promise.all([
			getAbsenceCategories(activeOrganizationId),
			getAbsenceEntries(employeeRecord.id, startOfYear, endOfYear),
			getVacationBalance(employeeRecord.id, year),
		]);

		return NextResponse.json({
			categories,
			absences,
			vacationBalance,
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		let requestBody: unknown;
		try {
			requestBody = await request.json();
		} catch {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
		}

		const parsedBody = mobileAbsenceRequestSchema.safeParse(requestBody);
		if (!parsedBody.success) {
			const firstIssue = parsedBody.error.issues[0];
			const fieldName = typeof firstIssue?.path[0] === "string" ? firstIssue.path[0] : null;
			const errorMessage =
				firstIssue?.message === "Date must be in YYYY-MM-DD format"
					? `${fieldName ?? "date"} must be in YYYY-MM-DD format`
					: firstIssue?.message === "Date must be a real calendar date"
						? `${fieldName ?? "date"} must be a real calendar date`
						: firstIssue?.message ?? "Invalid request body";

			return NextResponse.json(
				{ error: errorMessage },
				{ status: 400 },
			);
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);

		const result = await requestAbsenceForEmployee(parsedBody.data, employeeRecord, session.user.id);

		if (!result.success) {
			return NextResponse.json({ error: result.error ?? "Failed to request absence" }, { status: 400 });
		}

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
