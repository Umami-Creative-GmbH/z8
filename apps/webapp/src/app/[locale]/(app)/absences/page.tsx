import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { connection } from "next/server";
import { Suspense } from "react";
import { AbsencesViewContainer } from "@/components/absences/absences-view-container";
import { VacationBalanceCard } from "@/components/absences/vacation-balance-card";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getTranslate } from "@/tolgee/server";
import {
	getAbsenceCategories,
	getAbsenceEntries,
	getCurrentEmployee,
	getHolidays,
	getVacationBalance,
} from "./actions";

async function AbsencesPageContent() {
	// Auth is checked in layout - session is guaranteed to exist
	const [t, employee] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
	]);
	if (!employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("absences.featureName", "manage absences")}
				/>
			</div>
		);
	}

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, employee.organizationId),
		columns: { timezone: true },
	});
	const timezone = org?.timezone || "UTC";
	// The employee's current local calendar year must be resolved per request.
	await connection();
	const now = DateTime.now().setZone(timezone);
	const nowIso = now.toUTC().toISO();
	if (!nowIso) {
		throw new RangeError("Could not resolve the current instant");
	}
	const calendarYear = now.year;
	const currentDate =
		now.toISODate() ?? DateTime.utc().toISODate() ?? "9999-12-31";

	// Fetch calendar-year data for the visual year calendar/table.
	const calendarStart = DateTime.fromObject(
		{ year: calendarYear, month: 1, day: 1 },
		{ zone: timezone },
	).startOf("day");
	const calendarEnd = calendarStart.endOf("year");
	const calendarStartDate =
		calendarStart.toISODate() ?? `${calendarYear}-01-01`;
	const calendarEndDate = calendarEnd.toISODate() ?? `${calendarYear}-12-31`;

	// Fetch all data in parallel
	const [vacationBalance, absences, holidays, categories] = await Promise.all([
		getVacationBalance(employee.id, calendarYear, timezone),
		getAbsenceEntries(employee.id, calendarStartDate, calendarEndDate),
		getHolidays(employee.id, calendarStart.toJSDate(), calendarEnd.toJSDate()),
		getAbsenceCategories(employee.organizationId),
	]);

	// If no vacation allowance is set up, show message
	if (!vacationBalance) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<div className="text-center">
					<h2 className="text-2xl font-semibold mb-2">
						{t(
							"absences.errors.allowanceNotConfigured",
							"Vacation Allowance Not Configured",
						)}
					</h2>
					<p className="text-muted-foreground">
						{t(
							"absences.errors.allowanceNotConfiguredMessage",
							"Your organization hasn't set up vacation allowances for {currentYear} yet.",
							{ currentYear: calendarYear },
						)}
						<br />
						{t(
							"absences.errors.contactAdmin",
							"Please contact your administrator to configure vacation policies.",
						)}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Header with Vacation Balance */}
			<div className="px-4 lg:px-6">
				<div className="mb-4">
					<div>
						<h1 className="text-2xl font-semibold">
							{t("absences.title", "Absences")}
						</h1>
						<p className="text-muted-foreground">
							{t("absences.subtitle", "Manage your time off and vacation days")}
						</p>
					</div>
				</div>
				<VacationBalanceCard
					balance={vacationBalance}
					now={nowIso}
					timezone={timezone}
				/>
			</div>

			{/* Calendar/Table View Container with Toggle */}
			<div className="px-4 lg:px-6">
				<AbsencesViewContainer
					absences={absences}
					holidays={holidays}
					categories={categories}
					organizationId={employee.organizationId}
					remainingDays={vacationBalance.remainingDays}
					currentYear={calendarYear}
					currentDate={currentDate}
				/>
			</div>
		</div>
	);
}

function AbsencesPageLoading() {
	return (
		<div
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
			role="status"
			aria-label="Loading absences"
		>
			<div className="space-y-2 px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-8 w-44" />
				<Skeleton aria-hidden="true" className="h-4 w-80 max-w-full" />
				<Skeleton aria-hidden="true" className="h-32 w-full" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-96 w-full" />
			</div>
		</div>
	);
}

export default function AbsencesPage() {
	return (
		<Suspense fallback={<AbsencesPageLoading />}>
			<AbsencesPageContent />
		</Suspense>
	);
}
