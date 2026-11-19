import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { connection } from "next/server";
import { Suspense } from "react";
import { AbsencesViewContainer } from "@/components/absences/absences-view-container";
import { VacationBalanceCard } from "@/components/absences/vacation-balance-card";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { hasZeroWorkingDaysSchedule } from "@/lib/absences/types";
import { getTranslate } from "@/tolgee/server";
import {
	getAbsenceEntries,
	getCurrentEmployee,
	getHolidays,
	getVacationBalanceResult,
} from "./actions";
import { getAbsenceCategories } from "./queries";

async function AbsencesPageContent() {
	// Auth is checked in layout - session is guaranteed to exist
	const [t, employee] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
	]);
	if (!employee) {
		return (
			<div className="page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={t("absences.title", "Absences")} />
				<NoEmployeeError
					feature={t("absences.featureName", "manage absences")}
				/>
			</div>
		);
	}

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, employee.organizationId),
		columns: { timezone: true, name: true },
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
	const [
		{ balance: vacationBalance, configuration },
		absences,
		holidays,
		categories,
	] = await Promise.all([
		getVacationBalanceResult(employee.id, calendarYear, timezone),
		getAbsenceEntries(employee.id, calendarStartDate, calendarEndDate),
		getHolidays(employee.id, calendarStart.toJSDate(), calendarEnd.toJSDate()),
		getAbsenceCategories(employee.organizationId),
	]);

	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("absences.title", "Absences")}
				scope={
					<>
						{org?.name} · {calendarYear} · {timezone}
					</>
				}
				description={t(
					"absences.personalScope",
					"Your absences and vacation balance for the organization calendar year.",
				)}
			/>
			{vacationBalance ? (
				<VacationBalanceCard
					balance={vacationBalance}
					now={nowIso}
					timezone={timezone}
				/>
			) : (
				<Alert>
					<AlertTitle>
						{hasZeroWorkingDaysSchedule(configuration)
							? t(
									"common:vacationBalance.zeroWorkingDays",
									"Work schedule without working days",
								)
							: configuration?.status === "conflict"
								? t(
										"common:vacationBalance.conflictingPolicies",
										"Conflicting vacation policies",
									)
								: t(
										"common:vacationBalance.missingPolicy",
										"Missing vacation policy",
									)}
					</AlertTitle>
					<AlertDescription>
						{t(
							"absences.errors.policyConfigurationMessage",
							"Vacation policy configuration needs attention for {currentYear}.",
							{ currentYear: calendarYear },
						)}
						<br />
						{t(
							"absences.errors.contactAdmin",
							"Please contact your administrator to configure vacation policies.",
						)}
					</AlertDescription>
				</Alert>
			)}
			<AbsencesViewContainer
				key={`${employee.organizationId}:${employee.id}`}
				absences={absences}
				holidays={holidays}
				categories={categories}
				organizationId={employee.organizationId}
				currentYear={calendarYear}
				currentDate={currentDate}
			/>
		</div>
	);
}

async function AbsencesPageLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.absences",
				labelDefault: "Loading absences",
			}}
		>
			<PageHeader title={t("absences.title", "Absences")} />
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-44" />
				<Skeleton aria-hidden="true" className="h-4 w-80 max-w-full" />
				<Skeleton aria-hidden="true" className="h-32 w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-96 w-full" />
		</LoadingRegion>
	);
}

export default function AbsencesPage() {
	return (
		<Suspense fallback={<AbsencesPageLoading />}>
			<AbsencesPageContent />
		</Suspense>
	);
}
